import { parseFlags } from "../cli/parse.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { callToolWithRetry } from "./call.js";
import { showHelpIfRequested } from "./help.js";
import type { CommandContext } from "./context.js";
import type { SessionRecord } from "../types/auth.js";

const WHOAMI_TOOL_NAME = "get_account_capabilities";

type AccountProfile = {
  id?: string | undefined;
  handle?: string | undefined;
  name?: string | null | undefined;
  avatarUrl?: string | null | undefined;
  plan?: string | undefined;
};

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return readString(value);
}

function profileFromToolResult(result: Awaited<ReturnType<CommandContext["runtimeClient"]["callTool"]>>): AccountProfile {
  const structured = readRecord(result.structuredContent);
  const account = readRecord(structured["account"]);
  const profile = readRecord(account["profile"]);
  const quota = readRecord(account["quota"]);
  return {
    ...(readString(profile["id"]) ? { id: readString(profile["id"]) } : {}),
    ...(readString(profile["handle"]) ? { handle: readString(profile["handle"]) } : {}),
    ...(readNullableString(profile["name"]) !== undefined ? { name: readNullableString(profile["name"]) } : {}),
    ...(readNullableString(profile["avatarUrl"]) !== undefined ? { avatarUrl: readNullableString(profile["avatarUrl"]) } : {}),
    ...(readString(profile["plan"]) || readString(quota["plan"]) ? { plan: readString(profile["plan"]) || readString(quota["plan"]) } : {})
  };
}

function accountLabel(profile: AccountProfile): string {
  if (profile.handle) return `@${profile.handle}`;
  if (profile.name) return profile.name;
  if (profile.id) return profile.id;
  return "connected Vibecodr account";
}

function humanLines(args: {
  profileName: string;
  serverUrl: string;
  session: SessionRecord | undefined;
  sessionState: string;
  account: AccountProfile;
}): string[] {
  return [
    `Account: ${accountLabel(args.account)}`,
    ...(args.account.name && args.account.handle ? [`Name: ${args.account.name}`] : []),
    `Plan: ${args.account.plan || "unknown"}`,
    `CLI profile: ${args.profileName}`,
    `Server URL: ${args.serverUrl}`,
    `Session state: ${args.sessionState}`,
    `Expires at: ${args.session?.expiresAt || "unknown"}`
  ];
}

export async function runWhoamiCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(args, context, "Usage: vibecodr whoami [--no-login]")) return;
  const { flags, positionals } = parseFlags(args, {
    booleanFlags: ["no-login"]
  });
  if (positionals.length > 0) {
    throw new CliError("usage.unexpected_argument", `Unexpected argument: ${positionals[0]}`, EXIT_CODES.usage);
  }

  const { profileName, serverUrl } = await context.tokenManager.resolveProfile(context.globalOptions);
  const { result, session } = await callToolWithRetry(context, WHOAMI_TOOL_NAME, {}, !flags["no-login"]);
  const account = profileFromToolResult(result);
  if (!account.id && !account.handle && !account.name) {
    throw new CliError(
      "mcp.whoami_contract",
      "The MCP gateway did not return account identity for the connected user.",
      EXIT_CODES.protocol,
      { nextStep: "Run vibecodr doctor, then retry vibecodr whoami." }
    );
  }
  const sessionState = context.tokenManager.sessionState(session);

  context.output.success(
    {
      schemaVersion: 1,
      profile: profileName,
      serverUrl,
      sessionState,
      expiresAt: session?.expiresAt,
      account
    },
    humanLines({
      profileName,
      serverUrl,
      session,
      sessionState,
      account
    })
  );
}
