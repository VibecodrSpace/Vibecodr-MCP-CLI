import { parseFlags } from "../cli/parse.js";
import { showHelpIfRequested } from "./help.js";
import type { BrowserMode, RegistrationMode } from "../types/config.js";
import type { CommandContext } from "./context.js";

export async function runLoginCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(args, context, "Usage: vibecodr login [--scope <oauth-scope>] [--registration auto|preregistered|cimd|dcr|manual] [--browser open|print] [--timeout-sec <n>]")) return;
  const { flags } = parseFlags(args, {
    valueFlags: ["scope", "registration", "browser", "timeout-sec"]
  });
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
        context.output.info(`Waiting for OAuth callback on ${url}`);
        context.output.info("Keep this terminal open until login completes.");
      }
    },
    onAuthorizationUrl: (url) => {
      authorizationUrl = url;
      if (!context.globalOptions.json) {
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
      `Profile: ${result.profile}`,
      `Server URL: ${result.serverUrl}`,
      `Authorization server: ${result.authorizationServerIssuer || "discovered"}`,
      `Registration mode: ${result.registrationMode}`,
      `Expires at: ${result.expiresAt || "unknown"}`,
      `Refresh token: ${result.hasRefreshToken ? "available" : "not issued"}`,
      "CLI login does not log Codex, editors, ChatGPT, or other MCP clients into MCP. Each client owns its own OAuth session."
    ]
  );
}
