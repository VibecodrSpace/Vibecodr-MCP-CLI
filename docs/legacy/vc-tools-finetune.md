# vc-tools Finetune Plan

Status: executed (2026-05-17). See "Execution Evidence" at the bottom of this file.

Owner: vc-tools product and platform surface

Purpose: turn `vc-tools` from a rigorous hosted capability CLI into a product
that feels like a useful, safe, permissive Agent Computer for everyday agents
and non-technical users.

## Product Thesis

`vc-tools` should feel like:

```text
My agent has a browser, a hosted computer, work history, proof, and capacity.
```

It should not feel like:

```text
I am operating an internal control plane with grants, provider modes, roadmap
metadata, launch classifications, quota internals, artifacts, jobs, and policy
objects.
```

The core v1 posture:

```text
Your agent can browse the public web, run code in a hosted computer, save proof,
and show you what happened.

Private networks, credentials, local machines, metadata services, and internal
infrastructure stay blocked unless you explicitly connect them.
```

The biggest v1 risk is not "too much safety." The biggest v1 risk is
capability/expectation mismatch caused by safety language and operator metadata
leaking into user and agent surfaces.

## Current Verdict

Do not advertise `vc-tools` as v1-ready yet.

Call it:

```text
v0.9 product-complete but surface-heavy.
```

The bones are strong:

- hosted browser
- hosted Agent Computer
- work status
- saved proof
- account limits
- auth
- quotas
- safety boundaries
- production deployment path

The remaining work is product-surface cleanup:

- remove operator and roadmap metadata from default user/agent outputs
- resolve the "computer with internet" expectation
- make proof automatic instead of ID-heavy
- make `browser ask` either truly answer or stop implying that it does
- lead with permission and usefulness before denial and policy

## What Is Already Working

- The top-level vocabulary is much better: `start`, `agent`, `computer`,
  `browser`, `work`, `proof`, `usage`, and `doctor`.
- The help text now frames `vc-tools` as the hosted Vibecodr computer for
  agents instead of a generic CLI.
- `computer --help` clearly says work is submitted to Vibecodr Tools Cloud and
  not run locally.
- The liberalized sandbox public HTTP(S) posture is the right product direction:
  an Agent Computer must be able to fetch public docs, package registries, and
  public APIs for ordinary agent work.
- `browser --help` has concrete primitives: screenshot, read, render, PDF,
  crawl, and ask.
- `doctor --json` is close to the right shape: compact, readiness-focused, and
  actionable.
- `work` and `proof` are the right product concepts for "what my agent did" and
  "what came out of it."
- The hard browser safety boundaries are directionally right: reject localhost,
  private IPs, link-local targets, URL credentials, and non-HTTPS URLs before
  cost-bearing remote work.

## Core Friction Findings

### 1. Default payloads expose too much machinery

`vc-tools start --json`, `usage --json`, and `plans --json` can expose
internal-ish fields that users and agents should not need.

Observed/default-risk fields include:

```text
offeringClassifications
overageMeters
policies
providerMode
sandboxInternetDefault
auth
scopes
tokenKind
operatorAlerts
cogs
internalApiBinding
webhook
ntfy
Cloudflare
softCap/hardCap account-pressure internals
```

These are useful to operators. They are harmful as normal product surface.

### 2. `plans` still behaves like an entitlement schema

The public buying surface should answer:

```text
What can my agent do on this plan?
```

It should not return internal/future/control-plane metadata by default, such as:

- browser recording/replay
- browser interactive debugging
- sandbox network access as internal-only metadata
- overage meters
- future Stripe metered billing
- launch classifications
- low-level policy objects

### 3. `usage` is too technical by default

The user wants to know:

```text
How much room does my agent have left?
```

Default usage should not force the user or agent to interpret sandbox minutes,
browser seconds, internal concurrency meters, platform pressure, or operator
alert metadata unless they request details.

### 4. `start` does not create a first success

`vc-tools start` verifies readiness and returns connection details, but it does
not immediately prove value.

First-run should create a quick successful artifact or proof bundle whenever
possible. The user should see that the Agent Computer can actually do something.

### 5. Proof and work are still too ID-heavy

Normal users should not need to understand `job_...` or `art_...` on their first
run.

Default flows should submit, wait, summarize, and save/open proof. Job and
artifact IDs should remain available behind `--details`, `--json`, or advanced
commands.

### 6. Network language can contradict the product

`sandboxInternetDefault: "off"` is technically understandable but emotionally
wrong when the product supports policy-brokered public HTTP(S) access.

Use user-facing wording like:

```json
{
  "network": {
    "browserPublicHttps": "available",
    "computerPublicHttps": "available",
    "privateLocalNetworks": "blocked",
    "metadataServices": "blocked",
    "rawNetwork": "restricted"
  }
}
```

### 7. `computer.run` must feel like a real Agent Computer

If the product promise is a hosted computer for agents, the paid/default path
must support ordinary public internet work:

- install public packages
- fetch public docs
- call public APIs
- run real setup/test commands

Private/local/internal destinations, metadata services, credentials, and
unbounded raw network access should stay blocked.

### 8. `browser ask` may overpromise

`browser ask` sounds semantic:

```text
Ask the hosted browser to inspect this page.
```

If the worker only captures a snapshot/log/action record for the calling agent to
interpret, the command should not imply that the browser itself answers.

For v1, pick one:

- implement real semantic ask with answer, evidence, and proof
- rename/reframe it as snapshot/inspect and say the calling agent analyzes it

### 9. Safety messages lead with denial

The safety model is mostly correct. The wording should lead with what is allowed
and then explain the boundary.

Bad feeling:

```text
Browser URL must not target localhost.
```

Better:

```text
Blocked for safety: vc-tools can browse public HTTPS pages, but not localhost or
private networks. Try a public preview URL, deploy preview, or a future
consented private-network connector.
```

### 10. The dashboard should be a companion surface

The dashboard should answer:

- What is my agent doing?
- What did it produce?
- How much capacity do I have left?
- Which agents are connected?

Default order should be:

```text
Running work
Recent work
Saved proof
Usage left
Connected agents
```

Grants, retention, billing, policy detail, and operator COGS belong in secondary
or operator-only surfaces.

## P0 Launch Blockers

### P0.1 Split every surface into human, agent, and operator contracts

Implement explicit serializers instead of treating full redacted API responses
as the public output contract.

Required serializers:

```text
publicStartPayload
publicUsagePayload
publicPlansPayload
publicHealthPayload
```

Default human output:

- short
- action-oriented
- friendly
- no internal/future/operator metadata

Default agent JSON:

- stable
- compact
- only fields an agent needs to act
- no roadmap/operator internals

Operator/debug output:

- explicit `--details` for expanded user debugging
- explicit `--operator` for operator-scoped tokens
- server-side gated, not CLI-only hiding

Desired default `vc-tools start --json` shape:

```json
{
  "ok": true,
  "data": {
    "ready": true,
    "account": {
      "label": "user@example.com",
      "workspace": "vc-tools workspace",
      "plan": "Pro"
    },
    "connection": {
      "transport": "streamable_http",
      "url": "https://tools.vibecodr.space/mcp",
      "protocolVersion": "2025-11-25"
    },
    "tools": [
      "browser.render",
      "browser.screenshot",
      "browser.read",
      "browser.pdf",
      "browser.crawl",
      "browser.ask",
      "computer.run",
      "computer.test",
      "work.status",
      "proof.get",
      "usage.status"
    ],
    "usage": {
      "plan": "Pro",
      "monthlyCredits": { "used": 1, "included": 3000 },
      "dailyCredits": { "used": 0, "included": 400 },
      "runningNow": { "used": 0, "included": 5 }
    },
    "nextActions": [
      "Connect your agent with vc-tools agent connect --client codex.",
      "Run vc-tools try to prove browser, computer, and proof are working."
    ]
  },
  "warnings": []
}
```

Default `start`, `usage`, `plans`, `doctor`, and `agent connect` output must not
contain these keys unless an explicit debug/operator flag is used:

```text
offeringClassifications
overageMeters
policies
providerMode
sandboxInternetDefault
auth
scopes
tokenKind
operatorAlerts
cogs
internalApiBinding
webhook
ntfy
Cloudflare
softCap
hardCap
```

Acceptance tests:

```text
vc-tools start --json
vc-tools usage --json
vc-tools plans --json
vc-tools doctor --json
```

Each must assert that no default output contains:

```text
offeringClassifications
overageMeters
providerMode
sandboxInternetDefault
auth
scopes
operatorAlerts
operator capacity metadata
```

### P0.2 Fix the "computer with internet" expectation

Make the v1 product decision explicit.

Rejected direction:

```text
A hosted sandbox for running commands and tests, with internet off by default.
```

Preferred direction:

```text
A hosted computer that can run code, install public packages, fetch public
docs/APIs, and save proof, while private/local networks and credentials stay
blocked.
```

Implementation direction:

```powershell
vc-tools computer run "npm test" --network public
vc-tools computer run "pip install requests && python script.py" --network public
```

Default posture should align with current product direction:

- public HTTP(S)/DNS allowed for ordinary paid Agent Computer work
- localhost/private/link-local/metadata/internal destinations blocked
- no raw credentials or authenticated browsing by default
- no operator package allowlist as the normal path

Supported controls:

```powershell
--network public
--network off
--allow-host registry.npmjs.org
--allow-host pypi.org
--allow-host files.pythonhosted.org
```

Do not make users hand-curate package registries for the normal paid path.
Registry host presets can exist for explicit narrowing or enterprise-style
control, not as the default happy path.

Acceptance tests:

```text
computer run "echo ok" succeeds.
computer run "...public fetch..." --network public is accepted for paid plans.
computer run "...private target..." --network public is denied with a helpful alternative.
Free plan receives a clear upgrade/plan message if networked computer is paid-only.
```

### P0.3 Make submit -> wait -> summarize -> proof the default flow

Normal commands should complete the loop.

Desired behavior:

```powershell
vc-tools browser screenshot https://example.com --out ./proof
```

should:

```text
Submit hosted work.
Wait until complete up to a default timeout.
Download/save the artifact when an output path is provided.
Print a short result.
Hide job/artifact IDs unless --details is passed.
```

Desired output:

```text
Browser screenshot completed.
Proof saved: ./proof/example.com-screenshot.png
```

For long jobs:

```text
Work accepted and still running.
Follow it: vc-tools work follow job_abc123
```

`work follow` must become a real follow command:

- poll job status
- stream status changes if possible
- stop at terminal state
- summarize proof/artifacts when complete
- save artifact when `--out` is present

Acceptance tests:

```text
browser read URL --out ./proof waits, saves markdown, and prints no required job ID.
browser screenshot URL --out ./proof waits, saves PNG/PDF as requested.
computer run "npm test" --wait prints status and saves/logs sandbox transcript.
work follow job_123 polls more than once until terminal.
--no-wait returns the advanced queued job payload.
--details shows jobId and artifactId.
```

### P0.4 Fix `browser ask`

Do not ship `browser ask` as a flagship unless it actually answers.

Path A: implement real semantic ask.

```powershell
vc-tools browser ask https://example.com "Find the signup button and summarize what a user sees."
```

Desired response:

```json
{
  "answer": "The signup CTA is in the top-right nav and hero section.",
  "evidence": [
    { "type": "text", "value": "Sign up" },
    { "type": "link", "href": "https://example.com/signup" }
  ],
  "proof": {
    "artifactId": "art_...",
    "kind": "browser-inspection"
  }
}
```

Path B: honesty-first rename/reframe.

```powershell
vc-tools browser snapshot https://example.com
```

Copy:

```text
Capture a page snapshot for your agent to analyze.
```

Acceptance:

- If the command is called `ask`, it returns an answer.
- If it does not return an answer, the public command name/copy says snapshot or
  inspect, not ask.

### P0.5 Rewrite safety denials into helpful next actions

Keep hard blocks. Change the emotional shape.

Safety messages must include:

- what was blocked
- why
- what the safe alternative is

Examples:

```text
Blocked for safety: vc-tools can browse public HTTPS pages, but not localhost or
private networks. Try a public preview URL, deploy preview, or a future
consented private-network connector.
```

```text
Blocked for safety: browser calls cannot include cookies, credentials, auth
headers, storage state, or secrets. Use a public page, or connect an
authenticated browsing session when that beta is available.
```

Acceptance tests:

- non-HTTPS URL denial includes public HTTPS next action
- localhost/private URL denial includes preview/deploy alternative
- credential/auth input denial includes public page or future authenticated
  session alternative
- private target denial in computer network mode includes public endpoint or
  future connector alternative

## P1 Before Serious Advertising

### P1.1 Add `vc-tools try`

Add a first-success command:

```powershell
vc-tools try
```

It should prove:

- auth works
- hosted API works
- browser works
- computer works
- proof saving works
- usage can be read

Desired human output:

```text
Vibecodr Agent Computer check

Browser: captured a public page.
Computer: ran a tiny command in the hosted computer.
Proof: saved a proof bundle to ./vc-tools-proof
Usage: Pro plan, 2 / 3000 monthly credits used.

Your agent computer is ready.
```

If networked computer work is unavailable:

```text
Computer: ran an offline command.
Networked computer: not enabled on this plan/config.
```

Desired JSON:

```json
{
  "ready": true,
  "checks": {
    "auth": "ok",
    "browser": "ok",
    "computer": "ok",
    "proof": "ok",
    "usage": "ok"
  },
  "proofPath": "./vc-tools-proof"
}
```

### P1.2 Make `agent connect` client-aware

`agent connect` should not only return MCP metadata. It should help the user
connect the actual agent client.

Minimum behavior:

```powershell
vc-tools agent connect --client codex
```

prints:

```text
Codex connection ready.

MCP URL:
https://tools.vibecodr.space/mcp

Add this to Codex MCP config:
<exact config block>

Then restart/open a new Codex session.
```

Preferred behavior:

```powershell
vc-tools agent connect --client codex --install
```

attempts a safe install/config update for supported clients, with backups and
clear rollback instructions. If install is unsupported, print exact copy/paste
instructions.

### P1.3 Make `plans` a buying page

Default `vc-tools plans` should be user-facing packaging, not entitlement
schema.

Desired default:

```text
Free
- Public browser checks
- 30 monthly VC Tool credits
- No hosted computer runs
- No saved proof storage

Creator - $19/mo
- Browser checks
- Hosted computer runs
- 600 monthly credits
- 1 GB proof storage
- Browser agent tasks up to 20 minutes

Pro - $39/mo
- Higher browser/computer limits
- 3,000 monthly credits
- 10 GB proof storage
- Browser agent tasks up to 1 hour
```

Detailed entitlements remain available behind:

```powershell
vc-tools plans --details
vc-tools inspect offerings
```

Operator/internal details require:

```powershell
vc-tools plans --operator
```

and server-side operator authorization.

### P1.4 Make `usage` emotionally simple

Desired default:

```text
Agent Computer capacity

Plan: Pro
Monthly credits: 1 / 3000
Daily credits: 0 / 400
Browser work: 0 / 3000
Computer work: 0 / 3000
Proof storage: 0 / 10 GB
Running now: 0 / 5
```

Then:

```text
Use vc-tools usage --details for browser seconds, sandbox minutes, and concurrency meters.
```

### P1.5 Make dashboard work/proof-first

Default dashboard order:

```text
Running work
Recent work
Saved proof
Usage left
Connected agents
```

Secondary/admin areas:

```text
Grants
Retention
Billing
Policy detail
Operator COGS
```

`vc-tools dashboard` should default to opening the dashboard for humans.

Machine-readable dashboard metadata stays behind:

```powershell
vc-tools dashboard --json
vc-tools dashboard --no-open
```

## P2 After v1

### P2.1 Add recipes and outcome commands

Examples:

```powershell
vc-tools check-site https://example.com
vc-tools screenshot https://example.com --out ./proof
vc-tools read-page https://example.com --out ./proof
vc-tools run-tests "npm test"
vc-tools proof bundle --last
```

### P2.2 Add consented authenticated browsing

Do not rush this into v1.

The no-authenticated-browser default is correct for launch. Later lanes can add
explicit, consented browser sessions with clear account/user boundaries.

### P2.3 Add private/local-network connectors

For v1, keep localhost/private networks blocked and offer safe alternatives:

```text
Use a public preview URL.
Use a deploy preview.
Use a future private connector/tunnel.
```

Later, add explicit private connector/tunnel flows with consent, auditing, and
clear per-session scope.

### P2.4 Tie proof back into Vibecodr socially

Proof should become part of the Vibecodr place, not just files.

Future handoffs:

- attach proof to a Vibecodr post
- share proof from a run
- save proof to a project
- show proof in run history
- create a public proof bundle when the user chooses

## Exact Execution Task List

Build a PR named:

```text
v1-product-surface-cleanup
```

Scope:

1. Add `publicStartPayload`, `publicUsagePayload`, `publicPlansPayload`, and
   `publicHealthPayload` serializers.
2. Add `--details` and `--operator` output modes; keep operator fields
   server-side gated.
3. Remove `offeringClassifications`, `overageMeters`, `policies`,
   `providerMode`, `sandboxInternetDefault`, `auth`, and `scopes` from default
   `start`, `usage`, `plans`, and `health` output.
4. Replace `sandboxInternetDefault: "off"` with a product-shaped network object:

   ```json
   {
     "network": {
       "browserPublicHttps": "available",
       "computerPublicHttps": "available",
       "privateLocalNetworks": "blocked",
       "metadataServices": "blocked",
       "rawNetwork": "restricted"
     }
   }
   ```

5. Add `computer run --network public` and `--network off`, or remove any copy
   implying package/API/doc fetch capability.
6. Add `vc-tools try`.
7. Implement `--wait`, `--no-wait`, `--out`, and `--details` behavior for
   browser/computer commands.
8. Make `work follow` poll until terminal status.
9. Make proof saving work without requiring manual artifact IDs.
10. Either implement real semantic `browser ask` or rename/reframe it as
    snapshot/inspect.
11. Rewrite safety errors to include the blocked reason and safe next action.
12. Add tests asserting no internal/future/operator fields appear in default
    outputs.
13. Add tests for the first-run path:

    ```text
    start
    agent connect --client codex
    try
    browser screenshot --out
    computer run --wait
    usage
    proof list
    ```

14. Update README, API contract, validation matrix, security docs, and any
    public Vibecodr/docs surfaces that describe the Agent Computer.
15. Run package verification, deploy hosted workers if behavior changes, and
    collect production smoke evidence.

## Verification Gates

Local verification:

```powershell
npm test
npm run check
npm run verify
```

Default-output leak tests:

```powershell
vc-tools start --json
vc-tools usage --json
vc-tools plans --json
vc-tools doctor --json
```

Assert none contain:

```text
offeringClassifications
overageMeters
providerMode
sandboxInternetDefault
auth
scopes
tokenKind
operatorAlerts
cogs
internalApiBinding
webhook
ntfy
Cloudflare
softCap
hardCap
```

First-run product path:

```powershell
vc-tools start
vc-tools agent connect --client codex
vc-tools try
vc-tools browser screenshot https://vibecodr.space/vc-tools --out ./proof
vc-tools computer run "node -e \"console.log('ok')\"" --wait
vc-tools usage
vc-tools proof list
```

Production smoke path:

- authenticate like a normal agent/user
- run one browser screenshot with proof saved
- run one public HTTP(S) computer command
- run one denied private/metadata target and confirm helpful denial
- confirm default JSON has no internal/operator/future leakage
- confirm dashboard points to work/proof/capacity first

## Readiness Definition

`vc-tools` can be called v1-ready when:

- the default experience is account-first and action-first
- default human output is short and useful
- default agent JSON is compact and stable
- operator/debug metadata is opt-in and server-side gated
- browser/computer/proof flows complete without manual ID handling
- public HTTP(S) Agent Computer work feels capable
- protected boundaries remain hard and are explained helpfully
- `browser ask` either answers or is honestly named
- `vc-tools try` proves the product in under a minute
- docs, README, API contract, validation matrix, and hosted worker behavior agree

## Execution Evidence

Date: 2026-05-17.

Each item from the Exact Execution Task List was implemented and verified
locally. All 140 CLI tests pass; `npm run check`, `npm run build`,
`npm run verify:artifact`, `npm run verify:goal`, and `npm run verify:release`
pass. Hosted Worker behavior was not changed by this pass; no hosted deploy is
required.

- Public serializers: `publicStartPayload`, `publicUsagePayload`,
  `publicPlansPayload`, `publicHealthPayload`, `publicConnectionPayload`,
  `publicNetworkPayload` in `src/cli/run.ts`.
- Output modes: `--details` and `--operator` route through `outputSurface()` and
  `queryForSurface()`; operator data stays server-gated.
- Forbidden default keys (`offeringClassifications`, `overageMeters`,
  `policies`, `providerMode`, `sandboxInternetDefault`, `auth`, `scopes`,
  `tokenKind`, `operatorAlerts`, `cogs`, `internalApiBinding`, `webhook`,
  `ntfy`, `Cloudflare`, `softCap`, `hardCap`) are asserted out of default
  `start`/`usage`/`plans`/`doctor` JSON.
- Product network object replaces `sandboxInternetDefault: "off"`:
  `{ browserPublicHttps, computerPublicHttps, privateLocalNetworks,
  metadataServices, rawNetwork }`.
- `computer run --network public` is the default; `--network off` skips
  egress. Invalid values produce a helpful denial.
- `vc-tools try` runs the start/browser/computer/proof/usage chain and saves
  proof; covered by `test/cli.behavior.test.ts:"try proves auth, browser,
  computer, proof, and usage"`.
- Browser/computer commands submit, wait until terminal, save proof when
  `--out` is provided, and hide job/artifact IDs unless `--details`. Both
  `--no-wait` and `--noWait` skip the wait and return the queued payload.
- `work follow` polls until terminal status and saves proof when `--out` is
  provided. Covered by `"work follow polls until terminal..."`.
- `browser ask`/`browser snapshot` is renamed and reframed as a snapshot for
  the calling agent to analyze ("Asked the hosted Browser to capture an
  inspection snapshot for your agent.").
- Safety errors lead with the allowed surface and offer a safe next action
  (`validators.ts`).
- `vc-tools plans` is a buying page with per-plan bullets (Free / Creator -
  $19/mo / Pro - $39/mo). Detailed entitlements remain behind `--details`.
- `vc-tools agent connect --client codex|cursor|vscode|windsurf|claude-desktop
  |claude-code` installs the MCP config automatically into the client's config
  file (or via the client's own CLI for codex/claude-code/vscode-user). Pass
  `--print` for copy-paste-only mode, `--overwrite` to replace a differing
  entry (a `.vc-tools.bak` of the previous config is written first), and
  `--dry-run` to plan without writing.
- `vc-tools dashboard` opens the dashboard URL in the local browser unless
  `--no-open`, `--json`, `--quiet`, or `--no-input` is set.

