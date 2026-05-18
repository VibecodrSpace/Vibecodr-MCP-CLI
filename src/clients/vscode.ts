import { spawn } from "node:child_process";
import { readJsonFile, requireScope, writeTextFileAtomic, type InstallRequest, type UninstallRequest } from "./base.js";
import { vscodeWorkspaceConfigPath } from "../platform/paths.js";
import type { InstallResult } from "../types/install.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { openExternalUrl } from "../platform/browser.js";
import { commandExists } from "../platform/exec.js";

type VsCodeConfig = {
  servers?: Record<string, { type: "http"; url: string }> | undefined;
};

function runCli(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const useShell = process.platform === "win32";
    const child = spawn(command, args, {
      stdio: "ignore",
      shell: useShell,
      windowsHide: true
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

export async function installVsCode(request: InstallRequest): Promise<InstallResult> {
  requireScope(request.scope, ["user", "project"]);
  if (request.scope === "user") {
    const payload = JSON.stringify({
      name: request.name,
      type: "http",
      url: request.serverUrl
    });
    let method: "cli" | "uri" = "cli";
    if (!request.dryRun) {
      await runCli("code", ["--add-mcp", payload]).catch((error) => {
        if (request.openClient) {
          const uri = `vscode:mcp/install?${encodeURIComponent(payload)}`;
          method = "uri";
          return openExternalUrl(uri);
        }
        throw new CliError("install.vscode_cli_failed", "VS Code CLI install failed.", EXIT_CODES.unsupportedClient, {
          cause: error,
          nextStep: "Ensure the `code` CLI is installed, or retry with --open-client."
        });
      });
    } else if (request.openClient && !commandExists("code")) {
      method = "uri";
    }
    return {
      client: "vscode",
      scope: request.scope,
      name: request.name,
      method,
      changed: true,
      location: method === "cli" ? "code --add-mcp" : "vscode:mcp/install",
      managed: true,
      nextStep: "Use the server in VS Code to trigger VS Code-owned OAuth."
    };
  }

  const location = vscodeWorkspaceConfigPath(request.path || process.cwd());
  const current = await readJsonFile<VsCodeConfig>(location, {});
  const next: VsCodeConfig = {
    ...current,
    servers: {
      ...(current.servers || {}),
      [request.name]: {
        type: "http",
        url: request.serverUrl
      }
    }
  };
  const existing = current.servers?.[request.name];
  if (existing && existing.url !== request.serverUrl && !request.overwrite) {
    throw new CliError("install.conflict", `VS Code already has an MCP entry named ${request.name} with a different URL.`, EXIT_CODES.installConflict, {
      nextStep: "Retry with --overwrite or choose a different --name."
    });
  }
  const changed = JSON.stringify(current) !== JSON.stringify(next);
  if (!request.dryRun && changed) {
    await writeTextFileAtomic(location, JSON.stringify(next, null, 2) + "\n");
  }
  if (request.openClient && !request.dryRun) {
    const payload = JSON.stringify({
      name: request.name,
      type: "http",
      url: request.serverUrl
    });
    await openExternalUrl(`vscode:mcp/install?${encodeURIComponent(payload)}`);
  }
  return {
    client: "vscode",
    scope: request.scope,
    name: request.name,
    method: "file",
    changed,
    location,
    managed: true,
    nextStep: "Use the server in VS Code to trigger VS Code-owned OAuth."
  };
}

export async function uninstallVsCode(request: UninstallRequest, managedLocation?: string, managedMethod?: "cli" | "file"): Promise<InstallResult> {
  requireScope(request.scope, ["user", "project"]);
  if (request.scope === "user" || managedMethod === "cli") {
    throw new CliError("install.conflict", "User-scope VS Code uninstall is not automated yet with documented surfaces.", EXIT_CODES.installConflict, {
      nextStep: "Remove the server from VS Code MCP settings, then rerun uninstall when a documented removal surface exists."
    });
  }
  const location = managedLocation || vscodeWorkspaceConfigPath(request.path || process.cwd());
  const current = await readJsonFile<VsCodeConfig>(location, {});
  if (!current.servers?.[request.name]) {
    return {
      client: "vscode",
      scope: request.scope,
      name: request.name,
      method: "file",
      changed: false,
      location,
      managed: true,
      nextStep: "No managed VS Code workspace entry was present."
    };
  }
  const nextServers = { ...(current.servers || {}) };
  delete nextServers[request.name];
  const next: VsCodeConfig = {
    ...current,
    servers: Object.keys(nextServers).length ? nextServers : undefined
  };
  if (!request.dryRun) {
    await writeTextFileAtomic(location, JSON.stringify(next, null, 2) + "\n");
  }
  return {
    client: "vscode",
    scope: request.scope,
    name: request.name,
    method: "file",
    changed: true,
    location,
    managed: true,
    nextStep: "VS Code workspace config was updated. VS Code-owned auth state is unchanged."
  };
}
