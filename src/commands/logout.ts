import { parseFlags } from "../cli/parse.js";
import { showHelpIfRequested } from "./help.js";
import type { CommandContext } from "./context.js";

export async function runLogoutCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(args, context, "Usage: vibecodr logout [--all] [--no-revoke]")) return;
  const { flags } = parseFlags(args, {
    booleanFlags: ["all", "no-revoke"]
  });
  const config = await context.configStore.load();
  const targetProfiles = flags["all"]
    ? Object.keys(config.profiles)
    : [context.globalOptions.profile || config.currentProfile];

  const results = [];
  for (const profileName of targetProfiles) {
    results.push({
      profile: profileName,
      ...(await context.tokenManager.logout(profileName, {
        noRevoke: Boolean(flags["no-revoke"])
      }))
    });
  }

  context.output.success(
    {
      schemaVersion: 1,
      results
    },
    [
      ...results.map((result) => `${result.profile}: local tokens ${result.localTokensDeleted ? "deleted" : "not present"}, revocation ${result.revocationAttempted ? (result.revocationConfirmed ? "confirmed" : "attempted") : "skipped"}`),
      "Editor registrations are unchanged."
    ]
  );
}
