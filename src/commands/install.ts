import { parseFlags } from "../cli/parse.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { InstallManifestStore } from "../storage/install-manifest.js";
import { installCodex } from "../clients/codex.js";
import { installCursor } from "../clients/cursor.js";
import { installVsCode } from "../clients/vscode.js";
import { installWindsurf } from "../clients/windsurf.js";
import { installClaudeDesktop } from "../clients/claude-desktop.js";
import { installClaudeCode } from "../clients/claude-code.js";
import { showHelpIfRequested } from "./help.js";
import type { ClientTarget } from "../types/install.js";
import type { CommandContext } from "./context.js";

const SUPPORTED_CLIENTS: ClientTarget[] = ["codex", "cursor", "vscode", "windsurf", "claude-desktop", "claude-code"];

function defaultName(serverUrl: string): string {
  return serverUrl.includes("staging") ? "vibecodr-staging" : "vibecodr";
}

function clientDisplayName(client: ClientTarget): string {
  switch (client) {
    case "codex": return "Codex";
    case "cursor": return "Cursor";
    case "vscode": return "VS Code";
    case "windsurf": return "Windsurf";
    case "claude-desktop": return "Claude Desktop";
    case "claude-code": return "Claude Code";
  }
}

function isHostedAgentComputerMcpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "tools.vibecodr.space"
      && (url.pathname === "/mcp" || url.pathname === "/v1/mcp");
  } catch {
    return false;
  }
}

export async function runInstallCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(args, context, "Usage: vibecodr install <codex|cursor|vscode|windsurf|claude-desktop|claude-code> [--scope user|project] [--path <dir>] [--name <server-name>] [--open-client] [--overwrite] [--dry-run]")) return;
  const client = args[0] as ClientTarget | undefined;
  if (!client || !SUPPORTED_CLIENTS.includes(client)) {
    throw new CliError("usage.install_client", `Usage: install <${SUPPORTED_CLIENTS.join("|")}> [options]`, EXIT_CODES.usage);
  }
  const { flags } = parseFlags(args.slice(1), {
    valueFlags: ["scope", "path", "name"],
    booleanFlags: ["open-client", "overwrite", "dry-run"]
  });
  const { serverUrl } = await context.tokenManager.resolveProfile(context.globalOptions);
  if (isHostedAgentComputerMcpUrl(serverUrl)) {
    throw new CliError(
      "install.agent_computer_remote_auth_unsupported",
      "This profile points at tools.vibecodr.space/mcp, which uses vc-tools Agent Computer grants. `vibecodr install` only writes OAuth-backed MCP Gateway configs; use a profile pointed at https://openai.vibecodr.space/mcp, or run `vibecodr start` for Agent Computer setup.",
      EXIT_CODES.usage
    );
  }
  const request = {
    serverUrl,
    name: typeof flags["name"] === "string" ? flags["name"] : defaultName(serverUrl),
    scope: (typeof flags["scope"] === "string" ? flags["scope"] : "user") as "user" | "project",
    path: typeof flags["path"] === "string" ? flags["path"] : undefined,
    openClient: Boolean(flags["open-client"]),
    overwrite: Boolean(flags["overwrite"]),
    dryRun: Boolean(flags["dry-run"])
  };

  const result = client === "codex"
    ? await installCodex(request)
    : client === "cursor"
      ? await installCursor(request)
      : client === "vscode"
        ? await installVsCode(request)
        : client === "windsurf"
          ? await installWindsurf(request)
          : client === "claude-desktop"
            ? await installClaudeDesktop(request)
            : await installClaudeCode(request);

  if (!request.dryRun) {
    const manifest = new InstallManifestStore();
    await manifest.upsert({
      client: result.client,
      scope: result.scope,
      name: result.name,
      location: result.location,
      method: result.method,
      serverUrl,
      installedAt: new Date().toISOString()
    });
  }

  context.output.success(
    {
      schemaVersion: 1,
      ...result
    },
    [
      `Client: ${result.client}`,
      `Scope: ${result.scope}`,
      `Method: ${result.method}`,
      `Location: ${result.location}`,
      `Changed: ${result.changed ? "yes" : "no"}`,
      `Managed: yes`,
      result.nextStep,
      ...(result.notes || []),
      `${clientDisplayName(result.client)} config install only. CLI auth and installed-client auth remain separate.`
    ]
  );
}
