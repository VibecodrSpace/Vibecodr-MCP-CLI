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
  assert.match(vcToolsVersion.stdout.trim(), /^vc-tools \d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

  // The two bins must agree on the same version number even though they format it differently.
  const vibecodrNum = vibecodrVersion.stdout.trim();
  const vcToolsNum = vcToolsVersion.stdout.trim().replace(/^vc-tools /, "");
  assert.equal(vibecodrNum, vcToolsNum, "vibecodr-mcp and vc-tools bins disagree on version");
});

test("vibecodr bin cross-routes vc-tools commands through the legacy dispatcher", async () => {
  const vibecodrMcp = path.join(distBin, "vibecodr-mcp.js");
  // `vibecodr browser --help` was rejected as "Unknown command" before the merge cross-routing.
  // Post-merge it should reach the legacy dispatcher and exit 0 with vc-tools-style help text.
  const result = await run(vibecodrMcp, ["browser", "--help"]);
  assert.equal(result.code, 0, `vibecodr browser --help failed:\n${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /vc-tools browser/);
  assert.match(result.stdout, /browser screenshot|browser read|browser render/);
});

test("vibecodr bin still rejects truly unknown commands", async () => {
  const vibecodrMcp = path.join(distBin, "vibecodr-mcp.js");
  const result = await run(vibecodrMcp, ["definitely-not-a-real-command-xyz"]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Unknown command/);
});
