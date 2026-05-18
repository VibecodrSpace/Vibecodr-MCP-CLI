import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { VIBECDR_MCP_HOME } from "../storage/migrate.js";

function windowsAppDataPath(): string {
  return process.env["APPDATA"] || join(homedir(), "AppData", "Roaming");
}

function legacyVibecodrConfigRoot(): string {
  switch (process.platform) {
    case "win32":
      return join(windowsAppDataPath(), "Vibecodr", "MCP");
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Vibecodr MCP");
    default:
      return join(process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config"), "vibecodr-mcp");
  }
}

function vibecodrConfigRoot(): string {
  if (existsSync(VIBECDR_MCP_HOME)) return VIBECDR_MCP_HOME;
  const legacy = legacyVibecodrConfigRoot();
  if (existsSync(legacy)) return legacy;
  return VIBECDR_MCP_HOME;
}

export function codexConfigPath(): string {
  return join(homedir(), ".codex", "config.toml");
}

export function cursorUserConfigPath(): string {
  return join(homedir(), ".cursor", "mcp.json");
}

export function vscodeWorkspaceConfigPath(rootPath: string): string {
  return join(rootPath, ".vscode", "mcp.json");
}

export function windsurfUserConfigPath(): string {
  return join(homedir(), ".codeium", "windsurf", "mcp_config.json");
}

export function windsurfLegacyConfigPath(): string {
  return join(homedir(), ".codeium", "mcp_config.json");
}

export function projectCursorConfigPath(rootPath: string): string {
  return join(rootPath, ".cursor", "mcp.json");
}

export function claudeDesktopConfigPath(): string {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
    case "win32":
      return join(windowsAppDataPath(), "Claude", "claude_desktop_config.json");
    default: {
      const xdg = process.env["XDG_CONFIG_HOME"] || join(homedir(), ".config");
      return join(xdg, "Claude", "claude_desktop_config.json");
    }
  }
}

export function secretStoreDirectory(): string {
  return join(vibecodrConfigRoot(), "secrets");
}
