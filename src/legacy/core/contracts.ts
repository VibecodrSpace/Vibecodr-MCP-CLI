export const CAPABILITIES = [
  "browser.render_url",
  "browser.screenshot_url",
  "browser.extract_markdown",
  "browser.render_pdf",
  "browser.crawl_site",
  "browser.agent_task",
  "sandbox.run_command",
  "sandbox.run_tests",
  "artifact.create",
  "artifact.get",
  "usage.read",
  "job.status",
  "job.cancel"
] as const;

export type CapabilityName = (typeof CAPABILITIES)[number];

export const CAPABILITY_ALIASES: Record<string, CapabilityName> = {
  "browser.ask": "browser.agent_task",
  "browser.notes": "browser.agent_task",
  "browser.snapshot": "browser.agent_task",
  "browser.read": "browser.extract_markdown",
  "browser.render": "browser.render_url",
  "browser.render_url": "browser.render_url",
  "browser.screenshot": "browser.screenshot_url",
  "browser.screenshot_url": "browser.screenshot_url",
  "browser.markdown": "browser.extract_markdown",
  "browser.extract_markdown": "browser.extract_markdown",
  "browser.pdf": "browser.render_pdf",
  "browser.render_pdf": "browser.render_pdf",
  "browser.crawl": "browser.crawl_site",
  "browser.crawl_site": "browser.crawl_site",
  "browser.agent": "browser.agent_task",
  "browser.session": "browser.agent_task",
  "browser.agent_task": "browser.agent_task",
  "computer.run": "sandbox.run_command",
  "computer.test": "sandbox.run_tests",
  "computer.tests": "sandbox.run_tests",
  "sandbox.run": "sandbox.run_command",
  "sandbox.run_command": "sandbox.run_command",
  "sandbox.tests": "sandbox.run_tests",
  "sandbox.run_tests": "sandbox.run_tests",
  "proof.get": "artifact.get",
  "artifact.create": "artifact.create",
  "artifact.get": "artifact.get",
  "usage": "usage.read",
  "usage.status": "usage.read",
  "usage.read": "usage.read",
  "limits": "usage.read",
  "limits.read": "usage.read",
  "work.status": "job.status",
  "work.cancel": "job.cancel",
  "job.status": "job.status",
  "job.cancel": "job.cancel"
};

export const DASHBOARD_SECTIONS = [
  { id: "overview", label: "Running work", purpose: "What the agent is doing now, recent output, and the next safe action." },
  { id: "jobs", label: "Recent work", purpose: "Recent hosted work status, cancellation state, and failures." },
  { id: "artifacts", label: "Saved proof", purpose: "Stored screenshots, PDFs, logs, files, and retention status." },
  { id: "usage", label: "Usage left", purpose: "Agent Computer capacity, browser work, computer work, proof storage, and running jobs." },
  { id: "agents", label: "Connected agents", purpose: "Hosted MCP connection details and agent-native tool names." },
  { id: "grants", label: "Tool grants", purpose: "Workspace, project, and user-scoped capability grants." },
  { id: "retention", label: "Retention", purpose: "Log and artifact retention controls, with recording policy reserved and off by default." },
  { id: "billing", label: "Billing", purpose: "Plan packaging and included quota." }
] as const;

export const OPERATOR_DASHBOARD_SECTIONS = [
  { id: "cogs", label: "COGS", purpose: "Internal cost pressure by hosted-tool surface, threshold, and plan." }
] as const;

export type DashboardSectionId =
  | (typeof DASHBOARD_SECTIONS)[number]["id"]
  | (typeof OPERATOR_DASHBOARD_SECTIONS)[number]["id"];

export const DEFAULT_PLANS = [
  {
    name: "Free",
    priceUsdMonthly: 0,
    status: "local-only",
    limits: {
      monthlyCredits: 30,
      dailyCredits: 10,
      maxConcurrentRuns: 1,
      browser: {
        defaultLane: "quick-action",
        monthlyBrowserSeconds: 30 * 60,
        dailyBrowserSeconds: 10 * 60,
        maxBrowserSecondsPerRun: 30,
        allowBrowserSessions: false,
        maxBrowserSessionSeconds: 0,
        maxConcurrentBrowserSessionsPerUser: 0
      },
      crawl: {
        maxPagesPerRun: 10,
        maxPagesPerMonth: 25,
        maxDepth: 1
      },
      scheduledQa: {
        maxRunsPerMonth: 0,
        minIntervalMinutes: 0
      },
      sandbox: {
        containerInstanceType: "none",
        maxSandboxTaskSeconds: 0
      },
      browserRenderJobsMonthly: 30,
      browserMinutesMonthly: 30,
      sandboxJobsMonthly: 0,
      sandboxMinutesMonthly: 0,
      artifactStorageGb: 0,
      artifactRetentionDays: 0,
      maxArtifactUploadBytes: 0,
      concurrentBrowserSessions: 0,
      concurrentSandboxJobs: 0
    },
    posture: {
      authenticatedBrowsing: "disabled",
      browserRecording: "disabled",
      sandboxNetwork: "disabled",
      crawl: "disabled",
      spendCap: "not-applicable"
    }
  },
  {
    name: "Creator",
    priceUsdMonthly: 19,
    limits: {
      monthlyCredits: 600,
      dailyCredits: 90,
      maxConcurrentRuns: 2,
      browser: {
        defaultLane: "quick-action",
        monthlyBrowserSeconds: 600 * 60,
        dailyBrowserSeconds: 90 * 60,
        maxBrowserSecondsPerRun: 60,
        allowBrowserSessions: true,
        maxBrowserSessionSeconds: 20 * 60,
        maxConcurrentBrowserSessionsPerUser: 1
      },
      crawl: {
        maxPagesPerRun: 50,
        maxPagesPerMonth: 500,
        maxDepth: 2
      },
      scheduledQa: {
        maxRunsPerMonth: 30,
        minIntervalMinutes: 720
      },
      sandbox: {
        containerInstanceType: "standard-1",
        maxSandboxTaskSeconds: 10 * 60
      },
      browserRenderJobsMonthly: 600,
      browserMinutesMonthly: 600,
      sandboxJobsMonthly: 600,
      sandboxMinutesMonthly: 600,
      artifactStorageGb: 1,
      artifactRetentionDays: 7,
      maxArtifactUploadBytes: 100 * 1024 * 1024,
      concurrentBrowserSessions: 1,
      concurrentSandboxJobs: 2
    },
    posture: {
      authenticatedBrowsing: "disabled",
      browserRecording: "disabled",
      sandboxNetwork: "public-egress-private-deny",
      crawl: "disabled-or-limited",
      spendCap: "hard-by-default"
    }
  },
  {
    name: "Pro",
    priceUsdMonthly: 39,
    limits: {
      monthlyCredits: 3000,
      dailyCredits: 400,
      maxConcurrentRuns: 5,
      browser: {
        defaultLane: "quick-action",
        monthlyBrowserSeconds: 3000 * 60,
        dailyBrowserSeconds: 400 * 60,
        maxBrowserSecondsPerRun: 180,
        allowBrowserSessions: true,
        maxBrowserSessionSeconds: 3600,
        maxConcurrentBrowserSessionsPerUser: 1
      },
      crawl: {
        maxPagesPerRun: 250,
        maxPagesPerMonth: 5000,
        maxDepth: 4
      },
      scheduledQa: {
        maxRunsPerMonth: 300,
        minIntervalMinutes: 60
      },
      sandbox: {
        containerInstanceType: "standard-2",
        maxSandboxTaskSeconds: 30 * 60
      },
      browserRenderJobsMonthly: 3000,
      browserMinutesMonthly: 3000,
      sandboxJobsMonthly: 3000,
      sandboxMinutesMonthly: 3000,
      artifactStorageGb: 10,
      artifactRetentionDays: 30,
      maxArtifactUploadBytes: 500 * 1024 * 1024,
      concurrentBrowserSessions: 1,
      concurrentSandboxJobs: 2
    },
    posture: {
      authenticatedBrowsing: "allowlisted-beta",
      browserRecording: "opt-in",
      sandboxNetwork: "public-egress-private-deny",
      crawl: "add-on-or-limited",
      spendCap: "soft-with-warnings"
    }
  },
] as const;

export const OVERAGE_METERS = [
  { id: "browser-minute", label: "Browser minute", unit: "minute", priceUsdRange: "$0.02-$0.05" },
  { id: "sandbox-compute-minute", label: "Sandbox compute minute", unit: "minute", priceUsdRange: "$0.03-$0.08" },
  { id: "artifact-storage-pack", label: "Additional artifact storage", unit: "50 GB-month", priceUsdRange: "$5" },
  { id: "retention-pack", label: "Additional retention", unit: "workspace-month", priceUsdRange: "$10-$25" },
  { id: "browser-concurrency-slot", label: "Extra browser concurrency slot", unit: "slot-month", priceUsdRange: "$10-$20" },
  { id: "sandbox-concurrency-slot", label: "Extra sandbox concurrency slot", unit: "slot-month", priceUsdRange: "$20-$50" },
  { id: "crawl-pack", label: "Public crawl pack", unit: "page-volume pack", priceUsdRange: "$10-$50" }
] as const;

export type PublicOfferingStatus = "shipped" | "gated beta" | "internal-only" | "future";

export const PUBLIC_OFFERING_CLASSIFICATIONS = [
  {
    id: "browser.quick_actions",
    label: "Browser Quick Actions",
    status: "shipped",
    summary: "Short public-HTTPS browser checks for render, screenshot, markdown, and PDF output."
  },
  {
    id: "browser.render",
    label: "Browser render",
    status: "shipped",
    summary: "Public-HTTPS render checks through the Quick Action lane."
  },
  {
    id: "browser.screenshot",
    label: "Browser screenshot",
    status: "shipped",
    summary: "Public-HTTPS screenshot artifacts through the Quick Action lane."
  },
  {
    id: "browser.markdown",
    label: "Browser markdown extraction",
    status: "shipped",
    summary: "Public-HTTPS content extraction through the Quick Action lane."
  },
  {
    id: "browser.pdf",
    label: "Browser PDF render",
    status: "shipped",
    summary: "Public-HTTPS PDF artifacts through the Quick Action lane."
  },
  {
    id: "browser.sessions",
    label: "Browser Sessions",
    status: "gated beta",
    summary: "Paid Agent Browser tasks with plan caps, idle closure, and no third-party auth by default."
  },
  {
    id: "browser.recording_replay",
    label: "Browser recording/replay",
    status: "future",
    summary: "Recording policy is reserved and off by default; recording/replay is not a public tool."
  },
  {
    id: "browser.interactive_debugging",
    label: "Browser interactive debugging",
    status: "future",
    summary: "Interactive browser debugging is not part of the public launch surface."
  },
  {
    id: "crawl.public",
    label: "Crawl",
    status: "gated beta",
    summary: "Bounded public-HTTPS crawl jobs with page, depth, month, and artifact limits."
  },
  {
    id: "crawl.deep",
    label: "Deep crawl",
    status: "future",
    summary: "Deep crawl pricing hooks are reserved; no public deep-crawl product ships in v1."
  },
  {
    id: "scheduled_qa",
    label: "Scheduled QA",
    status: "gated beta",
    summary: "Plan-capped periodic Browser Quick Actions that enqueue public-HTTPS render, screenshot, markdown, or PDF checks through the hosted queue."
  },
  {
    id: "sandbox.command",
    label: "Sandbox command",
    status: "gated beta",
    summary: "Paid hosted command diagnostics with plan duration, concurrency, and artifact caps."
  },
  {
    id: "sandbox.tests",
    label: "Sandbox tests",
    status: "gated beta",
    summary: "Paid hosted test-command diagnostics with the same sandbox limits."
  },
  {
    id: "sandbox.network",
    label: "Sandbox network access",
    status: "gated beta",
    summary: "Paid Agent Computers can reach public HTTP(S) package/docs endpoints by default; private, local, link-local, metadata, and internal destinations are blocked."
  },
  {
    id: "artifacts",
    label: "Artifacts",
    status: "gated beta",
    summary: "Account-scoped artifact list, create, read, pull, delete, storage caps, and retention."
  },
  {
    id: "jobs",
    label: "Durable jobs",
    status: "shipped",
    summary: "Hosted work status, list, and cancellation records for accepted tool runs."
  },
  {
    id: "dashboard",
    label: "Dashboard",
    status: "gated beta",
    summary: "Authenticated hosted dashboard sections; internal COGS remains operator-only."
  },
  {
    id: "grants",
    label: "Grants",
    status: "shipped",
    summary: "Scoped tool grants for workspace, project, user, and plan capability checks."
  },
  {
    id: "retention",
    label: "Retention",
    status: "shipped",
    summary: "Log and artifact retention controls; recording policy remains off by default."
  },
  {
    id: "overage_meters",
    label: "Overage meters",
    status: "internal-only",
    summary: "Compatibility and operator cost-pressure metadata only; no automatic customer charges."
  },
  {
    id: "stripe_metered_billing",
    label: "Stripe metered billing",
    status: "future",
    summary: "Not implemented for launch; quota exhaustion blocks work unless an opt-in billing lane ships later."
  }
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  status: PublicOfferingStatus;
  summary: string;
}>;

export const LAUNCH_TOOL_GRANTS = [
  { grant: "browser.render", capability: "browser.render_url", defaultScope: "workspace", phase: "included", allowedPlans: ["Free", "Creator", "Pro"] },
  { grant: "browser.screenshot", capability: "browser.screenshot_url", defaultScope: "workspace", phase: "included", allowedPlans: ["Free", "Creator", "Pro"] },
  { grant: "browser.markdown", capability: "browser.extract_markdown", defaultScope: "workspace", phase: "included", allowedPlans: ["Free", "Creator", "Pro"] },
  { grant: "browser.pdf", capability: "browser.render_pdf", defaultScope: "workspace", phase: "included", allowedPlans: ["Free", "Creator", "Pro"] },
  { grant: "browser.automate", capability: "browser.render_url", defaultScope: "project", phase: "pro-workflows", allowedPlans: ["Pro"] },
  { grant: "browser.live_view", capability: "browser.render_url", defaultScope: "user", phase: "pro-workflows", allowedPlans: ["Pro"] },
  { grant: "browser.record", capability: "browser.render_url", defaultScope: "project", phase: "pro-workflows", allowedPlans: ["Pro"] },
  { grant: "browser.agent_task", capability: "browser.agent_task", defaultScope: "project", phase: "paid-workflows", allowedPlans: ["Creator", "Pro"] },
  { grant: "sandbox.run", capability: "sandbox.run_command", defaultScope: "workspace", phase: "paid-alpha", allowedPlans: ["Creator", "Pro"] },
  { grant: "sandbox.tests", capability: "sandbox.run_tests", defaultScope: "workspace", phase: "paid-alpha", allowedPlans: ["Creator", "Pro"] },
  { grant: "sandbox.network", capability: "sandbox.run_command", defaultScope: "workspace", phase: "included-limited", allowedPlans: ["Creator", "Pro"] },
  { grant: "sandbox.preview_url", capability: "sandbox.run_command", defaultScope: "project", phase: "pro-workflows", allowedPlans: ["Pro"] },
  { grant: "artifact.write", capability: "artifact.create", defaultScope: "workspace", phase: "paid-alpha", allowedPlans: ["Creator", "Pro"] },
  { grant: "artifact.read", capability: "artifact.get", defaultScope: "workspace", phase: "included", allowedPlans: ["Free", "Creator", "Pro"] },
  { grant: "usage.read", capability: "usage.read", defaultScope: "workspace", phase: "included", allowedPlans: ["Free", "Creator", "Pro"] },
  { grant: "job.long_running", capability: "job.status", defaultScope: "project", phase: "included", allowedPlans: ["Free", "Creator", "Pro"] },
  { grant: "job.cancel", capability: "job.cancel", defaultScope: "project", phase: "included", allowedPlans: ["Free", "Creator", "Pro"] },
  { grant: "crawl.public", capability: "browser.crawl_site", defaultScope: "project", phase: "included-limited", allowedPlans: ["Creator", "Pro"] },
  { grant: "crawl.authenticated", capability: "browser.crawl_site", defaultScope: "user", phase: "pro-allowlisted", allowedPlans: ["Pro"] }
] as const;

export const LAUNCH_POLICIES = [
  { id: "vibecodr-subscription-ssot", rule: "Paid vc-tools access follows existing Vibecodr Creator and Pro subscriptions; vc-tools does not own a standalone Stripe catalog." },
  { id: "no-raw-cloudflare-credentials", rule: "Users authenticate to Vibecodr Tools; Cloudflare credentials stay behind the hosted service boundary." },
  { id: "quota-before-cost", rule: "Every tool call is checked against plan, quota, grants, and risk policy before Browser Run or Sandbox spend." },
  { id: "audit-before-cost", rule: "Every cost-bearing tool call emits a secret-redacted audit event before execution." },
  { id: "no-authenticated-browsing-by-default", rule: "Authenticated third-party browsing is disabled by default and reserved for allowlisted Pro workflows." },
  { id: "sandbox-public-egress-private-deny", rule: "Paid Agent Computers can use public HTTP(S) egress for package and docs work; private, local, link-local, metadata, and internal destinations stay blocked by hosted policy." },
  { id: "no-browser-recording-by-default", rule: "Browser recording is off by default and must be explicitly enabled by policy." },
  { id: "no-unlimited-crawl", rule: "Crawl is disabled or tightly limited unless a paid crawl grant is present." },
  { id: "artifact-retention-bounded", rule: "Screenshots, PDFs, logs, recordings, and sandbox files obey the workspace retention policy." }
] as const;

export const LAUNCH_WORKFLOWS = [
  "Rendered website inspection",
  "Bug reproduction",
  "Code execution and test run",
  "Research artifact generation",
  "Preview and verify"
] as const;

export interface ApiHealth {
  ok: boolean;
  service?: string;
  version?: string;
}

export interface MeResponse {
  user: { id: string; email?: string };
  workspace?: { id: string; name?: string };
  plan?: { name: string };
}
