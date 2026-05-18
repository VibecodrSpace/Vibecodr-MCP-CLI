import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CliError } from "./errors.js";

export type ClientId =
  | "codex"
  | "cursor"
  | "vscode"
  | "windsurf"
  | "claude-desktop"
  | "claude-code";

export const INSTALLABLE_CLIENTS: ClientId[] = [
  "codex",
  "cursor",
  "vscode",
  "windsurf",
  "claude-desktop",
  "claude-code"
];

export interface InstallRequest {
  client: ClientId;
  serverUrl: string;
  serverName: string;
  installDir?: string | undefined;
  overwrite?: boolean | undefined;
  dryRun?: boolean | undefined;
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

export type InstallMethod = "file" | "cli";

export interface InstallResult {
  client: ClientId;
  method: InstallMethod;
  changed: boolean;
  location: string;
  nextStep: string;
  backupPath?: string | undefined;
}

export function isInstallableClient(value: string): value is ClientId {
  return (INSTALLABLE_CLIENTS as readonly string[]).includes(value);
}

export async function installClient(request: InstallRequest): Promise<InstallResult> {
  switch (request.client) {
    case "codex":
      return installCodex(request);
    case "cursor":
      return installCursor(request);
    case "vscode":
      return installVsCode(request);
    case "windsurf":
      return installWindsurf(request);
    case "claude-desktop":
      return installClaudeDesktop(request);
    case "claude-code":
      return installClaudeCode(request);
    default:
      throw new CliError(
        "install.unsupported_client",
        `Automatic install is not supported for client "${String((request as InstallRequest).client)}". Supported: ${INSTALLABLE_CLIENTS.join(", ")}.`,
        2
      );
  }
}

async function installCodex(request: InstallRequest): Promise<InstallResult> {
  if (!request.dryRun && commandExists("codex", request.env)) {
    try {
      await runCli("codex", ["mcp", "add", request.serverName, "--url", request.serverUrl], request.env);
      return {
        client: "codex",
        method: "cli",
        changed: true,
        location: "codex mcp add",
        nextStep: "Restart Codex or start a new session to load the Agent Computer."
      };
    } catch (error) {
      throw new CliError(
        "install.codex_cli_failed",
        `codex mcp add failed: ${formatErrorMessage(error)}. Re-run with --print to copy the config manually, or install/repair the codex CLI.`,
        5
      );
    }
  }

  if (request.dryRun) {
    return {
      client: "codex",
      method: "cli",
      changed: false,
      location: "codex mcp add",
      nextStep: "Dry run: would call codex mcp add to register the Agent Computer."
    };
  }

  throw new CliError(
    "install.codex_cli_missing",
    "Codex CLI is not on PATH. Install Codex first, then re-run vc-tools agent connect --client codex, or use --print to copy the MCP config manually.",
    5
  );
}

async function installClaudeCode(request: InstallRequest): Promise<InstallResult> {
  if (!request.dryRun && commandExists("claude", request.env)) {
    try {
      await runCli("claude", ["mcp", "add", "--transport", "http", request.serverName, request.serverUrl], request.env);
      return {
        client: "claude-code",
        method: "cli",
        changed: true,
        location: "claude mcp add",
        nextStep: "Start a new Claude Code session in this workspace to load the Agent Computer."
      };
    } catch (error) {
      throw new CliError(
        "install.claude_code_cli_failed",
        `claude mcp add failed: ${formatErrorMessage(error)}. Re-run with --print to copy the config manually, or repair the claude CLI.`,
        5
      );
    }
  }

  if (request.dryRun) {
    return {
      client: "claude-code",
      method: "cli",
      changed: false,
      location: "claude mcp add",
      nextStep: "Dry run: would call claude mcp add to register the Agent Computer."
    };
  }

  throw new CliError(
    "install.claude_code_cli_missing",
    "Claude Code CLI is not on PATH. Install Claude Code first, then re-run vc-tools agent connect --client claude-code, or use --print to copy the MCP config manually.",
    5
  );
}

interface JsonConfig {
  [key: string]: unknown;
}

interface MergeOptions {
  rootKey: "mcpServers" | "servers";
  entryShape: (serverUrl: string) => Record<string, unknown>;
}

async function mergeJsonConfig(
  request: InstallRequest,
  location: string,
  options: MergeOptions
): Promise<{ changed: boolean; backupPath?: string | undefined }> {
  const current = await readJsonFile(location);
  const root = isPlainObject(current[options.rootKey]) ? (current[options.rootKey] as JsonConfig) : {};
  const existing = root[request.serverName];
  const nextEntry = options.entryShape(request.serverUrl);

  if (isPlainObject(existing) && JSON.stringify(existing) !== JSON.stringify(nextEntry) && !request.overwrite) {
    throw new CliError(
      "install.conflict",
      `${request.client} already has an MCP entry named "${request.serverName}" with a different value at ${location}. Re-run with --overwrite to replace it, or pass --name <other> to register under a different name.`,
      5
    );
  }

  const nextRoot = { ...root, [request.serverName]: nextEntry };
  const next: JsonConfig = { ...current, [options.rootKey]: nextRoot };
  const beforeText = Object.keys(current).length === 0 ? "" : JSON.stringify(current, null, 2);
  const afterText = JSON.stringify(next, null, 2) + "\n";
  if (beforeText && beforeText + "\n" === afterText) {
    return { changed: false };
  }

  if (request.dryRun) {
    return { changed: true };
  }

  let backupPath: string | undefined;
  if (beforeText.length > 0) {
    backupPath = `${location}.vc-tools.bak`;
    await fs.writeFile(backupPath, beforeText + "\n", { encoding: "utf8", mode: 0o600 });
  }
  await fs.mkdir(path.dirname(location), { recursive: true, mode: 0o700 });
  await atomicWrite(location, afterText);
  return { changed: true, backupPath };
}

async function installCursor(request: InstallRequest): Promise<InstallResult> {
  const location = request.installDir
    ? path.join(request.installDir, "mcp.json")
    : path.join(homeDir(request.env), ".cursor", "mcp.json");
  const result = await mergeJsonConfig(request, location, {
    rootKey: "mcpServers",
    entryShape: (serverUrl) => ({ url: serverUrl })
  });
  return {
    client: "cursor",
    method: "file",
    changed: result.changed,
    location,
    backupPath: result.backupPath,
    nextStep: "Open Cursor (or restart it) and ask the agent to use the Vibecodr Agent Computer."
  };
}

async function installWindsurf(request: InstallRequest): Promise<InstallResult> {
  const location = request.installDir
    ? path.join(request.installDir, "mcp_config.json")
    : path.join(homeDir(request.env), ".codeium", "windsurf", "mcp_config.json");
  const result = await mergeJsonConfig(request, location, {
    rootKey: "mcpServers",
    entryShape: (serverUrl) => ({ serverUrl })
  });
  return {
    client: "windsurf",
    method: "file",
    changed: result.changed,
    location,
    backupPath: result.backupPath,
    nextStep: "Restart Windsurf so it picks up the updated MCP config."
  };
}

async function installVsCode(request: InstallRequest): Promise<InstallResult> {
  if (!request.installDir && !request.dryRun && commandExists("code", request.env)) {
    const payload = JSON.stringify({ name: request.serverName, type: "http", url: request.serverUrl });
    try {
      await runCli("code", ["--add-mcp", payload], request.env);
      return {
        client: "vscode",
        method: "cli",
        changed: true,
        location: "code --add-mcp",
        nextStep: "Reload VS Code MCP servers (Command Palette: MCP: Reload Servers) to load the Agent Computer."
      };
    } catch {
      // fall through to workspace file merge below
    }
  }

  const workspaceRoot = request.installDir ?? request.cwd ?? process.cwd();
  const location = path.join(workspaceRoot, ".vscode", "mcp.json");
  const result = await mergeJsonConfig(request, location, {
    rootKey: "servers",
    entryShape: (serverUrl) => ({ type: "http", url: serverUrl })
  });
  return {
    client: "vscode",
    method: "file",
    changed: result.changed,
    location,
    backupPath: result.backupPath,
    nextStep: "Reload the VS Code window (or run MCP: Reload Servers) to pick up the new server."
  };
}

async function installClaudeDesktop(request: InstallRequest): Promise<InstallResult> {
  const location = request.installDir
    ? path.join(request.installDir, "claude_desktop_config.json")
    : claudeDesktopConfigPath(request.env);
  const result = await mergeJsonConfig(request, location, {
    rootKey: "mcpServers",
    entryShape: (serverUrl) => ({
      command: "npx",
      args: ["mcp-remote", serverUrl]
    })
  });
  const nextStepLines = [
    "Restart Claude Desktop. The config uses the mcp-remote stdio proxy because Claude Desktop does not load remote HTTP MCP servers directly; npx must be on PATH (install Node.js if needed).",
    "Alternatively, add the Agent Computer via Claude Desktop Settings -> Connectors -> Add custom connector and paste the MCP URL."
  ];
  if (process.platform !== "darwin" && process.platform !== "win32" && !request.installDir) {
    nextStepLines.unshift("Note: Anthropic does not ship an official Claude Desktop build for Linux. This config was written to the path used by community repackages; if you are not running such a build, install Claude Code instead and re-run vc-tools agent connect --client claude-code.");
  }
  return {
    client: "claude-desktop",
    method: "file",
    changed: result.changed,
    location,
    backupPath: result.backupPath,
    nextStep: nextStepLines.join(" ")
  };
}

function claudeDesktopConfigPath(env: NodeJS.ProcessEnv | undefined): string {
  const home = homeDir(env);
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "win32") {
    const appData = firstNonEmpty(env?.APPDATA, process.env.APPDATA) ?? path.join(home, "AppData", "Roaming");
    return path.join(appData, "Claude", "claude_desktop_config.json");
  }
  // Linux: Claude Desktop is not officially shipped by Anthropic. Community repackages
  // (e.g., aaddrick/claude-desktop-debian) use the standard XDG config location.
  // Treat empty XDG_CONFIG_HOME as unset (POSIX guidance) and fall back to ~/.config.
  const xdgConfigHome = firstNonEmpty(env?.XDG_CONFIG_HOME, process.env.XDG_CONFIG_HOME) ?? path.join(home, ".config");
  return path.join(xdgConfigHome, "Claude", "claude_desktop_config.json");
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function homeDir(env: NodeJS.ProcessEnv | undefined): string {
  return firstNonEmpty(env?.HOME, env?.USERPROFILE) ?? os.homedir();
}

async function readJsonFile(location: string): Promise<JsonConfig> {
  try {
    const raw = await fs.readFile(location, "utf8");
    if (raw.trim().length === 0) {
      return {};
    }
    try {
      const parsed = JSON.parse(raw);
      return isPlainObject(parsed) ? (parsed as JsonConfig) : {};
    } catch (error) {
      throw new CliError(
        "install.config_parse",
        `Existing config at ${location} is not valid JSON. Repair it before re-running vc-tools agent connect --install.`,
        5,
        { cause: formatErrorMessage(error) }
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function atomicWrite(location: string, content: string): Promise<void> {
  const tempPath = `${location}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
  await fs.rename(tempPath, location);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function commandExists(command: string, env: NodeJS.ProcessEnv | undefined): boolean {
  const checker = process.platform === "win32" ? whereExe(env) : "which";
  try {
    const result = spawnSync(checker, [command], { stdio: "ignore", env: env ?? process.env });
    return result.status === 0;
  } catch {
    return false;
  }
}

function whereExe(env: NodeJS.ProcessEnv | undefined): string {
  const systemRoot = (env?.SystemRoot ?? process.env.SystemRoot ?? "C:\\Windows").trim();
  return path.join(systemRoot, "System32", "where.exe");
}

function runCli(command: string, args: string[], env: NodeJS.ProcessEnv | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    // On Windows, npm-installed CLIs (codex, claude, code) are .cmd/.bat shims that
    // Node.js spawn cannot launch directly without a shell. On POSIX they are real
    // executables and shell: false is correct.
    const useShell = process.platform === "win32";
    const child = spawn(command, args, {
      stdio: "ignore",
      env: env ?? process.env,
      shell: useShell,
      windowsHide: true
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
