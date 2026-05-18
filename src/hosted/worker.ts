import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";
import type { ExecOptions, ExecResult, Sandbox as CloudflareSandboxClass } from "@cloudflare/sandbox";
import type {
  WorkflowEvent,
  WorkflowRetentionDuration,
  WorkflowStep,
  WorkflowStepConfig,
  WorkflowTimeoutDuration
} from "cloudflare:workers";
import {
  CAPABILITIES,
  CAPABILITY_ALIASES,
  DASHBOARD_SECTIONS,
  DEFAULT_PLANS,
  LAUNCH_POLICIES,
  LAUNCH_TOOL_GRANTS,
  LAUNCH_WORKFLOWS,
  OPERATOR_DASHBOARD_SECTIONS,
  OVERAGE_METERS,
  PUBLIC_OFFERING_CLASSIFICATIONS,
  type CapabilityName
} from "../legacy/core/contracts.js";
import { GOAL_INSPECTIONS, goalCoverageSummary } from "../legacy/core/goal-coverage.js";
import { redactObject } from "../legacy/core/redaction.js";
import { VC_TOOLS_VERSION } from "../legacy/core/version.js";

interface SandboxInstance {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  destroy(): Promise<void>;
}

interface SandboxSdkModule {
  ContainerProxy: unknown;
  Sandbox: typeof CloudflareSandboxClass;
  getSandbox<T extends CloudflareSandboxClass>(ns: DurableObjectNamespace<T>, id: string, options?: { normalizeId?: boolean }): T;
}

type WorkflowEntrypointConstructor = typeof import("cloudflare:workers").WorkflowEntrypoint;
type HostedWorkerTestGlobal = typeof globalThis & { __VC_TOOLS_HOSTED_WORKER_TEST__?: boolean };
type OfferingClassification = (typeof PUBLIC_OFFERING_CLASSIFICATIONS)[number];

class LocalWorkflowEntrypoint<Env = unknown> {
  protected ctx: ExecutionContext;
  protected env: Env;

  constructor(ctx: ExecutionContext, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  async run(): Promise<unknown> {
    throw new Error("Local WorkflowEntrypoint shim must be extended by a test workflow.");
  }
}

async function loadWorkflowEntrypoint(): Promise<WorkflowEntrypointConstructor> {
  if ((globalThis as HostedWorkerTestGlobal).__VC_TOOLS_HOSTED_WORKER_TEST__) {
    return LocalWorkflowEntrypoint as unknown as WorkflowEntrypointConstructor;
  }
  const module = await import("cloudflare:workers");
  return module.WorkflowEntrypoint;
}

const sandboxSdk = await loadSandboxSdk();
const WorkflowEntrypointBase = await loadWorkflowEntrypoint();
const MAX_BROWSER_TOOL_TIMEOUT_MS = 180_000;
const MAX_BROWSER_AGENT_TASK_TIMEOUT_MS = 3_600_000;
const DEFAULT_BROWSER_AGENT_IDLE_TIMEOUT_MS = 600_000;
const BROWSER_SESSION_KEEP_ALIVE_MIN_MS = 10_000;
const BROWSER_SESSION_KEEP_ALIVE_MAX_MS = 600_000;
const BROWSER_NAVIGATION_WAIT_UNTIL = "networkidle2";
const MAX_BROWSER_AGENT_ACTIONS = 50;
const BROWSER_QUICK_ACTION_GOTO_TIMEOUT_MAX_MS = 60_000;
const BROWSER_QUICK_ACTION_ACTION_TIMEOUT_MAX_MS = 300_000;
const DEFAULT_BROWSER_CRAWL_PAGES_PER_RUN = 10;
const MAX_BROWSER_CRAWL_PAGES_PER_RUN = 250;
const DEFAULT_BROWSER_CRAWL_DEPTH = 1;
const MAX_BROWSER_CRAWL_DEPTH = 4;
const BROWSER_CRAWL_POLL_INTERVAL_MS = 1000;
const MAX_BROWSER_REDIRECT_PREFLIGHTS = 5;
const DEFAULT_SCHEDULED_QA_MAX_ENQUEUES_PER_TICK = 25;
const MAX_SCHEDULED_QA_MAX_ENQUEUES_PER_TICK = 100;
const MAX_SCHEDULED_QA_INTERVAL_MINUTES = 30 * 24 * 60;
const DEFAULT_HOSTED_QUEUE_MAX_CONCURRENCY = 30;
const DEFAULT_JOB_QUEUE_MAX_RETRIES = 3;
const DEFAULT_QUEUE_BACKLOG_SOFT_CAP = 30;
const DEFAULT_QUEUE_BACKLOG_HARD_CAP = 100;
const DEFAULT_DLQ_MESSAGES_SOFT_CAP = 1;
const DEFAULT_DLQ_MESSAGES_HARD_CAP = 10;
const MAX_QUEUE_MESSAGES_CAP = 10_000;
const DEFAULT_ARTIFACT_STORAGE_ACCOUNT_SOFT_GB = 24;
const DEFAULT_ARTIFACT_STORAGE_ACCOUNT_HARD_GB = 30;
const MAX_ARTIFACT_STORAGE_ACCOUNT_GB = 10_000;
const DEFAULT_HOSTED_ACCOUNT_SOFT_CAP = 24;
const DEFAULT_HOSTED_ACCOUNT_HARD_CAP = 30;
const MAX_HOSTED_ACCOUNT_CAP = 120;
const DEFAULT_BROWSER_RUN_ACCOUNT_SOFT_CAP = 24;
const DEFAULT_BROWSER_RUN_ACCOUNT_HARD_CAP = 30;
const MAX_BROWSER_RUN_ACCOUNT_CAP = 120;
const DEFAULT_SANDBOX_ACCOUNT_SOFT_CAP = 24;
const DEFAULT_SANDBOX_ACCOUNT_HARD_CAP = 30;
const MAX_SANDBOX_ACCOUNT_CAP = 120;
const FAIR_QUEUE_DELAY_PER_ACTOR_JOB_SECONDS = 5;
const MAX_FAIR_QUEUE_DELAY_SECONDS = 30;
const MAX_SANDBOX_OUTPUT_CHARS = 200_000;
const VC_TOOLS_CAPACITY_ALERT_CODE = "E-VIBECODR-VC-TOOLS-SOFT-CAP";
const VC_TOOLS_CAPACITY_ALERT_TAG = "[vc-tools.capacity_soft_cap]";
const VC_TOOLS_RETENTION_CLEANUP_ALERT_CODE = "E-VIBECODR-VC-TOOLS-RETENTION-CLEANUP-FAILED";
const VC_TOOLS_RETENTION_CLEANUP_ALERT_TAG = "[vc-tools.retention_cleanup_failed]";
const VC_TOOLS_EXECUTION_HEALTH_ALERT_CODE = "E-VIBECODR-VC-TOOLS-EXECUTION-HEALTH-DEGRADED";
const VC_TOOLS_EXECUTION_HEALTH_ALERT_TAG = "[vc-tools.execution_health_degraded]";
const VC_TOOLS_HOSTED_WORKER_5XX_ALERT_CODE = "E-VIBECODR-VC-TOOLS-HOSTED-WORKER-5XX";
const VC_TOOLS_HOSTED_WORKER_5XX_ALERT_TAG = "[vc-tools.hosted_worker_5xx]";
const VC_TOOLS_AUTH_FAILURE_ALERT_CODE = "E-VIBECODR-VC-TOOLS-AUTH-FAILURE-ANOMALY";
const VC_TOOLS_AUTH_FAILURE_ALERT_TAG = "[vc-tools.auth_failure_anomaly]";
const VC_TOOLS_CLOUDFLARE_SPEND_ALERT_CODE = "E-VIBECODR-VC-TOOLS-CLOUDFLARE-SPEND-ANOMALY";
const VC_TOOLS_CLOUDFLARE_SPEND_ALERT_TAG = "[vc-tools.cloudflare_spend_anomaly]";
const OPERATOR_ALERT_THRESHOLDS = [70, 85, 95] as const;
const DEFAULT_EXECUTION_HEALTH_WINDOW_MINUTES = 15;
const DEFAULT_EXECUTION_HEALTH_MIN_TERMINAL_JOBS = 5;
const DEFAULT_FAILURE_RATE_ALERT_PERCENT = 25;
const DEFAULT_TIMEOUT_RATE_ALERT_PERCENT = 10;
const MAX_EXECUTION_HEALTH_WINDOW_MINUTES = 24 * 60;
const DEFAULT_AUTH_FAILURE_WINDOW_MINUTES = 15;
const DEFAULT_AUTH_FAILURE_ALERT_THRESHOLD = 25;
const MAX_AUTH_FAILURE_WINDOW_MINUTES = 24 * 60;
const DEFAULT_CLOUDFLARE_SPEND_SOFT_USD = 80;
const DEFAULT_CLOUDFLARE_SPEND_HARD_USD = 100;
const MAX_CLOUDFLARE_SPEND_ALERT_USD = 1_000_000;
const OPERATOR_DASHBOARD_SCOPES = ["vc-tools:operator", "vc-tools:cogs.read", "vc-tools:*"] as const;
const INTERNAL_ALERT_PATH = "/internal/alerts/outbound";
const INTERNAL_ALERT_URL = `https://internal${INTERNAL_ALERT_PATH}`;
const INTERNAL_TIMESTAMP_HEADER = "X-Internal-Timestamp";
const INTERNAL_SIGNATURE_HEADER = "X-Internal-Signature";
const INTERNAL_NONCE_HEADER = "X-Internal-Nonce";
const INTERNAL_BODY_SHA256_HEADER = "X-Internal-Body-SHA256";

export const ContainerProxy = sandboxSdk.ContainerProxy;

const SANDBOX_DENIED_HOSTS = [
  "localhost",
  "*.localhost",
  "*.local",
  "*.internal",
  "*.home.arpa",
  "*.lan",
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "224.0.0.0/4",
  "::/128",
  "::1/128",
  "::ffff:0.0.0.0/96",
  "64:ff9b::/96",
  "100::/64",
  "fc00::/7",
  "fe80::/10",
  "ff00::/8"
] as const;

export class Sandbox extends sandboxSdk.Sandbox {
  // WHY: public HTTP(S) egress leaves through the outbound handler below; raw
  // non-HTTP internet stays closed while package/docs access remains useful.
  override enableInternet = false;
  override interceptHttps = true;
  override deniedHosts = [...SANDBOX_DENIED_HOSTS];
}

export class ProSandbox extends sandboxSdk.Sandbox {
  // WHY: Pro uses a larger container lane with the same public HTTP(S) policy.
  override enableInternet = false;
  override interceptHttps = true;
  override deniedHosts = [...SANDBOX_DENIED_HOSTS];
}

type SandboxOutboundHandler = (request: Request, env: HostedEnv, ctx: unknown) => Promise<Response>;
const sandboxOutboundHandler: SandboxOutboundHandler = async (request) => {
  try {
    await assertSandboxOutboundTarget(request);
  } catch (error) {
    return sandboxOutboundDenied(error);
  }
  return fetch(request);
};

(Sandbox as unknown as { outbound: SandboxOutboundHandler }).outbound = sandboxOutboundHandler;
(ProSandbox as unknown as { outbound: SandboxOutboundHandler }).outbound = sandboxOutboundHandler;

export class BrowserAgentTaskWorkflow extends WorkflowEntrypointBase<HostedEnv, ToolJobMessage> {
  override async run(event: WorkflowEvent<ToolJobMessage>, step: WorkflowStep): Promise<Record<string, unknown>> {
    const job = event.payload as ToolJobMessage;
    try {
      await step.do(
        "execute browser agent task",
        browserAgentWorkflowStepConfig(job),
        async () => {
          await processToolJob(job, this.env, this.ctx, DEFAULT_JOB_QUEUE_MAX_RETRIES + 1, "workflow");
          return { jobId: job.id, capability: job.capability };
        }
      );
      return { jobId: job.id, status: "processed" };
    } catch (error) {
      await markBrowserAgentWorkflowFailed(this.env, job, error);
      throw error;
    }
  }
}

type ProviderMode = "contract" | "live";
type RecordingPolicy = "off" | "opt-in" | "admin";
type AuthTokenKind = "static" | "cli_grant";
type Plan = (typeof DEFAULT_PLANS)[number];

interface BrowserRequestLike {
  url(): string;
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
}

interface BrowserPageLike {
  url(): string;
  setRequestInterception(value: boolean): Promise<void>;
  on(event: "request", handler: (request: BrowserRequestLike) => void): unknown;
}

type HostedEnv = Omit<
  Env,
  | "VC_TOOLS_PROVIDER_MODE"
  | "VC_TOOLS_PUBLIC_BASE_URL"
  | "VC_TOOLS_PLAN_NAME"
  | "VC_TOOLS_TOKEN_SHA256"
  | "VC_TOOLS_CLI_GRANT_PUBLIC_JWKS"
  | "VC_TOOLS_CLI_GRANT_REVOKED_JTIS"
  | "VC_TOOLS_CLI_GRANT_LEGACY_HMAC_ENABLED"
  | "VC_TOOLS_CLI_GRANT_SECRET"
  | "VC_TOOLS_CLI_GRANT_ISSUER"
  | "VC_TOOLS_CLI_GRANT_AUDIENCE"
  | "VC_TOOLS_STATIC_TOKEN_ACTOR_ID"
  | "VC_TOOLS_PAUSE_COST_BEARING_JOBS"
  | "VC_TOOLS_DISABLE_BROWSER_RUN"
  | "VC_TOOLS_DISABLE_BROWSER_SESSIONS"
  | "VC_TOOLS_DISABLE_SANDBOX"
  | "VC_TOOLS_HOSTED_ACCOUNT_SOFT_CAP"
  | "VC_TOOLS_HOSTED_ACCOUNT_HARD_CAP"
  | "VC_TOOLS_BROWSER_RUN_ACCOUNT_ID"
  | "VC_TOOLS_BROWSER_RUN_API_TOKEN"
  | "VC_TOOLS_BROWSER_RUN_ACCOUNT_SOFT_CAP"
  | "VC_TOOLS_BROWSER_RUN_ACCOUNT_HARD_CAP"
  | "VC_TOOLS_SANDBOX_ACCOUNT_SOFT_CAP"
  | "VC_TOOLS_SANDBOX_ACCOUNT_HARD_CAP"
  | "VC_TOOLS_INTERNAL_API_WORKER"
  | "VC_TOOLS_INTERNAL_ALERT_TOKEN"
  | "VC_TOOLS_OPERATOR_ALERT_WEBHOOK_URLS"
  | "VC_TOOLS_OPERATOR_ALERT_WEBHOOK_BEARER_TOKEN"
  | "VC_TOOLS_OPERATOR_NTFY_TOPIC"
  | "VC_TOOLS_SCHEDULED_QA_MAX_ENQUEUES_PER_TICK"
  | "VC_TOOLS_AUTH_FAILURE_WINDOW_MINUTES"
  | "VC_TOOLS_AUTH_FAILURE_ALERT_THRESHOLD"
  | "VC_TOOLS_CLOUDFLARE_SPEND_SOFT_USD"
  | "VC_TOOLS_CLOUDFLARE_SPEND_HARD_USD"
  | "VC_TOOLS_COGS_BROWSER_MINUTE_USD"
  | "VC_TOOLS_COGS_SANDBOX_STANDARD1_MINUTE_USD"
  | "VC_TOOLS_COGS_SANDBOX_STANDARD2_MINUTE_USD"
  | "VC_TOOLS_COGS_ARTIFACT_GB_MONTH_USD"
  | "VC_TOOLS_COGS_CRAWL_PAGE_USD"
  | "BROWSER"
  | "BROWSER_AGENT_WORKFLOW"
  | "DB"
  | "ARTIFACTS"
  | "JOB_QUEUE"
  | "Sandbox"
  | "ProSandbox"
> & {
  VC_TOOLS_PUBLIC_BASE_URL?: string;
  VC_TOOLS_PROVIDER_MODE?: ProviderMode;
  VC_TOOLS_PLAN_NAME?: string;
  VC_TOOLS_TOKEN_SHA256?: string;
  VC_TOOLS_CLI_GRANT_PUBLIC_JWKS?: string;
  VC_TOOLS_CLI_GRANT_REVOKED_JTIS?: string;
  VC_TOOLS_CLI_GRANT_LEGACY_HMAC_ENABLED?: string;
  VC_TOOLS_CLI_GRANT_SECRET?: string;
  VC_TOOLS_CLI_GRANT_ISSUER?: string;
  VC_TOOLS_CLI_GRANT_AUDIENCE?: string;
  VC_TOOLS_STATIC_TOKEN_ACTOR_ID?: string;
  VC_TOOLS_PAUSE_COST_BEARING_JOBS?: string;
  VC_TOOLS_DISABLE_BROWSER_RUN?: string;
  VC_TOOLS_DISABLE_BROWSER_SESSIONS?: string;
  VC_TOOLS_DISABLE_SANDBOX?: string;
  VC_TOOLS_HOSTED_ACCOUNT_SOFT_CAP?: string;
  VC_TOOLS_HOSTED_ACCOUNT_HARD_CAP?: string;
  VC_TOOLS_BROWSER_RUN_ACCOUNT_ID?: string;
  VC_TOOLS_BROWSER_RUN_API_TOKEN?: string;
  VC_TOOLS_BROWSER_RUN_ACCOUNT_SOFT_CAP?: string;
  VC_TOOLS_BROWSER_RUN_ACCOUNT_HARD_CAP?: string;
  VC_TOOLS_SANDBOX_ACCOUNT_SOFT_CAP?: string;
  VC_TOOLS_SANDBOX_ACCOUNT_HARD_CAP?: string;
  VC_TOOLS_INTERNAL_API_WORKER?: Fetcher;
  VC_TOOLS_INTERNAL_ALERT_TOKEN?: string;
  VC_TOOLS_OPERATOR_ALERT_WEBHOOK_URLS?: string;
  VC_TOOLS_OPERATOR_ALERT_WEBHOOK_BEARER_TOKEN?: string;
  VC_TOOLS_OPERATOR_NTFY_TOPIC?: string;
  VC_TOOLS_SCHEDULED_QA_MAX_ENQUEUES_PER_TICK?: string;
  VC_TOOLS_QUEUE_BACKLOG_SOFT_CAP?: string;
  VC_TOOLS_QUEUE_BACKLOG_HARD_CAP?: string;
  VC_TOOLS_DLQ_MESSAGES_SOFT_CAP?: string;
  VC_TOOLS_DLQ_MESSAGES_HARD_CAP?: string;
  VC_TOOLS_ARTIFACT_STORAGE_ACCOUNT_SOFT_GB?: string;
  VC_TOOLS_ARTIFACT_STORAGE_ACCOUNT_HARD_GB?: string;
  VC_TOOLS_EXECUTION_HEALTH_WINDOW_MINUTES?: string;
  VC_TOOLS_EXECUTION_HEALTH_MIN_TERMINAL_JOBS?: string;
  VC_TOOLS_FAILURE_RATE_ALERT_PERCENT?: string;
  VC_TOOLS_TIMEOUT_RATE_ALERT_PERCENT?: string;
  VC_TOOLS_AUTH_FAILURE_WINDOW_MINUTES?: string;
  VC_TOOLS_AUTH_FAILURE_ALERT_THRESHOLD?: string;
  VC_TOOLS_CLOUDFLARE_SPEND_SOFT_USD?: string;
  VC_TOOLS_CLOUDFLARE_SPEND_HARD_USD?: string;
  VC_TOOLS_COGS_BROWSER_MINUTE_USD?: string;
  VC_TOOLS_COGS_SANDBOX_STANDARD1_MINUTE_USD?: string;
  VC_TOOLS_COGS_SANDBOX_STANDARD2_MINUTE_USD?: string;
  VC_TOOLS_COGS_ARTIFACT_GB_MONTH_USD?: string;
  VC_TOOLS_COGS_CRAWL_PAGE_USD?: string;
  VC_TOOLS_INTERNAL_METADATA_ACTOR_IDS?: string;
  BROWSER?: BrowserWorker;
  BROWSER_AGENT_WORKFLOW?: Workflow<ToolJobMessage>;
  DB?: D1Database;
  ARTIFACTS?: R2Bucket;
  JOB_QUEUE?: Queue<ToolJobMessage>;
  JOB_DLQ?: Queue<ToolJobMessage>;
  Sandbox?: DurableObjectNamespace<Sandbox>;
  ProSandbox?: DurableObjectNamespace<ProSandbox>;
};

interface ToolJobMessage {
  id: string;
  capability: CapabilityName;
  input: NormalizedToolInput;
  enqueuedAt: string;
  actorId: string;
  planName: string;
  retentionDays: number;
  reservedCredits: number;
  reservedBrowserSeconds: number;
  reservedSandboxSeconds: number;
  fairDelaySeconds?: number;
}

interface AuthContext {
  ok: true;
  actorId: string;
  tokenKind: AuthTokenKind;
  planName: string;
  scopes: string[];
  subject?: string | undefined;
  email?: string | undefined;
  workspaceId?: string | undefined;
}

type AuthResult = AuthContext | { ok: false; status: number; code: string; message: string };

type CliGrantHeader = {
  alg?: string;
  typ?: string;
  kid?: string;
};

type CliGrantPublicJwk = JsonWebKey & {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  kid: string;
};

type NormalizedToolInput = BrowserToolInput | SandboxToolInput | ArtifactToolInput | JobToolInput;

interface BrowserToolInput {
  kind: "browser";
  url: string;
  timeoutMs: number;
  output: "html" | "png" | "jpeg" | "pdf" | "markdown" | "crawl";
  maxPages?: number;
  maxDepth?: number;
  render?: boolean;
  format?: "markdown" | "html";
  instructions?: string;
  idleTimeoutMs?: number;
  actions?: BrowserAgentAction[];
}

type ScheduledQaCapability =
  | "browser.render_url"
  | "browser.screenshot_url"
  | "browser.extract_markdown"
  | "browser.render_pdf";

type BrowserAgentAction =
  | { action: "navigate"; url: string }
  | { action: "click"; selector: string }
  | { action: "type"; selector: string; text: string }
  | { action: "scroll"; deltaY: number }
  | { action: "wait"; ms: number }
  | { action: "snapshot" };

interface StoredArtifactResult {
  id: string;
  kind: string;
  contentType: string;
  bytes: number;
  browserMsUsed?: number;
  crawlPages?: number;
  metadata?: Record<string, unknown>;
}

interface SandboxToolInput {
  kind: "sandbox";
  command: string;
  network: boolean;
  timeoutMs: number;
}

interface ArtifactToolInput {
  kind: "artifact";
  artifactId?: string;
}

interface JobToolInput {
  kind: "job";
  jobId?: string;
}

interface JobRow {
  id: string;
  actor_id: string;
  plan_name: string;
  capability: string;
  status: string;
  input_json: string;
  result_json: string | null;
  error_code: string | null;
  error_message: string | null;
  provider_mode: string;
  queue_global_ahead?: number | null;
  queue_actor_ahead?: number | null;
  queue_delay_seconds?: number | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
}

interface ArtifactRow {
  id: string;
  actor_id: string;
  job_id: string | null;
  kind: string;
  key: string;
  content_type: string;
  bytes: number;
  created_at: string;
  expires_at: string | null;
}

interface RetentionRow {
  scope: string;
  logs_days: number;
  artifacts_days: number;
  recordings: string;
  updated_at: string;
}

interface ScheduledQaConfigRow {
  id: string;
  actor_id: string;
  plan_name: string;
  label: string | null;
  capability: string;
  input_json: string;
  interval_minutes: number;
  enabled: number;
  next_run_at: string;
  last_run_at: string | null;
  last_job_id: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface ScheduledQaCreateConfig {
  label: string | null;
  capability: ScheduledQaCapability;
  input: BrowserToolInput;
  intervalMinutes: number;
  enabled: boolean;
  nextRunAt: string;
  runNow: boolean;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const MCP_PROTOCOL_VERSION = "2025-11-25";
const MAX_JSON_BODY_BYTES = 32_768;
const DEFAULT_GRANT_ISSUER = "https://api.vibecodr.space";
const DEFAULT_GRANT_AUDIENCE = "vibecodr:vc-tools";
const VC_TOOLS_GRANT_SCOPE = "vc-tools:use";
const INTERNAL_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".home.arpa", ".lan"];
const BROWSER_DNS_SAFETY_ERRORS = {
  status: 400,
  dnsCheckCode: "input.dns_check_failed",
  dnsCheckMessage: "Browser URL hostname could not be verified before hosted browser execution.",
  unresolvableCode: "input.unresolvable_url",
  unresolvableMessage: "Browser URL hostname could not be resolved by the hosted safety check.",
  blockedCode: "input.blocked_url",
  blockedMessage: "Browser URL resolves to a private, loopback, link-local, multicast, or unspecified address."
} as const;
const SANDBOX_DNS_SAFETY_ERRORS = {
  status: 403,
  dnsCheckCode: "policy.sandbox_network_denied",
  dnsCheckMessage: "Sandbox network hostname could not be verified by the hosted outbound safety check.",
  unresolvableCode: "policy.sandbox_network_denied",
  unresolvableMessage: "Sandbox network hostname could not be resolved by the hosted outbound safety check.",
  blockedCode: "policy.sandbox_network_denied",
  blockedMessage: "Sandbox network hostname resolves to a private, loopback, link-local, multicast, or unspecified address."
} as const;
type DnsSafetyErrors = typeof BROWSER_DNS_SAFETY_ERRORS | typeof SANDBOX_DNS_SAFETY_ERRORS;
const BROWSER_CAPABILITIES = new Set<CapabilityName>([
  "browser.render_url",
  "browser.screenshot_url",
  "browser.extract_markdown",
  "browser.render_pdf",
  "browser.crawl_site",
  "browser.agent_task"
]);
const BROWSER_RUN_CAPABILITIES = new Set<CapabilityName>([
  "browser.render_url",
  "browser.screenshot_url",
  "browser.extract_markdown",
  "browser.render_pdf",
  "browser.crawl_site"
]);
const BROWSER_SESSION_CAPABILITIES = new Set<CapabilityName>(["browser.agent_task"]);
const SCHEDULED_QA_CAPABILITIES = new Set<ScheduledQaCapability>([
  "browser.render_url",
  "browser.screenshot_url",
  "browser.extract_markdown",
  "browser.render_pdf"
]);
const SANDBOX_CAPABILITIES = new Set<CapabilityName>(["sandbox.run_command", "sandbox.run_tests"]);
const READ_ONLY_CAPABILITIES = new Set<CapabilityName>(["usage.read"]);

interface McpToolDescriptor {
  name: string;
  capability: CapabilityName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const AGENT_TOOL_NAMES: Array<{ name: string; capability: CapabilityName }> = [
  { name: "browser.render", capability: "browser.render_url" },
  { name: "browser.screenshot", capability: "browser.screenshot_url" },
  { name: "browser.read", capability: "browser.extract_markdown" },
  { name: "browser.pdf", capability: "browser.render_pdf" },
  { name: "browser.crawl", capability: "browser.crawl_site" },
  { name: "browser.snapshot", capability: "browser.agent_task" },
  { name: "computer.run", capability: "sandbox.run_command" },
  { name: "computer.test", capability: "sandbox.run_tests" },
  { name: "proof.get", capability: "artifact.get" },
  { name: "usage.status", capability: "usage.read" },
  { name: "work.status", capability: "job.status" },
  { name: "work.cancel", capability: "job.cancel" }
];

const MCP_TOOL_DESCRIPTORS: McpToolDescriptor[] = AGENT_TOOL_NAMES.map(({ name, capability }) => ({
  name,
  capability,
  title: titleForAgentTool(name, capability),
  description: descriptionForAgentTool(name, capability),
  inputSchema: inputSchemaForCapability(capability)
}));

const handler = {
  async fetch(request: Request, env: HostedEnv, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      if (error instanceof HostedError) {
        return json({ code: error.code, message: error.message, details: error.details }, error.status, request);
      }
      scheduleHostedWorker5xxAlert(env, ctx, request, error);
      return json({ code: "server.error", message: "Unexpected vc-tools hosted service failure." }, 500, request);
    }
  },

  async queue(batch: MessageBatch<ToolJobMessage>, env: HostedEnv, ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      await processToolJob(message.body, env, ctx, queueMessageAttempts(message));
    }
  },

  async scheduled(controller: ScheduledController, env: HostedEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.all([
      cleanupExpiredArtifactsWithAlert(env, ctx, controller.scheduledTime),
      enqueueDueScheduledQa(env, controller.scheduledTime),
      checkQueueBacklogPressure(env, ctx, controller.scheduledTime),
      checkQueueDlqPressure(env, ctx, controller.scheduledTime),
      checkArtifactStoragePressure(env, ctx, controller.scheduledTime),
      checkExecutionHealthPressure(env, ctx, controller.scheduledTime),
      checkAuthFailureAnomaly(env, ctx, controller.scheduledTime),
      checkCloudflareSpendAnomaly(env, ctx, controller.scheduledTime)
    ]));
  }
} satisfies ExportedHandler<HostedEnv, ToolJobMessage>;

export default handler;

class HostedError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

class RetentionCleanupError extends Error {
  constructor(
    readonly failedStage: "artifact.select" | "artifact.delete",
    readonly failedCount: number,
    message: string
  ) {
    super(message);
  }
}

async function loadSandboxSdk(): Promise<SandboxSdkModule> {
  const testGlobal = globalThis as typeof globalThis & {
    __VC_TOOLS_HOSTED_WORKER_TEST__?: boolean;
    __VC_TOOLS_SANDBOX_TEST_FACTORY__?: () => SandboxInstance;
  };
  if (testGlobal.__VC_TOOLS_HOSTED_WORKER_TEST__ === true) {
    class TestSandbox implements SandboxInstance {
      async exec(): Promise<ExecResult> {
        throw new Error("Sandbox execution is not available in the Node-hosted worker tests.");
      }

      async destroy(): Promise<void> {}
    }
    return {
      ContainerProxy: class TestContainerProxy {},
      Sandbox: TestSandbox as unknown as typeof CloudflareSandboxClass,
      getSandbox<T extends CloudflareSandboxClass>() {
        return (testGlobal.__VC_TOOLS_SANDBOX_TEST_FACTORY__?.() ?? new TestSandbox()) as unknown as T;
      }
    };
  }

  const sdk = await import("@cloudflare/sandbox");
  return sdk as unknown as SandboxSdkModule;
}

async function handleRequest(request: Request, env: HostedEnv, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = normalizePath(url.pathname);
  const method = request.method.toUpperCase();
  const mode = providerMode(env);

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (method === "GET" && path === "/v1/health") {
    return json({
      ok: true,
      service: "vc-tools-api",
      live: liveReadiness(env),
      version: VC_TOOLS_VERSION,
      requestId: requestId()
    }, 200, request);
  }

  if (method === "GET" && path === "/v1/plans") {
    const auth = await optionalAuthContext(request, env, ctx);
    const surface = requestSurface(url, env, auth);
    if (surface.operator && !canReadInternalLaunchMetadata(env, auth)) {
      throw new HostedError(403, "auth.operator_scope_denied", "Operator vc-tools plan metadata requires an operator-scoped account.");
    }
    if (surface.operator) {
      return json({
        plans: DEFAULT_PLANS,
        ...launchPlanMetadata(env, auth, surface),
        policies: LAUNCH_POLICIES,
        authority: planPackagingAuthority(mode)
      }, 200, request);
    }
    if (surface.details) {
      return json({
        plans: DEFAULT_PLANS,
        authority: planPackagingAuthority(mode)
      }, 200, request);
    }
    return json(publicPlansPayload(DEFAULT_PLANS), 200, request);
  }

  if (path === "/mcp" || path === "/v1/mcp") {
    return mcpResponse(request, env, ctx);
  }

  const auth = await authenticate(request, env);
  if (!auth.ok) {
    recordAuthFailureMetric(env, ctx, request, auth);
    return json({ code: auth.code, message: auth.message }, auth.status, request);
  }

  if (method === "GET" && path === "/v1/me") {
    const plan = activePlanForAuth(auth, env);
    const user: Record<string, unknown> = { id: auth.subject ?? auth.actorId };
    if (auth.email && !auth.email.endsWith("@vibecodr.local")) {
      user.email = auth.email;
    }
    return json({
      user,
      workspace: { id: auth.workspaceId ?? auth.actorId, name: "vc-tools workspace" },
      plan: { name: plan.name }
    }, 200, request);
  }

  if (method === "GET" && path === "/v1/inspect") {
    return json({ summary: goalCoverageSummary(), inspections: GOAL_INSPECTIONS, live: liveReadiness(env, { operator: canReadOperatorDashboard(auth) }) }, 200, request);
  }

  if (method === "GET" && path.startsWith("/dashboard")) {
    return dashboardResponse(path, env, request, auth);
  }

  if (method === "GET" && path === "/v1/mcp/connection") {
    const surface = requestSurface(url, env, auth);
    if (surface.operator && !canReadInternalLaunchMetadata(env, auth)) {
      throw new HostedError(403, "auth.operator_scope_denied", "Operator vc-tools MCP metadata requires an operator-scoped account.");
    }
    const tools = MCP_TOOL_DESCRIPTORS.map((tool) => ({ name: tool.name, capability: tool.capability, title: tool.title }));
    return json({
      transport: "streamable_http",
      url: `${publicBase(env)}/mcp`,
      ...(surface.details || surface.operator ? { scopes: capabilitiesForPlan(activePlanForAuth(auth, env)) } : {}),
      tools,
      protocolVersion: MCP_PROTOCOL_VERSION,
      ...(surface.operator ? { providerMode: mode } : {})
    }, 200, request);
  }

  if (method === "GET" && path === "/v1/tools") {
    const plan = activePlanForAuth(auth, env);
    return json({
      tools: MCP_TOOL_DESCRIPTORS.map((tool) => ({ ...tool, granted: capabilityAllowedForPlan(tool.capability, plan), providerMode: mode })),
      grants: grantsForPlan(plan)
    }, 200, request);
  }

  if (method === "POST" && path === "/v1/tools/test") {
    const body = await readJsonObject(request, MAX_JSON_BODY_BYTES);
    const capability = capabilityFromToolName(typeof body.capability === "string" ? body.capability : "");
    if (!capability) {
      return json({ code: "input.unknown_capability", message: "Unsupported vc-tools capability." }, 400, request);
    }
    if (READ_ONLY_CAPABILITIES.has(capability)) {
      await ensureCapabilityAllowedWithDenialMetrics(auth, env, request, capability);
      return json(await readOnlyToolResult(capability, env, auth), 200, request);
    }
    const input = await normalizeHostedToolInputWithDenialMetrics(capability, isRecord(body.input) ? body.input : {}, env, request, auth);
    await ensureCapabilityAllowedWithDenialMetrics(auth, env, request, capability);
    if (mode === "live") {
      return json(await acceptLiveToolCall(capability, input, env, request, auth), 202, request);
    }
    ctx.waitUntil(recordAudit(env, "tools.test", capability, request, auth));
    return json(acceptedToolCall(capability, env), 202, request);
  }

  if (method === "GET" && path === "/v1/scheduled-qa") {
    await ensureAnyScheduledQaCapabilityAllowedWithDenialMetrics(auth, env, request);
    if (mode === "live") {
      const live = requireLiveBindings(env, ["DB"]);
      return json(await listScheduledQa(live.DB, auth), 200, request);
    }
    return json({
      configs: [],
      providerMode: mode,
      message: "Scheduled QA requires the live hosted provider."
    }, 200, request);
  }

  if (method === "POST" && path === "/v1/scheduled-qa") {
    const body = await readJsonObject(request, MAX_JSON_BODY_BYTES);
    const plan = activePlanForAuth(auth, env);
    const scheduledQa = normalizeScheduledQaCreate(body, plan);
    ensureScheduledQaIncluded(plan);
    await ensureCapabilityAllowedWithDenialMetrics(auth, env, request, scheduledQa.capability);
    if (mode === "live") {
      const required: RequiredBindingName[] = scheduledQa.runNow && scheduledQa.enabled
        ? ["DB", "ARTIFACTS", "JOB_QUEUE", "BROWSER"]
        : ["DB"];
      const live = requireLiveBindings(env, required);
      const created = await createScheduledQaConfig(live.DB, auth, scheduledQa, plan);
      let config = created.config;
      if (scheduledQa.runNow && scheduledQa.enabled) {
        await enqueueScheduledQaConfig(live, env, created.row, nowIso());
        config = await refetchScheduledQaConfig(live.DB, auth, created.row.id, config);
      }
      await recordAudit(env, "scheduled_qa.create", created.row.id, request, auth);
      return json({ config, providerMode: mode, auditLogged: true }, 201, request);
    }
    ctx.waitUntil(recordAudit(env, "scheduled_qa.create", scheduledQa.capability, request, auth));
    return json({
      config: {
        id: `sqa_${crypto.randomUUID()}`,
        label: scheduledQa.label,
        capability: scheduledQa.capability,
        input: scheduledQa.input,
        intervalMinutes: scheduledQa.intervalMinutes,
        enabled: scheduledQa.enabled,
        nextRunAt: scheduledQa.nextRunAt
      },
      status: "contract_only",
      providerMode: mode,
      auditLogged: true
    }, 201, request);
  }

  const scheduledQaMatch = /^\/v1\/scheduled-qa\/([^/]+)$/.exec(path);
  if (method === "PATCH" && scheduledQaMatch?.[1]) {
    const id = decodeURIComponent(scheduledQaMatch[1]);
    const body = await readJsonObject(request, MAX_JSON_BODY_BYTES);
    const plan = activePlanForAuth(auth, env);
    const patch = normalizeScheduledQaPatch(body, plan);
    if (Object.keys(patch).length === 0) {
      throw new HostedError(400, "input.empty_scheduled_qa_update", "Provide at least one scheduled QA field to update.");
    }
    ensureScheduledQaIncluded(plan);
    if (mode === "live") {
      const required: RequiredBindingName[] = patch.runNow === true
        ? ["DB", "ARTIFACTS", "JOB_QUEUE", "BROWSER"]
        : ["DB"];
      const live = requireLiveBindings(env, required);
      const existing = await getScheduledQaConfigRow(live.DB, auth, id);
      if (!existing) {
        return json({ id, status: "not_found", providerMode: mode }, 404, request);
      }
      const requiredCapability = patch.capability ?? scheduledQaCapabilityFromRow(existing);
      await ensureCapabilityAllowedWithDenialMetrics(auth, env, request, requiredCapability);
      const config = await updateScheduledQaConfig(live.DB, auth, id, patch);
      if (!config) {
        return json({ id, status: "not_found", providerMode: mode }, 404, request);
      }
      const responseConfig = patch.runNow === true
        ? await enqueueUpdatedScheduledQaNow(live, env, auth, id, config)
        : config;
      await recordAudit(env, "scheduled_qa.update", id, request, auth);
      return json({ config: responseConfig, providerMode: mode, auditLogged: true }, 200, request);
    }
    ctx.waitUntil(recordAudit(env, "scheduled_qa.update", id, request, auth));
    return json({ id, status: "contract_only", providerMode: mode, auditLogged: true }, 200, request);
  }

  if (method === "DELETE" && scheduledQaMatch?.[1]) {
    const id = decodeURIComponent(scheduledQaMatch[1]);
    if (mode === "live") {
      const live = requireLiveBindings(env, ["DB"]);
      const existing = await getScheduledQaConfigRow(live.DB, auth, id);
      if (!existing) {
        return json({ id, status: "not_found", providerMode: mode }, 404, request);
      }
      await ensureCapabilityAllowedWithDenialMetrics(auth, env, request, scheduledQaCapabilityFromRow(existing));
      const deleted = await deleteScheduledQaConfig(live.DB, auth, id);
      if (!deleted) {
        return json({ id, status: "not_found", providerMode: mode }, 404, request);
      }
      await recordAudit(env, "scheduled_qa.delete", id, request, auth);
      return json({ id, status: "deleted", providerMode: mode, auditLogged: true }, 200, request);
    }
    ctx.waitUntil(recordAudit(env, "scheduled_qa.delete", id, request, auth));
    return json({ id, status: "contract_only", providerMode: mode, auditLogged: true }, 200, request);
  }

  if (method === "GET" && path === "/v1/jobs") {
    await ensureCapabilityAllowedWithDenialMetrics(auth, env, request, "job.status");
    const limit = listLimitFromUrl(url);
    if (mode === "live") {
      const live = requireLiveBindings(env, ["DB"]);
      return json({ jobs: await listJobs(live.DB, auth, limit), providerMode: mode }, 200, request);
    }
    return json({ jobs: [] }, 200, request);
  }

  const jobMatch = /^\/v1\/jobs\/([^/]+)$/.exec(path);
  if (method === "GET" && jobMatch?.[1]) {
    await ensureCapabilityAllowedWithDenialMetrics(auth, env, request, "job.status");
    if (mode === "live") {
      const live = requireLiveBindings(env, ["DB"]);
      const job = await getJob(live.DB, decodeURIComponent(jobMatch[1]), auth);
      return json(job ?? { id: jobMatch[1], status: "not_found", providerMode: mode }, 200, request);
    }
    return json({ id: jobMatch[1], status: "not_found", providerMode: mode }, 200, request);
  }

  const cancelMatch = /^\/v1\/jobs\/([^/]+)\/cancel$/.exec(path);
  if (method === "POST" && cancelMatch?.[1]) {
    await ensureCapabilityAllowedWithDenialMetrics(auth, env, request, "job.cancel");
    if (mode === "live") {
      const live = requireLiveBindings(env, ["DB"]);
      const id = decodeURIComponent(cancelMatch[1]);
      await live.DB.prepare(
        "UPDATE jobs SET status = 'cancel_requested', canceled_at = ?, updated_at = ? WHERE id = ? AND actor_id = ? AND status IN ('queued', 'running')"
      ).bind(nowIso(), nowIso(), id, auth.actorId).run();
      await recordAudit(env, "jobs.cancel", id, request, auth, id);
      return json({ id, status: "cancel_requested", auditLogged: true, providerMode: mode }, 200, request);
    }
    ctx.waitUntil(recordAudit(env, "jobs.cancel", cancelMatch[1], request, auth));
    return json({ id: cancelMatch[1], status: "cancelled", auditLogged: true }, 200, request);
  }

  if (method === "GET" && path === "/v1/artifacts") {
    await ensureCapabilityAllowedWithDenialMetrics(auth, env, request, "artifact.get");
    const limit = listLimitFromUrl(url);
    if (mode === "live") {
      const live = requireLiveBindings(env, ["DB"]);
      return json({ artifacts: await listArtifacts(live.DB, auth, env, limit), providerMode: mode }, 200, request);
    }
    return json({ artifacts: [] }, 200, request);
  }

  const artifactMatch = /^\/v1\/artifacts\/([^/]+)$/.exec(path);
  if (method === "GET" && artifactMatch?.[1]) {
    await ensureCapabilityAllowedWithDenialMetrics(auth, env, request, "artifact.get");
    if (mode === "live") {
      const live = requireLiveBindings(env, ["DB"]);
      const artifact = await getArtifact(live.DB, decodeURIComponent(artifactMatch[1]), auth, env);
      return json(artifact ?? { id: artifactMatch[1], status: "not_found", providerMode: mode }, 200, request);
    }
    return json({ id: artifactMatch[1], status: "not_found", providerMode: mode }, 200, request);
  }

  if (method === "DELETE" && artifactMatch?.[1]) {
    await ensureCapabilityAllowedWithDenialMetrics(auth, env, request, "artifact.get");
    const id = decodeURIComponent(artifactMatch[1]);
    if (mode === "live") {
      const live = requireLiveBindings(env, ["DB", "ARTIFACTS"]);
      const result = await deleteArtifact(live.DB, live.ARTIFACTS, id, request, auth);
      if (result.status === "deleted") {
        await recordAudit(env, "artifacts.delete", id, request, auth);
      }
      return json(result, result.status === "deleted" ? 200 : 404, request);
    }
    ctx.waitUntil(recordAudit(env, "artifacts.delete", id, request, auth));
    return json({ id, status: "contract_only", auditLogged: true, providerMode: mode }, 200, request);
  }

  const artifactDownloadMatch = /^\/v1\/artifacts\/([^/]+)\/download$/.exec(path);
  if (method === "GET" && artifactDownloadMatch?.[1]) {
    await ensureCapabilityAllowedWithDenialMetrics(auth, env, request, "artifact.get");
    if (mode === "live") {
      const live = requireLiveBindings(env, ["DB", "ARTIFACTS"]);
      return downloadArtifact(live.DB, live.ARTIFACTS, decodeURIComponent(artifactDownloadMatch[1]), request, auth);
    }
    return new Response("No artifact bytes exist in contract mode.\n", {
      status: 404,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        ...corsHeaders(request)
      }
    });
  }

  if (method === "POST" && path === "/v1/artifacts") {
    await ensureCapabilityScopeAllowedWithDenialMetrics(auth, env, request, "artifact.create");
    if (mode === "live") {
      const live = requireLiveBindings(env, ["DB", "ARTIFACTS"]);
      const plan = activePlanForAuth(auth, env);
      const retention = await readRetentionPolicy(live.DB, auth, env);
      const artifact = await storeUploadedArtifact(request, live.DB, live.ARTIFACTS, auth, Number(retention.artifactsDays ?? plan.limits.artifactRetentionDays), plan);
      await recordAudit(env, "artifacts.create", artifact.id, request, auth);
      return json({ ...artifact, status: "stored", auditLogged: true, providerMode: mode }, 201, request);
    }
    ctx.waitUntil(recordAudit(env, "artifacts.create", "upload", request, auth));
    return json({
      id: `art_${crypto.randomUUID()}`,
      status: "contract_only",
      auditLogged: true,
      providerMode: mode
    }, 201, request);
  }

  if (method === "GET" && path === "/v1/usage") {
    await ensureCapabilityAllowedWithDenialMetrics(auth, env, request, "usage.read");
    const surface = requestSurface(url, env, auth);
    if (surface.operator && !canReadInternalLaunchMetadata(env, auth)) {
      throw new HostedError(403, "auth.operator_scope_denied", "Operator vc-tools usage metadata requires an operator-scoped account.");
    }
    if (mode === "live") {
      const live = requireLiveBindings(env, ["DB"]);
      return json(await usageSnapshot(live.DB, env, auth, surface), 200, request);
    }
    return json(contractUsage(env, auth, surface), 200, request);
  }

  if (method === "GET" && path === "/v1/grants") {
    const plan = activePlanForAuth(auth, env);
    return json({
      grants: grantsForPlan(plan),
      providerMode: mode
    }, 200, request);
  }

  if (method === "GET" && path === "/v1/retention") {
    if (mode === "live") {
      const live = requireLiveBindings(env, ["DB"]);
      return json(await readRetentionPolicy(live.DB, auth, env), 200, request);
    }
    return json({ logsDays: 30, artifactsDays: activePlanForAuth(auth, env).limits.artifactRetentionDays, recordings: "off", providerMode: mode }, 200, request);
  }

  if (method === "PATCH" && path === "/v1/retention") {
    const body = await readJsonObject(request, 4096);
    const policy = normalizeRetentionPatch(body, activePlanForAuth(auth, env));
    if (mode === "live") {
      const live = requireLiveBindings(env, ["DB"]);
      await live.DB.prepare(
        "INSERT INTO retention_policies (scope, logs_days, artifacts_days, recordings, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(scope) DO UPDATE SET logs_days = excluded.logs_days, artifacts_days = excluded.artifacts_days, recordings = excluded.recordings, updated_at = excluded.updated_at"
      ).bind(actorRetentionScope(auth), policy.logsDays, policy.artifactsDays, policy.recordings, nowIso()).run();
      await recordAudit(env, "retention.update", "policy", request, auth);
      return json({ ...policy, auditLogged: true, providerMode: mode }, 200, request);
    }
    ctx.waitUntil(recordAudit(env, "retention.update", "policy", request, auth));
    return json({ ...policy, auditLogged: true }, 200, request);
  }

  return json({ code: "route.not_found", message: "No vc-tools route matched this request." }, 404, request);
}

async function authenticate(request: Request, env: HostedEnv): Promise<AuthResult> {
  const expected = env.VC_TOOLS_TOKEN_SHA256;
  const grantSecret = env.VC_TOOLS_CLI_GRANT_SECRET;
  const grantPublicJwks = env.VC_TOOLS_CLI_GRANT_PUBLIC_JWKS;
  if (!expected && !grantPublicJwks && !(grantSecret && isLegacyHmacGrantEnabled(env))) {
    return { ok: false, status: 503, code: "auth.not_configured", message: "Hosted vc-tools auth is not configured." };
  }
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!token) {
    return { ok: false, status: 401, code: "auth.missing", message: "Bearer token required." };
  }

  if (expected) {
    const actual = await sha256(token);
    if (timingSafeEqualHex(actual, expected)) {
      return {
        ok: true,
        actorId: sanitizeActorId(env.VC_TOOLS_STATIC_TOKEN_ACTOR_ID ?? `static_${actual.slice(0, 16)}`),
        tokenKind: "static",
        planName: activePlan(env).name,
        scopes: [VC_TOOLS_GRANT_SCOPE, ...CAPABILITIES]
      };
    }
  }

  if (grantPublicJwks || (grantSecret && isLegacyHmacGrantEnabled(env))) {
    const grant = await verifyCliGrant(token, env);
    if (grant.ok) {
      return grant;
    }
  }

  return { ok: false, status: 403, code: "auth.denied", message: "Bearer token is not authorized." };
}

async function verifyCliGrant(token: string, env: HostedEnv): Promise<AuthResult> {
  const hasPublicKeys = Boolean(env.VC_TOOLS_CLI_GRANT_PUBLIC_JWKS?.trim());
  const hasLegacyHmac = Boolean(env.VC_TOOLS_CLI_GRANT_SECRET?.trim()) && isLegacyHmacGrantEnabled(env);
  if (!hasPublicKeys && !hasLegacyHmac) {
    return { ok: false, status: 503, code: "auth.not_configured", message: "Hosted vc-tools grant auth is not configured." };
  }
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return { ok: false, status: 403, code: "auth.denied", message: "Bearer token is not authorized." };
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
  const header = parseBase64UrlJson(encodedHeader) as CliGrantHeader | undefined;
  const payload = parseBase64UrlJson(encodedPayload);
  if (!isRecord(header) || !isRecord(payload) || (header.alg !== "ES256" && header.alg !== "HS256")) {
    return { ok: false, status: 403, code: "auth.denied", message: "Bearer token is not authorized." };
  }

  const actualSignature = base64UrlToBytes(encodedSignature);
  let signatureOk = false;
  try {
    signatureOk = header.alg === "ES256"
      ? await verifyCliGrantEs256Signature(env, header, `${encodedHeader}.${encodedPayload}`, actualSignature)
      : hasLegacyHmac && timingSafeEqualBytes(
          actualSignature,
          await hmacSha256(`${encodedHeader}.${encodedPayload}`, env.VC_TOOLS_CLI_GRANT_SECRET ?? "")
        );
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) {
    return { ok: false, status: 403, code: "auth.denied", message: "Bearer token is not authorized." };
  }

  const now = Math.floor(Date.now() / 1000);
  const issuer = typeof payload.iss === "string" ? payload.iss : "";
  const audience = typeof payload.aud === "string" ? payload.aud : "";
  const subject = typeof payload.sub === "string" ? payload.sub : "";
  const expiresAt = typeof payload.exp === "number" ? payload.exp : 0;
  const notBefore = typeof payload.nbf === "number" ? payload.nbf : undefined;
  const jti = typeof payload.jti === "string" ? payload.jti : "";
  const grantProfile = typeof payload.grant_profile === "string" ? payload.grant_profile : "";
  const kind = typeof payload.kind === "string" ? payload.kind : "";
  const scopes = scopesFromClaim(payload.scp ?? payload.scope);
  if (issuer !== (env.VC_TOOLS_CLI_GRANT_ISSUER ?? DEFAULT_GRANT_ISSUER)) {
    return { ok: false, status: 403, code: "auth.denied", message: "Bearer token issuer is not authorized." };
  }
  if (audience !== (env.VC_TOOLS_CLI_GRANT_AUDIENCE ?? DEFAULT_GRANT_AUDIENCE)) {
    return { ok: false, status: 403, code: "auth.denied", message: "Bearer token audience is not authorized." };
  }
  if (!subject || expiresAt <= now || (notBefore !== undefined && notBefore > now)) {
    return { ok: false, status: 403, code: "auth.denied", message: "Bearer token is expired or not yet valid." };
  }
  if (!jti || isCliGrantJtiRevoked(env, jti)) {
    return { ok: false, status: 403, code: "auth.denied", message: "Bearer token is not authorized." };
  }
  if (grantProfile !== "vc_tools") {
    return { ok: false, status: 403, code: "auth.denied", message: "Bearer token grant profile is not authorized." };
  }
  if (kind !== "vibecodr_cli" || !scopes.includes(VC_TOOLS_GRANT_SCOPE)) {
    return { ok: false, status: 403, code: "auth.denied", message: "Bearer token lacks the vc-tools grant scope." };
  }

  return {
    ok: true,
    actorId: sanitizeActorId(subject),
    tokenKind: "cli_grant",
    planName: normalizePlanName(typeof payload.plan === "string" ? payload.plan : "Free"),
    scopes,
    subject,
    email: typeof payload.email === "string" ? payload.email : undefined,
    workspaceId: typeof payload.workspace_id === "string" ? payload.workspace_id : typeof payload.workspaceId === "string" ? payload.workspaceId : undefined
  };
}

function scopesFromClaim(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((scope): scope is string => typeof scope === "string");
  }
  if (typeof value === "string") {
    return value.split(/\s+/).filter(Boolean);
  }
  return [];
}

function canReadOperatorDashboard(auth: AuthContext): boolean {
  return OPERATOR_DASHBOARD_SCOPES.some((scope) => auth.scopes.includes(scope));
}

function canReadInternalLaunchMetadata(env: HostedEnv, auth?: AuthContext): boolean {
  if (!auth) {
    return false;
  }
  if (canReadOperatorDashboard(auth)) {
    return true;
  }
  const allowedActorIds = parseInternalMetadataActorIds(env);
  return [auth.actorId, auth.subject, auth.workspaceId]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .some((value) => allowedActorIds.has(sanitizeActorId(value)));
}

function parseInternalMetadataActorIds(env: HostedEnv): Set<string> {
  return new Set(
    (env.VC_TOOLS_INTERNAL_METADATA_ACTOR_IDS ?? "")
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => sanitizeActorId(value))
  );
}

async function optionalAuthContext(request: Request, env: HostedEnv, ctx: ExecutionContext): Promise<AuthContext | undefined> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!token) {
    return undefined;
  }
  const auth = await authenticate(request, env);
  if (auth.ok) {
    return auth;
  }
  recordAuthFailureMetric(env, ctx, request, auth);
  return undefined;
}

function isLegacyHmacGrantEnabled(env: HostedEnv): boolean {
  return env.VC_TOOLS_CLI_GRANT_LEGACY_HMAC_ENABLED === "true";
}

function publicJwksFromEnv(env: HostedEnv): CliGrantPublicJwk[] {
  const raw = env.VC_TOOLS_CLI_GRANT_PUBLIC_JWKS?.trim();
  if (!raw) {
    return [];
  }
  const parsed = parseBase64SafeJson(raw);
  if (!isRecord(parsed)) {
    return [];
  }
  const keys = Array.isArray(parsed.keys) ? parsed.keys : [parsed];
  return keys.filter(isRecord).flatMap((key) => {
    if (
      key.kty !== "EC" ||
      key.crv !== "P-256" ||
      typeof key.x !== "string" ||
      typeof key.y !== "string" ||
      typeof key.kid !== "string" ||
      !key.kid.trim()
    ) {
      return [];
    }
    return [{
      ...key,
      kty: "EC",
      crv: "P-256",
      x: key.x,
      y: key.y,
      kid: key.kid.trim()
    }];
  });
}

function parseBase64SafeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

async function verifyCliGrantEs256Signature(
  env: HostedEnv,
  header: CliGrantHeader,
  signingInput: string,
  signature: Uint8Array
): Promise<boolean> {
  if (!header.kid) {
    return false;
  }
  const publicJwk = publicJwksFromEnv(env).find((key) => key.kid === header.kid);
  if (!publicJwk) {
    return false;
  }
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      publicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature as unknown as BufferSource,
      new TextEncoder().encode(signingInput)
    );
  } catch {
    return false;
  }
}

function isCliGrantJtiRevoked(env: HostedEnv, jti: string): boolean {
  const raw = env.VC_TOOLS_CLI_GRANT_REVOKED_JTIS?.trim();
  if (!raw) {
    return false;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.includes(jti);
    }
  } catch {
    // Fall through to comma-separated parsing for emergency operator deny lists.
  }
  return raw.split(",").map((value) => value.trim()).filter(Boolean).includes(jti);
}

function parseBase64UrlJson(value: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as unknown;
  } catch {
    return undefined;
  }
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function hmacSha256(value: string, secret: string): Promise<Uint8Array> {
  const secretBytes = decodeCliGrantSecret(secret);
  const keyData = secretBytes as unknown as BufferSource;
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

async function signInternalAlertHeaders(
  secret: string,
  input: { method: string; url: string; body: string }
): Promise<Record<string, string>> {
  const timestampSeconds = Math.floor(Date.now() / 1000);
  const url = new URL(input.url);
  const nonce = crypto.randomUUID();
  const bodySha256 = await sha256Base64Url(input.body);
  const payload = [
    "v2",
    input.method.trim().toUpperCase(),
    `${url.pathname}${url.search}`,
    String(timestampSeconds),
    nonce,
    "",
    bodySha256
  ].join("\n");
  const signature = bytesToBase64Url(await hmacSha256(payload, secret));
  return {
    [INTERNAL_TIMESTAMP_HEADER]: String(timestampSeconds),
    [INTERNAL_SIGNATURE_HEADER]: `v2=${signature};nonce=${encodeURIComponent(nonce)};actor=;body=${encodeURIComponent(bodySha256)}`,
    [INTERNAL_NONCE_HEADER]: nonce,
    [INTERNAL_BODY_SHA256_HEADER]: bodySha256
  };
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeCliGrantSecret(secret: string): Uint8Array {
  const trimmed = secret.trim();
  const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/").replace(/=/g, "");
  if (/^[A-Za-z0-9+/]+$/.test(normalized)) {
    try {
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      if (bytes.byteLength === 32) {
        return bytes;
      }
    } catch {
      // Fall through to raw UTF-8 for local test secrets.
    }
  }
  return new TextEncoder().encode(secret);
}

async function dashboardResponse(path: string, env: HostedEnv, request: Request, auth: AuthContext): Promise<Response> {
  const section = path.split("/").filter(Boolean)[1] ?? "overview";
  const operatorSection = OPERATOR_DASHBOARD_SECTIONS.find((item) => item.id === section);
  if (operatorSection && !canReadOperatorDashboard(auth)) {
    return json({ code: "auth.operator_scope_denied", message: "This vc-tools dashboard section is operator-only." }, 403, request);
  }
  return new Response(await renderDashboard(section, env, auth), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(request)
    }
  });
}

async function mcpResponse(request: Request, env: HostedEnv, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "GET") {
    return json({
      name: "vc-tools",
      transport: "streamable_http",
      protocolVersion: MCP_PROTOCOL_VERSION,
      tools: MCP_TOOL_DESCRIPTORS,
      providerMode: providerMode(env)
    }, 200, request);
  }
  if (request.method === "POST") {
    const auth = await authenticate(request, env);
    if (!auth.ok) {
      recordAuthFailureMetric(env, ctx, request, auth);
      return json({ code: auth.code, message: auth.message }, auth.status, request);
    }
    const body = await readJsonObject(request, MAX_JSON_BODY_BYTES);
    return json(await handleMcpJsonRpc(body, env, request, ctx, auth), 200, request);
  }
  return json({ code: "method.not_allowed", message: "MCP endpoint supports GET and POST." }, 405, request);
}

async function readJsonObject(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new HostedError(413, "input.body_too_large", "Request body is larger than this vc-tools route accepts.");
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    throw new HostedError(413, "input.body_too_large", "Request body is larger than this vc-tools route accepts.");
  }
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) as unknown : {};
  } catch {
    throw new HostedError(400, "input.invalid_json", "Request body must be a JSON object.");
  }
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function json(body: unknown, status: number, request: Request): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...corsHeaders(request)
    }
  });
}

function jsonRpcId(value: unknown): string | number | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

async function handleMcpJsonRpc(body: Record<string, unknown>, env: HostedEnv, request: Request, ctx: ExecutionContext, auth: AuthContext): Promise<unknown> {
  const id = jsonRpcId(body.id);
  const method = typeof body.method === "string" ? body.method : "";

  if (!method && id === null) {
    return { jsonrpc: "2.0", error: { code: -32600, message: "Invalid JSON-RPC request." }, id: null };
  }

  if (method === "notifications/initialized") {
    return { jsonrpc: "2.0", result: { ok: true }, id };
  }

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: protocolVersionFrom(body),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "vc-tools", version: VC_TOOLS_VERSION },
        instructions: "Use vc-tools as the user's hosted Vibecodr Agent Computer. Prefer browser.*, computer.*, work.*, proof.*, and usage.status tools. The service enforces strict public-web, quota, artifact, and hosted-execution boundaries; do not ask the user to configure provider credentials or local sandbox settings unless a tool explicitly requests approval."
      }
    };
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (method === "tools/list") {
    const plan = activePlanForAuth(auth, env);
    return { jsonrpc: "2.0", id, result: { tools: MCP_TOOL_DESCRIPTORS.map((tool) => ({ ...tool, granted: capabilityAllowedForPlan(tool.capability, plan) })) } };
  }

  if (method === "tools/call") {
    const params = isRecord(body.params) ? body.params : {};
    const name = typeof params.name === "string" ? params.name : "";
    const capability = capabilityFromToolName(name);
    if (!capability) {
      return { jsonrpc: "2.0", id, error: { code: -32602, message: "Unsupported vc-tools capability." } };
    }
    const args = isRecord(params.arguments) ? params.arguments : {};
    try {
      if (READ_ONLY_CAPABILITIES.has(capability)) {
        await ensureCapabilityAllowedWithDenialMetrics(auth, env, request, capability);
        const result = await readOnlyToolResult(capability, env, auth);
        ctx.waitUntil(recordAudit(env, "mcp.tools.call", capability, request, auth));
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            isError: false
          }
        };
      }
      const input = await normalizeHostedToolInputWithDenialMetrics(capability, args, env, request, auth);
      await ensureCapabilityAllowedWithDenialMetrics(auth, env, request, capability);
      const accepted = providerMode(env) === "live"
        ? await acceptLiveToolCall(capability, input, env, request, auth)
        : acceptedToolCall(capability, env);
      if (providerMode(env) !== "live") {
        ctx.waitUntil(recordAudit(env, "mcp.tools.call", capability, request, auth));
      }
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(accepted, null, 2) }],
          isError: false
        }
      };
    } catch (error) {
      const hostedError = error instanceof HostedError
        ? error
        : new HostedError(500, "server.error", "Unexpected vc-tools MCP tool failure.");
      return { jsonrpc: "2.0", id, error: { code: -32602, message: hostedError.message, data: { code: hostedError.code } } };
    }
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unsupported MCP method: ${method || "missing"}` } };
}

async function readOnlyToolResult(capability: CapabilityName, env: HostedEnv, auth: AuthContext): Promise<Record<string, unknown>> {
  if (capability === "usage.read") {
    const usage = providerMode(env) === "live" && env.DB
      ? await usageSnapshot(env.DB, env, auth)
      : contractUsage(env, auth);
    return {
      capability,
      alias: "limits.read",
      status: "ok",
      quotaChecked: true,
      costBearing: false,
      usage,
      providerMode: providerMode(env)
    };
  }
  throw new HostedError(400, "input.unknown_capability", "Unsupported read-only vc-tools capability.");
}

function acceptedToolCall(capability: CapabilityName, env: HostedEnv): Record<string, unknown> {
  const mode = providerMode(env);
  return {
    id: `job_${crypto.randomUUID()}`,
    status: mode === "live" ? "queued" : "contract_only",
    capability,
    quotaChecked: true,
    auditLogged: true,
    providerMode: mode,
    message: mode === "live"
      ? "Accepted for live hosted execution."
      : "Accepted by contract service; no Browser Run or Sandbox cost was spent."
  };
}

async function enqueueLiveToolJob(
  live: RequiredLiveBindings,
  capability: CapabilityName,
  input: NormalizedToolInput,
  env: HostedEnv,
  request: Request,
  auth: AuthContext,
  auditPrefix: "tools" | "scheduled_qa"
): Promise<{ jobId: string; queue: QueueFairnessState; retentionDays: number; enqueuedAt: string; reservedCredits: number; reservedBrowserSeconds: number; reservedSandboxSeconds: number }> {
  const plan = activePlanForAuth(auth, env);
  let queuedInput = input;
  if (input.kind === "browser") {
    try {
      await assertBrowserNetworkTarget(input.url);
    } catch (error) {
      await recordHostedDenialMetricIfNeeded(env, request, auth, capability, error);
      throw error;
    }
  }
  await ensureCostBearingCapabilityEnabled(env, request, auth, capability);

  const jobId = `job_${crypto.randomUUID()}`;
  const reservedCredits = isCostBearingCapability(capability) ? 1 : 0;
  const reservedBrowserSeconds = queuedInput.kind === "browser" ? Math.ceil(queuedInput.timeoutMs / 1000) : 0;
  const reservedSandboxSeconds = queuedInput.kind === "sandbox" ? Math.ceil(queuedInput.timeoutMs / 1000) : 0;
  const retention = await readRetentionPolicy(live.DB, auth, env);
  const retentionDays = Number(retention.artifactsDays ?? plan.limits.artifactRetentionDays);
  try {
    await enforceQuota(live.DB, auth, env, capability, queuedInput);
  } catch (error) {
    await recordHostedDenialMetricIfNeeded(env, request, auth, capability, error);
    throw error;
  }
  await recordAudit(env, `${auditPrefix}.accept_requested`, capability, request, auth, jobId);
  const enqueuedAt = nowIso();
  const queue = await readQueueFairnessState(live.DB, auth.actorId, {
    spreadDelay: shouldSpreadQueuedJob(auditPrefix, capability)
  });
  const inserted = await insertQueuedJobWithQuotaReservation(live.DB, {
    id: jobId,
    actorId: auth.actorId,
    planName: plan.name,
    capability,
    input: queuedInput,
    createdAt: enqueuedAt,
    updatedAt: enqueuedAt,
    reservedCredits,
    reservedBrowserSeconds,
    reservedSandboxSeconds,
    queue
  }, plan);
  if (!inserted) {
    await enforceQuota(live.DB, auth, env, capability, queuedInput);
    await recordAudit(env, `${auditPrefix}.reservation_failed`, capability, request, auth, jobId);
    const conflict = new HostedError(429, "quota.reservation_conflict", "Another hosted run claimed capacity at the same moment. Retry this command in a few seconds, or wait for current work to finish.");
    await recordHostedDenialMetricIfNeeded(env, request, auth, capability, conflict);
    throw conflict;
  }
  await recordAudit(env, `${auditPrefix}.accepted`, capability, request, auth, jobId);
  const queuedJob = {
    id: jobId,
    capability,
    input: queuedInput,
    enqueuedAt,
    actorId: auth.actorId,
    planName: plan.name,
    retentionDays,
    reservedCredits,
    reservedBrowserSeconds,
    reservedSandboxSeconds,
    fairDelaySeconds: queue.fairDelaySeconds
  };
  if (capability === "browser.agent_task") {
    await live.BROWSER_AGENT_WORKFLOW.create({
      id: jobId,
      params: queuedJob,
      retention: workflowRetentionPolicy(retentionDays)
    });
    await recordAudit(env, `${auditPrefix}.workflow_started`, capability, request, auth, jobId);
  } else {
    await live.JOB_QUEUE.send(queuedJob, queueSendOptions(queue));
  }

  return { jobId, queue, retentionDays, enqueuedAt, reservedCredits, reservedBrowserSeconds, reservedSandboxSeconds };
}

async function acceptLiveToolCall(capability: CapabilityName, input: NormalizedToolInput, env: HostedEnv, request: Request, auth: AuthContext): Promise<Record<string, unknown>> {
  const live = requireLiveBindings(env, requiredBindingsForCapability(capability));
  const accepted = await enqueueLiveToolJob(live, capability, input, env, request, auth, "tools");

  return {
    id: accepted.jobId,
    status: "queued",
    capability,
    quotaChecked: true,
    auditLogged: true,
    queue: accepted.queue,
    providerMode: "live",
    message: "Accepted for live hosted execution."
  };
}

function ensureScheduledQaIncluded(plan: Plan): void {
  if (plan.limits.scheduledQa.maxRunsPerMonth <= 0 || plan.limits.scheduledQa.minIntervalMinutes <= 0) {
    throw new HostedError(403, "quota.plan_denied", "Scheduled QA is not enabled for the active vc-tools plan.");
  }
}

function isScheduledQaCapability(value: string): value is ScheduledQaCapability {
  return SCHEDULED_QA_CAPABILITIES.has(value as ScheduledQaCapability);
}

function normalizeScheduledQaCapability(value: unknown): ScheduledQaCapability {
  const raw = typeof value === "string" && value.trim() ? value.trim() : "browser.render_url";
  const aliased = ({
    "browser.render": "browser.render_url",
    "browser.render_url": "browser.render_url",
    "browser.screenshot": "browser.screenshot_url",
    "browser.screenshot_url": "browser.screenshot_url",
    "browser.markdown": "browser.extract_markdown",
    "browser.extract_markdown": "browser.extract_markdown",
    "browser.pdf": "browser.render_pdf",
    "browser.render_pdf": "browser.render_pdf"
  } as const)[raw];
  if (!aliased || !isScheduledQaCapability(aliased)) {
    throw new HostedError(400, "input.unsupported_scheduled_qa_capability", "Scheduled QA supports only browser render, screenshot, markdown, and PDF Quick Actions.");
  }
  return aliased;
}

function normalizeScheduledQaLabel(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const label = String(value).trim();
  if (!label) {
    return null;
  }
  return label.slice(0, 120);
}

function normalizeScheduledQaCreate(body: Record<string, unknown>, plan: Plan): ScheduledQaCreateConfig {
  const capability = normalizeScheduledQaCapability(body.capability);
  const rawInput = isRecord(body.input) ? body.input : body;
  const input = normalizeHostedToolInput(capability, rawInput);
  if (input.kind !== "browser") {
    throw new HostedError(400, "input.invalid_scheduled_qa", "Scheduled QA requires a browser Quick Action input.");
  }
  const intervalMinutes = numberInRange(
    body.intervalMinutes,
    plan.limits.scheduledQa.minIntervalMinutes,
    MAX_SCHEDULED_QA_INTERVAL_MINUTES,
    plan.limits.scheduledQa.minIntervalMinutes,
    "intervalMinutes"
  );
  const runNow = body.runNow === true;
  return {
    label: normalizeScheduledQaLabel(body.label),
    capability,
    input,
    intervalMinutes,
    enabled: body.enabled === false ? false : true,
    nextRunAt: runNow ? nowIso() : addMinutesIso(nowIso(), intervalMinutes),
    runNow
  };
}

function normalizeScheduledQaPatch(body: Record<string, unknown>, plan: Plan): Partial<ScheduledQaCreateConfig> {
  const patch: Partial<ScheduledQaCreateConfig> = {};
  if (Object.prototype.hasOwnProperty.call(body, "label")) {
    patch.label = normalizeScheduledQaLabel(body.label);
  }
  if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
    patch.enabled = body.enabled === true;
  }
  if (Object.prototype.hasOwnProperty.call(body, "capability") || Object.prototype.hasOwnProperty.call(body, "url") || Object.prototype.hasOwnProperty.call(body, "input") || Object.prototype.hasOwnProperty.call(body, "timeoutMs")) {
    const capability = normalizeScheduledQaCapability(body.capability);
    const rawInput = isRecord(body.input) ? body.input : body;
    const input = normalizeHostedToolInput(capability, rawInput);
    if (input.kind !== "browser") {
      throw new HostedError(400, "input.invalid_scheduled_qa", "Scheduled QA requires a browser Quick Action input.");
    }
    patch.capability = capability;
    patch.input = input;
  }
  if (Object.prototype.hasOwnProperty.call(body, "intervalMinutes")) {
    patch.intervalMinutes = numberInRange(
      body.intervalMinutes,
      plan.limits.scheduledQa.minIntervalMinutes,
      MAX_SCHEDULED_QA_INTERVAL_MINUTES,
      plan.limits.scheduledQa.minIntervalMinutes,
      "intervalMinutes"
    );
  }
  if (body.runNow === true) {
    patch.nextRunAt = nowIso();
    patch.runNow = true;
  } else if (patch.intervalMinutes !== undefined) {
    patch.nextRunAt = addMinutesIso(nowIso(), patch.intervalMinutes);
  }
  return patch;
}

function scheduledQaCapabilityFromRow(row: ScheduledQaConfigRow): ScheduledQaCapability {
  if (!isScheduledQaCapability(row.capability)) {
    throw new HostedError(500, "scheduled_qa.invalid_config", "Scheduled QA config contains an invalid browser capability.");
  }
  return row.capability;
}

async function createScheduledQaConfig(
  db: D1Database,
  auth: AuthContext,
  config: ScheduledQaCreateConfig,
  plan: Plan
): Promise<{ config: Record<string, unknown>; row: ScheduledQaConfigRow }> {
  const id = `sqa_${crypto.randomUUID()}`;
  const createdAt = nowIso();
  const fallbackRow: ScheduledQaConfigRow = {
    id,
    actor_id: auth.actorId,
    plan_name: plan.name,
    label: config.label,
    capability: config.capability,
    input_json: JSON.stringify(config.input),
    interval_minutes: config.intervalMinutes,
    enabled: config.enabled ? 1 : 0,
    next_run_at: config.nextRunAt,
    last_run_at: null,
    last_job_id: null,
    last_error_code: null,
    last_error_message: null,
    created_at: createdAt,
    updated_at: createdAt
  };
  await db.prepare(
    `INSERT INTO scheduled_qa_configs (
      id,
      actor_id,
      plan_name,
      label,
      capability,
      input_json,
      interval_minutes,
      enabled,
      next_run_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    auth.actorId,
    plan.name,
    config.label,
    config.capability,
    JSON.stringify(config.input),
    config.intervalMinutes,
    config.enabled ? 1 : 0,
    config.nextRunAt,
    createdAt,
    createdAt
  ).run();
  const row = await getScheduledQaConfigRow(db, auth, id) ?? fallbackRow;
  return { row, config: scheduledQaConfigResponse(row) };
}

async function updateScheduledQaConfig(db: D1Database, auth: AuthContext, id: string, patch: Partial<ScheduledQaCreateConfig>): Promise<Record<string, unknown> | null> {
  const current = await getScheduledQaConfigRow(db, auth, id);
  if (!current) {
    return null;
  }
  const existingInput = scheduledQaInputFromRow(current);
  const updatedInput = patch.input ?? existingInput;
  const updatedCapability = patch.capability ?? (isScheduledQaCapability(current.capability) ? current.capability : "browser.render_url");
  const updatedInterval = patch.intervalMinutes ?? Number(current.interval_minutes);
  const nextRunAt = patch.nextRunAt ?? (patch.intervalMinutes === undefined ? current.next_run_at : addMinutesIso(nowIso(), updatedInterval));
  const updatedLabel = Object.prototype.hasOwnProperty.call(patch, "label") ? patch.label ?? null : current.label;
  await db.prepare(
    `UPDATE scheduled_qa_configs
    SET label = ?,
      capability = ?,
      input_json = ?,
      interval_minutes = ?,
      enabled = ?,
      next_run_at = ?,
      last_error_code = NULL,
      last_error_message = NULL,
      updated_at = ?
    WHERE id = ? AND actor_id = ?`
  ).bind(
    updatedLabel,
    updatedCapability,
    JSON.stringify(updatedInput),
    updatedInterval,
    patch.enabled === undefined ? Number(current.enabled) : patch.enabled ? 1 : 0,
    nextRunAt,
    nowIso(),
    id,
    auth.actorId
  ).run();
  const row = await getScheduledQaConfigRow(db, auth, id);
  return row ? scheduledQaConfigResponse(row) : null;
}

async function enqueueUpdatedScheduledQaNow(
  live: RequiredLiveBindings,
  env: HostedEnv,
  auth: AuthContext,
  id: string,
  fallbackConfig: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const row = await getScheduledQaConfigRow(live.DB, auth, id);
  if (!row || Number(row.enabled) !== 1) {
    return fallbackConfig;
  }
  await enqueueScheduledQaConfig(live, env, row, nowIso());
  return refetchScheduledQaConfig(live.DB, auth, id, fallbackConfig);
}

async function deleteScheduledQaConfig(db: D1Database, auth: AuthContext, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM scheduled_qa_configs WHERE id = ? AND actor_id = ?")
    .bind(id, auth.actorId)
    .run();
  return d1ChangedRows(result) > 0;
}

async function listScheduledQa(db: D1Database, auth: AuthContext): Promise<Record<string, unknown>> {
  const rows = await db.prepare(
    "SELECT * FROM scheduled_qa_configs WHERE actor_id = ? ORDER BY created_at DESC LIMIT 100"
  ).bind(auth.actorId).all<ScheduledQaConfigRow>();
  return {
    configs: (rows.results ?? []).map(scheduledQaConfigResponse),
    providerMode: "live"
  };
}

async function getScheduledQaConfigRow(db: D1Database, auth: AuthContext, id: string): Promise<ScheduledQaConfigRow | null> {
  return db.prepare("SELECT * FROM scheduled_qa_configs WHERE id = ? AND actor_id = ?")
    .bind(id, auth.actorId)
    .first<ScheduledQaConfigRow>();
}

async function refetchScheduledQaConfig(
  db: D1Database,
  auth: AuthContext,
  id: string,
  fallbackConfig: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const row = await getScheduledQaConfigRow(db, auth, id);
  return row ? scheduledQaConfigResponse(row) : fallbackConfig;
}

function scheduledQaConfigResponse(row: ScheduledQaConfigRow): Record<string, unknown> {
  return {
    id: row.id,
    label: row.label,
    capability: row.capability,
    input: scheduledQaInputFromRow(row),
    intervalMinutes: Number(row.interval_minutes),
    enabled: Number(row.enabled) === 1,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastJobId: row.last_job_id,
    lastError: row.last_error_code ? { code: row.last_error_code, message: row.last_error_message } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function scheduledQaInputFromRow(row: ScheduledQaConfigRow): BrowserToolInput {
  const parsed = safeJson(row.input_json);
  if (isRecord(parsed) && parsed.kind === "browser" && typeof parsed.url === "string" && typeof parsed.timeoutMs === "number") {
    return parsed as unknown as BrowserToolInput;
  }
  throw new HostedError(500, "scheduled_qa.invalid_config", "Scheduled QA config contains invalid browser input.");
}

async function enqueueDueScheduledQa(env: HostedEnv, scheduledTime: number | undefined): Promise<void> {
  if (providerMode(env) !== "live") {
    return;
  }
  const live = requireLiveBindings(env, ["DB", "ARTIFACTS", "JOB_QUEUE", "BROWSER"]);
  const now = scheduledTime && Number.isFinite(scheduledTime) ? new Date(scheduledTime).toISOString() : nowIso();
  const due = await live.DB.prepare(
    "SELECT * FROM scheduled_qa_configs WHERE enabled = 1 AND next_run_at <= ? ORDER BY next_run_at ASC LIMIT ?"
  ).bind(now, scheduledQaMaxEnqueuesPerTick(env)).all<ScheduledQaConfigRow>();
  for (const row of due.results ?? []) {
    await enqueueScheduledQaConfig(live, env, row, now);
  }
}

async function enqueueScheduledQaConfig(live: RequiredLiveBindings, env: HostedEnv, row: ScheduledQaConfigRow, scheduledAt: string): Promise<void> {
  const request = syntheticRequest(row.id);
  const auth: AuthContext = {
    ok: true,
    actorId: row.actor_id,
    tokenKind: "cli_grant",
    planName: row.plan_name,
    scopes: [VC_TOOLS_GRANT_SCOPE, "vc-tools:*"]
  };
  const plan = activePlanForAuth(auth, env);
  const nextRunAt = addMinutesIso(scheduledAt, Number(row.interval_minutes));
  try {
    ensureScheduledQaIncluded(plan);
    if (!isScheduledQaCapability(row.capability)) {
      throw new HostedError(400, "input.unsupported_scheduled_qa_capability", "Scheduled QA supports only browser render, screenshot, markdown, and PDF Quick Actions.");
    }
    await enforceScheduledQaMonthlyQuota(live.DB, auth, plan);
    const input = scheduledQaInputFromRow(row);
    const runId = `sqar_${crypto.randomUUID()}`;
    const accepted = await enqueueLiveToolJob(live, row.capability, input, env, request, auth, "scheduled_qa");
    const updatedAt = nowIso();
    await live.DB.prepare(
      `INSERT INTO scheduled_qa_runs (id, config_id, actor_id, job_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', ?, ?)`
    ).bind(runId, row.id, row.actor_id, accepted.jobId, updatedAt, updatedAt).run();
    await live.DB.prepare(
      "UPDATE scheduled_qa_configs SET last_run_at = ?, last_job_id = ?, last_error_code = NULL, last_error_message = NULL, next_run_at = ?, updated_at = ? WHERE id = ?"
    ).bind(updatedAt, accepted.jobId, nextRunAt, updatedAt, row.id).run();
    await recordAudit(env, "scheduled_qa.enqueued", row.id, request, auth, accepted.jobId);
  } catch (error) {
    const hostedError = error instanceof HostedError
      ? error
      : new HostedError(500, "server.error", "Unexpected scheduled QA enqueue failure.");
    const updatedAt = nowIso();
    await live.DB.prepare(
      "UPDATE scheduled_qa_configs SET last_error_code = ?, last_error_message = ?, next_run_at = ?, updated_at = ? WHERE id = ?"
    ).bind(hostedError.code, sanitizeErrorMessage(hostedError.message), nextRunAt, updatedAt, row.id).run();
    await live.DB.prepare(
      `INSERT INTO scheduled_qa_runs (id, config_id, actor_id, status, error_code, error_message, created_at, updated_at)
      VALUES (?, ?, ?, 'skipped', ?, ?, ?, ?)`
    ).bind(`sqar_${crypto.randomUUID()}`, row.id, row.actor_id, hostedError.code, sanitizeErrorMessage(hostedError.message), updatedAt, updatedAt).run();
    await recordAudit(env, "scheduled_qa.skipped", row.id, request, auth);
  }
}

async function enforceScheduledQaMonthlyQuota(db: D1Database, auth: AuthContext, plan: Plan): Promise<void> {
  const monthStart = startOfMonthIso();
  const row = await db.prepare(
    "SELECT COUNT(1) AS count_value FROM scheduled_qa_runs WHERE actor_id = ? AND status = 'queued' AND created_at >= ?"
  ).bind(auth.actorId, monthStart).first<{ count_value: number }>();
  if (Number(row?.count_value ?? 0) >= plan.limits.scheduledQa.maxRunsPerMonth) {
    throw new HostedError(429, "quota.scheduled_qa_monthly_runs_exceeded", "Monthly scheduled QA run quota has been reached for the active vc-tools plan.");
  }
}

function scheduledQaMaxEnqueuesPerTick(env: HostedEnv): number {
  return integerEnv(
    env.VC_TOOLS_SCHEDULED_QA_MAX_ENQUEUES_PER_TICK,
    DEFAULT_SCHEDULED_QA_MAX_ENQUEUES_PER_TICK,
    1,
    MAX_SCHEDULED_QA_MAX_ENQUEUES_PER_TICK
  );
}

type ToolJobExecutionOwner = "queue" | "workflow";

async function processToolJob(
  job: ToolJobMessage,
  env: HostedEnv,
  ctx: ExecutionContext,
  queueAttempt = 1,
  executionOwner: ToolJobExecutionOwner = "queue"
): Promise<void> {
  const live = requireLiveBindings(env, requiredBindingsForCapability(job.capability));
  if (job.capability === "browser.agent_task" && executionOwner === "queue") {
    await recordAudit(env, "tools.browser_agent.queue_rejected", job.capability, syntheticRequest(job.id), authContextForJob(job), job.id);
    throw new HostedError(500, "workflow.browser_agent_required", "Browser agent tasks must run through the Cloudflare Workflow lane.");
  }
  const current = await live.DB.prepare("SELECT status, actor_id, plan_name FROM jobs WHERE id = ? AND actor_id = ?")
    .bind(job.id, job.actorId)
    .first<{ status: string; actor_id: string; plan_name: string }>();
  if (!current) {
    await recordAudit(env, "tools.skipped_missing_job", job.capability, syntheticRequest(job.id), authContextForJob(job), job.id);
    return;
  }
  if (current.status === "cancel_requested" || current.status === "cancelled") {
    const cancelledAt = nowIso();
    await live.DB.prepare("UPDATE jobs SET status = 'cancelled', canceled_at = COALESCE(canceled_at, ?), completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ? AND actor_id = ?")
      .bind(cancelledAt, cancelledAt, cancelledAt, job.id, job.actorId)
      .run();
    await reconcileSandboxReservation(live.DB, job, 0);
    await recordAudit(env, "tools.skipped_cancelled", job.capability, syntheticRequest(job.id), authContextForJob(job), job.id);
    return;
  }
  if (current.status === "failed") {
    if (executionOwner === "queue" && queueAttempt <= DEFAULT_JOB_QUEUE_MAX_RETRIES) {
      await recordAudit(env, "tools.failed_queue_retry_pending", job.capability, syntheticRequest(job.id), authContextForJob(job), job.id);
      throw new HostedError(500, "queue.failed_retry_pending", "Failed vc-tools job is still within the Cloudflare Queue retry window; DLQ policy will own terminal delivery.");
    }
    await recordAudit(env, executionOwner === "workflow" ? "tools.failed_workflow_retry_exhausted" : "tools.failed_queue_retry_exhausted", job.capability, syntheticRequest(job.id), authContextForJob(job), job.id);
    return;
  }
  if (current.status !== "queued") {
    await recordAudit(env, "tools.skipped_not_queued", job.capability, syntheticRequest(job.id), authContextForJob(job), job.id);
    return;
  }

  const startedAt = nowIso();
  await markJobRunning(live.DB, job, startedAt, env, ctx);
  const running = await live.DB.prepare("SELECT status FROM jobs WHERE id = ? AND actor_id = ?")
    .bind(job.id, job.actorId)
    .first<{ status: string }>();
  if (job.input.kind === "browser" && running?.status === "queued") {
    await recordAudit(env, "tools.browser_account_cap_deferred", job.capability, syntheticRequest(job.id), authContextForJob(job), job.id);
    throw new HostedError(429, "quota.browser_account_concurrency_exceeded", "Account-wide Browser Run concurrency is full; this job will retry from the queue.");
  }
  if (job.input.kind === "sandbox" && running?.status === "queued") {
    await recordAudit(env, "tools.sandbox_account_cap_deferred", job.capability, syntheticRequest(job.id), authContextForJob(job), job.id);
    throw new HostedError(429, "quota.sandbox_account_concurrency_exceeded", "Account-wide Sandbox concurrency is full; this job will retry from the queue.");
  }
  if (running?.status !== "running") {
    await recordAudit(env, "tools.skipped_not_running", job.capability, syntheticRequest(job.id), authContextForJob(job), job.id);
    return;
  }

  try {
    const artifact = await executeToolJob(job, live, env, ctx);
    const completedAt = nowIso();
    const latest = await live.DB.prepare("SELECT status FROM jobs WHERE id = ? AND actor_id = ?")
      .bind(job.id, job.actorId)
      .first<{ status: string }>();
    if (latest?.status === "cancel_requested" || latest?.status === "cancelled") {
      await live.DB.prepare("UPDATE jobs SET status = 'cancelled', canceled_at = COALESCE(canceled_at, ?), completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ? AND actor_id = ?")
        .bind(completedAt, completedAt, completedAt, job.id, job.actorId)
        .run();
      await reconcileSandboxReservation(live.DB, job, elapsedJobSeconds(startedAt, completedAt));
      await recordAudit(env, "tools.completed_after_cancel", job.capability, syntheticRequest(job.id), authContextForJob(job), job.id);
      return;
    }
    const result = {
      artifactId: artifact.id,
      kind: artifact.kind,
      contentType: artifact.contentType,
      bytes: artifact.bytes,
      ...(artifact.metadata ? { metadata: artifact.metadata } : {})
    };
    await live.DB.prepare(
      "UPDATE jobs SET status = 'completed', result_json = ?, completed_at = ?, updated_at = ? WHERE id = ? AND actor_id = ? AND status = 'running'"
    ).bind(JSON.stringify(result), completedAt, completedAt, job.id, job.actorId).run();
    await writeUsage(live.DB, job, artifact, startedAt, completedAt);
    await reconcileSandboxReservation(live.DB, job, elapsedJobSeconds(startedAt, completedAt));
    await recordBrowserAgentClosureIfNeeded(env, job, artifact);
    await recordAudit(env, "tools.completed", job.capability, syntheticRequest(job.id), authContextForJob(job), job.id);
  } catch (error) {
    if (isRetryableProviderError(error)) {
      const deferredAt = nowIso();
      const message = error instanceof Error ? sanitizeErrorMessage(error.message) : "Provider asked vc-tools to retry this job.";
      await live.DB.prepare(
        "UPDATE jobs SET status = 'queued', error_code = ?, error_message = ?, updated_at = ? WHERE id = ? AND actor_id = ? AND status = 'running'"
      ).bind("provider.browser_run_rate_limited", message, deferredAt, job.id, job.actorId).run();
      await recordAudit(env, "tools.provider_retry_deferred", job.capability, syntheticRequest(job.id), authContextForJob(job), job.id);
      throw error;
    }
    const failedAt = nowIso();
    const code = error instanceof HostedError ? error.code : "provider.execution_failed";
    const message = error instanceof Error ? sanitizeErrorMessage(error.message) : "Tool execution failed.";
    await live.DB.prepare(
      "UPDATE jobs SET status = 'failed', error_code = ?, error_message = ?, completed_at = ?, updated_at = ? WHERE id = ? AND actor_id = ? AND status = 'running'"
    ).bind(code, message, failedAt, failedAt, job.id, job.actorId).run();
    await reconcileSandboxReservation(live.DB, job, elapsedJobSeconds(startedAt, failedAt));
    await recordAudit(env, "tools.failed", job.capability, syntheticRequest(job.id), authContextForJob(job), job.id);
    if (executionOwner === "workflow") {
      return;
    }
    throw error;
  }
}

async function markBrowserAgentWorkflowFailed(env: HostedEnv, job: ToolJobMessage, error: unknown): Promise<void> {
  const live = requireLiveBindings(env, ["DB"]);
  const failedAt = nowIso();
  const message = error instanceof Error ? sanitizeErrorMessage(error.message) : "Browser agent Workflow failed.";
  await live.DB.prepare(
    "UPDATE jobs SET status = 'failed', error_code = ?, error_message = ?, completed_at = COALESCE(completed_at, ?), updated_at = ? WHERE id = ? AND actor_id = ? AND status IN ('queued', 'running')"
  ).bind("workflow.browser_agent_failed", message, failedAt, failedAt, job.id, job.actorId).run();
  await reconcileSandboxReservation(live.DB, job, 0);
  await recordAudit(env, "tools.browser_agent.workflow_failed", job.capability, syntheticRequest(job.id), authContextForJob(job), job.id);
}

async function executeToolJob(
  job: ToolJobMessage,
  live: RequiredLiveBindings,
  env: HostedEnv,
  ctx: ExecutionContext
): Promise<StoredArtifactResult> {
  if (job.input.kind === "browser") {
    return executeBrowserJob(job, live, env);
  }
  if (job.input.kind === "sandbox") {
    return executeSandboxJob(job, live, env, ctx);
  }
  const payload = new TextEncoder().encode(JSON.stringify({
    id: job.id,
    capability: job.capability,
    status: "completed",
    input: job.input
  }, null, 2));
  return storeJobArtifact(live, job, "control", "application/json", payload);
}

async function markJobRunning(db: D1Database, job: ToolJobMessage, startedAt: string, env: HostedEnv, ctx: ExecutionContext): Promise<void> {
  if (job.input.kind === "browser") {
    await notifyCapacitySoftCapIfNeeded(db, job, env, ctx, startedAt);
    const hostedLimits = hostedAccountLimits(env);
    const limits = browserRunAccountLimits(env);
    await db.prepare(
      `UPDATE jobs
      SET status = 'running', started_at = ?, updated_at = ?
      WHERE id = ? AND actor_id = ? AND status = 'queued'
        AND (SELECT COUNT(1) FROM jobs WHERE (capability LIKE 'browser.%' OR capability LIKE 'sandbox.%') AND status = 'running') < ?
        AND (SELECT COUNT(1) FROM jobs WHERE capability LIKE 'browser.%' AND status = 'running') < ?`
    ).bind(startedAt, startedAt, job.id, job.actorId, hostedLimits.hardCap, limits.hardCap).run();
    return;
  }

  if (job.input.kind === "sandbox") {
    await notifyCapacitySoftCapIfNeeded(db, job, env, ctx, startedAt);
    const hostedLimits = hostedAccountLimits(env);
    const limits = sandboxAccountLimits(env);
    await db.prepare(
      `UPDATE jobs
      SET status = 'running', started_at = ?, updated_at = ?
      WHERE id = ? AND actor_id = ? AND status = 'queued'
        AND (SELECT COUNT(1) FROM jobs WHERE (capability LIKE 'browser.%' OR capability LIKE 'sandbox.%') AND status = 'running') < ?
        AND (SELECT COUNT(1) FROM jobs WHERE capability LIKE 'sandbox.%' AND status = 'running') < ?`
    ).bind(startedAt, startedAt, job.id, job.actorId, hostedLimits.hardCap, limits.hardCap).run();
    return;
  }

  await db.prepare("UPDATE jobs SET status = 'running', started_at = ?, updated_at = ? WHERE id = ? AND actor_id = ? AND status = 'queued'")
    .bind(startedAt, startedAt, job.id, job.actorId)
    .run();
}

async function executeBrowserJob(job: ToolJobMessage, live: RequiredLiveBindings, env: HostedEnv): Promise<StoredArtifactResult> {
  if (job.input.kind !== "browser") {
    throw new HostedError(400, "input.invalid_job", "Browser job input was not normalized.");
  }
  if (job.capability === "browser.agent_task") {
    return executeBrowserAgentTaskJob(job, live);
  }
  const quickActionConfig = browserQuickActionConfig(env);
  if (quickActionConfig) {
    return executeBrowserQuickActionJob(job, live, quickActionConfig);
  }
  if (env.VC_TOOLS_PROVIDER_MODE === "live") {
    throw new HostedError(503, "live.browser_quick_actions_not_configured", "Browser Run Quick Actions credentials are required for stateless vc-tools browser jobs.");
  }
  return executeBrowserSessionJob(job, live);
}

async function executeBrowserSessionJob(job: ToolJobMessage, live: RequiredLiveBindings): Promise<StoredArtifactResult> {
  if (job.input.kind !== "browser") {
    throw new HostedError(400, "input.invalid_job", "Browser job input was not normalized.");
  }
  const browser = await puppeteer.launch(live.BROWSER, {
    keep_alive: browserSessionKeepAliveMs(job.input.timeoutMs)
  });
  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(job.input.timeoutMs);
    await installBrowserRequestPolicy(page);
    await page.goto(job.input.url, { waitUntil: BROWSER_NAVIGATION_WAIT_UNTIL, timeout: job.input.timeoutMs });
    await assertBrowserNetworkTarget(page.url());

    if (job.capability === "browser.screenshot_url") {
      const screenshot = await page.screenshot({ type: job.input.output === "jpeg" ? "jpeg" : "png", fullPage: true }) as Uint8Array;
      return storeJobArtifact(
        live,
        job,
        job.input.output === "jpeg" ? "screenshot-jpeg" : "screenshot-png",
        job.input.output === "jpeg" ? "image/jpeg" : "image/png",
        screenshot
      );
    }

    if (job.capability === "browser.render_pdf") {
      const pdf = await page.pdf({ printBackground: true, format: "letter" }) as Uint8Array;
      return storeJobArtifact(live, job, "pdf", "application/pdf", pdf);
    }

    const extracted = await page.evaluate(() => {
      const browserGlobal = globalThis as unknown as {
        document: {
          title: string;
          body?: { innerText?: string };
          querySelectorAll(selector: string): Iterable<{ textContent?: string | null; href?: string }>;
        };
        location: { href: string };
      };
      const anchors = Array.from(browserGlobal.document.querySelectorAll("a[href]"))
        .slice(0, 100)
        .map((anchor) => ({
          text: (anchor.textContent ?? "").replace(/\s+/g, " ").trim(),
          href: anchor.href ?? ""
        }));
      return {
        title: browserGlobal.document.title,
        finalUrl: browserGlobal.location.href,
        text: (browserGlobal.document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 200_000),
        links: anchors
      };
    });

    if (job.capability === "browser.extract_markdown") {
      const markdown = browserMarkdown(extracted);
      return storeJobArtifact(live, job, "markdown", "text/markdown; charset=utf-8", markdown);
    }

    return storeJobArtifact(
      live,
      job,
      "render-json",
      "application/json; charset=utf-8",
      JSON.stringify(extracted, null, 2)
    );
  } finally {
    await browser.close();
  }
}

async function executeBrowserAgentTaskJob(job: ToolJobMessage, live: RequiredLiveBindings): Promise<StoredArtifactResult> {
  if (job.input.kind !== "browser") {
    throw new HostedError(400, "input.invalid_job", "Browser agent task input was not normalized.");
  }

  const startedMs = Date.now();
  const deadlineMs = startedMs + Math.min(job.input.timeoutMs, MAX_BROWSER_AGENT_TASK_TIMEOUT_MS);
  const idleTimeoutMs = Math.min(
    job.input.idleTimeoutMs ?? DEFAULT_BROWSER_AGENT_IDLE_TIMEOUT_MS,
    DEFAULT_BROWSER_AGENT_IDLE_TIMEOUT_MS
  );
  const actionLog: Array<Record<string, unknown>> = [];
  let closureReason: "completed" | "idle_timeout" | "max_duration" | "action_failed" = "completed";
  let errorMessage: string | undefined;
  let lastMeaningfulAt = Date.now();

  const browser = await puppeteer.launch(live.BROWSER, {
    keep_alive: browserSessionKeepAliveMs(idleTimeoutMs)
  });
  try {
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(Math.min(job.input.timeoutMs, idleTimeoutMs));
    await installBrowserRequestPolicy(page);
    await page.goto(job.input.url, { waitUntil: BROWSER_NAVIGATION_WAIT_UNTIL, timeout: Math.min(job.input.timeoutMs, idleTimeoutMs) });
    await assertBrowserNetworkTarget(page.url());
    actionLog.push({ action: "navigate", url: job.input.url, atMs: Date.now() - startedMs });
    lastMeaningfulAt = Date.now();

    const actions = job.input.actions && job.input.actions.length > 0
      ? job.input.actions.slice(0, MAX_BROWSER_AGENT_ACTIONS)
      : [{ action: "snapshot" } satisfies BrowserAgentAction];

    for (const action of actions) {
      const now = Date.now();
      if (now >= deadlineMs) {
        closureReason = "max_duration";
        break;
      }
      if (now - lastMeaningfulAt >= idleTimeoutMs) {
        closureReason = "idle_timeout";
        break;
      }
      try {
        const performed = await performBrowserAgentAction(page, action, Math.max(1_000, Math.min(deadlineMs - now, idleTimeoutMs)));
        actionLog.push({ ...performed, atMs: Date.now() - startedMs });
        if (action.action !== "wait") {
          lastMeaningfulAt = Date.now();
        } else {
          // Account waits against the idle budget by their planned duration. Date.now() across a setTimeout disagrees by up to ~15 ms on Windows (system clock tick), making `>= idleTimeoutMs` flaky.
          const plannedSleepMs = typeof (performed as { ms?: unknown }).ms === "number" ? (performed as { ms: number }).ms : 0;
          if ((now - lastMeaningfulAt) + plannedSleepMs >= idleTimeoutMs) {
            closureReason = "idle_timeout";
            break;
          }
        }
      } catch (error) {
        closureReason = "action_failed";
        errorMessage = error instanceof Error ? error.message : String(error);
        actionLog.push({ action: action.action, ok: false, message: errorMessage, atMs: Date.now() - startedMs });
        break;
      }
    }

    const snapshot = await captureBrowserAgentSnapshot(page).catch((error) => ({
      error: error instanceof Error ? error.message : String(error)
    }));
    const payload = {
      capability: job.capability,
      requestedUrl: job.input.url,
      instructions: job.input.instructions ?? null,
      closureReason,
      idleTimeoutMs,
      maxDurationMs: job.input.timeoutMs,
      durationMs: Date.now() - startedMs,
      actions: actionLog,
      snapshot,
      ...(errorMessage ? { error: errorMessage } : {})
    };
    const artifact = await storeJobArtifact(
      live,
      job,
      "browser-agent-task-json",
      "application/json; charset=utf-8",
      JSON.stringify(redactObject(payload), null, 2)
    );
    return {
      ...artifact,
      browserMsUsed: Date.now() - startedMs,
      metadata: {
        closureReason,
        idleTimeoutMs,
        maxDurationMs: job.input.timeoutMs,
        durationMs: Date.now() - startedMs
      }
    };
  } finally {
    await browser.close();
  }
}

type BrowserAgentPageActions = BrowserPageLike & {
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string, options?: { delay?: number }): Promise<void>;
  evaluate<TResult>(fn: () => TResult): Promise<TResult>;
  evaluate<TArg, TResult>(fn: (arg: TArg) => TResult, arg: TArg): Promise<TResult>;
};

async function performBrowserAgentAction(
  page: BrowserAgentPageActions,
  action: BrowserAgentAction,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  if (action.action === "navigate") {
    await assertBrowserNetworkTarget(action.url);
    await page.goto(action.url, { waitUntil: BROWSER_NAVIGATION_WAIT_UNTIL, timeout: timeoutMs });
    await assertBrowserNetworkTarget(page.url());
    return { action: "navigate", ok: true, url: action.url };
  }
  if (action.action === "click") {
    void timeoutMs;
    await page.click(action.selector);
    return { action: "click", ok: true, selector: action.selector };
  }
  if (action.action === "type") {
    void timeoutMs;
    await page.type(action.selector, action.text, { delay: 0 });
    return { action: "type", ok: true, selector: action.selector, textLength: action.text.length };
  }
  if (action.action === "scroll") {
    await page.evaluate((deltaY) => {
      (globalThis as unknown as { scrollBy(x: number, y: number): void }).scrollBy(0, deltaY);
    }, action.deltaY);
    return { action: "scroll", ok: true, deltaY: action.deltaY };
  }
  if (action.action === "wait") {
    const ms = Math.min(action.ms, 30_000, timeoutMs);
    await sleep(ms);
    return { action: "wait", ok: true, ms };
  }
  await captureBrowserAgentSnapshot(page);
  return { action: "snapshot", ok: true };
}

async function captureBrowserAgentSnapshot(page: BrowserAgentPageActions): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const browserGlobal = globalThis as unknown as {
      document: {
        title: string;
        body?: { innerText?: string };
        querySelectorAll(selector: string): Iterable<{ textContent?: string | null; href?: string }>;
      };
      location: { href: string };
    };
    const anchors = Array.from(browserGlobal.document.querySelectorAll("a[href]"))
      .slice(0, 100)
      .map((anchor) => ({
        text: (anchor.textContent ?? "").replace(/\s+/g, " ").trim(),
        href: anchor.href ?? ""
      }));
    return {
      title: browserGlobal.document.title,
      finalUrl: browserGlobal.location.href,
      text: (browserGlobal.document.body?.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 200_000),
      links: anchors
    };
  });
}

interface BrowserQuickActionConfig {
  accountId: string;
  apiToken: string;
}

async function executeBrowserQuickActionJob(
  job: ToolJobMessage,
  live: RequiredLiveBindings,
  config: BrowserQuickActionConfig
): Promise<StoredArtifactResult> {
  if (job.input.kind !== "browser") {
    throw new HostedError(400, "input.invalid_job", "Browser job input was not normalized.");
  }

  if (job.capability === "browser.crawl_site") {
    return executeBrowserQuickActionCrawlJob(job, live, config);
  }

  if (job.capability === "browser.screenshot_url") {
    const type = job.input.output === "jpeg" ? "jpeg" : "png";
    const response = await callBrowserQuickAction(config, "screenshot", {
      url: job.input.url,
      gotoOptions: quickActionGotoOptions(job.input.timeoutMs),
      screenshotOptions: { fullPage: true, type }
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return withBrowserMsUsed(await storeJobArtifact(
      live,
      job,
      type === "jpeg" ? "screenshot-jpeg" : "screenshot-png",
      type === "jpeg" ? "image/jpeg" : "image/png",
      bytes
    ), response);
  }

  if (job.capability === "browser.render_pdf") {
    const response = await callBrowserQuickAction(config, "pdf", {
      url: job.input.url,
      gotoOptions: quickActionGotoOptions(job.input.timeoutMs),
      pdfOptions: {
        format: "letter",
        printBackground: true,
        timeout: quickActionOperationTimeout(job.input.timeoutMs)
      }
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return withBrowserMsUsed(await storeJobArtifact(
      live,
      job,
      "pdf",
      "application/pdf",
      bytes
    ), response);
  }

  const endpoint = job.capability === "browser.extract_markdown" ? "markdown" : "content";
  const response = await callBrowserQuickAction(config, endpoint, {
    url: job.input.url,
    gotoOptions: quickActionGotoOptions(job.input.timeoutMs)
  });
  const text = await quickActionResultText(response);
  return withBrowserMsUsed(await storeJobArtifact(
    live,
    job,
    endpoint === "markdown" ? "markdown" : "render-html",
    endpoint === "markdown" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8",
    text
  ), response);
}

async function executeBrowserQuickActionCrawlJob(
  job: ToolJobMessage,
  live: RequiredLiveBindings,
  config: BrowserQuickActionConfig
): Promise<StoredArtifactResult> {
  if (job.input.kind !== "browser" || job.input.output !== "crawl") {
    throw new HostedError(400, "input.invalid_job", "Crawl job input was not normalized.");
  }
  const maxPages = job.input.maxPages ?? DEFAULT_BROWSER_CRAWL_PAGES_PER_RUN;
  const maxDepth = job.input.maxDepth ?? DEFAULT_BROWSER_CRAWL_DEPTH;
  const format = job.input.format ?? "markdown";
  const render = job.input.render ?? true;
  const startResponse = await callBrowserQuickAction(config, "crawl", {
    url: job.input.url,
    gotoOptions: quickActionGotoOptions(job.input.timeoutMs),
    limit: maxPages,
    depth: maxDepth,
    formats: [format],
    render,
    crawlPurposes: ["search"]
  });
  const providerJobId = await quickActionStringResult(startResponse, "provider.browser_crawl_invalid_response");
  const result = await waitForBrowserCrawlResult(config, providerJobId, job.input.timeoutMs, maxPages);
  const payload = {
    providerJobId,
    requested: {
      url: job.input.url,
      limit: maxPages,
      depth: maxDepth,
      formats: [format],
      render
    },
    result
  };
  const artifact = await storeJobArtifact(
    live,
    job,
    "crawl-json",
    "application/json; charset=utf-8",
    JSON.stringify(redactObject(payload), null, 2)
  );
  const browserMsUsed = browserMsUsedForCrawlResult(result);
  const crawlPages = crawlPagesForCrawlResult(result);
  return {
    ...artifact,
    ...(browserMsUsed === undefined ? {} : { browserMsUsed }),
    ...(crawlPages === undefined ? {} : { crawlPages })
  };
}

async function callBrowserQuickAction(config: BrowserQuickActionConfig, endpoint: string, body: Record<string, unknown>): Promise<Response> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/browser-rendering/${endpoint}`;
  const response = await fetchBrowserQuickAction(config, url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return response;
}

async function fetchBrowserQuickAction(config: BrowserQuickActionConfig, url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${config.apiToken}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const details = await safeProviderErrorDetails(response);
    if (response.status === 429) {
      throw new HostedError(
        response.status,
        "provider.browser_run_rate_limited",
        "Browser Run asked vc-tools to retry this job because the provider rate limit is currently full.",
        details
      );
    }
    throw new HostedError(
      response.status,
      "provider.browser_run_failed",
      providerFailureMessage(response.status, details),
      details
    );
  }
  return response;
}

async function quickActionResultText(response: Response): Promise<string> {
  return quickActionStringResult(response, "provider.browser_run_invalid_response");
}

async function quickActionStringResult(response: Response, invalidCode: string): Promise<string> {
  const payload = await response.json().catch(() => undefined);
  if (!isRecord(payload) || payload.success !== true) {
    throw new HostedError(502, invalidCode, "Browser Run Quick Action returned an invalid response.");
  }
  const result = payload.result;
  return typeof result === "string" ? result : JSON.stringify(result ?? "", null, 2);
}

async function waitForBrowserCrawlResult(
  config: BrowserQuickActionConfig,
  providerJobId: string,
  timeoutMs: number,
  maxPages: number
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const status = await getBrowserCrawlResult(config, providerJobId, 1);
    const state = typeof status.status === "string" ? status.status : "unknown";
    if (state === "completed") {
      return getBrowserCrawlResult(config, providerJobId, maxPages);
    }
    if (state !== "running") {
      throw new HostedError(
        502,
        "provider.browser_crawl_terminal_state",
        `Browser Run crawl ended with provider status ${state}.`,
        { providerJobId, status: state, result: redactObject(status) }
      );
    }
    if (Date.now() + BROWSER_CRAWL_POLL_INTERVAL_MS > deadline) {
      throw new HostedError(
        504,
        "provider.browser_crawl_timeout",
        "Browser Run crawl did not complete within the vc-tools timeout.",
        { providerJobId, timeoutMs }
      );
    }
    await sleep(BROWSER_CRAWL_POLL_INTERVAL_MS);
  }
}

async function getBrowserCrawlResult(config: BrowserQuickActionConfig, providerJobId: string, limit: number): Promise<Record<string, unknown>> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/browser-rendering/crawl/${encodeURIComponent(providerJobId)}?limit=${encodeURIComponent(String(limit))}`;
  const response = await fetchBrowserQuickAction(config, url, { method: "GET" });
  const payload = await response.json().catch(() => undefined);
  if (!isRecord(payload) || payload.success === false || !isRecord(payload.result)) {
    throw new HostedError(502, "provider.browser_crawl_invalid_response", "Browser Run crawl returned an invalid response.");
  }
  return payload.result;
}

function quickActionGotoOptions(timeoutMs: number): Record<string, unknown> {
  return {
    waitUntil: BROWSER_NAVIGATION_WAIT_UNTIL,
    timeout: Math.min(timeoutMs, BROWSER_QUICK_ACTION_GOTO_TIMEOUT_MAX_MS)
  };
}

function quickActionOperationTimeout(timeoutMs: number): number {
  return Math.min(timeoutMs, BROWSER_QUICK_ACTION_ACTION_TIMEOUT_MAX_MS);
}

function browserAgentWorkflowStepConfig(job: ToolJobMessage): WorkflowStepConfig {
  const timeoutMs = job.input.kind === "browser"
    ? Math.min(job.input.timeoutMs, MAX_BROWSER_AGENT_TASK_TIMEOUT_MS)
    : MAX_BROWSER_AGENT_TASK_TIMEOUT_MS;
  return {
    retries: {
      limit: DEFAULT_JOB_QUEUE_MAX_RETRIES,
      delay: "5 seconds",
      backoff: "exponential"
    },
    timeout: workflowTimeoutDuration(timeoutMs)
  };
}

function workflowRetentionPolicy(retentionDays: number): { successRetention: WorkflowRetentionDuration; errorRetention: WorkflowRetentionDuration } {
  const days = Math.max(1, Math.min(365, Math.ceil(retentionDays)));
  const duration = `${days} days` as WorkflowRetentionDuration;
  return {
    successRetention: duration,
    errorRetention: duration
  };
}

function workflowTimeoutDuration(timeoutMs: number): WorkflowTimeoutDuration {
  const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
  return `${seconds} seconds` as WorkflowTimeoutDuration;
}

function browserSessionKeepAliveMs(timeoutMs: number): number {
  return Math.min(
    BROWSER_SESSION_KEEP_ALIVE_MAX_MS,
    Math.max(BROWSER_SESSION_KEEP_ALIVE_MIN_MS, timeoutMs)
  );
}

function browserMsUsedForCrawlResult(result: Record<string, unknown>): number | undefined {
  const browserSecondsUsed = Number(result.browserSecondsUsed);
  return Number.isFinite(browserSecondsUsed) && browserSecondsUsed > 0 ? browserSecondsUsed * 1000 : undefined;
}

function crawlPagesForCrawlResult(result: Record<string, unknown>): number | undefined {
  const finished = Number(result.finished);
  if (Number.isFinite(finished) && finished > 0) {
    return Math.ceil(finished);
  }
  const records = result.records;
  return Array.isArray(records) ? records.length : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeProviderErrorDetails(response: Response): Promise<Record<string, unknown>> {
  const retryAfter = response.headers.get("retry-after");
  const contentType = response.headers.get("content-type") ?? "";
  const base = retryAfter ? { status: response.status, retryAfter } : { status: response.status };
  if (!contentType.includes("application/json")) {
    return base;
  }
  const payload = await response.json().catch(() => undefined);
  return { ...base, payload: sanitizeProviderPayload(payload) };
}

function sanitizeProviderPayload(payload: unknown): unknown {
  return redactObject(payload);
}

function providerFailureMessage(status: number, details: Record<string, unknown>): string {
  const summary = providerErrorSummary(details);
  return summary
    ? `Browser Run Quick Action failed with HTTP ${status}. Provider: ${summary}`
    : `Browser Run Quick Action failed with HTTP ${status}.`;
}

function providerErrorSummary(details: Record<string, unknown>): string | undefined {
  const payload = details.payload;
  if (!isRecord(payload)) {
    return undefined;
  }
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const firstError = errors.find(isRecord);
  if (firstError) {
    const message = typeof firstError.message === "string" ? firstError.message.trim() : "";
    const code = typeof firstError.code === "string" || typeof firstError.code === "number"
      ? String(firstError.code).trim()
      : "";
    const summary = message || code;
    return summary ? sanitizeErrorMessage(summary).slice(0, 240) : undefined;
  }
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  return message ? sanitizeErrorMessage(message).slice(0, 240) : undefined;
}

function isRetryableProviderError(error: unknown): boolean {
  return error instanceof HostedError && error.code === "provider.browser_run_rate_limited";
}

function withBrowserMsUsed(artifact: StoredArtifactResult, response: Response): StoredArtifactResult {
  const raw = response.headers.get("x-browser-ms-used");
  const browserMsUsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(browserMsUsed) && browserMsUsed > 0 ? { ...artifact, browserMsUsed } : artifact;
}

function browserQuickActionConfig(env: HostedEnv): BrowserQuickActionConfig | undefined {
  const accountId = env.VC_TOOLS_BROWSER_RUN_ACCOUNT_ID?.trim();
  const apiToken = env.VC_TOOLS_BROWSER_RUN_API_TOKEN?.trim();
  if (!accountId && !apiToken) {
    return undefined;
  }
  if (!accountId || !apiToken) {
    throw new HostedError(503, "live.browser_quick_actions_misconfigured", "Browser Run Quick Actions require both account id and API token secrets.");
  }
  return { accountId, apiToken };
}

async function executeSandboxJob(
  job: ToolJobMessage,
  live: RequiredLiveBindings,
  env: HostedEnv,
  ctx: ExecutionContext
): Promise<StoredArtifactResult> {
  if (job.input.kind !== "sandbox") {
    throw new HostedError(400, "input.invalid_job", "Sandbox job input was not normalized.");
  }
  const sandbox = sandboxSdk.getSandbox(sandboxNamespaceForPlan(live, job.planName), job.id, { normalizeId: true }) as unknown as SandboxInstance;
  try {
    const result = await sandbox.exec(job.input.command, {
      timeout: job.input.timeoutMs,
      cwd: "/workspace",
      env: {
        VC_TOOLS_JOB_ID: job.id,
        VC_TOOLS_SANDBOX_NETWORK: job.input.network ? "true" : "false"
      }
    });
    const payload = sandboxResultPayload(result);
    return storeJobArtifact(live, job, "sandbox-log", "application/json; charset=utf-8", JSON.stringify(payload, null, 2));
  } finally {
    // WHY: each queued vc-tools job gets a fresh sandbox id; destroying it keeps
    // untrusted files/processes from becoming ambient state for future jobs.
    ctx.waitUntil(sandbox.destroy().catch(() => undefined));
    void env;
  }
}

function sandboxNamespaceForPlan(live: RequiredLiveBindings, planName: string): DurableObjectNamespace<Sandbox | ProSandbox> {
  const plan = planByName(planName);
  return plan.limits.sandbox.containerInstanceType === "standard-2" ? live.ProSandbox : live.Sandbox;
}

function sandboxResultPayload(result: ExecResult): Record<string, unknown> {
  return {
    success: result.success,
    exitCode: result.exitCode,
    stdout: truncateLargeText(result.stdout),
    stderr: truncateLargeText(result.stderr),
    duration: result.duration,
    timestamp: result.timestamp
  };
}

function normalizeHostedToolInput(capability: CapabilityName, input: Record<string, unknown>): NormalizedToolInput {
  if (BROWSER_CAPABILITIES.has(capability)) {
    assertNoBrowserAuthInput(input);
    const url = typeof input.url === "string" ? validateBrowserUrl(input.url) : "";
    if (!url) {
      throw new HostedError(400, "input.url_required", `${capability} requires an HTTPS URL target.`);
    }
    const maxTimeoutMs = capability === "browser.agent_task" ? MAX_BROWSER_AGENT_TASK_TIMEOUT_MS : MAX_BROWSER_TOOL_TIMEOUT_MS;
    const timeoutMs = numberInRange(input.timeoutMs, 1000, maxTimeoutMs, 30_000, "timeoutMs");
    if (capability === "browser.agent_task") {
      const instructions = typeof input.instructions === "string" ? input.instructions.trim().slice(0, 4_000) : undefined;
      const idleTimeoutMs = numberInRange(input.idleTimeoutMs, 1_000, DEFAULT_BROWSER_AGENT_IDLE_TIMEOUT_MS, DEFAULT_BROWSER_AGENT_IDLE_TIMEOUT_MS, "idleTimeoutMs");
      const actions = normalizeBrowserAgentActions(input.actions);
      return {
        kind: "browser",
        url,
        timeoutMs,
        output: "html",
        ...(instructions ? { instructions } : {}),
        idleTimeoutMs,
        ...(actions ? { actions } : {})
      };
    }
    if (capability === "browser.crawl_site") {
      return {
        kind: "browser",
        url,
        timeoutMs,
        output: "crawl",
        maxPages: numberInRange(input.maxPages, 1, MAX_BROWSER_CRAWL_PAGES_PER_RUN, DEFAULT_BROWSER_CRAWL_PAGES_PER_RUN, "maxPages"),
        maxDepth: numberInRange(input.maxDepth, 0, MAX_BROWSER_CRAWL_DEPTH, DEFAULT_BROWSER_CRAWL_DEPTH, "maxDepth"),
        render: input.render === false ? false : true,
        format: browserCrawlFormat(input)
      };
    }
    return {
      kind: "browser",
      url,
      timeoutMs,
      output: browserOutputFor(capability, input)
    };
  }

  if (SANDBOX_CAPABILITIES.has(capability)) {
    const command = typeof input.command === "string" ? input.command.trim() : "";
    if (!command) {
      throw new HostedError(400, "input.command_required", `${capability} requires a non-empty command.`);
    }
    if (command.length > 4000) {
      throw new HostedError(400, "input.command_too_large", "Sandbox command must be 4000 characters or fewer.");
    }
    return {
      kind: "sandbox",
      command,
      network: true,
      timeoutMs: numberInRange(input.timeoutMs, 1000, 1_800_000, 60_000, "timeoutMs")
    };
  }

  if (capability.startsWith("artifact.")) {
    const artifactId = typeof input.artifactId === "string" ? input.artifactId : undefined;
    return artifactId ? { kind: "artifact", artifactId } : { kind: "artifact" };
  }

  const jobId = typeof input.jobId === "string" ? input.jobId : undefined;
  return jobId ? { kind: "job", jobId } : { kind: "job" };
}

function assertNoBrowserAuthInput(input: Record<string, unknown>): void {
  const forbidden = [
    "headers",
    "cookie",
    "cookies",
    "authorization",
    "auth",
    "credentials",
    "storageState",
    "session",
    "secrets"
  ];
  const present = forbidden.filter((key) => Object.prototype.hasOwnProperty.call(input, key));
  if (present.length > 0) {
    throw new HostedError(
      403,
      "policy.authenticated_browser_denied",
      "Blocked for safety: browser calls cannot include cookies, credentials, auth headers, storage state, sessions, or secrets. Use a public page, or connect an authenticated browsing session when that beta is available.",
      { fields: present }
    );
  }
}

function validateBrowserUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HostedError(400, "input.invalid_url", "Browser URL must be a valid absolute URL.");
  }

  if (url.protocol !== "https:") {
    throw new HostedError(400, "input.invalid_url", "Blocked for safety: vc-tools can browse public HTTPS pages. Try a deployed or preview HTTPS URL.");
  }
  if (url.username || url.password) {
    throw new HostedError(400, "input.invalid_url", "Blocked for safety: browser URLs cannot include credentials. Use a public page, or connect an authenticated browsing session when that beta is available.");
  }

  const hostname = normalizedHostname(url.hostname);
  if (isBlockedHostname(hostname)) {
    throw new HostedError(400, "input.blocked_url", "Blocked for safety: vc-tools can browse public HTTPS pages, but not localhost, internal hostnames, private IPs, loopback, link-local, multicast, or unspecified IPs. Try a public preview URL, deploy preview, or a future consented private-network connector.");
  }

  return url.toString();
}

async function installBrowserRequestPolicy(page: BrowserPageLike): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    void (async () => {
      try {
        await assertBrowserNetworkTarget(request.url());
        await request.continue();
      } catch {
        await request.abort("blockedbyclient").catch(() => undefined);
      }
    })();
  });
}

async function assertBrowserNetworkTarget(input: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HostedError(400, "input.invalid_url", "Browser request URL must be a valid absolute URL.");
  }
  if (["about:", "data:", "blob:"].includes(url.protocol)) {
    return;
  }
  validateBrowserUrl(input);
  await assertPublicDnsTarget(input);
  await assertBrowserRedirectChain(input);
}

async function assertPublicDnsTarget(input: string): Promise<void> {
  const hostname = normalizedHostname(new URL(input).hostname);
  await assertPublicDnsHostname(hostname, BROWSER_DNS_SAFETY_ERRORS);
}

async function assertPublicDnsHostname(hostname: string, errors: DnsSafetyErrors): Promise<void> {
  if (isIPv4(hostname) || isLikelyIPv6(hostname)) {
    return;
  }

  const [aRecords, aaaaRecords] = await Promise.all([
    resolveDns(hostname, "A", errors),
    resolveDns(hostname, "AAAA", errors)
  ]);
  const answers = [...aRecords, ...aaaaRecords];
  if (answers.length === 0) {
    throw new HostedError(errors.status, errors.unresolvableCode, errors.unresolvableMessage);
  }
  if (answers.some((answer) => isBlockedHostname(normalizedHostname(answer)))) {
    throw new HostedError(errors.status, errors.blockedCode, errors.blockedMessage);
  }
}

async function assertBrowserRedirectChain(input: string): Promise<void> {
  let current = input;
  const seen = new Set<string>([current]);

  for (let index = 0; index < MAX_BROWSER_REDIRECT_PREFLIGHTS; index += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        headers: {
          accept: "*/*",
          "user-agent": "vc-tools-safety-preflight"
        },
        signal: AbortSignal.timeout(4000)
      });
    } catch {
      throw new HostedError(400, "input.redirect_check_failed", "Browser URL redirect chain could not be verified before hosted browser execution.");
    }

    if (!isRedirectStatus(response.status)) {
      return;
    }

    const location = response.headers.get("location");
    if (!location) {
      throw new HostedError(400, "input.invalid_redirect", "Browser URL redirect response did not include a Location header.");
    }

    let next: string;
    try {
      next = new URL(location, current).toString();
    } catch {
      throw new HostedError(400, "input.invalid_redirect", "Browser URL redirect target is not a valid URL.");
    }

    validateBrowserUrl(next);
    await assertPublicDnsTarget(next);
    if (seen.has(next)) {
      throw new HostedError(400, "input.redirect_loop", "Browser URL redirect chain loops before reaching a safe final URL.");
    }
    seen.add(next);
    current = next;
  }

  throw new HostedError(400, "input.redirect_chain_too_deep", "Browser URL redirect chain is too deep for hosted browser execution.");
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function resolveDns(hostname: string, type: "A" | "AAAA", errors: DnsSafetyErrors = BROWSER_DNS_SAFETY_ERRORS): Promise<string[]> {
  const query = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`;
  let response: Response;
  try {
    response = await fetch(query, {
      headers: { accept: "application/dns-json" },
      signal: AbortSignal.timeout(4000)
    });
  } catch {
    throw new HostedError(errors.status, errors.dnsCheckCode, errors.dnsCheckMessage);
  }
  if (!response.ok) {
    throw new HostedError(errors.status, errors.dnsCheckCode, errors.dnsCheckMessage);
  }
  const data = await response.json() as { Status?: number; Answer?: Array<{ type?: number; data?: string }> };
  if (data.Status !== 0) {
    return [];
  }
  const expectedType = type === "A" ? 1 : 28;
  return (data.Answer ?? [])
    .filter((answer) => answer.type === expectedType)
    .map((answer) => answer.data)
    .filter((answer): answer is string => typeof answer === "string");
}

function browserOutputFor(capability: CapabilityName, input: Record<string, unknown>): BrowserToolInput["output"] {
  if (capability === "browser.crawl_site") {
    return "crawl";
  }
  if (capability === "browser.screenshot_url") {
    return input.format === "jpeg" ? "jpeg" : "png";
  }
  if (capability === "browser.render_pdf") {
    return "pdf";
  }
  if (capability === "browser.extract_markdown") {
    return "markdown";
  }
  return "html";
}

function browserCrawlFormat(input: Record<string, unknown>): "markdown" | "html" {
  if (input.format === undefined) {
    return "markdown";
  }
  if (input.format === "markdown" || input.format === "html") {
    return input.format;
  }
  throw new HostedError(400, "input.invalid_format", "Crawl format must be markdown or html.");
}

function normalizeBrowserAgentActions(input: unknown): BrowserAgentAction[] | undefined {
  if (input === undefined) {
    return undefined;
  }
  if (!Array.isArray(input) || input.length > MAX_BROWSER_AGENT_ACTIONS) {
    throw new HostedError(400, "input.invalid_browser_actions", `Browser agent actions must be an array with at most ${MAX_BROWSER_AGENT_ACTIONS} entries.`);
  }
  return input.map((item) => normalizeBrowserAgentAction(item));
}

function normalizeBrowserAgentAction(input: unknown): BrowserAgentAction {
  if (!isRecord(input) || typeof input.action !== "string") {
    throw new HostedError(400, "input.invalid_browser_action", "Each browser agent action must name an action.");
  }
  if (input.action === "navigate") {
    const url = typeof input.url === "string" ? validateBrowserUrl(input.url) : "";
    if (!url) throw new HostedError(400, "input.url_required", "Browser navigate actions require an HTTPS URL target.");
    return { action: "navigate", url };
  }
  if (input.action === "click") {
    const selector = normalizeCssSelector(input.selector);
    return { action: "click", selector };
  }
  if (input.action === "type") {
    const selector = normalizeCssSelector(input.selector);
    const text = typeof input.text === "string" ? input.text.slice(0, 2_000) : "";
    if (!text) throw new HostedError(400, "input.text_required", "Browser type actions require text.");
    return { action: "type", selector, text };
  }
  if (input.action === "scroll") {
    const deltaY = numberInRange(input.deltaY, -10_000, 10_000, 800, "deltaY");
    return { action: "scroll", deltaY };
  }
  if (input.action === "wait") {
    const ms = numberInRange(input.ms, 1, 30_000, 1_000, "ms");
    return { action: "wait", ms };
  }
  if (input.action === "snapshot") {
    return { action: "snapshot" };
  }
  throw new HostedError(400, "input.invalid_browser_action", "Browser agent action must be navigate, click, type, scroll, wait, or snapshot.");
}

function normalizeCssSelector(input: unknown): string {
  const selector = typeof input === "string" ? input.trim() : "";
  if (!selector || selector.length > 500) {
    throw new HostedError(400, "input.invalid_selector", "Browser agent selectors must be 1 to 500 characters.");
  }
  return selector;
}

function numberInRange(input: unknown, min: number, max: number, fallback: number, label: string): number {
  if (input === undefined) {
    return fallback;
  }
  const value = Number(input);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new HostedError(400, "input.invalid_number", `${label} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function listLimitFromUrl(url: URL): number {
  return numberInRange(url.searchParams.get("limit") ?? undefined, 1, 100, 20, "limit");
}

type RequiredBindingName = "DB" | "ARTIFACTS" | "JOB_QUEUE" | "JOB_DLQ" | "BROWSER" | "BROWSER_AGENT_WORKFLOW" | "Sandbox" | "ProSandbox";
type RequiredLiveBindings = HostedEnv & {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  JOB_QUEUE: Queue<ToolJobMessage>;
  JOB_DLQ: Queue<ToolJobMessage>;
  BROWSER: BrowserWorker;
  BROWSER_AGENT_WORKFLOW: Workflow<ToolJobMessage>;
  Sandbox: DurableObjectNamespace<Sandbox>;
  ProSandbox: DurableObjectNamespace<ProSandbox>;
};

function requiredBindingsForCapability(capability: CapabilityName): RequiredBindingName[] {
  if (capability === "browser.agent_task") {
    return ["DB", "ARTIFACTS", "BROWSER", "BROWSER_AGENT_WORKFLOW"];
  }
  if (BROWSER_CAPABILITIES.has(capability)) {
    return ["DB", "ARTIFACTS", "JOB_QUEUE", "BROWSER"];
  }
  if (SANDBOX_CAPABILITIES.has(capability)) {
    return ["DB", "ARTIFACTS", "JOB_QUEUE", "Sandbox", "ProSandbox"];
  }
  return ["DB", "ARTIFACTS", "JOB_QUEUE"];
}

function requireLiveBindings(env: HostedEnv, required: RequiredBindingName[]): RequiredLiveBindings {
  const missing = required.filter((binding) => !env[binding]);
  if (missing.length > 0) {
    throw new HostedError(503, "live.bindings_missing", "Live vc-tools provider is missing required Cloudflare bindings.", { missing });
  }
  return env as RequiredLiveBindings;
}

function liveReadiness(env: HostedEnv, options: { operator?: boolean } = {}): Record<string, unknown> {
  const bindings: RequiredBindingName[] = ["DB", "ARTIFACTS", "JOB_QUEUE", "JOB_DLQ", "BROWSER", "BROWSER_AGENT_WORKFLOW", "Sandbox", "ProSandbox"];
  const missing = bindings.filter((binding) => !env[binding]);
  const provider = providerMode(env);
  const base = {
    configured: provider !== "live" || missing.length === 0,
    dnsPreflight: true,
    network: {
      browserPublicHttps: "available",
      computerPublicHttps: "available",
      privateLocalNetworks: "blocked",
      metadataServices: "blocked",
      rawNetwork: "restricted"
    }
  };
  if (options.operator !== true) {
    return base;
  }
  const hostedAccount = hostedAccountLimits(env);
  const browserRunAccount = browserRunAccountLimits(env);
  const sandboxAccount = sandboxAccountLimits(env);
  const queueBacklog = queueBacklogLimits(env);
  const dlqMessages = dlqMessageLimits(env);
  const artifactStorage = artifactStorageAccountLimits(env);
  const operatorAlerts = operatorAlertsReadiness(env);
  return {
    ...base,
    providerMode: provider,
    configured: missing.length === 0 && (provider !== "live" || operatorAlerts.configured === true),
    missingBindings: missing,
    hostedQueue: { maxConcurrency: DEFAULT_HOSTED_QUEUE_MAX_CONCURRENCY, backlog: queueBacklog },
    hostedAccount,
    browserRunAccount,
    sandboxAccount,
    dlqMessages,
    artifactStorage,
    operatorAlerts
  };
}

function hostedAccountLimits(env: HostedEnv): { softCap: number; hardCap: number } {
  const hardCap = integerEnv(
    env.VC_TOOLS_HOSTED_ACCOUNT_HARD_CAP,
    DEFAULT_HOSTED_ACCOUNT_HARD_CAP,
    1,
    MAX_HOSTED_ACCOUNT_CAP
  );
  const softCap = Math.min(
    integerEnv(env.VC_TOOLS_HOSTED_ACCOUNT_SOFT_CAP, DEFAULT_HOSTED_ACCOUNT_SOFT_CAP, 1, MAX_HOSTED_ACCOUNT_CAP),
    hardCap
  );
  return { softCap, hardCap };
}

function browserRunAccountLimits(env: HostedEnv): { softCap: number; hardCap: number } {
  const hardCap = integerEnv(
    env.VC_TOOLS_BROWSER_RUN_ACCOUNT_HARD_CAP,
    DEFAULT_BROWSER_RUN_ACCOUNT_HARD_CAP,
    1,
    MAX_BROWSER_RUN_ACCOUNT_CAP
  );
  const softCap = Math.min(
    integerEnv(env.VC_TOOLS_BROWSER_RUN_ACCOUNT_SOFT_CAP, DEFAULT_BROWSER_RUN_ACCOUNT_SOFT_CAP, 1, MAX_BROWSER_RUN_ACCOUNT_CAP),
    hardCap
  );
  return { softCap, hardCap };
}

function sandboxAccountLimits(env: HostedEnv): { softCap: number; hardCap: number } {
  const hardCap = integerEnv(
    env.VC_TOOLS_SANDBOX_ACCOUNT_HARD_CAP,
    DEFAULT_SANDBOX_ACCOUNT_HARD_CAP,
    1,
    MAX_SANDBOX_ACCOUNT_CAP
  );
  const softCap = Math.min(
    integerEnv(env.VC_TOOLS_SANDBOX_ACCOUNT_SOFT_CAP, DEFAULT_SANDBOX_ACCOUNT_SOFT_CAP, 1, MAX_SANDBOX_ACCOUNT_CAP),
    hardCap
  );
  return { softCap, hardCap };
}

function queueBacklogLimits(env: HostedEnv): { softCap: number; hardCap: number } {
  const hardCap = integerEnv(
    env.VC_TOOLS_QUEUE_BACKLOG_HARD_CAP,
    DEFAULT_QUEUE_BACKLOG_HARD_CAP,
    1,
    MAX_QUEUE_MESSAGES_CAP
  );
  const softCap = Math.min(
    integerEnv(env.VC_TOOLS_QUEUE_BACKLOG_SOFT_CAP, DEFAULT_QUEUE_BACKLOG_SOFT_CAP, 1, MAX_QUEUE_MESSAGES_CAP),
    hardCap
  );
  return { softCap, hardCap };
}

function dlqMessageLimits(env: HostedEnv): { softCap: number; hardCap: number } {
  const hardCap = integerEnv(
    env.VC_TOOLS_DLQ_MESSAGES_HARD_CAP,
    DEFAULT_DLQ_MESSAGES_HARD_CAP,
    1,
    MAX_QUEUE_MESSAGES_CAP
  );
  const softCap = Math.min(
    integerEnv(env.VC_TOOLS_DLQ_MESSAGES_SOFT_CAP, DEFAULT_DLQ_MESSAGES_SOFT_CAP, 1, MAX_QUEUE_MESSAGES_CAP),
    hardCap
  );
  return { softCap, hardCap };
}

function artifactStorageAccountLimits(env: HostedEnv): { softCap: number; hardCap: number } {
  const hardCap = numberEnv(
    env.VC_TOOLS_ARTIFACT_STORAGE_ACCOUNT_HARD_GB,
    DEFAULT_ARTIFACT_STORAGE_ACCOUNT_HARD_GB,
    0.001,
    MAX_ARTIFACT_STORAGE_ACCOUNT_GB
  );
  const softCap = Math.min(
    numberEnv(env.VC_TOOLS_ARTIFACT_STORAGE_ACCOUNT_SOFT_GB, DEFAULT_ARTIFACT_STORAGE_ACCOUNT_SOFT_GB, 0.001, MAX_ARTIFACT_STORAGE_ACCOUNT_GB),
    hardCap
  );
  return { softCap, hardCap };
}

function operatorAlertsReadiness(env: HostedEnv): Record<string, unknown> {
  const webhookCount = operatorWebhookUrls(env).length;
  const internalApiBinding = Boolean(env.VC_TOOLS_INTERNAL_API_WORKER);
  const internalAlertToken = Boolean(env.VC_TOOLS_INTERNAL_ALERT_TOKEN?.trim());
  const ntfyConfigured = Boolean(env.VC_TOOLS_OPERATOR_NTFY_TOPIC?.trim());
  return {
    codes: [
      VC_TOOLS_CAPACITY_ALERT_CODE,
      VC_TOOLS_RETENTION_CLEANUP_ALERT_CODE,
      VC_TOOLS_EXECUTION_HEALTH_ALERT_CODE,
      VC_TOOLS_HOSTED_WORKER_5XX_ALERT_CODE,
      VC_TOOLS_AUTH_FAILURE_ALERT_CODE,
      VC_TOOLS_CLOUDFLARE_SPEND_ALERT_CODE
    ],
    thresholds: OPERATOR_ALERT_THRESHOLDS,
    configured: (internalApiBinding && internalAlertToken) || webhookCount > 0 || ntfyConfigured,
    internalApiBinding,
    internalAlertToken,
    webhookCount,
    ntfyConfigured
  };
}

type OperatorAlertScope = "account";
type VcToolsOperatorAlertCode =
  | typeof VC_TOOLS_CAPACITY_ALERT_CODE
  | typeof VC_TOOLS_RETENTION_CLEANUP_ALERT_CODE
  | typeof VC_TOOLS_EXECUTION_HEALTH_ALERT_CODE
  | typeof VC_TOOLS_HOSTED_WORKER_5XX_ALERT_CODE
  | typeof VC_TOOLS_AUTH_FAILURE_ALERT_CODE
  | typeof VC_TOOLS_CLOUDFLARE_SPEND_ALERT_CODE;
type CapacityAlertSurface =
  | "hosted.active_jobs"
  | "browser.active_jobs"
  | "sandbox.active_jobs"
  | "queue.backlog_messages"
  | "queue.dlq_messages"
  | "artifact.storage_gb";
type ExecutionHealthAlertSurface =
  | "browser.failure_rate"
  | "browser.timeout_rate"
  | "sandbox.failure_rate"
  | "sandbox.timeout_rate";
type OperatorAlertSurface =
  | CapacityAlertSurface
  | "retention.cleanup_failed"
  | ExecutionHealthAlertSurface
  | "hosted.worker_5xx"
  | "auth.failure_anomaly"
  | "cloudflare.estimated_spend_usd";

type VcToolsOperatorAlert = {
  source: "vc-tools";
  environment: string;
  code: VcToolsOperatorAlertCode;
  level: "warn";
  message: string;
  dedupeKey: string;
  resetWindow: string;
  details: {
    scope: OperatorAlertScope;
    surface: OperatorAlertSurface;
    capability?: string;
    planName?: string;
    currentUsage: number;
    includedUsage: number;
    percentUsed: number;
    threshold: number;
    unit: string;
    recentTrend: string;
    suggestedAction: string;
    running?: number;
    projected?: number;
    softCap?: number;
    hardCap?: number;
    queueMaxConcurrency?: number;
    sandboxContainerMaxInstances?: number;
    failedStage?: string;
    failedCount?: number;
    errorMessage?: string;
    windowMinutes?: number;
    terminalJobs?: number;
    failedJobs?: number;
    timeoutJobs?: number;
    method?: string;
    path?: string;
    status?: number;
    billingPeriod?: string;
    browserMinutes?: number;
    sandboxStandard1Minutes?: number;
    sandboxStandard2Minutes?: number;
    crawlPages?: number;
    artifactStorageGb?: number;
    estimatedRawCostUsd?: number;
    officialBillingSource?: string;
  };
  timestamp: number;
};

type OperatorAlertDeliveryResult = {
  configured: boolean;
  delivered: boolean;
  channels: number;
};

async function notifyCapacitySoftCapIfNeeded(
  db: D1Database,
  job: ToolJobMessage,
  env: HostedEnv,
  ctx: ExecutionContext,
  observedAt: string
): Promise<void> {
  if (job.input.kind !== "browser" && job.input.kind !== "sandbox") {
    return;
  }

  const hostedRunning = await countRunningHostedAccountJobs(db);
  const hostedLimits = hostedAccountLimits(env);
  maybeScheduleCapacitySoftCapAlert({
    db,
    env,
    ctx,
    job,
    observedAt,
    surface: "hosted.active_jobs",
    scope: "account",
    running: hostedRunning,
    projected: hostedRunning + 1,
    limits: hostedLimits
  });

  const laneSurface = job.input.kind;
  const laneRunning = await countRunningCapabilityPrefix(db, `${laneSurface}.%`);
  const laneLimits = laneSurface === "browser" ? browserRunAccountLimits(env) : sandboxAccountLimits(env);
  maybeScheduleCapacitySoftCapAlert({
    db,
    env,
    ctx,
    job,
    observedAt,
    surface: laneSurface === "browser" ? "browser.active_jobs" : "sandbox.active_jobs",
    scope: "account",
    running: laneRunning,
    projected: laneRunning + 1,
    limits: laneLimits
  });

  // Operator channels track platform pressure only. Per-actor caps still
  // enforce and audit through the quota gates without sending alert email.
}

async function checkQueueBacklogPressure(env: HostedEnv, ctx: ExecutionContext, scheduledTime: number | undefined): Promise<void> {
  if (!env.DB || !env.JOB_QUEUE) {
    return;
  }
  const observedAt = Number.isFinite(scheduledTime)
    ? new Date(scheduledTime as number).toISOString()
    : nowIso();
  const metrics = await env.JOB_QUEUE.metrics().catch((error) => {
    console.warn("[vc-tools.queueBacklog.metricsFailed]", redactObject({
      message: error instanceof Error ? error.message : String(error)
    }));
    return null;
  });
  maybeScheduleQueueMetricAlert(env, ctx, observedAt, metrics, "queue.backlog_messages", queueBacklogLimits(env));
}

async function checkQueueDlqPressure(env: HostedEnv, ctx: ExecutionContext, scheduledTime: number | undefined): Promise<void> {
  if (!env.DB || !env.JOB_DLQ) {
    return;
  }
  const observedAt = Number.isFinite(scheduledTime)
    ? new Date(scheduledTime as number).toISOString()
    : nowIso();
  const metrics = await env.JOB_DLQ.metrics().catch((error) => {
    console.warn("[vc-tools.queueDlq.metricsFailed]", redactObject({
      message: error instanceof Error ? error.message : String(error)
    }));
    return null;
  });
  maybeScheduleQueueMetricAlert(env, ctx, observedAt, metrics, "queue.dlq_messages", dlqMessageLimits(env));
}

function maybeScheduleQueueMetricAlert(
  env: HostedEnv,
  ctx: ExecutionContext,
  observedAt: string,
  metrics: QueueMetrics | null,
  surface: "queue.backlog_messages" | "queue.dlq_messages",
  limits: { softCap: number; hardCap: number }
): void {
  const db = env.DB;
  if (!metrics || !db) {
    return;
  }
  const backlogCount = Math.max(0, Math.floor(metrics.backlogCount));
  maybeScheduleCapacitySoftCapAlert({
    db,
    env,
    ctx,
    job: syntheticOperatorJob(surface === "queue.dlq_messages" ? "queue_dlq" : "queue_backlog", observedAt),
    observedAt,
    surface,
    scope: "account",
    running: backlogCount,
    projected: backlogCount,
    limits
  });
}

async function checkArtifactStoragePressure(env: HostedEnv, ctx: ExecutionContext, scheduledTime: number | undefined): Promise<void> {
  if (!env.DB) {
    return;
  }
  const observedAt = Number.isFinite(scheduledTime)
    ? new Date(scheduledTime as number).toISOString()
    : nowIso();
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(bytes), 0) AS bytes FROM artifacts WHERE expires_at IS NULL OR expires_at > ?"
  ).bind(observedAt).first<{ bytes: number }>().catch((error) => {
    console.warn("[vc-tools.artifactStorage.metricsFailed]", redactObject({
      message: error instanceof Error ? error.message : String(error)
    }));
    return null;
  });
  const activeStorageGb = Number(row?.bytes ?? 0) / 1024 / 1024 / 1024;
  maybeScheduleCapacitySoftCapAlert({
    db: env.DB,
    env,
    ctx,
    job: syntheticOperatorJob("artifact_storage", observedAt),
    observedAt,
    surface: "artifact.storage_gb",
    scope: "account",
    running: activeStorageGb,
    projected: activeStorageGb,
    limits: artifactStorageAccountLimits(env)
  });
}

type ExecutionHealthConfig = {
  windowMinutes: number;
  minTerminalJobs: number;
  failureRatePercent: number;
  timeoutRatePercent: number;
};

type ExecutionHealthMetricRow = {
  total: number | null;
  failed: number | null;
  timed_out: number | null;
};

type AuthFailureAnomalyConfig = {
  windowMinutes: number;
  alertThreshold: number;
};

type CloudflareSpendAnomalyConfig = {
  softCapUsd: number;
  hardCapUsd: number;
};

type CloudflareSpendSnapshot = {
  billingPeriod: string;
  browserMinutes: number;
  sandboxStandard1Minutes: number;
  sandboxStandard2Minutes: number;
  crawlPages: number;
  artifactStorageGb: number;
  totalEstimatedRawCostUsd: number;
};

type SandboxUsageByPlanRow = {
  standard1_minutes: number | null;
  standard2_minutes: number | null;
};

async function checkExecutionHealthPressure(env: HostedEnv, ctx: ExecutionContext, scheduledTime: number | undefined): Promise<void> {
  if (!env.DB) {
    return;
  }
  const observedAt = Number.isFinite(scheduledTime)
    ? new Date(scheduledTime as number).toISOString()
    : nowIso();
  const config = executionHealthConfig(env);
  const since = subtractMinutesIso(observedAt, config.windowMinutes);
  for (const lane of [
    { prefix: "browser", label: "Browser Run" },
    { prefix: "sandbox", label: "Sandbox" }
  ] as const) {
    const row = await env.DB.prepare(
      `SELECT
          COUNT(1) AS total,
          COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
          COALESCE(SUM(CASE
            WHEN status = 'failed'
              AND (
                LOWER(COALESCE(error_code, '')) LIKE '%timeout%'
                OR LOWER(COALESCE(error_code, '')) LIKE '%timed_out%'
                OR LOWER(COALESCE(error_message, '')) LIKE '%timeout%'
                OR LOWER(COALESCE(error_message, '')) LIKE '%timed out%'
              )
            THEN 1
            ELSE 0
          END), 0) AS timed_out
        FROM jobs
        WHERE completed_at >= ?
          AND capability LIKE ?
          AND status IN ('completed', 'failed')`
    ).bind(since, `${lane.prefix}.%`).first<ExecutionHealthMetricRow>().catch((error) => {
      console.warn("[vc-tools.executionHealth.metricsFailed]", redactObject({
        lane: lane.prefix,
        message: error instanceof Error ? error.message : String(error)
      }));
      return null;
    });
    maybeScheduleExecutionHealthAlerts(env, ctx, observedAt, config, lane, row);
  }
}

function executionHealthConfig(env: HostedEnv): ExecutionHealthConfig {
  return {
    windowMinutes: integerEnv(
      env.VC_TOOLS_EXECUTION_HEALTH_WINDOW_MINUTES,
      DEFAULT_EXECUTION_HEALTH_WINDOW_MINUTES,
      1,
      MAX_EXECUTION_HEALTH_WINDOW_MINUTES
    ),
    minTerminalJobs: integerEnv(
      env.VC_TOOLS_EXECUTION_HEALTH_MIN_TERMINAL_JOBS,
      DEFAULT_EXECUTION_HEALTH_MIN_TERMINAL_JOBS,
      1,
      10_000
    ),
    failureRatePercent: numberEnv(env.VC_TOOLS_FAILURE_RATE_ALERT_PERCENT, DEFAULT_FAILURE_RATE_ALERT_PERCENT, 0.001, 100),
    timeoutRatePercent: numberEnv(env.VC_TOOLS_TIMEOUT_RATE_ALERT_PERCENT, DEFAULT_TIMEOUT_RATE_ALERT_PERCENT, 0.001, 100)
  };
}

async function checkAuthFailureAnomaly(env: HostedEnv, ctx: ExecutionContext, scheduledTime: number | undefined): Promise<void> {
  if (!env.DB) {
    return;
  }
  const observedAt = Number.isFinite(scheduledTime)
    ? new Date(scheduledTime as number).toISOString()
    : nowIso();
  const config = authFailureAnomalyConfig(env);
  const since = subtractMinutesIso(observedAt, config.windowMinutes);
  const row = await env.DB.prepare(
    "SELECT COUNT(1) AS count_value FROM audit_events WHERE event = 'auth.failed' AND at >= ?"
  ).bind(since).first<{ count_value: number }>().catch((error) => {
    console.warn("[vc-tools.authFailure.metricsFailed]", redactObject({
      message: error instanceof Error ? error.message : String(error)
    }));
    return null;
  });
  const failures = Math.max(0, Math.floor(Number(row?.count_value ?? 0)));
  if (failures < config.alertThreshold) {
    return;
  }
  scheduleAuthFailureAnomalyAlert(env, ctx, observedAt, config, failures);
}

function authFailureAnomalyConfig(env: HostedEnv): AuthFailureAnomalyConfig {
  return {
    windowMinutes: integerEnv(
      env.VC_TOOLS_AUTH_FAILURE_WINDOW_MINUTES,
      DEFAULT_AUTH_FAILURE_WINDOW_MINUTES,
      1,
      MAX_AUTH_FAILURE_WINDOW_MINUTES
    ),
    alertThreshold: integerEnv(
      env.VC_TOOLS_AUTH_FAILURE_ALERT_THRESHOLD,
      DEFAULT_AUTH_FAILURE_ALERT_THRESHOLD,
      1,
      100_000
    )
  };
}

async function checkCloudflareSpendAnomaly(env: HostedEnv, ctx: ExecutionContext, scheduledTime: number | undefined): Promise<void> {
  if (!env.DB) {
    return;
  }
  const observedAt = Number.isFinite(scheduledTime)
    ? new Date(scheduledTime as number).toISOString()
    : nowIso();
  const config = cloudflareSpendAnomalyConfig(env);
  const snapshot = await readCloudflareSpendSnapshot(env.DB, env, observedAt).catch((error) => {
    console.warn("[vc-tools.cloudflareSpend.metricsFailed]", redactObject({
      message: error instanceof Error ? error.message : String(error)
    }));
    return null;
  });
  if (!snapshot || snapshot.totalEstimatedRawCostUsd < config.softCapUsd) {
    return;
  }
  scheduleCloudflareSpendAnomalyAlert(env, ctx, observedAt, config, snapshot);
}

function cloudflareSpendAnomalyConfig(env: HostedEnv): CloudflareSpendAnomalyConfig {
  const hardCapUsd = numberEnv(
    env.VC_TOOLS_CLOUDFLARE_SPEND_HARD_USD,
    DEFAULT_CLOUDFLARE_SPEND_HARD_USD,
    0.01,
    MAX_CLOUDFLARE_SPEND_ALERT_USD
  );
  return {
    softCapUsd: Math.min(
      numberEnv(env.VC_TOOLS_CLOUDFLARE_SPEND_SOFT_USD, DEFAULT_CLOUDFLARE_SPEND_SOFT_USD, 0.01, MAX_CLOUDFLARE_SPEND_ALERT_USD),
      hardCapUsd
    ),
    hardCapUsd
  };
}

async function readCloudflareSpendSnapshot(db: D1Database, env: HostedEnv, observedAt: string): Promise<CloudflareSpendSnapshot> {
  const monthStart = startOfMonthIsoFor(observedAt);
  const assumptions = cogsAssumptions(env);
  const [
    browserMinutes,
    sandboxUsage,
    crawlPages,
    artifactBytes
  ] = await Promise.all([
    sumAccountUsage(db, "browser-minute", monthStart),
    sumAccountSandboxUsageByPlan(db, monthStart),
    sumAccountUsage(db, "crawl-page", monthStart),
    activeAccountArtifactStorageBytes(db, observedAt)
  ]);
  const artifactStorageGb = artifactBytes / 1024 / 1024 / 1024;
  const totalEstimatedRawCostUsd = round4(
    browserMinutes * assumptions.browserMinuteUsd
    + sandboxUsage.standard1Minutes * assumptions.sandboxStandard1MinuteUsd
    + sandboxUsage.standard2Minutes * assumptions.sandboxStandard2MinuteUsd
    + crawlPages * assumptions.crawlPageUsd
    + artifactStorageGb * assumptions.artifactGbMonthUsd
  );
  return {
    billingPeriod: monthResetWindow(observedAt),
    browserMinutes: round2(browserMinutes),
    sandboxStandard1Minutes: round2(sandboxUsage.standard1Minutes),
    sandboxStandard2Minutes: round2(sandboxUsage.standard2Minutes),
    crawlPages: round2(crawlPages),
    artifactStorageGb: round2(artifactStorageGb),
    totalEstimatedRawCostUsd
  };
}

async function sumAccountUsage(db: D1Database, meter: string, since: string): Promise<number> {
  const row = await db.prepare(
    "SELECT COALESCE(SUM(quantity), 0) AS quantity FROM usage_events WHERE meter = ? AND at >= ?"
  ).bind(meter, since).first<{ quantity: number }>();
  return Number(row?.quantity ?? 0);
}

async function sumAccountSandboxUsageByPlan(db: D1Database, since: string): Promise<{ standard1Minutes: number; standard2Minutes: number }> {
  const row = await db.prepare(
    `SELECT
        COALESCE(SUM(CASE WHEN COALESCE(j.plan_name, '') = 'Pro' THEN 0 ELSE u.quantity END), 0) AS standard1_minutes,
        COALESCE(SUM(CASE WHEN COALESCE(j.plan_name, '') = 'Pro' THEN u.quantity ELSE 0 END), 0) AS standard2_minutes
      FROM usage_events u
      LEFT JOIN jobs j ON j.id = u.job_id
      WHERE u.meter = 'sandbox-compute-minute'
        AND u.at >= ?`
  ).bind(since).first<SandboxUsageByPlanRow>();
  return {
    standard1Minutes: Number(row?.standard1_minutes ?? 0),
    standard2Minutes: Number(row?.standard2_minutes ?? 0)
  };
}

async function activeAccountArtifactStorageBytes(db: D1Database, observedAt: string): Promise<number> {
  const row = await db.prepare(
    "SELECT COALESCE(SUM(bytes), 0) AS bytes FROM artifacts WHERE expires_at IS NULL OR expires_at > ?"
  ).bind(observedAt).first<{ bytes: number }>();
  return Number(row?.bytes ?? 0);
}

function maybeScheduleExecutionHealthAlerts(
  env: HostedEnv,
  ctx: ExecutionContext,
  observedAt: string,
  config: ExecutionHealthConfig,
  lane: { prefix: "browser" | "sandbox"; label: string },
  row: ExecutionHealthMetricRow | null
): void {
  const total = Math.max(0, Math.floor(Number(row?.total ?? 0)));
  if (total < config.minTerminalJobs) {
    return;
  }
  const failed = Math.max(0, Math.floor(Number(row?.failed ?? 0)));
  const timedOut = Math.max(0, Math.floor(Number(row?.timed_out ?? 0)));
  const failureRate = round2(percentOf(failed, total));
  const timeoutRate = round2(percentOf(timedOut, total));
  if (failureRate >= config.failureRatePercent) {
    scheduleExecutionHealthAlert({
      env,
      ctx,
      observedAt,
      config,
      lane,
      surface: `${lane.prefix}.failure_rate`,
      rate: failureRate,
      threshold: config.failureRatePercent,
      affectedJobs: failed,
      total,
      timedOut
    });
  }
  if (timeoutRate >= config.timeoutRatePercent) {
    scheduleExecutionHealthAlert({
      env,
      ctx,
      observedAt,
      config,
      lane,
      surface: `${lane.prefix}.timeout_rate`,
      rate: timeoutRate,
      threshold: config.timeoutRatePercent,
      affectedJobs: timedOut,
      total,
      timedOut
    });
  }
}

function scheduleAuthFailureAnomalyAlert(
  env: HostedEnv,
  ctx: ExecutionContext,
  observedAt: string,
  config: AuthFailureAnomalyConfig,
  failures: number
): void {
  const db = env.DB;
  if (!db) {
    return;
  }
  scheduleOperatorAlert({
    db,
    env,
    ctx,
    job: syntheticOperatorJob("auth_failure_anomaly", observedAt),
    subject: "auth.failure_anomaly",
    event: "tools.auth_failure_anomaly_alert",
    payload: buildAuthFailureAnomalyAlert(env, observedAt, config, failures)
  });
}

function scheduleCloudflareSpendAnomalyAlert(
  env: HostedEnv,
  ctx: ExecutionContext,
  observedAt: string,
  config: CloudflareSpendAnomalyConfig,
  snapshot: CloudflareSpendSnapshot
): void {
  const db = env.DB;
  if (!db) {
    return;
  }
  scheduleOperatorAlert({
    db,
    env,
    ctx,
    job: syntheticOperatorJob("cloudflare_spend_anomaly", observedAt),
    subject: "cloudflare.estimated_spend_usd",
    event: "tools.cloudflare_spend_anomaly_alert",
    payload: buildCloudflareSpendAnomalyAlert(env, observedAt, config, snapshot)
  });
}

function scheduleExecutionHealthAlert(input: {
  env: HostedEnv;
  ctx: ExecutionContext;
  observedAt: string;
  config: ExecutionHealthConfig;
  lane: { prefix: "browser" | "sandbox"; label: string };
  surface: ExecutionHealthAlertSurface;
  rate: number;
  threshold: number;
  affectedJobs: number;
  total: number;
  timedOut: number;
}): void {
  const db = input.env.DB;
  if (!db) {
    return;
  }
  const isTimeout = input.surface.endsWith(".timeout_rate");
  scheduleOperatorAlert({
    db,
    env: input.env,
    ctx: input.ctx,
    job: syntheticOperatorJob(`execution_${input.surface.replace(/[^a-z0-9]+/gi, "_")}`, input.observedAt),
    subject: `execution.${input.surface}`,
    event: isTimeout ? "tools.execution_timeout_rate_alert" : "tools.execution_failure_rate_alert",
    payload: buildExecutionHealthAlert(input)
  });
}

function maybeScheduleCapacitySoftCapAlert(input: {
  db: D1Database;
  env: HostedEnv;
  ctx: ExecutionContext;
  job: ToolJobMessage;
  observedAt: string;
  surface: CapacityAlertSurface;
  scope: OperatorAlertScope;
  running: number;
  projected: number;
  limits: { softCap: number; hardCap: number };
}): void {
  const percentUsed = percentOf(input.projected, input.limits.hardCap);
  const threshold = thresholdForPercent(percentUsed);
  if (input.projected < input.limits.softCap && threshold === null) {
    return;
  }

  scheduleOperatorAlert({
    db: input.db,
    env: input.env,
    ctx: input.ctx,
    job: input.job,
    subject: `capacity.${input.surface}`,
    event: "tools.capacity_soft_cap_alert",
    payload: buildCapacitySoftCapAlert(input)
  });
}

function scheduleRetentionCleanupFailureAlert(input: {
  env: HostedEnv;
  ctx: ExecutionContext;
  observedAt: string;
  error: unknown;
}): void {
  const db = input.env.DB;
  if (!db) {
    console.warn("[vc-tools.retentionCleanup.alertSkipped]", {
      reason: "missing_db"
    });
    return;
  }
  scheduleOperatorAlert({
    db,
    env: input.env,
    ctx: input.ctx,
    job: syntheticOperatorJob("retention_cleanup", input.observedAt),
    subject: "retention.cleanup_failed",
    event: "tools.retention_cleanup_failed_alert",
    payload: buildRetentionCleanupFailureAlert(input.env, input.observedAt, input.error)
  });
}

function scheduleHostedWorker5xxAlert(env: HostedEnv, ctx: ExecutionContext, request: Request, error: unknown): void {
  const observedAt = nowIso();
  const job = syntheticOperatorJob("hosted_5xx", observedAt);
  const payload = buildHostedWorker5xxAlert(env, request, observedAt, error);
  if (env.DB) {
    scheduleOperatorAlert({
      db: env.DB,
      env,
      ctx,
      job,
      subject: "hosted.worker_5xx",
      event: "tools.hosted_worker_5xx_alert",
      payload
    });
    return;
  }

  ctx.waitUntil(
    (async () => {
      const delivery = await deliverOperatorAlert(env, payload);
      await recordOperatorAlertDeliveryAudit(env, job, payload, delivery);
    })().catch((alertError) => {
      console.warn("[vc-tools.hostedWorker5xx.alertFailed]", redactObject({
        message: alertError instanceof Error ? alertError.message : String(alertError)
      }));
    })
  );
}

function scheduleOperatorAlert(input: {
  db: D1Database;
  env: HostedEnv;
  ctx: ExecutionContext;
  job: ToolJobMessage;
  subject: string;
  event: string;
  payload: VcToolsOperatorAlert;
}): void {
  input.ctx.waitUntil(
    (async () => {
      const claim = await claimOperatorAlert(input.db, input.payload).catch((error) => {
        console.warn("[vc-tools.operatorAlert.dedupeBypassed]", redactObject({
          surface: input.payload.details.surface,
          message: error instanceof Error ? error.message : String(error)
        }));
        return { shouldSend: true, dedupeBypassed: true };
      });
      if (!claim.shouldSend) {
        await recordAudit(
          input.env,
          "tools.operator_alert_suppressed",
          input.subject,
          syntheticRequest(input.job.id),
          authContextForJob(input.job),
          input.job.id
        ).catch(() => {});
        return;
      }
      await recordAudit(
        input.env,
        input.event,
        input.subject,
        syntheticRequest(input.job.id),
        authContextForJob(input.job),
        input.job.id
      ).catch((error) => {
        console.warn("[vc-tools.operatorAlert.auditFailed]", redactObject({
          surface: input.payload.details.surface,
          message: error instanceof Error ? error.message : String(error)
        }));
      });
      const delivery = await deliverOperatorAlert(input.env, input.payload);
      await recordOperatorAlertDeliveryAudit(input.env, input.job, input.payload, delivery);
    })().catch((error) => {
      console.warn("[vc-tools.operatorAlert.alertFailed]", redactObject({
        surface: input.payload.details.surface,
        message: error instanceof Error ? error.message : String(error)
      }));
    })
  );
}

function syntheticOperatorJob(idPrefix: string, observedAt: string): ToolJobMessage {
  return {
    id: `${idPrefix}_${Date.parse(observedAt) || Date.now()}`,
    capability: "usage.read",
    input: { kind: "job" },
    enqueuedAt: observedAt,
    actorId: "account",
    planName: "Creator",
    retentionDays: 1,
    reservedCredits: 0,
    reservedBrowserSeconds: 0,
    reservedSandboxSeconds: 0
  };
}

function buildCapacitySoftCapAlert(input: {
  env: HostedEnv;
  job: ToolJobMessage;
  observedAt: string;
  surface: CapacityAlertSurface;
  scope: OperatorAlertScope;
  running: number;
  projected: number;
  limits: { softCap: number; hardCap: number };
}): VcToolsOperatorAlert {
  const environment = input.env.VC_TOOLS_PROVIDER_MODE === "live" ? "production" : "contract";
  const threshold = thresholdForPercent(percentOf(input.projected, input.limits.hardCap)) ?? Math.round(percentOf(input.limits.softCap, input.limits.hardCap));
  const label = input.surface === "hosted.active_jobs"
    ? "Hosted vc-tools"
    : input.surface === "browser.active_jobs"
      ? "Browser Run"
      : input.surface === "sandbox.active_jobs"
        ? "Sandbox"
        : input.surface === "queue.backlog_messages"
          ? "vc-tools Queue"
          : input.surface === "queue.dlq_messages"
            ? "vc-tools DLQ"
            : "vc-tools Artifact Storage";
  const percentUsed = round2(percentOf(input.projected, input.limits.hardCap));
  const isQueueSurface = input.surface === "queue.backlog_messages" || input.surface === "queue.dlq_messages";
  const isArtifactStorageSurface = input.surface === "artifact.storage_gb";
  const unit = isQueueSurface ? "messages" : isArtifactStorageSurface ? "GB" : "active jobs";
  const queueAlertTail = input.surface === "queue.dlq_messages"
    ? "failed queue messages need operator inspection."
    : "queued jobs may need operator inspection.";
  const message = isQueueSurface
    ? `${VC_TOOLS_CAPACITY_ALERT_TAG} ${label} backlog is ${percentUsed}% of the configured alert ceiling (${input.projected}/${input.limits.hardCap}); ${queueAlertTail}`
    : isArtifactStorageSurface
      ? `${VC_TOOLS_CAPACITY_ALERT_TAG} ${label} account-wide active storage is ${percentUsed}% of the configured alert ceiling (${round2(input.projected)}/${input.limits.hardCap} GB); inspect retention and artifact growth.`
    : `${VC_TOOLS_CAPACITY_ALERT_TAG} ${label} account-wide active pressure is ${percentUsed}% (${input.projected}/${input.limits.hardCap}); jobs continue until the hard cap and then queue.`;
  const suggestedAction = input.surface === "queue.dlq_messages"
    ? "Inspect vc-tools-jobs-dlq, fix the root cause, and replay only validated messages through the documented operator path."
    : input.surface === "queue.backlog_messages"
      ? "Inspect vc-tools-jobs backlog, active provider pressure, and recent failures before raising account capacity or pausing heavy submissions."
      : isArtifactStorageSurface
        ? "Inspect artifact retention, top storage contributors in the internal COGS dashboard, and cleanup health before raising the storage ceiling."
    : "Watch queue depth and provider account caps; consider pausing heavy runs or raising account capacity before users hit hard cap.";
  const recentTrend = isQueueSurface
    ? `backlog ${input.projected} messages`
    : isArtifactStorageSurface
      ? `active storage ${round2(input.projected)} GB`
    : `running ${input.running}, projected ${input.projected}`;
  return {
    source: "vc-tools",
    environment,
    code: VC_TOOLS_CAPACITY_ALERT_CODE,
    level: "warn",
    message,
    dedupeKey: `vc-tools:capacity:${input.scope}:${input.surface}:account:${threshold}`,
    resetWindow: hourlyResetWindow(input.observedAt),
    details: {
      scope: input.scope,
      surface: input.surface,
      capability: input.job.capability,
      planName: input.job.planName,
      currentUsage: input.projected,
      includedUsage: input.limits.hardCap,
      percentUsed,
      threshold,
      unit,
      recentTrend,
      suggestedAction,
      running: input.running,
      projected: input.projected,
      softCap: input.limits.softCap,
      hardCap: input.limits.hardCap,
      queueMaxConcurrency: DEFAULT_HOSTED_QUEUE_MAX_CONCURRENCY,
      sandboxContainerMaxInstances: sandboxAccountLimits(input.env).hardCap
    },
    timestamp: Date.parse(input.observedAt)
  };
}

function buildRetentionCleanupFailureAlert(env: HostedEnv, observedAt: string, error: unknown): VcToolsOperatorAlert {
  const cleanupError = error instanceof RetentionCleanupError ? error : null;
  const environment = env.VC_TOOLS_PROVIDER_MODE === "live" ? "production" : "contract";
  const failedStage = cleanupError?.failedStage ?? "artifact.cleanup";
  const failedCount = cleanupError?.failedCount ?? 1;
  const errorMessage = sanitizeAlertErrorMessage(error);
  return {
    source: "vc-tools",
    environment,
    code: VC_TOOLS_RETENTION_CLEANUP_ALERT_CODE,
    level: "warn",
    message: `${VC_TOOLS_RETENTION_CLEANUP_ALERT_TAG} Expired artifact cleanup failed during the scheduled Worker pass; account-wide storage pressure may remain stale until cleanup succeeds.`,
    dedupeKey: "vc-tools:ops:account:retention.cleanup_failed",
    resetWindow: hourlyResetWindow(observedAt),
    details: {
      scope: "account",
      surface: "retention.cleanup_failed",
      currentUsage: failedCount,
      includedUsage: 1,
      percentUsed: 100,
      threshold: 100,
      unit: "failures",
      recentTrend: `${failedCount} cleanup failure${failedCount === 1 ? "" : "s"} at ${failedStage}`,
      suggestedAction: "Inspect vc-tools scheduled cleanup logs, R2 delete health, D1 artifact rows, and retry cleanup before raising artifact storage ceilings.",
      running: failedCount,
      projected: failedCount,
      softCap: 1,
      hardCap: 1,
      queueMaxConcurrency: DEFAULT_HOSTED_QUEUE_MAX_CONCURRENCY,
      sandboxContainerMaxInstances: sandboxAccountLimits(env).hardCap,
      failedStage,
      failedCount,
      errorMessage
    },
    timestamp: Date.parse(observedAt)
  };
}

function buildExecutionHealthAlert(input: {
  env: HostedEnv;
  observedAt: string;
  config: ExecutionHealthConfig;
  lane: { prefix: "browser" | "sandbox"; label: string };
  surface: ExecutionHealthAlertSurface;
  rate: number;
  threshold: number;
  affectedJobs: number;
  total: number;
  timedOut: number;
}): VcToolsOperatorAlert {
  const environment = input.env.VC_TOOLS_PROVIDER_MODE === "live" ? "production" : "contract";
  const isTimeout = input.surface.endsWith(".timeout_rate");
  const kind = isTimeout ? "timeout rate" : "failure rate";
  const label = `${input.lane.label} ${kind}`;
  const suggestedAction = input.lane.prefix === "browser"
    ? "Inspect Browser Run provider health, recent vc-tools provider errors, account caps, and representative failed jobs before increasing user-facing availability."
    : "Inspect Sandbox provider health, container startup/runtime errors, recent failed jobs, and quota reservation reconciliation before increasing sandbox availability.";
  return {
    source: "vc-tools",
    environment,
    code: VC_TOOLS_EXECUTION_HEALTH_ALERT_CODE,
    level: "warn",
    message: `${VC_TOOLS_EXECUTION_HEALTH_ALERT_TAG} ${label} is ${input.rate}% (${input.affectedJobs}/${input.total}) over the last ${input.config.windowMinutes} minutes.`,
    dedupeKey: `vc-tools:ops:account:${input.surface}:${input.threshold}`,
    resetWindow: hourlyResetWindow(input.observedAt),
    details: {
      scope: "account",
      surface: input.surface,
      capability: `${input.lane.prefix}.%`,
      currentUsage: input.rate,
      includedUsage: input.threshold,
      percentUsed: input.rate,
      threshold: input.threshold,
      unit: "%",
      recentTrend: `${input.affectedJobs}/${input.total} ${isTimeout ? "timed out" : "failed"} in ${input.config.windowMinutes}m`,
      suggestedAction,
      running: input.affectedJobs,
      projected: input.total,
      softCap: input.threshold,
      hardCap: 100,
      queueMaxConcurrency: DEFAULT_HOSTED_QUEUE_MAX_CONCURRENCY,
      sandboxContainerMaxInstances: sandboxAccountLimits(input.env).hardCap,
      windowMinutes: input.config.windowMinutes,
      terminalJobs: input.total,
      ...(isTimeout ? {} : { failedJobs: input.affectedJobs }),
      timeoutJobs: isTimeout ? input.affectedJobs : input.timedOut
    },
    timestamp: Date.parse(input.observedAt)
  };
}

function buildHostedWorker5xxAlert(env: HostedEnv, request: Request, observedAt: string, error: unknown): VcToolsOperatorAlert {
  const environment = env.VC_TOOLS_PROVIDER_MODE === "live" ? "production" : "contract";
  const method = request.method.toUpperCase();
  const path = sanitizeOperatorAlertPath(new URL(request.url).pathname);
  return {
    source: "vc-tools",
    environment,
    code: VC_TOOLS_HOSTED_WORKER_5XX_ALERT_CODE,
    level: "warn",
    message: `${VC_TOOLS_HOSTED_WORKER_5XX_ALERT_TAG} Hosted vc-tools Worker returned an unexpected HTTP 500 for ${method} ${path}.`,
    dedupeKey: `vc-tools:ops:account:hosted.worker_5xx:${method}:${path}`,
    resetWindow: hourlyResetWindow(observedAt),
    details: {
      scope: "account",
      surface: "hosted.worker_5xx",
      currentUsage: 1,
      includedUsage: 1,
      percentUsed: 100,
      threshold: 100,
      unit: "failures",
      recentTrend: `1 unexpected 500 on ${method} ${path}`,
      suggestedAction: "Inspect vc-tools Worker logs, D1/R2/Queue binding health, and the sanitized failing route before retrying or widening availability.",
      running: 1,
      projected: 1,
      softCap: 1,
      hardCap: 1,
      queueMaxConcurrency: DEFAULT_HOSTED_QUEUE_MAX_CONCURRENCY,
      sandboxContainerMaxInstances: sandboxAccountLimits(env).hardCap,
      errorMessage: sanitizeAlertErrorMessage(error),
      method,
      path,
      status: 500
    },
    timestamp: Date.parse(observedAt)
  };
}

function buildAuthFailureAnomalyAlert(
  env: HostedEnv,
  observedAt: string,
  config: AuthFailureAnomalyConfig,
  failures: number
): VcToolsOperatorAlert {
  const environment = env.VC_TOOLS_PROVIDER_MODE === "live" ? "production" : "contract";
  const percentUsed = round2(percentOf(failures, config.alertThreshold));
  return {
    source: "vc-tools",
    environment,
    code: VC_TOOLS_AUTH_FAILURE_ALERT_CODE,
    level: "warn",
    message: `${VC_TOOLS_AUTH_FAILURE_ALERT_TAG} Hosted vc-tools auth failures reached ${failures} over the last ${config.windowMinutes} minutes.`,
    dedupeKey: `vc-tools:ops:account:auth.failure_anomaly:${config.alertThreshold}`,
    resetWindow: hourlyResetWindow(observedAt),
    details: {
      scope: "account",
      surface: "auth.failure_anomaly",
      currentUsage: failures,
      includedUsage: config.alertThreshold,
      percentUsed,
      threshold: 100,
      unit: "failures",
      recentTrend: `${failures} auth failures in ${config.windowMinutes}m`,
      suggestedAction: "Inspect vc-tools auth.failed audit rows, recent deploy/auth configuration, and client exchange health before changing auth or alert thresholds.",
      running: failures,
      projected: failures,
      softCap: config.alertThreshold,
      hardCap: config.alertThreshold,
      queueMaxConcurrency: DEFAULT_HOSTED_QUEUE_MAX_CONCURRENCY,
      sandboxContainerMaxInstances: sandboxAccountLimits(env).hardCap,
      windowMinutes: config.windowMinutes
    },
    timestamp: Date.parse(observedAt)
  };
}

function buildCloudflareSpendAnomalyAlert(
  env: HostedEnv,
  observedAt: string,
  config: CloudflareSpendAnomalyConfig,
  snapshot: CloudflareSpendSnapshot
): VcToolsOperatorAlert {
  const environment = env.VC_TOOLS_PROVIDER_MODE === "live" ? "production" : "contract";
  const percentUsed = round2(percentOf(snapshot.totalEstimatedRawCostUsd, config.hardCapUsd));
  const threshold = thresholdForPercent(percentUsed) ?? Math.round(percentOf(config.softCapUsd, config.hardCapUsd));
  const estimatedUsd = round2(snapshot.totalEstimatedRawCostUsd);
  return {
    source: "vc-tools",
    environment,
    code: VC_TOOLS_CLOUDFLARE_SPEND_ALERT_CODE,
    level: "warn",
    message: `${VC_TOOLS_CLOUDFLARE_SPEND_ALERT_TAG} Estimated account-level Cloudflare usage spend is ${estimatedUsd} USD (${percentUsed}% of ${config.hardCapUsd} USD) for ${snapshot.billingPeriod}.`,
    dedupeKey: `vc-tools:ops:account:cloudflare.estimated_spend_usd:${snapshot.billingPeriod}:${threshold}`,
    resetWindow: monthResetWindow(observedAt),
    details: {
      scope: "account",
      surface: "cloudflare.estimated_spend_usd",
      currentUsage: estimatedUsd,
      includedUsage: config.hardCapUsd,
      percentUsed,
      threshold,
      unit: "USD",
      recentTrend: `estimated ${estimatedUsd} USD in ${snapshot.billingPeriod}`,
      suggestedAction: "Compare vc-tools internal COGS meters with Cloudflare Billable Usage and Budget Alerts, inspect Browser/Sandbox/Crawl/Artifact contributors, and pause cost-bearing jobs before raising thresholds.",
      running: estimatedUsd,
      projected: estimatedUsd,
      softCap: config.softCapUsd,
      hardCap: config.hardCapUsd,
      queueMaxConcurrency: DEFAULT_HOSTED_QUEUE_MAX_CONCURRENCY,
      sandboxContainerMaxInstances: sandboxAccountLimits(env).hardCap,
      billingPeriod: snapshot.billingPeriod,
      browserMinutes: snapshot.browserMinutes,
      sandboxStandard1Minutes: snapshot.sandboxStandard1Minutes,
      sandboxStandard2Minutes: snapshot.sandboxStandard2Minutes,
      crawlPages: snapshot.crawlPages,
      artifactStorageGb: snapshot.artifactStorageGb,
      estimatedRawCostUsd: snapshot.totalEstimatedRawCostUsd,
      officialBillingSource: "Cloudflare Billable Usage / Budget Alerts"
    },
    timestamp: Date.parse(observedAt)
  };
}

async function claimOperatorAlert(
  db: D1Database,
  payload: VcToolsOperatorAlert
): Promise<{ shouldSend: boolean; dedupeBypassed: boolean }> {
  const observedAt = Number.isFinite(payload.timestamp)
    ? new Date(payload.timestamp).toISOString()
    : nowIso();
  const result = await db.prepare(
    `INSERT INTO operator_alert_dedupe (
      alert_key,
      reset_window,
      source,
      code,
      surface,
      scope,
      threshold_percent,
      actor_id,
      first_seen_at,
      last_seen_at,
      sent_at,
      suppressed_count,
      details_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(alert_key, reset_window) DO NOTHING`
  ).bind(
    payload.dedupeKey,
    payload.resetWindow,
    payload.source,
    payload.code,
    payload.details.surface,
    payload.details.scope,
    payload.details.threshold,
    null,
    observedAt,
    observedAt,
    observedAt,
    JSON.stringify(payload.details)
  ).run();

  if (d1ChangedRows(result) > 0) {
    return { shouldSend: true, dedupeBypassed: false };
  }

  await db.prepare(
    `UPDATE operator_alert_dedupe
        SET suppressed_count = suppressed_count + 1,
            last_seen_at = ?,
            details_json = ?
      WHERE alert_key = ?
        AND reset_window = ?`
  ).bind(observedAt, JSON.stringify(payload.details), payload.dedupeKey, payload.resetWindow).run();

  return { shouldSend: false, dedupeBypassed: false };
}

async function deliverOperatorAlert(env: HostedEnv, payload: VcToolsOperatorAlert): Promise<OperatorAlertDeliveryResult> {
  const deliveries: Array<Promise<boolean>> = [];
  const body = JSON.stringify(payload);

  if (env.VC_TOOLS_INTERNAL_API_WORKER && env.VC_TOOLS_INTERNAL_ALERT_TOKEN?.trim()) {
    deliveries.push(deliverInternalOperatorAlert(env, body));
  }

  for (const url of operatorWebhookUrls(env)) {
    deliveries.push(deliverWebhookOperatorAlert(env, url, body));
  }

  const ntfyTopic = env.VC_TOOLS_OPERATOR_NTFY_TOPIC?.trim();
  if (ntfyTopic) {
    deliveries.push(deliverNtfyOperatorAlert(ntfyTopic, payload));
  }

  if (deliveries.length === 0) {
    console.warn("[vc-tools.operatorAlert.deliveryNotConfigured]", {
      code: payload.code,
      surface: payload.details.surface
    });
    return { configured: false, delivered: false, channels: 0 };
  }

  const results = await Promise.allSettled(deliveries);
  const delivered = results.some((result) => result.status === "fulfilled" && result.value);
  if (!delivered) {
    console.warn("[vc-tools.operatorAlert.deliveryFailed]", {
      code: payload.code,
      surface: payload.details.surface,
      channels: results.length
    });
  }
  return { configured: true, delivered, channels: results.length };
}

async function recordOperatorAlertDeliveryAudit(
  env: HostedEnv,
  job: ToolJobMessage,
  payload: VcToolsOperatorAlert,
  delivery: OperatorAlertDeliveryResult
): Promise<void> {
  if (delivery.delivered) {
    return;
  }
  await recordAudit(
    env,
    delivery.configured ? "tools.operator_alert_delivery_failed" : "tools.operator_alert_delivery_unconfigured",
    `${payload.details.scope}.${payload.details.surface}`,
    syntheticRequest(job.id),
    authContextForJob(job),
    job.id
  ).catch((error) => {
    console.warn("[vc-tools.operatorAlert.deliveryAuditFailed]", redactObject({
      code: payload.code,
      surface: payload.details.surface,
      channels: delivery.channels,
      message: error instanceof Error ? error.message : String(error)
    }));
  });
}

async function deliverInternalOperatorAlert(env: HostedEnv, body: string): Promise<boolean> {
  const token = env.VC_TOOLS_INTERNAL_ALERT_TOKEN?.trim();
  const worker = env.VC_TOOLS_INTERNAL_API_WORKER;
  if (!worker || !token) {
    return false;
  }
  const headers = new Headers({
    "content-type": "application/json"
  });
  const signedHeaders = await signInternalAlertHeaders(token, {
    method: "POST",
    url: INTERNAL_ALERT_URL,
    body
  });
  for (const [key, value] of Object.entries(signedHeaders)) {
    headers.set(key, value);
  }
  const response = await worker.fetch(new Request(INTERNAL_ALERT_URL, {
    method: "POST",
    headers,
    body
  }));
  return response.ok;
}

async function deliverWebhookOperatorAlert(env: HostedEnv, url: string, body: string): Promise<boolean> {
  const headers = new Headers({
    "content-type": "application/json"
  });
  const bearer = env.VC_TOOLS_OPERATOR_ALERT_WEBHOOK_BEARER_TOKEN?.trim();
  if (bearer) {
    headers.set("authorization", `Bearer ${bearer}`);
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body
  });
  return response.ok;
}

async function deliverNtfyOperatorAlert(topic: string, payload: VcToolsOperatorAlert): Promise<boolean> {
  const response = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers: {
      Title: `[vibecodr][vc-tools] ${payload.details.surface} alert`,
      Priority: "high",
      Tags: payload.environment === "production" ? "rotating_light,production" : "warning,staging"
    },
    body: `${payload.message}\n\nUsage: ${payload.details.currentUsage}/${payload.details.includedUsage} ${payload.details.unit}\nThreshold: ${payload.details.threshold}%\nAction: ${payload.details.suggestedAction}`
  });
  return response.ok;
}

function operatorWebhookUrls(env: HostedEnv): string[] {
  const raw = env.VC_TOOLS_OPERATOR_ALERT_WEBHOOK_URLS?.trim();
  if (!raw) {
    return [];
  }

  const candidates = raw.startsWith("[") ? parseJsonStringArray(raw) : raw.split(/[\n,]/);
  const urls: string[] = [];
  for (const value of candidates) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "https:" || url.username || url.password) {
        continue;
      }
      urls.push(url.toString());
    } catch {
      continue;
    }
  }
  return Array.from(new Set(urls));
}

function parseJsonStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function integerEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function numberEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function operatorFlagEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

function disabledCostBearingReason(env: HostedEnv, capability: CapabilityName): string | null {
  if (!isCostBearingCapability(capability)) {
    return null;
  }
  if (operatorFlagEnabled(env.VC_TOOLS_PAUSE_COST_BEARING_JOBS)) {
    return "all_cost_bearing";
  }
  if (BROWSER_RUN_CAPABILITIES.has(capability) && operatorFlagEnabled(env.VC_TOOLS_DISABLE_BROWSER_RUN)) {
    return "browser_run";
  }
  if (BROWSER_SESSION_CAPABILITIES.has(capability) && operatorFlagEnabled(env.VC_TOOLS_DISABLE_BROWSER_SESSIONS)) {
    return "browser_sessions";
  }
  if (SANDBOX_CAPABILITIES.has(capability) && operatorFlagEnabled(env.VC_TOOLS_DISABLE_SANDBOX)) {
    return "sandbox";
  }
  return null;
}

async function ensureCostBearingCapabilityEnabled(
  env: HostedEnv,
  request: Request,
  auth: AuthContext,
  capability: CapabilityName
): Promise<void> {
  const disabledReason = disabledCostBearingReason(env, capability);
  if (!disabledReason) {
    return;
  }
  await recordAudit(env, "tools.cost_bearing_paused", `${capability}:${disabledReason}`, request, auth).catch((error) => {
    console.warn("[vc-tools.costBearingPause.auditFailed]", redactObject({
      capability,
      disabledReason,
      message: error instanceof Error ? error.message : String(error)
    }));
  });
  throw new HostedError(503, "ops.cost_bearing_paused", `${capability} is temporarily paused by the vc-tools operator.`, {
    disabledReason
  });
}

async function enforceQuota(
  db: D1Database,
  auth: AuthContext,
  env: HostedEnv,
  capability: CapabilityName,
  input: NormalizedToolInput
): Promise<void> {
  const plan = activePlanForAuth(auth, env);
  if (!isCostBearingCapability(capability)) {
    return;
  }

  if (plan.limits.monthlyCredits <= 0) {
    throw new HostedError(403, "quota.plan_denied", `${capability} is not enabled for the active vc-tools plan.`);
  }

  if (input.kind === "browser") {
    const maxBrowserSeconds = capability === "browser.agent_task"
      ? plan.limits.browser.maxBrowserSessionSeconds
      : plan.limits.browser.maxBrowserSecondsPerRun;
    const maxRunMs = maxBrowserSeconds * 1000;
    if (input.timeoutMs > maxRunMs) {
      throw new HostedError(429, "quota.browser_run_timeout_exceeded", `Browser run timeout exceeds the ${plan.name} plan cap of ${maxBrowserSeconds}s.`);
    }
    if (capability === "browser.agent_task") {
      if (!plan.limits.browser.allowBrowserSessions || plan.limits.browser.maxConcurrentBrowserSessionsPerUser <= 0) {
        throw new HostedError(403, "quota.plan_denied", "Browser agent tasks are not enabled for the active vc-tools plan.");
      }
      const activeBrowserSessionRow = await db.prepare(
        "SELECT COUNT(1) AS count_value FROM jobs WHERE actor_id = ? AND capability = 'browser.agent_task' AND status IN ('queued', 'running')"
      ).bind(auth.actorId).first<{ count_value: number }>();
      if (Number(activeBrowserSessionRow?.count_value ?? 0) >= plan.limits.browser.maxConcurrentBrowserSessionsPerUser) {
        throw new HostedError(429, "quota.browser_session_concurrent_jobs_exceeded", `Browser agent task concurrency is full for the active ${plan.name} plan.`);
      }
    }
    if (capability === "browser.crawl_site") {
      if (plan.posture.crawl === "disabled") {
        throw new HostedError(403, "quota.plan_denied", "Public crawl is not enabled for the active vc-tools plan.");
      }
      const maxPages = input.maxPages ?? DEFAULT_BROWSER_CRAWL_PAGES_PER_RUN;
      const maxDepth = input.maxDepth ?? DEFAULT_BROWSER_CRAWL_DEPTH;
      if (maxPages > plan.limits.crawl.maxPagesPerRun) {
        throw new HostedError(429, "quota.crawl_pages_per_run_exceeded", `Crawl page limit exceeds the ${plan.name} plan cap of ${plan.limits.crawl.maxPagesPerRun} pages per run.`);
      }
      if (maxDepth > plan.limits.crawl.maxDepth) {
        throw new HostedError(429, "quota.crawl_depth_exceeded", `Crawl depth exceeds the ${plan.name} plan cap of ${plan.limits.crawl.maxDepth}.`);
      }
    }
  }

  const activeRow = await db.prepare(
    "SELECT COUNT(1) AS count_value FROM jobs WHERE actor_id = ? AND status IN ('queued', 'running')"
  ).bind(auth.actorId).first<{ count_value: number }>();
  if (Number(activeRow?.count_value ?? 0) >= plan.limits.maxConcurrentRuns) {
    throw new HostedError(429, "quota.concurrent_runs_exceeded", `VC Tools concurrent run limit reached for the active ${plan.name} plan.`);
  }

  const monthStart = startOfMonthIso();
  const dayStart = startOfDayIso();
  if (input.kind === "browser" && capability === "browser.crawl_site") {
    const monthlyCrawlPages = await sumUsage(db, auth, "crawl-page", monthStart);
    const requestedPages = input.maxPages ?? DEFAULT_BROWSER_CRAWL_PAGES_PER_RUN;
    if (monthlyCrawlPages + requestedPages > plan.limits.crawl.maxPagesPerMonth) {
      throw new HostedError(429, "quota.crawl_monthly_pages_exceeded", "Monthly crawl page quota has been reached for the active vc-tools plan.");
    }
  }
  const [monthlyCreditJobs, dailyCreditJobs] = await Promise.all([
    countCostBearingJobs(db, auth, monthStart),
    countCostBearingJobs(db, auth, dayStart)
  ]);
  if (monthlyCreditJobs >= plan.limits.monthlyCredits) {
    throw new HostedError(429, "quota.exceeded", `${capability} monthly VC Tool credit quota has been reached for the active vc-tools plan.`);
  }
  if (dailyCreditJobs >= plan.limits.dailyCredits) {
    throw new HostedError(429, "quota.daily_exceeded", `${capability} daily VC Tool credit quota has been reached for the active vc-tools plan.`);
  }

  if (input.kind === "sandbox") {
    const maxSandboxTaskSeconds = plan.limits.sandbox.maxSandboxTaskSeconds;
    if (maxSandboxTaskSeconds <= 0) {
      throw new HostedError(403, "quota.plan_denied", "Sandbox tools are not enabled for the active vc-tools plan.");
    }
    if (input.timeoutMs > maxSandboxTaskSeconds * 1000) {
      throw new HostedError(429, "quota.sandbox_timeout_exceeded", `Sandbox task timeout exceeds the ${plan.name} plan cap of ${maxSandboxTaskSeconds}s.`);
    }
    const activeSandboxRow = await db.prepare(
      "SELECT COUNT(1) AS count_value FROM jobs WHERE actor_id = ? AND capability LIKE 'sandbox.%' AND status IN ('queued', 'running')"
    ).bind(auth.actorId).first<{ count_value: number }>();
    if (Number(activeSandboxRow?.count_value ?? 0) >= plan.limits.concurrentSandboxJobs) {
      throw new HostedError(429, "quota.sandbox_concurrent_jobs_exceeded", `Sandbox concurrent job limit reached for the active ${plan.name} plan.`);
    }
    const monthlySandboxMinutes = await sumUsage(db, auth, "sandbox-compute-minute", monthStart);
    const runSeconds = Math.ceil(input.timeoutMs / 1000);
    if (monthlySandboxMinutes * 60 + runSeconds > plan.limits.sandboxMinutesMonthly * 60) {
      throw new HostedError(429, "quota.sandbox_monthly_seconds_exceeded", "Monthly Sandbox seconds quota has been reached for the active vc-tools plan.");
    }
  }

  if (input.kind === "browser") {
    const [monthlyBrowserMinutes, dailyBrowserMinutes] = await Promise.all([
      sumUsage(db, auth, "browser-minute", monthStart),
      sumUsage(db, auth, "browser-minute", dayStart)
    ]);
    const runSeconds = Math.ceil(input.timeoutMs / 1000);
    if (monthlyBrowserMinutes * 60 + runSeconds > plan.limits.browser.monthlyBrowserSeconds) {
      throw new HostedError(429, "quota.browser_monthly_seconds_exceeded", "Monthly Browser Run seconds quota has been reached for the active vc-tools plan.");
    }
    if (dailyBrowserMinutes * 60 + runSeconds > plan.limits.browser.dailyBrowserSeconds) {
      throw new HostedError(429, "quota.browser_daily_seconds_exceeded", "Daily Browser Run seconds quota has been reached for the active vc-tools plan.");
    }
  }

  if (input.kind === "browser" || input.kind === "sandbox") {
    await assertArtifactStorageAvailable(db, auth.actorId, plan, 1);
  }
}

interface QueuedJobReservation {
  id: string;
  actorId: string;
  planName: string;
  capability: CapabilityName;
  input: NormalizedToolInput;
  createdAt: string;
  updatedAt: string;
  reservedCredits: number;
  reservedBrowserSeconds: number;
  reservedSandboxSeconds: number;
  queue: QueueFairnessState;
}

interface QueueFairnessState {
  globalQueuedAhead: number;
  actorQueuedAhead: number;
  fairDelaySeconds: number;
}

async function readQueueFairnessState(db: D1Database, actorId: string, options: { spreadDelay?: boolean } = {}): Promise<QueueFairnessState> {
  const globalRow = await db.prepare("SELECT COUNT(1) AS count_value FROM jobs WHERE status = 'queued'")
    .first<{ count_value: number }>();
  const actorRow = await db.prepare("SELECT COUNT(1) AS count_value FROM jobs WHERE actor_id = ? AND status = 'queued'")
    .bind(actorId)
    .first<{ count_value: number }>();
  const globalQueuedAhead = Number(globalRow?.count_value ?? 0);
  const actorQueuedAhead = Number(actorRow?.count_value ?? 0);
  return {
    globalQueuedAhead,
    actorQueuedAhead,
    fairDelaySeconds: options.spreadDelay === true ? fairQueueDelaySeconds(actorQueuedAhead) : 0
  };
}

function shouldSpreadQueuedJob(auditPrefix: "tools" | "scheduled_qa", _capability: CapabilityName): boolean {
  return auditPrefix === "scheduled_qa";
}

function queueSendOptions(queue: QueueFairnessState): QueueSendOptions | undefined {
  return queue.fairDelaySeconds > 0 ? { delaySeconds: queue.fairDelaySeconds } : undefined;
}

function fairQueueDelaySeconds(actorQueuedAhead: number): number {
  if (!Number.isFinite(actorQueuedAhead) || actorQueuedAhead <= 0) {
    return 0;
  }
  return Math.min(MAX_FAIR_QUEUE_DELAY_SECONDS, Math.ceil(actorQueuedAhead) * FAIR_QUEUE_DELAY_PER_ACTOR_JOB_SECONDS);
}

async function insertQueuedJobWithQuotaReservation(db: D1Database, job: QueuedJobReservation, plan: Plan): Promise<boolean> {
  const monthStart = startOfMonthIso();
  const dayStart = startOfDayIso();
  const result = await db.prepare(
    `INSERT INTO jobs (
      id,
      actor_id,
      plan_name,
      capability,
      status,
      input_json,
      provider_mode,
      queue_global_ahead,
      queue_actor_ahead,
      queue_delay_seconds,
      created_at,
      updated_at,
      reserved_credits,
      reserved_browser_seconds,
      reserved_sandbox_seconds
    )
    SELECT ?, ?, ?, ?, 'queued', ?, 'live', ?, ?, ?, ?, ?, ?, ?, ?
    WHERE
      (SELECT COUNT(1) FROM jobs WHERE actor_id = ? AND status IN ('queued', 'running')) < ?
      AND (? = 0 OR (SELECT COUNT(1) FROM jobs WHERE actor_id = ? AND capability = 'browser.agent_task' AND status IN ('queued', 'running')) < ?)
      AND (? = 0 OR (SELECT COUNT(1) FROM jobs WHERE actor_id = ? AND capability LIKE 'sandbox.%' AND status IN ('queued', 'running')) < ?)
      AND (SELECT COALESCE(SUM(reserved_credits), 0) FROM jobs WHERE actor_id = ? AND created_at >= ?) + ? <= ?
      AND (SELECT COALESCE(SUM(reserved_credits), 0) FROM jobs WHERE actor_id = ? AND created_at >= ?) + ? <= ?
      AND (? = 0 OR (SELECT COALESCE(SUM(reserved_browser_seconds), 0) FROM jobs WHERE actor_id = ? AND created_at >= ?) + ? <= ?)
      AND (? = 0 OR (SELECT COALESCE(SUM(reserved_browser_seconds), 0) FROM jobs WHERE actor_id = ? AND created_at >= ?) + ? <= ?)
      AND (? = 0 OR (SELECT COALESCE(SUM(reserved_sandbox_seconds), 0) FROM jobs WHERE actor_id = ? AND created_at >= ?) + ? <= ?)`
  ).bind(
    job.id,
    job.actorId,
    job.planName,
    job.capability,
    JSON.stringify(job.input),
    job.queue.globalQueuedAhead,
    job.queue.actorQueuedAhead,
    job.queue.fairDelaySeconds,
    job.createdAt,
    job.updatedAt,
    job.reservedCredits,
    job.reservedBrowserSeconds,
    job.reservedSandboxSeconds,
    job.actorId,
    plan.limits.maxConcurrentRuns,
    job.capability === "browser.agent_task" ? 1 : 0,
    job.actorId,
    plan.limits.browser.maxConcurrentBrowserSessionsPerUser,
    job.input.kind === "sandbox" ? 1 : 0,
    job.actorId,
    plan.limits.concurrentSandboxJobs,
    job.actorId,
    monthStart,
    job.reservedCredits,
    plan.limits.monthlyCredits,
    job.actorId,
    dayStart,
    job.reservedCredits,
    plan.limits.dailyCredits,
    job.reservedBrowserSeconds,
    job.actorId,
    monthStart,
    job.reservedBrowserSeconds,
    plan.limits.browser.monthlyBrowserSeconds,
    job.reservedBrowserSeconds,
    job.actorId,
    dayStart,
    job.reservedBrowserSeconds,
    plan.limits.browser.dailyBrowserSeconds,
    job.reservedSandboxSeconds,
    job.actorId,
    monthStart,
    job.reservedSandboxSeconds,
    plan.limits.sandboxMinutesMonthly * 60
  ).run();
  return d1ChangedRows(result) > 0;
}

function d1ChangedRows(result: D1Result): number {
  const meta = result.meta as { changes?: unknown } | undefined;
  const changes = meta && typeof meta.changes === "number" ? meta.changes : undefined;
  if (changes !== undefined) {
    return changes;
  }
  return result.success ? 1 : 0;
}

function isCostBearingCapability(capability: CapabilityName): boolean {
  return capability.startsWith("browser.") || capability.startsWith("sandbox.");
}

function monthlyJobLimit(plan: (typeof DEFAULT_PLANS)[number], capability: CapabilityName): number | undefined {
  if (capability.startsWith("browser.")) {
    return plan.limits.browserRenderJobsMonthly;
  }
  if (capability.startsWith("sandbox.")) {
    return plan.limits.sandboxJobsMonthly;
  }
  return undefined;
}

function activePlan(env: HostedEnv): Plan {
  return planByName(env.VC_TOOLS_PLAN_NAME ?? "Creator");
}

function activePlanForAuth(auth: AuthContext, env: HostedEnv): Plan {
  return auth.tokenKind === "static" ? activePlan(env) : planByName(auth.planName);
}

function planByName(value: string): Plan {
  const normalized = normalizePlanName(value).toLowerCase();
  return DEFAULT_PLANS.find((plan) => plan.name.toLowerCase() === normalized) ?? DEFAULT_PLANS[0];
}

function normalizePlanName(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "starter") {
    return "Creator";
  }
  const plan = DEFAULT_PLANS.find((candidate) => candidate.name.toLowerCase() === normalized);
  return plan?.name ?? "Free";
}

function capabilitiesForPlan(plan: Plan): CapabilityName[] {
  return CAPABILITIES.filter((capability) => capabilityAllowedForPlan(capability, plan));
}

function grantsForPlan(plan: Plan): Array<Record<string, unknown>> {
  return LAUNCH_TOOL_GRANTS.map((grant) => ({
    ...grant,
    granted: grantAllowsPlan(grant, plan)
  }));
}

function ensureCapabilityAllowed(auth: AuthContext, env: HostedEnv, capability: CapabilityName): void {
  if (!auth.scopes.includes(VC_TOOLS_GRANT_SCOPE)) {
    throw new HostedError(403, "auth.scope_denied", "Token does not include the vc-tools grant scope.");
  }
  if (auth.tokenKind === "cli_grant" && !capabilityScopeAllowed(auth, capability)) {
    throw new HostedError(403, "auth.capability_scope_denied", `Token does not include the ${capability} tool scope.`);
  }
  const plan = activePlanForAuth(auth, env);
  if (!capabilityAllowedForPlan(capability, plan)) {
    throw new HostedError(403, "quota.plan_denied", `${capability} is not enabled for the active vc-tools plan.`);
  }
}

async function ensureCapabilityAllowedWithDenialMetrics(auth: AuthContext, env: HostedEnv, request: Request, capability: CapabilityName): Promise<void> {
  try {
    ensureCapabilityAllowed(auth, env, capability);
  } catch (error) {
    await recordHostedDenialMetricIfNeeded(env, request, auth, capability, error);
    throw error;
  }
}

async function ensureCapabilityScopeAllowedWithDenialMetrics(auth: AuthContext, env: HostedEnv, request: Request, capability: CapabilityName): Promise<void> {
  try {
    ensureCapabilityScopeAllowed(auth, capability);
  } catch (error) {
    await recordHostedDenialMetricIfNeeded(env, request, auth, capability, error);
    throw error;
  }
}

function ensureCapabilityScopeAllowed(auth: AuthContext, capability: CapabilityName): void {
  if (!auth.scopes.includes(VC_TOOLS_GRANT_SCOPE)) {
    throw new HostedError(403, "auth.scope_denied", "Token does not include the vc-tools grant scope.");
  }
  if (auth.tokenKind === "cli_grant" && !capabilityScopeAllowed(auth, capability)) {
    throw new HostedError(403, "auth.capability_scope_denied", `Token does not include the ${capability} tool scope.`);
  }
}

async function ensureAnyScheduledQaCapabilityAllowedWithDenialMetrics(auth: AuthContext, env: HostedEnv, request: Request): Promise<void> {
  try {
    ensureAnyScheduledQaCapabilityAllowed(auth, env);
  } catch (error) {
    await recordHostedDenialMetricIfNeeded(env, request, auth, "browser.render_url", error);
    throw error;
  }
}

function ensureAnyScheduledQaCapabilityAllowed(auth: AuthContext, env: HostedEnv): void {
  if (!auth.scopes.includes(VC_TOOLS_GRANT_SCOPE)) {
    throw new HostedError(403, "auth.scope_denied", "Token does not include the vc-tools grant scope.");
  }

  const plan = activePlanForAuth(auth, env);
  const planAllowsScheduledQaCapability = Array.from(SCHEDULED_QA_CAPABILITIES).some((capability) =>
    capabilityAllowedForPlan(capability, plan)
  );
  if (!planAllowsScheduledQaCapability) {
    throw new HostedError(403, "quota.plan_denied", "Scheduled QA is not enabled for the active vc-tools plan.");
  }

  if (
    auth.tokenKind === "cli_grant" &&
    !Array.from(SCHEDULED_QA_CAPABILITIES).some((capability) => capabilityScopeAllowed(auth, capability))
  ) {
    throw new HostedError(403, "auth.capability_scope_denied", "Token does not include a Scheduled QA browser tool scope.");
  }
}

async function normalizeHostedToolInputWithDenialMetrics(
  capability: CapabilityName,
  input: Record<string, unknown>,
  env: HostedEnv,
  request: Request,
  auth: AuthContext
): Promise<NormalizedToolInput> {
  try {
    return normalizeHostedToolInput(capability, input);
  } catch (error) {
    await recordHostedDenialMetricIfNeeded(env, request, auth, capability, error);
    throw error;
  }
}

function capabilityScopeAllowed(auth: AuthContext, capability: CapabilityName): boolean {
  if (capability === "usage.read") {
    return true;
  }
  return auth.scopes.includes("vc-tools:*") || auth.scopes.includes(`vc-tools:${capability}`) || auth.scopes.includes(capability);
}

async function assertSandboxOutboundTarget(request: Request): Promise<void> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    throw sandboxNetworkPolicyError("Sandbox network request must target a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw sandboxNetworkPolicyError("Sandbox network only permits HTTP and HTTPS requests.");
  }
  if (url.username || url.password) {
    throw sandboxNetworkPolicyError("Sandbox network requests must not include URL credentials.");
  }
  const hostname = normalizedHostname(url.hostname);
  if (!hostname || isBlockedHostname(hostname)) {
    throw sandboxNetworkPolicyError("Sandbox network blocked a private, local, or internal destination.");
  }
  await assertPublicDnsHostname(hostname, SANDBOX_DNS_SAFETY_ERRORS);
}

function sandboxOutboundDenied(error: unknown): Response {
  const message = error instanceof HostedError ? error.message : "Sandbox network blocked an unsafe destination.";
  return new Response(message, {
    status: error instanceof HostedError ? error.status : 403,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}

function sandboxNetworkPolicyError(message: string): HostedError {
  return new HostedError(403, "policy.sandbox_network_denied", message);
}

function capabilityAllowedForPlan(capability: CapabilityName, plan: Plan): boolean {
  if (capability.startsWith("job.")) {
    return plan.limits.monthlyCredits > 0;
  }
  if (capability.startsWith("browser.")) {
    return (monthlyJobLimit(plan, capability) ?? 0) > 0 && LAUNCH_TOOL_GRANTS.some((grant) => grant.capability === capability && grantAllowsPlan(grant, plan));
  }
  if (capability.startsWith("sandbox.")) {
    return (monthlyJobLimit(plan, capability) ?? 0) > 0 && LAUNCH_TOOL_GRANTS.some((grant) => grant.capability === capability && grantAllowsPlan(grant, plan));
  }
  return LAUNCH_TOOL_GRANTS.some((grant) => grant.capability === capability && grantAllowsPlan(grant, plan));
}

function grantAllowsPlan(grant: (typeof LAUNCH_TOOL_GRANTS)[number], plan: Plan): boolean {
  return (grant.allowedPlans as readonly string[]).includes(plan.name);
}

function sanitizeActorId(value: string): string {
  return value.replace(/[^A-Za-z0-9:_-]/g, "_").slice(0, 160) || "anonymous";
}

function authContextForJob(job: ToolJobMessage): AuthContext {
  return {
    ok: true,
    actorId: job.actorId,
    tokenKind: "cli_grant",
    planName: job.planName,
    scopes: [VC_TOOLS_GRANT_SCOPE]
  };
}

function retentionDaysForJob(job: ToolJobMessage): number {
  return Math.max(1, Math.min(365, job.retentionDays || planByName(job.planName).limits.artifactRetentionDays || 1));
}

async function listJobs(db: D1Database, auth: AuthContext, limit: number): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(
    "SELECT id, actor_id, plan_name, capability, status, input_json, result_json, error_code, error_message, provider_mode, queue_global_ahead, queue_actor_ahead, queue_delay_seconds, created_at, updated_at, started_at, completed_at, canceled_at FROM jobs WHERE actor_id = ? ORDER BY created_at DESC LIMIT ?"
  ).bind(auth.actorId, limit).all<JobRow>();
  return (result.results ?? []).map(jobRowToPublic);
}

async function getJob(db: D1Database, id: string, auth: AuthContext): Promise<Record<string, unknown> | undefined> {
  const row = await db.prepare(
    "SELECT id, actor_id, plan_name, capability, status, input_json, result_json, error_code, error_message, provider_mode, queue_global_ahead, queue_actor_ahead, queue_delay_seconds, created_at, updated_at, started_at, completed_at, canceled_at FROM jobs WHERE id = ? AND actor_id = ?"
  ).bind(id, auth.actorId).first<JobRow>();
  return row ? jobRowToPublic(row) : undefined;
}

function jobRowToPublic(row: JobRow): Record<string, unknown> {
  return {
    id: row.id,
    actorId: row.actor_id,
    plan: row.plan_name,
    capability: row.capability,
    status: row.status,
    result: safeJson(row.result_json),
    error: row.error_code ? { code: row.error_code, message: row.error_message } : undefined,
    queue: {
      globalQueuedAhead: Number(row.queue_global_ahead ?? 0),
      actorQueuedAhead: Number(row.queue_actor_ahead ?? 0),
      fairDelaySeconds: Number(row.queue_delay_seconds ?? 0)
    },
    providerMode: row.provider_mode,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    canceledAt: row.canceled_at
  };
}

async function listArtifacts(db: D1Database, auth: AuthContext, env: HostedEnv, limit: number): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(
    "SELECT id, actor_id, job_id, kind, key, content_type, bytes, created_at, expires_at FROM artifacts WHERE actor_id = ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT ?"
  ).bind(auth.actorId, nowIso(), limit).all<ArtifactRow>();
  return (result.results ?? []).map((row) => artifactRowToPublic(row, env));
}

async function getArtifact(db: D1Database, id: string, auth: AuthContext, env: HostedEnv): Promise<Record<string, unknown> | undefined> {
  const row = await db.prepare(
    "SELECT id, actor_id, job_id, kind, key, content_type, bytes, created_at, expires_at FROM artifacts WHERE id = ? AND actor_id = ? AND (expires_at IS NULL OR expires_at > ?)"
  ).bind(id, auth.actorId, nowIso()).first<ArtifactRow>();
  return row ? artifactRowToPublic(row, env) : undefined;
}

function artifactRowToPublic(row: ArtifactRow, env: HostedEnv): Record<string, unknown> {
  return {
    id: row.id,
    actorId: row.actor_id,
    jobId: row.job_id,
    kind: row.kind,
    contentType: row.content_type,
    bytes: row.bytes,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    downloadUrl: `${publicBase(env)}/v1/artifacts/${encodeURIComponent(row.id)}/download`
  };
}

async function downloadArtifact(db: D1Database, bucket: R2Bucket, id: string, request: Request, auth: AuthContext): Promise<Response> {
  const row = await db.prepare(
    "SELECT id, actor_id, job_id, kind, key, content_type, bytes, created_at, expires_at FROM artifacts WHERE id = ? AND actor_id = ?"
  ).bind(id, auth.actorId).first<ArtifactRow>();
  if (!row) {
    return json({ id, status: "not_found", providerMode: "live" }, 404, request);
  }
  if (isExpiredIso(row.expires_at)) {
    return json({ id, status: "expired", providerMode: "live" }, 410, request);
  }
  const object = await bucket.get(row.key);
  if (!object) {
    return json({ id, status: "missing_bytes", providerMode: "live" }, 404, request);
  }
  return new Response(object.body, {
    status: 200,
    headers: {
      "content-type": row.content_type,
      "content-length": String(row.bytes),
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="${safeDownloadName(row)}"`,
      ...corsHeaders(request)
    }
  });
}

async function deleteArtifact(db: D1Database, bucket: R2Bucket, id: string, request: Request, auth: AuthContext): Promise<Record<string, unknown>> {
  void request;
  const row = await db.prepare(
    "SELECT id, actor_id, job_id, kind, key, content_type, bytes, created_at, expires_at FROM artifacts WHERE id = ? AND actor_id = ?"
  ).bind(id, auth.actorId).first<ArtifactRow>();
  if (!row) {
    return { id, status: "not_found", providerMode: "live" };
  }
  await bucket.delete(row.key);
  await db.prepare("DELETE FROM artifacts WHERE id = ? AND actor_id = ?").bind(id, auth.actorId).run();
  return {
    id,
    status: "deleted",
    kind: row.kind,
    bytes: row.bytes,
    expired: isExpiredIso(row.expires_at),
    auditLogged: true,
    providerMode: "live"
  };
}

async function cleanupExpiredArtifacts(env: HostedEnv): Promise<void> {
  if (providerMode(env) !== "live") {
    return;
  }
  const live = requireLiveBindings(env, ["DB", "ARTIFACTS"]);
  const expired = await live.DB.prepare(
    "SELECT id, key FROM artifacts WHERE expires_at IS NOT NULL AND expires_at <= ? ORDER BY expires_at ASC LIMIT 100"
  ).bind(nowIso()).all<{ id: string; key: string }>().catch((error) => {
    throw new RetentionCleanupError("artifact.select", 1, error instanceof Error ? error.message : "Expired artifact cleanup query failed.");
  });
  const failures: Array<{ stage: "artifact.delete"; message: string }> = [];
  for (const row of expired.results ?? []) {
    try {
      await live.ARTIFACTS.delete(row.key);
      await live.DB.prepare("DELETE FROM artifacts WHERE id = ?").bind(row.id).run();
    } catch (error) {
      failures.push({
        stage: "artifact.delete",
        message: error instanceof Error ? error.message : "Expired artifact cleanup delete failed."
      });
    }
  }
  if (failures.length > 0) {
    throw new RetentionCleanupError(
      "artifact.delete",
      failures.length,
      failures[0]?.message ?? "Expired artifact cleanup delete failed."
    );
  }
}

async function cleanupExpiredArtifactsWithAlert(
  env: HostedEnv,
  ctx: ExecutionContext,
  scheduledTime: number | undefined
): Promise<void> {
  const observedAt = Number.isFinite(scheduledTime)
    ? new Date(scheduledTime as number).toISOString()
    : nowIso();
  try {
    await cleanupExpiredArtifacts(env);
  } catch (error) {
    scheduleRetentionCleanupFailureAlert({ env, ctx, observedAt, error });
    throw error;
  }
}

async function storeUploadedArtifact(
  request: Request,
  db: D1Database,
  bucket: R2Bucket,
  auth: AuthContext,
  retentionDays: number,
  plan: Plan
): Promise<{ id: string; kind: string; contentType: string; bytes: number; filename: string }> {
  const form = await request.formData();
  const file = form.get("file");
  const kind = typeof form.get("kind") === "string" ? String(form.get("kind")) : "file";
  if (!(file instanceof File)) {
    throw new HostedError(400, "input.file_required", "Artifact upload requires a file field.");
  }
  if (plan.limits.maxArtifactUploadBytes <= 0) {
    throw new HostedError(403, "quota.artifact_upload_not_included", `Artifact uploads are not included in the ${plan.name} vc-tools plan.`);
  }
  if (file.size > plan.limits.maxArtifactUploadBytes) {
    throw new HostedError(413, "input.file_too_large", `Artifact upload must be ${formatBytes(plan.limits.maxArtifactUploadBytes)} or smaller for the ${plan.name} plan.`);
  }
  const contentType = file.type || "application/octet-stream";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const stored = await storeGeneratedArtifact(db, bucket, auth.actorId, undefined, retentionDays, sanitizeKind(kind), contentType, bytes, plan);
  return { ...stored, filename: sanitizeFilename(file.name || `${stored.id}.bin`) };
}

async function storeJobArtifact(
  live: RequiredLiveBindings,
  job: ToolJobMessage,
  kind: string,
  contentType: string,
  data: Uint8Array | string
): Promise<StoredArtifactResult> {
  return storeGeneratedArtifact(
    live.DB,
    live.ARTIFACTS,
    job.actorId,
    job.id,
    retentionDaysForJob(job),
    kind,
    contentType,
    data,
    planByName(job.planName)
  );
}

async function storeGeneratedArtifact(
  db: D1Database,
  bucket: R2Bucket,
  actorId: string,
  jobId: string | undefined,
  retentionDays: number,
  kind: string,
  contentType: string,
  data: Uint8Array | string,
  plan: Plan
): Promise<StoredArtifactResult> {
  const id = `art_${crypto.randomUUID()}`;
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  await assertArtifactStorageAvailable(db, actorId, plan, bytes.byteLength);
  const key = `artifacts/${id}/${sanitizeKind(kind)}`;
  await bucket.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      artifactId: id,
      jobId: jobId ?? "",
      kind
    }
  });
  const createdAt = nowIso();
  const expiresAt = addDaysIso(createdAt, Math.max(1, Math.min(365, retentionDays)));
  const limitBytes = artifactStorageLimitBytes(plan);
  let result: D1Result;
  try {
    result = await db.prepare(
      `INSERT INTO artifacts (id, actor_id, job_id, kind, key, content_type, bytes, created_at, expires_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE ? <= ?
        AND (SELECT COALESCE(SUM(bytes), 0) FROM artifacts WHERE actor_id = ? AND (expires_at IS NULL OR expires_at > ?)) + ? <= ?`
    ).bind(
      id,
      actorId,
      jobId ?? null,
      kind,
      key,
      contentType,
      bytes.byteLength,
      createdAt,
      expiresAt,
      bytes.byteLength,
      limitBytes,
      actorId,
      createdAt,
      bytes.byteLength,
      limitBytes
    ).run();
  } catch (error) {
    await bucket.delete(key).catch(() => undefined);
    throw error;
  }
  if (d1ChangedRows(result) <= 0) {
    await bucket.delete(key).catch(() => undefined);
    throw new HostedError(429, "quota.artifact_storage_exceeded", `Artifact storage quota has been reached for the active ${plan.name} vc-tools plan.`);
  }
  return { id, kind, contentType, bytes: bytes.byteLength };
}

async function assertArtifactStorageAvailable(db: D1Database, actorId: string, plan: Plan, incomingBytes: number): Promise<void> {
  const limitBytes = artifactStorageLimitBytes(plan);
  if (limitBytes <= 0) {
    throw new HostedError(403, "quota.artifact_storage_not_included", `Artifact storage is not included in the ${plan.name} vc-tools plan.`);
  }
  if (incomingBytes > limitBytes) {
    throw new HostedError(413, "quota.artifact_storage_exceeded", `Artifact exceeds the ${plan.name} vc-tools artifact storage cap.`);
  }
  const usedBytes = await activeArtifactStorageBytes(db, actorId);
  if (usedBytes + incomingBytes > limitBytes) {
    throw new HostedError(429, "quota.artifact_storage_exceeded", `Artifact storage quota has been reached for the active ${plan.name} vc-tools plan.`);
  }
}

async function activeArtifactStorageBytes(db: D1Database, actorId: string): Promise<number> {
  const row = await db.prepare(
    "SELECT COALESCE(SUM(bytes), 0) AS bytes FROM artifacts WHERE actor_id = ? AND (expires_at IS NULL OR expires_at > ?)"
  ).bind(actorId, nowIso()).first<{ bytes: number }>();
  return Number(row?.bytes ?? 0);
}

function artifactStorageLimitBytes(plan: Plan): number {
  return Math.floor(plan.limits.artifactStorageGb * 1024 * 1024 * 1024);
}

interface PublicSurfaceOptions {
  details: boolean;
  operator: boolean;
}

function requestSurface(url: URL, _env: HostedEnv, _auth?: AuthContext): PublicSurfaceOptions {
  const operator = truthySearchParam(url, "operator");
  return {
    details: operator || truthySearchParam(url, "details"),
    operator
  };
}

function truthySearchParam(url: URL, key: string): boolean {
  const value = url.searchParams.get(key);
  return value === "true" || value === "1" || value === "";
}

function publicPlansPayload(plans: readonly Plan[]): Record<string, unknown> {
  return {
    plans: plans.map((plan) => ({
      name: plan.name,
      priceUsdMonthly: plan.priceUsdMonthly,
      monthlyCredits: plan.limits.monthlyCredits,
      dailyCredits: plan.limits.dailyCredits,
      runningLimit: plan.limits.maxConcurrentRuns,
      browser: {
        monthlyJobs: plan.limits.browserRenderJobsMonthly,
        maxSecondsPerRun: plan.limits.browser.maxBrowserSecondsPerRun,
        agentBrowserTasks: plan.limits.browser.allowBrowserSessions ? "included" : "not included"
      },
      computer: {
        monthlyJobs: plan.limits.sandboxJobsMonthly,
        maxTaskSeconds: plan.limits.sandbox.maxSandboxTaskSeconds,
        publicHttpEgress: plan.limits.sandboxJobsMonthly > 0 ? "available" : "not included"
      },
      proofStorageGb: plan.limits.artifactStorageGb
    })),
    note: "Plan packaging is public product information. Authenticated usage plus hosted quota checks decide real account capacity."
  };
}

function planPackagingAuthority(mode: ProviderMode): Record<string, unknown> {
  return {
    source: mode === "live" ? "hosted-plans-endpoint" : "contract-plans-endpoint",
    accountEntitlementsAuthoritative: false,
    localFallbackAuthoritative: false,
    accountStateEndpoint: "/v1/usage",
    enforcement: "server-side",
    message: "Plan packaging is informational. Authenticated /v1/usage plus hosted quota checks decide real account entitlement, usage, billing, and enforcement."
  };
}

function usageAuthority(mode: ProviderMode): Record<string, unknown> {
  const live = mode === "live";
  return {
    source: live ? "hosted-usage-snapshot" : "contract-usage-snapshot",
    authoritative: live,
    enforcement: "server-side",
    mutableByClient: false,
    message: live
      ? "This usage snapshot is read from hosted account state; local CLI code cannot raise entitlement or quota."
      : "Contract-mode usage is informational and not billing authority; official hosted live usage decides real entitlement and quota."
  };
}

function visibleOfferingClassifications(env: HostedEnv, auth?: AuthContext): readonly OfferingClassification[] {
  if (canReadInternalLaunchMetadata(env, auth)) {
    return PUBLIC_OFFERING_CLASSIFICATIONS;
  }
  return PUBLIC_OFFERING_CLASSIFICATIONS.filter((item) => item.status !== "future" && item.status !== "internal-only");
}

function launchPlanMetadata(env: HostedEnv, auth: AuthContext | undefined, surface: PublicSurfaceOptions = { details: false, operator: false }): Record<string, unknown> {
  const internal = surface.operator && canReadInternalLaunchMetadata(env, auth);
  return {
    ...(internal ? { overageMeters: OVERAGE_METERS } : {}),
    ...(surface.details || internal ? { offeringClassifications: visibleOfferingClassifications(env, auth) } : {})
  };
}

async function usageSnapshot(db: D1Database, env: HostedEnv, auth: AuthContext, surface: PublicSurfaceOptions = { details: false, operator: false }): Promise<Record<string, unknown>> {
  const plan = activePlanForAuth(auth, env);
  const monthStart = startOfMonthIso();
  const dayStart = startOfDayIso();
  const browserJobs = await countJobs(db, auth, "browser.%", monthStart);
  const sandboxJobs = await countJobs(db, auth, "sandbox.%", monthStart);
  const dailyBrowserJobs = await countJobs(db, auth, "browser.%", dayStart);
  const dailySandboxJobs = await countJobs(db, auth, "sandbox.%", dayStart);
  const browserMinutes = await sumUsage(db, auth, "browser-minute", monthStart);
  const dailyBrowserMinutes = await sumUsage(db, auth, "browser-minute", dayStart);
  const sandboxMinutes = await sumUsage(db, auth, "sandbox-compute-minute", monthStart);
  const activeRuns = await countActiveJobs(db, auth, "%");
  const activeBrowserSessions = await countActiveJobs(db, auth, "browser.agent_task");
  const activeSandboxJobs = await countActiveJobs(db, auth, "sandbox.%");
  const storage = await db.prepare(
    "SELECT COALESCE(SUM(bytes), 0) AS bytes FROM artifacts WHERE actor_id = ? AND (expires_at IS NULL OR expires_at > ?)"
  ).bind(auth.actorId, nowIso()).first<{ bytes: number }>();
  const usedCredits = browserJobs + sandboxJobs;
  const dailyCredits = dailyBrowserJobs + dailySandboxJobs;
  return {
    plan: plan.name,
    vcToolCredits: { used: usedCredits, included: plan.limits.monthlyCredits },
    dailyVcToolCredits: { used: dailyCredits, included: plan.limits.dailyCredits },
    concurrentRuns: { used: activeRuns, included: plan.limits.maxConcurrentRuns },
    browserSessionConcurrency: { used: activeBrowserSessions, included: plan.limits.browser.maxConcurrentBrowserSessionsPerUser },
    sandboxConcurrency: { used: activeSandboxJobs, included: plan.limits.concurrentSandboxJobs },
    browserJobs: { used: browserJobs, included: plan.limits.browserRenderJobsMonthly },
    sandboxJobs: { used: sandboxJobs, included: plan.limits.sandboxJobsMonthly },
    browserSeconds: { used: Math.round(browserMinutes * 60), included: plan.limits.browser.monthlyBrowserSeconds },
    dailyBrowserSeconds: { used: Math.round(dailyBrowserMinutes * 60), included: plan.limits.browser.dailyBrowserSeconds },
    browserMinutes: { used: round2(browserMinutes), included: plan.limits.browserMinutesMonthly },
    browser: plan.limits.browser,
    sandboxMinutes: { used: round2(sandboxMinutes), included: plan.limits.sandboxMinutesMonthly },
    sandbox: plan.limits.sandbox,
    crawl: plan.limits.crawl,
    scheduledQa: plan.limits.scheduledQa,
    artifactStorageGb: { used: round2(Number(storage?.bytes ?? 0) / 1024 / 1024 / 1024), included: plan.limits.artifactStorageGb },
    ...(surface.details || surface.operator ? {
      maxArtifactUploadBytes: plan.limits.maxArtifactUploadBytes,
      hardCap: plan.posture.spendCap === "hard-by-default",
      authority: usageAuthority(providerMode(env))
    } : {}),
    ...(surface.operator ? {
      offeringClassifications: visibleOfferingClassifications(env, auth),
      providerMode: providerMode(env)
    } : {})
  };
}

function contractUsage(env: HostedEnv, auth?: AuthContext, surface: PublicSurfaceOptions = { details: false, operator: false }): Record<string, unknown> {
  const plan = auth ? activePlanForAuth(auth, env) : activePlan(env);
  return {
    plan: plan.name,
    vcToolCredits: { used: 0, included: plan.limits.monthlyCredits },
    dailyVcToolCredits: { used: 0, included: plan.limits.dailyCredits },
    concurrentRuns: { used: 0, included: plan.limits.maxConcurrentRuns },
    browserSessionConcurrency: { used: 0, included: plan.limits.browser.maxConcurrentBrowserSessionsPerUser },
    sandboxConcurrency: { used: 0, included: plan.limits.concurrentSandboxJobs },
    browserJobs: { used: 0, included: plan.limits.browserRenderJobsMonthly },
    sandboxJobs: { used: 0, included: plan.limits.sandboxJobsMonthly },
    browserSeconds: { used: 0, included: plan.limits.browser.monthlyBrowserSeconds },
    dailyBrowserSeconds: { used: 0, included: plan.limits.browser.dailyBrowserSeconds },
    browserMinutes: { used: 0, included: plan.limits.browserMinutesMonthly },
    browser: plan.limits.browser,
    sandboxMinutes: { used: 0, included: plan.limits.sandboxMinutesMonthly },
    sandbox: plan.limits.sandbox,
    crawl: plan.limits.crawl,
    scheduledQa: plan.limits.scheduledQa,
    artifactStorageGb: { used: 0, included: plan.limits.artifactStorageGb },
    ...(surface.details || surface.operator ? {
      maxArtifactUploadBytes: plan.limits.maxArtifactUploadBytes,
      hardCap: plan.posture.spendCap === "hard-by-default",
      authority: usageAuthority(providerMode(env))
    } : {}),
    ...(surface.operator ? {
      offeringClassifications: visibleOfferingClassifications(env, auth),
      providerMode: providerMode(env)
    } : {})
  };
}

async function cogsDashboardData(env: HostedEnv, auth: AuthContext): Promise<Record<string, unknown>> {
  const mode = providerMode(env);
  const plan = activePlanForAuth(auth, env);
  const monthStart = startOfMonthIso();
  const assumptions = cogsAssumptions(env);
  const browserMinutes = mode === "live" && env.DB ? await sumUsage(env.DB, auth, "browser-minute", monthStart) : 0;
  const sandboxMinutes = mode === "live" && env.DB ? await sumUsage(env.DB, auth, "sandbox-compute-minute", monthStart) : 0;
  const crawlPages = mode === "live" && env.DB ? await sumUsage(env.DB, auth, "crawl-page", monthStart) : 0;
  const artifactBytes = mode === "live" && env.DB ? await activeArtifactStorageBytes(env.DB, auth.actorId) : 0;
  const artifactGb = artifactBytes / 1024 / 1024 / 1024;
  const sandboxMinuteUsd = plan.limits.sandbox.containerInstanceType === "standard-2"
    ? assumptions.sandboxStandard2MinuteUsd
    : assumptions.sandboxStandard1MinuteUsd;
  const surfaces = [
    cogsSurface("Browser Run", "minutes", round2(browserMinutes), plan.limits.browserMinutesMonthly, assumptions.browserMinuteUsd),
    cogsSurface(`${plan.limits.sandbox.containerInstanceType} Sandbox`, "minutes", round2(sandboxMinutes), plan.limits.sandboxMinutesMonthly, sandboxMinuteUsd),
    cogsSurface("Crawl", "pages", round2(crawlPages), plan.limits.crawl.maxPagesPerMonth, assumptions.crawlPageUsd),
    cogsSurface("Artifact shelf", "GB-month", round2(artifactGb), plan.limits.artifactStorageGb, assumptions.artifactGbMonthUsd)
  ];

  return {
    providerMode: mode,
    internalOnly: true,
    generatedAt: nowIso(),
    actor: { actorId: auth.actorId, plan: plan.name },
    resetWindow: monthResetWindow(nowIso()),
    warningThresholds: OPERATOR_ALERT_THRESHOLDS,
    assumptions,
    accountPressure: {
      hostedAccount: hostedAccountLimits(env),
      browserRunAccount: browserRunAccountLimits(env),
      sandboxAccount: sandboxAccountLimits(env),
      operatorAlerts: operatorAlertsReadiness(env)
    },
    surfaces,
    totalEstimatedRawCostUsd: round4(surfaces.reduce((sum, item) => sum + item.estimatedRawCostUsd, 0))
  };
}

function cogsSurface(
  label: string,
  unit: string,
  used: number,
  included: number,
  unitCostUsd: number
): {
  surface: string;
  unit: string;
  used: number;
  included: number;
  percentUsed: number;
  alertState: string;
  estimatedRawCostUsd: number;
} {
  const percentUsed = round2(percentOf(used, included));
  const threshold = thresholdForPercent(percentUsed);
  return {
    surface: label,
    unit,
    used,
    included,
    percentUsed,
    alertState: threshold === null ? "below-threshold" : `at-${threshold}`,
    estimatedRawCostUsd: round4(Math.max(0, used) * unitCostUsd)
  };
}

function cogsAssumptions(env: HostedEnv): {
  browserMinuteUsd: number;
  sandboxStandard1MinuteUsd: number;
  sandboxStandard2MinuteUsd: number;
  artifactGbMonthUsd: number;
  crawlPageUsd: number;
} {
  return {
    browserMinuteUsd: numberEnv(env.VC_TOOLS_COGS_BROWSER_MINUTE_USD, 0.03, 0, 10),
    sandboxStandard1MinuteUsd: numberEnv(env.VC_TOOLS_COGS_SANDBOX_STANDARD1_MINUTE_USD, 0.05, 0, 10),
    sandboxStandard2MinuteUsd: numberEnv(env.VC_TOOLS_COGS_SANDBOX_STANDARD2_MINUTE_USD, 0.08, 0, 10),
    artifactGbMonthUsd: numberEnv(env.VC_TOOLS_COGS_ARTIFACT_GB_MONTH_USD, 0.02, 0, 10),
    crawlPageUsd: numberEnv(env.VC_TOOLS_COGS_CRAWL_PAGE_USD, 0.002, 0, 10)
  };
}

async function countJobs(db: D1Database, auth: AuthContext, pattern: string, since: string): Promise<number> {
  const row = await db.prepare("SELECT COUNT(1) AS count_value FROM jobs WHERE actor_id = ? AND capability LIKE ? AND created_at >= ?")
    .bind(auth.actorId, pattern, since)
    .first<{ count_value: number }>();
  return Number(row?.count_value ?? 0);
}

async function countCostBearingJobs(db: D1Database, auth: AuthContext, since: string): Promise<number> {
  const row = await db.prepare(
    "SELECT COUNT(1) AS count_value FROM jobs WHERE actor_id = ? AND (capability LIKE 'browser.%' OR capability LIKE 'sandbox.%') AND created_at >= ?"
  )
    .bind(auth.actorId, since)
    .first<{ count_value: number }>();
  return Number(row?.count_value ?? 0);
}

async function countActiveJobs(db: D1Database, auth: AuthContext, pattern: string): Promise<number> {
  const row = await db.prepare(
    "SELECT COUNT(1) AS count_value FROM jobs WHERE actor_id = ? AND capability LIKE ? AND status IN ('queued', 'running')"
  )
    .bind(auth.actorId, pattern)
    .first<{ count_value: number }>();
  return Number(row?.count_value ?? 0);
}

async function countRunningHostedAccountJobs(db: D1Database): Promise<number> {
  const row = await db.prepare(
    "SELECT COUNT(1) AS count_value FROM jobs WHERE (capability LIKE 'browser.%' OR capability LIKE 'sandbox.%') AND status = 'running'"
  )
    .first<{ count_value: number }>();
  return Number(row?.count_value ?? 0);
}

async function countRunningCapabilityPrefix(db: D1Database, pattern: string): Promise<number> {
  const row = await db.prepare(
    "SELECT COUNT(1) AS count_value FROM jobs WHERE capability LIKE ? AND status = 'running'"
  )
    .bind(pattern)
    .first<{ count_value: number }>();
  return Number(row?.count_value ?? 0);
}

function percentOf(current: number, included: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(included) || included <= 0) {
    return 0;
  }
  return (current / included) * 100;
}

function thresholdForPercent(percentUsed: number): number | null {
  let matched: number | null = null;
  for (const threshold of OPERATOR_ALERT_THRESHOLDS) {
    if (percentUsed >= threshold) {
      matched = threshold;
    }
  }
  return matched;
}

function monthResetWindow(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return startOfMonthIso().slice(0, 7);
  }
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dayResetWindow(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return startOfDayIso().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function hourlyResetWindow(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return nowIso().slice(0, 13);
  }
  return date.toISOString().slice(0, 13);
}

async function sumUsage(db: D1Database, auth: AuthContext, meter: string, since: string): Promise<number> {
  const row = await db.prepare("SELECT COALESCE(SUM(quantity), 0) AS quantity FROM usage_events WHERE actor_id = ? AND meter = ? AND at >= ?")
    .bind(auth.actorId, meter, since)
    .first<{ quantity: number }>();
  return Number(row?.quantity ?? 0);
}

async function writeUsage(
  db: D1Database,
  job: ToolJobMessage,
  artifact: StoredArtifactResult,
  startedAt: string,
  completedAt: string
): Promise<void> {
  const durationMinutes = artifact.browserMsUsed !== undefined
    ? Math.max(0.01, artifact.browserMsUsed / 60_000)
    : Math.max(0.01, (Date.parse(completedAt) - Date.parse(startedAt)) / 60_000);
  const meter = job.capability.startsWith("browser.") ? "browser-minute" : job.capability.startsWith("sandbox.") ? "sandbox-compute-minute" : undefined;
  if (meter) {
    await db.prepare("INSERT INTO usage_events (id, actor_id, meter, quantity, job_id, at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(`use_${crypto.randomUUID()}`, job.actorId, meter, durationMinutes, job.id, completedAt)
      .run();
  }
  if (job.capability === "browser.crawl_site" && artifact.crawlPages !== undefined && artifact.crawlPages > 0) {
    await db.prepare("INSERT INTO usage_events (id, actor_id, meter, quantity, job_id, at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(`use_${crypto.randomUUID()}`, job.actorId, "crawl-page", artifact.crawlPages, job.id, completedAt)
      .run();
  }
  if (artifact.bytes > 0) {
    await db.prepare("INSERT INTO usage_events (id, actor_id, meter, quantity, job_id, at) VALUES (?, ?, 'artifact-byte', ?, ?, ?)")
      .bind(`use_${crypto.randomUUID()}`, job.actorId, artifact.bytes, job.id, completedAt)
    .run();
  }
}

async function recordBrowserAgentClosureIfNeeded(env: HostedEnv, job: ToolJobMessage, artifact: StoredArtifactResult): Promise<void> {
  if (job.capability !== "browser.agent_task") {
    return;
  }
  const closureReason = typeof artifact.metadata?.closureReason === "string" ? artifact.metadata.closureReason : "unknown";
  await recordAudit(
    env,
    `tools.browser_agent.${closureReason}`,
    job.capability,
    syntheticRequest(job.id),
    authContextForJob(job),
    job.id
  );
}

function elapsedJobSeconds(startedAt: string, endedAt: string): number {
  const elapsedMs = Date.parse(endedAt) - Date.parse(startedAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(elapsedMs / 1000));
}

async function reconcileSandboxReservation(db: D1Database, job: ToolJobMessage, seconds: number): Promise<void> {
  if (!job.capability.startsWith("sandbox.")) {
    return;
  }
  const normalizedSeconds = Math.max(0, Math.trunc(seconds));
  await db.prepare("UPDATE jobs SET reserved_sandbox_seconds = ? WHERE id = ? AND actor_id = ?")
    .bind(normalizedSeconds, job.id, job.actorId)
    .run();
}

async function readRetentionPolicy(db: D1Database, auth: AuthContext, env: HostedEnv): Promise<Record<string, unknown>> {
  const row = await db.prepare("SELECT scope, logs_days, artifacts_days, recordings, updated_at FROM retention_policies WHERE scope = ?")
    .bind(actorRetentionScope(auth))
    .first<RetentionRow>();
  const plan = activePlanForAuth(auth, env);
  return {
    logsDays: Number(row?.logs_days ?? 30),
    artifactsDays: clampArtifactRetentionDays(Number(row?.artifacts_days ?? plan.limits.artifactRetentionDays), plan),
    recordings: row?.recordings ?? "off",
    updatedAt: row?.updated_at,
    providerMode: "live"
  };
}

function normalizeRetentionPatch(body: Record<string, unknown>, plan: Plan): { logsDays: number; artifactsDays: number; recordings: RecordingPolicy } {
  const logsDays = numberInRange(body.logsDays, 1, 365, 30, "logsDays");
  const artifactsDays = normalizeArtifactRetentionDays(body.artifactsDays, plan);
  const recordings = body.recordings === undefined ? "off" : body.recordings;
  if (recordings !== "off" && recordings !== "opt-in" && recordings !== "admin") {
    throw new HostedError(400, "input.invalid_recordings", "recordings must be off, opt-in, or admin.");
  }
  return { logsDays, artifactsDays, recordings };
}

function normalizeArtifactRetentionDays(value: unknown, plan: Plan): number {
  const maxDays = plan.limits.artifactRetentionDays;
  const defaultDays = maxDays;
  if (value === undefined) {
    return defaultDays;
  }
  const days = Number(value);
  const minDays = maxDays === 0 ? 0 : 1;
  if (!Number.isInteger(days) || days < minDays || days > maxDays) {
    throw new HostedError(400, "input.invalid_artifacts_days", `artifactsDays must be between ${minDays} and ${maxDays} for the active vc-tools plan.`);
  }
  return days;
}

function clampArtifactRetentionDays(value: number, plan: Plan): number {
  const maxDays = plan.limits.artifactRetentionDays;
  const minDays = maxDays === 0 ? 0 : 1;
  if (!Number.isFinite(value)) {
    return maxDays;
  }
  return Math.max(minDays, Math.min(maxDays, Math.trunc(value)));
}

function actorRetentionScope(auth: AuthContext): string {
  return `actor:${auth.actorId}`;
}

async function recordAudit(env: HostedEnv, event: string, subject: string, request: Request, auth: AuthContext, jobId?: string): Promise<void> {
  const auditEvent = {
    event,
    subject,
    actorId: auth.actorId,
    path: new URL(request.url).pathname,
    jobId,
    at: nowIso()
  };
  if (providerMode(env) === "live" && env.DB) {
    await env.DB.prepare("INSERT INTO audit_events (id, actor_id, event, subject, path, job_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(`aud_${crypto.randomUUID()}`, auth.actorId, event, subject, auditEvent.path, jobId ?? null, auditEvent.at)
      .run();
    return;
  }
  console.log(JSON.stringify(auditEvent));
}

function recordAuthFailureMetric(
  env: HostedEnv,
  ctx: ExecutionContext,
  request: Request,
  auth: Extract<AuthResult, { ok: false }>
): void {
  ctx.waitUntil(
    recordAuthFailureAudit(env, request, auth).catch((error) => {
      console.warn("[vc-tools.authFailure.auditFailed]", redactObject({
        code: auth.code,
        path: sanitizeOperatorAlertPath(new URL(request.url).pathname),
        message: error instanceof Error ? error.message : String(error)
      }));
    })
  );
}

async function recordAuthFailureAudit(env: HostedEnv, request: Request, auth: Extract<AuthResult, { ok: false }>): Promise<void> {
  const path = sanitizeOperatorAlertPath(new URL(request.url).pathname);
  const at = nowIso();
  if (providerMode(env) === "live" && env.DB) {
    await env.DB.prepare("INSERT INTO audit_events (id, actor_id, event, subject, path, job_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(`aud_${crypto.randomUUID()}`, "anonymous", "auth.failed", auth.code, path, null, at)
      .run();
    return;
  }
  console.log(JSON.stringify({
    event: "auth.failed",
    subject: auth.code,
    actorId: "anonymous",
    path,
    at
  }));
}

async function recordHostedDenialMetricIfNeeded(
  env: HostedEnv,
  request: Request,
  auth: AuthContext,
  capability: CapabilityName,
  error: unknown
): Promise<void> {
  if (!(error instanceof HostedError)) {
    return;
  }
  const event = denialMetricEvent(error.code);
  if (!event) {
    return;
  }
  await recordAudit(env, event, `${capability}:${error.code}`, request, auth).catch((auditError) => {
    console.warn("[vc-tools.denialMetric.auditFailed]", redactObject({
      code: error.code,
      event,
      message: auditError instanceof Error ? auditError.message : String(auditError)
    }));
  });
}

function denialMetricEvent(code: string): "tools.denied_unsafe_url" | "tools.denied_quota" | null {
  if (code === "input.blocked_url" || code === "input.unresolvable_url") {
    return "tools.denied_unsafe_url";
  }
  if (code.startsWith("quota.")) {
    return "tools.denied_quota";
  }
  return null;
}

async function dashboardData(section: string, env: HostedEnv, auth: AuthContext): Promise<Record<string, unknown>> {
  const mode = providerMode(env);
  switch (section) {
    case "usage":
      if (mode === "live" && env.DB) {
        return { ...(await usageSnapshot(env.DB, env, auth)), live: liveReadiness(env) };
      }
      return { ...contractUsage(env, auth), live: liveReadiness(env) };
    case "jobs":
      return {
        recentJobs: mode === "live" && env.DB ? await listJobs(env.DB, auth, 10) : [],
        durableStatus: mode === "live" ? "d1-queue-backed" : "contract-empty"
      };
    case "artifacts":
      return {
        artifacts: mode === "live" && env.DB ? await listArtifacts(env.DB, auth, env, 10) : [],
        retention: mode === "live" && env.DB ? await readRetentionPolicy(env.DB, auth, env) : { artifactsDays: 30, recordings: "off" },
        storage: mode === "live" ? "r2-backed" : "contract-empty"
      };
    case "agents":
      return {
        connection: {
          transport: "streamable_http",
          url: `${publicBase(env)}/mcp`,
          protocolVersion: MCP_PROTOCOL_VERSION,
          tools: MCP_TOOL_DESCRIPTORS
            .filter((tool) => capabilityAllowedForPlan(tool.capability, activePlanForAuth(auth, env)))
            .map((tool) => ({ name: tool.name, title: tool.title }))
        }
      };
    case "grants":
      return { grants: grantsForPlan(activePlanForAuth(auth, env)) };
    case "retention":
      return { defaults: { logsDays: 30, artifactsDays: 30, recordings: "off" }, policies: LAUNCH_POLICIES };
    case "billing":
      return {
        providerMode: mode,
        plans: DEFAULT_PLANS,
        ...launchPlanMetadata(env, auth, {
          details: canReadInternalLaunchMetadata(env, auth),
          operator: canReadInternalLaunchMetadata(env, auth)
        })
      };
    case "cogs":
      if (!canReadOperatorDashboard(auth)) {
        throw new HostedError(403, "auth.operator_scope_denied", "This vc-tools dashboard section is operator-only.");
      }
      return cogsDashboardData(env, auth);
    default:
      return {
        runningWork: mode === "live" && env.DB ? (await listJobs(env.DB, auth, 10)).filter((job) => job.status === "queued" || job.status === "running") : [],
        recentWork: mode === "live" && env.DB ? await listJobs(env.DB, auth, 5) : [],
        savedProof: mode === "live" && env.DB ? await listArtifacts(env.DB, auth, env, 5) : [],
        usage: mode === "live" && env.DB ? await usageSnapshot(env.DB, env, auth) : contractUsage(env, auth),
        connection: {
          transport: "streamable_http",
          url: `${publicBase(env)}/mcp`,
          protocolVersion: MCP_PROTOCOL_VERSION
        },
        sections: DASHBOARD_SECTIONS
      };
  }
}

async function renderDashboard(section: string, env: HostedEnv, auth: AuthContext): Promise<string> {
  const knownSection =
    DASHBOARD_SECTIONS.find((item) => item.id === section) ??
    (canReadOperatorDashboard(auth)
      ? OPERATOR_DASHBOARD_SECTIONS.find((item) => item.id === section)
      : undefined) ??
    DASHBOARD_SECTIONS[0];
  const dashboard = await dashboardData(knownSection.id, env, auth);
  const visibleSections = canReadOperatorDashboard(auth)
    ? [...DASHBOARD_SECTIONS, ...OPERATOR_DASHBOARD_SECTIONS]
    : DASHBOARD_SECTIONS;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>vc-tools ${escapeHtml(knownSection.label)}</title>
  <style>
    body { color: #17202a; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #f7faf9; }
    main { margin: 0 auto; max-width: 1040px; padding: 32px 20px 48px; }
    nav { display: flex; flex-wrap: wrap; gap: 8px; margin: 20px 0 28px; }
    a { color: #0f766e; }
    nav a { border: 1px solid #b8d7d2; border-radius: 6px; padding: 8px 10px; text-decoration: none; }
    nav a[aria-current="page"] { background: #0f766e; color: white; border-color: #0f766e; }
    pre { background: #ffffff; border: 1px solid #d7e5e2; border-radius: 8px; overflow: auto; padding: 16px; }
    .mode { color: #475569; }
  </style>
</head>
<body>
  <main>
    <h1>Vibecodr Tools Cloud</h1>
    <p class="mode">Provider mode: ${escapeHtml(providerMode(env))}</p>
    <nav aria-label="Dashboard sections">
      ${visibleSections.map((item) => `<a href="/dashboard/${item.id === "overview" ? "" : `${item.id}/`}"${item.id === knownSection.id ? " aria-current=\"page\"" : ""}>${escapeHtml(item.label)}</a>`).join("")}
    </nav>
    <h2>${escapeHtml(knownSection.label)}</h2>
    <p>${escapeHtml(knownSection.purpose)}</p>
    <pre>${escapeHtml(JSON.stringify(dashboard, null, 2))}</pre>
  </main>
</body>
</html>`;
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  return {
    "access-control-allow-origin": origin && origin.endsWith(".vibecodr.space") ? origin : "https://vibecodr.space",
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
    "vary": "Origin"
  };
}

function normalizePath(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, "");
  return normalized === "" ? "/" : normalized;
}

function publicBase(env: Pick<HostedEnv, "VC_TOOLS_PUBLIC_BASE_URL">): string {
  return env.VC_TOOLS_PUBLIC_BASE_URL || "https://tools.vibecodr.space";
}

function providerMode(env: HostedEnv): ProviderMode {
  return env.VC_TOOLS_PROVIDER_MODE === "live" ? "live" : "contract";
}

function protocolVersionFrom(body: Record<string, unknown>): string {
  const params = isRecord(body.params) ? body.params : {};
  return typeof params.protocolVersion === "string" ? params.protocolVersion : MCP_PROTOCOL_VERSION;
}

function capabilityFromToolName(value: string): CapabilityName | undefined {
  const trimmed = value.trim();
  if (CAPABILITIES.includes(trimmed as CapabilityName)) {
    return trimmed as CapabilityName;
  }
  return CAPABILITY_ALIASES[trimmed];
}

function titleForAgentTool(name: string, capability: CapabilityName): string {
  return ({
    "browser.render": "Render Browser Page",
    "browser.screenshot": "Screenshot Browser Page",
    "browser.read": "Read Browser Page",
    "browser.pdf": "Create Browser PDF",
    "browser.crawl": "Crawl Public Site",
    "browser.snapshot": "Capture Browser Snapshot",
    "computer.run": "Run On Agent Computer",
    "computer.test": "Test On Agent Computer",
    "proof.get": "Get Saved Proof",
    "usage.status": "Read Computer Capacity",
    "work.status": "Read Work Status",
    "work.cancel": "Cancel Hosted Work"
  } as Record<string, string>)[name] ?? titleForCapability(capability);
}

function titleForCapability(name: CapabilityName): string {
  return ({
    "browser.render_url": "Render URL",
    "browser.screenshot_url": "Screenshot URL",
    "browser.extract_markdown": "Extract Markdown",
    "browser.render_pdf": "Render PDF",
    "browser.crawl_site": "Crawl Site",
    "browser.agent_task": "Agent Browser Task",
    "sandbox.run_command": "Run Sandbox Command",
    "sandbox.run_tests": "Run Sandbox Tests",
    "artifact.create": "Create Artifact",
    "artifact.get": "Get Artifact",
    "usage.read": "Read Usage and Limits",
    "job.status": "Read Activity Status",
    "job.cancel": "Cancel Hosted Work"
  })[name];
}

function descriptionForAgentTool(name: string, capability: CapabilityName): string {
  return ({
    "browser.render": "Render a public HTTPS page in the hosted Browser after URL safety checks.",
    "browser.screenshot": "Capture a PNG/JPEG screenshot of a public HTTPS page and save proof as an artifact.",
    "browser.read": "Read a public HTTPS page as markdown without exposing private networks or authenticated browser state.",
    "browser.pdf": "Render a PDF from a public HTTPS page within quota and retention policy.",
    "browser.crawl": "Crawl a bounded public HTTPS site and save the result as proof.",
    "browser.snapshot": "Capture a bounded hosted Browser inspection snapshot for the calling agent to analyze.",
    "computer.run": "Submit a bounded command to the hosted Agent Computer. The command is never executed on the user's local machine.",
    "computer.test": "Submit a bounded test command to the hosted Agent Computer. Public HTTP(S) is available by default; private/internal destinations stay blocked.",
    "proof.get": "Read saved proof/artifact metadata for the authenticated account.",
    "usage.status": "Read account-scoped Agent Computer capacity, usage, active reservations, and limits.",
    "work.status": "Read status, result, and failure metadata for hosted work.",
    "work.cancel": "Cancel queued or running hosted work when explicitly confirmed."
  } as Record<string, string>)[name] ?? descriptionForCapability(capability);
}

function descriptionForCapability(name: CapabilityName): string {
  return ({
    "browser.render_url": "Submit an HTTPS public URL for hosted rendering after local and hosted safety gates.",
    "browser.screenshot_url": "Capture a screenshot for an HTTPS public URL without authenticated browsing by default.",
    "browser.extract_markdown": "Extract markdown from an HTTPS public URL within crawl and quota limits.",
    "browser.render_pdf": "Render a PDF from an HTTPS public URL within quota and retention policy.",
    "browser.crawl_site": "Crawl a bounded public HTTPS site and return a hosted artifact without authenticated browsing by default.",
    "browser.agent_task": "Run a paid Browser Session-style task with bounded actions: Creator up to 20 minutes, Pro up to 1 hour, and 10 minute idle closure.",
    "sandbox.run_command": "Submit a bounded command for isolated hosted Agent Computer execution with public HTTP(S) egress and private/internal destination blocking.",
    "sandbox.run_tests": "Submit a bounded test command for isolated hosted Agent Computer execution with public HTTP(S) egress and private/internal destination blocking.",
    "artifact.create": "Store a generated output artifact subject to workspace retention policy.",
    "artifact.get": "Read artifact metadata or bytes subject to workspace grants.",
    "usage.read": "Read the active plan, allotted limits, numeric usage, and quota progress. Alias: limits.read.",
    "job.status": "Read hosted work status and failure metadata.",
    "job.cancel": "Cancel queued or running hosted work when explicitly confirmed."
  })[name];
}

function inputSchemaForCapability(name: CapabilityName): Record<string, unknown> {
  if (name === "usage.read") {
    return {
      type: "object",
      properties: {},
      additionalProperties: false
    };
  }
  if (name === "browser.agent_task") {
    return {
      type: "object",
      properties: {
        url: { type: "string", description: "HTTPS public URL. Localhost, private IPs, URL credentials, and internal hosts are denied." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: MAX_BROWSER_AGENT_TASK_TIMEOUT_MS },
        idleTimeoutMs: { type: "integer", minimum: 1000, maximum: DEFAULT_BROWSER_AGENT_IDLE_TIMEOUT_MS },
        instructions: { type: "string", maxLength: 4000 },
        actions: {
          type: "array",
          maxItems: MAX_BROWSER_AGENT_ACTIONS,
          items: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["navigate", "click", "type", "scroll", "wait", "snapshot"] },
              url: { type: "string" },
              selector: { type: "string", maxLength: 500 },
              text: { type: "string", maxLength: 2000 },
              deltaY: { type: "integer", minimum: -10000, maximum: 10000 },
              ms: { type: "integer", minimum: 1, maximum: 30000 }
            },
            required: ["action"],
            additionalProperties: false
          }
        }
      },
      required: ["url"],
      additionalProperties: false
    };
  }
  if (name === "browser.crawl_site") {
    return {
      type: "object",
      properties: {
        url: { type: "string", description: "HTTPS public URL. Localhost, private IPs, URL credentials, and internal hosts are denied." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: MAX_BROWSER_TOOL_TIMEOUT_MS },
        maxPages: { type: "integer", minimum: 1, maximum: MAX_BROWSER_CRAWL_PAGES_PER_RUN },
        maxDepth: { type: "integer", minimum: 0, maximum: MAX_BROWSER_CRAWL_DEPTH },
        render: { type: "boolean", default: true },
        format: { type: "string", enum: ["markdown", "html"] }
      },
      required: ["url"],
      additionalProperties: false
    };
  }
  if (name.startsWith("browser.")) {
    return {
      type: "object",
      properties: {
        url: { type: "string", description: "HTTPS public URL. Localhost, private IPs, URL credentials, and internal hosts are denied." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: MAX_BROWSER_TOOL_TIMEOUT_MS },
        format: { type: "string", enum: ["png", "jpeg", "pdf", "markdown"] }
      },
      required: ["url"],
      additionalProperties: false
    };
  }
  if (name.startsWith("sandbox.")) {
    return {
      type: "object",
      properties: {
        command: { type: "string", minLength: 1, maxLength: 4096, description: "Command to run in the hosted sandbox. It is never executed locally by vc-tools." },
        network: { type: "boolean", default: true, description: "Compatibility flag. Public HTTP(S) egress is available by default; private/internal destinations are blocked by hosted policy." },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 1800000 }
      },
      required: ["command"],
      additionalProperties: false
    };
  }
  if (name.startsWith("artifact.")) {
    return {
      type: "object",
      properties: {
        artifactId: { type: "string" },
        kind: { type: "string" }
      },
      additionalProperties: false
    };
  }
  return {
    type: "object",
    properties: {
      jobId: { type: "string" },
      confirmed: { type: "boolean", default: false }
    },
    additionalProperties: false
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestId(): string {
  return crypto.randomUUID();
}

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const left = hexToBytes(a);
  const right = hexToBytes(b);
  return timingSafeEqualBytes(left, right);
}

function timingSafeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length === 0 || left.length !== right.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) {
    return new Uint8Array();
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function browserMarkdown(extracted: unknown): string {
  if (!isRecord(extracted)) {
    return "# Untitled\n\nNo readable content was extracted.\n";
  }
  const title = typeof extracted.title === "string" && extracted.title.trim() ? extracted.title.trim() : "Untitled";
  const finalUrl = typeof extracted.finalUrl === "string" ? extracted.finalUrl : "";
  const text = typeof extracted.text === "string" ? extracted.text : "";
  const links = Array.isArray(extracted.links) ? extracted.links : [];
  const linkLines = links
    .filter(isRecord)
    .map((link) => {
      const label = typeof link.text === "string" && link.text.trim() ? link.text.trim() : "link";
      const href = typeof link.href === "string" ? link.href : "";
      return href ? `- [${escapeMarkdown(label)}](${href})` : "";
    })
    .filter(Boolean)
    .join("\n");
  return [
    `# ${title}`,
    finalUrl ? `Source: ${finalUrl}` : "",
    text,
    linkLines ? "## Links" : "",
    linkLines
  ].filter(Boolean).join("\n\n");
}

function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isBlockedHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return true;
  }
  if (INTERNAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    return true;
  }
  if (isIPv4(hostname)) {
    return isBlockedIPv4(hostname);
  }
  if (isLikelyIPv6(hostname)) {
    return isBlockedIPv6(hostname);
  }
  return false;
}

function isIPv4(hostname: string): boolean {
  const parts = hostname.split(".");
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function isLikelyIPv6(hostname: string): boolean {
  return hostname.includes(":");
}

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number(part));
  const [a, b] = parts;
  if (a === undefined || b === undefined) {
    return true;
  }
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  const ipv4Tail = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(normalized)?.[1];
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab][0-9a-f]:/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("::ffff:") ||
    normalized.startsWith("64:ff9b:") ||
    normalized.startsWith("2002:") ||
    (ipv4Tail ? isBlockedIPv4(ipv4Tail) : false)
  );
}

function safeJson(input: string | null): unknown {
  if (!input) {
    return undefined;
  }
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return undefined;
  }
}

function safeDownloadName(row: ArtifactRow): string {
  const extension = row.content_type.includes("pdf")
    ? "pdf"
    : row.content_type.includes("json")
      ? "json"
      : row.content_type.includes("markdown")
        ? "md"
        : row.content_type.includes("jpeg")
          ? "jpg"
          : row.content_type.includes("png")
            ? "png"
            : "bin";
  return `${row.id}.${extension}`;
}

function sanitizeFilename(input: string): string {
  return input.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 180) || "artifact.bin";
}

function sanitizeKind(input: string): string {
  return input.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 80) || "artifact";
}

function sanitizeErrorMessage(input: string): string {
  return input.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [REDACTED]").slice(0, 1000);
}

function sanitizeAlertErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return sanitizeErrorMessage(message).slice(0, 300);
}

function sanitizeOperatorAlertPath(pathname: string): string {
  const path = normalizePath(pathname);
  return path
    .replace(/^\/v1\/jobs\/[^/]+(\/cancel)?$/, "/v1/jobs/:id$1")
    .replace(/^\/v1\/artifacts\/[^/]+(\/download)?$/, "/v1/artifacts/:id$1")
    .replace(/^\/v1\/scheduled-qa\/[^/]+$/, "/v1/scheduled-qa/:id")
    .replace(/\/[A-Za-z0-9_-]{16,}/g, "/:id")
    .slice(0, 160) || "/";
}

function truncateLargeText(input: string): string {
  return input.length > MAX_SANDBOX_OUTPUT_CHARS ? `${input.slice(0, MAX_SANDBOX_OUTPUT_CHARS)}\n[truncated]` : input;
}

function queueMessageAttempts(message: { attempts?: unknown }): number {
  return typeof message.attempts === "number" && Number.isFinite(message.attempts) && message.attempts >= 1
    ? Math.floor(message.attempts)
    : 1;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${round2(bytes / 1024 / 1024 / 1024)} GiB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${round2(bytes / 1024 / 1024)} MiB`;
  }
  if (bytes >= 1024) {
    return `${round2(bytes / 1024)} KiB`;
  }
  return `${bytes} bytes`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char] ?? char);
}

function escapeMarkdown(value: string): string {
  return value.replace(/[[\]()`]/g, "\\$&");
}

function nowIso(): string {
  return new Date().toISOString();
}

function startOfMonthIso(): string {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

function startOfMonthIsoFor(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return startOfMonthIso();
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

function startOfDayIso(): string {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0)).toISOString();
}

function isExpiredIso(value: string | null | undefined): boolean {
  return typeof value === "string" && Date.parse(value) <= Date.now();
}

function addDaysIso(input: string, days: number): string {
  const date = new Date(input);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function subtractMinutesIso(input: string, minutes: number): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return new Date(Date.now() - minutes * 60_000).toISOString();
  }
  date.setUTCMinutes(date.getUTCMinutes() - minutes);
  return date.toISOString();
}

function addMinutesIso(input: string, minutes: number): string {
  const date = new Date(input);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function syntheticRequest(jobId: string): Request {
  return new Request(`https://tools.vibecodr.space/internal/jobs/${encodeURIComponent(jobId)}`);
}
