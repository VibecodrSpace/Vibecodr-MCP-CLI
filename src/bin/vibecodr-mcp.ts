#!/usr/bin/env node
import { ConfigStore } from "../storage/config-store.js";
import { SecretStore } from "../storage/secret-store.js";
import { TokenManager } from "../auth/token-manager.js";
import { McpRuntimeClient } from "../core/mcp-client.js";
import { Output } from "../cli/output.js";
import { parseGlobalOptions } from "../cli/parse.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { runLoginCommand } from "../commands/login.js";
import { runLogoutCommand } from "../commands/logout.js";
import { runStatusCommand } from "../commands/status.js";
import { runToolsCommand } from "../commands/tools.js";
import { runCallCommand } from "../commands/call.js";
import { runDoctorCommand } from "../commands/doctor.js";
import { runConfigCommand } from "../commands/config.js";
import { runInstallCommand } from "../commands/install.js";
import { runUninstallCommand } from "../commands/uninstall.js";
import { runPulseSetupCommand } from "../commands/pulse-setup.js";

function helpText(): string {
  return [
    "vibecodr <command> [options]",
    "Compatibility alias: vibecodr-mcp <command> [options]",
    "",
    "Commands:",
    "  login",
    "  logout",
    "  status",
    "  tools [tool-name]",
    "  call <tool-name>",
    "  doctor",
    "  install <client>",
    "  uninstall <client>",
    "  config",
    "  pulse-setup [--descriptor-setup-json <json> | --descriptor-setup-file <path>]",
    "",
    "Global flags:",
    "  --profile <name>",
    "  --server-url <url>",
    "  --json",
    "  --verbose",
    "  --non-interactive"
  ].join("\n");
}

async function main(): Promise<void> {
  const { command, commandArgs, globalOptions } = parseGlobalOptions(process.argv.slice(2));
  if (!command || command === "--help" || command === "help") {
    process.stdout.write(helpText() + "\n");
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
    case "tools":
      await runToolsCommand(commandArgs, context);
      return;
    case "call":
      await runCallCommand(commandArgs, context);
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
    default:
      throw new CliError("usage.command", `Unknown command: ${command}`, EXIT_CODES.usage);
  }
}

main().catch((error) => {
  const { globalOptions } = parseGlobalOptions(process.argv.slice(2));
  new Output(globalOptions).failure(error);
});
