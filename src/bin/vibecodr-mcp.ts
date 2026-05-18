#!/usr/bin/env node
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

function helpText(): string {
  return [
    "vibecodr <command> [options]",
    "Compatibility alias: vibecodr-mcp <command> [options]",
    "",
    "Commands:",
    "  login",
    "  logout",
    "  status",
    "  whoami",
    "  tools [tool-name]",
    "  call <tool-name>",
    "  upload --zip <path>",
    "  upload --image <path> [--kind cover_image|avatar_image]",
    "  doctor",
    "  install <client>",
    "  uninstall <client>",
    "  config",
    "  pulse-setup [--descriptor-setup-json <json> | --descriptor-setup-file <path>]",
    "  pulse-publish --name <name> (--code <source> | --code-file <path>) --confirm",
    "  pulse <list|get|status|run|archive|restore|create|deploy>",
    "    Publishes a standalone Pulse with private source/metadata visibility by default.",
    "    The runtime URL is still public HTTP unless the Pulse code rejects callers.",
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
    default:
      throw new CliError("usage.command", `Unknown command: ${command}`, EXIT_CODES.usage);
  }
}

main().catch((error) => {
  const { globalOptions } = parseGlobalOptions(process.argv.slice(2));
  new Output(globalOptions).failure(error);
});
