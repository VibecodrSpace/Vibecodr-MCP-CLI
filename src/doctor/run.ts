import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, resolve } from "node:path";
import { SecretStore } from "../storage/secret-store.js";
import { TokenManager } from "../auth/token-manager.js";
import type { GlobalOptions } from "../types/config.js";
import { claudeDesktopConfigPath, codexConfigPath, cursorUserConfigPath, vscodeWorkspaceConfigPath, windsurfLegacyConfigPath, windsurfUserConfigPath } from "../platform/paths.js";
import { browserLauncherAvailable } from "../platform/browser.js";
import { commandExists } from "../platform/exec.js";

export interface DoctorCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  summary: string;
}

function detectBrowserLauncher(): boolean {
  return browserLauncherAvailable();
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writableAncestor(path: string): Promise<string | undefined> {
  let current = resolve(path);
  while (true) {
    try {
      await access(current, fsConstants.W_OK);
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
}

async function configLocationCheck(path: string, label: string): Promise<DoctorCheck> {
  const writableBase = await writableAncestor(path);
  if (!writableBase) {
    return {
      id: label,
      status: "warn",
      summary: `${path} is not currently writable from this environment.`
    };
  }
  return {
    id: label,
    status: "pass",
    summary: `${path} is reachable via writable base ${writableBase}.`
  };
}

export async function runDoctor(globalOptions: GlobalOptions, tokenManager: TokenManager, secretStore: SecretStore, targetClient?: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const majorVersion = Number(process.versions.node.split(".")[0] || "0");
  checks.push({
    id: "node-version",
    status: majorVersion >= 22 && majorVersion < 26 ? "pass" : "fail",
    summary: `Node ${process.versions.node} detected.`
  });

  checks.push({
    id: "browser-launcher",
    status: detectBrowserLauncher() ? "pass" : "warn",
    summary: detectBrowserLauncher() ? "A browser launcher is available." : "No browser launcher was detected."
  });

  const secretStoreCheck = await secretStore.checkAvailability();
  checks.push({
    id: "secret-store",
    status: secretStoreCheck.ok ? "pass" : "fail",
    summary: secretStoreCheck.summary
  });

  try {
    const { serverUrl } = await tokenManager.resolveProfile(globalOptions);
    const { profileName } = await tokenManager.resolveProfile(globalOptions);
    const session = await tokenManager.getSession(profileName);
    const discovery = await tokenManager.discover(serverUrl);
    checks.push({
      id: "server-reachability",
      status: "pass",
      summary: `Discovered authorization server ${discovery.authorizationServerUrl}.`
    });
    checks.push({
      id: "pkce-supported",
      status: Array.isArray(discovery.authorizationServerMetadata?.code_challenge_methods_supported)
        && discovery.authorizationServerMetadata.code_challenge_methods_supported.includes("S256")
        ? "pass"
        : "fail",
      summary: Array.isArray(discovery.authorizationServerMetadata?.code_challenge_methods_supported)
        && discovery.authorizationServerMetadata.code_challenge_methods_supported.includes("S256")
        ? "Authorization server advertises PKCE S256."
        : "Authorization server metadata does not advertise PKCE S256."
    });
    checks.push({
      id: "refresh-token",
      status: session?.refreshToken ? "pass" : "warn",
      summary: session?.refreshToken ? "A refresh token is available for the current profile." : "No refresh token is stored for the current profile."
    });
  } catch (error) {
    checks.push({
      id: "server-reachability",
      status: "fail",
      summary: error instanceof Error ? error.message : String(error)
    });
  }

  if (targetClient === "codex") {
    checks.push({
      id: "codex-cli",
      status: commandExists("codex") ? "pass" : "warn",
      summary: commandExists("codex") ? "Codex CLI is available." : "Codex CLI is not on PATH."
    });
    checks.push(await configLocationCheck(codexConfigPath(), "codex-config"));
  }
  if (targetClient === "cursor") {
    checks.push(await configLocationCheck(cursorUserConfigPath(), "cursor-config"));
  }
  if (targetClient === "vscode") {
    checks.push({
      id: "vscode-cli",
      status: commandExists("code") ? "pass" : "warn",
      summary: commandExists("code") ? "VS Code CLI is available." : "VS Code CLI is not on PATH."
    });
    checks.push(await configLocationCheck(vscodeWorkspaceConfigPath(process.cwd()), "vscode-workspace-config"));
  }
  if (targetClient === "windsurf") {
    checks.push(await configLocationCheck(windsurfUserConfigPath(), "windsurf-config"));
    checks.push({
      id: "windsurf-legacy-config",
      status: await pathExists(windsurfLegacyConfigPath()) ? "warn" : "pass",
      summary: `Legacy Windsurf plugin path: ${windsurfLegacyConfigPath()}`
    });
  }
  if (targetClient === "claude-desktop") {
    checks.push(await configLocationCheck(claudeDesktopConfigPath(), "claude-desktop-config"));
    checks.push({
      id: "npx-available",
      status: commandExists("npx") ? "pass" : "warn",
      summary: commandExists("npx")
        ? "npx is on PATH (required for the mcp-remote stdio proxy used by Claude Desktop)."
        : "npx is not on PATH. Install Node.js so Claude Desktop can launch the mcp-remote stdio proxy."
    });
  }

  return checks;
}
