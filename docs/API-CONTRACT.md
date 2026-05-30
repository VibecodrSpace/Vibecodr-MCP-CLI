# Vibecodr API Contract

The Vibecodr CLI does not execute browser or sandbox work locally.

The CLI talks to a hosted Vibecodr API. The API owns Cloudflare credentials,
Browser Run usage, Sandbox execution, queues, workflows, R2 artifacts, quotas,
audit logs, and policy decisions.

This repository includes the live Cloudflare Worker at `src/hosted/worker.ts`
with `wrangler.jsonc`. `VC_TOOLS_PROVIDER_MODE=live` is deployed for
`https://tools.vibecodr.space`; after security-sensitive Worker changes, the
release gate treats `live-hosted-production` as hosted-required until fresh
production smoke evidence is captured. Contract mode remains available in tests
and safe local checks to validate route shape, MCP metadata, auth failure
behavior, dashboard shell, and quota/audit-shaped tool acceptance without
spending Browser Run or Sandbox resources.

## External Platform Assumptions

These assumptions were checked against Cloudflare documentation on 2026-05-17:

- Browser Run has Quick Actions for common stateless browser tasks such as
  screenshots, PDFs, markdown extraction, HTML/content extraction, and bounded
  crawl tasks, and Browser Sessions for direct control through Playwright,
  Puppeteer, CDP, or Stagehand.
- Current Browser Run docs make Quick Actions the direct fit for common bounded
  browser tasks, with Browser Sessions and session reuse reserved for direct
  Playwright/Puppeteer/CDP/Stagehand control. This strengthens the `vc-tools`
  Quick Actions default; it does not move browser execution into the local CLI.
- Browser Run Quick Actions require a Cloudflare API token with
  `Browser Rendering - Edit`, and responses expose `X-Browser-Ms-Used` for
  browser time accounting.
- Browser Run Quick Actions use separate timeout knobs. `goToOptions.timeout`
  is capped at 60 seconds, while operation timers such as `actionTimeout` and
  `pdfOptions.timeout` can be longer. `vc-tools` maps its product timeout to the
  operation timer and clamps navigation timeout to Cloudflare's current limit.
- Browser Run `/crawl` starts an async provider crawl job, then results are read
  from `/crawl/{job_id}`. `vc-tools` stores the completed crawl response as a
  hosted artifact and meters returned browser seconds plus completed pages when
  the provider reports them.
- Browser Sessions remain the paid browser provider for agent tasks. `vc-tools`
  keeps Quick Actions as the default for stateless browser work, while
  `browser.agent_task` is admitted and reserved in D1, then executed through the
  `BROWSER_AGENT_WORKFLOW` Cloudflare Workflow using the `BROWSER` binding. It
  allows up to 20 minutes on Creator and 1 hour on Pro, closes on 10 minutes of
  idle/no-progress time, and always stores a bounded artifact before closing the
  browser.
- Cloudflare Workers limits still cap Queue Consumers at 15 minutes of
  wall-clock time. Cloudflare Workflows provide durable step execution with
  per-step retries and resume behavior, so long paid browser agent tasks belong
  in the Workflow lane instead of a Queue consumer.
- Browser Run requests self-identify through non-configurable headers and bot
  detection IDs. Vibecodr may use those signals narrowly for owned-surface
  proof/testing allowlisting, but not as a general bypass of public target
  safety.
- Remote MCP uses Streamable HTTP. Local MCP uses stdio. SSE is legacy for
  remote MCP and should only be retained for compatibility.
- Cloudflare Agents SDK recommends `createMcpHandler()` for stateless remote
  MCP tools and `McpAgent` when per-session state is needed.
- Cloudflare Sandbox SDK runs untrusted code in isolated container-backed
  environments and exposes command execution, files, background processes, and
  preview URLs from Workers applications.
- Cloudflare Containers currently expose `standard-1` (1/2 vCPU, 4 GiB memory,
  8 GB disk) and `standard-2` (1 vCPU, 6 GiB memory, 12 GB disk) instance types.
  `vc-tools` uses `standard-1` for Creator sandbox jobs and `standard-2` for Pro
  sandbox jobs.
- Cloudflare Dynamic Workers load Worker code at runtime with `load(code)` for
  one-time execution or `get(id, callback)` for cached/warm reuse. They are the
  right future substrate for agent-authored Worker modules, but they do not
  replace Browser Run for Chrome automation or Sandbox SDK for shell/container
  execution.
- Cloudflare Durable Object Facets let a supervisor Durable Object load
  dynamically generated code with isolated facet SQLite storage. They are a
  future fit for supervised user-defined durable reducers/objects, not for the
  platform-owned quota, audit, billing, artifact, or grant authority path.
- Cloudflare Queues DLQs preserve messages that exceed retry limits instead of
  silently deleting them; vc-tools configures `vc-tools-jobs` with
  `max_retries=3` and `vc-tools-jobs-dlq`, and retry deliveries of already
  failed jobs do not re-run cost-bearing provider work.

The detailed primitive-fit decision lives in
`docs/CLOUDFLARE-PRIMITIVE-FIT.md`.

## Live Cloudflare Resources

The production deployment uses these isolated `vc-tools` resources:

- Worker: `vc-tools-api`
- Custom domain: `https://tools.vibecodr.space`
- Browser Run Quick Actions secrets:
  `VC_TOOLS_BROWSER_RUN_ACCOUNT_ID` and `VC_TOOLS_BROWSER_RUN_API_TOKEN`
- Operator kill switches: `VC_TOOLS_PAUSE_COST_BEARING_JOBS`,
  `VC_TOOLS_DISABLE_BROWSER_RUN`, `VC_TOOLS_DISABLE_BROWSER_SESSIONS`, and
  `VC_TOOLS_DISABLE_SANDBOX` deny matching cost-bearing capabilities before D1
  job insertion or Queue/Workflow dispatch, write `tools.cost_bearing_paused`,
  and return `ops.cost_bearing_paused`.
- Browser Run binding: `BROWSER` for the paid Browser Session agent-task lane
- Workflow: `vc-tools-browser-agent-task` bound as `BROWSER_AGENT_WORKFLOW` for
  durable paid Browser Session execution
- Sandbox SDK Creator container and Durable Object class: `Sandbox` (`standard-1`)
- Sandbox SDK Pro container and Durable Object class: `ProSandbox` (`standard-2`)
- D1 database: `vc-tools-db`
- D1 migration: `migrations/0001_live_schema.sql`
- D1 actor-scope migration: `migrations/0002_actor_scope.sql`
- D1 quota-reservation migration: `migrations/0003_quota_reservations.sql`
- D1 sandbox-quota migration: `migrations/0004_sandbox_quota_reservations.sql`
- D1 operator-alert dedupe migration:
  `migrations/0005_operator_alert_dedupe.sql`
- D1 scheduled-QA migration: `migrations/0006_scheduled_qa.sql`
- R2 bucket: `vc-tools-artifacts`
- Queue: `vc-tools-jobs`
- Queue metrics binding: `JOB_DLQ` bound to `vc-tools-jobs-dlq`
- Dead-letter queue: `vc-tools-jobs-dlq`

Dynamic Workers, Durable Object Facets, and Dynamic Workflows for
runtime-loaded user code are intentionally not part of the v1 live resource set.
Cloudflare Workflows are part of v1 only for the platform-owned
`browser.agent_task` execution lane. Add dynamic-code primitives only for an
explicitly named capability family, and only after quota reservation, audit,
least-privilege binding/proxy design, egress denial by default, timeout,
cancellation, and no-secret-leak tests exist.

Every live tool call writes an actor-scoped audit event before the job is
atomically reserved in D1 and before the Queue message is sent or Workflow
instance is created. Browser URL inputs are revalidated on the hosted side, DNS
preflight only accepts A/AAAA address records, and redirect-chain preflight
follows a bounded manual HEAD chain so unsafe redirect targets are rejected
before cost-bearing dispatch. Stateless browser tools use Browser Run Quick
Actions when the hosted Worker has the required Browser Run API secret. Queue
consumers refuse `browser.agent_task`; that lane is owned by
`BROWSER_AGENT_WORKFLOW`. Browser execution still refuses to start above the
configurable account-wide hard cap and returns provider 429 responses to the
retry/defer path instead of marking the job failed on first rate-limit pressure.
Paid Agent Computer sandbox jobs have public HTTP(S) egress by default so
agents can install packages and read public documentation without a curated host
list. Cloudflare Sandbox host policy denies local/private/link-local/metadata/
internal CIDR and hostname patterns, HTTPS interception is enabled on the
Sandbox classes, and the hosted outbound handler revalidates each HTTP(S)
request with URL-credential, private-host, internal suffix, and public-DNS
checks before forwarding it. Raw non-HTTP internet stays closed by the Sandbox
startup policy. Paid browser agent
tasks store closure metadata in the job result/artifact and emit
`tools.browser_agent.*` plus Workflow dispatch/failure audit events so
idle/max-duration/action-failure closure is visible after the browser closes.

## Endpoints

The default production API base is:

`https://tools.vibecodr.space`

All endpoints below are versioned under `/v1`.

| CLI surface | Method and path | Purpose |
| --- | --- | --- |
| `login` browser/device start | `POST https://api.vibecodr.space/auth/vc-tools/device/start` | Start a short-lived browser approval session for the human CLI login path |
| `login` browser/device approval | `POST https://api.vibecodr.space/auth/vc-tools/device/approve` | Signed-in Vibecodr browser session approves the terminal code without receiving a grant secret |
| `login` browser/device polling | `POST https://api.vibecodr.space/auth/vc-tools/device/token` | CLI redeems its private device code for a short-lived `vc-tools` grant plus a durable scoped API key when available |
| `login --credential-file` / `--credential-stdin` exchange or verification | `POST https://api.vibecodr.space/auth/cli/exchange` or `GET /v1/me` | Accept a vc-tools grant, Clerk OAuth access token, or scoped Clerk API key without making users pick the credential type |
| `status` / `auth status` | `GET /v1/me`, `GET /v1/health` | Inspect local config, winning credential source, stored credential availability, authenticated identity, and hosted availability |
| `auth diagnose` | `GET /v1/me` when a credential is available | Explain which auth/config source is active, whether native/file credential storage is readable, and what to do next without printing secrets |
| `auth export-agent-env` | local credential export only | Write the durable local credential when available, otherwise the cached short-lived grant, and print the matching `VC_TOOLS_CREDENTIAL_FILE=...` or `VC_TOOLS_TOKEN_FILE=...` assignment without printing the secret |
| `start` / `setup` | `GET /v1/me`, `GET /v1/health`, `GET /v1/mcp/connection`, `GET /v1/usage` | Verify the approved Agent Computer and return account, health, connection, and capacity state |
| `try` | `GET /v1/me`, `GET /v1/health`, `GET /v1/mcp/connection`, `GET /v1/usage`, `POST /v1/tools/test`, `GET /v1/jobs/{jobId}`, `GET /v1/artifacts/{artifactId}/download` | Run a first-success check for auth, hosted API, public Browser work, hosted computer work, proof saving, and usage readback |
| `agent connect` / `connect` | `GET /v1/mcp/connection` | Return Streamable HTTP MCP endpoint metadata plus agent-native tool names |
| `tools list` | `GET /v1/tools` | List granted agent tool descriptors and canonical hosted capabilities |
| `tools test` | `POST /v1/tools/test` | Submit one bounded capability test; advanced/debug surface |
| `work list` / `jobs list` | `GET /v1/jobs?limit=1..100` | List recent hosted work |
| `work show` / `jobs status` | `GET /v1/jobs/{jobId}` | Read one work item/job |
| `work follow` | repeated `GET /v1/jobs/{jobId}`, optional `GET /v1/artifacts/{artifactId}/download` | Poll one work item until terminal and optionally save its proof artifact |
| `work cancel` / `jobs cancel` | `POST /v1/jobs/{jobId}/cancel` | Cancel a queued/running work item |
| `proof list` / `artifacts list` | `GET /v1/artifacts?limit=1..100` | List saved proof/artifacts |
| `proof show` / `artifacts get` | `GET /v1/artifacts/{artifactId}` | Read proof/artifact metadata |
| `proof save` / `artifacts pull` | `GET /v1/artifacts/{artifactId}/download` | Download artifact bytes |
| `artifacts create` | `POST /v1/artifacts` | Upload a local file as a saved artifact; advanced/debug surface |
| `artifacts delete` | `DELETE /v1/artifacts/{artifactId}` | Delete actor-scoped artifact metadata and R2 bytes |
| `whoami` | `GET /v1/me` | Read authenticated user, workspace, and plan identity |
| `usage` / `limits` | `GET /v1/usage` | Read quota and spend state with allotted limits, numeric usage, and quota progress |
| `grants` / `grants list` | `GET /v1/grants` | Read effective tool grants |
| `retention show` | `GET /v1/retention` | Read retention policy |
| `retention set` | `PATCH /v1/retention` | Update retention policy |
| `scheduled-qa list` | `GET /v1/scheduled-qa` | List actor-scoped scheduled Browser Quick Action checks |
| `scheduled-qa create` | `POST /v1/scheduled-qa` | Create a plan-capped recurring Browser Quick Action for a public HTTPS URL |
| `scheduled-qa pause` / `resume` | `PATCH /v1/scheduled-qa/{scheduledQaId}` | Pause, resume, or run a scheduled QA config now |
| `scheduled-qa delete` | `DELETE /v1/scheduled-qa/{scheduledQaId}` | Delete an actor-scoped scheduled QA config |
| `plans` | `GET /v1/plans` | Read plan packaging and limits |

Default CLI output is split by audience. Human and default `--json` output are
user/agent product contracts: `start`, `usage`, `plans`, `doctor`, and
connection commands return the account, connection, tools, capacity, and next
actions needed to use the Agent Computer. They do not include operator launch
metadata, future/internal offering classifications, overage meters, provider
mode, scopes, token kind, internal alert configuration, COGS, webhook/ntfy
configuration, or hosted account-pressure internals. `--details` expands
user-debugging data. `--operator` is server-gated and only works for actors
authorized to read internal launch metadata.

Browser and computer aliases submit hosted work, wait for terminal status by
default, and summarize the result. `--out ./proof` saves the terminal artifact
without requiring the caller to copy a job or artifact ID. `--no-wait` returns
the queued hosted job response for advanced callers. `--details` includes the
raw work/proof identifiers.

Agent Computer command payloads default to public HTTP(S) network availability
for paid hosted runs. The CLI also accepts `--network public` and
`--network off`; no user flag enables private, local, metadata, or internal
network destinations.

Plain `vibecodr start` is the standard connection path; it uses `login` internally
when the Agent Computer has no local credential yet. The login step follows the
device-login shape: the CLI receives a private `device_code`, shows a user-checkable
`user_code`, opens `/settings/vc-tools/approve?vc_tools_code=...`, and polls the parent
API until the signed-in browser session approves that code. The approval
response is browser-safe metadata only; the signed grant and durable scoped API
key are returned only to the polling CLI that holds the private device code.
Sessions are stored in the parent API D1 database as hashes and become
single-use when redeemed.

`/v1/me` omits `user.email` when the grant has no real account email instead of
substituting a synthetic `@vibecodr.local` identity. Human output should prefer
account handle/workspace labels, then a real email, then stable ids.

Generic file/stdin credential login remains the standard non-interactive path
for agents, CI, and web agents that can pass a secret through an existing secure
secret channel. The CLI identifies vc-tools grants, Clerk OAuth access tokens,
and scoped Clerk API keys from their shape so agents do not need a credential
type decision. All vc-tools grant minting uses the parent Vibecodr API, and
vc-tools grants are audience-bound to `vibecodr:vc-tools` so hosted Tools cannot
accidentally accept broader Vibecodr CLI/API authority.

Local auth is account-wide. The CLI stores one durable credential when it has
one, plus a cached short-lived vc-tools grant. Cached grants are access
artifacts; they are refreshed from the durable credential when expired. A raw
vc-tools grant can still be cached for controlled automation, but it is not
refreshable and may require `vibecodr start` or a fresh credential file after
expiry.

Production vc-tools grants use asymmetric ES256 signing. The parent API signs
with private `CLI_GRANT_PRIVATE_JWK`; hosted Tools verifies only against
`VC_TOOLS_CLI_GRANT_PUBLIC_JWKS`. Grant headers must include `kid`; grant
payloads must include `iss`, `aud`, `sub`, `scp`, effective `plan`,
`grant_profile`, `iat`, `nbf`, `exp`, and `jti`. Hosted Tools denies unknown
`kid`, audience/issuer mismatch, non-`vc_tools` grant profiles, missing
`vc-tools:use`, missing per-tool capability scope, expired/not-yet-valid
grants, and configured revoked `jti` values. Legacy shared-HMAC grants require
explicit beta/internal compatibility flags, are not the public production
shape, and should be removed by 2026-06-30 after live ES256 smoke and
migration.

## Remote MCP Contract

The remote MCP endpoint is:

`https://tools.vibecodr.space/mcp`

It uses Streamable HTTP and supports these JSON-RPC methods in contract mode:

- `initialize`
- `notifications/initialized`
- `ping`
- `tools/list`
- `tools/call`

`tools/list` exposes deterministic agent-native tool names and JSON schemas.
Each descriptor also includes the canonical hosted capability it maps to.
`tools/call` accepts the agent-native names below, plus canonical capability
names for advanced callers, and returns a quota/audit-shaped contract response
unless the hosted provider mode is later set to `live`.

The endpoint is an OAuth protected resource, not an authorization server. The
hosted Worker publishes protected-resource metadata at:

- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-protected-resource/mcp`
- `GET /.well-known/oauth-protected-resource/v1/mcp`

Unauthenticated MCP `POST /mcp` responses include a Bearer
`WWW-Authenticate` challenge with `resource_metadata` pointing at the MCP
protected-resource metadata and `scope="vc-tools:use vc-tools:*"`. Discovery
probes for OAuth authorization-server metadata on `tools.vibecodr.space` return
an unauthenticated 404 because `tools` only verifies API-issued `vc_tools`
grants; clients should not treat `openai.vibecodr.space` gateway sessions as
valid `tools` grants.

Primary agent tool names:

- `browser.render` -> `browser.render_url`
- `browser.screenshot` -> `browser.screenshot_url`
- `browser.read` -> `browser.extract_markdown`
- `browser.pdf` -> `browser.render_pdf`
- `browser.crawl` -> `browser.crawl_site`
- `browser.snapshot` -> `browser.agent_task`
- `computer.run` -> `sandbox.run_command`
- `computer.test` -> `sandbox.run_tests`
- `proof.get` -> `artifact.get`
- `usage.status` -> `usage.read`
- `work.status` -> `job.status`
- `work.cancel` -> `job.cancel`

## Capability Names

The CLI validates and submits only these v1 capability names:

- `browser.render_url`
- `browser.screenshot_url`
- `browser.extract_markdown`
- `browser.render_pdf`
- `browser.crawl_site`
- `browser.agent_task`
- `sandbox.run_command`
- `sandbox.run_tests`
- `artifact.create`
- `artifact.get`
- `usage.read`
- `job.status`
- `job.cancel`

The CLI and hosted API also accept documented aliases for agent/human ergonomics:

- `browser.ask` -> `browser.agent_task`
- `browser.read` -> `browser.extract_markdown`
- `browser.render` -> `browser.render_url`
- `browser.screenshot` -> `browser.screenshot_url`
- `browser.markdown` -> `browser.extract_markdown`
- `browser.pdf` -> `browser.render_pdf`
- `browser.crawl` -> `browser.crawl_site`
- `browser.agent` / `browser.session` -> `browser.agent_task`
- `browser.snapshot` -> `browser.agent_task`
- `computer.run` -> `sandbox.run_command`
- `computer.test` / `computer.tests` -> `sandbox.run_tests`
- `sandbox.run` -> `sandbox.run_command`
- `sandbox.tests` -> `sandbox.run_tests`
- `proof.get` -> `artifact.get`
- `usage` / `usage.status` / `limits` / `limits.read` -> `usage.read`
- `work.status` -> `job.status`
- `work.cancel` -> `job.cancel`

## Launch Packaging

The local launch package includes:

- Free plan with limited public-page Quick Actions: 30 VC Tool credits/month,
  10/day, 1 concurrent run, 30s browser-run cap, no Sandbox, no Browser
  Sessions, no scheduled QA
- Creator at `$19/mo`, included with the existing Vibecodr Creator subscription:
  600 VC Tool credits/month, 90/day, 2 concurrent runs, Quick Actions by
  default, 60s stateless browser-run cap, Workflow-owned Browser Sessions for
  agent tasks up to 20 minutes with 10-minute idle closure, 50 crawl pages/run,
  500 crawl pages/month, 30 scheduled QA runs/month with a 12-hour minimum
  interval
- Pro at `$39/mo`, included with the existing Vibecodr Pro subscription
- Pro includes 3,000 VC Tool credits/month, 400/day, 5 concurrent runs, Quick
  Actions by default, capped Workflow-owned Browser Sessions for agent tasks up
  to 1 hour with 10-minute idle closure, 180s stateless Quick Action cap, 250
  crawl pages/run, 5,000 crawl pages/month, and 300 scheduled QA runs/month
- no standalone vc-tools Stripe catalog; Vibecodr subscription state is the paid-plan SSOT
- `/v1/plans` and local fallback constants are packaging/reference data, not
  actor entitlement authority. The authoritative actor state is the
  authenticated `/v1/usage` snapshot plus the same hosted quota checks that run
  before cost-bearing work. Open-source client edits cannot raise hosted
  entitlement, quota, billing state, or provider access.
- `/v1/plans`, `/v1/usage`, `/v1/health`, and `/v1/mcp/connection` are
  audience-filtered by default. Public/default payloads are buyer/agent-safe.
  Details mode may include expanded user diagnostics. Operator mode requires an
  internal-metadata actor and is the only place for future/internal launch
  metadata, overage-meter compatibility data, provider mode, alert plumbing, or
  account-pressure internals.
- `/v1/usage`, non-operator `/v1/inspect`, and public health/readiness payloads
  are user-safe surfaces. They must not expose actor ids, hosted account caps,
  provider account pressure, operator alert configuration, ntfy/webhook topics,
  internal API binding state, or other operator-only readiness details.
- VC Tool credits, browser seconds, sandbox-compute time, artifact-storage,
  retention, concurrency, crawl, and scheduled-QA meters; build minutes remain a
  separate subscription ledger and must not be borrowed by vc-tools
- Scheduled QA is a gated-beta hosted lane. It stores actor-scoped
  `scheduled_qa_configs` rows in D1, only accepts public HTTPS Browser Quick
  Actions (`browser.render`, `browser.screenshot`, `browser.markdown`, and
  `browser.pdf`), and the Worker cron enqueues due runs into the same D1 jobs
  and Queue path used by manual tool calls. Each due run is checked against the
  active plan's monthly scheduled-QA allowance, browser quota, concurrency, DNS
  and redirect safety, artifact storage, and audit-before-cost policy before
  the Queue message is sent. Scheduled QA never opens an Agent Browser session
  and never accepts cookies, credentials, custom auth headers, storage state, or
  private-network targets.
- artifact upload caps are plan-owned hosted limits: Free has no artifact
  upload lane, Creator allows 100 MiB/file, and Pro allows 500 MiB/file
- total artifact storage is also plan-owned: artifact writes check active
  actor storage before R2 writes, insert D1 artifact metadata with a quota
  predicate, and delete newly written R2 bytes if the D1 reservation loses a
  race
- sandbox jobs reserve monthly sandbox seconds before queue insertion and
  reconcile the reservation on terminal/cancelled jobs, so
  `sandboxMinutesMonthly` is enforced before cost-bearing Sandbox work starts.
  Creator sandbox tasks are capped at 10 minutes, Pro sandbox tasks are capped
  at 30 minutes, and both paid plans allow up to 2 active sandbox tasks per user
- account-wide hosted breakers are separate from customer plan caps: customer
  caps protect product packaging and spend, while provider/account caps protect
  Cloudflare account pressure. The hosted queue is capped at 30 concurrent
  consumer invocations, hosted Browser/Sandbox work defaults to a soft cap of 24
  and hard cap of 30 active jobs, configurable through
  `VC_TOOLS_HOSTED_ACCOUNT_SOFT_CAP` and
  `VC_TOOLS_HOSTED_ACCOUNT_HARD_CAP`, Browser Run jobs default to a soft cap
  of 24 and hard cap of 30 concurrent browser jobs, configurable through
  `VC_TOOLS_BROWSER_RUN_ACCOUNT_SOFT_CAP` and
  `VC_TOOLS_BROWSER_RUN_ACCOUNT_HARD_CAP`, and Sandbox jobs default to a soft
  cap of 24 and hard cap of 30 concurrent hosted sandboxes, configurable through
  `VC_TOOLS_SANDBOX_ACCOUNT_SOFT_CAP` and
  `VC_TOOLS_SANDBOX_ACCOUNT_HARD_CAP`. Paid user-facing Sandbox containers are
  split by plan: Creator routes to `Sandbox` on `standard-1` and Pro routes to
  `ProSandbox` on `standard-2`, each with `max_instances: 30` while
  D1/Queue/Workflow account caps keep total active hosted work bounded.
  Emergency operator kill switches are separate from those caps:
  `VC_TOOLS_PAUSE_COST_BEARING_JOBS=true` pauses all Browser/Sandbox work,
  `VC_TOOLS_DISABLE_BROWSER_RUN=true` pauses Browser Run Quick Actions and
  crawl, `VC_TOOLS_DISABLE_BROWSER_SESSIONS=true` pauses paid
  `browser.agent_task`, and `VC_TOOLS_DISABLE_SANDBOX=true` pauses Sandbox.
  These flags return `503 ops.cost_bearing_paused`, write an audit row, and do
  not insert a D1 job or dispatch Queue/Workflow work.
  Crossing 70%, 85%, or 95% account-wide pressure, or crossing a configured
  account-wide soft cap, emits a sanitized `E-VIBECODR-VC-TOOLS-SOFT-CAP`
  operator alert through the internal-api email/ntfy fanout and optional
  vc-tools webhook/ntfy secrets. Per-user quota, usage, and concurrency limits
  remain enforced, metered, and audit-visible, but they do not send operator
  alert email because they represent customer-plan pressure rather than total
  platform capacity pressure.
  Scheduled account-level Queue backlog, DLQ backlog, and artifact-storage
  growth checks use the same operator alert lane with `queue.backlog_messages`,
  `queue.dlq_messages`, and `artifact.storage_gb` surfaces.
  Expired-artifact cleanup failures emit a separate account-scoped
  `E-VIBECODR-VC-TOOLS-RETENTION-CLEANUP-FAILED` alert with
  `retention.cleanup_failed`; internal-api keeps filtering any `source=vc-tools`
  payload whose details carry `scope=user` before email/ntfy fanout.
  Browser Run and Sandbox execution-health degradation emits
  `E-VIBECODR-VC-TOOLS-EXECUTION-HEALTH-DEGRADED` with
  `browser.failure_rate`, `browser.timeout_rate`, `sandbox.failure_rate`, or
  `sandbox.timeout_rate` based on recent terminal job rows. These alerts are
  account-scoped operational health signals, not per-user quota notifications.
  Unexpected hosted Worker 500s emit the account-scoped
  `E-VIBECODR-VC-TOOLS-HOSTED-WORKER-5XX` alert with
  `hosted.worker_5xx`; payloads include only the method, sanitized path pattern,
  HTTP status, and sanitized error message, never query strings, bearer tokens,
  request bodies, or actor identifiers.
  Hosted API/MCP auth failures write anonymous `auth.failed` audit metrics with
  the semantic auth error code and sanitized path. OAuth protected-resource and
  authorization-server discovery probes are served before the auth gate and are
  not counted as auth failures. The scheduled Worker pass
  aggregates those rows over `VC_TOOLS_AUTH_FAILURE_WINDOW_MINUTES` and emits
  `E-VIBECODR-VC-TOOLS-AUTH-FAILURE-ANOMALY` / `auth.failure_anomaly` only when
  `VC_TOOLS_AUTH_FAILURE_ALERT_THRESHOLD` is crossed. This is an account-level
  anomaly alert for broken auth config, abuse, or client exchange regressions;
  it does not preserve tokens, query strings, request bodies, or actor
  identifiers in either the metric or the alert.
  Cloudflare spend anomaly checks are account-level only. The scheduled Worker
  estimates current-month raw Cloudflare usage cost from internal vc-tools
  meters (`browser-minute`, plan-split `sandbox-compute-minute`, `crawl-page`,
  and active artifact GB-month exposure) plus env-configured COGS assumptions,
  then emits `E-VIBECODR-VC-TOOLS-CLOUDFLARE-SPEND-ANOMALY` /
  `cloudflare.estimated_spend_usd` when
  `VC_TOOLS_CLOUDFLARE_SPEND_SOFT_USD` is crossed. This internal alert is a
  platform early-warning signal, not an invoice-backed billing source; operators
  must compare it with Cloudflare Billable Usage / Budget Alerts before changing
  thresholds. Per-user COGS stays analytics-only and must not fan out to
  email/ntfy/webhook.
  Workflow-owned Browser Sessions remain a capped paid lane and must not be
  opened above an operator-approved account cap.
- operator alerts are deduped in D1 through
  `operator_alert_dedupe(alert_key, reset_window)`. Active-capacity alerts reset
  hourly; Cloudflare spend anomaly alerts reset monthly by billing period.
  Duplicate crossings in the same reset window increment a suppression counter
  and write an audit event instead of sending another notification.
  Missing notifier bindings also write an audit event, so release smoke can
  distinguish "alert generated" from "operator channel configured."
- unsafe URL and quota denials are D1 audit metrics, not notification fanout:
  live hosted API/MCP denials write `tools.denied_unsafe_url` or
  `tools.denied_quota` with the authenticated actor, capability, and semantic
  denial code so COGS/ops analysis can see friction and denied demand without
  emailing operators for individual user-plan pressure.
- admission fairness reports global queued-ahead and actor queued-ahead
  metadata on accepted work without adding a universal delay to interactive
  tools. Scheduled QA may still spread due runs with bounded Queue per-message
  delays, while per-plan concurrency and account caps remain the primary
  fairness controls for live user actions.
- dashboard sections for overview, usage, activity, artifacts, grants, retention,
  billing, and internal COGS; hosted dashboard and inspection routes require
  bearer auth. In live mode `/dashboard/usage` reads D1-backed usage for the
  authenticated actor, and `/dashboard/cogs` shows internal-only cost pressure
  estimates from env-configured per-surface assumptions.
- named workspace/project/user tool grants for browser, sandbox, artifacts,
  activity status, and crawl

## Security Envelope

Browser mode policy:

- Public web mode is the default. Agents can inspect, render, screenshot, make
  PDFs, extract markdown, and crawl public HTTPS targets, returning hosted
  artifacts.
- Authenticated web mode is future Pro/beta only. A user must knowingly grant
  access to a specific session, account, or site, with retention, recording,
  consent, and audit policy settled before implementation.
- Owned-surface mode is narrow and internal: Vibecodr-owned domains may
  recognize controlled Browser Run traffic so proof/testing flows are not
  blocked by our own WAF or bot controls.
- Blocked unsafe targets must explain the specific boundary: public HTTPS only,
  no URL credentials, no private/internal network resolution, and no unsafe
  redirect target.

The CLI performs pre-cost validation before API calls:

- API URLs must use HTTPS unless local development explicitly opts into
  `--allow-insecure-local-api` or `VC_TOOLS_ALLOW_INSECURE_LOCAL_API=true`.
- Browser URL targets must be HTTPS.
- Browser URL targets must not contain credentials.
- Browser tool input must not include cookies, credentials, authorization
  headers, custom auth headers, storage state, sessions, or secrets. The hosted
  Worker rejects those fields before provider execution.
- Browser URL targets must not be localhost, private IP, loopback, link-local,
  multicast, unspecified, IPv4-mapped IPv6, NAT64, 6to4, or obvious internal
  hostnames.
- Hosted browser admission performs DNS and bounded redirect-chain preflight so
  public hostnames resolving or redirecting to private/internal targets are
  rejected before cost-bearing dispatch.
- Sandbox work is never executed locally by the CLI.
- Sandbox egress defaults to public HTTP(S) for paid Agent Computer runs so
  agents can fetch public packages, docs, and APIs. The CLI accepts
  `--network public` (default) and `--network off`; private, local, link-local,
  metadata, and internal destinations remain blocked by hosted policy regardless
  of any flag.
- Mutating commands require `--yes`.
- Public human login uses the parent Vibecodr Auth/API boundary:
  `POST /auth/vc-tools/device/start`, `POST /auth/vc-tools/device/approve`,
  and `POST /auth/vc-tools/device/token`. The browser approves only a user code;
  the signed grant and durable scoped API key are returned only to the polling
  CLI with the private device code.
- Public automation login uses Vibecodr Auth as the credential exchange boundary:
  `--credential-file`, `--credential-stdin`, and `VC_TOOLS_CREDENTIAL_FILE`
  accept a vc-tools grant, Clerk OAuth access token, or scoped Clerk API key.
  Clerk credentials are sent only to `POST /auth/cli/exchange`, which verifies
  the credential with Clerk and returns a short-lived scoped `vc-tools` CLI
  grant.
- The CLI stores the durable browser-issued or user-supplied credential when
  available, plus a cached short-lived grant. Private device codes and browser
  approval responses are never persisted by `vc-tools`.
- Direct grants are preferably resolved from `VC_TOOLS_CREDENTIAL_FILE`,
  `VC_TOOLS_TOKEN_FILE`, `--credential-file`, `--credential-stdin`, or the local
  credential store and are redacted from all output and errors.
- Direct secret value flags and value-bearing secret environment variables
  (`--credential`, `--token`, `VC_TOOLS_CREDENTIAL`, `VC_TOOLS_TOKEN`) remain
  compatibility inputs, but public UX and docs should prefer plain browser login
  for humans and file/stdin/native credential paths for agents and automation.
- `VC_TOOLS_AUTH_API_URL` can override the exchange endpoint for local testing;
  it follows the same HTTPS-by-default URL validation as `VC_TOOLS_API_URL`.
- Artifact upload and download paths are workspace-bounded. `artifacts pull`
  may write to a directory, an explicit file path inside the workspace, or a
  caller-provided `--filename` inside a directory output.
- Artifact deletion is actor-scoped, requires explicit CLI confirmation, removes
  the D1 shelf row and R2 bytes, and lets usage readback recompute active
  artifact storage from remaining non-expired rows.

Hosted safety defaults required by this contract:

- Hosted auth accepts scoped Vibecodr CLI grants with `vc-tools:use` plus a
  requested tool scope such as `vc-tools:browser.render_url` or `vc-tools:*`,
  verified by public JWKS, and an explicitly configured static-token fallback
  for controlled deployments.
- Browser/device-backed `vc-tools` grants receive `vc-tools:use` plus
  `vc-tools:*` after a signed-in Vibecodr user approves the matching terminal
  code. The hosted service validates the `vibecodr:vc-tools` audience before any
  tool or MCP work.
- OAuth-backed `vc-tools` grants receive `vc-tools:use` plus `vc-tools:*` after
  the parent Vibecodr API verifies the Clerk OAuth access token client id and
  `openid` scope.
- API-key-backed `vc-tools` grants are least-privilege: only Clerk API key
  scopes beginning with `vc-tools:` are copied into the signed grant, and the
  exchange rejects keys without `vc-tools:use` or `vc-tools:*`.
- Live hosted work records, artifacts, usage rows, retention policies, and audit rows are scoped
  to the authenticated actor.
- No authenticated third-party browsing by default.
- Paid sandbox public HTTP(S) egress is available by default, with private,
  local, link-local, metadata, and internal destinations denied.
- No browser recording by default.
- No unlimited crawl by default.
- All tool calls are quota checked and audit logged before cost-bearing work.
- Retention uses the actor policy or active plan artifact-retention limit rather
  than a hard-coded lifetime, policy writes cannot exceed the active plan cap,
  expired artifacts are hidden from reads, and scheduled cleanup deletes expired
  R2 objects and D1 rows.

## Stable Output Contract

Every `--json` response is shaped as:

```json
{
  "ok": true,
  "data": {},
  "warnings": []
}
```

Errors are shaped as:

```json
{
  "ok": false,
  "error": {
    "code": "input.invalid_url",
    "message": "Browser URL must use https.",
    "status": 2
  }
}
```

Exit codes:

- `0`: success
- `1`: remote/API failure or unexpected failure
- `2`: invalid CLI input
- `3`: missing authentication
- `4`: explicit confirmation required
- `5`: configuration or local file error
- `6`: upstream unavailable
