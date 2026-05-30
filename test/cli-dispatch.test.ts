import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distBin = path.join(repoRoot, "dist", "bin");

interface RunResult { code: number | null; stdout: string; stderr: string }

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function run(jsEntry: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [jsEntry, ...args], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("both bin entries are built and runnable", async () => {
  const vibecodrMcp = path.join(distBin, "vibecodr-mcp.js");
  const vcTools = path.join(distBin, "vc-tools.js");
  assert.equal(await exists(vibecodrMcp), true, `expected ${vibecodrMcp} to exist (run npm run build)`);
  assert.equal(await exists(vcTools), true, `expected ${vcTools} to exist (run npm run build)`);

  const vibecodrVersion = await run(vibecodrMcp, ["--version"]);
  assert.equal(vibecodrVersion.code, 0, `vibecodr-mcp --version failed:\n${vibecodrVersion.stderr}`);
  assert.match(vibecodrVersion.stdout.trim(), /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

  const vcToolsVersion = await run(vcTools, ["--version"]);
  assert.equal(vcToolsVersion.code, 0, `vc-tools --version failed:\n${vcToolsVersion.stderr}`);
  assert.match(vcToolsVersion.stdout.trim(), /^vibecodr \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

  // The two bins must agree on the same version number even though they format it differently.
  const vibecodrNum = vibecodrVersion.stdout.trim();
  const vcToolsNum = vcToolsVersion.stdout.trim().replace(/^vibecodr /, "");
  assert.equal(vibecodrNum, vcToolsNum, "vibecodr-mcp and vc-tools bins disagree on version");
});

test("vibecodr bin cross-routes vc-tools commands through the legacy dispatcher", async () => {
  const vibecodrMcp = path.join(distBin, "vibecodr-mcp.js");
  // `vibecodr browser --help` was rejected as "Unknown command" before the merge cross-routing.
  // Post-merge it should reach the legacy dispatcher and exit 0 with the unified help text.
  const result = await run(vibecodrMcp, ["browser", "--help"]);
  assert.equal(result.code, 0, `vibecodr browser --help failed:\n${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /vibecodr browser/);
  assert.match(result.stdout, /browser screenshot|browser read|browser render/);
  assert.match(result.stdout, /--local\|--out \.\/proof/);
  assert.match(result.stdout, /browser snapshot <https-url> \[--local\|--out \.\/proof\]/);
  assert.doesNotMatch(result.stdout, /browser snapshot <https-url> .*instructions/);
  assert.match(result.stdout, /browser notes <https-url> --note <text> \[--local\|--out \.\/proof\]/);
  assert.doesNotMatch(result.stdout, /browser ask <https-url>/);
});

test("vibecodr root help starts with guided consumer paths and keeps power flags", async () => {
  const vibecodrMcp = path.join(distBin, "vibecodr-mcp.js");
  const result = await run(vibecodrMcp, []);
  assert.equal(result.code, 0, `vibecodr help failed:\n${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /Start here:/);
  assert.match(result.stdout, /vibecodr start\s+Approve the Agent Computer account connection/);
  assert.match(result.stdout, /vibecodr status\s+See Agent Computer and MCP Gateway state/);
  assert.match(result.stdout, /Do useful things:/);
  assert.match(result.stdout, /vibecodr browser screenshot https:\/\/example\.com --local/);
  assert.match(result.stdout, /vibecodr feedback/);
  assert.match(result.stdout, /For scripts and advanced use:/);
  assert.match(result.stdout, /--json\s+Stable machine-readable output/);
});

test("vibecodr help routes to the owning command surface", async () => {
  const vibecodrMcp = path.join(distBin, "vibecodr-mcp.js");

  const browser = await run(vibecodrMcp, ["help", "browser"]);
  assert.equal(browser.code, 0, `vibecodr help browser failed:\n${browser.stderr}\n${browser.stdout}`);
  assert.match(browser.stdout, /vibecodr browser/);
  assert.match(browser.stdout, /hosted Browser/);
  assert.match(browser.stdout, /Add --local to save completed output/);
  assert.match(browser.stdout, /does not prompt an agent or model/);
  assert.doesNotMatch(browser.stdout, /chat/);

  const mcp = await run(vibecodrMcp, ["help", "mcp"]);
  assert.equal(mcp.code, 0, `vibecodr help mcp failed:\n${mcp.stderr}\n${mcp.stdout}`);
  assert.match(mcp.stdout, /Vibecodr MCP Gateway/);
  assert.match(mcp.stdout, /mcp tools/);
});

test("vibecodr tools test remains an Agent Computer compatibility route", async () => {
  const vibecodrMcp = path.join(distBin, "vibecodr-mcp.js");
  const result = await run(vibecodrMcp, ["tools", "test", "--help"]);
  assert.equal(result.code, 0, `vibecodr tools test --help failed:\n${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /vibecodr tools test/);
  assert.match(result.stdout, /hosted tool test/);
});

test("vibecodr mcp namespace exposes gateway help", async () => {
  const vibecodrMcp = path.join(distBin, "vibecodr-mcp.js");
  const result = await run(vibecodrMcp, ["mcp", "tools", "--help"]);
  assert.equal(result.code, 0, `vibecodr mcp tools --help failed:\n${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /Usage: vibecodr tools/);
});

test("unknown commands suggest the nearest useful path", async () => {
  const vibecodrMcp = path.join(distBin, "vibecodr-mcp.js");

  const typo = await run(vibecodrMcp, ["stats"]);
  assert.notEqual(typo.code, 0);
  assert.match(typo.stderr, /Unknown command: stats/);
  assert.match(typo.stderr, /Try `vibecodr status`/);

  const mcpTypo = await run(vibecodrMcp, ["mcp", "tool"]);
  assert.notEqual(mcpTypo.code, 0);
  assert.match(mcpTypo.stderr, /Unknown MCP Gateway command: tool/);
  assert.match(mcpTypo.stderr, /Try `vibecodr mcp tools`/);
});

test("vibecodr login and logout expose explicit auth lanes", async () => {
  const vibecodrMcp = path.join(distBin, "vibecodr-mcp.js");

  const mcpLogin = await run(vibecodrMcp, ["login", "mcp", "--help"]);
  assert.equal(mcpLogin.code, 0, `vibecodr login mcp --help failed:\n${mcpLogin.stderr}\n${mcpLogin.stdout}`);
  assert.match(mcpLogin.stdout, /vibecodr login \[mcp\]/);

  const agentLogin = await run(vibecodrMcp, ["login", "agent", "--help"]);
  assert.equal(agentLogin.code, 0, `vibecodr login agent --help failed:\n${agentLogin.stderr}\n${agentLogin.stdout}`);
  assert.match(agentLogin.stdout, /Plain login opens the browser\/device approval flow/);

  const agentLogout = await run(vibecodrMcp, ["logout", "agent", "--help"]);
  assert.equal(agentLogout.code, 0, `vibecodr logout agent --help failed:\n${agentLogout.stderr}\n${agentLogout.stdout}`);
  assert.match(agentLogout.stdout, /Remove the saved Agent Computer approval/);
});

test("cross-routed Agent Computer commands preserve shared JSON and non-interactive flags", async () => {
  const vibecodrMcp = path.join(distBin, "vibecodr-mcp.js");
  const result = await run(vibecodrMcp, ["browser", "--help", "--json", "--non-interactive"]);
  assert.equal(result.code, 0, `vibecodr browser --help --json failed:\n${result.stderr}\n${result.stdout}`);
  const parsed = JSON.parse(result.stdout) as { ok: boolean; data?: { topic?: string } };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data?.topic, "browser");
});

test("vibecodr bin still rejects truly unknown commands", async () => {
  const vibecodrMcp = path.join(distBin, "vibecodr-mcp.js");
  const result = await run(vibecodrMcp, ["definitely-not-a-real-command-xyz"]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Unknown command/);
});
