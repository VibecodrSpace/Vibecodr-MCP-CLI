import { readFile } from "node:fs/promises";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { isHelpToken, parseFlags } from "../cli/parse.js";
import { renderToolResult } from "../core/renderers.js";
import { redactForOutput } from "../core/redaction.js";
import { callToolWithRetry } from "./call.js";
import { runPulsePublishCommand } from "./pulse-publish.js";
import type { CommandContext } from "./context.js";

const MAX_LIST_LIMIT = 25;

type PulseActionConfig = {
  toolName: string;
  requiresConfirm: boolean;
};

const PULSE_ACTIONS: Record<string, PulseActionConfig> = {
  get: { toolName: "get_pulse", requiresConfirm: false },
  status: { toolName: "get_pulse_status", requiresConfirm: false },
  run: { toolName: "run_pulse", requiresConfirm: true },
  archive: { toolName: "archive_pulse", requiresConfirm: true },
  restore: { toolName: "restore_pulse", requiresConfirm: true }
};

function pulseHelpText(): string {
  return [
    "Usage: vibecodr pulse <command> [options]",
    "",
    "Commands:",
    "  list [--limit <n>] [--offset <n>]",
    "  get <pulse-id>",
    "  status <pulse-id>",
    "  run <pulse-id> [--input-json <json> | --input-file <path>] --confirm",
    "  archive <pulse-id> --confirm",
    "  restore <pulse-id> --confirm",
    "  create --name <name> (--code <source> | --code-file <path>) --confirm",
    "  deploy --name <name> (--code <source> | --code-file <path>) --confirm",
    "",
    "Delete is intentionally not exposed by the CLI; archive a Pulse instead."
  ].join("\n");
}

function parseBoundedInteger(raw: unknown, name: string, defaultValue: number, maxValue: number): number {
  if (raw === undefined) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new CliError("usage.invalid_number", `${name} must be a non-negative integer.`, EXIT_CODES.usage);
  }
  return Math.min(value, maxValue);
}

function parsePulseId(raw: unknown): string {
  const pulseId = typeof raw === "string" ? raw.trim() : "";
  if (!pulseId) {
    throw new CliError("usage.pulse_id_required", "A Pulse id is required.", EXIT_CODES.usage);
  }
  if (pulseId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(pulseId)) {
    throw new CliError("usage.invalid_pulse_id", "Pulse id contains unsupported characters.", EXIT_CODES.usage);
  }
  return pulseId;
}

function parseJsonObject(raw: string, source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CliError(
      "usage.invalid_json",
      `${source} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      EXIT_CODES.usage
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError("usage.invalid_json", `${source} must be a JSON object.`, EXIT_CODES.usage);
  }
  return parsed as Record<string, unknown>;
}

async function parseRunInput(flags: Record<string, string | boolean>): Promise<Record<string, unknown> | undefined> {
  const hasInputJson = typeof flags["input-json"] === "string";
  const hasInputFile = typeof flags["input-file"] === "string";
  if (hasInputJson && hasInputFile) {
    throw new CliError("usage.duplicate_input", "Use either --input-json or --input-file, not both.", EXIT_CODES.usage);
  }
  if (hasInputJson) return parseJsonObject(String(flags["input-json"]), "--input-json");
  if (hasInputFile) return parseJsonObject(await readFile(String(flags["input-file"]), "utf8"), "--input-file");
  return undefined;
}

async function invokePulseTool(
  context: CommandContext,
  toolName: string,
  input: Record<string, unknown>
): Promise<void> {
  const { result } = await callToolWithRetry(context, toolName, input, true);
  context.output.success(
    {
      schemaVersion: 1,
      tool: toolName,
      arguments: redactForOutput(input),
      result
    },
    [renderToolResult(result)]
  );
}

export async function runPulseCommand(args: string[], context: CommandContext): Promise<void> {
  const subcommand = args[0];
  const commandArgs = args.slice(1);
  if (!subcommand || isHelpToken(subcommand) || commandArgs.some((arg) => isHelpToken(arg))) {
    context.output.info(pulseHelpText());
    return;
  }

  if (subcommand === "create" || subcommand === "deploy") {
    await runPulsePublishCommand(commandArgs, context);
    return;
  }

  if (subcommand === "delete") {
    throw new CliError(
      "usage.pulse_delete_unavailable",
      "The CLI does not expose Pulse deletion. Archive the Pulse instead.",
      EXIT_CODES.usage
    );
  }
  if (subcommand === "logs") {
    throw new CliError(
      "usage.pulse_logs_unavailable",
      "Pulse logs are not exposed through the hardened CLI lifecycle surface yet.",
      EXIT_CODES.usage,
      { nextStep: "Use `vibecodr pulse status <pulse-id>` for deploy state, or inspect platform telemetry through the owner dashboard." }
    );
  }

  if (subcommand === "list") {
    const { flags, positionals } = parseFlags(commandArgs, {
      valueFlags: ["limit", "offset"],
      booleanFlags: []
    });
    if (positionals.length > 0) {
      throw new CliError("usage.unexpected_argument", `Unexpected argument: ${positionals[0]}`, EXIT_CODES.usage);
    }
    await invokePulseTool(context, "list_pulses", {
      limit: parseBoundedInteger(flags["limit"], "--limit", 10, MAX_LIST_LIMIT),
      offset: parseBoundedInteger(flags["offset"], "--offset", 0, 10_000)
    });
    return;
  }

  const action = PULSE_ACTIONS[subcommand];
  if (!action) {
    throw new CliError("usage.command", `Unknown pulse command: ${subcommand}`, EXIT_CODES.usage);
  }

  const { flags, positionals } = parseFlags(commandArgs, {
    valueFlags: ["input-json", "input-file"],
    booleanFlags: ["confirm"]
  });
  const pulseId = parsePulseId(positionals[0]);
  if (positionals.length > 1) {
    throw new CliError("usage.unexpected_argument", `Unexpected argument: ${positionals[1]}`, EXIT_CODES.usage);
  }
  if (action.requiresConfirm && flags["confirm"] !== true) {
    throw new CliError(
      "usage.confirmation_required",
      `Pulse ${subcommand} requires explicit confirmation. Re-run with --confirm after the user confirms.`,
      EXIT_CODES.usage
    );
  }
  const input: Record<string, unknown> = {
    pulseId,
    ...(action.requiresConfirm ? { confirmed: true } : {})
  };
  if (subcommand === "run") {
    const runInput = await parseRunInput(flags);
    if (runInput !== undefined) input["input"] = runInput;
  } else if (flags["input-json"] !== undefined || flags["input-file"] !== undefined) {
    throw new CliError("usage.unknown_flag", "--input-json and --input-file are only valid for pulse run.", EXIT_CODES.usage);
  }
  await invokePulseTool(context, action.toolName, input);
}
