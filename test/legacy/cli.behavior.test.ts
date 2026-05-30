import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { meRoute, runWithMockApi, type RecordedRequest } from "./helpers.js";
import { CLI_VERSION } from "../../src/legacy/core/version.js";

const token = ["vc", "test", "token", "1234567890"].join("_");
const fakeSecret = (...parts: string[]) => parts.join("_");
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("help and version identify the separate vc-tools CLI", async () => {
  const help = await runWithMockApi(["--help"]);
  try {
    assert.equal(help.code, 0);
    assert.match(help.stdout, new RegExp(`vibecodr ${escapeRegex(CLI_VERSION)}`));
    assert.match(help.stdout, /hosted Vibecodr Agent Computer for agents/);
    assert.match(help.stdout, /https:\/\/vibecodr\.space\/docs\/vc-tools/);
    assert.match(help.stdout, /https:\/\/vibecodr\.space\/vc-tools/);
    assert.match(help.stdout, /start\s+Connect and verify the Agent Computer/);
    assert.match(help.stdout, /try\s+Run a small browser, computer, proof, and usage check/);
    assert.match(help.stdout, /computer\s+Start\/status\/run commands/);
    assert.match(help.stdout, /browser\s+Capture, read, render, crawl, or inspect public HTTPS pages/);
    assert.match(help.stdout, /limits\s+Alias for usage/);
    assert.match(help.stdout, /auth, login, logout/);
    assert.match(help.stdout, /--credential-file <path>/);
    assert.doesNotMatch(help.stdout, /--profile/);
    assert.doesNotMatch(help.stdout, /--api-key-file/);
  } finally {
    await help.cleanup();
  }

  const version = await runWithMockApi(["--version", "--json"]);
  try {
    assert.equal(version.code, 0);
    assert.equal(JSON.parse(version.stdout).data.version, CLI_VERSION);
  } finally {
    await version.cleanup();
  }
});

test("subcommand help, quiet mode, and suggestions follow CLI conventions", async () => {
  const toolsHelp = await runWithMockApi(["tools", "test", "--help"]);
  try {
    assert.equal(toolsHelp.code, 0);
    assert.match(toolsHelp.stdout, /vibecodr tools test/);
    assert.match(toolsHelp.stdout, /browser\.render/);
  } finally {
    await toolsHelp.cleanup();
  }

  const helpSubcommand = await runWithMockApi(["help", "jobs"]);
  try {
    assert.equal(helpSubcommand.code, 0);
    assert.match(helpSubcommand.stdout, /vibecodr jobs/);
    assert.match(helpSubcommand.stdout, /jobs cancel <jobId> --yes/);
  } finally {
    await helpSubcommand.cleanup();
  }

  const limitsHelp = await runWithMockApi(["help", "limits"]);
  try {
    assert.equal(limitsHelp.code, 0);
    assert.match(limitsHelp.stdout, /Alias for vibecodr usage/);
  } finally {
    await limitsHelp.cleanup();
  }

  const whoamiHelp = await runWithMockApi(["help", "whoami"]);
  try {
    assert.equal(whoamiHelp.code, 0);
    assert.match(whoamiHelp.stdout, /vibecodr whoami/);
    assert.match(whoamiHelp.stdout, /Vibecodr account and plan/);
  } finally {
    await whoamiHelp.cleanup();
  }

  const browserHelp = await runWithMockApi(["help", "browser"]);
  try {
    assert.equal(browserHelp.code, 0);
    assert.match(browserHelp.stdout, /browser crawl <https-url> \[--max-pages n\] \[--max-depth n\] \[--local\|--out \.\/proof\]/);
    assert.match(browserHelp.stdout, /browser snapshot <https-url> \[--local\|--out \.\/proof\]/);
    assert.doesNotMatch(browserHelp.stdout, /browser snapshot <https-url> .*instructions/);
    assert.match(browserHelp.stdout, /browser notes <https-url> --note <text> \[--local\|--out \.\/proof\]/);
    assert.doesNotMatch(browserHelp.stdout, /browser ask <https-url>/);
    assert.match(browserHelp.stdout, /Add --local to save completed output into \.\/vibecodr-proof automatically/);
    assert.match(browserHelp.stdout, /browser snapshot captures page state; it does not prompt an agent or model/);
    assert.match(browserHelp.stdout, /browser notes saves your note with the snapshot/);
    assert.doesNotMatch(browserHelp.stdout, /chat/);
  } finally {
    await browserHelp.cleanup();
  }

  const computerHelp = await runWithMockApi(["help", "computer"]);
  try {
    assert.equal(computerHelp.code, 0);
    assert.match(computerHelp.stdout, /computer run "<command>".*\[--local\|--out \.\/proof\]/);
  } finally {
    await computerHelp.cleanup();
  }

  const workHelp = await runWithMockApi(["help", "work"]);
  try {
    assert.equal(workHelp.code, 0);
    assert.match(workHelp.stdout, /work follow <jobId> \[--local\|--out \.\/proof\]/);
  } finally {
    await workHelp.cleanup();
  }

  const authHelp = await runWithMockApi(["help", "auth"]);
  try {
    assert.equal(authHelp.code, 0);
    assert.match(authHelp.stdout, /vibecodr auth diagnose/);
    assert.match(authHelp.stdout, /export-agent-env/);
  } finally {
    await authHelp.cleanup();
  }

  const artifactsHelp = await runWithMockApi(["help", "artifacts"]);
  try {
    assert.equal(artifactsHelp.code, 0);
    assert.match(artifactsHelp.stdout, /vibecodr artifacts pull <artifactId> \[--out <dir\|file>\] \[--filename <name>\] \[--overwrite\]/);
    assert.match(artifactsHelp.stdout, /vibecodr artifacts delete <artifactId> --yes/);
    assert.match(artifactsHelp.stdout, /inside the current workspace/);
  } finally {
    await artifactsHelp.cleanup();
  }

  const suggestedCommand = await runWithMockApi(["stats"]);
  try {
    assert.equal(suggestedCommand.code, 2);
    assert.match(suggestedCommand.stderr, /Did you mean "vibecodr status"/);
  } finally {
    await suggestedCommand.cleanup();
  }

  const suggestedSubcommand = await runWithMockApi(["--token", token, "jobs", "stats"]);
  try {
    assert.equal(suggestedSubcommand.code, 2);
    assert.match(suggestedSubcommand.stderr, /Did you mean "vibecodr jobs status"/);
    assert.equal(suggestedSubcommand.requests.length, 0);
  } finally {
    await suggestedSubcommand.cleanup();
  }

  const quiet = await runWithMockApi(["--quiet", "plans"]);
  try {
    assert.equal(quiet.code, 0);
    assert.equal(quiet.stdout, "");
  } finally {
    await quiet.cleanup();
  }

  const jsonQuiet = await runWithMockApi(["--quiet", "--json", "plans"]);
  try {
    assert.equal(jsonQuiet.code, 0);
    assert.equal(JSON.parse(jsonQuiet.stdout).ok, true);
  } finally {
    await jsonQuiet.cleanup();
  }
});

test("login verifies token, stores credentials, and redacts JSON diagnostics", async () => {
  const result = await runWithMockApi(["--json", "login", "--token", token], [meRoute()]);
  try {
    assert.equal(result.code, 0);
    assert.equal(result.requests[0]?.headers.authorization, `Bearer ${token}`);
    assert.doesNotMatch(result.stdout, new RegExp(token));
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.verified, true);
    const credentials = await readFile(path.join(result.configDir, "credentials.json"), "utf8");
    assert.equal(credentials.includes(token), true);
  } finally {
    await result.cleanup();
  }
});

test("login exchanges a Clerk OAuth token and stores a refreshable local credential", async () => {
  const grantToken = fakeSecret("vc", "grant", "from", "oauth", "1234567890");
  const oauthToken = fakeSecret("oat", "cli", "1234567890");
  const result = await runWithMockApi(["--json", "login", "--credential", oauthToken], [
    {
      method: "POST",
      path: "/auth/cli/exchange",
      response: (request: RecordedRequest) => ({
        token_type: "Bearer",
        access_token: grantToken,
        expires_at: 1_800_000_000,
        user_id: "user_cli",
        credential_type: "oauth_access_token",
        grant_profile: "vc_tools",
        scopes: ["vc-tools:use", "vc-tools:*"],
        echo: request.body
      })
    },
    meRoute()
  ]);
  try {
    assert.equal(result.code, 0);
    assert.equal(result.requests[0]?.headers.authorization, undefined);
    assert.deepEqual(result.requests[0]?.body, {
      access_token: oauthToken,
      grant_profile: "vc_tools"
    });
    assert.equal(result.requests[1]?.headers.authorization, `Bearer ${grantToken}`);
    assert.doesNotMatch(result.stdout, new RegExp(oauthToken));
    assert.doesNotMatch(result.stdout, new RegExp(grantToken));
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.authMode, "oauth");
    assert.equal(body.data.grantProfile, "vc_tools");
    assert.equal(body.data.storedAuth.kind, "durable");
    assert.equal(body.data.storedAuth.mode, "oauth");
    const credentials = await readFile(path.join(result.configDir, "credentials.json"), "utf8");
    assert.equal(credentials.includes(grantToken), true);
    assert.equal(credentials.includes(oauthToken), true);
  } finally {
    await result.cleanup();
  }
});

test("login stores a scoped Clerk API key as the durable local credential", async () => {
  const grantToken = fakeSecret("vc", "grant", "from", "api", "key", "1234567890");
  const apiKey = fakeSecret("ak", "live", "cli", "1234567890");
  const result = await runWithMockApi(["--json", "login", "--credential", apiKey], [
    {
      method: "POST",
      path: "/auth/cli/exchange",
      response: (request: RecordedRequest) => ({
        token_type: "Bearer",
        access_token: grantToken,
        expires_at: 1_800_000_000,
        user_id: "user_cli",
        credential_type: "clerk_api_key",
        grant_profile: "vc_tools",
        scopes: ["vc-tools:use", "vc-tools:browser.render_url"],
        echo: request.body
      })
    },
    meRoute()
  ]);
  try {
    assert.equal(result.code, 0);
    assert.deepEqual(result.requests[0]?.body, {
      api_key: apiKey,
      grant_profile: "vc_tools"
    });
    assert.equal(result.requests[1]?.headers.authorization, `Bearer ${grantToken}`);
    assert.doesNotMatch(result.stdout, new RegExp(apiKey));
    assert.doesNotMatch(result.stderr, new RegExp(apiKey));
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.authMode, "api_key");
    assert.equal(body.data.storedAuth.kind, "durable");
    assert.equal(body.data.storedAuth.mode, "api_key");
    assert.deepEqual(body.data.grantScopes, ["vc-tools:use", "vc-tools:browser.render_url"]);
    const credentials = await readFile(path.join(result.configDir, "credentials.json"), "utf8");
    assert.equal(credentials.includes(grantToken), true);
    assert.equal(credentials.includes(apiKey), true);
  } finally {
    await result.cleanup();
  }
});

test("stored API key refreshes an expired vc-tools grant before account calls", async () => {
  const apiKey = fakeSecret("ak", "live", "refresh", "1234567890");
  const staleGrant = fakeSecret("vc", "grant", "stale", "1234567890");
  const freshGrant = fakeSecret("vc", "grant", "fresh", "1234567890");
  const login = await runWithMockApi(["--json", "login", "--credential", apiKey], [
    {
      method: "POST",
      path: "/auth/cli/exchange",
      response: {
        token_type: "Bearer",
        access_token: staleGrant,
        expires_at: Math.floor(Date.now() / 1000) - 10,
        user_id: "user_cli",
        credential_type: "clerk_api_key",
        grant_profile: "vc_tools",
        scopes: ["vc-tools:use", "vc-tools:*"]
      }
    },
    meRoute()
  ]);
  try {
    assert.equal(login.code, 0);
    const refreshed = await runWithMockApi(["--json", "whoami"], [
      {
        method: "POST",
        path: "/auth/cli/exchange",
        response: (request: RecordedRequest) => ({
          token_type: "Bearer",
          access_token: freshGrant,
          expires_at: Math.floor(Date.now() / 1000) + 900,
          user_id: "user_cli",
          credential_type: "clerk_api_key",
          grant_profile: "vc_tools",
          scopes: ["vc-tools:use", "vc-tools:*"],
          body: request.body
        })
      },
      meRoute()
    ], { env: { VC_TOOLS_CONFIG_DIR: login.configDir } });
    try {
      assert.equal(refreshed.code, 0);
      assert.deepEqual(refreshed.requests[0]?.body, {
        api_key: apiKey,
        grant_profile: "vc_tools"
      });
      assert.equal(refreshed.requests[1]?.headers.authorization, `Bearer ${freshGrant}`);
      assert.doesNotMatch(refreshed.stdout, new RegExp(apiKey));
      assert.doesNotMatch(refreshed.stdout, new RegExp(freshGrant));
    } finally {
      await refreshed.cleanup();
    }
  } finally {
    await login.cleanup();
  }
});

test("login starts browser/device auth when no credential is provided", async () => {
  const deviceCode = "vctd_device_secret_1234567890";
  const grantToken = fakeSecret("vc", "grant", "from", "browser", "device", "1234567890");
  let polls = 0;
  const result = await runWithMockApi(["--json", "login"], [
    {
      method: "POST",
      path: "/auth/vc-tools/device/start",
      response: (request: RecordedRequest) => ({
        device_code: deviceCode,
        user_code: "ABCD-EFGH",
        verification_uri: "https://vibecodr.space/settings/vc-tools/approve",
        verification_uri_complete: "https://vibecodr.space/settings/vc-tools/approve?vc_tools_code=ABCD-EFGH",
        expires_at: Math.floor(Date.now() / 1000) + 600,
        interval: 0,
        echo: request.body
      })
    },
    {
      method: "POST",
      path: "/auth/vc-tools/device/token",
      response: (request: RecordedRequest) => {
        polls += 1;
        assert.deepEqual(request.body, { device_code: deviceCode });
        if (polls === 1) {
          return {
            status: "authorization_pending",
            interval: 0,
            message: "Waiting for browser approval."
          };
        }
        return {
          token_type: "Bearer",
          access_token: grantToken,
          expires_at: 1_800_000_000,
          user_id: "user_cli",
          credential_type: "browser_device",
          grant_profile: "vc_tools",
          scopes: ["vc-tools:use", "vc-tools:*"],
          durable_credential: {
            type: "api_key",
            id: "ak_device_1",
            name: "vc-tools Agent Computer",
            expires_at: 1_800_000_000,
            api_key: fakeSecret("ak", "live", "device", "1234567890")
          }
        };
      }
    },
    meRoute()
  ], { env: { VC_TOOLS_BROWSER_OPEN: "false" } });
  try {
    assert.equal(result.code, 0);
    assert.equal(result.requests[0]?.body && (result.requests[0].body as { client_name?: string }).client_name, "vc-tools");
    assert.equal(result.requests[1]?.body && (result.requests[1].body as { device_code?: string }).device_code, deviceCode);
    assert.equal(result.requests[3]?.headers.authorization, `Bearer ${grantToken}`);
    assert.doesNotMatch(result.stdout, new RegExp(deviceCode));
    assert.doesNotMatch(result.stdout, new RegExp(grantToken));
    assert.doesNotMatch(result.stderr, new RegExp(deviceCode));
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.authMode, "browser_device");
    assert.equal(body.data.storedAuth.kind, "durable");
    assert.equal(body.data.storedAuth.mode, "api_key");
    assert.equal(body.data.browserLogin.userCode, "ABCD-EFGH");
    assert.equal(body.data.browserLogin.openedBrowser, false);
    const credentials = await readFile(path.join(result.configDir, "credentials.json"), "utf8");
    assert.equal(credentials.includes(grantToken), true);
    assert.equal(credentials.includes(fakeSecret("ak", "live", "device", "1234567890")), true);
    assert.equal(credentials.includes(deviceCode), false);
  } finally {
    await result.cleanup();
  }
});

test("start recovers from an unreadable stored approval and opens the normal browser login path", async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "vc-tools-bad-auth-"));
  const grantToken = fakeSecret("vc", "grant", "from", "recovered", "start", "1234567890");
  const apiKey = fakeSecret("ak", "live", "recovered", "start", "1234567890");
  await writeFile(path.join(configDir, "credentials.json"), "not-json");

  const result = await runWithMockApi(["--json", "start", "--client", "codex"], [
    {
      method: "POST",
      path: "/auth/vc-tools/device/start",
      response: {
        device_code: "vctd_recovered_device_secret_1234567890",
        user_code: "RCVR-1234",
        verification_uri: "https://vibecodr.space/settings/vc-tools/approve",
        verification_uri_complete: "https://vibecodr.space/settings/vc-tools/approve?vc_tools_code=RCVR-1234",
        expires_at: Math.floor(Date.now() / 1000) + 600,
        interval: 0
      }
    },
    {
      method: "POST",
      path: "/auth/vc-tools/device/token",
      response: {
        token_type: "Bearer",
        access_token: grantToken,
        expires_at: 1_800_000_000,
        user_id: "user_cli",
        credential_type: "browser_device",
        grant_profile: "vc_tools",
        scopes: ["vc-tools:use", "vc-tools:*"],
        durable_credential: {
          type: "api_key",
          id: "ak_device_1",
          name: "vc-tools Agent Computer",
          expires_at: 1_800_000_000,
          api_key: apiKey
        }
      }
    },
    meRoute(),
    { method: "GET", path: "/v1/health", response: { ok: true, service: "vc-tools-api" } },
    { method: "GET", path: "/v1/mcp/connection", response: { client: "codex", url: "https://tools.vibecodr.space/mcp" } },
    { method: "GET", path: "/v1/usage", response: { plan: "Pro" } }
  ], { env: { VC_TOOLS_CONFIG_DIR: configDir, VC_TOOLS_BROWSER_OPEN: "false" } });

  try {
    assert.equal(result.code, 0);
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.ready, true);
    assert.equal(body.data.loginStarted, true);
    assert.equal(result.requests[0]?.method, "POST");
    assert.equal(new URL(result.requests[0]?.url ?? "").pathname, "/auth/vc-tools/device/start");
    const credentials = await readFile(path.join(configDir, "credentials.json"), "utf8");
    assert.equal(credentials.includes(grantToken), true);
    assert.equal(credentials.includes(apiKey), true);
    assert.doesNotMatch(result.stderr, new RegExp(grantToken));
    assert.doesNotMatch(result.stderr, new RegExp(apiKey));
  } finally {
    await result.cleanup();
    await rm(configDir, { recursive: true, force: true });
  }
});

test("cost-bearing browser commands treat unreadable stored approval as missing auth", async () => {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "vc-tools-bad-auth-"));
  await writeFile(path.join(configDir, "credentials.json"), "not-json");

  const result = await runWithMockApi([
    "--json",
    "browser",
    "screenshot",
    "https://example.com",
    "--format",
    "png"
  ], [], { env: { VC_TOOLS_CONFIG_DIR: configDir } });

  try {
    assert.equal(result.code, 3);
    assert.equal(result.requests.length, 0);
    const body = JSON.parse(result.stderr);
    assert.equal(body.error.code, "auth.missing");
    assert.match(body.error.message, /Run vibecodr start/);
  } finally {
    await result.cleanup();
    await rm(configDir, { recursive: true, force: true });
  }
});

test("login --no-input refuses browser auth without making network calls", async () => {
  const result = await runWithMockApi(["--json", "--no-input", "login"]);
  try {
    assert.equal(result.code, 3);
    assert.equal(result.requests.length, 0);
    const body = JSON.parse(result.stderr);
    assert.match(body.error.message, /Browser login needs interactive approval/);
    assert.match(body.error.message, /--credential-stdin/);
  } finally {
    await result.cleanup();
  }
});

test("generic login credentials must be recognizable before network calls", async () => {
  const result = await runWithMockApi(["--json", "login", "--credential", "not-a-vc-tools-credential"]);
  try {
    assert.equal(result.code, 2);
    assert.equal(result.requests.length, 0);
    assert.match(result.stderr, /auth\.credential_type_unknown/);
  } finally {
    await result.cleanup();
  }
});

test("credential-type-specific login flags are rejected with a generic credential hint", async () => {
  const result = await runWithMockApi(["--json", "login", "--api-key", fakeSecret("ak", "live", "old", "1234567890")]);
  try {
    assert.equal(result.code, 2);
    assert.equal(result.requests.length, 0);
    assert.match(result.stderr, /input\.unsupported_credential_flag/);
    assert.match(result.stderr, /--credential-file/);
  } finally {
    await result.cleanup();
  }
});

test("login accepts secure credential file and stdin sources", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "vc-tools-credential-source-"));
  try {
    const apiKey = fakeSecret("ak", "live", "file", "1234567890");
    const apiKeyFile = path.join(cwd, "credential.txt");
    const grantFromFile = fakeSecret("vc", "grant", "from", "file", "1234567890");
    await writeFile(apiKeyFile, `${apiKey}\n`);

    const fileResult = await runWithMockApi(["--json", "login", "--credential-file", "credential.txt"], [
      {
        method: "POST",
        path: "/auth/cli/exchange",
        response: (request: RecordedRequest) => ({
          token_type: "Bearer",
          access_token: grantFromFile,
          expires_at: 1_800_000_000,
          user_id: "user_cli",
          grant_profile: "vc_tools",
          scopes: ["vc-tools:use"],
          echo: request.body
        })
      },
      meRoute()
    ], { cwd });
    try {
      assert.equal(fileResult.code, 0);
      assert.deepEqual(fileResult.requests[0]?.body, {
        api_key: apiKey,
        grant_profile: "vc_tools"
      });
      assert.doesNotMatch(fileResult.stdout, new RegExp(apiKey));
      const credentials = await readFile(path.join(fileResult.configDir, "credentials.json"), "utf8");
      assert.equal(credentials.includes(grantFromFile), true);
      assert.equal(credentials.includes(apiKey), true);
    } finally {
      await fileResult.cleanup();
    }

    const oauthToken = fakeSecret("oat", "stdin", "1234567890");
    const grantFromStdin = fakeSecret("vc", "grant", "from", "stdin", "1234567890");
    const stdinResult = await runWithMockApi(["--json", "login", "--credential-stdin"], [
      {
        method: "POST",
        path: "/auth/cli/exchange",
        response: (request: RecordedRequest) => ({
          token_type: "Bearer",
          access_token: grantFromStdin,
          expires_at: 1_800_000_000,
          user_id: "user_cli",
          grant_profile: "vc_tools",
          scopes: ["vc-tools:use"],
          echo: request.body
        })
      },
      meRoute()
    ], { cwd, stdin: oauthToken });
    try {
      assert.equal(stdinResult.code, 0);
      assert.deepEqual(stdinResult.requests[0]?.body, {
        access_token: oauthToken,
        grant_profile: "vc_tools"
      });
      assert.doesNotMatch(stdinResult.stdout, new RegExp(oauthToken));
      const credentials = await readFile(path.join(stdinResult.configDir, "credentials.json"), "utf8");
      assert.equal(credentials.includes(grantFromStdin), true);
      assert.equal(credentials.includes(oauthToken), true);
    } finally {
      await stdinResult.cleanup();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("env credentials can authenticate one-off commands through the exchange without being stored", async () => {
  const apiKey = fakeSecret("ak", "live", "env", "1234567890");
  const grantToken = fakeSecret("vc", "grant", "env", "1234567890");
  const result = await runWithMockApi(["--json", "tools", "list"], [
    {
      method: "POST",
      path: "/auth/cli/exchange",
      response: {
        token_type: "Bearer",
        access_token: grantToken,
        expires_at: 1_800_000_000,
        user_id: "user_cli",
        grant_profile: "vc_tools",
        scopes: ["vc-tools:use", "vc-tools:*"]
      }
    },
    { method: "GET", path: "/v1/tools", response: { tools: [] } }
  ], {
    env: { VC_TOOLS_CREDENTIAL: apiKey }
  });
  try {
    assert.equal(result.code, 0);
    assert.deepEqual(result.requests[0]?.body, {
      api_key: apiKey,
      grant_profile: "vc_tools"
    });
    assert.equal(result.requests[1]?.headers.authorization, `Bearer ${grantToken}`);
    await assert.rejects(readFile(path.join(result.configDir, "credentials.json"), "utf8"));
  } finally {
    await result.cleanup();
  }
});

test("generic env credential files can authenticate one-off commands without storing raw secrets", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "vc-tools-env-credential-file-"));
  try {
    const apiKey = fakeSecret("ak", "live", "env", "file", "1234567890");
    const apiKeyFile = path.join(cwd, "api-key.txt");
    const grantToken = fakeSecret("vc", "grant", "env", "file", "1234567890");
    await writeFile(apiKeyFile, apiKey);

    const result = await runWithMockApi(["--json", "tools", "list"], [
      {
        method: "POST",
        path: "/auth/cli/exchange",
        response: {
          token_type: "Bearer",
          access_token: grantToken,
          expires_at: 1_800_000_000,
          user_id: "user_cli",
          grant_profile: "vc_tools",
          scopes: ["vc-tools:use", "vc-tools:*"]
        }
      },
      { method: "GET", path: "/v1/tools", response: { tools: [] } }
    ], {
      cwd,
      env: { VC_TOOLS_CREDENTIAL_FILE: apiKeyFile }
    });
    try {
      assert.equal(result.code, 0);
      assert.deepEqual(result.requests[0]?.body, {
        api_key: apiKey,
        grant_profile: "vc_tools"
      });
      assert.equal(result.requests[1]?.headers.authorization, `Bearer ${grantToken}`);
      await assert.rejects(readFile(path.join(result.configDir, "credentials.json"), "utf8"));
    } finally {
      await result.cleanup();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("login rejects ambiguous credential sources before network calls", async () => {
  const result = await runWithMockApi([
    "--json",
    "--token",
    token,
    "login",
    "--credential",
    fakeSecret("ak", "live", "cli", "1234567890")
  ]);
  try {
    assert.equal(result.code, 3);
    assert.equal(result.requests.length, 0);
    assert.match(result.stderr, /auth\.ambiguous_credentials/);
  } finally {
    await result.cleanup();
  }
});

test("stored tokens are not sent to insecure local API URLs unless explicitly allowed", async () => {
  const denied = await runWithMockApi(["--json", "login", "--token", token], [meRoute()], {
    allowInsecureLocalApi: false
  });
  try {
    assert.equal(denied.code, 5);
    assert.equal(denied.requests.length, 0);
    assert.match(denied.stderr, /config\.insecure_local_api_denied/);
  } finally {
    await denied.cleanup();
  }

  const allowed = await runWithMockApi(["--json", "--allow-insecure-local-api", "login", "--token", token], [meRoute()], {
    allowInsecureLocalApi: false
  });
  try {
    assert.equal(allowed.code, 0);
    assert.equal(allowed.requests[0]?.headers.authorization, `Bearer ${token}`);
  } finally {
    await allowed.cleanup();
  }
});

test("tools test validates browser URLs before remote calls", async () => {
  const result = await runWithMockApi([
    "--json",
    "--token",
    token,
    "tools",
    "test",
    "browser.render",
    "https://127.0.0.1"
  ]);
  try {
    assert.equal(result.code, 2);
    assert.equal(result.requests.length, 0);
    assert.match(result.stderr, /private, loopback/);
  } finally {
    await result.cleanup();
  }
});

test("tools test submits canonical browser capability payloads", async () => {
  const result = await runWithMockApi([
    "--json",
    "--token",
    token,
    "tools",
    "test",
    "browser.markdown",
    "https://example.com"
  ], [
    {
      method: "POST",
      path: "/v1/tools/test",
      response: (request: RecordedRequest) => ({ jobId: "job_123", echo: request.body })
    }
  ]);
  try {
    assert.equal(result.code, 0);
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.jobId, "job_123");
    assert.deepEqual(body.data.echo, {
      capability: "browser.extract_markdown",
      input: {
        url: "https://example.com/"
      }
    });
  } finally {
    await result.cleanup();
  }
});

test("tools test keeps Quick Actions short while allowing paid agent task payloads", async () => {
  const deniedQuickAction = await runWithMockApi([
    "--json",
    "--token",
    token,
    "tools",
    "test",
    "browser.render",
    "https://example.com",
    "--timeout-ms",
    "3600000"
  ]);
  try {
    assert.equal(deniedQuickAction.code, 2);
    assert.equal(deniedQuickAction.requests.length, 0);
    assert.match(deniedQuickAction.stderr, /--timeout-ms/);
  } finally {
    await deniedQuickAction.cleanup();
  }

  const agentTask = await runWithMockApi([
    "--json",
    "--token",
    token,
    "tools",
    "test",
    "browser.agent",
    "https://example.com",
    "--timeout-ms",
    "3600000",
    "--idle-timeout-ms",
    "600000",
    "--instructions",
    "Inspect the public page and save a short snapshot."
  ], [
    {
      method: "POST",
      path: "/v1/tools/test",
      response: (request: RecordedRequest) => ({ jobId: "job_agent", echo: request.body })
    }
  ]);
  try {
    assert.equal(agentTask.code, 0);
    const body = JSON.parse(agentTask.stdout);
    assert.deepEqual(body.data.echo, {
      capability: "browser.agent_task",
      input: {
        url: "https://example.com/",
        instructions: "Inspect the public page and save a short snapshot.",
        idleTimeoutMs: 600000,
        timeoutMs: 3600000
      }
    });
  } finally {
    await agentTask.cleanup();
  }
});

test("browser snapshot stays a no-prompt capture command", async () => {
  const snapshot = await runWithMockApi([
    "--json",
    "--token",
    token,
    "browser",
    "snapshot",
    "https://example.com",
    "--no-wait"
  ], [
    {
      method: "POST",
      path: "/v1/tools/test",
      response: (request: RecordedRequest) => ({ jobId: "job_snapshot", echo: request.body })
    }
  ]);
  try {
    assert.equal(snapshot.code, 0);
    const body = JSON.parse(snapshot.stdout);
    assert.deepEqual(body.data.echo, {
      capability: "browser.agent_task",
      input: {
        url: "https://example.com/"
      }
    });
  } finally {
    await snapshot.cleanup();
  }

  const withInstructions = await runWithMockApi([
    "--json",
    "--token",
    token,
    "browser",
    "snapshot",
    "https://example.com",
    "--instructions",
    "Summarize this."
  ]);
  try {
    assert.equal(withInstructions.code, 2);
    assert.equal(withInstructions.requests.length, 0);
    assert.match(withInstructions.stderr, /browser snapshot captures the page state; it does not prompt an agent or model/);
  } finally {
    await withInstructions.cleanup();
  }

  const notes = await runWithMockApi([
    "--json",
    "--token",
    token,
    "browser",
    "notes",
    "https://example.com",
    "--note",
    "Save this note with the snapshot.",
    "--no-wait"
  ], [
    {
      method: "POST",
      path: "/v1/tools/test",
      response: (request: RecordedRequest) => ({ jobId: "job_notes", echo: request.body })
    }
  ]);
  try {
    assert.equal(notes.code, 0);
    const body = JSON.parse(notes.stdout);
    assert.deepEqual(body.data.echo, {
      capability: "browser.agent_task",
      input: {
        url: "https://example.com/",
        instructions: "Save this note with the snapshot."
      }
    });
  } finally {
    await notes.cleanup();
  }

  const oldAskAlias = await runWithMockApi([
    "--json",
    "--token",
    token,
    "browser",
    "ask",
    "https://example.com",
    "--note",
    "Save this note with the snapshot.",
    "--no-wait"
  ], [
    {
      method: "POST",
      path: "/v1/tools/test",
      response: (request: RecordedRequest) => ({ jobId: "job_ask", echo: request.body })
    }
  ]);
  try {
    assert.equal(oldAskAlias.code, 0);
    const body = JSON.parse(oldAskAlias.stdout);
    assert.deepEqual(body.data.echo, {
      capability: "browser.agent_task",
      input: {
        url: "https://example.com/",
        instructions: "Save this note with the snapshot."
      }
    });
  } finally {
    await oldAskAlias.cleanup();
  }
});

test("tools test submits canonical crawl capability payloads", async () => {
  const result = await runWithMockApi([
    "--json",
    "--token",
    token,
    "tools",
    "test",
    "browser.crawl",
    "https://example.com/docs",
    "--max-pages",
    "5",
    "--max-depth",
    "2",
    "--format",
    "markdown",
    "--no-render",
    "--timeout-ms",
    "180000"
  ], [
    {
      method: "POST",
      path: "/v1/tools/test",
      response: (request: RecordedRequest) => ({ jobId: "job_crawl", echo: request.body })
    }
  ]);
  try {
    assert.equal(result.code, 0);
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.jobId, "job_crawl");
    assert.deepEqual(body.data.echo, {
      capability: "browser.crawl_site",
      input: {
        url: "https://example.com/docs",
        maxPages: 5,
        maxDepth: 2,
        render: false,
        format: "markdown",
        timeoutMs: 180000
      }
    });
  } finally {
    await result.cleanup();
  }
});

test("sandbox tests are remote submissions with public HTTP(S) network enabled", async () => {
  const result = await runWithMockApi([
    "--json",
    "--token",
    token,
    "tools",
    "test",
    "sandbox.run",
    "--command",
    "echo should-not-run-locally"
  ], [
    {
      method: "POST",
      path: "/v1/tools/test",
      response: (request: RecordedRequest) => ({ accepted: true, echo: request.body })
    }
  ]);
  try {
    assert.equal(result.code, 0);
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.echo.capability, "sandbox.run_command");
    assert.equal(body.data.echo.input.network, true);
  } finally {
    await result.cleanup();
  }
});

test("agent-computer aliases submit safe hosted work without exposing low-level commands", async () => {
  const screenshot = await runWithMockApi([
    "--json",
    "--token",
    token,
    "browser",
    "screenshot",
    "https://example.com",
    "--format",
    "png"
  ], [
    {
      method: "POST",
      path: "/v1/tools/test",
      response: () => ({ id: "job_screen", status: "queued" })
    },
    {
      method: "GET",
      path: "/v1/jobs/job_screen",
      response: { id: "job_screen", status: "completed", result: { artifactId: "art_screen" } }
    }
  ]);
  try {
    assert.equal(screenshot.code, 0);
    const body = JSON.parse(screenshot.stdout);
    assert.deepEqual(screenshot.requests[0]?.body, {
      capability: "browser.screenshot_url",
      input: {
        url: "https://example.com/",
        format: "png"
      }
    });
    assert.equal(body.data.status, "completed");
    assert.equal(body.data.tool, "browser.screenshot");
    assert.equal(body.data.artifact.id, "art_screen");
    assert.match(body.data.artifact.saveCommand, /vibecodr proof save art_screen --out \.\/vibecodr-proof/);
    assert.doesNotMatch(screenshot.stdout, /job_screen/);
  } finally {
    await screenshot.cleanup();
  }

  const blocked = await runWithMockApi(["--json", "--token", token, "browser", "read", "https://127.0.0.1"]);
  try {
    assert.equal(blocked.code, 2);
    assert.equal(blocked.requests.length, 0);
    assert.match(blocked.stderr, /private, loopback/);
  } finally {
    await blocked.cleanup();
  }

  const computerRun = await runWithMockApi(["--json", "--token", token, "computer", "run", "npm test"], [
    {
      method: "POST",
      path: "/v1/tools/test",
      response: () => ({ id: "job_run", status: "queued" })
    },
    {
      method: "GET",
      path: "/v1/jobs/job_run",
      response: { id: "job_run", status: "completed", result: { artifactId: "art_run" } }
    }
  ]);
  try {
    assert.equal(computerRun.code, 0);
    const body = JSON.parse(computerRun.stdout);
    assert.equal(body.data.status, "completed");
    assert.equal(body.data.tool, "computer.run");
    assert.equal((computerRun.requests[0]?.body as { capability?: string; input?: { command?: string; network?: boolean } }).capability, "sandbox.run_command");
    assert.equal((computerRun.requests[0]?.body as { input?: { command?: string; network?: boolean } }).input?.command, "npm test");
    assert.equal((computerRun.requests[0]?.body as { input?: { command?: string; network?: boolean } }).input?.network, true);
  } finally {
    await computerRun.cleanup();
  }
});

test("agent-computer aliases wait and save proof without requiring artifact ids", async () => {
  const result = await runWithMockApi([
    "--json",
    "--token",
    token,
    "browser",
    "screenshot",
    "https://example.com",
    "--out",
    "proof"
  ], [
    { method: "POST", path: "/v1/tools/test", response: { id: "job_screen", status: "queued" } },
    { method: "GET", path: "/v1/jobs/job_screen", response: { id: "job_screen", status: "completed", result: { artifactId: "art_screen" } } },
    {
      method: "GET",
      path: "/v1/artifacts/art_screen/download",
      response: new Uint8Array([1, 2, 3]),
      headers: {
        "content-type": "image/png",
        "content-disposition": "attachment; filename=\"homepage.png\""
      }
    }
  ]);
  try {
    assert.equal(result.code, 0);
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.status, "completed");
    assert.equal(body.data.artifact.id, "art_screen");
    assert.equal(body.data.proof.artifactId, "art_screen");
    assert.match(body.data.proof.path, /proof/);
    assert.equal(body.data.proof.bytes, 3);
    assert.doesNotMatch(result.stdout, /job_screen/);
    assert.deepEqual([...await readFile(body.data.proof.path)], [1, 2, 3]);
  } finally {
    await result.cleanup();
  }

  const local = await runWithMockApi([
    "--json",
    "--token",
    token,
    "browser",
    "crawl",
    "https://example.com",
    "--local"
  ], [
    { method: "POST", path: "/v1/tools/test", response: { id: "job_crawl", status: "queued" } },
    { method: "GET", path: "/v1/jobs/job_crawl", response: { id: "job_crawl", status: "completed", result: { artifactId: "art_crawl", kind: "crawl-json", bytes: 12, contentType: "application/json; charset=utf-8" } } },
    {
      method: "GET",
      path: "/v1/artifacts/art_crawl/download",
      response: new TextEncoder().encode("{\"ok\":true}"),
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": "attachment; filename=\"crawl.json\""
      }
    }
  ]);
  try {
    assert.equal(local.code, 0);
    const body = JSON.parse(local.stdout);
    assert.equal(body.data.status, "completed");
    assert.equal(body.data.artifact.id, "art_crawl");
    assert.match(body.data.proof.path, /vibecodr-proof/);
    assert.equal(body.data.proof.artifactId, "art_crawl");
    assert.equal(await readFile(body.data.proof.path, "utf8"), "{\"ok\":true}");
  } finally {
    await local.cleanup();
  }

  const localNoWait = await runWithMockApi([
    "--json",
    "--token",
    token,
    "browser",
    "crawl",
    "https://example.com",
    "--local",
    "--no-wait"
  ]);
  try {
    assert.equal(localNoWait.code, 2);
    assert.equal(localNoWait.requests.length, 0);
    assert.match(localNoWait.stderr, /--local saves the completed output/);
  } finally {
    await localNoWait.cleanup();
  }

  const offline = await runWithMockApi([
    "--json",
    "--token",
    token,
    "tools",
    "test",
    "sandbox.run",
    "--command",
    "echo offline",
    "--network",
    "off"
  ], [
    {
      method: "POST",
      path: "/v1/tools/test",
      response: (request: RecordedRequest) => ({ accepted: true, echo: request.body })
    }
  ]);
  try {
    assert.equal(offline.code, 0);
    const body = JSON.parse(offline.stdout);
    assert.equal(body.data.echo.input.network, false);
  } finally {
    await offline.cleanup();
  }

  const invalid = await runWithMockApi([
    "--json",
    "--token",
    token,
    "tools",
    "test",
    "sandbox.run",
    "--command",
    "echo no",
    "--network",
    "private"
  ]);
  try {
    assert.equal(invalid.code, 2);
    assert.equal(invalid.requests.length, 0);
    assert.match(invalid.stderr, /--network must be public or off/);
  } finally {
    await invalid.cleanup();
  }
});

test("work follow polls until terminal and can save proof", async () => {
  let polls = 0;
  const result = await runWithMockApi([
    "--json",
    "--token",
    token,
    "work",
    "follow",
    "job_123",
    "--out",
    "proof",
    "--poll-interval-ms",
    "100"
  ], [
    {
      method: "GET",
      path: "/v1/jobs/job_123",
      response: () => {
        polls += 1;
        return polls === 1
          ? { id: "job_123", status: "running" }
          : { id: "job_123", status: "completed", result: { artifactId: "art_123" } };
      }
    },
    {
      method: "GET",
      path: "/v1/artifacts/art_123/download",
      response: new Uint8Array([4, 5, 6]),
      headers: {
        "content-type": "text/plain",
        "content-disposition": "attachment; filename=\"result.txt\""
      }
    }
  ]);
  try {
    assert.equal(result.code, 0);
    assert.equal(polls, 2);
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.status, "completed");
    assert.equal(body.data.proof.bytes, 3);
    assert.deepEqual([...await readFile(body.data.proof.path)], [4, 5, 6]);
  } finally {
    await result.cleanup();
  }
});

test("browser submits show queued payload with --no-wait and job ids with --details", async () => {
  const queued = await runWithMockApi([
    "--json",
    "--token",
    token,
    "browser",
    "screenshot",
    "https://example.com",
    "--no-wait"
  ], [
    {
      method: "POST",
      path: "/v1/tools/test",
      response: { id: "job_screen", status: "queued", queue: { fairDelaySeconds: 0 } }
    }
  ]);
  try {
    assert.equal(queued.code, 0);
    const body = JSON.parse(queued.stdout);
    assert.equal(body.data.id, "job_screen");
    assert.equal(body.data.status, "queued");
    assert.equal(queued.requests.length, 1);
  } finally {
    await queued.cleanup();
  }

  const detailed = await runWithMockApi([
    "--json",
    "--token",
    token,
    "browser",
    "screenshot",
    "https://example.com",
    "--details"
  ], [
    {
      method: "POST",
      path: "/v1/tools/test",
      response: { id: "job_screen", status: "queued" }
    },
    {
      method: "GET",
      path: "/v1/jobs/job_screen",
      response: { id: "job_screen", status: "completed", result: { artifactId: "art_screen" } }
    }
  ]);
  try {
    assert.equal(detailed.code, 0);
    const body = JSON.parse(detailed.stdout);
    assert.equal(body.data.status, "completed");
    assert.equal(body.data.work?.id, "job_screen");
    assert.equal(body.data.work?.result?.artifactId, "art_screen");
  } finally {
    await detailed.cleanup();
  }
});

test("computer run --wait completes the loop and returns terminal status", async () => {
  let polls = 0;
  const result = await runWithMockApi([
    "--json",
    "--token",
    token,
    "computer",
    "run",
    "node --version",
    "--wait",
    "--poll-interval-ms",
    "100"
  ], [
    {
      method: "POST",
      path: "/v1/tools/test",
      response: { id: "job_run", status: "queued" }
    },
    {
      method: "GET",
      path: "/v1/jobs/job_run",
      response: () => {
        polls += 1;
        return polls === 1
          ? { id: "job_run", status: "running" }
          : { id: "job_run", status: "completed", result: { artifactId: "art_run" } };
      }
    }
  ]);
  try {
    assert.equal(result.code, 0);
    assert.equal(polls, 2);
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.status, "completed");
    assert.equal(body.data.tool, "computer.run");
    assert.equal(body.data.artifact.id, "art_run");
    assert.doesNotMatch(result.stdout, /job_run/);
  } finally {
    await result.cleanup();
  }
});

test("plans default output prints a buying-page bullet list with prices", async () => {
  const result = await runWithMockApi(["plans"]);
  try {
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Vibecodr Agent Computer plans/);
    assert.match(result.stdout, /^Free$/m);
    assert.match(result.stdout, /Creator - \$19\/mo/);
    assert.match(result.stdout, /Pro - \$39\/mo/);
    assert.match(result.stdout, /Public browser checks/);
    assert.match(result.stdout, /Hosted computer runs/);
    assert.match(result.stdout, /monthly credits/);
    assert.match(result.stdout, /proof storage|Saved proof storage/);
    assert.match(result.stdout, /Run vibecodr usage/);
    assert.match(result.stdout, /vibecodr plans --details/);
    assert.doesNotMatch(result.stdout, /providerMode|offeringClassifications|policies|cogs/);
  } finally {
    await result.cleanup();
  }
});

test("agent connect prints copy-paste config snippets when --print is set", async () => {
  const codex = await runWithMockApi(["--token", token, "agent", "connect", "--client", "codex", "--print"], [
    {
      method: "GET",
      path: "/v1/mcp/connection",
      response: {
        transport: "streamable_http",
        url: "https://agent.example.com/mcp",
        tools: [{ name: "browser.screenshot" }, { name: "computer.run" }]
      }
    }
  ]);
  try {
    assert.equal(codex.code, 0);
    assert.match(codex.stdout, /Codex connection ready/);
    assert.match(codex.stdout, /\[mcp_servers\.vc-tools\]/);
    assert.match(codex.stdout, /url = "https:\/\/agent\.example\.com\/mcp"/);
    assert.match(codex.stdout, /restart or open a new Codex session/);
  } finally {
    await codex.cleanup();
  }

  const cursor = await runWithMockApi(["--token", token, "agent", "connect", "--client", "cursor", "--print"], [
    {
      method: "GET",
      path: "/v1/mcp/connection",
      response: {
        transport: "streamable_http",
        url: "https://agent.example.com/mcp",
        tools: []
      }
    }
  ]);
  try {
    assert.equal(cursor.code, 0);
    assert.match(cursor.stdout, /Cursor connection ready/);
    assert.match(cursor.stdout, /"mcpServers"/);
    assert.match(cursor.stdout, /"vc-tools"/);
    assert.match(cursor.stdout, /"url": "https:\/\/agent\.example\.com\/mcp"/);
  } finally {
    await cursor.cleanup();
  }

  const claudeDesktop = await runWithMockApi(["--token", token, "agent", "connect", "--client", "claude-desktop", "--print"], [
    {
      method: "GET",
      path: "/v1/mcp/connection",
      response: {
        transport: "streamable_http",
        url: "https://agent.example.com/mcp",
        tools: []
      }
    }
  ]);
  try {
    assert.equal(claudeDesktop.code, 0);
    assert.match(claudeDesktop.stdout, /Claude Desktop connection ready/);
    assert.match(claudeDesktop.stdout, /"command": "npx"/);
    assert.match(claudeDesktop.stdout, /"mcp-remote"/);
    assert.match(claudeDesktop.stdout, /mcp-remote stdio proxy/);
  } finally {
    await claudeDesktop.cleanup();
  }
});

test("agent connect does not write bare client config for hosted Agent Computer auth", async () => {
  const codex = await runWithMockApi(["--token", token, "agent", "connect", "--client", "codex", "--print"], [
    {
      method: "GET",
      path: "/v1/mcp/connection",
      response: {
        transport: "streamable_http",
        url: "https://tools.vibecodr.space/mcp",
        auth: { type: "oauth_protected_resource", clientInstall: "manual_bearer_required" },
        tools: [{ name: "computer.run" }]
      }
    }
  ]);
  try {
    assert.equal(codex.code, 0);
    assert.match(codex.stdout, /Codex connection ready/);
    assert.match(codex.stdout, /install skipped: tools\.vibecodr\.space\/mcp uses vc-tools grants/);
    assert.doesNotMatch(codex.stdout, /\[mcp_servers\.vc-tools\]/);
  } finally {
    await codex.cleanup();
  }

  const cursorDir = await mkdtemp(path.join(os.tmpdir(), "vc-tools-cursor-guard-"));
  try {
    const cursor = await runWithMockApi([
      "--token", token,
      "agent", "connect", "--client", "cursor",
      "--install-dir", cursorDir
    ], [
      {
        method: "GET",
        path: "/v1/mcp/connection",
        response: {
          transport: "streamable_http",
          url: "https://tools.vibecodr.space/mcp",
          auth: { type: "oauth_protected_resource", clientInstall: "manual_bearer_required" }
        }
      }
    ]);
    try {
      assert.equal(cursor.code, 0);
      assert.match(cursor.stdout, /install skipped: tools\.vibecodr\.space\/mcp uses vc-tools grants/);
      await assert.rejects(readFile(path.join(cursorDir, "mcp.json"), "utf8"));
    } finally {
      await cursor.cleanup();
    }
  } finally {
    await rm(cursorDir, { recursive: true, force: true });
  }
});

test("agent connect installs MCP config into a known client's config file by default", async () => {
  const connectionRoute = {
    method: "GET",
    path: "/v1/mcp/connection",
    response: {
      transport: "streamable_http",
      url: "https://agent.example.com/mcp",
      tools: [{ name: "computer.run" }]
    }
  } as const;

  const cursorDir = await mkdtemp(path.join(os.tmpdir(), "vc-tools-cursor-"));
  try {
    const cursor = await runWithMockApi([
      "--token", token,
      "agent", "connect", "--client", "cursor",
      "--install-dir", cursorDir
    ], [connectionRoute]);
    try {
      assert.equal(cursor.code, 0);
      assert.match(cursor.stdout, /Cursor connection ready/);
      assert.match(cursor.stdout, /Wrote Cursor MCP config/);
      const config = JSON.parse(await readFile(path.join(cursorDir, "mcp.json"), "utf8"));
      assert.equal(config.mcpServers["vc-tools"].url, "https://agent.example.com/mcp");
      assert.equal("type" in config.mcpServers["vc-tools"], false);
    } finally {
      await cursor.cleanup();
    }

    const idempotent = await runWithMockApi([
      "--token", token,
      "agent", "connect", "--client", "cursor",
      "--install-dir", cursorDir
    ], [connectionRoute]);
    try {
      assert.equal(idempotent.code, 0);
      assert.match(idempotent.stdout, /already pointed at this Agent Computer/);
    } finally {
      await idempotent.cleanup();
    }
  } finally {
    await rm(cursorDir, { recursive: true, force: true });
  }

  const windsurfDir = await mkdtemp(path.join(os.tmpdir(), "vc-tools-windsurf-"));
  try {
    const result = await runWithMockApi([
      "--token", token,
      "agent", "connect", "--client", "windsurf",
      "--install-dir", windsurfDir
    ], [connectionRoute]);
    try {
      assert.equal(result.code, 0);
      assert.match(result.stdout, /Wrote Windsurf MCP config/);
      const config = JSON.parse(await readFile(path.join(windsurfDir, "mcp_config.json"), "utf8"));
      assert.equal(config.mcpServers["vc-tools"].serverUrl, "https://agent.example.com/mcp");
    } finally {
      await result.cleanup();
    }
  } finally {
    await rm(windsurfDir, { recursive: true, force: true });
  }

  const claudeDir = await mkdtemp(path.join(os.tmpdir(), "vc-tools-claude-"));
  try {
    const result = await runWithMockApi([
      "--token", token,
      "agent", "connect", "--client", "claude-desktop",
      "--install-dir", claudeDir
    ], [connectionRoute]);
    try {
      assert.equal(result.code, 0);
      assert.match(result.stdout, /Wrote Claude Desktop MCP config/);
      assert.match(result.stdout, /mcp-remote stdio proxy/);
      const config = JSON.parse(await readFile(path.join(claudeDir, "claude_desktop_config.json"), "utf8"));
      assert.equal(config.mcpServers["vc-tools"].command, "npx");
      assert.deepEqual(config.mcpServers["vc-tools"].args, ["mcp-remote", "https://agent.example.com/mcp"]);
      assert.equal("url" in config.mcpServers["vc-tools"], false);
    } finally {
      await result.cleanup();
    }
  } finally {
    await rm(claudeDir, { recursive: true, force: true });
  }
});

test("agent connect install survives a macOS-style path with spaces and missing parent dirs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vc-tools-mac-style-"));
  try {
    // Mirror the macOS Claude Desktop path shape: "<root>/Application Support/Claude" with a
    // missing leaf directory that the installer must create.
    const installDir = path.join(root, "Application Support", "Claude");
    const result = await runWithMockApi([
      "--token", token,
      "agent", "connect", "--client", "claude-desktop",
      "--install-dir", installDir
    ], [
      {
        method: "GET",
        path: "/v1/mcp/connection",
        response: {
          transport: "streamable_http",
          url: "https://agent.example.com/mcp",
          tools: []
        }
      }
    ]);
    try {
      assert.equal(result.code, 0);
      assert.match(result.stdout, /Wrote Claude Desktop MCP config/);
      const written = path.join(installDir, "claude_desktop_config.json");
      await access(written);
      const config = JSON.parse(await readFile(written, "utf8"));
      assert.equal(config.mcpServers["vc-tools"].command, "npx");
      assert.deepEqual(config.mcpServers["vc-tools"].args, ["mcp-remote", "https://agent.example.com/mcp"]);
    } finally {
      await result.cleanup();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("agent connect refuses to overwrite differing MCP config without --overwrite", async () => {
  const cursorDir = await mkdtemp(path.join(os.tmpdir(), "vc-tools-cursor-conflict-"));
  try {
    await writeFile(
      path.join(cursorDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "vc-tools": { type: "http", url: "https://other.example.com/mcp" },
          "other-server": { type: "http", url: "https://keep.example.com/mcp" }
        }
      }, null, 2),
      "utf8"
    );

    const connectionRoute = {
      method: "GET" as const,
      path: "/v1/mcp/connection",
      response: {
        transport: "streamable_http",
        url: "https://agent.example.com/mcp"
      }
    };

    const conflict = await runWithMockApi([
      "--token", token,
      "agent", "connect", "--client", "cursor",
      "--install-dir", cursorDir
    ], [connectionRoute]);
    try {
      assert.equal(conflict.code, 0);
      assert.match(conflict.stderr, /already has an MCP entry/);
      const config = JSON.parse(await readFile(path.join(cursorDir, "mcp.json"), "utf8"));
      assert.equal(config.mcpServers["vc-tools"].url, "https://other.example.com/mcp");
    } finally {
      await conflict.cleanup();
    }

    const forced = await runWithMockApi([
      "--token", token,
      "agent", "connect", "--client", "cursor",
      "--install-dir", cursorDir,
      "--overwrite"
    ], [connectionRoute]);
    try {
      assert.equal(forced.code, 0);
      assert.match(forced.stdout, /Previous config backed up/);
      const config = JSON.parse(await readFile(path.join(cursorDir, "mcp.json"), "utf8"));
      assert.equal(config.mcpServers["vc-tools"].url, "https://agent.example.com/mcp");
      assert.equal(config.mcpServers["other-server"].url, "https://keep.example.com/mcp");
      const backup = JSON.parse(await readFile(path.join(cursorDir, "mcp.json.vc-tools.bak"), "utf8"));
      assert.equal(backup.mcpServers["vc-tools"].url, "https://other.example.com/mcp");
    } finally {
      await forced.cleanup();
    }
  } finally {
    await rm(cursorDir, { recursive: true, force: true });
  }
});

test("try proves auth, browser, computer, proof, and usage", async () => {
  const result = await runWithMockApi([
    "--json",
    "--token",
    token,
    "try",
    "--out",
    "proof",
    "--poll-interval-ms",
    "100"
  ], [
    meRoute(),
    { method: "GET", path: "/v1/health", response: { ok: true, service: "vc-tools-api" } },
    { method: "GET", path: "/v1/mcp/connection", response: { transport: "streamable_http", url: "https://tools.vibecodr.space/mcp" } },
    { method: "GET", path: "/v1/usage", response: { plan: "Pro", monthlyCredits: { used: 1, included: 3000 } } },
    {
      method: "POST",
      path: "/v1/tools/test",
      response: (request: RecordedRequest) => {
        const capability = (request.body as { capability?: string }).capability;
        return capability === "browser.extract_markdown"
          ? { id: "job_browser", status: "queued" }
          : { id: "job_computer", status: "queued" };
      }
    },
    { method: "GET", path: "/v1/jobs/job_browser", response: { id: "job_browser", status: "completed", result: { artifactId: "art_browser" } } },
    { method: "GET", path: "/v1/jobs/job_computer", response: { id: "job_computer", status: "completed", result: { artifactId: "art_computer" } } },
    {
      method: "GET",
      path: "/v1/artifacts/art_browser/download",
      response: new Uint8Array([1, 2, 3]),
      headers: {
        "content-type": "text/markdown",
        "content-disposition": "attachment; filename=\"browser-read.md\""
      }
    },
    {
      method: "GET",
      path: "/v1/artifacts/art_computer/download",
      response: new Uint8Array([4, 5, 6]),
      headers: {
        "content-type": "application/json",
        "content-disposition": "attachment; filename=\"computer-run.json\""
      }
    }
  ]);
  try {
    assert.equal(result.code, 0);
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.ready, true);
    assert.deepEqual(body.data.checks, {
      auth: "ok",
      hostedApi: "ok",
      browser: "ok",
      computer: "ok",
      proof: "ok",
      usage: "ok"
    });
    assert.deepEqual([...await readFile(path.join(result.cwd, "proof", "browser-read.md"))], [1, 2, 3]);
    assert.deepEqual([...await readFile(path.join(result.cwd, "proof", "computer-run.json"))], [4, 5, 6]);
  } finally {
    await result.cleanup();
  }
});

test("connect returns hosted Streamable HTTP metadata without leaking token", async () => {
  const result = await runWithMockApi(["--json", "--token", token, "connect", "--client", "codex"], [
    {
      method: "GET",
      path: "/v1/mcp/connection",
      response: {
        transport: "streamable_http",
        url: "https://tools.vibecodr.space/mcp",
        scopes: ["browser.render_url"]
      }
    }
  ]);
  try {
    assert.equal(result.code, 0);
    assert.doesNotMatch(result.stdout, new RegExp(token));
    assert.equal(JSON.parse(result.stdout).data.transport, "streamable_http");
    assert.match(result.requests[0]?.url ?? "", /client=codex/);
  } finally {
    await result.cleanup();
  }
});

test("start verifies the Agent Computer and returns agent connection details", async () => {
  const result = await runWithMockApi(["--json", "--token", token, "start", "--client", "codex"], [
    meRoute(),
    { method: "GET", path: "/v1/health", response: { ok: true, service: "vc-tools-api" } },
    {
      method: "GET",
      path: "/v1/mcp/connection",
      response: {
        transport: "streamable_http",
        url: "https://tools.vibecodr.space/mcp",
        tools: [{ name: "computer.run", capability: "sandbox.run_command" }]
      }
    },
    { method: "GET", path: "/v1/usage", response: { plan: "Pro", vcToolCredits: { used: 1, included: 3000 } } }
  ]);
  try {
    assert.equal(result.code, 0);
    assert.equal(result.requests.map((request) => new URL(request.url).pathname).join(","), "/v1/me,/v1/health,/v1/mcp/connection,/v1/usage");
    assert.match(result.requests[2]?.url ?? "", /client=codex/);
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.ready, true);
    assert.equal(body.data.account.plan, "Pro");
    assert.equal(body.data.connection.url, "https://tools.vibecodr.space/mcp");
    assert.equal(JSON.stringify(body.data).includes("providerMode"), false);
    assert.equal(JSON.stringify(body.data).includes("scopes"), false);
  } finally {
    await result.cleanup();
  }
});

test("default product JSON hides operator, roadmap, and credential internals", async () => {
  const forbidden = [
    "offeringClassifications",
    "overageMeters",
    "policies",
    "providerMode",
    "sandboxInternetDefault",
    "auth",
    "scopes",
    "tokenKind",
    "operatorAlerts",
    "cogs",
    "internalApiBinding",
    "webhook",
    "ntfy",
    "Cloudflare",
    "softCap",
    "hardCap"
  ];
  const usagePayload = {
    plan: "Pro",
    providerMode: "live",
    vcToolCredits: { used: 1, included: 3000 },
    dailyVcToolCredits: { used: 0, included: 400 },
    concurrentRuns: { used: 0, included: 5 },
    browserJobs: { used: 1, included: 3000 },
    sandboxJobs: { used: 0, included: 3000 },
    artifactStorageGb: { used: 0, included: 10 },
    offeringClassifications: [{ id: "stripe_metered_billing", status: "future" }],
    operatorAlerts: { configured: true },
    hardCap: false,
    authority: { source: "hosted-usage-snapshot" }
  };
  const planPayload = {
    plans: [
      { name: "Free", priceUsdMonthly: 0, limits: { monthlyCredits: 30 } },
      { name: "Creator", priceUsdMonthly: 19, limits: { monthlyCredits: 600 } },
      { name: "Pro", priceUsdMonthly: 39, limits: { monthlyCredits: 3000 } }
    ],
    overageMeters: [{ id: "browser-minute" }],
    offeringClassifications: [{ id: "overage_meters", status: "internal-only" }],
    policies: [{ id: "quota-before-cost" }],
    providerMode: "live"
  };
  const healthPayload = {
    ok: true,
    service: "vc-tools-api",
    providerMode: "live",
    Cloudflare: { accountId: "cf_account_internal" },
    live: {
      providerMode: "live",
      sandboxInternetDefault: "off",
      operatorAlerts: { configured: true },
      Cloudflare: { browserRun: { softCap: 24, hardCap: 30 } },
      network: { computerPublicHttps: "available" }
    }
  };

  const start = await runWithMockApi(["--json", "--token", token, "start", "--client", "codex"], [
    {
      ...meRoute(),
      response: {
        user: { id: "user_builder", email: "builder@example.com" },
        workspace: { id: "workspace_builder", name: "Builder" },
        plan: { name: "Pro" },
        auth: { tokenKind: "cli_grant", scopes: ["vc-tools:*"] },
        providerMode: "live"
      }
    },
    { method: "GET", path: "/v1/health", response: healthPayload },
    {
      method: "GET",
      path: "/v1/mcp/connection",
      response: {
        transport: "streamable_http",
        url: "https://tools.vibecodr.space/mcp",
        scopes: ["sandbox.run_command"],
        tools: [{ name: "computer.run", capability: "sandbox.run_command" }],
        providerMode: "live"
      }
    },
    { method: "GET", path: "/v1/usage", response: usagePayload }
  ]);
  try {
    assert.equal(start.code, 0);
    assertNoForbiddenKeys(JSON.parse(start.stdout).data, forbidden, "start");
  } finally {
    await start.cleanup();
  }

  const usage = await runWithMockApi(["--json", "--token", token, "usage"], [
    { method: "GET", path: "/v1/usage", response: usagePayload }
  ]);
  try {
    assert.equal(usage.code, 0);
    assertNoForbiddenKeys(JSON.parse(usage.stdout).data, forbidden, "usage");
  } finally {
    await usage.cleanup();
  }

  const plans = await runWithMockApi(["--json", "--token", token, "plans"], [
    { method: "GET", path: "/v1/plans", response: planPayload }
  ]);
  try {
    assert.equal(plans.code, 0);
    assertNoForbiddenKeys(JSON.parse(plans.stdout).data, forbidden, "plans");
  } finally {
    await plans.cleanup();
  }

  const doctor = await runWithMockApi(["--json", "doctor"], [
    { method: "GET", path: "/v1/health", response: healthPayload }
  ]);
  try {
    assert.equal(doctor.code, 0);
    assertNoForbiddenKeys(JSON.parse(doctor.stdout).data, forbidden, "doctor");
  } finally {
    await doctor.cleanup();
  }
});

test("job cancellation requires explicit confirmation", async () => {
  const blocked = await runWithMockApi(["--json", "--token", token, "jobs", "cancel", "job_123"]);
  try {
    assert.equal(blocked.code, 4);
    assert.equal(blocked.requests.length, 0);
  } finally {
    await blocked.cleanup();
  }

  const allowed = await runWithMockApi(["--json", "--token", token, "jobs", "cancel", "job_123", "--yes"], [
    { method: "POST", path: "/v1/jobs/job_123/cancel", response: { id: "job_123", status: "cancelled" } }
  ]);
  try {
    assert.equal(allowed.code, 0);
    assert.equal(JSON.parse(allowed.stdout).data.status, "cancelled");
  } finally {
    await allowed.cleanup();
  }
});

test("list commands pass bounded limit query parameters", async () => {
  const jobs = await runWithMockApi(["--json", "--token", token, "jobs", "list", "--limit", "7"], [
    {
      method: "GET",
      path: "/v1/jobs",
      response: (request: RecordedRequest) => {
        assert.equal(new URL(request.url).searchParams.get("limit"), "7");
        return { jobs: [{ id: "job_123", status: "queued" }] };
      }
    }
  ]);
  try {
    assert.equal(jobs.code, 0);
    assert.equal(JSON.parse(jobs.stdout).data.jobs[0].id, "job_123");
  } finally {
    await jobs.cleanup();
  }

  const artifacts = await runWithMockApi(["--json", "--token", token, "artifacts", "list", "--limit", "5"], [
    {
      method: "GET",
      path: "/v1/artifacts",
      response: (request: RecordedRequest) => {
        assert.equal(new URL(request.url).searchParams.get("limit"), "5");
        return { artifacts: [{ id: "art_123", kind: "log" }] };
      }
    }
  ]);
  try {
    assert.equal(artifacts.code, 0);
    assert.equal(JSON.parse(artifacts.stdout).data.artifacts[0].id, "art_123");
  } finally {
    await artifacts.cleanup();
  }

  const invalid = await runWithMockApi(["--json", "--token", token, "artifacts", "list", "--limit", "0"]);
  try {
    assert.equal(invalid.code, 2);
    assert.match(invalid.stderr, /input\.invalid_number/);
    assert.equal(invalid.requests.length, 0);
  } finally {
    await invalid.cleanup();
  }
});

test("retention set validates mutation confirmation and bounds", async () => {
  const invalid = await runWithMockApi(["--json", "--token", token, "retention", "set", "--logs-days", "0", "--yes"]);
  try {
    assert.equal(invalid.code, 2);
    assert.equal(invalid.requests.length, 0);
  } finally {
    await invalid.cleanup();
  }

  const allowed = await runWithMockApi([
    "--json",
    "--token",
    token,
    "retention",
    "set",
    "--logs-days",
    "30",
    "--artifacts-days",
    "30",
    "--recordings",
    "off",
    "--yes"
  ], [
    {
      method: "PATCH",
      path: "/v1/retention",
      response: (request: RecordedRequest) => ({ updated: true, body: request.body })
    }
  ]);
  try {
    assert.equal(allowed.code, 0);
    assert.deepEqual(JSON.parse(allowed.stdout).data.body, {
      logsDays: 30,
      artifactsDays: 30,
      recordings: "off"
    });
  } finally {
    await allowed.cleanup();
  }
});

test("artifacts pull writes inside workspace and refuses traversal/overwrite", async () => {
  const outside = await runWithMockApi(["--json", "--token", token, "artifacts", "pull", "art_123", "--out", "../outside"], [
    {
      method: "GET",
      path: "/v1/artifacts/art_123/download",
      response: new Uint8Array([1, 2, 3]),
      headers: { "content-type": "application/octet-stream" }
    }
  ]);
  try {
    assert.equal(outside.code, 5);
    assert.equal(outside.requests.length, 0);
    assert.match(outside.stderr, /workspace-bounded/);
    assert.match(outside.stderr, /--out \.\/artifacts\/report\.pdf/);
  } finally {
    await outside.cleanup();
  }

  const pulled = await runWithMockApi(["--json", "--token", token, "artifacts", "pull", "art_123", "--out", "downloads"], [
    {
      method: "GET",
      path: "/v1/artifacts/art_123/download",
      response: new Uint8Array([1, 2, 3]),
      headers: {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename=\"report.pdf\""
      }
    }
  ]);
  try {
    assert.equal(pulled.code, 0);
    const data = JSON.parse(pulled.stdout).data;
    assert.equal(data.bytes, 3);
    assert.match(data.path, /downloads/);
  } finally {
    await pulled.cleanup();
  }

  const targeted = await runWithMockApi(["--json", "--token", token, "artifacts", "pull", "art_123", "--out", "downloads/custom-report.pdf"], [
    {
      method: "GET",
      path: "/v1/artifacts/art_123/download",
      response: new Uint8Array([4, 5, 6]),
      headers: {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename=\"report.pdf\""
      }
    }
  ]);
  try {
    assert.equal(targeted.code, 0);
    const data = JSON.parse(targeted.stdout).data;
    assert.equal(data.path, path.join(targeted.cwd, "downloads", "custom-report.pdf"));
    assert.deepEqual([...await readFile(data.path)], [4, 5, 6]);
  } finally {
    await targeted.cleanup();
  }

  const named = await runWithMockApi(["--json", "--token", token, "artifacts", "pull", "art_123", "--out", "downloads", "--filename", "chosen-output"], [
    {
      method: "GET",
      path: "/v1/artifacts/art_123/download",
      response: new Uint8Array([7, 8, 9]),
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": "attachment; filename=\"report.pdf\""
      }
    }
  ]);
  try {
    assert.equal(named.code, 0);
    const data = JSON.parse(named.stdout).data;
    assert.equal(data.path, path.join(named.cwd, "downloads", "chosen-output"));
    assert.deepEqual([...await readFile(data.path)], [7, 8, 9]);
  } finally {
    await named.cleanup();
  }

  const cwd = await mkdtemp(path.join(os.tmpdir(), "vc-tools-pull-overwrite-"));
  try {
    const existing = path.join(cwd, "existing.pdf");
    await writeFile(existing, "already here");
    const refused = await runWithMockApi(["--json", "--token", token, "artifacts", "pull", "art_123", "--out", "existing.pdf"], [
      {
        method: "GET",
        path: "/v1/artifacts/art_123/download",
        response: new Uint8Array([1, 2, 3]),
        headers: { "content-type": "application/pdf" }
      }
    ], { cwd });
    try {
      assert.equal(refused.code, 5);
      assert.equal(refused.requests.length, 0);
      assert.match(refused.stderr, /file\.exists/);
      assert.equal(await readFile(existing, "utf8"), "already here");
    } finally {
      await refused.cleanup();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("artifacts pull rejects symlinked output paths before download", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "vc-tools-pull-cwd-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "vc-tools-pull-outside-"));
  const linkOut = path.join(cwd, "linkout");
  await symlink(outsideRoot, linkOut, process.platform === "win32" ? "junction" : "dir");
  const escaped = await runWithMockApi(["--json", "--token", token, "artifacts", "pull", "art_123", "--out", "linkout"], [
    {
      method: "GET",
      path: "/v1/artifacts/art_123/download",
      response: new Uint8Array([1, 2, 3]),
      headers: {
        "content-type": "application/pdf",
        "content-disposition": "attachment; filename=\"report.pdf\""
      }
    }
  ], { cwd });
  try {
    assert.equal(escaped.code, 5);
    assert.equal(escaped.requests.length, 0);
    assert.match(escaped.stderr, /file\.outside_workspace/);
    await assert.rejects(readFile(path.join(outsideRoot, "report.pdf")));
  } finally {
    await escaped.cleanup();
    await rm(cwd, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("artifacts create requires --yes and sends multipart form", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "vc-tools-artifact-"));
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), "vc-tools-outside-artifact-"));
  try {
    const file = path.join(cwd, "report.txt");
    const outsideFile = path.join(outsideRoot, "secret.txt");
    await writeFile(file, "hello");
    await writeFile(outsideFile, "secret");

    const blocked = await runWithMockApi(["--json", "--token", token, "artifacts", "create", "--file", file], [], { cwd });
    try {
      assert.equal(blocked.code, 4);
    } finally {
      await blocked.cleanup();
    }

    const outside = await runWithMockApi(["--json", "--token", token, "artifacts", "create", "--file", outsideFile, "--yes"], [], { cwd });
    try {
      assert.equal(outside.code, 5);
      assert.equal(outside.requests.length, 0);
      assert.match(outside.stderr, /file\.outside_workspace/);
    } finally {
      await outside.cleanup();
    }

    const allowed = await runWithMockApi(["--json", "--token", token, "artifacts", "create", "--file", file, "--kind", "log", "--yes"], [
      {
        method: "POST",
        path: "/v1/artifacts",
        response: { id: "art_123", kind: "log" }
      }
    ], { cwd });
    try {
      assert.equal(allowed.code, 0);
      assert.equal(JSON.parse(allowed.stdout).data.id, "art_123");
    } finally {
      await allowed.cleanup();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("artifacts delete requires --yes and removes hosted shelf entry", async () => {
  const blocked = await runWithMockApi(["--json", "--token", token, "artifacts", "delete", "art_123"]);
  try {
    assert.equal(blocked.code, 4);
    assert.equal(blocked.requests.length, 0);
    assert.match(blocked.stderr, /confirm\.required/);
  } finally {
    await blocked.cleanup();
  }

  const deleted = await runWithMockApi(["--json", "--token", token, "artifacts", "delete", "art_123", "--yes"], [
    {
      method: "DELETE",
      path: "/v1/artifacts/art_123",
      response: { id: "art_123", status: "deleted", providerMode: "live" }
    }
  ]);
  try {
    assert.equal(deleted.code, 0);
    assert.equal(deleted.requests[0]?.method, "DELETE");
    assert.equal(JSON.parse(deleted.stdout).data.status, "deleted");
  } finally {
    await deleted.cleanup();
  }
});

test("plans works offline with local fallback packaging", async () => {
  const result = await runWithMockApi(["--json", "plans"]);
  try {
    assert.equal(result.code, 0);
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.plans.some((plan: { name: string }) => plan.name === "Free"), true);
    assert.equal(body.data.plans.some((plan: { name: string }) => plan.name === "Starter"), false);
    const creator = body.data.plans.find((plan: { name: string }) => plan.name === "Creator");
    assert.equal(creator?.priceUsdMonthly, 19);
    assert.equal(creator?.monthlyCredits, 600);
    assert.equal(creator?.browser.monthlyJobs, 600);
    assert.equal(creator?.computer.monthlyJobs, 600);
    assert.equal(creator?.browser.maxSecondsPerRun, 60);
    assert.equal(creator?.browser.agentBrowserTasks, "included");
    assert.equal(creator?.computer.maxTaskSeconds, 600);
    assert.equal(body.data.plans.some((plan: { name: string }) => plan.name === "Pro"), true);
    const pro = body.data.plans.find((plan: { name: string }) => plan.name === "Pro");
    assert.equal(pro?.runningLimit, 5);
    assert.equal(pro?.computer.maxTaskSeconds, 1800);
    assert.equal("overageMeters" in body.data, false);
    assert.equal("offeringClassifications" in body.data, false);
    assert.equal("policies" in body.data, false);
    assert.equal("authority" in body.data, false);
    assert.match(body.warnings.join("\n"), /Local fallback plan packaging is informational/);
  } finally {
    await result.cleanup();
  }
});

test("plans prints hosted data in human mode instead of an opaque success line", async () => {
  const result = await runWithMockApi(["--token", token, "plans"], [
    {
      method: "GET",
      path: "/v1/plans",
      response: {
        plans: [
          { name: "Free", priceUsdMonthly: 0, limits: { monthlyCredits: 20 } },
          { name: "Creator", priceUsdMonthly: 19, limits: { monthlyCredits: 600 } },
          { name: "Pro", priceUsdMonthly: 39, limits: { monthlyCredits: 3000 } }
        ],
        authority: {
          source: "hosted-plans-endpoint",
          accountEntitlementsAuthoritative: false,
          localFallbackAuthoritative: false
        }
      }
    }
  ]);
  try {
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Vibecodr Agent Computer plans/);
    assert.match(result.stdout, /^Free$/m);
    assert.match(result.stdout, /Creator - \$19\/mo/);
    assert.match(result.stdout, /Pro - \$39\/mo/);
    assert.match(result.stdout, /Run vibecodr usage for your actual account capacity/);
    assert.doesNotMatch(result.stdout, /"plans"/);
    assert.doesNotMatch(result.stdout, /"authority"/);
  } finally {
    await result.cleanup();
  }
});

test("usage and limits show quota progress while preserving JSON data", async () => {
  const usagePayload = {
    plan: "Creator",
    providerMode: "live",
    vcToolCredits: { used: 150, included: 600 },
    dailyVcToolCredits: { used: 9, included: 90 },
    browserJobs: { used: 120, included: 600 },
    sandboxJobs: { used: 30, included: 600 },
    browserSeconds: { used: 600, included: 36000 },
    dailyBrowserSeconds: { used: 120, included: 5400 },
    sandboxMinutes: { used: 45, included: 600 },
    artifactStorageGb: { used: 0.25, included: 1 },
    concurrentRuns: { used: 1, included: 2 },
    browserSessionConcurrency: { used: 0, included: 1 },
    sandboxConcurrency: { used: 1, included: 2 },
    hardCap: true,
    authority: {
      source: "hosted-usage-snapshot",
      authoritative: true,
      mutableByClient: false
    }
  };

  const human = await runWithMockApi(["--token", token, "usage"], [
    { method: "GET", path: "/v1/usage", response: usagePayload }
  ]);
  try {
    assert.equal(human.code, 0);
    assert.match(human.stdout, /Plan: Creator/);
    assert.match(human.stdout, /Agent Computer capacity/);
    assert.doesNotMatch(human.stdout, /Authority:/);
    assert.match(human.stdout, /Monthly credits\s+150 \/ 600\s+\[###-------\] 25%/);
    assert.match(human.stdout, /Proof storage\s+0\.25 \/ 1 GB\s+\[###-------\] 25%/);
    assert.match(human.stdout, /Alias: vibecodr limits/);
  } finally {
    await human.cleanup();
  }

  const json = await runWithMockApi(["--json", "--token", token, "limits"], [
    { method: "GET", path: "/v1/usage", response: usagePayload }
  ]);
  try {
    assert.equal(json.code, 0);
    assert.equal(new URL(json.requests[0]?.url ?? "").pathname, "/v1/usage");
    const body = JSON.parse(json.stdout);
    assert.equal(body.data.plan, "Creator");
    assert.equal(body.data.monthlyCredits.used, 150);
    assert.equal("providerMode" in body.data, false);
    assert.equal("authority" in body.data, false);
  } finally {
    await json.cleanup();
  }
});

test("whoami shows hosted account identity and grants defaults to list", async () => {
  const whoami = await runWithMockApi(["--token", token, "whoami"], [
    meRoute()
  ]);
  try {
    assert.equal(whoami.code, 0);
    assert.match(whoami.stdout, /Vibecodr Agent Computer/);
    assert.match(whoami.stdout, /Account: builder@example\.com/);
    assert.match(whoami.stdout, /Workspace: Vibecodr/);
    assert.match(whoami.stdout, /Agent access: ready/);
    assert.match(whoami.stdout, /"user"/);
    assert.equal(new URL(whoami.requests[0]?.url ?? "").pathname, "/v1/me");
  } finally {
    await whoami.cleanup();
  }

  const grants = await runWithMockApi(["--token", token, "grants"], [
    {
      method: "GET",
      path: "/v1/grants",
      response: {
        providerMode: "live",
        grants: [
          { grant: "browser.render", capability: "browser.render_url", granted: true },
          { grant: "sandbox.run", capability: "sandbox.run_command", granted: false }
        ]
      }
    }
  ]);
  try {
    assert.equal(grants.code, 0);
    assert.match(grants.stdout, /vibecodr grants \(live\)/);
    assert.match(grants.stdout, /1\/2 tool grants are enabled/);
    assert.match(grants.stdout, /"browser.render"/);
    assert.equal(new URL(grants.requests[0]?.url ?? "").pathname, "/v1/grants");
  } finally {
    await grants.cleanup();
  }
});

test("status and doctor expose local state without requiring auth", async () => {
  const status = await runWithMockApi(["--json", "status"], [
    { method: "GET", path: "/v1/health", response: { ok: true, service: "vc-tools-api" } }
  ]);
  try {
    assert.equal(status.code, 0);
    assert.equal(JSON.parse(status.stdout).data.authenticated, false);
  } finally {
    await status.cleanup();
  }

  const tokenStatus = await runWithMockApi(["--json", "--token", token, "status"], [
    { method: "GET", path: "/v1/health", response: { ok: true, service: "vc-tools-api" } }
  ]);
  try {
    assert.equal(tokenStatus.code, 0);
    const body = JSON.parse(tokenStatus.stdout);
    assert.equal(body.data.authenticated, true);
    assert.equal(body.data.config.credentialsExist, true);
    assert.equal(body.data.authSources.winning.label, "--token");
    assert.equal(body.data.authSources.stored.status, "missing");
    assert.equal(Object.prototype.hasOwnProperty.call(body.data.authSources.stored, "profile"), false);
  } finally {
    await tokenStatus.cleanup();
  }

  const diagnose = await runWithMockApi(["--json", "--token", token, "auth", "diagnose"], [
    meRoute()
  ]);
  try {
    assert.equal(diagnose.code, 0);
    const body = JSON.parse(diagnose.stdout);
    assert.equal(body.data.authSources.winning.label, "--token");
    assert.equal(body.data.verification.ok, true);
    assert.equal(body.data.verification.account.label, "builder@example.com");
    assert.match(body.warnings.join("\n"), /VC_TOOLS_CONFIG_DIR is set/);
  } finally {
    await diagnose.cleanup();
  }

  const exported = await runWithMockApi(["--json", "--token", token, "auth", "export-agent-env", "--out", "agent-token.txt", "--yes"]);
  try {
    assert.equal(exported.code, 0);
    const body = JSON.parse(exported.stdout);
    assert.equal(body.data.file.endsWith("agent-token.txt"), true);
    assert.equal(body.data.env.name, "VC_TOOLS_TOKEN_FILE");
    assert.equal(body.data.env.value.endsWith("agent-token.txt"), true);
    assert.match(body.data.env.assignment, /^VC_TOOLS_TOKEN_FILE=.*agent-token\.txt$/);
    assert.doesNotMatch(exported.stdout, new RegExp(token));
    const exportedToken = await readFile(path.join(exported.cwd, "agent-token.txt"), "utf8");
    assert.equal(exportedToken.trim(), token);
  } finally {
    await exported.cleanup();
  }

  const expired = await runWithMockApi(["--json", "--token", token, "whoami"], [
    { method: "GET", path: "/v1/me", status: 403, response: { code: "auth.denied", message: "Bearer token is not authorized." } }
  ]);
  try {
    assert.equal(expired.code, 3);
    const body = JSON.parse(expired.stderr);
    assert.equal(body.error.code, "auth.denied");
    assert.match(body.error.message, /credential was rejected or expired/);
    assert.doesNotMatch(body.error.message, /Bearer token is not authorized/);
  } finally {
    await expired.cleanup();
  }

  const doctor = await runWithMockApi(["--json", "doctor"], [
    { method: "GET", path: "/v1/health", response: { ok: true, service: "vc-tools-api" } }
  ]);
  try {
    assert.equal(doctor.code, 0);
    assert.equal(JSON.parse(doctor.stdout).data.checks.some((check: { name: string }) => check.name === "agentComputer"), true);
  } finally {
    await doctor.cleanup();
  }
});

test("inspect reports machine-readable goal coverage", async () => {
  const result = await runWithMockApi(["--json", "inspect"]);
  try {
    assert.equal(result.code, 0);
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.summary.hostedRequired, 1);
    assert.equal(body.data.inspections.some((item: { id: string; status: string }) => item.id === "browser-tools" && item.status === "local-verified"), true);
    assert.equal(body.data.inspections.some((item: { id: string; status: string }) => item.id === "hosted-service" && item.status === "local-verified"), true);
    assert.equal(body.data.inspections.some((item: { id: string; status: string }) => item.id === "human-use-security-hardening" && item.status === "local-verified"), true);
    assert.equal(body.data.inspections.some((item: { id: string; status: string }) => item.id === "live-hosted-production" && item.status === "hosted-required"), true);
  } finally {
    await result.cleanup();
  }
});

test("dashboard exposes safe hosted dashboard sections", async () => {
  const result = await runWithMockApi(["--json", "dashboard", "usage"]);
  try {
    assert.equal(result.code, 0);
    const body = JSON.parse(result.stdout);
    assert.equal(body.data.section, "usage");
    assert.equal(body.data.url, "http://localhost:8787/dashboard/usage/");
    assert.deepEqual(body.data.sections.slice(0, 5), ["overview", "jobs", "artifacts", "usage", "agents"]);
    assert.equal(body.data.sections.includes("cogs"), false);
    assert.equal(result.requests.length, 0);
  } finally {
    await result.cleanup();
  }

  const cogs = await runWithMockApi(["--json", "dashboard", "cogs"]);
  try {
    assert.equal(cogs.code, 2);
    assert.match(cogs.stderr, /input.invalid_dashboard_section/);
    assert.equal(cogs.stdout.includes("/dashboard/cogs/"), false);
    assert.equal(cogs.requests.length, 0);
  } finally {
    await cogs.cleanup();
  }

  const invalid = await runWithMockApi(["--json", "dashboard", "secrets"]);
  try {
    assert.equal(invalid.code, 2);
    assert.match(invalid.stderr, /input.invalid_dashboard_section/);
  } finally {
    await invalid.cleanup();
  }

  const credentialed = await runWithMockApi(["--json", "--api-url", "https://user:pass@example.com", "dashboard"]);
  try {
    assert.equal(credentialed.code, 5);
    assert.match(credentialed.stderr, /config\.invalid_api_url/);
    assert.equal(credentialed.stdout.includes("user:pass"), false);
  } finally {
    await credentialed.cleanup();
  }
});

test("human output exposes returned data for every successful command family", async () => {
  const usagePayload = {
    plan: "Creator",
    providerMode: "live",
    vcToolCredits: { used: 12, included: 600 },
    authority: { source: "hosted-usage-snapshot", authoritative: true, mutableByClient: false }
  };
  const grantPayload = {
    providerMode: "live",
    grants: [
      { grant: "browser.render", capability: "browser.render_url", granted: true },
      { grant: "sandbox.run", capability: "sandbox.run_command", granted: false }
    ]
  };
  const planPayload = {
    plans: [
      { name: "Free", limits: { monthlyCredits: 30 } },
      { name: "Creator", limits: { monthlyCredits: 600 } },
      { name: "Pro", limits: { monthlyCredits: 3000 } }
    ],
    authority: {
      source: "hosted-plans-endpoint",
      accountEntitlementsAuthoritative: false,
      localFallbackAuthoritative: false
    }
  };

  const cases: Array<{ name: string; argv: string[]; routes?: Parameters<typeof runWithMockApi>[1]; expected: RegExp[]; summaryOnly?: boolean }> = [
    {
      name: "login",
      argv: ["login", "--token", token],
      routes: [meRoute()],
      expected: [/"authMode"/, /"user"/, /builder@example\.com/]
    },
    {
      name: "logout",
      argv: ["logout", "--yes"],
      expected: [/"cleared"/]
    },
    {
      name: "status",
      argv: ["status"],
      routes: [{ method: "GET", path: "/v1/health", response: { ok: true, service: "vc-tools-api" } }],
      expected: [/"authenticated"/, /"health"/]
    },
    {
      name: "whoami",
      argv: ["whoami"],
      routes: [meRoute()],
      expected: [/"user"/, /"workspace"/, /builder@example\.com/]
    },
    {
      name: "connect",
      argv: ["connect"],
      routes: [{ method: "GET", path: "/v1/mcp/connection", response: { transport: "streamable_http", url: "https://tools.vibecodr.space/mcp" } }],
      expected: [/MCP URL/, /tools\.vibecodr\.space/],
      summaryOnly: true
    },
    {
      name: "auth diagnose",
      argv: ["auth", "diagnose"],
      routes: [meRoute()],
      expected: [/"authSources"/, /builder@example\.com/]
    },
    {
      name: "agent connect",
      argv: ["agent", "connect", "--client", "codex", "--print"],
      routes: [{ method: "GET", path: "/v1/mcp/connection", response: { transport: "streamable_http", url: "https://tools.vibecodr.space/mcp", tools: [{ name: "computer.run" }] } }],
      expected: [/Codex connection ready/, /install skipped/, /tools\.vibecodr\.space/],
      summaryOnly: true
    },
    {
      name: "tools list",
      argv: ["tools", "list"],
      routes: [{ method: "GET", path: "/v1/tools", response: { tools: [{ capability: "browser.render_url" }] } }],
      expected: [/"tools"/, /browser\.render_url/]
    },
    {
      name: "tools test",
      argv: ["tools", "test", "usage"],
      routes: [{ method: "POST", path: "/v1/tools/test", response: { capability: "usage.read", usage: usagePayload } }],
      expected: [/"capability"/, /usage\.read/]
    },
    {
      name: "browser read",
      argv: ["browser", "read", "https://example.com"],
      routes: [{ method: "POST", path: "/v1/tools/test", response: (request: RecordedRequest) => ({ body: request.body }) }],
      expected: [/Browser read completed/],
      summaryOnly: true
    },
    {
      name: "computer run",
      argv: ["computer", "run", "node --version"],
      routes: [{ method: "POST", path: "/v1/tools/test", response: (request: RecordedRequest) => ({ body: request.body }) }],
      expected: [/Agent Computer run completed/],
      summaryOnly: true
    },
    {
      name: "jobs list",
      argv: ["jobs", "list"],
      routes: [{ method: "GET", path: "/v1/jobs", response: { jobs: [{ id: "job_123", status: "succeeded" }] } }],
      expected: [/"jobs"/, /job_123/]
    },
    {
      name: "work list",
      argv: ["work", "list"],
      routes: [{ method: "GET", path: "/v1/jobs", response: { jobs: [{ id: "job_123", status: "succeeded" }] } }],
      expected: [/"jobs"/, /job_123/]
    },
    {
      name: "jobs status",
      argv: ["jobs", "status", "job_123"],
      routes: [{ method: "GET", path: "/v1/jobs/job_123", response: { id: "job_123", status: "succeeded" } }],
      expected: [/"id"/, /job_123/]
    },
    {
      name: "jobs cancel",
      argv: ["jobs", "cancel", "job_123", "--yes"],
      routes: [{ method: "POST", path: "/v1/jobs/job_123/cancel", response: { id: "job_123", status: "cancelled" } }],
      expected: [/"status"/, /cancelled/]
    },
    {
      name: "artifacts list",
      argv: ["artifacts", "list"],
      routes: [{ method: "GET", path: "/v1/artifacts", response: { artifacts: [{ id: "art_123", kind: "log" }] } }],
      expected: [/"artifacts"/, /art_123/]
    },
    {
      name: "proof list",
      argv: ["proof", "list"],
      routes: [{ method: "GET", path: "/v1/artifacts", response: { artifacts: [{ id: "art_123", kind: "log" }] } }],
      expected: [/"artifacts"/, /art_123/]
    },
    {
      name: "artifacts get",
      argv: ["artifacts", "get", "art_123"],
      routes: [{ method: "GET", path: "/v1/artifacts/art_123", response: { id: "art_123", kind: "log" } }],
      expected: [/"id"/, /art_123/]
    },
    {
      name: "artifacts pull",
      argv: ["artifacts", "pull", "art_123", "--out", "downloads/report.bin"],
      routes: [{ method: "GET", path: "/v1/artifacts/art_123/download", response: new Uint8Array([1, 2, 3]), headers: { "content-type": "application/octet-stream" } }],
      expected: [/"path"/, /"bytes": 3/]
    },
    {
      name: "artifacts delete",
      argv: ["artifacts", "delete", "art_123", "--yes"],
      routes: [{ method: "DELETE", path: "/v1/artifacts/art_123", response: { id: "art_123", status: "deleted" } }],
      expected: [/"status"/, /deleted/]
    },
    {
      name: "usage",
      argv: ["usage"],
      routes: [{ method: "GET", path: "/v1/usage", response: usagePayload }],
      expected: [/Monthly credits/, /12 \/ 600/],
      summaryOnly: true
    },
    {
      name: "limits",
      argv: ["limits"],
      routes: [{ method: "GET", path: "/v1/usage", response: usagePayload }],
      expected: [/Monthly credits/, /12 \/ 600/],
      summaryOnly: true
    },
    {
      name: "grants",
      argv: ["grants"],
      routes: [{ method: "GET", path: "/v1/grants", response: grantPayload }],
      expected: [/"grants"/, /browser\.render/]
    },
    {
      name: "grants list",
      argv: ["grants", "list"],
      routes: [{ method: "GET", path: "/v1/grants", response: grantPayload }],
      expected: [/"grants"/, /sandbox\.run/]
    },
    {
      name: "retention show",
      argv: ["retention", "show"],
      routes: [{ method: "GET", path: "/v1/retention", response: { logsDays: 30, artifactsDays: 7, recordings: "off" } }],
      expected: [/"logsDays"/, /"recordings": "off"/]
    },
    {
      name: "retention set",
      argv: ["retention", "set", "--logs-days", "30", "--yes"],
      routes: [{ method: "PATCH", path: "/v1/retention", response: (request: RecordedRequest) => ({ updated: true, body: request.body }) }],
      expected: [/"updated": true/, /"logsDays": 30/]
    },
    {
      name: "scheduled QA list",
      argv: ["scheduled-qa", "list"],
      routes: [{ method: "GET", path: "/v1/scheduled-qa", response: { configs: [{ id: "sqa_123", capability: "browser.screenshot_url" }] } }],
      expected: [/"configs"/, /sqa_123/]
    },
    {
      name: "scheduled QA create",
      argv: ["scheduled-qa", "create", "https://example.com/", "--capability", "browser.screenshot", "--interval-minutes", "720", "--label", "homepage", "--run-now", "--yes"],
      routes: [{ method: "POST", path: "/v1/scheduled-qa", response: (request: RecordedRequest) => ({ config: { id: "sqa_123" }, body: request.body }) }],
      expected: [/"capability": "browser.screenshot_url"/, /"intervalMinutes": 720/, /"runNow": true/]
    },
    {
      name: "plans",
      argv: ["plans"],
      routes: [{ method: "GET", path: "/v1/plans", response: planPayload }],
      expected: [/Vibecodr Agent Computer plans/, /Creator/],
      summaryOnly: true
    },
    {
      name: "dashboard",
      argv: ["dashboard", "usage"],
      expected: [/"url"/, /\/dashboard\/usage\//]
    },
    {
      name: "inspect",
      argv: ["inspect"],
      expected: [/"summary"/, /"inspections"/]
    },
    {
      name: "doctor",
      argv: ["doctor"],
      routes: [{ method: "GET", path: "/v1/health", response: { ok: true, service: "vc-tools-api" } }],
      expected: [/Agent Computer checks passed/],
      summaryOnly: true
    }
  ];

  for (const item of cases) {
    const result = await runWithMockApi(["--token", token, ...item.argv], item.routes ?? []);
    try {
      if (item.summaryOnly) {
        assertHumanOutputSummary(result, item.expected, item.name);
      } else {
        assertHumanOutputSharesData(result, item.expected, item.name);
      }
    } finally {
      await result.cleanup();
    }
  }

  const cwd = await mkdtemp(path.join(os.tmpdir(), "vc-tools-human-artifact-create-"));
  try {
    const file = path.join(cwd, "report.txt");
    await writeFile(file, "hello");
    const created = await runWithMockApi(["--token", token, "artifacts", "create", "--file", "report.txt", "--yes"], [
      { method: "POST", path: "/v1/artifacts", response: { id: "art_created", kind: "file" } }
    ], { cwd });
    try {
      assertHumanOutputSharesData(created, [/"id"/, /art_created/], "artifacts create");
    } finally {
      await created.cleanup();
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("invalid API URLs use the documented config error contract", async () => {
  const invalid = await runWithMockApi(["--json", "--api-url", "not-a-url", "--token", token, "tools", "list"], [
    { method: "GET", path: "/v1/tools", response: { tools: [] } }
  ]);
  try {
    assert.equal(invalid.code, 5);
    assert.equal(invalid.requests.length, 0);
    assert.match(invalid.stderr, /config\.invalid_api_url/);
    assert.equal(invalid.stderr.includes("unexpected.failure"), false);
  } finally {
    await invalid.cleanup();
  }
});

test("list/read command families route to expected endpoints", async () => {
  const cases: Array<{ argv: string[]; path: string; method?: string }> = [
    { argv: ["tools", "list"], path: "/v1/tools" },
    { argv: ["jobs", "list"], path: "/v1/jobs" },
    { argv: ["jobs", "status", "job_123"], path: "/v1/jobs/job_123" },
    { argv: ["artifacts", "list"], path: "/v1/artifacts" },
    { argv: ["artifacts", "get", "art_123"], path: "/v1/artifacts/art_123" },
    { argv: ["usage"], path: "/v1/usage" },
    { argv: ["limits"], path: "/v1/usage" },
    { argv: ["grants"], path: "/v1/grants" },
    { argv: ["grants", "list"], path: "/v1/grants" },
    { argv: ["plans"], path: "/v1/plans" },
    { argv: ["scheduled-qa", "list"], path: "/v1/scheduled-qa" },
    { argv: ["retention", "show"], path: "/v1/retention" }
  ];

  for (const item of cases) {
    const result = await runWithMockApi(["--json", "--token", token, ...item.argv], [
      { method: item.method ?? "GET", path: item.path, response: { ok: true } }
    ]);
    try {
      assert.equal(result.code, 0, item.argv.join(" "));
      assert.equal(new URL(result.requests[0]?.url ?? "").pathname, item.path);
    } finally {
      await result.cleanup();
    }
  }
});

function assertHumanOutputSharesData(result: Awaited<ReturnType<typeof runWithMockApi>>, expected: RegExp[], label: string): void {
  assert.equal(result.code, 0, label);
  assert.match(result.stdout, /\n\{[\s\S]*\}\n?$/, `${label} should print a JSON payload in human mode`);
  assert.doesNotMatch(result.stdout, new RegExp(token), `${label} should not print the raw credential`);
  for (const pattern of expected) {
    assert.match(result.stdout, pattern, label);
  }
}

function assertHumanOutputSummary(result: Awaited<ReturnType<typeof runWithMockApi>>, expected: RegExp[], label: string): void {
  assert.equal(result.code, 0, label);
  assert.doesNotMatch(result.stdout, /\n\{[\s\S]*\}\n?$/, `${label} should not print control-plane JSON in default human mode`);
  assert.doesNotMatch(result.stdout, new RegExp(token), `${label} should not print the raw credential`);
  for (const pattern of expected) {
    assert.match(result.stdout, pattern, label);
  }
}

function assertNoForbiddenKeys(value: unknown, forbidden: string[], label: string): void {
  const found = new Set<string>();
  visitKeys(value, (key) => {
    if (forbidden.includes(key)) {
      found.add(key);
    }
  });
  assert.deepEqual([...found].sort(), [], `${label} leaked default-internal keys`);
}

function visitKeys(value: unknown, visitor: (key: string) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitKeys(item, visitor);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      visitor(key);
      visitKeys(item, visitor);
    }
  }
}
