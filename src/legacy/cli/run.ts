import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { ConfigStore, DEFAULT_API_URL, resolveConfigDir, type StoredAuthState, type StoredGrant, type StoredLocalCredential } from "../config/store.js";
import { createApiClient, createBaseClient, encodePathSegment, normalizeBaseUrl, type ApiClient } from "../core/api-client.js";
import {
  CAPABILITIES,
  DASHBOARD_SECTIONS,
  DEFAULT_PLANS,
  LAUNCH_POLICIES,
  LAUNCH_TOOL_GRANTS,
  LAUNCH_WORKFLOWS,
  OVERAGE_METERS,
  PUBLIC_OFFERING_CLASSIFICATIONS,
  type ApiHealth,
  type CapabilityName,
  type MeResponse
} from "../core/contracts.js";
import { GOAL_INSPECTIONS, goalCoverageSummary } from "../core/goal-coverage.js";
import { VC_TOOLS_VERSION } from "../core/version.js";
import {
  normalizeCapabilityName,
  sanitizeFilename,
  validateBrowserUrl,
  validateEntityId,
  validatePositiveInt,
  validateSandboxCommand
} from "../core/validators.js";
import { CliError, toCliError } from "./errors.js";
import { installClient, isInstallableClient, type InstallResult } from "./install.js";
import { writeError, writeResult, type CommandResult } from "./output.js";
import {
  getBooleanFlag,
  getStringFlag,
  parseArgv,
  parseCommandOptions,
  type GlobalOptions,
  type ParsedCommandOptions
} from "./parser.js";

const VERSION = VC_TOOLS_VERSION;
const MAX_CREDENTIAL_BYTES = 64 * 1024;
const DEFAULT_AUTH_API_URL = "https://api.vibecodr.space";
const GRANT_REFRESH_SKEW_SECONDS = 60;
const ARTIFACT_OUTPUT_WORKSPACE_MESSAGE =
  "Artifact output is workspace-bounded so downloaded bytes can only be written to files you intentionally target inside this workspace. Use --local for ./vibecodr-proof, --out ./artifacts, --out ./artifacts/report.pdf, or cd to the intended workspace and use --out .";
const ARTIFACT_INPUT_WORKSPACE_MESSAGE =
  "Artifact upload sources are workspace-bounded so the CLI only reads files you intentionally target inside this workspace. Move the file into this workspace, or cd to the workspace that contains it.";

export interface RunCliOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  stdout?: Writable;
  stderr?: Writable;
  stdin?: Readable;
  fetchImpl?: typeof fetch;
}

interface CommandContext {
  env: NodeJS.ProcessEnv;
  cwd: string;
  globals: GlobalOptions;
  store: ConfigStore;
  stdin: Readable;
  fetchImpl: typeof fetch | undefined;
  stderr: Writable;
}

type LoginCredential =
  | { mode: "token"; value: string; source: CredentialSource }
  | { mode: "oauth"; value: string; source: CredentialSource }
  | { mode: "api_key"; value: string; source: CredentialSource };

type CredentialMode = LoginCredential["mode"];
type CredentialDescriptorMode = CredentialMode | "auto";
type CredentialSource = "flag" | "file" | "stdin" | "env";

interface CredentialDescriptor {
  mode: CredentialDescriptorMode;
  source: CredentialSource;
  label: string;
  value?: string | undefined;
  file?: string | undefined;
}

interface CliGrantExchangeResponse {
  token_type: string;
  access_token: string;
  expires_at: number;
  user_id: string;
  user_handle?: string | undefined;
  credential_type?: string | undefined;
  grant_profile?: string | undefined;
  scopes?: string[] | undefined;
  durable_credential?: DurableCredentialResponse | undefined;
}

interface DurableCredentialResponse {
  type: "api_key";
  api_key: string;
  id?: string | undefined;
  name?: string | undefined;
  expires_at?: number | undefined;
}

interface DeviceStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string | undefined;
  expires_at: number;
  interval: number;
  message?: string | undefined;
}

type DevicePollResponse =
  | CliGrantExchangeResponse
  | {
      status: "authorization_pending";
      interval?: number | undefined;
      expires_at?: number | undefined;
      message?: string | undefined;
    };

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;

  let parsed;
  try {
    parsed = parseArgv(argv);
  } catch (error) {
    const cliError = toCliError(error);
    writeError(cliError, { json: false, quiet: false, stdout, stderr });
    return cliError.exitCode;
  }

  const { globals, commandArgs } = parsed;

  try {
    if (globals.version) {
      writeResult({ message: `vibecodr ${VERSION}`, data: { version: VERSION }, humanData: "hide" }, { json: globals.json, quiet: globals.quiet, stdout, stderr });
      return 0;
    }

    if (globals.help || commandArgs.length === 0) {
      const help = helpResult(commandArgs);
      writeResult(help, { json: globals.json, quiet: globals.quiet, stdout, stderr });
      return 0;
    }

    const env = options.env ?? process.env;
    const context: CommandContext = {
      env,
      cwd: options.cwd ?? process.cwd(),
      globals,
      store: ConfigStore.resolve(env, globals.configDir),
      stdin: options.stdin ?? process.stdin,
      fetchImpl: options.fetchImpl,
      stderr
    };

    const result = await dispatch(context, commandArgs);
    writeResult(result, { json: globals.json, quiet: globals.quiet, stdout, stderr });
    return 0;
  } catch (error) {
    const cliError = toCliError(error);
    writeError(cliError, { json: globals.json, quiet: globals.quiet, stdout, stderr });
    return cliError.exitCode;
  }
}

async function dispatch(context: CommandContext, args: string[]): Promise<CommandResult> {
  const [command, subcommand, ...rest] = args;

  switch (command) {
    case "start":
    case "setup":
      return commandStart(context, parseCommandOptions(withOptionalHead(subcommand, rest)));
    case "login":
      return commandLogin(context, parseCommandOptions(withOptionalHead(subcommand, rest)));
    case "logout":
      return commandLogout(context, parseCommandOptions(withOptionalHead(subcommand, rest)));
    case "status":
      return commandStatus(context);
    case "whoami":
      return commandWhoami(context);
    case "connect":
      return commandConnect(context, parseCommandOptions(withOptionalHead(subcommand, rest)));
    case "agent":
      return commandAgent(context, subcommand, rest);
    case "auth":
      return commandAuth(context, subcommand, rest);
    case "computer":
      return commandComputer(context, subcommand, rest);
    case "browser":
      return commandBrowser(context, subcommand, rest);
    case "try":
      return commandTry(context, parseCommandOptions(withOptionalHead(subcommand, rest)));
    case "work":
      return commandWork(context, subcommand, rest);
    case "proof":
      return commandProof(context, subcommand, rest);
    case "tools":
      return commandTools(context, subcommand, rest);
    case "jobs":
      return commandJobs(context, subcommand, rest);
    case "artifacts":
      return commandArtifacts(context, subcommand, rest);
    case "usage":
      return commandUsage(context, parseCommandOptions(withOptionalHead(subcommand, rest)));
    case "limits":
      return commandUsage(context, parseCommandOptions(withOptionalHead(subcommand, rest)));
    case "grants":
      return commandGrants(context, subcommand, rest);
    case "retention":
      return commandRetention(context, subcommand, rest);
    case "scheduled-qa":
      return commandScheduledQa(context, subcommand, rest);
    case "plans":
      return commandPlans(context, parseCommandOptions(withOptionalHead(subcommand, rest)));
    case "dashboard":
      return commandDashboard(context, parseCommandOptions(withOptionalHead(subcommand, rest)));
    case "inspect":
      return commandInspect();
    case "doctor":
      return commandDoctor(context, parseCommandOptions(withOptionalHead(subcommand, rest)));
    case "help":
      return helpResult(withOptionalHead(subcommand, rest));
    default:
      throw unknownCommandError(command);
  }
}

function commandInspect(): CommandResult {
  const summary = goalCoverageSummary();
  return {
    message: summary.hostedRequired === 0
      ? `vibecodr goal coverage: ${summary.localVerified}/${summary.total} inspections verified.`
      : `vibecodr goal coverage: ${summary.localVerified}/${summary.total} locally verified, ${summary.hostedRequired} hosted-service check pending.`,
    data: {
      summary,
      inspections: GOAL_INSPECTIONS
    }
  };
}

async function commandStart(context: CommandContext, parsed: ParsedCommandOptions): Promise<CommandResult> {
  const clientName = getStringFlag(parsed.flags, "client") ?? parsed.positionals[0] ?? "generic";
  const surface = outputSurface(parsed);
  let token = await resolveToken(context, false);
  let login: CommandResult | undefined;

  if (!token) {
    if (context.globals.noInput) {
      throw new CliError(
        "auth.approval_required",
        "This Agent Computer is not connected yet. Run vibecodr start without --no-input to open Vibecodr approval, or use an advanced file/stdin credential source for automation.",
        3
      );
    }
    login = await commandLogin(context, parseCommandOptions([]));
    token = await resolveToken(context, true);
  }

  const { profile } = await getOptionalProfile(context);
  let client = createClient(context, profile, token);
  let readiness: [MeResponse, ApiHealth, Record<string, unknown>, unknown];
  try {
    readiness = await readStartReadiness(client, clientName, surface);
  } catch (error) {
    if (toCliError(error).code !== "auth.denied") {
      throw error;
    }
    token = await resolveToken(context, true, { forceRefresh: true });
    client = createClient(context, profile, token);
    readiness = await readStartReadiness(client, clientName, surface);
  }
  const [me, health, connection, usage] = readiness;
  const data = surface.details || surface.operator
    ? {
        ...publicStartPayload(me, health, connection, usage, login !== undefined),
        details: {
          account: me,
          health: publicHealthPayload(health),
          agentConnection: publicConnectionPayload(connection),
          usage: publicUsagePayload(usage)
        }
      }
    : publicStartPayload(me, health, connection, usage, login !== undefined);

  return {
    message: formatStartSummary(me, health, connection, login !== undefined),
    data,
    humanData: surface.details || surface.operator ? "show" : "hide"
  };
}

async function readStartReadiness(
  client: ApiClient,
  clientName: string,
  surface: OutputSurface
): Promise<[MeResponse, ApiHealth, Record<string, unknown>, unknown]> {
  return await Promise.all([
    client.request<MeResponse>("GET", "me"),
    client.request<ApiHealth>("GET", "health", { auth: false, query: queryForSurface(surface) }),
    client.request<Record<string, unknown>>("GET", "mcp/connection", { query: { client: clientName, ...queryForSurface(surface) } }),
    client.request<unknown>("GET", "usage", { query: queryForSurface(surface) }).catch((error) => ({ unavailable: true, message: toCliError(error).message }))
  ]);
}

async function commandTry(context: CommandContext, parsed: ParsedCommandOptions): Promise<CommandResult> {
  await commandStart(context, parsed);
  const { profile } = await context.store.getProfile(context.globals.profile);
  const client = createClient(context, profile, await resolveToken(context, true));
  const proofDir = getStringFlag(parsed.flags, "out") ?? "vibecodr-proof";
  const browserParsed: ParsedCommandOptions = {
    positionals: ["https://example.com"],
    flags: {
      ...parsed.flags,
      out: proofDir,
      filename: "browser-read.md",
      pollIntervalMs: getStringFlag(parsed.flags, "pollIntervalMs") ?? "250"
    }
  };
  const computerParsed: ParsedCommandOptions = {
    positionals: [],
    flags: {
      ...parsed.flags,
      command: "node -e \"console.log('vibecodr computer ok')\"",
      out: proofDir,
      filename: "computer-run.json",
      pollIntervalMs: getStringFlag(parsed.flags, "pollIntervalMs") ?? "250"
    }
  };
  const checks: Record<string, "ok" | "failed"> = {
    auth: "ok",
    hostedApi: "ok",
    browser: "failed",
    computer: "failed",
    proof: "failed",
    usage: "failed"
  };
  const warnings: string[] = [];

  const browserPayload = buildToolTestPayload("browser.extract_markdown", browserParsed.positionals[0], browserParsed);
  const browserWork = await client.request<unknown>("POST", "tools/test", { body: browserPayload });
  const browserResult = await followSubmittedWork(context, client, "browser.extract_markdown", browserWork, browserParsed);
  if (isRecord(browserResult.data) && browserResult.data.status === "completed") {
    checks.browser = "ok";
  }
  const browserProof = isRecord(browserResult.data) && isRecord(browserResult.data.proof) ? browserResult.data.proof : undefined;
  if (isRecord(browserProof) && typeof browserProof.path === "string") {
    checks.proof = "ok";
  }

  try {
    const computerPayload = buildToolTestPayload("sandbox.run_command", undefined, computerParsed);
    const computerWork = await client.request<unknown>("POST", "tools/test", { body: computerPayload });
    const computerResult = await followSubmittedWork(context, client, "sandbox.run_command", computerWork, computerParsed);
    if (isRecord(computerResult.data) && computerResult.data.status === "completed") {
      checks.computer = "ok";
    }
    const computerProof = isRecord(computerResult.data) && isRecord(computerResult.data.proof) ? computerResult.data.proof : undefined;
    if (isRecord(computerProof) && typeof computerProof.path === "string") {
      checks.proof = "ok";
    }
  } catch (error) {
    warnings.push(`Computer check did not complete: ${toCliError(error).message}`);
  }

  try {
    await client.request<unknown>("GET", "usage");
    checks.usage = "ok";
  } catch (error) {
    warnings.push(`Usage check did not complete: ${toCliError(error).message}`);
  }

  const ready = Object.values(checks).every((status) => status === "ok");
  return {
    message: ready
      ? `Vibecodr Agent Computer check passed.\nProof saved: ${path.resolve(context.cwd, proofDir)}`
      : `Vibecodr Agent Computer check finished with attention needed.\nProof path: ${path.resolve(context.cwd, proofDir)}`,
    data: {
      ready,
      checks,
      proofPath: path.resolve(context.cwd, proofDir)
    },
    warnings,
    humanData: getBooleanFlag(parsed.flags, "details") ? "show" : "hide"
  };
}

async function commandDashboard(context: CommandContext, parsed: ParsedCommandOptions): Promise<CommandResult> {
  const section = getStringFlag(parsed.flags, "section") ?? parsed.positionals[0] ?? "overview";
  const sections: string[] = DASHBOARD_SECTIONS.map((item) => item.id);
  if (!sections.includes(section)) {
    throw new CliError("input.invalid_dashboard_section", `Dashboard section must be one of: ${sections.join(", ")}.`, 2);
  }

  const { profile } = await getOptionalProfile(context);
  const url = normalizeBaseUrl(
    context.globals.apiUrl ?? context.env.VC_TOOLS_API_URL ?? profile.apiUrl,
    allowInsecureLocalApi(context)
  );
  url.pathname = section === "overview" ? "/dashboard/" : `/dashboard/${section}/`;
  url.search = "";
  url.hash = "";

  const urlString = url.toString();
  const skipOpen =
    getBooleanFlag(parsed.flags, "noOpen") ||
    parsed.flags.open === false ||
    context.globals.json ||
    context.globals.quiet ||
    context.globals.noInput;
  let opened = false;
  if (!skipOpen) {
    opened = await maybeOpenBrowser(context, parsed, urlString);
  }

  return {
    message: opened
      ? `Opened the Vibecodr dashboard: ${urlString}`
      : `Vibecodr dashboard: ${urlString}\nUse vibecodr dashboard --no-open to suppress opening, or --json for machine-readable metadata.`,
    data: {
      url: urlString,
      section,
      opened,
      sections,
      sectionContract: DASHBOARD_SECTIONS.find((item) => item.id === section)
    }
  };
}

async function commandLogin(context: CommandContext, parsed: ParsedCommandOptions): Promise<CommandResult> {
  const credential = await resolveLoginCredential(context, parsed, true);

  let exchange: CliGrantExchangeResponse | undefined;
  let token: string;
  let authMode: CredentialMode | "browser_device";
  let browserLogin:
    | {
        userCode: string;
        verificationUri: string;
        openedBrowser: boolean;
      }
    | undefined;

  if (credential === undefined) {
    if (context.globals.noInput) {
      throw new CliError(
        "auth.token_required",
        "Browser login needs interactive approval. Run vibecodr login without --no-input, or use an automation-safe credential source such as Get-Clipboard | vibecodr login --credential-stdin or vibecodr login --credential-file <path>.",
        3
      );
    }
    const browserExchange = await completeBrowserDeviceLogin(context, parsed);
    exchange = browserExchange.exchange;
    token = exchange.access_token;
    authMode = "browser_device";
    browserLogin = browserExchange.browserLogin;
    validateTokenShape(token);
  } else if (credential.mode === "token") {
    token = credential.value;
    authMode = credential.mode;
    validateTokenShape(token);
  } else {
    authMode = credential.mode;
    validateCredentialShape(credential.value, credential.mode === "oauth" ? "OAuth token" : "API key");
    exchange = await exchangeCredentialForGrant(context, parsed, credential);
    token = exchange.access_token;
    validateTokenShape(token);
  }

  const apiUrl = context.globals.apiUrl ?? getStringFlag(parsed.flags, "apiUrl") ?? context.env.VC_TOOLS_API_URL ?? DEFAULT_API_URL;
  const skipVerify = getBooleanFlag(parsed.flags, "skipVerify");
  const client = createApiClient({
    baseUrl: versionedApiUrl(apiUrl, allowInsecureLocalApi(context)),
    token,
    timeoutMs: context.globals.timeoutMs,
    allowInsecureLocalApi: allowInsecureLocalApi(context),
    fetchImpl: context.fetchImpl
  });

  let me: MeResponse | undefined;
  if (!skipVerify) {
    me = await client.request<MeResponse>("GET", "me");
  }

  const workspaceId = me?.workspace?.id;
  await context.store.saveProfile(context.globals.profile, workspaceId ? { apiUrl, workspaceId } : { apiUrl });
  await storeLoginAuth(context, authMode, credential, exchange, token);

  return {
    message: skipVerify
      ? "Saved the Agent Computer credential without live verification."
      : `Approved this Vibecodr Agent Computer for ${formatMaybeAccountLabel(me)}.`,
    data: {
      apiUrl,
      authMode,
      storedAuth: storedCredentialSummary(authMode, credential, exchange),
      grantExpiresAt: exchange?.expires_at,
      grantProfile: exchange?.grant_profile,
      grantScopes: exchange?.scopes,
      browserLogin,
      verified: !skipVerify,
      user: me?.user,
      workspace: me?.workspace,
      plan: me?.plan
    }
  };
}

async function commandLogout(context: CommandContext, parsed: ParsedCommandOptions): Promise<CommandResult> {
  const yes = getBooleanFlag(parsed.flags, "yes");
  if (!yes) {
    throw new CliError("confirm.required", "Logout removes the stored Agent Computer credential. Re-run with --yes to confirm.", 4);
  }
  const cleared = await context.store.clearToken(context.globals.profile);
  return {
    message: cleared ? "Removed this Agent Computer credential." : "No Agent Computer credential was stored.",
    data: { cleared }
  };
}

async function storeLoginAuth(
  context: CommandContext,
  authMode: CredentialMode | "browser_device",
  credential: LoginCredential | undefined,
  exchange: CliGrantExchangeResponse | undefined,
  token: string
): Promise<void> {
  const savedAt = new Date().toISOString();
  const grant: StoredGrant = {
    token,
    savedAt,
    source: authMode === "browser_device" ? "browser_device" : authMode === "token" ? "token" : "exchange",
    expiresAt: exchange?.expires_at
  };

  const durableFromDevice = exchange?.durable_credential;
  if (durableFromDevice) {
    await context.store.saveDurableCredential(
      {
        mode: "api_key",
        value: durableFromDevice.api_key,
        savedAt,
        source: "browser_device",
        expiresAt: durableFromDevice.expires_at
      },
      grant
    );
    return;
  }

  if (credential?.mode === "api_key" || credential?.mode === "oauth") {
    await context.store.saveDurableCredential(
      {
        mode: credential.mode,
        value: credential.value,
        savedAt,
        source: credential.source,
        expiresAt: exchange?.durable_credential?.expires_at
      },
      grant
    );
    return;
  }

  await context.store.saveGrant(grant);
}

function storedCredentialSummary(
  authMode: CredentialMode | "browser_device",
  credential: LoginCredential | undefined,
  exchange: CliGrantExchangeResponse | undefined
): Record<string, unknown> {
  const durableFromDevice = exchange?.durable_credential;
  if (durableFromDevice) {
    return {
      kind: "durable",
      mode: "api_key",
      source: "browser_device",
      name: durableFromDevice.name,
      expiresAt: durableFromDevice.expires_at
    };
  }
  if (credential?.mode === "api_key" || credential?.mode === "oauth") {
    return {
      kind: "durable",
      mode: credential.mode,
      source: credential.source
    };
  }
  return {
    kind: "grant_cache",
    mode: authMode === "browser_device" ? "browser_device" : "token"
  };
}

async function commandStatus(context: CommandContext): Promise<CommandResult> {
  const auth = await inspectAuthState(context);
  const { profile } = await getOptionalProfile(context);
  let health: ApiHealth | undefined;
  const warnings: string[] = [...auth.warnings];

  try {
    const client = createClient(context, profile, auth.token);
    health = await client.request<ApiHealth>("GET", "health", { auth: false });
  } catch (error) {
    warnings.push(toCliError(error).message);
  }

  return {
    message: auth.token
      ? `This Vibecodr Agent Computer has a credential available from ${auth.credential.winning?.label ?? "stored credentials"}. Run vibecodr agent status for account and connection details.`
      : "This Vibecodr Agent Computer is not connected yet. Run vibecodr start to connect it.",
    warnings,
    data: {
      apiUrl: profile.apiUrl,
      config: auth.config,
      authSources: auth.credential,
      authenticated: Boolean(auth.token),
      health
    }
  };
}

async function commandWhoami(context: CommandContext): Promise<CommandResult> {
  const { profile } = await context.store.getProfile(context.globals.profile);
  const client = createClient(context, profile, await resolveToken(context, true));
  const me = await client.request<MeResponse>("GET", "me");
  return {
    message: formatWhoamiSummary(me),
    data: me
  };
}

async function commandConnect(context: CommandContext, parsed: ParsedCommandOptions): Promise<CommandResult> {
  const clientName = getStringFlag(parsed.flags, "client") ?? parsed.positionals[0] ?? "generic";
  const serverName = getStringFlag(parsed.flags, "name") ?? "vc-tools";
  const surface = outputSurface(parsed);
  const printOnly = getBooleanFlag(parsed.flags, "print") || parsed.flags.install === false;
  const dryRun = getBooleanFlag(parsed.flags, "dryRun") || parsed.flags.dryRun === true;
  const overwrite = getBooleanFlag(parsed.flags, "overwrite");
  const installDir = getStringFlag(parsed.flags, "installDir");
  const { profile } = await context.store.getProfile(context.globals.profile);
  const client = createClient(context, profile, await resolveToken(context, true));
  const connection = await client.request<Record<string, unknown>>("GET", "mcp/connection", {
    query: { client: clientName, ...queryForSurface(surface) }
  });
  const publicConnection = publicConnectionPayload(connection);
  const url = typeof publicConnection.url === "string" ? publicConnection.url : undefined;

  const warnings: string[] = [];
  let installResult: InstallResult | undefined;
  const namedClientAuthBlocked = url !== undefined && hostedAgentComputerClientAuthBlocked(clientName, url, publicConnection);
  if (namedClientAuthBlocked) {
    warnings.push(hostedAgentComputerClientAuthMessage(clientName));
  }
  if (!printOnly && url && isInstallableClient(clientName) && !namedClientAuthBlocked) {
    try {
      installResult = await installClient({
        client: clientName,
        serverUrl: url,
        serverName,
        overwrite,
        dryRun,
        cwd: context.cwd,
        env: context.env,
        installDir
      });
    } catch (error) {
      warnings.push(`${toCliError(error).message} Falling back to copy-paste config; pass --print to skip install attempts.`);
    }
  }

  const message = formatAgentConnectionSummary(clientName, publicConnection, serverName, installResult);
  const data = surface.details || surface.operator
    ? { ...publicConnection, details: connection, install: installResult }
    : installResult
      ? { ...publicConnection, install: installResult }
      : publicConnection;

  return {
    message,
    data,
    warnings,
    humanData: surface.details || surface.operator ? "show" : "hide"
  };
}

async function commandAgent(context: CommandContext, subcommand: string | undefined, rest: string[]): Promise<CommandResult> {
  switch (subcommand ?? "connect") {
    case "connect":
    case "instructions":
      return commandConnect(context, parseCommandOptions(rest));
    case "status":
      return commandStart(context, parseCommandOptions(rest));
    default:
      throw unknownSubcommandError("agent", subcommand, ["connect", "instructions", "status"], "Use vibecodr agent connect [--client codex] or vibecodr agent status.");
  }
}

async function commandAuth(context: CommandContext, subcommand: string | undefined, rest: string[]): Promise<CommandResult> {
  switch (subcommand ?? "diagnose") {
    case "diagnose":
      return commandAuthDiagnose(context);
    case "status":
      return commandStatus(context);
    case "export-agent-env":
      return commandAuthExportAgentEnv(context, parseCommandOptions(rest));
    default:
      throw unknownSubcommandError("auth", subcommand, ["diagnose", "status", "export-agent-env"], "Use vibecodr auth diagnose or vibecodr auth export-agent-env --out <file> --yes.");
  }
}

async function commandAuthDiagnose(context: CommandContext): Promise<CommandResult> {
  const auth = await inspectAuthState(context);
  const { profile } = await getOptionalProfile(context);
  let verification: Record<string, unknown> | undefined;
  const warnings = [...auth.warnings];

  if (auth.token) {
    try {
      const client = createClient(context, profile, auth.token);
      const me = await client.request<MeResponse>("GET", "me");
      verification = {
        ok: true,
        account: {
          label: formatAccountLabel(me),
          plan: me.plan?.name,
          workspace: me.workspace?.name ?? me.workspace?.id
        }
      };
    } catch (error) {
      const cliError = toCliError(error);
      verification = {
        ok: false,
        code: cliError.code,
        message: cliError.message
      };
      warnings.push(cliError.message);
    }
  }

  const message = auth.token
    ? `Auth diagnose: credential source is ${auth.credential.winning?.label ?? "stored credentials"}.`
    : "Auth diagnose: no usable credential source found. Run vibecodr start.";

  return {
    message,
    warnings,
    data: {
      apiUrl: profile.apiUrl,
      os: {
        platform: process.platform,
        user: safeOsUser()
      },
      config: auth.config,
      authSources: auth.credential,
      verification,
      next: auth.token
        ? ["Use vibecodr agent status to verify the full Agent Computer connection."]
        : ["Run vibecodr start to connect this Agent Computer.", "If this is an isolated agent, check VC_TOOLS_CONFIG_DIR and VC_TOOLS_CREDENTIAL_FILE."]
    }
  };
}

async function commandAuthExportAgentEnv(context: CommandContext, parsed: ParsedCommandOptions): Promise<CommandResult> {
  const out = getStringFlag(parsed.flags, "out") ?? parsed.positionals[0];
  if (!out) {
    throw new CliError("input.output_required", "auth export-agent-env requires --out <file>.", 2);
  }
  if (!getBooleanFlag(parsed.flags, "yes")) {
    throw new CliError("confirm.required", "Exporting an agent credential writes a credential file to disk. Re-run with --yes to confirm.", 4);
  }

  const auth = await inspectAuthState(context);
  const authState = await context.store.readAuthState().catch((): StoredAuthState => ({ version: 2 }));
  const durableCredential = authState.credential?.mode === "api_key" || authState.credential?.mode === "oauth"
    ? authState.credential
    : undefined;
  if (!auth.token) {
    throw new CliError("auth.missing", "No Vibecodr approval is available to export. Run vibecodr start first.", 3);
  }

  const target = path.resolve(context.cwd, out);
  await ensureOutputPathAllowed(context.cwd, target);
  if (await pathExists(target) && !getBooleanFlag(parsed.flags, "overwrite")) {
    throw new CliError("file.exists", `Refusing to overwrite existing credential file: ${target}. Use --overwrite if intended.`, 5);
  }

  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const exportedValue = durableCredential?.value ?? auth.token;
  await fs.writeFile(target, `${exportedValue}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    await fs.chmod(target, 0o600);
  } catch {
    // Windows may not honor POSIX modes, but Node still requests the narrowest practical mode.
  }

  const envName = durableCredential ? "VC_TOOLS_CREDENTIAL_FILE" : "VC_TOOLS_TOKEN_FILE";
  const exportedKind = durableCredential ? formatCredentialMode(durableCredential.mode) : "short-lived Vibecodr grant";
  return {
    message: `Wrote an agent credential file (${exportedKind}). Set ${envName}=${target} for the agent process.`,
    data: {
      file: target,
      env: {
        name: envName,
        value: target,
        assignment: `${envName}=${target}`
      },
      durable: Boolean(durableCredential),
      source: auth.credential.winning,
      note: "Do not commit this file, paste it into prompts, or share it outside the intended agent process."
    }
  };
}

async function commandBrowser(context: CommandContext, subcommand: string | undefined, rest: string[]): Promise<CommandResult> {
  const parsed = parseCommandOptions(rest);
  switch (subcommand) {
    case "render":
      return submitHostedCapability(context, "browser.render", parsed, "Asked the hosted Browser to render the public page.", { autoFollow: true });
    case "screenshot":
      return submitHostedCapability(context, "browser.screenshot", parsed, "Asked the hosted Browser to capture a screenshot.", { autoFollow: true });
    case "read":
    case "markdown":
      return submitHostedCapability(context, "browser.read", parsed, "Asked the hosted Browser to read the public page.", { autoFollow: true });
    case "pdf":
      return submitHostedCapability(context, "browser.pdf", parsed, "Asked the hosted Browser to create a PDF.", { autoFollow: true });
    case "crawl":
      return submitHostedCapability(context, "browser.crawl", parsed, "Asked the hosted Browser to crawl the public site.", { autoFollow: true });
    case "snapshot": {
      const normalized = normalizeBrowserSnapshotOptions(parsed);
      return submitHostedCapability(context, "browser.snapshot", normalized, "Captured a hosted Browser snapshot.", { autoFollow: true });
    }
    case "notes":
    case "ask": {
      const normalized = normalizeBrowserNotesOptions(parsed);
      return submitHostedCapability(context, "browser.notes", normalized, "Captured a hosted Browser snapshot with your note attached.", { autoFollow: true });
    }
    default:
      throw unknownSubcommandError("browser", subcommand, ["render", "screenshot", "read", "markdown", "pdf", "crawl", "snapshot", "notes"], "Use vibecodr browser screenshot <https-url>, browser read <https-url>, or browser snapshot <https-url> --local.");
  }
}

async function commandComputer(context: CommandContext, subcommand: string | undefined, rest: string[]): Promise<CommandResult> {
  switch (subcommand ?? "status") {
    case "start":
    case "status":
      return commandStart(context, parseCommandOptions(rest));
    case "run": {
      const parsed = normalizeComputerCommandOptions(parseCommandOptions(rest), "computer run requires a command, for example: vibecodr computer run \"npm test\".");
      return submitHostedCapability(context, "computer.run", parsed, "Submitted work to the hosted Agent Computer.", { autoFollow: true });
    }
    case "test":
    case "tests": {
      const parsed = normalizeComputerCommandOptions(parseCommandOptions(rest), "computer test requires a command, for example: vibecodr computer test \"npm test\".");
      return submitHostedCapability(context, "computer.test", parsed, "Submitted tests to the hosted Agent Computer.", { autoFollow: true });
    }
    default:
      throw unknownSubcommandError("computer", subcommand, ["start", "status", "run", "test"], "Use vibecodr computer start, computer status, computer run \"<command>\", or computer test \"<command>\".");
  }
}

async function commandWork(context: CommandContext, subcommand: string | undefined, rest: string[]): Promise<CommandResult> {
  switch (subcommand ?? "list") {
    case "list":
      return commandJobs(context, "list", rest);
    case "show":
    case "status":
      return commandJobs(context, "status", rest);
    case "follow":
      return commandWorkFollow(context, parseCommandOptions(rest));
    case "cancel":
      return commandJobs(context, "cancel", rest);
    default:
      throw unknownSubcommandError("work", subcommand, ["list", "show", "status", "follow", "cancel"], "Use vibecodr work list, work show <jobId>, work follow <jobId>, or work cancel <jobId> --yes.");
  }
}

async function commandProof(context: CommandContext, subcommand: string | undefined, rest: string[]): Promise<CommandResult> {
  switch (subcommand ?? "list") {
    case "list":
      return commandArtifacts(context, "list", rest);
    case "show":
    case "get":
      return commandArtifacts(context, "get", rest);
    case "save":
    case "pull":
      return commandArtifacts(context, "pull", rest);
    case "delete":
      return commandArtifacts(context, "delete", rest);
    default:
      throw unknownSubcommandError("proof", subcommand, ["list", "show", "save", "delete"], "Use vibecodr proof list, proof show <artifactId>, proof save <artifactId> --out ./artifacts, or proof delete <artifactId> --yes.");
  }
}

async function commandTools(context: CommandContext, subcommand: string | undefined, rest: string[]): Promise<CommandResult> {
  switch (subcommand) {
    case "list": {
      const { profile } = await context.store.getProfile(context.globals.profile);
      const client = createClient(context, profile, await resolveToken(context, true));
      const tools = await client.request<unknown>("GET", "tools");
      return { message: "Fetched granted Vibecodr capabilities.", data: tools };
    }
    case "test":
      return commandToolsTest(context, parseCommandOptions(rest));
    default:
      throw unknownSubcommandError("tools", subcommand, ["list", "test"], "Use vibecodr tools list or vibecodr tools test <capability>.");
  }
}

async function commandToolsTest(context: CommandContext, parsed: ParsedCommandOptions): Promise<CommandResult> {
  const [capabilityInput, target] = parsed.positionals;
  if (!capabilityInput) {
    throw new CliError("input.capability_required", "tools test requires a capability name.", 2);
  }
  return submitHostedCapability(context, capabilityInput, { positionals: target === undefined ? [] : [target], flags: parsed.flags });
}

interface SubmitHostedCapabilityOptions {
  autoFollow?: boolean;
}

const DEFAULT_LOCAL_PROOF_DIR = "vibecodr-proof";

async function submitHostedCapability(
  context: CommandContext,
  capabilityInput: string,
  parsed: ParsedCommandOptions,
  successMessage?: string,
  options: SubmitHostedCapabilityOptions = {}
): Promise<CommandResult> {
  const capability = normalizeCapabilityName(capabilityInput);
  if (getBooleanFlag(parsed.flags, "local") && shouldSkipWait(parsed)) {
    throw new CliError("input.local_requires_wait", "--local saves the completed output, so it cannot be combined with --no-wait.", 2);
  }
  const payload = buildToolTestPayload(
    capability,
    parsed.positionals[0],
    parsed,
    context.globals.timeoutMs === 30_000 ? undefined : context.globals.timeoutMs
  );
  const { profile } = await context.store.getProfile(context.globals.profile);
  const client = createClient(context, profile, await resolveToken(context, true));
  const response = await client.request<unknown>("POST", "tools/test", {
    body: payload
  });

  if (options.autoFollow === true && !shouldSkipWait(parsed)) {
    return followSubmittedWork(context, client, capability, response, parsed);
  }

  return {
    message: successMessage ?? (capability === "usage.read" ? "Read usage and limits from hosted Vibecodr." : `Submitted ${capability} test to hosted Vibecodr.`),
    data: response
  };
}

function shouldSkipWait(parsed: ParsedCommandOptions): boolean {
  return getBooleanFlag(parsed.flags, "noWait") || parsed.flags.wait === false;
}

async function followSubmittedWork(
  context: CommandContext,
  client: ApiClient,
  capability: CapabilityName,
  submitted: unknown,
  parsed: ParsedCommandOptions
): Promise<CommandResult> {
  const jobId = jobIdFromWork(submitted);
  if (!jobId) {
    return {
      message: completedCapabilityMessage(capability),
      data: publicWorkResult(capability, submitted, parsed),
      humanData: getBooleanFlag(parsed.flags, "details") ? "show" : "hide"
    };
  }

  const terminal = isTerminalWork(submitted)
    ? submitted
    : await pollWorkUntilTerminal(client, jobId, parsed);
  const artifactId = artifactIdFromWork(terminal);
  const proof = artifactId && shouldSaveArtifact(parsed)
    ? await saveArtifact(context, client, artifactId, parsedWithLocalOutput(parsed))
    : undefined;

  return {
    message: formatCompletedWorkMessage(capability, terminal, proof),
    data: publicWorkResult(capability, terminal, parsed, proof),
    humanData: getBooleanFlag(parsed.flags, "details") ? "show" : "hide"
  };
}

async function commandWorkFollow(context: CommandContext, parsed: ParsedCommandOptions): Promise<CommandResult> {
  const jobId = validateEntityId(requiredPositional(parsed, 0, "work follow requires a job id."), "job id");
  const { profile } = await context.store.getProfile(context.globals.profile);
  const client = createClient(context, profile, await resolveToken(context, true));
  const job = await pollWorkUntilTerminal(client, jobId, parsed);
  const artifactId = artifactIdFromWork(job);
  const proof = artifactId && shouldSaveArtifact(parsed)
    ? await saveArtifact(context, client, artifactId, parsedWithLocalOutput(parsed))
    : undefined;
  return {
    message: formatCompletedWorkMessage(undefined, job, proof),
    data: publicWorkResult(undefined, job, parsed, proof),
    humanData: getBooleanFlag(parsed.flags, "details") ? "show" : "hide"
  };
}

async function pollWorkUntilTerminal(client: ApiClient, jobId: string, parsed: ParsedCommandOptions): Promise<unknown> {
  const timeoutMs = validatePositiveInt(getStringFlag(parsed.flags, "waitTimeoutMs") ?? getStringFlag(parsed.flags, "timeoutMs") ?? "180000", "--wait-timeout-ms", 1000, 3_600_000) ?? 180_000;
  const pollIntervalMs = validatePositiveInt(getStringFlag(parsed.flags, "pollIntervalMs") ?? "250", "--poll-interval-ms", 100, 30_000) ?? 250;
  const deadline = Date.now() + timeoutMs;
  let latest: unknown = await client.request<unknown>("GET", `jobs/${encodePathSegment(jobId)}`);
  while (!isTerminalWork(latest)) {
    if (Date.now() >= deadline) {
      return latest;
    }
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    latest = await client.request<unknown>("GET", `jobs/${encodePathSegment(jobId)}`);
  }
  return latest;
}

function isTerminalWork(value: unknown): boolean {
  const status = workStatus(value);
  return status === "completed" || status === "failed" || status === "cancelled" || status === "canceled";
}

function jobIdFromWork(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return typeof value.id === "string"
    ? value.id
    : typeof value.jobId === "string"
      ? value.jobId
      : undefined;
}

function workStatus(value: unknown): string | undefined {
  return isRecord(value) && typeof value.status === "string" ? value.status : undefined;
}

function artifactIdFromWork(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.artifactId === "string") {
    return value.artifactId;
  }
  if (isRecord(value.result) && typeof value.result.artifactId === "string") {
    return value.result.artifactId;
  }
  if (Array.isArray(value.artifacts)) {
    const first = value.artifacts.find((item) => isRecord(item) && typeof item.id === "string");
    return isRecord(first) && typeof first.id === "string" ? first.id : undefined;
  }
  return undefined;
}

interface WorkArtifactSummary {
  id: string;
  kind?: string;
  contentType?: string;
  bytes?: number;
}

function workArtifactSummary(value: unknown): WorkArtifactSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const source = isRecord(value.result) && typeof value.result.artifactId === "string"
    ? value.result
    : typeof value.artifactId === "string"
      ? value
      : undefined;
  if (source) {
    return {
      id: String(source.artifactId),
      ...(typeof source.kind === "string" ? { kind: source.kind } : {}),
      ...(typeof source.contentType === "string" ? { contentType: source.contentType } : {}),
      ...(typeof source.bytes === "number" ? { bytes: source.bytes } : {})
    };
  }
  if (Array.isArray(value.artifacts)) {
    const first = value.artifacts.find((item) => isRecord(item) && typeof item.id === "string");
    if (isRecord(first) && typeof first.id === "string") {
      return {
        id: first.id,
        ...(typeof first.kind === "string" ? { kind: first.kind } : {}),
        ...(typeof first.contentType === "string" ? { contentType: first.contentType } : {}),
        ...(typeof first.bytes === "number" ? { bytes: first.bytes } : {})
      };
    }
  }
  return undefined;
}

function shouldSaveArtifact(parsed: ParsedCommandOptions): boolean {
  return getStringFlag(parsed.flags, "out") !== undefined || getBooleanFlag(parsed.flags, "local");
}

function parsedWithLocalOutput(parsed: ParsedCommandOptions): ParsedCommandOptions {
  if (getStringFlag(parsed.flags, "out") !== undefined || !getBooleanFlag(parsed.flags, "local")) {
    return parsed;
  }
  return {
    ...parsed,
    flags: {
      ...parsed.flags,
      out: DEFAULT_LOCAL_PROOF_DIR
    }
  };
}

function formatCompletedWorkMessage(capability: CapabilityName | undefined, work: unknown, proof?: SavedArtifact): string {
  const status = workStatus(work) ?? "completed";
  if (status === "completed") {
    if (proof) {
      return `${completedCapabilityMessage(capability)}\nSaved output: ${proof.path}`;
    }
    const artifact = workArtifactSummary(work);
    if (artifact) {
      const details = [artifact.kind, formatByteCount(artifact.bytes)].filter(Boolean).join(", ");
      return [
        completedCapabilityMessage(capability),
        `Output ready${details ? `: ${details}` : "."}`,
        `View it: vibecodr proof show ${artifact.id}`,
        `Save it: vibecodr proof save ${artifact.id} --out ./${DEFAULT_LOCAL_PROOF_DIR}`,
        `Next time: add --local to save it automatically.`
      ].join("\n");
    }
    return completedCapabilityMessage(capability);
  }
  if (status === "queued" || status === "running") {
    const id = jobIdFromWork(work);
    const follow = id ? `\nFollow it: vibecodr work follow ${id}` : "";
    return `Work accepted and still ${status}.${follow}`;
  }
  const error = isRecord(work) && isRecord(work.error) && typeof work.error.message === "string"
    ? `: ${work.error.message}`
    : "";
  return `Hosted work ${status}${error}`;
}

function completedCapabilityMessage(capability: CapabilityName | undefined): string {
  switch (capability) {
    case "browser.screenshot_url":
      return "Browser screenshot completed.";
    case "browser.extract_markdown":
      return "Browser read completed.";
    case "browser.render_pdf":
      return "Browser PDF completed.";
    case "browser.render_url":
      return "Browser render completed.";
    case "browser.crawl_site":
      return "Browser crawl completed.";
    case "browser.agent_task":
      return "Browser snapshot completed.";
    case "sandbox.run_command":
      return "Agent Computer run completed.";
    case "sandbox.run_tests":
      return "Agent Computer tests completed.";
    default:
      return "Hosted work completed.";
  }
}

interface SavedArtifact {
  artifactId: string;
  path: string;
  bytes: number;
  contentType: string;
}

function formatByteCount(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes)) {
    return undefined;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${Math.round(kib * 10) / 10} KB`;
  }
  const mib = kib / 1024;
  return `${Math.round(mib * 10) / 10} MB`;
}

function publicWorkResult(capability: CapabilityName | undefined, work: unknown, parsed: ParsedCommandOptions, proof?: SavedArtifact): Record<string, unknown> {
  const details = getBooleanFlag(parsed.flags, "details");
  const artifact = workArtifactSummary(work);
  const result: Record<string, unknown> = {
    status: workStatus(work) ?? "completed"
  };
  if (capability) {
    result.tool = userToolName(capability);
  }
  if (artifact) {
    result.artifact = {
      id: artifact.id,
      ...(artifact.kind ? { kind: artifact.kind } : {}),
      ...(artifact.contentType ? { contentType: artifact.contentType } : {}),
      ...(artifact.bytes !== undefined ? { bytes: artifact.bytes } : {}),
      showCommand: `vibecodr proof show ${artifact.id}`,
      saveCommand: `vibecodr proof save ${artifact.id} --out ./${DEFAULT_LOCAL_PROOF_DIR}`
    };
  }
  if (proof) {
    result.proof = {
      artifactId: proof.artifactId,
      path: proof.path,
      bytes: proof.bytes,
      contentType: proof.contentType
    };
  }
  if (details) {
    result.work = work;
  }
  return result;
}

function userToolName(capability: CapabilityName): string {
  if (capability === "browser.screenshot_url") return "browser.screenshot";
  if (capability === "browser.extract_markdown") return "browser.read";
  if (capability === "browser.render_pdf") return "browser.pdf";
  if (capability === "browser.render_url") return "browser.render";
  if (capability === "browser.crawl_site") return "browser.crawl";
  if (capability === "browser.agent_task") return "browser.snapshot";
  if (capability === "sandbox.run_command") return "computer.run";
  if (capability === "sandbox.run_tests") return "computer.test";
  return capability;
}

function normalizeBrowserSnapshotOptions(parsed: ParsedCommandOptions): ParsedCommandOptions {
  const [url, ...extraParts] = parsed.positionals;
  if (extraParts.length > 0 || parsed.flags.instructions !== undefined || parsed.flags.note !== undefined) {
    throw new CliError(
      "input.snapshot_is_not_prompted",
      "browser snapshot captures the page state; it does not prompt an agent or model. Remove the note/instructions, or use `vibecodr browser notes <url> --note \"...\"` to save a note with the snapshot.",
      2
    );
  }
  return {
    positionals: url === undefined ? [] : [url],
    flags: parsed.flags
  };
}

function normalizeBrowserNotesOptions(parsed: ParsedCommandOptions): ParsedCommandOptions {
  const [url, ...instructionParts] = parsed.positionals;
  const flags = { ...parsed.flags };
  const note = getStringFlag(flags, "note");
  const instructions = getStringFlag(flags, "instructions");
  if (instructions === undefined && note !== undefined) {
    flags.instructions = note;
  }
  delete flags.note;
  if (getStringFlag(flags, "instructions") === undefined && instructionParts.length > 0) {
    flags.instructions = instructionParts.join(" ");
  }
  if (getStringFlag(flags, "instructions") === undefined) {
    throw new CliError(
      "input.notes_note_required",
      "browser notes needs a note. For a normal capture, use `vibecodr browser snapshot <url> --local`.",
      2
    );
  }
  return {
    positionals: url === undefined ? [] : [url],
    flags
  };
}

function normalizeComputerCommandOptions(parsed: ParsedCommandOptions, missingMessage: string): ParsedCommandOptions {
  const command = getStringFlag(parsed.flags, "command") ?? parsed.positionals.join(" ").trim();
  if (!command) {
    throw new CliError("input.command_required", missingMessage, 2);
  }
  return {
    positionals: [],
    flags: {
      ...parsed.flags,
      command
    }
  };
}

async function commandJobs(context: CommandContext, subcommand: string | undefined, rest: string[]): Promise<CommandResult> {
  const parsed = parseCommandOptions(rest);
  const { profile } = await context.store.getProfile(context.globals.profile);
  const client = createClient(context, profile, await resolveToken(context, true));

  switch (subcommand) {
    case "list": {
      const limit = validatePositiveInt(getStringFlag(parsed.flags, "limit") ?? "20", "--limit", 1, 100) ?? 20;
      const jobs = await client.request<unknown>("GET", "jobs", {
        query: { limit }
      });
      return { message: "Fetched recent hosted work.", data: jobs };
    }
    case "status": {
      const jobId = validateEntityId(requiredPositional(parsed, 0, "jobs status requires a job id."), "job id");
      const job = await client.request<unknown>("GET", `jobs/${encodePathSegment(jobId)}`);
      return { message: formatJobStatusMessage(job, jobId), data: job };
    }
    case "cancel": {
      const jobId = validateEntityId(requiredPositional(parsed, 0, "jobs cancel requires a job id."), "job id");
      if (!getBooleanFlag(parsed.flags, "yes")) {
        throw new CliError("confirm.required", "Canceling a job mutates hosted state. Re-run with --yes to confirm.", 4);
      }
      const job = await client.request<unknown>("POST", `jobs/${encodePathSegment(jobId)}/cancel`);
      return { message: `Canceled job ${jobId}.`, data: job };
    }
    default:
      throw unknownSubcommandError("jobs", subcommand, ["list", "status", "cancel"], "Use vibecodr jobs list, jobs status <jobId>, or jobs cancel <jobId> --yes.");
  }
}

async function commandArtifacts(context: CommandContext, subcommand: string | undefined, rest: string[]): Promise<CommandResult> {
  const parsed = parseCommandOptions(rest);
  const { profile } = await context.store.getProfile(context.globals.profile);
  const client = createClient(context, profile, await resolveToken(context, true));

  switch (subcommand) {
    case "list": {
      const limit = validatePositiveInt(getStringFlag(parsed.flags, "limit") ?? "20", "--limit", 1, 100) ?? 20;
      const artifacts = await client.request<unknown>("GET", "artifacts", {
        query: { limit }
      });
      return { message: "Fetched artifacts.", data: artifacts };
    }
    case "get": {
      const artifactId = validateEntityId(requiredPositional(parsed, 0, "artifacts get requires an artifact id."), "artifact id");
      const artifact = await client.request<unknown>("GET", `artifacts/${encodePathSegment(artifactId)}`);
      return { message: `Fetched artifact ${artifactId}.`, data: artifact };
    }
    case "pull":
      return commandArtifactsPull(context, client, parsed);
    case "create":
      return commandArtifactsCreate(context, client, parsed);
    case "delete": {
      const artifactId = validateEntityId(requiredPositional(parsed, 0, "artifacts delete requires an artifact id."), "artifact id");
      if (!getBooleanFlag(parsed.flags, "yes")) {
        throw new CliError("confirm.required", "Deleting an artifact removes hosted shelf metadata and bytes. Re-run with --yes to confirm.", 4);
      }
      const artifact = await client.request<unknown>("DELETE", `artifacts/${encodePathSegment(artifactId)}`);
      return { message: `Deleted artifact ${artifactId}.`, data: artifact };
    }
    default:
      throw unknownSubcommandError("artifacts", subcommand, ["list", "get", "pull", "create", "delete"], "Use vibecodr artifacts list, get, pull, create, or delete.");
  }
}

async function commandArtifactsPull(context: CommandContext, client: ApiClient, parsed: ParsedCommandOptions): Promise<CommandResult> {
  const artifactId = validateEntityId(requiredPositional(parsed, 0, "artifacts pull requires an artifact id."), "artifact id");
  const saved = await saveArtifact(context, client, artifactId, parsed);
  return {
    message: `Pulled artifact ${artifactId} to ${saved.path}.`,
    data: saved
  };
}

async function saveArtifact(context: CommandContext, client: ApiClient, artifactId: string, parsed: ParsedCommandOptions): Promise<SavedArtifact> {
  const out = getStringFlag(parsed.flags, "out") ?? ".";
  const outPath = path.resolve(context.cwd, out);
  await ensureOutputPathAllowed(context.cwd, outPath);
  const output = await resolveArtifactOutput(outPath);
  const requestedFilename = getStringFlag(parsed.flags, "filename");

  let download: Awaited<ReturnType<ApiClient["download"]>>;
  let target: string;
  if (output.kind === "file") {
    target = output.target;
    await assertArtifactTargetWritable(context.cwd, target, parsed);
    download = await client.download(`artifacts/${encodePathSegment(artifactId)}/download`);
  } else if (requestedFilename) {
    target = path.join(output.directory, sanitizeFilename(requestedFilename, `${artifactId}.bin`));
    await assertArtifactTargetWritable(context.cwd, target, parsed);
    download = await client.download(`artifacts/${encodePathSegment(artifactId)}/download`);
  } else {
    download = await client.download(`artifacts/${encodePathSegment(artifactId)}/download`);
    const filename = sanitizeFilename(download.filename, `${artifactId}.bin`);
    target = path.join(output.directory, filename);
    await assertArtifactTargetWritable(context.cwd, target, parsed);
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await ensureOutputPathAllowed(context.cwd, target);
  await fs.writeFile(target, download.bytes);
  return {
    artifactId,
    path: target,
    bytes: download.bytes.byteLength,
    contentType: download.contentType
  };
}

async function assertArtifactTargetWritable(cwd: string, target: string, parsed: ParsedCommandOptions): Promise<void> {
  await ensureOutputPathAllowed(cwd, target);
  if (await pathExists(target) && !getBooleanFlag(parsed.flags, "overwrite")) {
    throw new CliError("file.exists", `Refusing to overwrite ${target}. Re-run with --overwrite.`, 5);
  }
}

type ArtifactOutput =
  | { kind: "directory"; directory: string }
  | { kind: "file"; target: string };

async function resolveArtifactOutput(outPath: string): Promise<ArtifactOutput> {
  const stat = await fs.stat(outPath).catch(() => undefined);
  if (stat?.isFile()) {
    return { kind: "file", target: outPath };
  }
  if (stat?.isDirectory()) {
    return { kind: "directory", directory: outPath };
  }
  if (path.extname(outPath)) {
    return { kind: "file", target: outPath };
  }
  return { kind: "directory", directory: outPath };
}

async function commandArtifactsCreate(context: CommandContext, client: ApiClient, parsed: ParsedCommandOptions): Promise<CommandResult> {
  const fileInput = getStringFlag(parsed.flags, "file") ?? parsed.positionals[0];
  if (!fileInput) {
    throw new CliError("input.file_required", "artifacts create requires --file <path>.", 2);
  }
  if (!getBooleanFlag(parsed.flags, "yes")) {
    throw new CliError("confirm.required", "Creating an artifact uploads a local file. Re-run with --yes to confirm.", 4);
  }

  const filePath = path.resolve(context.cwd, fileInput);
  await ensureInputPathAllowed(context.cwd, filePath);
  const stat = await fs.stat(filePath).catch(() => undefined);
  if (!stat?.isFile()) {
    throw new CliError("file.not_found", `Artifact file does not exist: ${filePath}`, 5);
  }

  const kind = getStringFlag(parsed.flags, "kind") ?? "file";
  const bytes = await fs.readFile(filePath);
  const form = new FormData();
  form.set("file", new Blob([bytes]), path.basename(filePath));
  form.set("kind", kind);
  const result = await client.upload("artifacts", form);
  return { message: `Uploaded artifact ${path.basename(filePath)}.`, data: result };
}

async function commandUsage(context: CommandContext, parsed: ParsedCommandOptions): Promise<CommandResult> {
  const surface = outputSurface(parsed);
  const { profile } = await context.store.getProfile(context.globals.profile);
  const client = createClient(context, profile, await resolveToken(context, true));
  const usage = await client.request<unknown>("GET", "usage", { query: queryForSurface(surface) });
  const data = surface.details || surface.operator ? usage : publicUsagePayload(usage);
  return {
    message: formatUsageSummary(data),
    data,
    humanData: surface.details || surface.operator ? "show" : "hide"
  };
}

async function commandGrants(context: CommandContext, subcommand: string | undefined, rest: string[]): Promise<CommandResult> {
  const selectedSubcommand = subcommand ?? "list";
  if (selectedSubcommand !== "list") {
    throw unknownSubcommandError("grants", subcommand, ["list"], "vibecodr grants lists effective grants by default. Use vibecodr grants list [--project <id>] [--user <id>] for explicit filters.");
  }
  const parsed = parseCommandOptions(rest);
  const { profile } = await context.store.getProfile(context.globals.profile);
  const client = createClient(context, profile, await resolveToken(context, true));
  const grants = await client.request<unknown>("GET", "grants", {
    query: {
      project: getStringFlag(parsed.flags, "project"),
      user: getStringFlag(parsed.flags, "user")
    }
  });
  return { message: formatGrantsSummary(grants), data: grants };
}

async function commandRetention(context: CommandContext, subcommand: string | undefined, rest: string[]): Promise<CommandResult> {
  const parsed = parseCommandOptions(rest);
  const { profile } = await context.store.getProfile(context.globals.profile);
  const client = createClient(context, profile, await resolveToken(context, true));

  switch (subcommand) {
    case "show": {
      const retention = await client.request<unknown>("GET", "retention");
      return { message: "Fetched retention policy.", data: retention };
    }
    case "set": {
      if (!getBooleanFlag(parsed.flags, "yes")) {
        throw new CliError("confirm.required", "Updating retention mutates hosted policy. Re-run with --yes to confirm.", 4);
      }
      const logsDays = validatePositiveInt(getStringFlag(parsed.flags, "logsDays"), "--logs-days", 1, 365);
      const artifactsDays = validatePositiveInt(getStringFlag(parsed.flags, "artifactsDays"), "--artifacts-days", 1, 365);
      const recordings = getStringFlag(parsed.flags, "recordings");
      if (recordings !== undefined && !["off", "opt-in", "admin"].includes(recordings)) {
        throw new CliError("input.invalid_recordings", "--recordings must be off, opt-in, or admin.", 2);
      }
      if (logsDays === undefined && artifactsDays === undefined && recordings === undefined) {
        throw new CliError("input.empty_retention_update", "Provide at least one retention field to update.", 2);
      }
      const retention = await client.request<unknown>("PATCH", "retention", {
        body: { logsDays, artifactsDays, recordings }
      });
      return { message: "Updated retention policy.", data: retention };
    }
    default:
      throw unknownSubcommandError("retention", subcommand, ["show", "set"], "Use vibecodr retention show or retention set.");
  }
}

async function commandScheduledQa(context: CommandContext, subcommand: string | undefined, rest: string[]): Promise<CommandResult> {
  const parsed = parseCommandOptions(rest);
  const { profile } = await context.store.getProfile(context.globals.profile);
  const client = createClient(context, profile, await resolveToken(context, true));

  switch (subcommand) {
    case "list": {
      const scheduled = await client.request<unknown>("GET", "scheduled-qa");
      return { message: "Fetched scheduled QA checks.", data: scheduled };
    }
    case "create": {
      const target = requiredPositional(parsed, 0, "scheduled-qa create requires an HTTPS URL target.");
      if (!getBooleanFlag(parsed.flags, "yes")) {
        throw new CliError("confirm.required", "Creating scheduled QA mutates hosted state and may spend future Browser Run quota. Re-run with --yes to confirm.", 4);
      }
      const body = buildScheduledQaPayload(target, parsed, context.globals.timeoutMs === 30_000 ? undefined : context.globals.timeoutMs);
      const created = await client.request<unknown>("POST", "scheduled-qa", { body });
      return { message: "Created scheduled QA check.", data: created };
    }
    case "pause":
    case "resume": {
      const id = validateEntityId(requiredPositional(parsed, 0, `scheduled-qa ${subcommand} requires a scheduled QA id.`), "scheduled QA id");
      if (!getBooleanFlag(parsed.flags, "yes")) {
        throw new CliError("confirm.required", `Updating scheduled QA mutates hosted state. Re-run with --yes to confirm.`, 4);
      }
      const updated = await client.request<unknown>("PATCH", `scheduled-qa/${encodePathSegment(id)}`, {
        body: { enabled: subcommand === "resume", runNow: subcommand === "resume" && getBooleanFlag(parsed.flags, "runNow") }
      });
      return { message: `${subcommand === "resume" ? "Resumed" : "Paused"} scheduled QA check ${id}.`, data: updated };
    }
    case "delete": {
      const id = validateEntityId(requiredPositional(parsed, 0, "scheduled-qa delete requires a scheduled QA id."), "scheduled QA id");
      if (!getBooleanFlag(parsed.flags, "yes")) {
        throw new CliError("confirm.required", "Deleting scheduled QA mutates hosted state. Re-run with --yes to confirm.", 4);
      }
      const deleted = await client.request<unknown>("DELETE", `scheduled-qa/${encodePathSegment(id)}`);
      return { message: `Deleted scheduled QA check ${id}.`, data: deleted };
    }
    default:
      throw unknownSubcommandError("scheduled-qa", subcommand, ["list", "create", "pause", "resume", "delete"], "Use vibecodr scheduled-qa list, create <url>, pause <id>, resume <id>, or delete <id>.");
  }
}

async function commandPlans(context: CommandContext, parsed: ParsedCommandOptions): Promise<CommandResult> {
  const surface = outputSurface(parsed);
  const { profile } = await getOptionalProfile(context);
  const token = await resolveToken(context, false);
  const warnings: string[] = [];

  if (token) {
    try {
      const client = createClient(context, profile, token);
      const plans = await client.request<unknown>("GET", "plans", { query: queryForSurface(surface) });
      const data = surface.details || surface.operator ? plans : publicPlansPayload(plans);
      return {
        message: formatPlansSummary(data),
        data,
        humanData: surface.details || surface.operator ? "show" : "hide"
      };
    } catch (error) {
      warnings.push(`Using local fallback plans because hosted plans failed: ${toCliError(error).message}`);
    }
  }

  warnings.push("Local fallback plan packaging is informational; it cannot change hosted entitlement, quota, billing, or enforcement.");
  const localPlans = {
    plans: DEFAULT_PLANS,
    authority: localPlanPackagingAuthority(),
    ...(surface.operator ? { overageMeters: OVERAGE_METERS, offeringClassifications: PUBLIC_OFFERING_CLASSIFICATIONS, policies: LAUNCH_POLICIES } : {})
  };
  const data = surface.details || surface.operator ? localPlans : publicPlansPayload(localPlans);
  return {
    message: formatPlansSummary(data),
    warnings,
    data,
    humanData: surface.details || surface.operator ? "show" : "hide"
  };
}

async function commandDoctor(context: CommandContext, parsed: ParsedCommandOptions): Promise<CommandResult> {
  const surface = outputSurface(parsed);
  const local = await context.store.inspect();
  const { profile } = await getOptionalProfile(context);
  const token = await resolveToken(context, false);
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [
    { name: "node", ok: nodeMajor() >= 22 && nodeMajor() < 26, detail: process.version },
    { name: "config", ok: true, detail: local.dir },
    { name: "approval", ok: Boolean(token), detail: token ? "saved for this OS user or provided by automation" : "missing; run vibecodr start" },
    {
      name: "apiUrl",
      ok: profile.apiUrl.startsWith("https://") || (profile.apiUrl.startsWith("http://localhost") && allowInsecureLocalApi(context)),
      detail: profile.apiUrl
    },
    { name: "agentComputer", ok: true, detail: "hosted Browser, Computer, Work, Proof, and Usage tools" }
  ];

  try {
    const health = await createClient(context, profile, token).request<ApiHealth>("GET", "health", { auth: false, query: queryForSurface(surface) });
    checks.push({ name: "hostedApi", ok: health.ok !== false, detail: health.service ?? "reachable" });
  } catch (error) {
    checks.push({ name: "hostedApi", ok: false, detail: toCliError(error).message });
  }

  return {
    message: checks.every((check) => check.ok)
      ? "Agent Computer checks passed. Your agent can use the hosted Vibecodr computer."
      : "Agent Computer needs attention. Run vibecodr start to approve access, then retry the agent.",
    data: {
      checks,
      ...(surface.details || surface.operator ? { config: { dir: local.dir, credentialStore: local.credentialStore } } : {}),
      nextActions: checks.every((check) => check.ok)
        ? ["Connect the agent with vibecodr agent connect.", "Use --json when an agent needs stable machine-readable output."]
        : ["Run vibecodr start.", "If this is CI or an isolated agent, use an advanced file/stdin credential source."]
    },
    humanData: surface.details || surface.operator ? "show" : "hide"
  };
}

interface OutputSurface {
  details: boolean;
  operator: boolean;
}

function outputSurface(parsed: ParsedCommandOptions): OutputSurface {
  return {
    details: getBooleanFlag(parsed.flags, "details"),
    operator: getBooleanFlag(parsed.flags, "operator")
  };
}

function queryForSurface(surface: OutputSurface): Record<string, boolean | undefined> {
  return {
    details: surface.details || undefined,
    operator: surface.operator || undefined
  };
}

function publicStartPayload(
  me: MeResponse,
  health: ApiHealth,
  connection: Record<string, unknown>,
  usage: unknown,
  loginStarted: boolean
): Record<string, unknown> {
  return {
    ready: health.ok !== false,
    loginStarted,
    account: {
      label: formatAccountLabel(me),
      workspace: me.workspace?.name ?? me.workspace?.id,
      plan: me.plan?.name ?? "unknown"
    },
    connection: publicConnectionPayload(connection),
    health: publicHealthPayload(health),
    usage: publicUsagePayload(usage),
    nextActions: [
      "Connect your agent with vibecodr agent connect --client codex.",
      "Run vibecodr try to prove browser, computer, and proof are working."
    ]
  };
}

function publicConnectionPayload(connection: Record<string, unknown>): Record<string, unknown> {
  const tools = Array.isArray(connection.tools)
    ? connection.tools
        .filter(isRecord)
        .map((tool) => typeof tool.name === "string" ? tool.name : undefined)
        .filter((name): name is string => name !== undefined)
    : undefined;
  return {
    transport: typeof connection.transport === "string" ? connection.transport : "streamable_http",
    url: typeof connection.url === "string" ? connection.url : undefined,
    protocolVersion: typeof connection.protocolVersion === "string" ? connection.protocolVersion : undefined,
    tools
  };
}

function publicHealthPayload(health: ApiHealth): Record<string, unknown> {
  const record: Record<string, unknown> = isRecord(health) ? health : {};
  const live = isRecord(record.live) ? record.live : {};
  return {
    ok: health.ok !== false,
    service: typeof health.service === "string" ? health.service : undefined,
    version: typeof record.version === "string" ? record.version : undefined,
    requestId: typeof record.requestId === "string" ? record.requestId : undefined,
    network: publicNetworkPayload(live)
  };
}

function publicNetworkPayload(live: Record<string, unknown>): Record<string, string> {
  const network = isRecord(live.network) ? live.network : {};
  return {
    browserPublicHttps: typeof network.browserPublicHttps === "string" ? network.browserPublicHttps : "available",
    computerPublicHttps: typeof network.computerPublicHttps === "string" ? network.computerPublicHttps : "available",
    privateLocalNetworks: typeof network.privateLocalNetworks === "string" ? network.privateLocalNetworks : "blocked",
    metadataServices: typeof network.metadataServices === "string" ? network.metadataServices : "blocked",
    rawNetwork: typeof network.rawNetwork === "string" ? network.rawNetwork : "restricted"
  };
}

function publicUsagePayload(usage: unknown): Record<string, unknown> {
  const data = isRecord(usage) ? usage : {};
  return {
    plan: typeof data.plan === "string" ? data.plan : "unknown",
    monthlyCredits: quotaValue(data.vcToolCredits),
    dailyCredits: quotaValue(data.dailyVcToolCredits),
    runningNow: quotaValue(data.concurrentRuns),
    browserWork: quotaValue(data.browserJobs),
    computerWork: quotaValue(data.sandboxJobs),
    proofStorage: quotaValue(data.artifactStorageGb, "GB")
  };
}

function publicPlansPayload(plans: unknown): Record<string, unknown> {
  const data = isRecord(plans) ? plans : {};
  const rows = Array.isArray(data.plans) ? data.plans.filter(isRecord) : [];
  return {
    plans: rows.map(publicPlanPayload),
    note: "Plan packaging is public product information. Use vibecodr usage for your actual account capacity."
  };
}

function publicPlanPayload(plan: Record<string, unknown>): Record<string, unknown> {
  const limits = isRecord(plan.limits) ? plan.limits : {};
  const browser = isRecord(plan.browser) ? plan.browser : isRecord(limits.browser) ? limits.browser : {};
  const sandbox = isRecord(plan.computer) ? plan.computer : isRecord(limits.sandbox) ? limits.sandbox : {};
  const monthlyCredits = numberValue(plan.monthlyCredits) ?? numberValue(limits.monthlyCredits);
  const dailyCredits = numberValue(plan.dailyCredits) ?? numberValue(limits.dailyCredits);
  const runningLimit = numberValue(plan.runningLimit) ?? numberValue(limits.maxConcurrentRuns);
  const browserMonthlyJobs = numberValue(browser.monthlyJobs) ?? numberValue(limits.browserRenderJobsMonthly);
  const browserMaxSeconds = numberValue(browser.maxSecondsPerRun) ?? numberValue(browser.maxBrowserSecondsPerRun);
  const agentBrowserMaxSeconds = numberValue(browser.agentBrowserMaxSeconds) ?? numberValue(browser.maxBrowserSessionSeconds);
  const computerMonthlyJobs = numberValue(sandbox.monthlyJobs) ?? numberValue(limits.sandboxJobsMonthly);
  const computerMaxSeconds = numberValue(sandbox.maxTaskSeconds) ?? numberValue(sandbox.maxSandboxTaskSeconds);
  return {
    name: typeof plan.name === "string" ? plan.name : "Unknown",
    priceUsdMonthly: numberValue(plan.priceUsdMonthly),
    monthlyCredits,
    dailyCredits,
    runningLimit,
    browser: {
      monthlyJobs: browserMonthlyJobs,
      maxSecondsPerRun: browserMaxSeconds,
      agentBrowserTasks: typeof browser.agentBrowserTasks === "string" ? browser.agentBrowserTasks : browser.allowBrowserSessions === true ? "included" : "not included",
      ...(agentBrowserMaxSeconds !== undefined ? { agentBrowserMaxSeconds } : {})
    },
    computer: {
      monthlyJobs: computerMonthlyJobs,
      maxTaskSeconds: computerMaxSeconds,
      publicHttpEgress: typeof sandbox.publicHttpEgress === "string" ? sandbox.publicHttpEgress : computerMonthlyJobs !== undefined && computerMonthlyJobs > 0 ? "available" : "not included"
    },
    proofStorageGb: numberValue(plan.proofStorageGb) ?? numberValue(limits.artifactStorageGb)
  };
}

function quotaValue(value: unknown, unit?: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const used = numberValue(value.used);
  const included = numberValue(value.included);
  if (used === undefined && included === undefined) {
    return undefined;
  }
  return {
    ...(used !== undefined ? { used } : {}),
    ...(included !== undefined ? { included } : {}),
    ...(unit !== undefined ? { unit } : {})
  };
}

function formatUsageSummary(usage: unknown): string {
  const data = isRecord(usage) ? usage : {};
  const plan = typeof data.plan === "string" ? data.plan : "unknown";
  const lines = [
    "Agent Computer capacity",
    `Plan: ${plan}`,
    "",
    "Limit                         Used / Included        Progress"
  ];

  for (const row of usageRows(data)) {
    const used = row.used ?? 0;
    const included = row.included ?? 0;
    const percent = quotaPercent(used, included);
    const amount = `${formatUsageNumber(used)} / ${formatUsageNumber(included)}${row.unit ? ` ${row.unit}` : ""}`;
    lines.push(`${row.label.padEnd(29)} ${amount.padEnd(22)} ${usageBar(percent)} ${percent}%`);
  }

  const hardCap = typeof data.hardCap === "boolean" ? data.hardCap : undefined;
  if (hardCap !== undefined) {
    lines.push("", `Spend cap: ${hardCap ? "hard" : "soft"}`);
  }
  lines.push("Alias: vibecodr limits");
  return lines.join("\n");
}

function formatWhoamiSummary(me: MeResponse): string {
  const user = formatAccountLabel(me);
  const workspace = me.workspace?.name ?? me.workspace?.id ?? "none returned";
  const plan = me.plan?.name ?? "unknown";
  return [
    "Vibecodr Agent Computer",
    `Account: ${user}`,
    `Workspace: ${workspace}`,
    `Plan: ${plan}`,
    "Agent access: ready"
  ].join("\n");
}

function formatGrantsSummary(grants: unknown): string {
  const data = isRecord(grants) ? grants : {};
  const rows = Array.isArray(data.grants) ? data.grants.filter(isRecord) : [];
  const granted = rows.filter((row) => row.granted === true).length;
  const providerMode = typeof data.providerMode === "string" ? ` (${data.providerMode})` : "";
  if (rows.length === 0) {
    return `vibecodr grants${providerMode}\nNo tool grants were returned. The full hosted response follows.`;
  }
  return [
    `vibecodr grants${providerMode}`,
    `${granted}/${rows.length} tool grants are enabled for the active account/plan.`,
    "The full hosted grant payload follows."
  ].join("\n");
}

function formatPlansSummary(plans: unknown): string {
  const data = isRecord(plans) ? plans : {};
  const rows = Array.isArray(data.plans) ? data.plans.filter(isRecord) : [];
  if (rows.length === 0) {
    return [
      "Vibecodr Agent Computer plans",
      "No plan packaging was returned.",
      "Run vibecodr usage for your actual account capacity."
    ].join("\n");
  }

  const lines: string[] = ["Vibecodr Agent Computer plans", ""];
  for (const row of rows) {
    lines.push(...formatPlanBullets(row));
    lines.push("");
  }
  lines.push("Run vibecodr usage for your actual account capacity.");
  lines.push("Run vibecodr plans --details for the full entitlement schema.");
  return lines.join("\n").replace(/\n+$/, "");
}

function formatPlanBullets(plan: Record<string, unknown>): string[] {
  const name = typeof plan.name === "string" ? plan.name : "Plan";
  const price = numberValue(plan.priceUsdMonthly);
  const header = price === undefined || price === 0
    ? name === "Free" ? "Free" : `${name} - free`
    : `${name} - $${price}/mo`;

  const browser = isRecord(plan.browser) ? plan.browser : {};
  const computer = isRecord(plan.computer) ? plan.computer : {};
  const monthlyCredits = numberValue(plan.monthlyCredits);
  const dailyCredits = numberValue(plan.dailyCredits);
  const runningLimit = numberValue(plan.runningLimit);
  const browserMonthlyJobs = numberValue(browser.monthlyJobs);
  const browserMaxSeconds = numberValue(browser.maxSecondsPerRun);
  const agentBrowserTasks = typeof browser.agentBrowserTasks === "string" ? browser.agentBrowserTasks : undefined;
  const agentBrowserMaxSeconds = numberValue(browser.agentBrowserMaxSeconds);
  const computerMonthlyJobs = numberValue(computer.monthlyJobs);
  const computerMaxTaskSeconds = numberValue(computer.maxTaskSeconds);
  const computerPublicEgress = typeof computer.publicHttpEgress === "string" ? computer.publicHttpEgress : undefined;
  const proofStorageGb = numberValue(plan.proofStorageGb);

  const bullets: string[] = [];
  bullets.push(planBrowserBullet(browserMonthlyJobs, browserMaxSeconds));
  bullets.push(planComputerBullet(computerMonthlyJobs, computerMaxTaskSeconds, computerPublicEgress));
  if (monthlyCredits !== undefined) {
    bullets.push(`${formatPlanCount(monthlyCredits)} monthly credits${dailyCredits !== undefined ? ` (${formatPlanCount(dailyCredits)} per day)` : ""}`);
  }
  if (runningLimit !== undefined) {
    bullets.push(`${formatPlanCount(runningLimit)} concurrent runs`);
  }
  bullets.push(planProofStorageBullet(proofStorageGb));
  bullets.push(planAgentBrowserBullet(agentBrowserTasks, agentBrowserMaxSeconds));

  return [header, ...bullets.filter((bullet): bullet is string => bullet.length > 0).map((bullet) => `  ${bullet}`)];
}

function planBrowserBullet(monthlyJobs: number | undefined, maxSeconds: number | undefined): string {
  if (monthlyJobs === undefined || monthlyJobs <= 0) {
    return "Public browser checks: limited";
  }
  const secondsHint = maxSeconds !== undefined && maxSeconds > 0 ? ` up to ${maxSeconds}s each` : "";
  return `Public browser checks${secondsHint}`;
}

function planComputerBullet(monthlyJobs: number | undefined, maxTaskSeconds: number | undefined, publicHttpEgress: string | undefined): string {
  if (monthlyJobs === undefined || monthlyJobs <= 0) {
    return "Hosted computer runs: not included";
  }
  const minutes = maxTaskSeconds !== undefined && maxTaskSeconds > 0 ? ` up to ${Math.round(maxTaskSeconds / 60)} min each` : "";
  const network = publicHttpEgress === "available" ? "; public HTTP(S) available" : "";
  return `Hosted computer runs${minutes}${network}`;
}

function planProofStorageBullet(proofStorageGb: number | undefined): string {
  if (proofStorageGb === undefined || proofStorageGb <= 0) {
    return "Saved proof storage: not included";
  }
  return `${proofStorageGb} GB proof storage`;
}

function planAgentBrowserBullet(agentBrowserTasks: string | undefined, maxSeconds: number | undefined): string {
  if (agentBrowserTasks === "included") {
    if (maxSeconds !== undefined && maxSeconds >= 3600) {
      return "Browser agent tasks up to 1 hour";
    }
    if (maxSeconds !== undefined && maxSeconds >= 60) {
      return `Browser agent tasks up to ${Math.round(maxSeconds / 60)} min`;
    }
    return "Browser agent tasks included";
  }
  return "";
}

function formatPlanCount(value: number): string {
  if (value >= 1000) {
    return value.toLocaleString("en-US");
  }
  return String(value);
}

function formatStartSummary(me: MeResponse, health: ApiHealth, connection: Record<string, unknown>, loggedInNow: boolean): string {
  const connectionUrl = typeof connection.url === "string" ? connection.url : "hosted MCP URL returned in the payload";
  const plan = me.plan?.name ?? "unknown";
  const healthLabel = health.ok === false ? "needs attention" : "reachable";
  return [
    "Vibecodr Agent Computer is ready.",
    loggedInNow ? "Approval: completed in this run" : "Approval: already saved",
    `Account: ${formatAccountLabel(me)}`,
    `Plan: ${plan}`,
    `Hosted service: ${healthLabel}`,
    `Agent connection: ${connectionUrl}`,
    "Next: connect the agent to this URL and let it use browser.*, computer.*, work.*, proof.*, and usage.status."
  ].join("\n");
}

function formatAgentConnectionSummary(
  clientName: string,
  connection: Record<string, unknown>,
  serverName = "vc-tools",
  installResult?: InstallResult | undefined
): string {
  const url = typeof connection.url === "string" ? connection.url : "hosted MCP URL returned in the payload";
  const tools = Array.isArray(connection.tools) ? connection.tools.filter((tool): tool is string => typeof tool === "string") : [];
  const toolLine = tools.length > 0
    ? `Tools: ${tools.slice(0, 8).join(", ")}${tools.length > 8 ? ", ..." : ""}`
    : "Tools: browser.*, computer.*, work.*, proof.*, and usage.status";
  const headline = clientName === "generic"
    ? "Agent connection ready."
    : `${clientLabel(clientName)} connection ready.`;
  const lines: string[] = [headline, "", `MCP URL: ${url}`, toolLine];

  if (installResult) {
    lines.push("");
    if (installResult.changed) {
      lines.push(installResult.method === "cli"
        ? `Installed via ${installResult.location}.`
        : `Wrote ${clientLabel(clientName)} MCP config: ${installResult.location}`);
    } else {
      lines.push(`${clientLabel(clientName)} MCP config already pointed at this Agent Computer (${installResult.location}).`);
    }
    if (installResult.backupPath) {
      lines.push(`Previous config backed up to: ${installResult.backupPath}`);
    }
    lines.push(installResult.nextStep);
    return lines.join("\n");
  }

  if (hostedAgentComputerClientAuthBlocked(clientName, url, connection)) {
    lines.push("", hostedAgentComputerClientAuthMessage(clientName));
    lines.push("Next: use `vibecodr start` or `vibecodr try` for the hosted Agent Computer, and use `vibecodr install " + clientName + "` for the OAuth-backed Vibecodr MCP Gateway.");
    return lines.join("\n");
  }

  const snippet = clientConfigSnippet(clientName, url, serverName);
  if (snippet) {
    lines.push("", `Add this to ${snippet.label}:`, "", snippet.code);
    lines.push("", snippet.nextStep);
  } else {
    lines.push("", "Next: add this MCP URL to the agent client, then ask it to use the Vibecodr Agent Computer.");
  }
  return lines.join("\n");
}

function hostedAgentComputerClientAuthBlocked(clientName: string, url: string, connection: Record<string, unknown>): boolean {
  if (!isInstallableClient(clientName)) {
    return false;
  }
  if (!isHostedAgentComputerMcpUrl(url)) {
    return false;
  }
  const auth = typeof connection.auth === "object" && connection.auth !== null && !Array.isArray(connection.auth)
    ? connection.auth as Record<string, unknown>
    : {};
  return auth.clientInstall !== "oauth_client_supported";
}

function hostedAgentComputerClientAuthMessage(clientName: string): string {
  return `${clientLabel(clientName)} install skipped: tools.vibecodr.space/mcp uses vc-tools grants, and this CLI will not write a bare editor config until that client auth flow is explicitly supported.`;
}

function isHostedAgentComputerMcpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "tools.vibecodr.space"
      && (url.pathname === "/mcp" || url.pathname === "/v1/mcp");
  } catch {
    return false;
  }
}

function clientLabel(clientName: string): string {
  switch (clientName.toLowerCase()) {
    case "codex": return "Codex";
    case "cursor": return "Cursor";
    case "vscode": return "VS Code";
    case "windsurf": return "Windsurf";
    case "claude": case "claude-desktop": return "Claude Desktop";
    case "claude-code": return "Claude Code";
    default: return clientName;
  }
}

interface ClientSnippet {
  label: string;
  code: string;
  nextStep: string;
}

function clientConfigSnippet(clientName: string, url: string, serverName: string): ClientSnippet | undefined {
  switch (clientName.toLowerCase()) {
    case "codex": {
      const code = [
        `[mcp_servers.${serverName}]`,
        `url = "${url}"`
      ].join("\n");
      return {
        label: "your Codex MCP config (~/.codex/config.toml)",
        code,
        nextStep: "Then restart or open a new Codex session."
      };
    }
    case "cursor": {
      const code = JSON.stringify({
        mcpServers: {
          [serverName]: { url }
        }
      }, null, 2);
      return {
        label: "your Cursor MCP config (~/.cursor/mcp.json)",
        code,
        nextStep: "Then open Cursor and trigger the Vibecodr Agent Computer."
      };
    }
    case "vscode": {
      const code = JSON.stringify({
        servers: {
          [serverName]: { type: "http", url }
        }
      }, null, 2);
      return {
        label: "your VS Code MCP config (workspace .vscode/mcp.json or user settings)",
        code,
        nextStep: "Then reload the VS Code MCP servers and connect."
      };
    }
    case "windsurf": {
      const code = JSON.stringify({
        mcpServers: {
          [serverName]: { serverUrl: url }
        }
      }, null, 2);
      return {
        label: "your Windsurf MCP config (~/.codeium/windsurf/mcp_config.json)",
        code,
        nextStep: "Then restart Windsurf and connect."
      };
    }
    case "claude":
    case "claude-desktop": {
      const code = JSON.stringify({
        mcpServers: {
          [serverName]: {
            command: "npx",
            args: ["mcp-remote", url]
          }
        }
      }, null, 2);
      return {
        label: "your Claude Desktop config (claude_desktop_config.json). Claude Desktop does not load remote HTTP MCP servers directly; this uses the mcp-remote stdio proxy via npx",
        code,
        nextStep: "Restart Claude Desktop (Node.js / npx must be installed). Alternatively, add the MCP URL via Settings -> Connectors -> Add custom connector."
      };
    }
    case "claude-code": {
      return {
        label: "Claude Code",
        code: `claude mcp add ${serverName} --url ${url}`,
        nextStep: "Then start a new Claude Code session in this workspace."
      };
    }
    default:
      return undefined;
  }
}

function formatMaybeAccountLabel(me: MeResponse | undefined): string {
  return me === undefined ? "the verified Vibecodr account" : formatAccountLabel(me);
}

function formatAccountLabel(me: MeResponse): string {
  if (me.user.email && !me.user.email.endsWith("@vibecodr.local")) {
    return me.user.email;
  }
  return me.workspace?.name ?? me.workspace?.id ?? me.user.id;
}

function localPlanPackagingAuthority(): Record<string, unknown> {
  return {
    source: "local-package-fallback",
    accountEntitlementsAuthoritative: false,
    localFallbackAuthoritative: false,
    accountStateEndpoint: "/v1/usage",
    enforcement: "server-side",
    message: "Local plan packaging is informational only. Hosted usage and hosted quota checks decide real account entitlement, usage, billing, and enforcement."
  };
}

function formatPlanPackagingAuthoritySummary(value: unknown): string {
  if (!isRecord(value)) {
    return "informational packaging; hosted usage and quota checks decide account entitlement";
  }
  const source = typeof value.source === "string" ? value.source : "unknown";
  const accountAuthoritative = value.accountEntitlementsAuthoritative === true;
  const localAuthoritative = value.localFallbackAuthoritative === true;
  if (accountAuthoritative || localAuthoritative) {
    return `${source} (unexpectedly authoritative; verify hosted account state before relying on this)`;
  }
  return `${source} (informational only; not billing or enforcement authority)`;
}

interface UsageRow {
  label: string;
  used?: number;
  included?: number;
  unit?: string;
}

function usageRows(data: Record<string, unknown>): UsageRow[] {
  return [
    usageRow(data, "Monthly credits", "monthlyCredits") ?? usageRow(data, "Monthly credits", "vcToolCredits"),
    usageRow(data, "Daily credits", "dailyCredits") ?? usageRow(data, "Daily credits", "dailyVcToolCredits"),
    usageRow(data, "Browser work", "browserWork") ?? usageRow(data, "Browser work", "browserJobs"),
    usageRow(data, "Computer work", "computerWork") ?? usageRow(data, "Computer work", "sandboxJobs"),
    usageRow(data, "Browser seconds", "browserSeconds", "s"),
    usageRow(data, "Daily browser seconds", "dailyBrowserSeconds", "s"),
    usageRow(data, "Sandbox minutes", "sandboxMinutes", "min"),
    usageRow(data, "Proof storage", "proofStorage", "GB") ?? usageRow(data, "Proof storage", "artifactStorageGb", "GB"),
    usageRow(data, "Running now", "runningNow") ?? usageRow(data, "Running now", "concurrentRuns"),
    usageRow(data, "Active browser sessions", "browserSessionConcurrency"),
    usageRow(data, "Active sandbox tasks", "sandboxConcurrency")
  ].filter((row): row is UsageRow => row !== undefined);
}

function usageRow(data: Record<string, unknown>, label: string, key: string, unit?: string): UsageRow | undefined {
  const value = data[key];
  if (!isRecord(value)) {
    return undefined;
  }
  const used = numberValue(value.used);
  const included = numberValue(value.included);
  if (used === undefined && included === undefined) {
    return undefined;
  }
  const row: UsageRow = { label };
  if (used !== undefined) row.used = used;
  if (included !== undefined) row.included = included;
  if (unit !== undefined) row.unit = unit;
  return row;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function formatUsageNumber(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function formatJobStatusMessage(job: unknown, fallbackId: string): string {
  if (!isRecord(job)) {
    return `Fetched work ${fallbackId}.`;
  }
  const id = typeof job.id === "string" ? job.id : fallbackId;
  const status = typeof job.status === "string" ? job.status : "unknown";
  const queue = isRecord(job.queue) ? job.queue : undefined;
  const delay = typeof queue?.fairDelaySeconds === "number" ? queue.fairDelaySeconds : 0;
  if (status === "queued" && delay > 0) {
    return `Work ${id} is queued with a ${delay}s fairness delay so one account cannot monopolize the hosted computer.`;
  }
  return `Work ${id} is ${status}.`;
}

function quotaPercent(used: number, included: number): number {
  if (included <= 0) {
    return used > 0 ? 100 : 0;
  }
  return Math.max(0, Math.min(100, Math.round((used / included) * 100)));
}

function usageBar(percent: number): string {
  const width = 10;
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)));
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function buildToolTestPayload(
  capability: CapabilityName,
  target: string | undefined,
  parsed: ParsedCommandOptions,
  globalToolTimeoutMs?: number
): Record<string, unknown> {
  if (capability.startsWith("browser.")) {
    if (!target) {
      throw new CliError("input.url_required", `${capability} requires an HTTPS URL target.`, 2);
    }
    const input: Record<string, unknown> = {
      url: validateBrowserUrl(target)
    };
    const format = getStringFlag(parsed.flags, "format");
    const timeoutInput = getStringFlag(parsed.flags, "timeoutMs") ?? (globalToolTimeoutMs === undefined ? undefined : String(globalToolTimeoutMs));
    const timeoutMs = validatePositiveInt(timeoutInput, "--timeout-ms", 1000, capability === "browser.agent_task" ? 3600000 : 180000);
    if (capability === "browser.agent_task") {
      const instructions = getStringFlag(parsed.flags, "instructions");
      const idleTimeoutMs = validatePositiveInt(getStringFlag(parsed.flags, "idleTimeoutMs"), "--idle-timeout-ms", 1000, 600000);
      if (instructions !== undefined) input.instructions = instructions.slice(0, 4000);
      if (idleTimeoutMs !== undefined) input.idleTimeoutMs = idleTimeoutMs;
    } else if (capability === "browser.crawl_site") {
      const maxPages = validatePositiveInt(getStringFlag(parsed.flags, "maxPages"), "--max-pages", 1, 250);
      const maxDepth = validatePositiveInt(getStringFlag(parsed.flags, "maxDepth"), "--max-depth", 0, 4);
      const render = parsed.flags.render;
      if (maxPages !== undefined) input.maxPages = maxPages;
      if (maxDepth !== undefined) input.maxDepth = maxDepth;
      if (typeof render === "boolean") input.render = render;
      if (format !== undefined) input.format = validateCrawlFormat(format);
    } else if (format !== undefined) {
      input.format = format;
    }
    if (timeoutMs !== undefined) input.timeoutMs = timeoutMs;
    return {
      capability,
      input
    };
  }

  if (capability.startsWith("sandbox.")) {
    const command = getStringFlag(parsed.flags, "command") ?? parsed.positionals[0];
    if (!command) {
      throw new CliError("input.command_required", `${capability} requires --command <command>.`, 2);
    }
    const input: Record<string, unknown> = {
      command: validateSandboxCommand(command),
      network: normalizeComputerNetworkFlag(parsed)
    };
    const timeoutInput = getStringFlag(parsed.flags, "timeoutMs") ?? (globalToolTimeoutMs === undefined ? undefined : String(globalToolTimeoutMs));
    const timeoutMs = validatePositiveInt(timeoutInput, "--timeout-ms", 1000, 1800000);
    if (timeoutMs !== undefined) input.timeoutMs = timeoutMs;
    return {
      capability,
      input
    };
  }

  if (capability === "artifact.get") {
    return {
      capability,
      input: {
        artifactId: validateEntityId(target ?? "", "artifact id")
      }
    };
  }

  if (capability === "artifact.create") {
    throw new CliError("input.use_artifacts_create", "Use vibecodr artifacts create --file <path> --yes to create artifacts.", 2);
  }

  if (capability === "job.status" || capability === "job.cancel") {
    return {
      capability,
      input: {
        jobId: validateEntityId(target ?? "", "job id"),
        confirmed: capability === "job.cancel" ? getBooleanFlag(parsed.flags, "yes") : undefined
      }
    };
  }

  return { capability, input: {} };
}

function buildScheduledQaPayload(target: string, parsed: ParsedCommandOptions, globalToolTimeoutMs?: number): Record<string, unknown> {
  const capability = normalizeScheduledQaCliCapability(getStringFlag(parsed.flags, "capability") ?? getStringFlag(parsed.flags, "tool") ?? "browser.render_url");
  const timeoutInput = getStringFlag(parsed.flags, "timeoutMs") ?? (globalToolTimeoutMs === undefined ? undefined : String(globalToolTimeoutMs));
  const timeoutMs = validatePositiveInt(timeoutInput, "--timeout-ms", 1000, 180000);
  const intervalMinutes = validatePositiveInt(getStringFlag(parsed.flags, "intervalMinutes"), "--interval-minutes", 1, 30 * 24 * 60);
  const input: Record<string, unknown> = {
    url: validateBrowserUrl(target)
  };
  const format = getStringFlag(parsed.flags, "format");
  if (format !== undefined && capability !== "browser.extract_markdown") {
    input.format = format;
  }
  if (timeoutMs !== undefined) input.timeoutMs = timeoutMs;
  const body: Record<string, unknown> = {
    capability,
    input
  };
  if (intervalMinutes !== undefined) body.intervalMinutes = intervalMinutes;
  const label = getStringFlag(parsed.flags, "label");
  if (label !== undefined) body.label = label;
  if (getBooleanFlag(parsed.flags, "runNow")) body.runNow = true;
  return body;
}

function normalizeScheduledQaCliCapability(input: string): CapabilityName {
  const capability = normalizeCapabilityName(input);
  if (!["browser.render_url", "browser.screenshot_url", "browser.extract_markdown", "browser.render_pdf"].includes(capability)) {
    throw new CliError("input.unsupported_scheduled_qa_capability", "Scheduled QA supports browser.render, browser.screenshot, browser.markdown, and browser.pdf.", 2);
  }
  return capability;
}

function validateCrawlFormat(format: string): string {
  if (format !== "markdown" && format !== "html") {
    throw new CliError("input.invalid_format", "--format for browser.crawl must be markdown or html.", 2);
  }
  return format;
}

function normalizeComputerNetworkFlag(parsed: ParsedCommandOptions): boolean {
  const value = parsed.flags.network;
  if (value === undefined || value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  if (value === "public") {
    return true;
  }
  if (value === "off" || value === "none" || value === "false") {
    return false;
  }
  throw new CliError("input.invalid_network", "--network must be public or off. Public HTTP(S) is available by default; private, local, metadata, and internal destinations remain blocked by hosted policy.", 2);
}

interface CredentialSummary {
  mode: CredentialDescriptorMode;
  source: CredentialSource | "native" | "stored";
  label: string;
  file?: string | undefined;
}

interface AuthInspection {
  token?: string | undefined;
  warnings: string[];
  config: {
    dir: string;
    dirSource: "default" | "--config-dir" | "VC_TOOLS_CONFIG_DIR";
    defaultDir?: string | undefined;
    defaultConfigExists?: boolean | undefined;
    defaultCredentialsExist?: boolean | undefined;
    configExists: boolean;
    credentialsExist: boolean;
    credentialStore: "native" | "file";
  };
  credential: {
    envOverrides: CredentialSummary[];
    stored: {
      status: "present" | "missing" | "unavailable" | "error";
      credentialStore: "native" | "file";
      credentialMode?: StoredLocalCredential["mode"] | undefined;
      grantStatus?: "fresh" | "expired" | "missing" | undefined;
      refreshable?: boolean | undefined;
      errorCode?: string | undefined;
    };
    winning?: (CredentialSummary & { kind: "explicit" | "stored" }) | undefined;
    ambiguous: boolean;
  };
}

async function inspectAuthState(context: CommandContext): Promise<AuthInspection> {
  const warnings: string[] = [];
  const local = await context.store.inspect();
  const explicitCredentials = credentialDescriptors(context, undefined, false).map((descriptor) =>
    credentialSummary(descriptor, context.cwd)
  );
  const ambiguous = explicitCredentials.length > 1;
  const configDirSource = context.globals.configDir
    ? "--config-dir"
    : context.env.VC_TOOLS_CONFIG_DIR
      ? "VC_TOOLS_CONFIG_DIR"
      : "default";
  const config: AuthInspection["config"] = {
    ...local,
    dirSource: configDirSource
  };

  if (configDirSource !== "default") {
    const envWithoutOverride = { ...context.env };
    delete envWithoutOverride.VC_TOOLS_CONFIG_DIR;
    const defaultStore = new ConfigStore(resolveConfigDir(envWithoutOverride), envWithoutOverride);
    const defaultLocal = await defaultStore.inspect();
    config.defaultDir = defaultLocal.dir;
    config.defaultConfigExists = defaultLocal.configExists;
    config.defaultCredentialsExist = defaultLocal.credentialsExist;
    warnings.push(`${configDirSource} is set, so this session is isolated from the normal Vibecodr config directory.`);
  }

  let storedAuth: StoredAuthState = { version: 2 };
  let storedStatus: AuthInspection["credential"]["stored"]["status"] = "missing";
  let storedErrorCode: string | undefined;
  let storedAuthCleared = false;
  try {
    storedAuth = await context.store.readAuthState();
    storedStatus = storedAuth.credential || storedAuth.grant ? "present" : "missing";
  } catch (error) {
    const cliError = toCliError(error);
    if (isRecoverableStoredAuthError(cliError)) {
      await clearRecoverableStoredAuthState(context, warnings);
      storedStatus = "missing";
      storedAuthCleared = true;
    } else {
      storedStatus = cliError.code === "storage.native_credentials_unavailable" ? "unavailable" : "error";
      storedErrorCode = cliError.code;
      warnings.push(cliError.message);
    }
  }

  let token: string | undefined;
  let winning: AuthInspection["credential"]["winning"];
  if (ambiguous) {
    warnings.push(`Multiple explicit credential sources are set: ${explicitCredentials.map((item) => item.label).join(", ")}.`);
  } else if (explicitCredentials[0]) {
    winning = { ...explicitCredentials[0], kind: "explicit" };
    try {
      token = await resolveToken(context, false);
    } catch (error) {
      warnings.push(toCliError(error).message);
    }
    if (storedStatus === "present") {
      warnings.push(`A stored approval exists, but ${explicitCredentials[0].label} is taking precedence.`);
    }
  } else if (storedStatus === "present") {
    token = await resolveToken(context, false).catch((error) => {
      warnings.push(toCliError(error).message);
      return undefined;
    });
    winning = {
      mode: storedAuth.credential?.mode ?? "token",
      source: local.credentialStore === "native" ? "native" : "stored",
      label: storedAuth.credential
        ? `stored ${formatCredentialMode(storedAuth.credential.mode)}`
        : "cached Vibecodr grant",
      kind: "stored"
    };
  }

  return {
    token,
    warnings,
    config: {
      ...config,
      credentialsExist: (storedAuthCleared ? false : config.credentialsExist) || storedStatus === "present" || explicitCredentials.length > 0
    },
    credential: {
      envOverrides: explicitCredentials,
      stored: {
        status: storedStatus,
        credentialStore: local.credentialStore,
        credentialMode: storedAuth.credential?.mode,
        grantStatus: storedAuth.grant ? (isGrantFresh(storedAuth.grant) ? "fresh" : "expired") : "missing",
        refreshable: Boolean(storedAuth.credential && storedAuth.credential.mode !== "token"),
        errorCode: storedErrorCode
      },
      winning,
      ambiguous
    }
  };
}

function credentialSummary(descriptor: CredentialDescriptor, cwd: string): CredentialSummary {
  const summary: CredentialSummary = {
    mode: descriptor.mode,
    source: descriptor.source,
    label: descriptor.label
  };
  if (descriptor.file) {
    summary.file = path.resolve(cwd, descriptor.file);
  }
  return summary;
}

function safeOsUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    return "unknown";
  }
}

async function getOptionalProfile(context: CommandContext): Promise<{ name: string; profile: { apiUrl: string; workspaceId?: string | undefined; mcpUrl?: string | undefined } }> {
  try {
    return await context.store.getProfile(context.globals.profile);
  } catch {
    return { name: context.globals.profile, profile: { apiUrl: context.globals.apiUrl ?? context.env.VC_TOOLS_API_URL ?? DEFAULT_API_URL } };
  }
}

async function resolveToken(context: CommandContext, required: true, options?: { forceRefresh?: boolean }): Promise<string>;
async function resolveToken(context: CommandContext, required: false, options?: { forceRefresh?: boolean }): Promise<string | undefined>;
async function resolveToken(context: CommandContext, required: boolean, options: { forceRefresh?: boolean } = {}): Promise<string | undefined> {
  const envCredential = await resolveLoginCredential(context, undefined, false);

  if (envCredential?.mode === "token") {
    validateTokenShape(envCredential.value);
    return envCredential.value;
  }

  if (envCredential?.mode === "oauth" || envCredential?.mode === "api_key") {
    validateCredentialShape(envCredential.value, envCredential.mode === "oauth" ? "OAuth token" : "API key");
    const exchange = await exchangeCredentialForGrant(context, undefined, envCredential);
    validateTokenShape(exchange.access_token);
    return exchange.access_token;
  }

  try {
    const state = await context.store.readAuthState();
    const token = await resolveStoredToken(context, state, options.forceRefresh === true);
    if (token) {
      return token;
    }
  } catch (error) {
    const cliError = toCliError(error);
    if (isRecoverableStoredAuthError(cliError)) {
      await clearRecoverableStoredAuthState(context);
    } else if (required || cliError.code !== "storage.native_credentials_unavailable") {
      throw cliError;
    }
  }

  if (required) {
    throw new CliError("auth.missing", "Run vibecodr start, pass a credential with --credential-file or --credential-stdin, or set VC_TOOLS_CREDENTIAL_FILE for an isolated agent.", 3);
  }
  return undefined;
}

async function resolveStoredToken(context: CommandContext, state: StoredAuthState, forceRefresh: boolean): Promise<string | undefined> {
  if (!forceRefresh && state.grant && isGrantFresh(state.grant)) {
    return state.grant.token;
  }

  const credential = state.credential;
  if (credential?.mode === "api_key" || credential?.mode === "oauth") {
    validateCredentialShape(credential.value, credential.mode === "oauth" ? "OAuth token" : "API key");
    const exchange = await exchangeCredentialForGrant(context, undefined, {
      mode: credential.mode,
      value: credential.value,
      source: storedCredentialSourceToCredentialSource(credential.source)
    });
    validateTokenShape(exchange.access_token);
    await context.store.saveGrant({
      token: exchange.access_token,
      expiresAt: exchange.expires_at,
      savedAt: new Date().toISOString(),
      source: "exchange"
    });
    return exchange.access_token;
  }

  if (credential?.mode === "token") {
    validateTokenShape(credential.value);
    return credential.value;
  }

  return !forceRefresh && state.grant?.token ? state.grant.token : undefined;
}

function isRecoverableStoredAuthError(error: CliError): boolean {
  return error.code === "config.credentials_invalid_shape";
}

async function clearRecoverableStoredAuthState(context: CommandContext, warnings?: string[]): Promise<void> {
  try {
    await context.store.clearToken(context.globals.profile);
    warnings?.push("Removed an unreadable stored Vibecodr approval. Run vibecodr start to connect this Agent Computer.");
  } catch (error) {
    const cliError = toCliError(error);
    warnings?.push(`Could not remove an unreadable stored Vibecodr approval: ${cliError.message}`);
  }
}

function isGrantFresh(grant: StoredGrant, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  return typeof grant.expiresAt !== "number" || grant.expiresAt - nowSeconds > GRANT_REFRESH_SKEW_SECONDS;
}

function formatCredentialMode(mode: StoredLocalCredential["mode"]): string {
  if (mode === "api_key") {
    return "API key";
  }
  if (mode === "oauth") {
    return "OAuth token";
  }
  return "Vibecodr grant";
}

function storedCredentialSourceToCredentialSource(source: StoredLocalCredential["source"]): CredentialSource {
  return source === "env" || source === "stdin" || source === "file" || source === "flag" ? source : "file";
}

function createClient(context: CommandContext, profile: { apiUrl: string }, token?: string): ApiClient {
  return createApiClient({
    baseUrl: versionedApiUrl(context.globals.apiUrl ?? context.env.VC_TOOLS_API_URL ?? profile.apiUrl, allowInsecureLocalApi(context)),
    token,
    timeoutMs: context.globals.timeoutMs,
    allowInsecureLocalApi: allowInsecureLocalApi(context),
    fetchImpl: context.fetchImpl
  });
}

function allowInsecureLocalApi(context: CommandContext): boolean {
  return context.globals.allowInsecureLocalApi || context.env.VC_TOOLS_ALLOW_INSECURE_LOCAL_API === "true";
}

async function exchangeCredentialForGrant(
  context: CommandContext,
  parsed: ParsedCommandOptions | undefined,
  credential: Extract<LoginCredential, { mode: "oauth" | "api_key" }>
): Promise<CliGrantExchangeResponse> {
  const authApiUrl = getStringFlag(parsed?.flags ?? {}, "authApiUrl") ?? context.env.VC_TOOLS_AUTH_API_URL ?? DEFAULT_AUTH_API_URL;
  const body =
    credential.mode === "oauth"
      ? { access_token: credential.value, grant_profile: "vc_tools" }
      : { api_key: credential.value, grant_profile: "vc_tools" };

  const authClient = createBaseClient({
    baseUrl: authApiUrl,
    timeoutMs: context.globals.timeoutMs,
    allowInsecureLocalApi: allowInsecureLocalApi(context),
    fetchImpl: context.fetchImpl,
    serviceName: "Vibecodr Auth API",
    redactResponses: false
  });
  const parsedResponse = await authClient.request<unknown>("POST", "auth/cli/exchange", { body });
  if (!isRecord(parsedResponse)) {
    throw new CliError("auth.invalid_exchange_response", "Vibecodr Auth API returned an invalid CLI grant response.", 6);
  }

  const accessToken = parsedResponse.access_token;
  const expiresAt = parsedResponse.expires_at;
  const userId = parsedResponse.user_id;
  if (parsedResponse.token_type !== "Bearer" || typeof accessToken !== "string" || typeof expiresAt !== "number" || typeof userId !== "string") {
    throw new CliError("auth.invalid_exchange_response", "Vibecodr Auth API returned an invalid CLI grant response.", 6);
  }

  return {
    token_type: "Bearer",
    access_token: accessToken,
    expires_at: expiresAt,
    user_id: userId,
    user_handle: typeof parsedResponse.user_handle === "string" ? parsedResponse.user_handle : undefined,
    credential_type: typeof parsedResponse.credential_type === "string" ? parsedResponse.credential_type : undefined,
    grant_profile: typeof parsedResponse.grant_profile === "string" ? parsedResponse.grant_profile : undefined,
    scopes: Array.isArray(parsedResponse.scopes) ? parsedResponse.scopes.filter((scope): scope is string => typeof scope === "string") : undefined,
    durable_credential: normalizeDurableCredentialResponse(parsedResponse.durable_credential)
  };
}

async function completeBrowserDeviceLogin(
  context: CommandContext,
  parsed: ParsedCommandOptions
): Promise<{
  exchange: CliGrantExchangeResponse;
  browserLogin: { userCode: string; verificationUri: string; openedBrowser: boolean };
}> {
  const authClient = createAuthClient(context, parsed);
  const start = await startBrowserDeviceLogin(authClient);
  const verificationUri = start.verification_uri_complete ?? start.verification_uri;
  const openedBrowser = await maybeOpenBrowser(context, parsed, verificationUri);

  if (!context.globals.json && !context.globals.quiet) {
    context.stderr.write(
      [
        `Open this URL to approve Vibecodr login: ${verificationUri}`,
        `Code: ${start.user_code}`,
        "Only approve the browser page if the code shown there matches this terminal.",
        openedBrowser ? "A browser window was opened for you." : "The browser was not opened automatically; paste the URL above.",
        ""
      ].join("\n")
    );
  }

  const exchange = await pollBrowserDeviceLogin(context, authClient, start);
  validateTokenShape(exchange.access_token);
  return {
    exchange,
    browserLogin: {
      userCode: start.user_code,
      verificationUri,
      openedBrowser
    }
  };
}

function createAuthClient(context: CommandContext, parsed: ParsedCommandOptions | undefined) {
  const authApiUrl = getStringFlag(parsed?.flags ?? {}, "authApiUrl") ?? context.env.VC_TOOLS_AUTH_API_URL ?? DEFAULT_AUTH_API_URL;
  return createBaseClient({
    baseUrl: authApiUrl,
    timeoutMs: context.globals.timeoutMs,
    allowInsecureLocalApi: allowInsecureLocalApi(context),
    fetchImpl: context.fetchImpl,
    serviceName: "Vibecodr Auth API",
    redactResponses: false
  });
}

async function startBrowserDeviceLogin(authClient: ReturnType<typeof createAuthClient>): Promise<DeviceStartResponse> {
  const response = await authClient.request<unknown>("POST", "auth/vc-tools/device/start", {
    body: {
      client_name: "vc-tools",
      version: VERSION
    }
  });
  if (!isDeviceStartResponse(response)) {
    throw new CliError("auth.invalid_device_response", "Vibecodr Auth API returned an invalid browser-login response.", 6);
  }
  return response;
}

async function pollBrowserDeviceLogin(
  context: CommandContext,
  authClient: ReturnType<typeof createAuthClient>,
  start: DeviceStartResponse
): Promise<CliGrantExchangeResponse> {
  let intervalMs = clampPollIntervalMs(start.interval);
  const deadlineMs = start.expires_at * 1000;

  while (Date.now() < deadlineMs) {
    const response = await authClient.request<unknown>("POST", "auth/vc-tools/device/token", {
      body: { device_code: start.device_code }
    });
    const parsed = parseDevicePollResponse(response);
    if ("access_token" in parsed) {
      return parsed;
    }

    if (!context.globals.json && !context.globals.quiet && parsed.message) {
      context.stderr.write(`${parsed.message}\n`);
    }
    intervalMs = clampPollIntervalMs(parsed.interval ?? intervalMs / 1000);
    await sleep(Math.min(intervalMs, Math.max(0, deadlineMs - Date.now())));
  }

  throw new CliError("auth.device_login_expired", "Vibecodr browser login expired before approval. Run vibecodr login again.", 3);
}

function parseDevicePollResponse(value: unknown): DevicePollResponse {
  if (isCliGrantExchangeResponse(value)) {
    return normalizeCliGrantExchangeResponse(value);
  }
  if (isRecord(value) && value.status === "authorization_pending") {
    return {
      status: "authorization_pending",
      interval: typeof value.interval === "number" ? value.interval : undefined,
      expires_at: typeof value.expires_at === "number" ? value.expires_at : undefined,
      message: typeof value.message === "string" ? value.message : undefined
    };
  }
  throw new CliError("auth.invalid_device_response", "Vibecodr Auth API returned an invalid browser-login polling response.", 6);
}

function clampPollIntervalMs(intervalSeconds: number): number {
  if (!Number.isFinite(intervalSeconds)) {
    return 5_000;
  }
  return Math.max(0, Math.min(30_000, Math.floor(intervalSeconds * 1000)));
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function maybeOpenBrowser(
  context: CommandContext,
  parsed: ParsedCommandOptions,
  url: string
): Promise<boolean> {
  if (parsed.flags.browser === false || context.env.VC_TOOLS_BROWSER_OPEN === "false") {
    return false;
  }
  const parsedUrl = validateBrowserLoginUrl(url);
  const command =
    process.platform === "win32"
      ? { file: "cmd", args: ["/c", "start", "", parsedUrl.toString()] }
      : process.platform === "darwin"
        ? { file: "open", args: [parsedUrl.toString()] }
        : { file: "xdg-open", args: [parsedUrl.toString()] };
  try {
    const child = spawn(command.file, command.args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function validateBrowserLoginUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliError("auth.invalid_device_response", "Vibecodr Auth API returned an invalid browser-login URL.", 6);
  }
  if (url.username || url.password) {
    throw new CliError("auth.invalid_device_response", "Browser-login URL must not include credentials.", 6);
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase().replace(/^\[|\]$/g, ""))) {
    throw new CliError("auth.invalid_device_response", "Browser-login URL must use HTTPS outside local development.", 6);
  }
  return url;
}

function isDeviceStartResponse(value: unknown): value is DeviceStartResponse {
  return (
    isRecord(value) &&
    typeof value.device_code === "string" &&
    typeof value.user_code === "string" &&
    typeof value.verification_uri === "string" &&
    (value.verification_uri_complete === undefined || typeof value.verification_uri_complete === "string") &&
    typeof value.expires_at === "number" &&
    typeof value.interval === "number"
  );
}

function isCliGrantExchangeResponse(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.token_type === "Bearer" &&
    typeof value.access_token === "string" &&
    typeof value.expires_at === "number" &&
    typeof value.user_id === "string"
  );
}

function normalizeCliGrantExchangeResponse(value: Record<string, unknown>): CliGrantExchangeResponse {
  const durable = normalizeDurableCredentialResponse(value.durable_credential);
  return {
    token_type: "Bearer",
    access_token: String(value.access_token),
    expires_at: Number(value.expires_at),
    user_id: String(value.user_id),
    user_handle: typeof value.user_handle === "string" ? value.user_handle : undefined,
    credential_type: typeof value.credential_type === "string" ? value.credential_type : undefined,
    grant_profile: typeof value.grant_profile === "string" ? value.grant_profile : undefined,
    scopes: Array.isArray(value.scopes) ? value.scopes.filter((scope): scope is string => typeof scope === "string") : undefined,
    durable_credential: durable
  };
}

function normalizeDurableCredentialResponse(value: unknown): DurableCredentialResponse | undefined {
  if (!isRecord(value) || value.type !== "api_key" || typeof value.api_key !== "string") {
    return undefined;
  }
  validateCredentialShape(value.api_key, "API key");
  return {
    type: "api_key",
    api_key: value.api_key,
    id: typeof value.id === "string" ? value.id : undefined,
    name: typeof value.name === "string" ? value.name : undefined,
    expires_at: typeof value.expires_at === "number" ? value.expires_at : undefined
  };
}

function versionedApiUrl(apiUrl: string, allowInsecure = false): string {
  const url = normalizeBaseUrl(apiUrl, allowInsecure);
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname.endsWith("/v1")) {
    url.pathname = `${pathname}/v1/`.replace(/^\/?/, "/");
  }
  return url.toString();
}

function validateTokenShape(token: string): void {
  if (token.length < 12 || /\s/.test(token)) {
    throw new CliError("auth.invalid_token", "Token must be at least 12 characters and contain no whitespace.", 2);
  }
}

function validateCredentialShape(value: string, label: string): void {
  if (value.length < 8 || /\s/.test(value)) {
    throw new CliError("auth.invalid_credential", `${label} must be at least 8 characters and contain no whitespace.`, 2);
  }
}

async function resolveLoginCredential(context: CommandContext, parsed: ParsedCommandOptions | undefined, includeCommandFlags: boolean): Promise<LoginCredential | undefined> {
  rejectCredentialTypeFlags(parsed);
  const descriptors = credentialDescriptors(context, parsed, includeCommandFlags);
  if (descriptors.length > 1) {
    throw new CliError(
      "auth.ambiguous_credentials",
      `Provide only one Vibecodr credential source. Received: ${descriptors.map((descriptor) => descriptor.label).join(", ")}.`,
      3
    );
  }

  const descriptor = descriptors[0];
  if (descriptor === undefined) {
    return undefined;
  }

  const value = await readCredentialDescriptor(context, descriptor);
  const mode = descriptor.mode === "auto" ? inferCredentialMode(value) : descriptor.mode;
  return { mode, source: descriptor.source, value };
}

function rejectCredentialTypeFlags(parsed: ParsedCommandOptions | undefined): void {
  if (!parsed) {
    return;
  }

  const removedFlags = [
    "apiKey",
    "apiKeyFile",
    "apiKeyStdin",
    "oauthToken",
    "oauthTokenFile",
    "oauthTokenStdin"
  ].filter((flag) => Object.prototype.hasOwnProperty.call(parsed.flags, flag));

  if (removedFlags.length > 0) {
    throw new CliError(
      "input.unsupported_credential_flag",
      "Use --credential, --credential-file, or --credential-stdin. vibecodr now infers whether the credential is a grant, Clerk API key, or Clerk OAuth token.",
      2
    );
  }
}

function credentialDescriptors(context: CommandContext, parsed: ParsedCommandOptions | undefined, includeCommandFlags: boolean): CredentialDescriptor[] {
  const descriptors: CredentialDescriptor[] = [];
  const flags = parsed?.flags ?? {};

  addCredentialValue(descriptors, "auto", "flag", "--credential", context.globals.credential);
  addCredentialFile(descriptors, "auto", "flag", "--credential-file", context.globals.credentialFile);
  addCredentialStdin(descriptors, "auto", "stdin", "--credential-stdin", context.globals.credentialStdin);
  addCredentialValue(descriptors, "token", "flag", "--token", context.globals.token);
  addCredentialFile(descriptors, "token", "flag", "--token-file", context.globals.tokenFile);
  addCredentialStdin(descriptors, "token", "stdin", "--token-stdin", context.globals.tokenStdin);

  if (includeCommandFlags) {
    addCredentialValue(descriptors, "auto", "flag", "--credential", getStringFlag(flags, "credential"));
    addCredentialFile(descriptors, "auto", "flag", "--credential-file", getStringFlag(flags, "credentialFile"));
    addCredentialStdin(descriptors, "auto", "stdin", "--credential-stdin", getBooleanFlag(flags, "credentialStdin"));
    addCredentialValue(descriptors, "token", "flag", "--token", getStringFlag(flags, "token"));
    addCredentialFile(descriptors, "token", "flag", "--token-file", getStringFlag(flags, "tokenFile"));
    addCredentialStdin(descriptors, "token", "stdin", "--token-stdin", getBooleanFlag(flags, "tokenStdin"));
  }

  addCredentialValue(descriptors, "auto", "env", "VC_TOOLS_CREDENTIAL", context.env.VC_TOOLS_CREDENTIAL);
  addCredentialFile(descriptors, "auto", "file", "VC_TOOLS_CREDENTIAL_FILE", context.env.VC_TOOLS_CREDENTIAL_FILE);
  addCredentialValue(descriptors, "token", "env", "VC_TOOLS_TOKEN", context.env.VC_TOOLS_TOKEN);
  addCredentialFile(descriptors, "token", "file", "VC_TOOLS_TOKEN_FILE", context.env.VC_TOOLS_TOKEN_FILE);

  return descriptors;
}

function addCredentialValue(descriptors: CredentialDescriptor[], mode: CredentialDescriptorMode, source: CredentialSource, label: string, value: string | undefined): void {
  if (value !== undefined && value !== "") {
    descriptors.push({ mode, source, label, value });
  }
}

function addCredentialFile(descriptors: CredentialDescriptor[], mode: CredentialDescriptorMode, source: CredentialSource, label: string, file: string | undefined): void {
  if (file !== undefined && file !== "") {
    descriptors.push({ mode, source, label, file });
  }
}

function addCredentialStdin(descriptors: CredentialDescriptor[], mode: CredentialDescriptorMode, source: CredentialSource, label: string, enabled: boolean): void {
  if (enabled) {
    descriptors.push({ mode, source, label });
  }
}

function inferCredentialMode(value: string): CredentialMode {
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    return "token";
  }
  if (value.startsWith("ak_")) {
    return "api_key";
  }
  if (value.startsWith("oat_") || value.startsWith("oauth_")) {
    return "oauth";
  }
  throw new CliError(
    "auth.credential_type_unknown",
    "Could not identify the credential type. Use a Vibecodr grant token, a Clerk API key starting with ak_, or a Clerk OAuth token starting with oat_.",
    2
  );
}

async function readCredentialDescriptor(context: CommandContext, descriptor: CredentialDescriptor): Promise<string> {
  if (descriptor.value !== undefined) {
    return descriptor.value.trim();
  }

  if (descriptor.file !== undefined) {
    const filePath = path.resolve(context.cwd, descriptor.file);
    const stat = await fs.stat(filePath).catch(() => undefined);
    if (!stat?.isFile()) {
      throw new CliError("auth.credential_file_missing", `Credential file does not exist: ${filePath}`, 5);
    }
    if (stat.size > MAX_CREDENTIAL_BYTES) {
      throw new CliError("auth.credential_file_too_large", "Credential files must be 64 KiB or smaller.", 5);
    }
    const value = (await fs.readFile(filePath, "utf8")).trim();
    if (!value) {
      throw new CliError("auth.empty_credential", `Credential file is empty: ${filePath}`, 2);
    }
    return value;
  }

  if (isInteractiveStdin(context.stdin)) {
    throw new CliError("auth.stdin_interactive", `${descriptor.label} reads from stdin. Pipe the credential or use a credential file.`, 2);
  }

  const value = (await readStdin(context.stdin)).trim();
  if (!value) {
    throw new CliError("auth.empty_credential", `${descriptor.label} received no stdin data.`, 2);
  }
  return value;
}

async function readStdin(stdin: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    total += buffer.byteLength;
    if (total > MAX_CREDENTIAL_BYTES) {
      throw new CliError("auth.stdin_too_large", "Credential stdin must be 64 KiB or smaller.", 2);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function isInteractiveStdin(stdin: Readable): boolean {
  return Boolean((stdin as Readable & { isTTY?: boolean }).isTTY);
}

function requiredPositional(parsed: ParsedCommandOptions, index: number, message: string): string {
  const value = parsed.positionals[index];
  if (!value) {
    throw new CliError("input.missing_argument", message, 2);
  }
  return value;
}

async function ensureOutputPathAllowed(cwd: string, outPath: string): Promise<void> {
  const lexicalCwd = path.resolve(cwd);
  assertPathInsideWorkspace(lexicalCwd, path.resolve(outPath));

  const realCwd = await fs.realpath(cwd);
  const realCandidate = await realpathOrNearestExistingParent(outPath);
  if (realCandidate === undefined || isPathOutside(realCwd, realCandidate)) {
    throw new CliError("file.outside_workspace", ARTIFACT_OUTPUT_WORKSPACE_MESSAGE, 5);
  }
}

async function ensureInputPathAllowed(cwd: string, inputPath: string): Promise<void> {
  const [resolvedCwd, resolvedInput] = await Promise.all([
    fs.realpath(cwd),
    fs.realpath(inputPath)
  ]);
  const relative = path.relative(resolvedCwd, resolvedInput);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new CliError("file.outside_workspace", ARTIFACT_INPUT_WORKSPACE_MESSAGE, 5);
  }
}

async function realpathOrNearestExistingParent(inputPath: string): Promise<string | undefined> {
  let current = path.resolve(inputPath);
  while (true) {
    const real = await fs.realpath(current).catch(() => undefined);
    if (real !== undefined) {
      return real;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function assertPathInsideWorkspace(cwd: string, candidate: string): void {
  if (isPathOutside(cwd, candidate)) {
    throw new CliError("file.outside_workspace", ARTIFACT_OUTPUT_WORKSPACE_MESSAGE, 5);
  }
}

function isPathOutside(cwd: string, candidate: string): boolean {
  const relative = path.relative(cwd, candidate);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function nodeMajor(): number {
  return Number(process.version.replace(/^v/, "").split(".")[0] ?? "0");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withOptionalHead(head: string | undefined, tail: string[]): string[] {
  return head === undefined ? tail : [head, ...tail];
}

const TOP_LEVEL_COMMANDS = ["start", "setup", "try", "agent", "computer", "browser", "work", "proof", "usage", "limits", "dashboard", "doctor", "auth", "login", "logout", "status", "whoami", "connect", "tools", "jobs", "artifacts", "grants", "retention", "scheduled-qa", "plans", "inspect"];

function helpResult(args: string[] = []): CommandResult {
  const topic = args.filter((arg) => arg !== "--").join(" ").trim();
  return {
    message: topic ? commandHelpText(args) : helpText(),
    data: helpData(topic || undefined),
    humanData: "hide"
  };
}

function helpText(): string {
  return `vibecodr ${VERSION}

The hosted Vibecodr Agent Computer for agents.

Examples:
  vibecodr start
  vibecodr try
  vibecodr agent connect --client codex
  vibecodr computer status
  vibecodr browser screenshot https://example.com --format png --local
  vibecodr browser read https://example.com
  vibecodr computer run "npm test" --local
  vibecodr work follow job_123
  vibecodr proof save art_123 --out ./artifacts

Usage:
  vibecodr <command> [options]
  vibecodr help <command>

Commands:
  start       Connect and verify the Agent Computer, then return agent connection details.
  setup       Alias for start.
  try         Run a small browser, computer, proof, and usage check.
  agent       Connect an agent to the hosted computer or check readiness.
  computer    Start/status/run commands on the hosted Agent Computer.
  browser     Capture, read, render, crawl, or inspect public HTTPS pages with the hosted Browser.
  work        List, follow, show, or cancel hosted work.
  proof       List, show, save, or delete saved outputs and artifacts.
  usage       Show account-scoped Agent Computer capacity and quota progress.
  limits      Alias for usage.
  dashboard   Print the hosted supervision dashboard URL.
  doctor      Explain whether the Agent Computer is ready and what to do next.

Advanced/debug commands:
  auth, login, logout, status, whoami, connect, tools, jobs, artifacts, grants, retention, scheduled-qa, plans, inspect

Global flags:
  --json                         Stable machine-readable output.
  -q, --quiet                    Suppress non-essential human success output.
  -h, --help                     Show help. Works after subcommands too.
  --version                      Show version.
  --api-url <url>                Hosted Vibecodr API URL. HTTPS unless local dev is explicitly allowed.
  --allow-insecure-local-api     Allow http://localhost API URLs for local development.
  --timeout-ms <ms>              Network timeout from 1000 to 300000.
  --no-input                     Disable browser/device login for automation.
  --no-color                     Accepted for CLI convention compatibility. vibecodr emits no color by default.

Advanced credential/config flags:
  --credential-file <path>       Read a Vibecodr grant, Clerk API key, or Clerk OAuth token from a file.
  --credential-stdin             Read a Vibecodr grant, Clerk API key, or Clerk OAuth token from stdin.
  --config-dir <dir>             Isolated config directory override for tests/automation.

Docs:
  https://vibecodr.space/docs/vc-tools
Overview:
  https://vibecodr.space/vc-tools
Support:
  https://vibecodr.space/support
`;
}

function commandHelpText(args: string[]): string {
  const [command, subcommand] = args;
  if (command === undefined) {
    return helpText();
  }

  switch (command) {
    case "start":
    case "setup":
      return `vibecodr start

Connect and verify the hosted Vibecodr Agent Computer, then return the connection details an agent needs.

Examples:
  vibecodr start
  vibecodr start --client codex

Usage:
  vibecodr start [--client generic]
  vibecodr setup [--client generic]
`;
    case "agent":
      return `vibecodr agent

Connect an agent to the hosted Vibecodr Agent Computer or check whether the computer is ready.

Usage:
  vibecodr agent connect [--client generic]
  vibecodr agent instructions [--client generic]
  vibecodr agent status
`;
    case "try":
      return `vibecodr try

Run a small end-to-end Agent Computer check: auth, hosted API, public Browser read, hosted computer run, proof saving, and usage.

Usage:
  vibecodr try [--out ./vibecodr-proof] [--details]
`;
    case "computer":
      return `vibecodr computer

Use the hosted Vibecodr Agent Computer. Commands are submitted to Vibecodr; nothing is executed locally.
Public HTTP(S) package/docs access is available by default; private, local, and internal destinations are blocked by hosted policy.

Usage:
  vibecodr computer start
  vibecodr computer status
  vibecodr computer run "<command>" [--timeout-ms <ms>] [--network public|off] [--local|--out ./proof] [--no-wait] [--details]
  vibecodr computer test "<command>" [--timeout-ms <ms>] [--network public|off] [--local|--out ./proof] [--no-wait] [--details]
`;
    case "browser":
      return `vibecodr browser

Use the hosted Browser against public HTTPS pages. Localhost, private networks, URL credentials, and internal hosts are blocked before hosted work is submitted.

Usage:
  vibecodr browser screenshot <https-url> [--format png] [--local|--out ./proof] [--no-wait] [--details]
  vibecodr browser read <https-url> [--local|--out ./proof] [--no-wait] [--details]
  vibecodr browser render <https-url> [--local|--out ./proof] [--no-wait] [--details]
  vibecodr browser pdf <https-url> [--local|--out ./proof] [--no-wait] [--details]
  vibecodr browser crawl <https-url> [--max-pages n] [--max-depth n] [--local|--out ./proof]
  vibecodr browser snapshot <https-url> [--local|--out ./proof]

Attach a note:
  vibecodr browser notes <https-url> --note <text> [--local|--out ./proof]

Notes:
  Add --local to save completed output into ./vibecodr-proof automatically.
  browser snapshot captures page state; it does not prompt an agent or model.
  browser notes saves your note with the snapshot.
`;
    case "work":
      return `vibecodr work

Inspect hosted work the agent has submitted.

Usage:
  vibecodr work list [--limit 20]
  vibecodr work show <jobId>
  vibecodr work follow <jobId> [--local|--out ./proof] [--details]
  vibecodr work cancel <jobId> --yes
`;
    case "proof":
      return `vibecodr proof

List, inspect, save, or delete outputs saved by hosted work.

Usage:
  vibecodr proof list [--limit 20]
  vibecodr proof show <artifactId>
  vibecodr proof save <artifactId> [--out <dir|file>] [--filename <name>] [--overwrite]
  vibecodr proof delete <artifactId> --yes
`;
    case "login":
      return `vibecodr login

Approve this machine to use Vibecodr. Plain login opens the browser/device approval flow.

Examples:
  vibecodr login
  vibecodr login --credential-file ./vibecodr-credential.txt
  vibecodr login --credential-stdin

Usage:
  vibecodr login [--no-browser]
  vibecodr login (--credential-file <path> | --credential-stdin)

Options:
  --no-browser                   Print the approval URL and code without opening a browser.
  --skip-verify                  Save without calling /v1/me.
  --auth-api-url <url>           Override the Vibecodr Auth API exchange URL.
  --api-url <url>                Hosted Vibecodr API URL saved for this approval.
`;
    case "auth":
      return `vibecodr auth

Diagnose or export the current Agent Computer approval without printing secrets.

Usage:
  vibecodr auth diagnose [--json]
  vibecodr auth status [--json]
  vibecodr auth export-agent-env --out <file> --yes [--overwrite]

Notes:
  diagnose shows which credential source is winning, whether VC_TOOLS_CONFIG_DIR isolates this session, and whether the stored credential store is readable.
  export-agent-env writes the durable local credential when available, otherwise a bearer grant, and returns the matching file env var. The secret value is never printed.
`;
    case "logout":
      return `vibecodr logout

Remove the saved Agent Computer approval.

Usage:
  vibecodr logout --yes
`;
    case "status":
      return `vibecodr status

Show whether this shell/agent has an Agent Computer approval saved, without requiring auth.

Usage:
  vibecodr status [--json]
`;
    case "whoami":
      return `vibecodr whoami

Show the Vibecodr account and plan for the approved Agent Computer.

Usage:
  vibecodr whoami [--json]
`;
    case "connect":
      return `vibecodr connect

Fetch hosted MCP connection metadata for an agent client. Most users should use vibecodr agent connect.

Usage:
  vibecodr connect [--client generic]
`;
    case "tools":
      if (subcommand === "test") {
        return `vibecodr tools test

Submit a no-local-execution hosted tool test after validating local inputs.

Examples:
  vibecodr tools test browser.render https://example.com
  vibecodr tools test browser.agent https://example.com --timeout-ms 1200000 --idle-timeout-ms 600000
  vibecodr tools test browser.crawl https://example.com/docs --max-pages 10 --max-depth 1
  vibecodr tools test sandbox.run --command "npm test"
  vibecodr tools test usage

Usage:
  vibecodr tools test <capability> [target] [--command <cmd>] [--timeout-ms <ms>] [--max-pages n] [--max-depth n] [--no-render]

Notes:
  Browser Quick Actions accept up to 180000 ms. Browser agent tasks accept up to 3600000 ms and are plan-capped by the hosted service. Sandbox tasks accept up to 1800000 ms and are plan-capped by the hosted service.
`;
      }
      return `vibecodr tools

Advanced: list granted low-level capabilities or submit a hosted capability test.

Usage:
  vibecodr tools list
  vibecodr tools test <capability> [target] [--command <cmd>]
`;
    case "jobs":
      return `vibecodr jobs

Advanced alias for vibecodr work.

Usage:
  vibecodr jobs list [--limit 20]
  vibecodr jobs status <jobId>
  vibecodr jobs cancel <jobId> --yes
`;
    case "artifacts":
      return `vibecodr artifacts

Advanced alias for vibecodr proof. Pulls and uploads are bounded to the current workspace.

Usage:
  vibecodr artifacts list [--limit 20]
  vibecodr artifacts get <artifactId>
  vibecodr artifacts pull <artifactId> [--out <dir|file>] [--filename <name>] [--overwrite]
  vibecodr artifacts create --file <path> [--kind <kind>] --yes
  vibecodr artifacts delete <artifactId> --yes

Notes:
  Delete removes the hosted shelf row and R2 bytes for the authenticated actor.
  Pull output must stay inside the current workspace. Use --out ./artifacts for a directory, --out ./artifacts/report.pdf for an explicit file target, or --filename <name> to choose a file name inside a directory output.
`;
    case "usage":
      return `vibecodr usage

Show account-scoped Agent Computer capacity and quota progress.

Usage:
  vibecodr usage [--json]

Alias:
  vibecodr limits
`;
    case "limits":
      return `vibecodr limits

Alias for vibecodr usage. Shows account-scoped Agent Computer capacity and quota progress.

Usage:
  vibecodr limits [--json]
`;
    case "grants":
      return `vibecodr grants

Show effective tool grants. With no subcommand, this defaults to list.

Usage:
  vibecodr grants
  vibecodr grants list [--project <id>] [--user <id>]
`;
    case "retention":
      return `vibecodr retention

Show or update retention policy. Updates mutate hosted policy and require --yes.

Usage:
  vibecodr retention show
  vibecodr retention set [--logs-days n] [--artifacts-days n] [--recordings off|opt-in|admin] --yes
`;
    case "scheduled-qa":
      return `vibecodr scheduled-qa

Create and manage plan-capped scheduled Browser Quick Action checks. Scheduled QA only accepts public HTTPS browser render, screenshot, markdown, and PDF checks.

Usage:
  vibecodr scheduled-qa list
  vibecodr scheduled-qa create <https-url> [--capability browser.render|browser.screenshot|browser.markdown|browser.pdf] [--interval-minutes n] [--label text] [--run-now] --yes
  vibecodr scheduled-qa pause <id> --yes
  vibecodr scheduled-qa resume <id> [--run-now] --yes
  vibecodr scheduled-qa delete <id> --yes
`;
    case "plans":
      return `vibecodr plans

Show public Free, Creator, and Pro packaging. Works offline with local fallback data.

Usage:
  vibecodr plans [--json]
`;
    case "dashboard":
      return `vibecodr dashboard

Print a hosted supervision dashboard URL. Sections: ${DASHBOARD_SECTIONS.map((item) => item.id).join(", ")}.

Usage:
  vibecodr dashboard [section]
`;
    case "inspect":
      return `vibecodr inspect

Show goal-coverage inspections for local release readiness.

Usage:
  vibecodr inspect [--json]
`;
    case "doctor":
      return `vibecodr doctor

Explain whether the Agent Computer is ready and what to do next.

Usage:
  vibecodr doctor [--json]
`;
    default:
      throw unknownCommandError(command);
  }
}

function helpData(topic?: string): Record<string, unknown> {
  return {
    version: VERSION,
    binary: "vibecodr",
    package: "@vibecodr/cli",
    topic,
    capabilities: CAPABILITIES,
    grants: LAUNCH_TOOL_GRANTS,
    workflows: LAUNCH_WORKFLOWS,
    commands: TOP_LEVEL_COMMANDS,
    docs: "https://vibecodr.space/docs/vc-tools",
    overview: "https://vibecodr.space/vc-tools",
    support: "https://vibecodr.space/support"
  };
}

function unknownCommandError(command: string | undefined): CliError {
  const suggestion = command === undefined ? undefined : suggest(command, TOP_LEVEL_COMMANDS);
  const suggestionText = suggestion ? ` Did you mean "vibecodr ${suggestion}"?` : "";
  return new CliError("input.unknown_command", `Unknown command "${command ?? ""}".${suggestionText} Run vibecodr --help.`, 2);
}

function unknownSubcommandError(command: string, subcommand: string | undefined, allowed: string[], usage: string): CliError {
  const suggestion = subcommand === undefined ? undefined : suggest(subcommand, allowed);
  const suggestionText = suggestion ? ` Did you mean "vibecodr ${command} ${suggestion}"?` : "";
  return new CliError("input.unknown_subcommand", `Unknown ${command} subcommand "${subcommand ?? ""}".${suggestionText} ${usage}`, 2);
}

function suggest(input: string, candidates: string[]): string | undefined {
  const normalized = input.replace(/^-+/, "").toLowerCase();
  let best: { candidate: string; distance: number } | undefined;
  for (const candidate of candidates) {
    const distance = levenshtein(normalized, candidate.toLowerCase());
    if (distance <= 3 && (best === undefined || distance < best.distance)) {
      best = { candidate, distance };
    }
  }
  return best?.candidate;
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const replaceCost = left[leftIndex] === right[rightIndex] ? 0 : 1;
      current[rightIndex + 1] = Math.min(
        (current[rightIndex] ?? 0) + 1,
        (previous[rightIndex + 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + replaceCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? left.length;
}
