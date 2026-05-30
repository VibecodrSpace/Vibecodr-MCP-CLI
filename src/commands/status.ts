import { access } from "node:fs/promises";
import { parseFlags } from "../cli/parse.js";
import { showHelpIfRequested } from "./help.js";
import { InstallManifestStore } from "../storage/install-manifest.js";
import type { BrokeredCredential, CredentialEndpoint } from "../auth/credential-broker.js";
import type { InstallManifestEntry } from "../types/install.js";
import type { CommandContext } from "./context.js";

type InstallStatus = InstallManifestEntry & {
  status: "configured" | "missing" | "external";
};

type CredentialSurfaceStatus = {
  surface: "agentComputer" | "mcpGateway";
  endpoint: CredentialEndpoint;
  authenticated: boolean;
  credentialKind?: BrokeredCredential["kind"] | undefined;
  serviceId?: BrokeredCredential["serviceId"] | undefined;
  expiresAt?: number | undefined;
  error?: string | undefined;
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

async function inspectCredentialSurface(
  context: CommandContext,
  surface: CredentialSurfaceStatus["surface"],
  endpoint: CredentialEndpoint
): Promise<CredentialSurfaceStatus> {
  if (!context.credentialBroker) {
    return {
      surface,
      endpoint,
      authenticated: false,
      error: "credential broker unavailable"
    };
  }
  try {
    const credential = await context.credentialBroker.getCredentialForEndpoint(endpoint);
    return {
      surface,
      endpoint,
      authenticated: Boolean(credential),
      ...(credential ? { credentialKind: credential.kind, serviceId: credential.serviceId } : {}),
      ...(credential?.expiresAt !== undefined ? { expiresAt: credential.expiresAt } : {})
    };
  } catch (error) {
    return {
      surface,
      endpoint,
      authenticated: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function credentialSurfaceLine(surface: CredentialSurfaceStatus): string {
  const label = surface.surface === "agentComputer" ? "Agent Computer" : "MCP Gateway";
  if (surface.error) return `${label}: credential state unavailable (${surface.error})`;
  if (!surface.authenticated) return `${label}: not authenticated`;
  const kind = surface.credentialKind ? ` via ${formatCredentialKind(surface.credentialKind)}` : "";
  return `${label}: signed in${kind}`;
}

function formatCredentialKind(kind: BrokeredCredential["kind"]): string {
  switch (kind) {
    case "api_key":
      return "API key";
    case "oauth":
      return "OAuth";
    case "token":
      return "temporary token";
    default:
      return kind;
  }
}

function statusNextStep(credentialSurfaces: CredentialSurfaceStatus[]): string {
  const agentComputer = credentialSurfaces.find((surface) => surface.surface === "agentComputer");
  const mcpGateway = credentialSurfaces.find((surface) => surface.surface === "mcpGateway");
  if (!agentComputer?.authenticated) {
    return "Next: run `vibecodr start` to approve the Agent Computer account connection.";
  }
  if (!mcpGateway?.authenticated) {
    return "Next: run `vibecodr login` only if you use publishing, uploads, Pulses, or MCP Gateway tools.";
  }
  return "Next: run `vibecodr browser read https://example.com` or `vibecodr mcp tools`.";
}

export async function runStatusCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(args, context, "Usage: vibecodr status [--probe] [--show-installs]")) return;
  const { flags } = parseFlags(args, {
    booleanFlags: ["probe", "show-installs"]
  });
  const { profileName, profile, serverUrl } = await context.tokenManager.resolveProfile(context.globalOptions);
  const session = await context.tokenManager.getSession(profileName, serverUrl);
  const sessionState = context.tokenManager.sessionState(session);
  const credentialSurfaces = await Promise.all([
    inspectCredentialSurface(context, "agentComputer", "tools.vibecodr.space"),
    inspectCredentialSurface(context, "mcpGateway", "openai.vibecodr.space/mcp")
  ]);
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

  const value = {
    schemaVersion: 1 as const,
    profile: profileName,
    serverUrl,
    sessionState,
    registrationMode: session?.registrationMode || profile.registrationMode,
    expiresAt: session?.expiresAt,
    credentialSurfaces,
    installs,
    ...(probe ? { probe } : {})
  };
  const humanLines = [
    "Vibecodr status",
    ...credentialSurfaces.map((surface) => credentialSurfaceLine(surface)),
    statusNextStep(credentialSurfaces),
    "",
    "Details:",
    `Profile: ${profileName}`,
    `MCP server: ${serverUrl}`,
    `MCP session: ${sessionState}`,
    `Registration mode: ${session?.registrationMode || profile.registrationMode}`,
    `MCP session expires: ${session?.expiresAt || "not logged in"}`,
    ...(flags["show-installs"] ? [`Managed installs: ${installs.length}`] : []),
    ...(flags["show-installs"]
      ? installs.map((install) => `Install: ${install.client} ${install.scope} ${install.location} [${install.status}]`)
      : []),
    ...(probe ? [`Authorization server: ${String(probe["authorizationServerUrl"])}`, `PKCE S256: ${probe["pkceS256"] ? "yes" : "no"}`] : [])
  ];

  context.output.success(value, humanLines);
}
