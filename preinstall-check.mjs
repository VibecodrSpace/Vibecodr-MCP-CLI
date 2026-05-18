// Runs as the npm `preinstall` lifecycle script before file copy. Detects the
// global-install collision where a pre-merger @vibecodr/vc-tools@0.1.x owns
// the `vc-tools` bin shim and would block npm from writing the
// @vibecodr/cli@1.x version of the same bin (npm refuses to overwrite a bin
// owned by a different package; the user otherwise sees an unhelpful EEXIST
// pointing at a file in the global bin dir). Exits non-zero with an
// actionable message so npm aborts cleanly with our text instead of npm's.
//
// Bail-outs (the check is a no-op in any of these cases):
//   - VIBECDR_SKIP_PREINSTALL_CHECK=1 (operator opt-out)
//   - not a global install (the conflict is global-bin-only)
//   - running from inside this source repo (npm install / npm ci during
//     local dev shouldn't trip the check)
//   - npm ls fails for any other reason (we don't want a transient npm
//     error to block legitimate installs)

import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_ENV = "VIBECDR_SKIP_PREINSTALL_CHECK";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = here;

function isLocalDevInstall() {
  // The npm lifecycle sets npm_config_local_prefix (or PROJECT) to the
  // directory holding the package.json being installed FROM. For npm ci/install
  // run inside this repo, that prefix equals our repo root.
  const localPrefix = process.env["npm_config_local_prefix"] ?? process.env["INIT_CWD"];
  if (!localPrefix) return false;
  try {
    return path.resolve(localPrefix) === repoRoot;
  } catch {
    return false;
  }
}

function isGlobalInstall() {
  return process.env["npm_config_global"] === "true";
}

if (process.env[SKIP_ENV] === "1") {
  process.exit(0);
}
if (!isGlobalInstall()) {
  process.exit(0);
}
if (isLocalDevInstall()) {
  process.exit(0);
}

let collidingVersion;
try {
  const output = execSync("npm ls -g --depth 0 --json @vibecodr/vc-tools", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  const parsed = JSON.parse(output);
  const entry = parsed?.dependencies?.["@vibecodr/vc-tools"];
  if (entry && typeof entry.version === "string") {
    // 0.2.x is the tombstone forwarder package; it depends on @vibecodr/cli
    // and is the intended migration path. Only block on the legacy 0.1.x line
    // (and a defensive guard against any pre-0.2 versions we never published).
    if (entry.version.startsWith("0.1.")) {
      collidingVersion = entry.version;
    }
  }
} catch {
  // npm ls exits non-zero when the package isn't installed; treat as no
  // conflict.
}

if (!collidingVersion) {
  process.exit(0);
}

console.error("");
console.error("==========================================================================");
console.error("  @vibecodr/cli install blocked: legacy @vibecodr/vc-tools is in the way");
console.error("==========================================================================");
console.error("");
console.error(`  You have @vibecodr/vc-tools@${collidingVersion} installed globally. That`);
console.error("  package and @vibecodr/cli@1.x both claim the `vc-tools` bin name on");
console.error("  disk, and npm refuses to overwrite a bin owned by a different package");
console.error("  (you would otherwise see a cryptic EEXIST pointing at the global bin");
console.error("  dir).");
console.error("");
console.error("  The merged @vibecodr/cli replaces the legacy @vibecodr/vc-tools. The");
console.error("  legacy line is preserved on npm under explicit version pins; nothing");
console.error("  about your stored credentials, OS keychain entries, or config dirs is");
console.error("  removed by the uninstall below.");
console.error("");
console.error("  To unblock, in this order:");
console.error("");
console.error("    npm uninstall -g @vibecodr/vc-tools");
console.error("    npm install -g @vibecodr/cli");
console.error("");
console.error("  After install, all three bin names work and resolve to the same");
console.error("  dispatcher: vibecodr, vibecodr-mcp, vc-tools.");
console.error("");
console.error("  Advanced opt-out (not recommended): set VIBECDR_SKIP_PREINSTALL_CHECK=1");
console.error("  and retry. The collision still trips an EEXIST inside npm; the env var");
console.error("  only silences this preflight check.");
console.error("");
console.error("==========================================================================");
console.error("");
process.exit(1);
