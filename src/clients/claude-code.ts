import { CliError, EXIT_CODES } from "../cli/errors.js";
import { commandExists, runCommand } from "../platform/exec.js";
import { requireScope, type InstallRequest, type UninstallRequest } from "./base.js";
import type { InstallResult } from "../types/install.js";

// Claude Code does not ship a managed config file the CLI can merge into; it owns its MCP
// catalog through the `claude mcp add` and `claude mcp remove` shell commands. We model
// installs as the spawn invocation we would run and record the spawn signature as the
// install manifest "location" so uninstall can match later.

const CLAUDE_BINARY = "claude";

function spawnLocation(): string {
  return "claude mcp add";
}

export async function installClaudeCode(request: InstallRequest): Promise<InstallResult> {
  requireScope(request.scope, ["user"]);
  if (request.dryRun) {
    return {
      client: "claude-code",
      scope: request.scope,
      name: request.name,
      method: "cli",
      changed: false,
      location: spawnLocation(),
      managed: true,
      nextStep: "Dry run: would call `claude mcp add --transport http <name> <serverUrl>` to register the Agent Computer.",
      spawn: {
        command: CLAUDE_BINARY,
        args: ["mcp", "add", "--transport", "http", request.name, request.serverUrl]
      }
    };
  }
  if (!commandExists(CLAUDE_BINARY)) {
    throw new CliError(
      "install.claude_code_cli_missing",
      "Claude Code CLI is not on PATH. Install Claude Code first, then re-run, or copy the MCP URL via Claude Code's settings UI manually.",
      EXIT_CODES.installConflict,
      {
        nextStep: "Install the `claude` CLI (https://docs.claude.com/en/docs/claude-code) and re-run."
      }
    );
  }
  try {
    await runCommand(CLAUDE_BINARY, ["mcp", "add", "--transport", "http", request.name, request.serverUrl]);
  } catch (error) {
    throw new CliError(
      "install.claude_code_cli_failed",
      `claude mcp add failed: ${error instanceof Error ? error.message : String(error)}.`,
      EXIT_CODES.installConflict,
      {
        nextStep: "Re-run with --dry-run to inspect the spawn, or repair the claude CLI."
      }
    );
  }
  return {
    client: "claude-code",
    scope: request.scope,
    name: request.name,
    method: "cli",
    changed: true,
    location: spawnLocation(),
    managed: true,
    nextStep: "Start a new Claude Code session in this workspace so it picks up the Agent Computer."
  };
}

export async function uninstallClaudeCode(request: UninstallRequest, _managedLocation?: string): Promise<InstallResult> {
  requireScope(request.scope, ["user"]);
  if (request.dryRun) {
    return {
      client: "claude-code",
      scope: request.scope,
      name: request.name,
      method: "cli",
      changed: false,
      location: spawnLocation(),
      managed: true,
      nextStep: "Dry run: would call `claude mcp remove <name>` to unregister the Agent Computer."
    };
  }
  if (!commandExists(CLAUDE_BINARY)) {
    throw new CliError(
      "install.claude_code_cli_missing",
      "Claude Code CLI is not on PATH; cannot run claude mcp remove.",
      EXIT_CODES.installConflict,
      {
        nextStep: "Install the `claude` CLI and re-run."
      }
    );
  }
  try {
    await runCommand(CLAUDE_BINARY, ["mcp", "remove", request.name]);
  } catch (error) {
    throw new CliError(
      "install.claude_code_cli_failed",
      `claude mcp remove failed: ${error instanceof Error ? error.message : String(error)}.`,
      EXIT_CODES.installConflict,
      {
        nextStep: "Resolve the claude CLI error and re-run."
      }
    );
  }
  return {
    client: "claude-code",
    scope: request.scope,
    name: request.name,
    method: "cli",
    changed: true,
    location: "claude mcp remove",
    managed: true,
    nextStep: "Claude Code MCP registration was removed."
  };
}
