import { parseFlags } from "../cli/parse.js";
import { runDoctor } from "../doctor/run.js";
import { EXIT_CODES } from "../cli/errors.js";
import { showHelpIfRequested } from "./help.js";
import type { CommandContext } from "./context.js";

export async function runDoctorCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(args, context, "Usage: vibecodr doctor [--client <codex|cursor|vscode|windsurf|claude-desktop>]")) return;
  const { flags } = parseFlags(args, {
    valueFlags: ["client"]
  });
  const checks = await runDoctor(
    context.globalOptions,
    context.tokenManager,
    context.secretStore,
    typeof flags["client"] === "string" ? flags["client"] : undefined
  );
  context.output.success(
    {
      schemaVersion: 1,
      ok: checks.every((check) => check.status === "pass"),
      checks
    },
    checks.map((check) => `[${check.status.toUpperCase()}] ${check.id}: ${check.summary}`)
  );
  if (checks.some((check) => check.status === "fail")) {
    process.exitCode = EXIT_CODES.runtime;
  }
}
