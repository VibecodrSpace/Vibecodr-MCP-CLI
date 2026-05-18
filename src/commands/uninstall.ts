import { parseFlags } from "../cli/parse.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { InstallManifestStore } from "../storage/install-manifest.js";
import { uninstallCodex } from "../clients/codex.js";
import { uninstallCursor } from "../clients/cursor.js";
import { uninstallVsCode } from "../clients/vscode.js";
import { uninstallWindsurf } from "../clients/windsurf.js";
import { uninstallClaudeDesktop } from "../clients/claude-desktop.js";
import { uninstallClaudeCode } from "../clients/claude-code.js";
import { showHelpIfRequested } from "./help.js";
import type { ClientTarget } from "../types/install.js";
import type { CommandContext } from "./context.js";

const SUPPORTED_CLIENTS: ClientTarget[] = ["codex", "cursor", "vscode", "windsurf", "claude-desktop", "claude-code"];

export async function runUninstallCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(args, context, "Usage: vibecodr uninstall <codex|cursor|vscode|windsurf|claude-desktop|claude-code> [--scope user|project] [--path <dir>] [--name <server-name>] [--dry-run]")) return;
  const client = args[0] as ClientTarget | undefined;
  if (!client || !SUPPORTED_CLIENTS.includes(client)) {
    throw new CliError("usage.uninstall_client", `Usage: uninstall <${SUPPORTED_CLIENTS.join("|")}> [options]`, EXIT_CODES.usage);
  }
  const { flags } = parseFlags(args.slice(1), {
    valueFlags: ["scope", "path", "name"],
    booleanFlags: ["dry-run"]
  });
  const { serverUrl } = await context.tokenManager.resolveProfile(context.globalOptions);
  const scope = (typeof flags["scope"] === "string" ? flags["scope"] : "user") as "user" | "project";
  const name = typeof flags["name"] === "string" ? flags["name"] : (serverUrl.includes("staging") ? "vibecodr-staging" : "vibecodr");
  const manifest = new InstallManifestStore();
  const managedEntries = await manifest.find((entry) => entry.client === client && entry.scope === scope && entry.name === name);
  const managed = managedEntries[0];
  if (!managed) {
    throw new CliError("install.not_managed", `No CLI-managed ${client} install entry was found for ${name}.`, EXIT_CODES.installConflict, {
      nextStep: "Only CLI-managed installs can be safely removed."
    });
  }

  const request = {
    serverUrl,
    name,
    scope,
    path: typeof flags["path"] === "string" ? flags["path"] : undefined,
    dryRun: Boolean(flags["dry-run"])
  };
  const result = client === "codex"
    ? await uninstallCodex(request, managed.location)
    : client === "cursor"
      ? await uninstallCursor(request, managed.location)
      : client === "vscode"
        ? await uninstallVsCode(request, managed.location, managed.method === "uri" ? "cli" : managed.method)
        : client === "windsurf"
          ? await uninstallWindsurf(request, managed.location)
          : client === "claude-desktop"
            ? await uninstallClaudeDesktop(request, managed.location)
            : await uninstallClaudeCode(request, managed.location);

  if (!request.dryRun && result.changed) {
    await manifest.remove((entry) => entry.client === client && entry.scope === scope && entry.name === name && entry.location === managed.location);
  }

  context.output.success(
    {
      schemaVersion: 1,
      ...result
    },
    [
      `Client: ${result.client}`,
      `Scope: ${result.scope}`,
      `Location: ${result.location}`,
      `Changed: ${result.changed ? "yes" : "no"}`,
      result.nextStep
    ]
  );
}
