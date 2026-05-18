import { join } from "node:path";
import { readJsonFile, requireScope, writeTextFileAtomic, type InstallRequest, type UninstallRequest } from "./base.js";
import { claudeDesktopConfigPath } from "../platform/paths.js";
import type { InstallResult } from "../types/install.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";

// Claude Desktop does NOT load remote HTTP MCP servers from claude_desktop_config.json.
// The documented workaround is the mcp-remote stdio proxy (modelcontextprotocol.io/docs/develop/connect-remote-servers).
// Users who prefer a managed connection can also add the URL via Settings -> Connectors in the desktop app.
type ClaudeDesktopEntry = {
  command: string;
  args: string[];
};

type ClaudeDesktopConfig = {
  mcpServers?: Record<string, ClaudeDesktopEntry | { command?: string; args?: string[]; url?: string }> | undefined;
};

function buildEntry(serverUrl: string): ClaudeDesktopEntry {
  return {
    command: "npx",
    args: ["mcp-remote", serverUrl]
  };
}

function resolvedConfigPath(request: { path?: string | undefined }): string {
  return request.path ? join(request.path, "claude_desktop_config.json") : claudeDesktopConfigPath();
}

function entriesMatch(existing: ClaudeDesktopEntry | { command?: string; args?: string[]; url?: string }, next: ClaudeDesktopEntry): boolean {
  if (!existing || typeof existing !== "object") return false;
  const candidate = existing as ClaudeDesktopEntry;
  return candidate.command === next.command
    && Array.isArray(candidate.args)
    && candidate.args.length === next.args.length
    && candidate.args.every((value, index) => value === next.args[index]);
}

export async function installClaudeDesktop(request: InstallRequest): Promise<InstallResult> {
  requireScope(request.scope, ["user"]);
  const location = resolvedConfigPath(request);
  const current = await readJsonFile<ClaudeDesktopConfig>(location, {});
  const next: ClaudeDesktopEntry = buildEntry(request.serverUrl);
  const existing = current.mcpServers?.[request.name];
  if (existing && !entriesMatch(existing, next) && !request.overwrite) {
    throw new CliError("install.conflict", `Claude Desktop already has an MCP entry named ${request.name} with a different value.`, EXIT_CODES.installConflict, {
      nextStep: "Retry with --overwrite or choose a different --name."
    });
  }
  const nextConfig: ClaudeDesktopConfig = {
    ...current,
    mcpServers: {
      ...(current.mcpServers || {}),
      [request.name]: next
    }
  };
  const changed = JSON.stringify(current) !== JSON.stringify(nextConfig);
  if (!request.dryRun && changed) {
    await writeTextFileAtomic(location, JSON.stringify(nextConfig, null, 2) + "\n");
  }
  const notes: string[] = [];
  if (process.platform !== "darwin" && process.platform !== "win32" && !request.path) {
    notes.push("Anthropic does not ship an official Claude Desktop build for Linux. This config was written to the path used by community repackages; if you are not running such a build, install Claude Code instead.");
  }
  return {
    client: "claude-desktop",
    scope: request.scope,
    name: request.name,
    method: "file",
    changed,
    location,
    managed: true,
    nextStep: "Restart Claude Desktop. The entry uses the mcp-remote stdio proxy because Claude Desktop does not load remote HTTP MCP servers directly; Node.js (npx) must be on PATH. Alternatively, add the MCP URL via Settings -> Connectors -> Add custom connector.",
    ...(notes.length ? { notes } : {})
  };
}

export async function uninstallClaudeDesktop(request: UninstallRequest, managedLocation?: string): Promise<InstallResult> {
  requireScope(request.scope, ["user"]);
  const location = managedLocation || resolvedConfigPath(request);
  const current = await readJsonFile<ClaudeDesktopConfig>(location, {});
  if (!current.mcpServers?.[request.name]) {
    return {
      client: "claude-desktop",
      scope: request.scope,
      name: request.name,
      method: "file",
      changed: false,
      location,
      managed: true,
      nextStep: "No managed Claude Desktop entry was present."
    };
  }
  const nextServers = { ...(current.mcpServers || {}) };
  delete nextServers[request.name];
  const nextConfig: ClaudeDesktopConfig = {
    ...current,
    mcpServers: Object.keys(nextServers).length ? nextServers : undefined
  };
  if (!request.dryRun) {
    await writeTextFileAtomic(location, JSON.stringify(nextConfig, null, 2) + "\n");
  }
  return {
    client: "claude-desktop",
    scope: request.scope,
    name: request.name,
    method: "file",
    changed: true,
    location,
    managed: true,
    nextStep: "Claude Desktop config was updated. Restart Claude Desktop to drop the connection."
  };
}
