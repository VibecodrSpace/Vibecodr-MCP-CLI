import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import type { InstallManifestEntry, InstallManifestFile } from "../types/install.js";
import { writeFileWithBackup } from "./file-lock.js";
import { VIBECDR_MCP_HOME } from "./migrate.js";

function windowsAppDataPath(): string {
  return process.env["APPDATA"] || join(homedir(), "AppData", "Roaming");
}

function legacyInstallManifestPath(): string {
  switch (process.platform) {
    case "win32":
      return join(windowsAppDataPath(), "Vibecodr", "MCP", "installs.json");
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Vibecodr MCP", "installs.json");
    default:
      return join(process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config"), "vibecodr-mcp", "installs.json");
  }
}

export function defaultInstallManifestPath(): string {
  if (process.env["VIBECDR_MCP_INSTALL_MANIFEST_PATH"]) return process.env["VIBECDR_MCP_INSTALL_MANIFEST_PATH"];
  const canonical = join(VIBECDR_MCP_HOME, "installs.json");
  if (existsSync(canonical)) return canonical;
  const legacy = legacyInstallManifestPath();
  if (existsSync(legacy)) return legacy;
  return canonical;
}

export class InstallManifestStore {
  constructor(private readonly filePath = defaultInstallManifestPath()) {}

  async load(): Promise<InstallManifestFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      let parsed: Partial<InstallManifestFile>;
      try {
        parsed = JSON.parse(raw) as Partial<InstallManifestFile>;
      } catch (error) {
        throw new CliError("install.manifest_parse", `Install manifest at ${this.filePath} is not valid JSON.`, EXIT_CODES.installConflict, {
          cause: error,
          nextStep: "Repair or remove the invalid manifest file, then retry."
        });
      }
      return {
        version: 1,
        installs: Array.isArray(parsed.installs) ? parsed.installs : []
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          version: 1,
          installs: []
        };
      }
      throw error;
    }
  }

  async save(manifest: InstallManifestFile): Promise<void> {
    await writeFileWithBackup(this.filePath, JSON.stringify(manifest, null, 2) + "\n");
  }

  async upsert(entry: InstallManifestEntry): Promise<void> {
    const manifest = await this.load();
    const installs = manifest.installs.filter((install) => !(install.client === entry.client && install.scope === entry.scope && install.name === entry.name && install.location === entry.location));
    installs.push(entry);
    await this.save({
      version: 1,
      installs
    });
  }

  async remove(matcher: (entry: InstallManifestEntry) => boolean): Promise<InstallManifestEntry[]> {
    const manifest = await this.load();
    const removed = manifest.installs.filter(matcher);
    const remaining = manifest.installs.filter((entry) => !matcher(entry));
    await this.save({
      version: 1,
      installs: remaining
    });
    return removed;
  }

  async find(matcher: (entry: InstallManifestEntry) => boolean): Promise<InstallManifestEntry[]> {
    const manifest = await this.load();
    return manifest.installs.filter(matcher);
  }
}
