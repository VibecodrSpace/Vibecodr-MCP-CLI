import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

const required = {
  packageJson: [
    '"name": "@vibecodr/vc-tools"',
    '"vc-tools": "dist/bin/vc-tools.js"',
    '"verify:goal": "node scripts/check-goal-coverage.mjs"',
    '"verify:release": "node scripts/check-release-readiness.mjs"'
  ],
  readme: [
    "vc-tools start",
    "vc-tools agent connect --client codex",
    "vc-tools computer run \"npm test\"",
    "vc-tools browser screenshot https://example.com --format png",
    "vc-tools work follow job_123",
    "vc-tools proof save art_123 --out ./artifacts",
    "vc-tools login --credential-file <path>",
    "vc-tools login --credential-stdin",
    "vc-tools login --credential <vc-tools-grant-or-clerk-credential>",
    "vc-tools dashboard",
    "Hosted Worker"
  ],
  goalDoc: [
    "vc-tools login",
    "vc-tools computer start",
    "computer.*",
    "artifact"
  ],
  apiContract: [
    "Remote MCP Contract",
    "tools/list",
    "tools/call",
    "browser.render_url",
    "browser.screenshot_url",
    "browser.extract_markdown",
    "browser.render_pdf",
    "sandbox.run_command",
    "sandbox.run_tests",
    "artifact.create",
    "artifact.get",
    "job.status",
    "job.cancel",
    "Streamable HTTP",
    "No authenticated",
    "Paid sandbox public HTTP(S) egress",
    "No browser recording",
    "quota"
  ],
  validationMatrix: [
    "Separate tool from Vibecodr CLI",
    "CLI login",
    "Agent Computer first-use path",
    "Remote agent connection setup",
    "Browser render/screenshot/markdown/PDF tests",
    "Agent Computer run/tests",
    "Proof store/read/save/delete",
    "Work status/cancel/list",
    "Usage quotas",
    "Tool grants",
    "Retention settings",
    "Plan packaging",
    "Free/Creator/Pro plan limits",
    "Separate ledgers",
    "Account-wide hosted capacity breakers",
    "Dashboard sections",
    "Tool grants",
    "Remote MCP tool server",
    "No raw provider credential exposure",
    "All tool calls quota-checked and logged",
    "Human-use security hardening",
    "Hosted API/MCP scaffold",
    "Live Cloudflare provider",
    "Production-grade packaging",
    "Inspectable goal coverage"
  ],
  completionAudit: [
    "Prompt-to-Artifact Checklist",
    "Hosted Production Evidence",
    "live-hosted-production",
    "production-smoked",
    "Release channel cannot hide live gaps"
  ],
  cliRun: [
    'case "inspect"',
    'case "start"',
    'case "agent"',
    'case "computer"',
    'case "browser"',
    'case "work"',
    'case "proof"',
    "commandInspect",
    'case "login"',
    'case "connect"',
    'case "tools"',
    'case "jobs"',
    'case "artifacts"',
    'case "usage"',
    'case "grants"',
    'case "retention"',
    'case "plans"',
    'case "dashboard"',
    'case "doctor"'
  ],
  goalCoverage: [
    "separate-tool-identity",
    "agent-computer-first-use",
    "browser-tools",
    "sandbox-tools",
    "artifact-tools",
    "job-tools",
    "usage-grants-retention-plans",
    "security-gates",
    "human-use-security-hardening",
    "hosted-service",
    "live-hosted-production"
  ],
  releaseReadiness: [
    "VC_TOOLS_RELEASE_CHANNEL",
    "cli-contract",
    "live-hosted-production",
    "Live releases require zero hosted-required inspections"
  ],
  testsCli: [
    "help and version identify the separate vc-tools CLI",
    "login exchanges a Clerk OAuth token and stores a refreshable local credential",
    "login stores a scoped Clerk API key as the durable local credential",
    "stored API key refreshes an expired vc-tools grant before account calls",
    "tools test validates browser URLs before remote calls",
    "agent-computer aliases submit safe hosted work without exposing low-level commands",
    "start verifies the Agent Computer and returns agent connection details",
    "sandbox tests are remote submissions with public HTTP(S) network enabled",
    "dashboard exposes safe hosted dashboard sections",
    "inspect reports machine-readable goal coverage"
  ],
  testsHosted: [
    "hosted worker fails closed without auth secret",
    "hosted worker accepts scoped Vibecodr CLI grants and denies missing vc-tools scope",
    "hosted live mode enforces VC Tool quotas before dispatching cost-bearing work",
    "hosted worker implements MCP initialize, tools/list, and tools/call contract flow",
    "hosted worker exposes customer-safe plan metadata while keeping internal launch metadata actor-scoped",
    "hosted live mode rejects DNS responses without address records",
    "hosted live mode writes audit and job state before dispatching browser work",
    "hosted live mode starts browser agent tasks through Workflows instead of Queue execution",
    "hosted live mode does not require the Queue binding to start Browser Agent Workflow jobs",
    "hosted scheduled check alerts on account-level Cloudflare spend anomaly without user fanout",
    "hosted queue handler skips cancelled jobs before cost-bearing execution",
    "hosted queue handler stores control artifacts and completes jobs"
  ],
  testsLimits: [
    "vc-tools publishes the exact Free, Creator, and Pro launch limit matrix",
    "vc-tools credit meters are separate from compatibility projections"
  ]
};

const files = {
  packageJson: "package.json",
  readme: "README.md",
  goalDoc: "vc-tools-goal.md",
  apiContract: "docs/API-CONTRACT.md",
  validationMatrix: "docs/VALIDATION-MATRIX.md",
  completionAudit: "docs/COMPLETION-AUDIT.md",
  cliRun: "src/cli/run.ts",
  goalCoverage: "src/core/goal-coverage.ts",
  releaseReadiness: "scripts/check-release-readiness.mjs",
  testsCli: "test/cli.behavior.test.ts",
  testsHosted: "test/hosted-worker.test.ts",
  testsLimits: "test/limits.test.ts"
};

const failures = [];
const contents = {};
for (const [key, file] of Object.entries(files)) {
  const content = await readFile(path.join(root, file), "utf8");
  contents[key] = content;
  for (const needle of required[key]) {
    if (!content.includes(needle)) {
      failures.push(`${file} is missing required coverage marker: ${needle}`);
    }
  }
}

const forbidden = {
  goalDoc: ["vibecodr tools connect", "vibecodr tools test", "vibecodr artifacts pull <job-id>"]
};

for (const [key, needles] of Object.entries(forbidden)) {
  const file = files[key];
  const content = contents[key] ?? "";
  for (const needle of needles) {
    if (content.includes(needle)) {
      failures.push(`${file} still contains stale coverage marker: ${needle}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Verified vc-tools goal coverage markers.");
}
