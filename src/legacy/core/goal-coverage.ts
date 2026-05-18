export type InspectionStatus = "local-verified" | "hosted-required";

export interface GoalInspection {
  id: string;
  requirement: string;
  status: InspectionStatus;
  artifacts: string[];
  validations: string[];
}

export const GOAL_INSPECTIONS: GoalInspection[] = [
  {
    id: "separate-tool-identity",
    requirement: "vc-tools is a separate tool from the existing Vibecodr CLI.",
    status: "local-verified",
    artifacts: ["package.json", "README.md", "AGENTS.md", "src/cli/run.ts"],
    validations: ["test/cli.behavior.test.ts: help and version identify the separate vc-tools CLI", "scripts/check-goal-coverage.mjs"]
  },
  {
    id: "login",
    requirement: "CLI login verifies direct tokens, stores durable account credentials when available, and refreshes scoped vc-tools grants from that durable credential.",
    status: "local-verified",
    artifacts: ["src/cli/run.ts", "src/config/credential-store.ts", "src/config/store.ts", "docs/SECURITY.md"],
    validations: [
      "test/cli.behavior.test.ts: login verifies token, stores credentials, and redacts JSON diagnostics",
      "test/cli.behavior.test.ts: login exchanges a Clerk OAuth token for a stored vc-tools grant",
      "test/cli.behavior.test.ts: login stores a scoped Clerk API key as the durable local credential",
      "test/cli.behavior.test.ts: stored API key refreshes an expired vc-tools grant before account calls",
      "test/cli.behavior.test.ts: env API keys can authenticate one-off commands through the exchange without being stored",
      "test/cli.behavior.test.ts: login rejects ambiguous credential sources before network calls"
    ]
  },
  {
    id: "connect",
    requirement: "CLI can configure/debug the hosted remote MCP connection.",
    status: "local-verified",
    artifacts: ["src/cli/run.ts", "docs/API-CONTRACT.md"],
    validations: ["test/cli.behavior.test.ts: connect returns hosted Streamable HTTP metadata without leaking token"]
  },
  {
    id: "agent-computer-first-use",
    requirement: "vc-tools exposes an account-first Agent Computer path for agents through start/setup, agent, computer, browser, work, proof, and usage surfaces.",
    status: "local-verified",
    artifacts: ["src/cli/run.ts", "src/core/contracts.ts", "src/hosted/worker.ts", "README.md", "docs/API-CONTRACT.md", "docs/VALIDATION-MATRIX.md"],
    validations: [
      "test/cli.behavior.test.ts: agent-computer aliases submit safe hosted work without exposing low-level commands",
      "test/cli.behavior.test.ts: start verifies the Agent Computer and returns agent connection details",
      "test/hosted-worker.test.ts: hosted worker implements MCP initialize, tools/list, and tools/call contract flow"
    ]
  },
  {
    id: "browser-tools",
    requirement: "CLI offers agent-facing browser render, screenshot, markdown/read, PDF, bounded public crawl, and paid browser task calls while keeping Quick Actions short.",
    status: "local-verified",
    artifacts: ["src/core/contracts.ts", "src/core/validators.ts", "src/cli/run.ts"],
    validations: ["test/cli.behavior.test.ts: agent-computer aliases submit safe hosted work without exposing low-level commands", "test/cli.behavior.test.ts: tools test submits canonical browser capability payloads", "test/cli.behavior.test.ts: tools test keeps Quick Actions short while allowing paid agent task payloads", "test/cli.behavior.test.ts: tools test submits canonical crawl capability payloads", "test/validators.test.ts: rejects unsafe browser URL shapes before remote tool calls"]
  },
  {
    id: "sandbox-tools",
    requirement: "CLI offers Agent Computer run/test submissions without executing untrusted commands locally.",
    status: "local-verified",
    artifacts: ["src/core/contracts.ts", "src/core/validators.ts", "src/cli/run.ts"],
    validations: ["test/cli.behavior.test.ts: sandbox tests are remote submissions with public HTTP(S) network enabled", "test/validators.test.ts: rejects empty and oversized sandbox commands"]
  },
  {
    id: "artifact-tools",
    requirement: "CLI offers proof/artifact list, read, save/pull, create, and delete workflows.",
    status: "local-verified",
    artifacts: ["src/cli/run.ts", "docs/API-CONTRACT.md"],
    validations: ["test/cli.behavior.test.ts: artifacts pull writes inside workspace and refuses traversal/overwrite", "test/cli.behavior.test.ts: artifacts create requires --yes and sends multipart form", "test/cli.behavior.test.ts: artifacts delete requires --yes and removes hosted shelf entry"]
  },
  {
    id: "job-tools",
    requirement: "CLI offers hosted work list, status/follow, and cancel workflows through the work/jobs command families.",
    status: "local-verified",
    artifacts: ["src/cli/run.ts", "docs/API-CONTRACT.md"],
    validations: ["test/cli.behavior.test.ts: job cancellation requires explicit confirmation", "test/cli.behavior.test.ts: list/read command families route to expected endpoints"]
  },
  {
    id: "usage-grants-retention-plans",
    requirement: "CLI exposes usage/limits, grants, retention, dashboard, Free/Creator/Pro plan limits, separate VC Tool credits, overage meters, launch safety policy surfaces, and explicit hosted-authority boundaries for open-source clients.",
    status: "local-verified",
    artifacts: ["src/cli/run.ts", "src/core/contracts.ts", "README.md"],
    validations: ["test/limits.test.ts: vc-tools publishes the exact Free, Creator, and Pro launch limit matrix", "test/limits.test.ts: vc-tools credit meters are separate from compatibility projections", "test/cli.behavior.test.ts: usage and limits show quota progress while preserving JSON data", "test/cli.behavior.test.ts: plans works offline with local fallback packaging", "test/cli.behavior.test.ts: plans fallback is non-authoritative for hosted entitlement", "test/cli.behavior.test.ts: retention set validates mutation confirmation and bounds", "test/cli.behavior.test.ts: dashboard exposes safe hosted dashboard sections including internal COGS", "test/cli.behavior.test.ts: list/read command families route to expected endpoints", "test/hosted-worker.test.ts: hosted worker exposes customer-safe plan metadata while keeping internal launch metadata actor-scoped"]
  },
  {
    id: "security-gates",
    requirement: "CLI enforces pre-cost local safety gates and redacts secrets.",
    status: "local-verified",
    artifacts: ["src/core/redaction.ts", "src/core/validators.ts", "docs/SECURITY.md"],
    validations: [
      "test/cli.behavior.test.ts: login verifies token, stores credentials, and redacts JSON diagnostics",
      "test/cli.behavior.test.ts: login stores a scoped Clerk API key as the durable local credential",
      "test/cli.behavior.test.ts: stored tokens are not sent to insecure local API URLs unless explicitly allowed",
      "test/cli.behavior.test.ts: tools test validates browser URLs before remote calls",
      "test/validators.test.ts: rejects unsafe browser URL shapes before remote tool calls"
    ]
  },
  {
    id: "human-use-security-hardening",
    requirement: "vc-tools is hardened for secure human use with scoped hosted auth, actor-isolated jobs/artifacts/usage, Browser Run SSRF defenses, bounded artifact upload/download paths, paid sandbox public HTTP(S) egress with private/internal denial, and retention-backed artifact expiry.",
    status: "local-verified",
    artifacts: ["src/core/api-client.ts", "src/core/validators.ts", "src/cli/run.ts", "src/hosted/worker.ts", "migrations/0002_actor_scope.sql", "migrations/0003_quota_reservations.sql", "migrations/0004_sandbox_quota_reservations.sql", "migrations/0005_operator_alert_dedupe.sql", "docs/SECURITY.md"],
    validations: [
      "test/cli.behavior.test.ts: stored tokens are not sent to insecure local API URLs unless explicitly allowed",
      "test/cli.behavior.test.ts: artifacts pull rejects symlinked output paths before download",
      "test/cli.behavior.test.ts: artifacts create requires --yes and sends multipart form",
      "test/cli.behavior.test.ts: artifacts delete requires --yes and removes hosted shelf entry",
      "test/hosted-worker.test.ts: hosted worker accepts scoped Vibecodr CLI grants and denies missing vc-tools scope",
      "test/hosted-worker.test.ts: hosted worker requires scoped CLI grants to include requested tool capability",
      "test/hosted-worker.test.ts: hosted worker rejects authenticated browser material before provider execution",
      "test/hosted-worker.test.ts: hosted live mode rejects DNS responses without address records",
      "test/hosted-worker.test.ts: hosted live mode writes audit and job state before dispatching browser work",
      "test/hosted-worker.test.ts: hosted live mode enforces total artifact storage before upload writes",
      "test/hosted-worker.test.ts: hosted live mode removes R2 bytes when artifact reservation loses the race",
      "test/hosted-worker.test.ts: hosted live mode deletes artifact bytes and actor-scoped metadata",
      "test/hosted-worker.test.ts: hosted scheduled cleanup alerts when expired artifact cleanup fails without user fanout",
      "test/hosted-worker.test.ts: hosted live mode applies unsafe browser URL policy to all Quick Actions before binding checks",
      "test/hosted-worker.test.ts: hosted live mode reports queued-ahead metadata without delaying interactive tools",
      "test/hosted-worker.test.ts: hosted live mode starts browser agent tasks through Workflows instead of Queue execution",
      "test/hosted-worker.test.ts: hosted live mode does not require the Queue binding to start Browser Agent Workflow jobs",
      "test/hosted-worker.test.ts: hosted live mode reserves sandbox seconds before queueing sandbox work",
      "test/hosted-worker.test.ts: hosted live mode enforces VC Tool quotas before dispatching cost-bearing work",
      "test/hosted-worker.test.ts: hosted live mode records quota denial metrics before cost-bearing work",
      "test/hosted-worker.test.ts: hosted queue handler uses Browser Run Quick Actions and metered browser time",
      "test/hosted-worker.test.ts: hosted Browser Agent Workflow uses paid Browser Sessions and records closure metadata",
      "test/hosted-worker.test.ts: hosted queue handler rejects Browser Agent execution because Workflows own that lane",
      "test/hosted-worker.test.ts: hosted Browser Agent Workflow idle-closes wait-only paid browser agent tasks and still closes the browser",
      "test/hosted-worker.test.ts: hosted queue handler uses Browser Run crawl Quick Action and meters crawl pages",
      "test/hosted-worker.test.ts: hosted queue handler defers provider rate limits without marking jobs failed",
      "test/hosted-worker.test.ts: hosted queue handler defers browser jobs above the account-wide hard cap",
      "test/hosted-worker.test.ts: hosted queue handler defers sandbox jobs above the account-wide hard cap",
      "test/hosted-worker.test.ts: hosted queue handler fans soft-cap alerts to internal alert channels",
      "test/hosted-worker.test.ts: hosted queue handler audits missing operator alert notifier bindings",
      "test/hosted-worker.test.ts: hosted queue handler does not complete jobs cancelled during execution",
      "test/hosted-worker.test.ts: hosted queue handler skips cancelled jobs before cost-bearing execution",
      "test/hosted-worker.test.ts: hosted queue handler stores control artifacts and completes jobs"
    ]
  },
  {
    id: "packaging",
    requirement: "Package is buildable, testable, auditable, and publishable as @vibecodr/vc-tools.",
    status: "local-verified",
    artifacts: ["package.json", ".github/workflows/ci.yml", "scripts/check-pack-artifact.mjs", "docs/RELEASE-CHECKLIST.md"],
    validations: ["npm run verify", "npm audit --audit-level=moderate"]
  },
  {
    id: "hosted-service",
    requirement: "Hosted Tools API/MCP service has a Cloudflare Worker surface with fail-closed auth, scoped CLI grants, dashboard, MCP JSON-RPC tool flow, quota/audit-shaped contract mode, and live Browser Run/Sandbox execution behind hosted gates.",
    status: "local-verified",
    artifacts: ["src/hosted/worker.ts", "wrangler.jsonc", "migrations/0001_live_schema.sql", "migrations/0002_actor_scope.sql", "migrations/0003_quota_reservations.sql", "migrations/0004_sandbox_quota_reservations.sql", "migrations/0005_operator_alert_dedupe.sql", "docs/API-CONTRACT.md", "docs/VALIDATION-MATRIX.md"],
    validations: ["npm run check:worker", "test/limits.test.ts: wrangler config splits Creator and Pro sandbox container lanes", "test/hosted-worker.test.ts: hosted worker fails closed without auth secret", "test/hosted-worker.test.ts: hosted worker records auth failure metrics without token material", "test/hosted-worker.test.ts: hosted worker accepts scoped Vibecodr CLI grants and denies missing vc-tools scope", "test/hosted-worker.test.ts: hosted worker requires scoped CLI grants to include requested tool capability", "test/hosted-worker.test.ts: hosted worker accepts tool tests in contract mode", "test/hosted-worker.test.ts: hosted worker exposes paid agent browser task limits without widening quick actions", "test/hosted-worker.test.ts: hosted worker implements MCP initialize, tools/list, and tools/call contract flow", "test/hosted-worker.test.ts: hosted live mode writes audit and job state before dispatching browser work", "test/hosted-worker.test.ts: hosted live mode enforces total artifact storage before upload writes", "test/hosted-worker.test.ts: hosted live mode removes R2 bytes when artifact reservation loses the race", "test/hosted-worker.test.ts: hosted live mode applies unsafe browser URL policy to all Quick Actions before binding checks", "test/hosted-worker.test.ts: hosted live mode reports queued-ahead metadata without delaying interactive tools", "test/hosted-worker.test.ts: hosted live mode starts browser agent tasks through Workflows instead of Queue execution", "test/hosted-worker.test.ts: hosted live mode does not require the Queue binding to start Browser Agent Workflow jobs", "test/hosted-worker.test.ts: hosted live mode reserves sandbox seconds before queueing sandbox work", "test/hosted-worker.test.ts: hosted live mode enforces VC Tool quotas before dispatching cost-bearing work", "test/hosted-worker.test.ts: hosted live mode records quota denial metrics before cost-bearing work", "test/hosted-worker.test.ts: hosted live mode does not queue when atomic quota reservation loses the race", "test/hosted-worker.test.ts: hosted live mode rejects DNS responses without address records", "test/hosted-worker.test.ts: hosted queue handler uses Browser Run Quick Actions and metered browser time", "test/hosted-worker.test.ts: hosted Browser Agent Workflow uses paid Browser Sessions and records closure metadata", "test/hosted-worker.test.ts: hosted queue handler rejects Browser Agent execution because Workflows own that lane", "test/hosted-worker.test.ts: hosted Browser Agent Workflow idle-closes wait-only paid browser agent tasks and still closes the browser", "test/hosted-worker.test.ts: hosted queue handler uses Browser Run crawl Quick Action and meters crawl pages", "test/hosted-worker.test.ts: hosted queue handler defers provider rate limits without marking jobs failed", "test/hosted-worker.test.ts: hosted queue handler defers browser jobs above the account-wide hard cap", "test/hosted-worker.test.ts: hosted Browser Agent Workflow defers Browser Session jobs above the account-wide hard cap", "test/hosted-worker.test.ts: hosted queue handler defers sandbox jobs above the account-wide hard cap", "test/hosted-worker.test.ts: hosted queue handler lets failed job messages reach the configured DLQ retry boundary", "test/hosted-worker.test.ts: hosted queue handler stops exhausted failed job messages from looping forever", "test/hosted-worker.test.ts: hosted queue handler fans soft-cap alerts to internal alert channels", "test/hosted-worker.test.ts: hosted Browser Agent Workflow emits account-wide soft-cap alerts for Browser Session jobs", "test/hosted-worker.test.ts: hosted queue handler audits missing operator alert notifier bindings", "test/hosted-worker.test.ts: hosted scheduled check alerts on account-level queue backlog without user fanout", "test/hosted-worker.test.ts: hosted scheduled check alerts on account-level DLQ backlog without user fanout", "test/hosted-worker.test.ts: hosted scheduled check alerts on account-level artifact storage growth without user fanout", "test/hosted-worker.test.ts: hosted scheduled cleanup alerts when expired artifact cleanup fails without user fanout", "test/hosted-worker.test.ts: hosted scheduled check alerts on account-level execution failure and timeout rates without user fanout", "test/hosted-worker.test.ts: hosted scheduled check alerts on account-level auth failure anomalies without user fanout", "test/hosted-worker.test.ts: hosted scheduled check alerts on account-level Cloudflare spend anomaly without user fanout", "test/hosted-worker.test.ts: hosted worker alerts on unexpected 500s without leaking user or query data", "test/hosted-worker.test.ts: hosted queue handler skips cancelled jobs before cost-bearing execution"]
  },
  {
    id: "live-hosted-production",
    requirement: "Live hosted Tools API/MCP service performs real Browser Run, Sandbox, R2 artifacts, queues, quota, audit, and plan enforcement after Cloudflare resources, secrets, and routes are provisioned.",
    status: "hosted-required",
    artifacts: ["src/hosted/worker.ts", "wrangler.jsonc", "Dockerfile", "migrations/0001_live_schema.sql", "migrations/0002_actor_scope.sql", "migrations/0003_quota_reservations.sql", "migrations/0004_sandbox_quota_reservations.sql", "migrations/0005_operator_alert_dedupe.sql", "docs/API-CONTRACT.md", "docs/RELEASE-CHECKLIST.md"],
    validations: [
      "test/hosted-worker.test.ts: live mode rejects unsafe URLs before binding checks",
      "test/hosted-worker.test.ts: live mode writes audit and job state before dispatching browser work",
      "npx wrangler secret put VC_TOOLS_BROWSER_RUN_ACCOUNT_ID",
      "npx wrangler secret put VC_TOOLS_BROWSER_RUN_API_TOKEN",
      "npx wrangler d1 migrations apply vc-tools-db --remote",
      "npx wrangler deploy",
      "Production smoke: https://tools.vibecodr.space health live, authenticated CLI login, Browser Run Quick Action job completed, Creator browser.agent_task Workflow job completed with closure metadata, Pro browser.agent_task Workflow job completed with closure metadata, Creator standard-1 sandbox.run_command job completed, Pro standard-2 sandbox.run_command job completed, R2 artifacts listed, usage counters updated",
      "Production smoke: authenticated Browser Run crawl job completed, R2 crawl artifact read back, crawl-page usage updated",
      "Production smoke: operator alert delivery and D1 dedupe readback, /dashboard/cogs internal COGS readback"
    ]
  }
] as const;

export function goalCoverageSummary(): { total: number; localVerified: number; hostedRequired: number } {
  return {
    total: GOAL_INSPECTIONS.length,
    localVerified: GOAL_INSPECTIONS.filter((item) => item.status === "local-verified").length,
    hostedRequired: GOAL_INSPECTIONS.filter((item) => item.status === "hosted-required").length
  };
}
