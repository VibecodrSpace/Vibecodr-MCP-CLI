import { parseFlags } from "../cli/parse.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { showHelpIfRequested } from "./help.js";
import type { BrowserMode, RegistrationMode } from "../types/config.js";
import type { CommandContext } from "./context.js";

const MCP_GATEWAY_AUTH_SCOPES = new Set(["mcp", "mcp-gateway", "gateway"]);

function loginHelpText(): string {
  return [
    "Usage: vibecodr login [mcp] [--scope <oauth-scope>] [--registration auto|preregistered|cimd|dcr|manual] [--browser open|print] [--timeout-sec <n>]",
    "       vibecodr login agent [--no-browser] [--credential-file <path> | --credential-stdin]",
    "",
    "Most people:",
    "  vibecodr start        Approve the Agent Computer account connection.",
    "  vibecodr login        Sign in for publishing, uploads, Pulses, and MCP Gateway tools.",
    "",
    "Explicit lanes:",
    "  vibecodr login mcp    Same as vibecodr login; uses browser OAuth.",
    "  vibecodr login agent  Uses the hosted Agent Computer approval flow.",
    "",
    "Tip: run `vibecodr status` after login to see what is connected."
  ].join("\n");
}

export async function runLoginCommand(args: string[], context: CommandContext): Promise<void> {
  const scopedArgs = MCP_GATEWAY_AUTH_SCOPES.has(args[0] ?? "") ? args.slice(1) : args;
  if (showHelpIfRequested(scopedArgs, context, loginHelpText())) return;
  const { flags, positionals } = parseFlags(scopedArgs, {
    valueFlags: ["scope", "registration", "browser", "timeout-sec"]
  });
  if (positionals.length > 0) {
    throw new CliError(
      "usage.unknown_login_scope",
      `Unknown login target: ${positionals[0]}`,
      EXIT_CODES.usage,
      { nextStep: "Use `vibecodr login` for the usual path, or `vibecodr login agent` for the hosted Agent Computer." }
    );
  }
  let authorizationUrl: string | undefined;
  let callbackUrl: string | undefined;
  const result = await context.tokenManager.login(context.globalOptions, {
    scope: typeof flags["scope"] === "string" ? flags["scope"] : undefined,
    registrationMode: typeof flags["registration"] === "string" ? flags["registration"] as RegistrationMode : undefined,
    browserMode: typeof flags["browser"] === "string" ? flags["browser"] as BrowserMode : undefined,
    timeoutSec: typeof flags["timeout-sec"] === "string" ? Number(flags["timeout-sec"]) : undefined,
    onLoopbackReady: (url) => {
      callbackUrl = url;
      if (!context.globalOptions.json) {
        context.output.info(`Waiting for sign-in to finish on ${url}`);
        context.output.info("Keep this terminal open until login completes.");
      }
    },
    onAuthorizationUrl: (url) => {
      authorizationUrl = url;
      if (!context.globalOptions.json) {
        context.output.info("Open this URL to sign in to Vibecodr:");
        context.output.info(url);
      }
    }
  });

  context.output.success(
    {
      schemaVersion: 1,
      ...result,
      ...(callbackUrl ? { callbackUrl } : {}),
      ...(context.globalOptions.json && authorizationUrl ? { authorizationUrl } : {})
    },
    [
      "Signed in to Vibecodr for publishing, uploads, Pulses, and MCP Gateway tools.",
      `Profile: ${result.profile}`,
      `Server URL: ${result.serverUrl}`,
      `Authorization server: ${result.authorizationServerIssuer || "discovered"}`,
      `Registration mode: ${result.registrationMode}`,
      `Expires at: ${result.expiresAt || "unknown"}`,
      `Refresh token: ${result.hasRefreshToken ? "available" : "not issued"}`,
      "Next: run `vibecodr status` to see Agent Computer and MCP Gateway state.",
      "Note: Codex, Cursor, Claude, VS Code, and Windsurf have their own OAuth sessions. Use `vibecodr install codex` or another supported app name to add Vibecodr there."
    ]
  );
}
