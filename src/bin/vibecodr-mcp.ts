#!/usr/bin/env node
import { reconcileEnv } from "../core/env.js";
import { migrateLegacyDirsOnce } from "../storage/migrate.js";
import { ConfigStore } from "../storage/config-store.js";
import { SecretStore } from "../storage/secret-store.js";
import { TokenManager } from "../auth/token-manager.js";
import { CLIENT_INFO, McpRuntimeClient } from "../core/mcp-client.js";
import { Output } from "../cli/output.js";
import { isHelpToken, isVersionToken, parseGlobalOptions } from "../cli/parse.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { runLoginCommand } from "../commands/login.js";
import { runLogoutCommand } from "../commands/logout.js";
import { runStatusCommand } from "../commands/status.js";
import { runWhoamiCommand } from "../commands/whoami.js";
import { runToolsCommand } from "../commands/tools.js";
import { runCallCommand } from "../commands/call.js";
import { runDoctorCommand } from "../commands/doctor.js";
import { runConfigCommand } from "../commands/config.js";
import { runInstallCommand } from "../commands/install.js";
import { runUninstallCommand } from "../commands/uninstall.js";
import { runPulseSetupCommand } from "../commands/pulse-setup.js";
import { runPulsePublishCommand } from "../commands/pulse-publish.js";
import { runPulseCommand } from "../commands/pulse.js";
import { runUploadCommand } from "../commands/upload.js";
import { runUpdateCommand } from "../commands/update.js";

reconcileEnv();
await migrateLegacyDirsOnce();

function helpText(): string {
  return [
    "vibecodr <command> [options]",
    "Compatibility alias: vibecodr-mcp <command> [options]",
    "",
    "Hosted Agent Computer:",
    "  start         Connect and verify the Agent Computer; return agent connection details.",
    "  try           Run a small browser, computer, proof, and usage check.",
    "  agent         Connect an agent to the hosted computer or check readiness.",
    "  computer      Start, check status, or run commands on the hosted Agent Computer.",
    "  browser       Render, read, screenshot, crawl, or inspect public HTTPS pages.",
    "  work          List, follow, show, or cancel hosted work.",
    "  proof         List, show, save, or delete saved outputs and artifacts.",
    "  usage         Show account-scoped Agent Computer capacity and quota progress.",
    "  plans         Show plan and entitlement details for the connected account.",
    "  dashboard     Print the hosted supervision dashboard URL.",
    "",
    "Account & install:",
    "  login         Authorize this CLI against the Vibecodr MCP gateway.",
    "  logout        Revoke the stored refresh token and clear the local session.",
    "  status        Show connection, config, and session status.",
    "  whoami        Show the connected account profile.",
    "  doctor        Diagnose connection, auth, and runtime readiness.",
    "  install <client>      Install Vibecodr MCP into a host (codex, cursor, vscode, windsurf, claude-desktop, claude-code).",
    "  uninstall <client>    Remove a previously-installed MCP host entry.",
    "  config        Manage profiles and stored configuration.",
    "  tools [tool]  List or describe MCP tools exposed by the gateway.",
    "  call <tool>   Invoke a tool by name with structured input.",
    "  upload        --zip <path>  |  --image <path> [--kind cover_image|avatar_image]",
    "",
    "Pulses:",
    "  pulse-setup [--descriptor-setup-json <json> | --descriptor-setup-file <path>]",
    "  pulse-publish --name <name> (--code <source> | --code-file <path>) --confirm",
    "  pulse <list|get|status|run|archive|restore|create|deploy>",
    "    Publishes a standalone Pulse with private source/metadata visibility by default.",
    "    The runtime URL is still public HTTP unless the Pulse code rejects callers.",
    "",
    "CLI maintenance:",
    "  update [--check] [--yes] [--via <npm|pnpm|yarn|bun>]",
    "",
    "Advanced / diagnostic:",
    "  auth, setup, connect, inspect, jobs, artifacts, grants, retention, scheduled-qa, limits",
    "",
    "Global flags:",
    "  --profile <name>",
    "  --json",
    "  --verbose",
    "  --non-interactive"
  ].join("\n");
}

function versionText(): string {
  return String(CLIENT_INFO.version);
}

async function main(): Promise<void> {
  const { command, commandArgs, globalOptions } = parseGlobalOptions(process.argv.slice(2));
  if (!command || isHelpToken(command)) {
    process.stdout.write(helpText() + "\n");
    return;
  }
  if (isVersionToken(command)) {
    process.stdout.write(versionText() + "\n");
    return;
  }

  const configStore = new ConfigStore();
  const secretStore = new SecretStore();
  const tokenManager = new TokenManager(configStore, secretStore);
  const runtimeClient = new McpRuntimeClient();
  const output = new Output(globalOptions);
  const context = {
    globalOptions,
    output,
    configStore,
    secretStore,
    tokenManager,
    runtimeClient
  };

  switch (command) {
    case "login":
      await runLoginCommand(commandArgs, context);
      return;
    case "logout":
      await runLogoutCommand(commandArgs, context);
      return;
    case "status":
      await runStatusCommand(commandArgs, context);
      return;
    case "whoami":
      await runWhoamiCommand(commandArgs, context);
      return;
    case "tools":
      await runToolsCommand(commandArgs, context);
      return;
    case "call":
      await runCallCommand(commandArgs, context);
      return;
    case "upload":
      await runUploadCommand(commandArgs, context);
      return;
    case "doctor":
      await runDoctorCommand(commandArgs, context);
      return;
    case "install":
      await runInstallCommand(commandArgs, context);
      return;
    case "uninstall":
      await runUninstallCommand(commandArgs, context);
      return;
    case "config":
      await runConfigCommand(commandArgs, context);
      return;
    case "pulse-setup":
      await runPulseSetupCommand(commandArgs, context);
      return;
    case "pulse-publish":
      await runPulsePublishCommand(commandArgs, context);
      return;
    case "pulse":
      await runPulseCommand(commandArgs, context);
      return;
    case "update":
      await runUpdateCommand(commandArgs, context);
      return;
    default:
      if (VC_TOOLS_ONLY_COMMANDS.has(command)) {
        // Vibecodr v1 surfaces the hosted Agent Computer commands (browser, computer,
        // work, etc.) through both the vibecodr and vc-tools bin names. The legacy
        // vc-tools dispatcher owns the byte-equivalent output, so delegate to it.
        const { runCli } = await import("../legacy/cli/run.js");
        const code = await runCli(process.argv.slice(2));
        process.exitCode = code;
        return;
      }
      throw new CliError("usage.command", `Unknown command: ${command}`, EXIT_CODES.usage);
  }
}

const VC_TOOLS_ONLY_COMMANDS = new Set<string>([
  "start",
  "setup",
  "try",
  "agent",
  "auth",
  "connect",
  "computer",
  "browser",
  "work",
  "proof",
  "usage",
  "limits",
  "dashboard",
  "jobs",
  "artifacts",
  "grants",
  "retention",
  "scheduled-qa",
  "plans",
  "inspect"
]);

main().catch((error) => {
  const { globalOptions } = parseGlobalOptions(process.argv.slice(2));
  new Output(globalOptions).failure(error);
});
