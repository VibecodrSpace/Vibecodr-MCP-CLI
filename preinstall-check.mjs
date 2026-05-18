// Runs as the npm `preinstall` lifecycle script before file copy. Catches two
// install-blocking scenarios for `npm install -g @vibecodr/cli` and exits
// with an actionable message instead of leaving the user staring at npm's
// bare EEXIST:
//
//   1. Legacy install: @vibecodr/vc-tools@0.1.x is globally installed. That
//      package and @vibecodr/cli@1.x both register a `vc-tools` bin under
//      the same path; npm refuses to overwrite a bin owned by a different
//      package.
//   2. Orphan shims from a prior aborted install: an earlier `npm install
//      -g @vibecodr/cli` (or @vibecodr/vc-tools) wrote some of the
//      `vc-tools` / `vibecodr` / `vibecodr-mcp` shim files at the global
//      bin dir then died on Windows-handle-locked file cleanup. The
//      orphan files block the retry with EEXIST even though no package
//      currently claims them.
//
// Bail-outs (the check is a no-op in any of these cases):
//   - VIBECDR_SKIP_PREINSTALL_CHECK=1 (operator opt-out)
//   - not a global install (the conflict is global-bin-only)
//   - running from inside this source repo (npm install / npm ci during
//     local dev shouldn't trip the check)
//   - any inspection failure (`npm ls`, fs access) -- we never block a
//     legitimate install on a transient diagnostic error

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKIP_ENV = "VIBECDR_SKIP_PREINSTALL_CHECK";
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = here;

function isLocalDevInstall() {
  // The npm lifecycle sets npm_config_local_prefix (or INIT_CWD) to the
  // directory holding the package.json being installed FROM. For
  // npm ci / npm install run inside this repo, that prefix equals our
  // repo root.
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

// ---------------------------------------------------------------------------
// Scenario 1: legacy @vibecodr/vc-tools@0.1.x globally installed
// ---------------------------------------------------------------------------

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

if (collidingVersion) {
  printLegacyConflictMessage(collidingVersion);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Scenario 2: orphan vc-tools / vibecodr / vibecodr-mcp shims at the global
// bin dir with no @vibecodr/cli package currently installed to own them
// ---------------------------------------------------------------------------

function npmGlobalBinDir() {
  // Windows: <prefix>/. POSIX: <prefix>/bin.
  const prefix = process.env["npm_config_prefix"];
  if (!prefix) return undefined;
  return process.platform === "win32" ? prefix : path.join(prefix, "bin");
}

function npmGlobalRoot() {
  const prefix = process.env["npm_config_prefix"];
  if (!prefix) return undefined;
  return process.platform === "win32"
    ? path.join(prefix, "node_modules")
    : path.join(prefix, "lib", "node_modules");
}

function vibecodrCliInstalledAndValid() {
  const root = npmGlobalRoot();
  if (!root) return true; // can't determine -> don't block
  const pkgPath = path.join(root, "@vibecodr", "cli", "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return pkg?.name === "@vibecodr/cli";
  } catch {
    return false;
  }
}

const SHIM_NAMES_WIN = ["vc-tools", "vc-tools.cmd", "vc-tools.ps1", "vibecodr", "vibecodr.cmd", "vibecodr.ps1", "vibecodr-mcp", "vibecodr-mcp.cmd", "vibecodr-mcp.ps1"];
const SHIM_NAMES_POSIX = ["vc-tools", "vibecodr", "vibecodr-mcp"];

function detectOrphanShims() {
  const dir = npmGlobalBinDir();
  if (!dir) return [];
  const candidates = process.platform === "win32" ? SHIM_NAMES_WIN : SHIM_NAMES_POSIX;
  return candidates.filter((name) => existsSync(path.join(dir, name)));
}

const presentShims = detectOrphanShims();
if (presentShims.length > 0 && !vibecodrCliInstalledAndValid()) {
  // Shim files exist at the global bin dir but no @vibecodr/cli package
  // exists in global node_modules to own them. They're either from an
  // earlier aborted install of @vibecodr/cli or a manually-deleted
  // package that didn't clean its shims. Either way, the retry will
  // EEXIST unless the user removes them first.
  printOrphanShimMessage(npmGlobalBinDir(), npmGlobalRoot(), presentShims);
  process.exit(1);
}

// No conflict detected; let npm proceed.
process.exit(0);

// ---------------------------------------------------------------------------
// Message helpers (separated so the test file can exercise the gate logic
// without diffing the multi-line console output)
// ---------------------------------------------------------------------------

function printLegacyConflictMessage(version) {
  console.error("");
  console.error("==========================================================================");
  console.error("  @vibecodr/cli install blocked: legacy @vibecodr/vc-tools is in the way");
  console.error("==========================================================================");
  console.error("");
  console.error(`  You have @vibecodr/vc-tools@${version} installed globally. That`);
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
}

function printOrphanShimMessage(binDir, root, shims) {
  console.error("");
  console.error("==========================================================================");
  console.error("  @vibecodr/cli install blocked: orphan bin shims from a prior install");
  console.error("==========================================================================");
  console.error("");
  console.error("  These bin shim files exist in your global npm bin directory but no");
  console.error("  @vibecodr/cli package is currently installed to own them:");
  console.error("");
  for (const name of shims) {
    console.error(`    ${path.join(binDir, name)}`);
  }
  console.error("");
  console.error("  They are typically left behind when an earlier global install of");
  console.error("  @vibecodr/cli or @vibecodr/vc-tools was aborted mid-flight (Windows");
  console.error("  file-handle locks during npm cleanup are the common cause). npm");
  console.error("  refuses to overwrite shim files it didn't create in the current");
  console.error("  install run, so the retry trips the same EEXIST every time.");
  console.error("");
  console.error("  To unblock on Windows (PowerShell):");
  console.error("");
  for (const name of shims) {
    console.error(`    Remove-Item "${path.join(binDir, name)}" -Force`);
  }
  if (root) {
    const halfInstall = path.join(root, "@vibecodr", "cli");
    if (existsSync(halfInstall)) {
      console.error(`    Remove-Item "${halfInstall}" -Recurse -Force`);
    }
  }
  console.error("    npm install -g @vibecodr/cli");
  console.error("");
  console.error("  On macOS / Linux (bash):");
  console.error("");
  for (const name of shims) {
    console.error(`    rm -f "${path.join(binDir, name)}"`);
  }
  if (root) {
    const halfInstall = path.join(root, "@vibecodr", "cli");
    if (existsSync(halfInstall)) {
      console.error(`    rm -rf "${halfInstall}"`);
    }
  }
  console.error("    npm install -g @vibecodr/cli");
  console.error("");
  console.error("  If the rm or Remove-Item fails with EPERM/locked-file errors, close");
  console.error("  any IDE / terminal that has run vibecodr, vibecodr-mcp, or vc-tools");
  console.error("  recently (the OS may still hold handles on the shim files), then");
  console.error("  retry.");
  console.error("");
  console.error("  Advanced opt-out (not recommended): set VIBECDR_SKIP_PREINSTALL_CHECK=1");
  console.error("  and retry. The shim collision still trips an EEXIST inside npm; the");
  console.error("  env var only silences this preflight check.");
  console.error("");
  console.error("==========================================================================");
  console.error("");
}
