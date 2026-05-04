import { access } from "node:fs/promises";
import { parseFlags } from "../cli/parse.js";
import { showHelpIfRequested } from "./help.js";
import { InstallManifestStore } from "../storage/install-manifest.js";
import type { InstallManifestEntry } from "../types/install.js";
import type { CommandContext } from "./context.js";

type InstallStatus = InstallManifestEntry & {
  status: "configured" | "missing" | "external";
};

async function inspectInstall(entry: InstallManifestEntry): Promise<InstallStatus> {
  if (entry.method !== "file") {
    return {
      ...entry,
      status: "external"
    };
  }
  try {
    await access(entry.location);
    return {
      ...entry,
      status: "configured"
    };
  } catch {
    return {
      ...entry,
      status: "missing"
    };
  }
}

export async function runStatusCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(args, context, "Usage: vibecodr status [--probe] [--show-installs]")) return;
  const { flags } = parseFlags(args, {
    booleanFlags: ["probe", "show-installs"]
  });
  const { profileName, profile, serverUrl } = await context.tokenManager.resolveProfile(context.globalOptions);
  const session = await context.tokenManager.getSession(profileName, serverUrl);
  const sessionState = context.tokenManager.sessionState(session);
  const installs = flags["show-installs"]
    ? await Promise.all((await new InstallManifestStore().find(() => true)).map((entry) => inspectInstall(entry)))
    : [];

  let probe: Record<string, unknown> | undefined;
  if (flags["probe"]) {
    const discovery = await context.tokenManager.discover(serverUrl);
    probe = {
      authorizationServerUrl: discovery.authorizationServerUrl,
      pkceS256: Boolean(discovery.authorizationServerMetadata?.code_challenge_methods_supported?.includes("S256"))
    };
  }

  context.output.success(
    {
      schemaVersion: 1,
      profile: profileName,
      serverUrl,
      sessionState,
      registrationMode: session?.registrationMode || profile.registrationMode,
      expiresAt: session?.expiresAt,
      installs,
      ...(probe ? { probe } : {})
    },
    [
      `Profile: ${profileName}`,
      `Server URL: ${serverUrl}`,
      `Session state: ${sessionState}`,
      `Registration mode: ${session?.registrationMode || profile.registrationMode}`,
      `Expires at: ${session?.expiresAt || "not logged in"}`,
      ...(flags["show-installs"] ? [`Managed installs: ${installs.length}`] : []),
      ...(flags["show-installs"]
        ? installs.map((install) => `Install: ${install.client} ${install.scope} ${install.location} [${install.status}]`)
        : []),
      ...(probe ? [`Authorization server: ${String(probe["authorizationServerUrl"])}`, `PKCE S256: ${probe["pkceS256"] ? "yes" : "no"}`] : [])
    ]
  );
}
