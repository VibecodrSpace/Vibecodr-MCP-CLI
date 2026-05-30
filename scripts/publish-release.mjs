#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const gitCmd = process.platform === "win32" ? "git.exe" : "git";

const args = process.argv.slice(2);
let dryRun = false;
let skipVerify = false;
let tag = packageJson.version.includes("-") ? "next" : "latest";

function usage() {
  console.log(`Publish ${packageJson.name}@${packageJson.version} with npm's interactive auth challenge.

Usage:
  npm run publish:release -- [--tag <latest|next|custom>] [--dry-run] [--skip-verify]

Notes:
  - Security keys, passkeys, and OTP prompts are handled by npm.
  - If NPM_CONFIG_OTP is set for the current process, npm can use it.
  - The helper does not store npm OTPs, generated tokens, or security-key material.`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  }
  if (arg === "--dry-run") {
    dryRun = true;
    continue;
  }
  if (arg === "--skip-verify") {
    skipVerify = true;
    continue;
  }
  if (arg === "--tag") {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      fail("Missing value for --tag.");
    }
    tag = value;
    index += 1;
    continue;
  }
  fail(`Unknown option: ${arg}`);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}

function npmCommand(commandArgs) {
  return process.platform === "win32"
    ? ["cmd.exe", ["/d", "/s", "/c", "npm", ...commandArgs]]
    : ["npm", commandArgs];
}

function runNpm(commandArgs) {
  const [command, argsForCommand] = npmCommand(commandArgs);
  return run(command, argsForCommand);
}

function capture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw result.error;
  }

  return {
    ok: result.status === 0,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function captureNpm(commandArgs) {
  const [command, argsForCommand] = npmCommand(commandArgs);
  return capture(command, argsForCommand);
}

const gitRoot = capture(gitCmd, ["rev-parse", "--show-toplevel"]);
if (!gitRoot.ok || path.resolve(gitRoot.stdout) !== repoRoot) {
  fail(`Refusing to publish outside the CLI repository: ${repoRoot}`);
}

const npmUser = captureNpm(["whoami"]);
if (!npmUser.ok) {
  fail("npm is not authenticated. Run npm login, then try again.");
}

const publishedVersion = captureNpm(["view", packageJson.name, "version"]);
if (!dryRun && publishedVersion.ok && publishedVersion.stdout === packageJson.version) {
  fail(`${packageJson.name}@${packageJson.version} is already published.`);
}

if (!skipVerify) {
  runNpm(["run", "verify"]);
}

runNpm(["run", "clean:pack-artifacts"]);
runNpm(["publish", "--access", "public", "--tag", tag, ...(dryRun ? ["--dry-run"] : [])]);

if (!dryRun) {
  const readback = captureNpm(["view", packageJson.name, "version"]);
  if (!readback.ok || readback.stdout !== packageJson.version) {
    fail(`Publish finished, but npm readback did not show ${packageJson.version}.`);
  }
  console.log(`Published ${packageJson.name}@${packageJson.version} to npm with tag ${tag}.`);
}
