import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { ConfigStore } from "../src/storage/config-store.js";
import { SecretStore } from "../src/storage/secret-store.js";
import { TokenManager } from "../src/auth/token-manager.js";
import { McpRuntimeClient } from "../src/core/mcp-client.js";
import { Output } from "../src/cli/output.js";
import { runCallCommand } from "../src/commands/call.js";
import { CliError } from "../src/cli/errors.js";
import { defaultProfileConfig } from "../src/types/config.js";

type MockOptions = {
  requireAuthForList?: boolean;
  invalidateRefresh?: boolean;
};

async function createMockServer(options: MockOptions = {}): Promise<{
  serverUrl: string;
  close: () => Promise<void>;
  state: {
    revokedTokens: string[];
  };
}> {
  const state = {
    revokedTokens: [] as string[]
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const authHeader = req.headers.authorization;

    if (req.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        resource: `${baseUrl}/mcp`,
        authorization_servers: [baseUrl]
      }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/.well-known/oauth-authorization-server") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/authorize`,
        token_endpoint: `${baseUrl}/token`,
        registration_endpoint: `${baseUrl}/register`,
        revocation_endpoint: `${baseUrl}/revoke`,
        response_types_supported: ["code"],
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"]
      }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/register") {
      let body = "";
      req.on("data", (chunk) => { body += String(chunk); });
      req.on("end", () => {
        const parsed = JSON.parse(body) as { redirect_uris: string[] };
        res.setHeader("content-type", "application/json");
        res.statusCode = 201;
        res.end(JSON.stringify({
          client_id: "mock-client",
          redirect_uris: parsed.redirect_uris,
          token_endpoint_auth_method: "none"
        }));
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/authorize") {
      const redirect = new URL(url.searchParams.get("redirect_uri") || "");
      redirect.searchParams.set("code", "mock-code");
      redirect.searchParams.set("state", url.searchParams.get("state") || "");
      res.statusCode = 302;
      res.setHeader("location", redirect.toString());
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/token") {
      let body = "";
      req.on("data", (chunk) => { body += String(chunk); });
      req.on("end", () => {
        const params = new URLSearchParams(body);
        res.setHeader("content-type", "application/json");
        if (params.get("grant_type") === "authorization_code") {
          res.end(JSON.stringify({
            access_token: "access-token-1",
            token_type: "Bearer",
            expires_in: options.invalidateRefresh ? 1 : 3600,
            refresh_token: options.invalidateRefresh ? "refresh-invalid" : "refresh-ok",
            scope: "openid profile email offline_access"
          }));
          return;
        }
        if (params.get("grant_type") === "refresh_token") {
          if (options.invalidateRefresh) {
            res.statusCode = 400;
            res.end(JSON.stringify({
              error: "invalid_grant"
            }));
            return;
          }
          res.end(JSON.stringify({
            access_token: "access-token-2",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "refresh-rotated",
            scope: "openid profile email offline_access"
          }));
          return;
        }
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "unsupported_grant_type" }));
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/revoke") {
      let body = "";
      req.on("data", (chunk) => { body += String(chunk); });
      req.on("end", () => {
        const params = new URLSearchParams(body);
        state.revokedTokens.push(params.get("token") || "");
        res.statusCode = 200;
        res.end();
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/mcp") {
      res.statusCode = 405;
      res.setHeader("allow", "POST, OPTIONS");
      res.end();
      return;
    }
    if (req.method === "OPTIONS" && url.pathname === "/mcp") {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (url.pathname === "/mcp") {
      let body = "";
      req.on("data", (chunk) => { body += String(chunk); });
      req.on("end", () => {
        const payload = JSON.parse(body) as { id: string | number | null; method: string; params?: Record<string, unknown> };
        const requireAuth = payload.method === "tools/call" || (payload.method === "tools/list" && options.requireAuthForList);
        const invalidAccessToken = options.invalidateRefresh && authHeader === "Bearer access-token-1";
        if (requireAuth && !authHeader) {
          res.statusCode = 401;
          res.setHeader("www-authenticate", `Bearer realm="mock", authorization_uri="${baseUrl}/authorize", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", scope="openid profile email offline_access"`);
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            error: { code: -32001, message: "Authentication required." }
          }));
          return;
        }
        if (requireAuth && invalidAccessToken) {
          res.statusCode = 401;
          res.setHeader("www-authenticate", `Bearer realm="mock", authorization_uri="${baseUrl}/authorize", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", scope="openid profile email offline_access", error="invalid_token"`);
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            error: { code: -32001, message: "Token expired." }
          }));
          return;
        }

        if (payload.method === "initialize") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            result: {
              protocolVersion: LATEST_PROTOCOL_VERSION,
              serverInfo: { name: "mock", version: "1.0.0" },
              capabilities: { tools: {} }
            }
          }));
          return;
        }
        if (payload.method === "notifications/initialized") {
          res.statusCode = 202;
          res.end();
          return;
        }

        if (payload.method === "tools/list") {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            result: {
              tools: [
                {
                  name: "quick_publish_creation",
                  description: "Protected tool",
                  inputSchema: {
                    type: "object",
                    required: ["title", "metadata", "tags"],
                    properties: {
                      title: { type: "string" },
                      tags: { type: "array", items: { type: "string" } },
                      metadata: {
                        type: "object",
                        properties: {
                          featured: { type: "boolean" }
                        }
                      }
                    }
                  },
                  securitySchemes: [{ type: "oauth2", scopes: ["openid", "profile", "email", "offline_access"] }]
                },
                {
                  name: "update_live_vibe_metadata",
                  description: "Protected update",
                  inputSchema: {
                    type: "object",
                    required: ["postId"],
                    properties: {
                      postId: { type: "string" }
                    }
                  },
                  securitySchemes: [{ type: "oauth2", scopes: ["openid", "profile", "email", "offline_access"] }]
                }
              ]
            }
          }));
          return;
        }

        if (payload.method === "tools/call") {
          const toolName = String(payload.params?.["name"] || "");
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            id: payload.id,
            result: {
              content: [{ type: "text", text: `${toolName} ok` }],
              structuredContent: {
                tool: toolName,
                arguments: payload.params?.["arguments"] || {}
              }
            }
          }));
          return;
        }

        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: payload.id,
          error: { code: -32601, message: "Method not found" }
        }));
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    serverUrl: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    state
  };
}

async function runCli(args: string[], env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return await new Promise((resolve) => {
    const child = spawn("node", ["--import", "tsx", "src/bin/vibecodr-mcp.ts", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function loginIntoFileStore(serverUrl: string, env: Record<string, string>): Promise<void> {
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
    const configStore = new ConfigStore();
    const config = await configStore.load();
    config.profiles["test"] = {
      ...defaultProfileConfig(),
      ...config.profiles["default"],
      serverUrl
    };
    config.currentProfile = "test";
    await configStore.save(config);

    const secretStore = new SecretStore();
    const tokenManager = new TokenManager(configStore, secretStore);
    let authUrl = "";
    const loginPromise = tokenManager.login(
      {
        profile: "test",
        json: false,
        verbose: false,
        nonInteractive: false
      },
      {
        registrationMode: "dcr",
        browserMode: "print",
        onAuthorizationUrl: (url) => {
          authUrl = url;
        }
      }
    );
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (authUrl) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(authUrl);
    await fetch(authUrl, { redirect: "follow" });
    await loginPromise;
  } finally {
    process.env["VIBECDR_MCP_CONFIG_PATH"] = previous.config;
    process.env["VIBECDR_MCP_INSTALL_MANIFEST_PATH"] = previous.manifest;
    process.env["VIBECDR_MCP_INSECURE_SECRET_STORE_PATH"] = previous.secret;
    process.env["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"] = previous.insecureSecretStoreEnabled;
  }
}

test("CLI supports help aliases everywhere and version aliases at root", async () => {
  const temp = await mkdtemp(join(tmpdir(), "vibecodr-cli-help-"));
  const env = {
    VIBECDR_MCP_CONFIG_PATH: join(temp, "config.json"),
    VIBECDR_MCP_INSTALL_MANIFEST_PATH: join(temp, "installs.json"),
    VIBECDR_MCP_INSECURE_SECRET_STORE_PATH: join(temp, "secrets.json"),
    VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE: "true"
  };
  const rootHelpAliases = ["--help", "-h", "-help"];
  for (const alias of rootHelpAliases) {
    const result = await runCli([alias], env);
    assert.equal(result.code, 0, `${alias} failed\n${result.stderr}`);
    assert.match(result.stdout, /vibecodr <command>/);
  }
  for (const alias of ["--version", "-v", "-version"]) {
    const result = await runCli([alias], env);
    assert.equal(result.code, 0, `${alias} failed\n${result.stderr}`);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  }
  for (const command of ["login", "logout", "status", "whoami", "tools", "call", "pulse-setup", "pulse-publish", "pulse", "doctor", "config", "install", "uninstall"]) {
    for (const alias of rootHelpAliases) {
      const result = await runCli([command, alias], env);
      assert.equal(result.code, 0, `${command} ${alias} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
      assert.match(result.stdout, /Usage:/);
    }
  }
  for (const [subcommand, expectedUsage] of [
    ["list", "Usage: vibecodr pulse list [--limit <n>] [--offset <n>]"],
    ["get", "Usage: vibecodr pulse get <pulse-id>"],
    ["status", "Usage: vibecodr pulse status <pulse-id>"],
    ["run", "Usage: vibecodr pulse run <pulse-id> [--input-json <json> | --input-file <path>] --confirm"],
    ["archive", "Usage: vibecodr pulse archive <pulse-id> --confirm"],
    ["restore", "Usage: vibecodr pulse restore <pulse-id> --confirm"],
    ["create", "Usage: vibecodr pulse create --name <name> (--code <source> | --code-file <path>) [--descriptor-json <json> | --descriptor-file <path>] [--slug <slug>] [--visibility public|unlisted|private] --confirm"],
    ["deploy", "Usage: vibecodr pulse deploy --name <name> (--code <source> | --code-file <path>) [--descriptor-json <json> | --descriptor-file <path>] [--slug <slug>] [--visibility public|unlisted|private] --confirm"]
  ] as const) {
    for (const alias of rootHelpAliases) {
      const result = await runCli(["pulse", subcommand, alias], env);
      assert.equal(result.code, 0, `pulse ${subcommand} ${alias} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
      assert.match(result.stdout, new RegExp(expectedUsage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  }
});

test("CLI e2e covers login, protected tools/list + call, and logout revocation", async () => {
  const mock = await createMockServer({ requireAuthForList: true });
  const temp = await mkdtemp(join(tmpdir(), "vibecodr-cli-e2e-"));
  const env = {
    VIBECDR_MCP_CONFIG_PATH: join(temp, "config.json"),
    VIBECDR_MCP_INSTALL_MANIFEST_PATH: join(temp, "installs.json"),
    VIBECDR_MCP_INSECURE_SECRET_STORE_PATH: join(temp, "secrets.json"),
    VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE: "true",
    VIBECDR_MCP_TEST_AUTH_URL_FILE: join(temp, "auth-url.txt")
  };

  try {
    await loginIntoFileStore(mock.serverUrl, env);

    const toolsResult = await runCli(["--profile", "test", "tools", "--json"], env);
    assert.equal(toolsResult.code, 0, `tools failed\nstdout:\n${toolsResult.stdout}\nstderr:\n${toolsResult.stderr}`);
    assert.equal(JSON.parse(toolsResult.stdout).toolCount, 2);

    const publishResult = await runCli([
      "--profile", "test", "call", "quick_publish_creation",
      "--input-json", JSON.stringify({ title: "Ship it", tags: ["one"], metadata: { featured: true }, confirmed: true }),
      "--confirm",
      "--json"
    ], env);
    assert.equal(publishResult.code, 0, `publish failed\nstdout:\n${publishResult.stdout}\nstderr:\n${publishResult.stderr}`);
    assert.equal(JSON.parse(publishResult.stdout).result.structuredContent.tool, "quick_publish_creation");

    const updateResult = await runCli([
      "--profile", "test", "call", "update_live_vibe_metadata",
      "--input-json", JSON.stringify({ postId: "post_123", confirmed: true }),
      "--confirm",
      "--json"
    ], env);
    assert.equal(updateResult.code, 0, `update failed\nstdout:\n${updateResult.stdout}\nstderr:\n${updateResult.stderr}`);
    assert.equal(JSON.parse(updateResult.stdout).result.structuredContent.tool, "update_live_vibe_metadata");

    const logoutResult = await runCli(["--profile", "test", "logout", "--json"], env);
    assert.equal(logoutResult.code, 0, `logout failed\nstdout:\n${logoutResult.stdout}\nstderr:\n${logoutResult.stderr}`);
    assert.deepEqual(mock.state.revokedTokens, ["refresh-ok"]);
  } finally {
    await mock.close();
  }
});

test("CLI clears stored auth after invalid_grant on refresh", async () => {
  const mock = await createMockServer({ invalidateRefresh: true });
  const temp = await mkdtemp(join(tmpdir(), "vibecodr-cli-invalid-grant-"));
  const env = {
    VIBECDR_MCP_CONFIG_PATH: join(temp, "config.json"),
    VIBECDR_MCP_INSTALL_MANIFEST_PATH: join(temp, "installs.json"),
    VIBECDR_MCP_INSECURE_SECRET_STORE_PATH: join(temp, "secrets.json"),
    VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE: "true",
    VIBECDR_MCP_TEST_AUTH_URL_FILE: join(temp, "auth-url.txt")
  };

  try {
    await loginIntoFileStore(mock.serverUrl, env);

    await new Promise((resolve) => setTimeout(resolve, 1100));
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
      const configStore = new ConfigStore();
      const secretStore = new SecretStore();
      const tokenManager = new TokenManager(configStore, secretStore);
      const runtimeClient = new McpRuntimeClient();
      await assert.rejects(
        runCallCommand([
          "quick_publish_creation",
          "--input-json", JSON.stringify({ title: "Ship it", tags: ["one"], metadata: { featured: true }, confirmed: true }),
          "--confirm"
        ], {
          globalOptions: {
            profile: "test",
            json: true,
            verbose: false,
            nonInteractive: true
          },
          output: new Output({
            profile: "test",
            json: true,
            verbose: false,
            nonInteractive: true
          }),
          configStore,
          secretStore,
          tokenManager,
          runtimeClient
        }),
        (error: unknown) => {
          assert.ok(error instanceof CliError);
          assert.equal(error.machineCode, "auth.refresh_failed");
          assert.equal(error.exitCode, 5);
          return true;
        }
      );
    } finally {
      process.env["VIBECDR_MCP_CONFIG_PATH"] = previous.config;
      process.env["VIBECDR_MCP_INSTALL_MANIFEST_PATH"] = previous.manifest;
      process.env["VIBECDR_MCP_INSECURE_SECRET_STORE_PATH"] = previous.secret;
      process.env["VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE"] = previous.insecureSecretStoreEnabled;
    }
    const file = JSON.parse(await readFile(env.VIBECDR_MCP_INSECURE_SECRET_STORE_PATH, "utf8")) as Record<string, unknown>;
    assert.deepEqual(file, {});
  } finally {
    await mock.close();
  }
});

test("CLI install smoke covers Codex, Cursor, VS Code, Windsurf, and Claude Desktop adapters", async () => {
  const temp = await mkdtemp(join(tmpdir(), "vibecodr-cli-install-e2e-"));
  const env = {
    VIBECDR_MCP_CONFIG_PATH: join(temp, "config.json"),
    VIBECDR_MCP_INSTALL_MANIFEST_PATH: join(temp, "installs.json")
  };

  const codexRoot = join(temp, "codex-user");
  const codex = await runCli(["install", "codex", "--path", codexRoot, "--json"], env);
  assert.equal(codex.code, 0, `codex install failed\nstdout:\n${codex.stdout}\nstderr:\n${codex.stderr}`);
  const codexConfig = await readFile(join(codexRoot, "config.toml"), "utf8");
  assert.match(codexConfig, /\[mcp_servers\.vibecodr\]/);
  assert.match(codexConfig, /url = "https:\/\/openai\.vibecodr\.space\/mcp"/);

  const cursorRoot = join(temp, "cursor-project");
  const cursor = await runCli(["install", "cursor", "--scope", "project", "--path", cursorRoot, "--json"], env);
  assert.equal(cursor.code, 0, `cursor install failed\nstdout:\n${cursor.stdout}\nstderr:\n${cursor.stderr}`);
  const cursorConfig = JSON.parse(await readFile(join(cursorRoot, ".cursor", "mcp.json"), "utf8")) as { mcpServers: Record<string, { url: string; type?: string }> };
  assert.equal(cursorConfig.mcpServers["vibecodr"]?.url, "https://openai.vibecodr.space/mcp");
  assert.equal("type" in (cursorConfig.mcpServers["vibecodr"] ?? {}), false);

  const vscodeRoot = join(temp, "vscode-project");
  const vscode = await runCli(["install", "vscode", "--scope", "project", "--path", vscodeRoot, "--json"], env);
  assert.equal(vscode.code, 0, `vscode install failed\nstdout:\n${vscode.stdout}\nstderr:\n${vscode.stderr}`);
  const vscodeConfig = JSON.parse(await readFile(join(vscodeRoot, ".vscode", "mcp.json"), "utf8")) as { servers: Record<string, { url: string }> };
  assert.equal(vscodeConfig.servers["vibecodr"]?.url, "https://openai.vibecodr.space/mcp");

  const windsurfRoot = join(temp, "windsurf-user");
  const windsurf = await runCli(["install", "windsurf", "--scope", "user", "--path", windsurfRoot, "--json"], env);
  assert.equal(windsurf.code, 0, `windsurf install failed\nstdout:\n${windsurf.stdout}\nstderr:\n${windsurf.stderr}`);
  const windsurfConfig = JSON.parse(await readFile(join(windsurfRoot, "mcp_config.json"), "utf8")) as { mcpServers: Record<string, { serverUrl: string }> };
  assert.equal(windsurfConfig.mcpServers["vibecodr"]?.serverUrl, "https://openai.vibecodr.space/mcp");

  const claudeDesktopRoot = join(temp, "claude-desktop-user");
  const claudeDesktop = await runCli(["install", "claude-desktop", "--scope", "user", "--path", claudeDesktopRoot, "--json"], env);
  assert.equal(claudeDesktop.code, 0, `claude-desktop install failed\nstdout:\n${claudeDesktop.stdout}\nstderr:\n${claudeDesktop.stderr}`);
  const claudeDesktopConfig = JSON.parse(await readFile(join(claudeDesktopRoot, "claude_desktop_config.json"), "utf8")) as { mcpServers: Record<string, { command: string; args: string[]; url?: string }> };
  assert.equal(claudeDesktopConfig.mcpServers["vibecodr"]?.command, "npx");
  assert.deepEqual(claudeDesktopConfig.mcpServers["vibecodr"]?.args, ["mcp-remote", "https://openai.vibecodr.space/mcp"]);
  assert.equal("url" in (claudeDesktopConfig.mcpServers["vibecodr"] ?? {}), false);
});
