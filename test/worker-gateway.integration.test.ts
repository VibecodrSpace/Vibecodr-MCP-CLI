import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { ConfigStore } from "../src/storage/config-store.js";
import { defaultProfileConfig } from "../src/types/config.js";

type WorkerModule = {
  default: {
    fetch(request: Request, env: Record<string, unknown>): Promise<Response>;
  };
};

type ServerState = {
  baseUrl: string;
  close: () => Promise<void>;
};

type ProviderServerState = ServerState & {
  revokedTokens: string[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForChildExit(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<number> {
  return await Promise.race([
    new Promise<number>((resolve) => child.once("exit", (code) => resolve(code ?? 1))),
    sleep(timeoutMs).then(() => -1)
  ]);
}

async function readRequestBody(req: IncomingMessage): Promise<Uint8Array | undefined> {
  if (req.method === "GET" || req.method === "HEAD") {
    return undefined;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return undefined;
  return new Uint8Array(Buffer.concat(chunks));
}

async function createProviderServer(): Promise<ProviderServerState> {
  const revokedTokens: string[] = [];
  const issuedRefreshToken = "provider-refresh-initial";
  const server = createServer((req, res) => {
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const url = new URL(req.url || "/", baseUrl);
    if (req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          issuer: baseUrl,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          revocation_endpoint: `${baseUrl}/revoke`,
          code_challenge_methods_supported: ["S256"],
          response_types_supported: ["code"],
          token_endpoint_auth_methods_supported: ["none", "client_secret_post"]
        })
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      if (!redirectUri || !state) {
        res.statusCode = 400;
        res.end("missing redirect_uri or state");
        return;
      }
      const redirect = new URL(redirectUri);
      redirect.searchParams.set("code", "provider-auth-code");
      redirect.searchParams.set("state", state);
      res.statusCode = 302;
      res.setHeader("location", redirect.toString());
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/token") {
      let body = "";
      req.on("data", (chunk) => {
        body += String(chunk);
      });
      req.on("end", () => {
        const form = new URLSearchParams(body);
        const grantType = form.get("grant_type");
        res.setHeader("content-type", "application/json");
        if (grantType === "authorization_code") {
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              access_token: "provider-access-initial",
              refresh_token: issuedRefreshToken,
              token_type: "Bearer",
              expires_in: 3600,
              scope: "openid profile email offline_access"
            })
          );
          return;
        }
        if (grantType === "refresh_token") {
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              access_token: "provider-access-refreshed",
              refresh_token: "provider-refresh-rotated",
              token_type: "Bearer",
              expires_in: 3600,
              scope: "openid profile email offline_access"
            })
          );
          return;
        }
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "unsupported_grant_type" }));
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/revoke") {
      let body = "";
      req.on("data", (chunk) => {
        body += String(chunk);
      });
      req.on("end", () => {
        const form = new URLSearchParams(body);
        revokedTokens.push(form.get("token") || "");
        res.statusCode = 200;
        res.end();
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    revokedTokens,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

async function createVibecodrApiServer(): Promise<ServerState> {
  const server = createServer((req, res) => {
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const url = new URL(req.url || "/", baseUrl);
    if (req.method === "POST" && url.pathname === "/auth/cli/exchange") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          access_token: "vibecodr-access-token",
          user_id: "user_test_123",
          user_handle: "integration-user",
          expires_at: Math.floor(Date.now() / 1000) + 3600
        })
      );
      return;
    }
    if (req.method === "GET" && url.pathname === "/user/quota") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          plan: "creator",
          usage: {
            storage: 10,
            runs: 2,
            bundleSize: 1024,
            serverActionRuns: 0,
            serverActionCount: 0,
            webhookCalls: 0
          },
          limits: {
            maxStorage: 1000,
            maxRuns: 500,
            maxPrivateVibes: 10,
            maxConnections: 3,
            serverActions: {
              maxActions: 2,
              maxRunsPerMonth: 1000,
              maxRuntimeMs: 30000
            },
            pulses: {
              maxActions: 3,
              maxRunsPerMonth: 1000,
              maxComputeMsPerMonth: 200000000,
              maxRuntimeMs: 30000,
              maxPrivatePulses: 5,
              maxSubrequests: 20,
              maxVanitySubdomains: 2,
              proxyRateLimit: 100,
              secretsProxyOwnerRateLimit: 100,
              secretsProxyPulseRateLimit: 100
            },
            webhookActions: {
              maxActions: 1,
              maxCallsPerMonth: 100
            },
            features: {
              customSeo: true,
              serverActionsEnabled: true,
              pulsesEnabled: true,
              webhookActionsEnabled: true,
              embedsUnbranded: true,
              customDomains: 1,
              d1SqlEnabled: true,
              secretsStoreEnabled: true,
              canPublishLibraryVibes: true,
              advancedZipAnalysis: true,
              studioParamsTab: true,
              studioFilesTab: true
            }
          },
          percentUsed: {
            storage: 1,
            runs: 1
          }
        })
      );
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

async function createGatewayServer(providerBaseUrl: string, vibecodrApiBaseUrl: string): Promise<ServerState> {
  const workerModule = await loadGatewayWorker();
  const server = createServer(async (req, res) => {
    try {
      const workerBaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const reqUrl = new URL(req.url || "/", workerBaseUrl);
      const requestBody = await readRequestBody(req);
      const requestBodyText = requestBody ? Buffer.from(requestBody).toString("utf8") : undefined;
      const request = new Request(reqUrl.toString(), {
        method: req.method || "GET",
        headers: req.headers as Record<string, string>,
        ...(requestBodyText !== undefined ? { body: requestBodyText } : {})
      });
      const response = await workerModule.default.fetch(request, {
        NODE_ENV: "development",
        APP_BASE_URL: workerBaseUrl,
        VIBECDR_API_BASE: vibecodrApiBaseUrl,
        SESSION_SIGNING_KEY: "x".repeat(32),
        OAUTH_PROVIDER_NAME: "local-provider",
        OAUTH_CLIENT_ID: "local-client-id",
        OAUTH_CLIENT_SECRET: "local-client-secret",
        OAUTH_ISSUER_URL: providerBaseUrl,
        OAUTH_SCOPES: "openid profile email offline_access",
        COOKIE_SECURE: "false"
      });
      const bodyBuffer = Buffer.from(await response.arrayBuffer());
      res.statusCode = response.status;
      response.headers.forEach((value: string, key: string) => {
        res.setHeader(key, value);
      });
      res.end(bodyBuffer);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      console.error(error);
      res.end("Internal test worker error.");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

async function resolveGatewayWorkerModulePath(): Promise<string | null> {
  const configuredPath = process.env["VIBECDR_MCP_GATEWAY_WORKER_PATH"]?.trim();
  const candidates = [
    configuredPath,
    resolve(process.cwd(), "../vibecodr-openai-app/src/worker.js")
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function loadGatewayWorker(): Promise<WorkerModule> {
  const workerPath = await resolveGatewayWorkerModulePath();
  if (!workerPath) {
    throw new Error(
      "Worker integration test requires VIBECDR_MCP_GATEWAY_WORKER_PATH or a sibling vibecodr-openai-app checkout."
    );
  }
  return await import(pathToFileURL(workerPath).href) as WorkerModule;
}

async function runCli(args: string[], env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn("node", ["--import", "tsx", "src/bin/vibecodr-mcp.ts", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function waitForFile(path: string, timeoutMs: number): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await sleep(25);
    }
  }
  throw new Error(`Timed out waiting for file: ${path}`);
}

async function runCliLogin(env: Record<string, string>): Promise<void> {
  const child = spawn(
    "node",
    ["--import", "tsx", "src/bin/vibecodr-mcp.ts", "--profile", "test", "login", "--browser", "print", "--timeout-sec", "30"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  let authorizationUrl = "";
  try {
    const authUrlFile = env["VIBECDR_MCP_TEST_AUTH_URL_FILE"];
    assert.ok(authUrlFile);
    authorizationUrl = (await waitForFile(authUrlFile, 5000)).trim();
  } catch (error) {
    child.kill();
    const exitCode = await waitForChildExit(child, 1500);
    throw new Error(
      `login did not emit auth url file. exit=${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}\n${error instanceof Error ? error.message : String(error)}`
    );
  }
  assert.ok(authorizationUrl.startsWith("http://127.0.0.1:"), `unexpected authorization URL: ${authorizationUrl}`);
  try {
    const browserResponse = await fetch(authorizationUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000)
    });
    assert.equal(browserResponse.ok, true);
  } catch (error) {
    child.kill();
    const exitCode = await waitForChildExit(child, 1500);
    throw new Error(
      `browser redirect flow failed. exit=${exitCode}\nurl=${authorizationUrl}\nstdout:\n${stdout}\nstderr:\n${stderr}\n${error instanceof Error ? error.message : String(error)}`
    );
  }

  const exitCode = await Promise.race([
    new Promise<number>((resolve) => child.on("exit", (code) => resolve(code ?? 1))),
    new Promise<number>((resolve) => {
      setTimeout(() => {
        child.kill();
        resolve(1);
      }, 15_000);
    })
  ]);
  assert.equal(exitCode, 0, `login failed\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

async function withCliEnv<T>(env: Record<string, string>, run: () => Promise<T>): Promise<T> {
  const previous = {
    config: process.env["VIBECDR_MCP_CONFIG_PATH"],
    manifest: process.env["VIBECDR_MCP_INSTALL_MANIFEST_PATH"],
    secret: process.env["VIBECDR_MCP_INSECURE_SECRET_STORE_PATH"],
    insecureSecretStoreEnabled: process.env["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"]
  };
  process.env["VIBECDR_MCP_CONFIG_PATH"] = env["VIBECDR_MCP_CONFIG_PATH"];
  process.env["VIBECDR_MCP_INSTALL_MANIFEST_PATH"] = env["VIBECDR_MCP_INSTALL_MANIFEST_PATH"];
  process.env["VIBECDR_MCP_INSECURE_SECRET_STORE_PATH"] = env["VIBECDR_MCP_INSECURE_SECRET_STORE_PATH"];
  process.env["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"] = env["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"];
  try {
    return await run();
  } finally {
    process.env["VIBECDR_MCP_CONFIG_PATH"] = previous.config;
    process.env["VIBECDR_MCP_INSTALL_MANIFEST_PATH"] = previous.manifest;
    process.env["VIBECDR_MCP_INSECURE_SECRET_STORE_PATH"] = previous.secret;
    process.env["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"] = previous.insecureSecretStoreEnabled;
  }
}

test("CLI integrates end-to-end with real worker OAuth + protected tools", { timeout: 60_000 }, async (t) => {
  const workerPath = await resolveGatewayWorkerModulePath();
  if (!workerPath) {
    t.skip("worker integration requires a local vibecodr-openai-app checkout or VIBECDR_MCP_GATEWAY_WORKER_PATH");
    return;
  }
  const provider = await createProviderServer();
  const vibecodrApi = await createVibecodrApiServer();
  const gateway = await createGatewayServer(provider.baseUrl, vibecodrApi.baseUrl);
  const tempDir = await mkdtemp(join(tmpdir(), "vibecodr-worker-cli-integration-"));
  const env = {
    VIBECDR_MCP_CONFIG_PATH: join(tempDir, "config.json"),
    VIBECDR_MCP_INSTALL_MANIFEST_PATH: join(tempDir, "installs.json"),
    VIBECDR_MCP_INSECURE_SECRET_STORE_PATH: join(tempDir, "secrets.json"),
    VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE: "true",
    VIBECDR_MCP_TEST_AUTH_URL_FILE: join(tempDir, "auth-url.txt"),
    VIBECDR_MCP_CIMD_CLIENT_ID: `${gateway.baseUrl}/.well-known/oauth-client/vibecodr-mcp.json`
  };

  try {
    await withCliEnv(env, async () => {
      const configStore = new ConfigStore();
      const config = await configStore.load();
      config.profiles["test"] = {
        ...defaultProfileConfig(),
        ...config.profiles["default"],
        serverUrl: `${gateway.baseUrl}/mcp`,
        browserMode: "print",
        registrationMode: "cimd"
      };
      config.currentProfile = "test";
      await configStore.save(config);
    });

    const beforeLoginTools = await runCli(["--profile", "test", "tools", "--json", "--non-interactive"], env);
    assert.equal(beforeLoginTools.code, 0, `tools before login failed\nstdout:\n${beforeLoginTools.stdout}\nstderr:\n${beforeLoginTools.stderr}`);
    const beforeLoginToolsPayload = JSON.parse(beforeLoginTools.stdout) as { tools?: Array<{ name?: string }> };
    assert.equal(Boolean(beforeLoginToolsPayload.tools?.some((tool) => tool.name === "get_vibecodr_platform_overview")), true);

    await runCliLogin(env);

    const capabilities = await runCli(["--profile", "test", "call", "get_account_capabilities", "--json", "--non-interactive"], env);
    assert.equal(capabilities.code, 0, `capabilities call failed\nstdout:\n${capabilities.stdout}\nstderr:\n${capabilities.stderr}`);
    const capabilitiesPayload = JSON.parse(capabilities.stdout) as {
      tool?: string;
    };
    assert.equal(capabilitiesPayload.tool, "get_account_capabilities");
    assert.match(capabilities.stdout, /"plan"\s*:\s*"creator"/);

    const logout = await runCli(["--profile", "test", "logout", "--json", "--non-interactive"], env);
    assert.equal(logout.code, 0, `logout failed\nstdout:\n${logout.stdout}\nstderr:\n${logout.stderr}`);
    assert.deepEqual(provider.revokedTokens, ["provider-refresh-initial"]);
  } finally {
    await gateway.close();
    await vibecodrApi.close();
    await provider.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
