import { parseFlags } from "../cli/parse.js";
import { runDoctor } from "../doctor/run.js";
import { EXIT_CODES } from "../cli/errors.js";
import { showHelpIfRequested } from "./help.js";
import type { CommandContext } from "./context.js";
import type { CredentialEndpoint } from "../auth/credential-broker.js";

type DoctorCheck = Awaited<ReturnType<typeof runDoctor>>[number];

function doctorHelpText(): string {
  return [
    "Usage: vibecodr doctor [--client <codex|cursor|vscode|windsurf|claude-desktop>]",
    "",
    "Checks the local CLI, secure storage, OAuth setup, MCP Gateway credentials,",
    "Agent Computer credentials, and optional editor/client setup.",
    "",
    "Most people:",
    "  vibecodr doctor              Find the next setup problem.",
    "  vibecodr doctor --client codex",
    "      Also check whether Codex is ready to use Vibecodr.",
    "",
    "For scripts:",
    "  vibecodr doctor --json --non-interactive"
  ].join("\n");
}

async function credentialCheck(
  context: CommandContext,
  id: string,
  label: string,
  endpoint: CredentialEndpoint
): Promise<DoctorCheck> {
  if (!context.credentialBroker) {
    return {
      id,
      status: "warn",
      summary: `${label} credential broker is unavailable.`
    };
  }
  try {
    const credential = await context.credentialBroker.getCredentialForEndpoint(endpoint);
    return {
      id,
      status: credential ? "pass" : "warn",
      summary: credential
        ? `${label} credential is available via ${credential.kind}.`
        : `${label} credential is not stored.`
    };
  } catch (error) {
    return {
      id,
      status: "warn",
      summary: `${label} credential state could not be read: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function nextStepForCheck(check: DoctorCheck): string | undefined {
  if (check.status === "pass") return undefined;
  if (check.id === "mcp-gateway-credential") {
    return "Run `vibecodr login` for publishing, uploads, Pulses, and MCP Gateway tools.";
  }
  if (check.id === "agent-computer-credential") {
    return "Run `vibecodr start` to approve the Agent Computer account connection.";
  }
  if (check.id === "refresh-token") {
    return "Run `vibecodr login` to refresh this CLI session.";
  }
  if (check.id.includes("client")) {
    return "Run `vibecodr install <client>` for the editor or agent you use.";
  }
  return undefined;
}

function doctorHumanLines(checks: DoctorCheck[]): string[] {
  const failures = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  const firstAction = [...failures, ...warnings].map((check) => nextStepForCheck(check)).find(Boolean);
  const headline = failures.length > 0
    ? "Vibecodr doctor found setup blockers."
    : warnings.length > 0
      ? "Vibecodr doctor found things to check."
      : "Vibecodr doctor passed.";

  return [
    headline,
    `Passed: ${checks.filter((check) => check.status === "pass").length}`,
    `Needs attention: ${failures.length + warnings.length}`,
    firstAction ? `Next: ${firstAction}` : "Next: run `vibecodr status` to see what is connected.",
    "",
    "Details:",
    ...checks.map((check) => `[${check.status.toUpperCase()}] ${check.id}: ${check.summary}`)
  ];
}

export async function runDoctorCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(args, context, doctorHelpText())) return;
  const { flags } = parseFlags(args, {
    valueFlags: ["client"]
  });
  const checks = await runDoctor(
    context.globalOptions,
    context.tokenManager,
    context.secretStore,
    typeof flags["client"] === "string" ? flags["client"] : undefined
  );
  checks.push(
    await credentialCheck(context, "agent-computer-credential", "Agent Computer", "tools.vibecodr.space"),
    await credentialCheck(context, "mcp-gateway-credential", "MCP Gateway", "openai.vibecodr.space/mcp")
  );
  context.output.success(
    {
      schemaVersion: 1,
      ok: checks.every((check) => check.status === "pass"),
      checks
    },
    doctorHumanLines(checks)
  );
  if (checks.some((check) => check.status === "fail")) {
    process.exitCode = EXIT_CODES.runtime;
  }
}
