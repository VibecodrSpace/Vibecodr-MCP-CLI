// One-shot legacy-dir migration. On first invocation, copies the pre-merge
// vc-tools and MCP-CLI config dirs into the unified ~/.vibecodr/{tools,mcp}/
// tree and renames each legacy source to <root>.bak so the legacy code paths
// can't accidentally re-read stale state. Idempotent: if the canonical
// destination already exists, the call is a no-op.
//
// The bin entries call migrateLegacyDirsOnce() at startup; the path
// resolvers in storage/config-store.ts, storage/install-manifest.ts,
// platform/paths.ts, and legacy/config/store.ts each prefer the canonical
// location when present and fall back to the legacy location otherwise. So
// the bin entries observe migration; the tests do not (they set the
// VC_TOOLS_CONFIG_DIR / VIBECDR_MCP_CONFIG_PATH env vars and short-circuit
// the canonical/legacy resolution).
//
// Plan §3 anchors this; the canonical destination is ~/.vibecodr/.

import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const VIBECDR_HOME = path.join(homedir(), ".vibecodr");
export const VIBECDR_TOOLS_HOME = path.join(VIBECDR_HOME, "tools");
export const VIBECDR_MCP_HOME = path.join(VIBECDR_HOME, "mcp");

function windowsAppDataPath(env: NodeJS.ProcessEnv): string {
  return env["APPDATA"] ?? path.join(homedir(), "AppData", "Roaming");
}

export function legacyVcToolsRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  if (process.platform === "win32") {
    return [path.join(windowsAppDataPath(env), "vc-tools")];
  }
  const xdg = env["XDG_CONFIG_HOME"] ?? path.join(homedir(), ".config");
  return [path.join(xdg, "vc-tools")];
}

export function legacyMcpRoots(env: NodeJS.ProcessEnv = process.env): string[] {
  if (process.platform === "win32") {
    return [path.join(windowsAppDataPath(env), "Vibecodr", "MCP")];
  }
  if (process.platform === "darwin") {
    return [path.join(homedir(), "Library", "Application Support", "Vibecodr MCP")];
  }
  const xdg = env["XDG_CONFIG_HOME"] ?? path.join(homedir(), ".config");
  return [path.join(xdg, "vibecodr-mcp")];
}

let migrationPromise: Promise<void> | undefined;

export interface MigrateOptions {
  env?: NodeJS.ProcessEnv;
  // Test-only: override the canonical destination directory tree.
  toolsHome?: string;
  mcpHome?: string;
  vcToolsLegacyRoots?: string[];
  mcpLegacyRoots?: string[];
}

export async function migrateLegacyDirsOnce(options: MigrateOptions = {}): Promise<void> {
  if (!options.env && !options.toolsHome && !options.mcpHome && !options.vcToolsLegacyRoots && !options.mcpLegacyRoots) {
    // Production path: dedupe via the module-level promise so concurrent bin
    // imports (unlikely but possible during testing harnesses) don't race.
    migrationPromise ??= runMigration(options);
    await migrationPromise;
    return;
  }
  // Test path: fresh state every call.
  await runMigration(options);
}

async function runMigration(options: MigrateOptions): Promise<void> {
  const env = options.env ?? process.env;
  const toolsHome = options.toolsHome ?? VIBECDR_TOOLS_HOME;
  const mcpHome = options.mcpHome ?? VIBECDR_MCP_HOME;
  const vcToolsLegacy = options.vcToolsLegacyRoots ?? legacyVcToolsRoots(env);
  const mcpLegacy = options.mcpLegacyRoots ?? legacyMcpRoots(env);

  await migrateOne(toolsHome, vcToolsLegacy);
  await migrateOne(mcpHome, mcpLegacy);
}

async function migrateOne(canonical: string, legacyRoots: string[]): Promise<void> {
  if (existsSync(canonical)) return;
  for (const legacy of legacyRoots) {
    if (!existsSync(legacy)) continue;
    await fs.mkdir(path.dirname(canonical), { recursive: true });
    await fs.cp(legacy, canonical, { recursive: true });
    const bakTarget = await uniqueBakPath(legacy);
    await fs.rename(legacy, bakTarget);
    return;
  }
}

async function uniqueBakPath(source: string): Promise<string> {
  const baseBak = `${source}.bak`;
  if (!existsSync(baseBak)) return baseBak;
  for (let counter = 1; counter < 1000; counter += 1) {
    const candidate = `${baseBak}.${counter}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`Could not find a non-conflicting backup path for ${source}.bak`);
}

// Test-only: clear the module-level migration promise so a follow-up
// migrateLegacyDirsOnce() call re-runs.
export function __resetMigrationStateForTests(): void {
  migrationPromise = undefined;
}
