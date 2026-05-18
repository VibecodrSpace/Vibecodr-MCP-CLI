import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import {
  defaultConfigFile,
  defaultProfileConfig,
  type ConfigFile,
  type ProfileConfig
} from "../types/config.js";
import { writeFileWithBackup } from "./file-lock.js";
import { VIBECDR_MCP_HOME } from "./migrate.js";

function windowsAppDataPath(): string {
  return process.env["APPDATA"] || join(homedir(), "AppData", "Roaming");
}

function legacyMcpConfigPath(): string {
  switch (process.platform) {
    case "win32":
      return join(windowsAppDataPath(), "Vibecodr", "MCP", "config.json");
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Vibecodr MCP", "config.json");
    default:
      return join(process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config"), "vibecodr-mcp", "config.json");
  }
}

export function defaultConfigPath(): string {
  if (process.env["VIBECDR_MCP_CONFIG_PATH"]) return process.env["VIBECDR_MCP_CONFIG_PATH"];
  const canonical = join(VIBECDR_MCP_HOME, "config.json");
  if (existsSync(canonical)) return canonical;
  const legacy = legacyMcpConfigPath();
  if (existsSync(legacy)) return legacy;
  // Neither exists: first-write lands at the canonical location.
  return canonical;
}

export class ConfigStore {
  constructor(private readonly filePath = defaultConfigPath()) {}

  path(): string {
    return this.filePath;
  }

  async load(): Promise<ConfigFile> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      let parsed: Partial<ConfigFile>;
      try {
        parsed = JSON.parse(raw) as Partial<ConfigFile>;
      } catch (error) {
        throw new CliError("config.parse_failed", `Config file at ${this.filePath} is not valid JSON.`, EXIT_CODES.config, {
          cause: error,
          nextStep: "Repair or remove the invalid config file, then retry."
        });
      }
      if (parsed.version !== 1 || typeof parsed.currentProfile !== "string" || !parsed.profiles) {
        throw new CliError("config.invalid_shape", `Config file at ${this.filePath} has an unsupported shape.`, EXIT_CODES.config, {
          nextStep: "Repair or remove the invalid config file, then retry."
        });
      }
      return {
        version: 1,
        currentProfile: parsed.currentProfile,
        profiles: Object.fromEntries(
          Object.entries(parsed.profiles).map(([name, value]) => [name, { ...defaultProfileConfig(), ...value }])
        )
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return defaultConfigFile();
      throw error;
    }
  }

  async save(config: ConfigFile): Promise<void> {
    await writeFileWithBackup(this.filePath, JSON.stringify(config, null, 2) + "\n");
  }

  async getProfile(profileName?: string): Promise<{ name: string; profile: ProfileConfig; config: ConfigFile }> {
    const config = await this.load();
    const name = profileName || config.currentProfile;
    return {
      name,
      profile: config.profiles[name] || defaultProfileConfig(),
      config
    };
  }
}
