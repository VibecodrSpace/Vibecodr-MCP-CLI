// Upgrade-path smoke (plan §16). Gated behind VIBECDR_SMOKE_UPGRADE=1 because
// it touches the global npm prefix the operator points at and requires a
// staging-scoped Clerk user to walk the device-code flow.
//
// Skip mechanism: when the env var isn't set the test no-ops. Default `npm
// test` runs `test/**/*.test.ts` glob and never picks up `.smoke.ts` files,
// so this stays out of the routine verify chain.
//
// Run manually:
//
//   VIBECDR_SMOKE_UPGRADE=1 VIBECDR_SMOKE_UPGRADE_API_URL=https://api.staging.vibecodr.space \
//     node --import tsx --test test/upgrade-path.smoke.ts
//
// The full §16 flow requires interactive browser approval. This file
// implements the non-interactive scaffolding (sandbox prefix, sequential
// npm installs across the version boundary, identity-readback assertions)
// and prints clear instructions for the interactive steps that have to be
// driven by hand. When VIBECDR_SMOKE_UPGRADE_TOKEN is set, the file substitutes
// non-interactive `--credential` auth for the device-code flow so an
// operator can drive the whole sequence headless.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ENABLED = process.env["VIBECDR_SMOKE_UPGRADE"] === "1";
const STAGING_API_URL = process.env["VIBECDR_SMOKE_UPGRADE_API_URL"] ?? "https://api.staging.vibecodr.space";
const NON_INTERACTIVE_TOKEN = process.env["VIBECDR_SMOKE_UPGRADE_TOKEN"];

interface RunResult { code: number | null; stdout: string; stderr: string }

function run(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32"
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timeout = options.timeoutMs ? setTimeout(() => child.kill("SIGTERM"), options.timeoutMs) : undefined;
    child.on("error", reject);
    child.on("exit", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

async function installGlobalInto(prefix: string, spec: string): Promise<void> {
  const result = await run("npm", ["install", "--prefix", prefix, "--no-audit", "--no-fund", "--no-save", spec], { timeoutMs: 180_000 });
  assert.equal(result.code, 0, `npm install ${spec} failed:\n${result.stderr}`);
}

function vcToolsBinPath(prefix: string): string {
  // npm puts globally-installed bin scripts under prefix/node_modules/@vibecodr/cli/...
  // We invoke the bin via node directly so PATH-shim differences across OSes don't matter.
  return path.join(prefix, "node_modules", "@vibecodr", "cli", "dist", "bin", "vc-tools.js");
}

async function whoamiIdentity(binPath: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const result = await run("node", [binPath, "whoami", "--json", "--non-interactive"], { env, timeoutMs: 30_000 });
  if (result.code !== 0) return undefined;
  try {
    const payload = JSON.parse(result.stdout) as { data?: { user?: { id?: string } } };
    return payload.data?.user?.id;
  } catch {
    return undefined;
  }
}

test("upgrade-path smoke: install 0.1.4 -> 1.0.0-rc.0; identity survives without re-login", { timeout: 600_000 }, async (t) => {
  if (!ENABLED) {
    t.skip("VIBECDR_SMOKE_UPGRADE != 1");
    return;
  }
  if (!NON_INTERACTIVE_TOKEN) {
    t.skip("VIBECDR_SMOKE_UPGRADE_TOKEN not set (the interactive device-code flow is operator-driven; see file header)");
    return;
  }

  const prefix = await mkdtemp(path.join(os.tmpdir(), "vibecodr-upgrade-smoke-"));
  try {
    // Stage 1: install the legacy vc-tools line.
    await installGlobalInto(prefix, "@vibecodr/vc-tools@0.1.4");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      VC_TOOLS_API_URL: STAGING_API_URL,
      VC_TOOLS_CREDENTIAL: NON_INTERACTIVE_TOKEN,
      VC_TOOLS_CREDENTIAL_STORE: "file",
      VC_TOOLS_CONFIG_DIR: path.join(prefix, "vc-tools-config")
    };
    const legacyBin = path.join(prefix, "node_modules", "@vibecodr", "vc-tools", "dist", "bin", "vc-tools.js");
    const legacyLogin = await run("node", [legacyBin, "login", "--credential", NON_INTERACTIVE_TOKEN, "--api-url", STAGING_API_URL, "--non-interactive", "--json"], { env, timeoutMs: 60_000 });
    assert.equal(legacyLogin.code, 0, `legacy login failed:\n${legacyLogin.stderr}`);

    const identityBefore = await whoamiIdentity(legacyBin, env);
    assert.ok(identityBefore, "legacy vc-tools whoami returned no user id");

    // Stage 2: upgrade to the merged CLI.
    await installGlobalInto(prefix, "@vibecodr/cli@1.0.0-rc.0");
    const mergedVcToolsBin = vcToolsBinPath(prefix);

    const identityAfter = await whoamiIdentity(mergedVcToolsBin, env);
    assert.equal(identityAfter, identityBefore, `merged vc-tools whoami returned a different identity. before=${identityBefore} after=${identityAfter}`);

    // The merged bin also exposes vibecodr-mcp; same user, different surface.
    const vibecodrBin = path.join(prefix, "node_modules", "@vibecodr", "cli", "dist", "bin", "vibecodr-mcp.js");
    const version = await run("node", [vibecodrBin, "--version"], { env, timeoutMs: 10_000 });
    assert.equal(version.code, 0);
    assert.match(version.stdout.trim(), /^1\.0\.0/);
  } finally {
    await rm(prefix, { recursive: true, force: true });
  }
});

test("upgrade-path smoke: 0.2.11 -> 1.0.0-rc.0 path (MCP gateway surface)", { timeout: 600_000 }, async (t) => {
  if (!ENABLED) {
    t.skip("VIBECDR_SMOKE_UPGRADE != 1");
    return;
  }
  if (!process.env["VIBECDR_SMOKE_UPGRADE_MCP_TOKEN"]) {
    t.skip("VIBECDR_SMOKE_UPGRADE_MCP_TOKEN not set");
    return;
  }

  const prefix = await mkdtemp(path.join(os.tmpdir(), "vibecodr-upgrade-mcp-smoke-"));
  try {
    await installGlobalInto(prefix, "@vibecodr/cli@0.2.11");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      VIBECDR_MCP_CONFIG_PATH: path.join(prefix, "mcp-config.json"),
      VIBECDR_MCP_INSECURE_SECRET_STORE_PATH: path.join(prefix, "mcp-secrets.json"),
      VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE: "true"
    };
    const oldBin = path.join(prefix, "node_modules", "@vibecodr", "cli", "dist", "bin", "vibecodr-mcp.js");
    const beforeWhoami = await run("node", [oldBin, "whoami", "--json", "--non-interactive"], { env, timeoutMs: 30_000 });
    assert.equal(beforeWhoami.code, 0, `0.2.11 whoami failed:\n${beforeWhoami.stderr}`);
    const beforePayload = JSON.parse(beforeWhoami.stdout) as { data?: { user?: { id?: string } } };
    const beforeIdentity = beforePayload.data?.user?.id;

    await installGlobalInto(prefix, "@vibecodr/cli@1.0.0-rc.0");
    const newBin = path.join(prefix, "node_modules", "@vibecodr", "cli", "dist", "bin", "vibecodr-mcp.js");
    const afterWhoami = await run("node", [newBin, "whoami", "--json", "--non-interactive"], { env, timeoutMs: 30_000 });
    assert.equal(afterWhoami.code, 0, `1.0.0 whoami failed:\n${afterWhoami.stderr}`);
    const afterPayload = JSON.parse(afterWhoami.stdout) as { data?: { user?: { id?: string } } };
    assert.equal(afterPayload.data?.user?.id, beforeIdentity, "MCP gateway upgrade did not preserve user identity");
  } finally {
    await rm(prefix, { recursive: true, force: true });
  }
});
