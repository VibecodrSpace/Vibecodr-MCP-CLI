// Tests for preinstall-check.mjs. The script is the npm `preinstall` hook
// the published @vibecodr/cli ships so a user installing on top of an
// existing @vibecodr/vc-tools@0.1.x global install sees a clear, actionable
// error instead of npm's bare EEXIST pointing at the global bin dir.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(here, "..", "preinstall-check.mjs");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runWith(env: Record<string, string>): RunResult {
  // Sanitize the env: spawnSync inherits parent env by default; we want a
  // controlled minimal set so test runs don't accidentally trip on the
  // host machine's real npm state.
  const baseEnv: Record<string, string> = {};
  if (process.env["PATH"]) baseEnv["PATH"] = process.env["PATH"];
  if (process.env["SystemRoot"]) baseEnv["SystemRoot"] = process.env["SystemRoot"];
  if (process.env["APPDATA"]) baseEnv["APPDATA"] = process.env["APPDATA"];
  const result = spawnSync(process.execPath, [scriptPath], {
    env: { ...baseEnv, ...env },
    encoding: "utf8"
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}

test("preinstall-check exits 0 when not a global install", () => {
  const result = runWith({}); // npm_config_global unset
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
});

test("preinstall-check exits 0 when the operator opts out via VIBECDR_SKIP_PREINSTALL_CHECK=1", () => {
  const result = runWith({
    npm_config_global: "true",
    VIBECDR_SKIP_PREINSTALL_CHECK: "1"
  });
  assert.equal(result.code, 0);
});

test("preinstall-check exits 0 when running from inside the source repo", () => {
  // INIT_CWD points at the repo root for a local dev install. The script
  // should bail without running `npm ls` so tests don't depend on the host
  // machine's global npm state.
  const repoRoot = path.resolve(here, "..");
  const result = runWith({
    npm_config_global: "true",
    INIT_CWD: repoRoot
  });
  assert.equal(result.code, 0);
});

test("preinstall-check tolerates `npm ls` failures by exiting 0 (no false-positive blocks)", () => {
  // npm_config_local_prefix points away from the repo so isLocalDevInstall
  // returns false; we force PATH to a directory that can't resolve npm,
  // which makes the spawn fail; the script should still exit 0 because we
  // explicitly catch and ignore npm-ls failures.
  const result = runWith({
    npm_config_global: "true",
    npm_config_local_prefix: path.join(process.env["APPDATA"] ?? "C:\\fallback", "some-other-install"),
    PATH: path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32")
  });
  assert.equal(result.code, 0);
});
