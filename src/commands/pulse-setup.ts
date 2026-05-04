import { readFile } from "node:fs/promises";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { parseFlags } from "../cli/parse.js";
import { renderToolResult } from "../core/renderers.js";
import { callToolWithRetry } from "./call.js";
import { showHelpIfRequested } from "./help.js";
import type { CommandContext } from "./context.js";

const PULSE_SETUP_TOOL_NAME = "get_pulse_setup_guidance";
const PULSE_DESCRIPTOR_SOURCE_OF_TRUTH = "PulseDescriptor";

function readStructuredContent(result: unknown): Record<string, unknown> | undefined {
  const structuredContent =
    result && typeof result === "object"
      ? ((result as { structuredContent?: unknown }).structuredContent ?? result)
      : undefined;
  return structuredContent && typeof structuredContent === "object" && !Array.isArray(structuredContent)
    ? structuredContent as Record<string, unknown>
    : undefined;
}

function assertDescriptorSetupGuidance(result: unknown, options?: { expectsDescriptorSetup?: boolean }): void {
  const structuredContent = readStructuredContent(result);
  const descriptorMetadata =
    structuredContent
      ? structuredContent["descriptorMetadata"]
      : undefined;
  const metadata =
    descriptorMetadata && typeof descriptorMetadata === "object"
      ? (descriptorMetadata as { sourceOfTruth?: unknown; apiVersion?: unknown })
      : undefined;

  if (
    metadata?.sourceOfTruth !== PULSE_DESCRIPTOR_SOURCE_OF_TRUTH ||
    metadata.apiVersion !== "pulse/v1"
  ) {
    throw new CliError(
      "mcp.pulse_setup_contract",
      "Pulse setup guidance response is missing PulseDescriptor metadata.",
      EXIT_CODES.protocol,
      {
        nextStep: "Run vibecodr doctor to inspect the configured MCP server, then retry."
      }
    );
  }

  if (options?.expectsDescriptorSetup) {
    const descriptorEvaluation =
      structuredContent?.["descriptorEvaluation"] && typeof structuredContent["descriptorEvaluation"] === "object"
        ? structuredContent["descriptorEvaluation"] as { guidanceSource?: unknown }
        : undefined;
    if (descriptorEvaluation?.guidanceSource !== "descriptor_setup") {
      throw new CliError(
        "mcp.pulse_setup_contract",
        "Pulse setup guidance response did not evaluate the supplied descriptorSetup.",
        EXIT_CODES.protocol,
        {
          nextStep: "Verify the MCP server supports get_pulse_setup_guidance descriptorSetup projection."
        }
      );
    }
  }
}

function parseDescriptorSetup(raw: string, source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CliError(
      "usage.invalid_descriptor_setup",
      `${source} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      EXIT_CODES.usage
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CliError(
      "usage.invalid_descriptor_setup",
      `${source} must be a PulseDescriptorSetupProjection object.`,
      EXIT_CODES.usage
    );
  }
  return parsed as Record<string, unknown>;
}

async function parsePulseSetupInput(args: string[]): Promise<Record<string, unknown>> {
  const { flags } = parseFlags(args, {
    valueFlags: ["descriptor-setup-json", "descriptor-setup-file"]
  });
  const hasInline = typeof flags["descriptor-setup-json"] === "string";
  const hasFile = typeof flags["descriptor-setup-file"] === "string";
  if (hasInline && hasFile) {
    throw new CliError(
      "usage.duplicate_descriptor_setup",
      "Use either --descriptor-setup-json or --descriptor-setup-file, not both.",
      EXIT_CODES.usage
    );
  }
  if (typeof flags["descriptor-setup-json"] === "string") {
    return { descriptorSetup: parseDescriptorSetup(flags["descriptor-setup-json"], "--descriptor-setup-json") };
  }
  if (typeof flags["descriptor-setup-file"] === "string") {
    const raw = await readFile(flags["descriptor-setup-file"], "utf8");
    return { descriptorSetup: parseDescriptorSetup(raw, "--descriptor-setup-file") };
  }
  return {};
}

export async function runPulseSetupCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(args, context, "Usage: vibecodr pulse-setup [--descriptor-setup-json <json> | --descriptor-setup-file <path>]")) return;
  const input = await parsePulseSetupInput(args);
  const { result } = await callToolWithRetry(context, PULSE_SETUP_TOOL_NAME, input, true);
  assertDescriptorSetupGuidance(result, { expectsDescriptorSetup: Boolean(input["descriptorSetup"]) });

  context.output.success(
    {
      schemaVersion: 1,
      tool: PULSE_SETUP_TOOL_NAME,
      arguments: input,
      result
    },
    [renderToolResult(result)]
  );
}
