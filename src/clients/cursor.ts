import { join } from "node:path";
import { readJsonFile, requireScope, writeTextFileAtomic, type InstallRequest, type UninstallRequest } from "./base.js";
import { cursorUserConfigPath, projectCursorConfigPath } from "../platform/paths.js";
import type { InstallResult } from "../types/install.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { openExternalUrl } from "../platform/browser.js";

type CursorConfig = {
  mcpServers?: Record<string, { url: string }> | undefined;
};

function configPath(scope: "user" | "project", rootPath?: string): string {
  if (scope === "user") {
    return rootPath ? join(rootPath, "mcp.json") : cursorUserConfigPath();
  }
  return projectCursorConfigPath(rootPath || process.cwd());
}

export async function installCursor(request: InstallRequest): Promise<InstallResult> {
  requireScope(request.scope, ["user", "project"]);
  const location = configPath(request.scope, request.path);
  const current = await readJsonFile<CursorConfig>(location, {});
  const next: CursorConfig = {
    ...current,
    mcpServers: {
      ...(current.mcpServers || {}),
      [request.name]: {
        url: request.serverUrl
      }
    }
  };
  const existing = current.mcpServers?.[request.name];
  if (existing && existing.url !== request.serverUrl && !request.overwrite) {
    throw new CliError("install.conflict", `Cursor already has an MCP entry named ${request.name} with a different URL.`, EXIT_CODES.installConflict, {
      nextStep: "Retry with --overwrite or choose a different --name."
    });
  }
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (!request.dryRun && changed) {
    await writeTextFileAtomic(location, JSON.stringify(next, null, 2) + "\n");
  }
  if (request.openClient && !request.dryRun) {
    const deeplink = new URL("cursor://anysphere.cursor-deeplink/mcp/install");
    deeplink.searchParams.set("name", request.name);
    deeplink.searchParams.set("config", JSON.stringify({
      url: request.serverUrl
    }));
    await openExternalUrl(deeplink.toString());
  }
  return {
    client: "cursor",
    scope: request.scope,
    name: request.name,
    method: "file",
    changed,
    location,
    managed: true,
    nextStep: "Use the server in Cursor to trigger Cursor-owned OAuth."
  };
}

export async function uninstallCursor(request: UninstallRequest, managedLocation?: string): Promise<InstallResult> {
  requireScope(request.scope, ["user", "project"]);
  const location = managedLocation || configPath(request.scope, request.path);
  const current = await readJsonFile<CursorConfig>(location, {});
  const existing = current.mcpServers?.[request.name];
  if (!existing) {
    return {
      client: "cursor",
      scope: request.scope,
      name: request.name,
      method: "file",
      changed: false,
      location,
      managed: true,
      nextStep: "No managed Cursor entry was present."
    };
  }
  const nextServers = { ...(current.mcpServers || {}) };
  delete nextServers[request.name];
  const next: CursorConfig = {
    ...current,
    mcpServers: Object.keys(nextServers).length ? nextServers : undefined
  };
  if (!request.dryRun) {
    await writeTextFileAtomic(location, JSON.stringify(next, null, 2) + "\n");
  }
  return {
    client: "cursor",
    scope: request.scope,
    name: request.name,
    method: "file",
    changed: true,
    location,
    managed: true,
    nextStep: "Cursor config was updated. Cursor-owned auth state is unchanged."
  };
}
