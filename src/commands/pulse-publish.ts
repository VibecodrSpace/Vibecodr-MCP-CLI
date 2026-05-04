import { readFile } from "node:fs/promises";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { parseFlags } from "../cli/parse.js";
import { renderToolResult } from "../core/renderers.js";
import { callToolWithRetry } from "./call.js";
import { showHelpIfRequested } from "./help.js";
import type { CommandContext } from "./context.js";

const PUBLISH_STANDALONE_PULSE_TOOL_NAME = "publish_standalone_pulse";
const PULSE_VISIBILITIES = new Set(["public", "unlisted", "private"]);
const DEFAULT_PULSE_VISIBILITY = "private";

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

async function parsePulsePublishInput(args: string[]): Promise<Record<string, unknown>> {
  const { flags } = parseFlags(args, {
    valueFlags: ["name", "code", "code-file", "descriptor-json", "descriptor-file", "slug", "visibility"],
    booleanFlags: ["confirm"]
  });
  const name = typeof flags["name"] === "string" ? flags["name"].trim() : "";
  if (!name) {
    throw new CliError("usage.pulse_name_required", "Usage: pulse-publish --name <name> (--code <source> | --code-file <path>) --confirm", EXIT_CODES.usage);
  }

  const hasCode = typeof flags["code"] === "string";
  const hasCodeFile = typeof flags["code-file"] === "string";
  if (hasCode === hasCodeFile) {
    throw new CliError("usage.pulse_code_required", "Use exactly one of --code or --code-file.", EXIT_CODES.usage);
  }
  const code = hasCode ? String(flags["code"]) : await readFile(String(flags["code-file"]), "utf8");
  if (!code.trim()) {
    throw new CliError("usage.pulse_code_empty", "Pulse source code cannot be empty.", EXIT_CODES.usage);
  }

  const hasDescriptorJson = typeof flags["descriptor-json"] === "string";
  const hasDescriptorFile = typeof flags["descriptor-file"] === "string";
  if (hasDescriptorJson && hasDescriptorFile) {
    throw new CliError("usage.duplicate_descriptor", "Use either --descriptor-json or --descriptor-file, not both.", EXIT_CODES.usage);
  }

  const input: Record<string, unknown> = {
    name,
    code,
    visibility: DEFAULT_PULSE_VISIBILITY,
    confirmed: flags["confirm"] === true
  };
  if (hasDescriptorJson) {
    input["descriptor"] = parseJsonObject(String(flags["descriptor-json"]), "--descriptor-json");
  } else if (hasDescriptorFile) {
    input["descriptor"] = parseJsonObject(await readFile(String(flags["descriptor-file"]), "utf8"), "--descriptor-file");
  }
  if (typeof flags["slug"] === "string" && flags["slug"].trim()) {
    input["slug"] = flags["slug"].trim();
  }
  if (typeof flags["visibility"] === "string") {
    if (!PULSE_VISIBILITIES.has(flags["visibility"])) {
      throw new CliError("usage.invalid_visibility", "Pulse visibility must be public, unlisted, or private.", EXIT_CODES.usage);
    }
    input["visibility"] = flags["visibility"];
  }
  if (input["confirmed"] !== true) {
    throw new CliError(
      "usage.confirmation_required",
      "Publishing a standalone Pulse requires explicit confirmation. Re-run with --confirm after the user confirms.",
      EXIT_CODES.usage,
      {
        nextStep: "Ask one clear confirmation question, then pass --confirm only after the user says yes."
      }
    );
  }
  return input;
}

function redactPulsePublishArguments(input: Record<string, unknown>): Record<string, unknown> {
  const { code: _code, descriptor: _descriptor, ...safe } = input;
  return {
    ...safe,
    ...(input["descriptor"] ? { descriptorProvided: true } : {}),
    sourceProvided: true
  };
}

export async function runPulsePublishCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(args, context, "Usage: vibecodr pulse-publish --name <name> (--code <source> | --code-file <path>) [--descriptor-json <json> | --descriptor-file <path>] [--slug <slug>] [--visibility public|unlisted|private] --confirm")) return;
  const input = await parsePulsePublishInput(args);
  const { result } = await callToolWithRetry(context, PUBLISH_STANDALONE_PULSE_TOOL_NAME, input, true);

  context.output.success(
    {
      schemaVersion: 1,
      tool: PUBLISH_STANDALONE_PULSE_TOOL_NAME,
      arguments: redactPulsePublishArguments(input),
      result
    },
    [renderToolResult(result)]
  );
}
