# Vibecodr CLI Release Checklist

Use this checklist before publishing `@vibecodr/cli`.

## Repository Boundary

- `git rev-parse --show-toplevel` prints the `tools/mcp/Vibecodr-CLI` repository root.
- No files are staged or committed from the parent Vibecodr repository.
- The package name is `@vibecodr/cli`.
- The canonical bin name is `vibecodr`; `vibecodr-mcp` and `vc-tools` are
  preserved as back-compat aliases.
- Environment variables use the `VC_TOOLS_*` namespace.
- Stored credentials use the native credential store unless
  `VC_TOOLS_CREDENTIAL_STORE=file` is explicitly set for tests.

## Required Verification

```powershell
npm ci
npm run check
npm run check:worker
npm test
npm run build
npm run verify:artifact
npm run verify:release
npm run verify
node dist/bin/vibecodr-mcp.js --help
node dist/bin/vibecodr-mcp.js help mcp
node dist/bin/vibecodr-mcp.js login mcp --help
node dist/bin/vibecodr-mcp.js login agent --help
node dist/bin/vibecodr-mcp.js logout agent --help
node dist/bin/vibecodr-mcp.js help agent
node dist/bin/vibecodr-mcp.js help computer
node dist/bin/vibecodr-mcp.js help browser
node dist/bin/vibecodr-mcp.js --quiet usage
node dist/bin/vibecodr-mcp.js --json plans
node dist/bin/vibecodr-mcp.js usage
node dist/bin/vibecodr-mcp.js --json limits
node dist/bin/vibecodr-mcp.js --json dashboard usage
node dist/bin/vibecodr-mcp.js --json inspect
node dist/bin/vibecodr-mcp.js --json browser render https://127.0.0.1
npx wrangler deploy --dry-run --outdir tmp\wrangler-dry-run
npx wrangler d1 migrations apply vc-tools-db --remote
VC_TOOLS_RELEASE_CHANNEL=live npm run verify:release
```

Expected results:

- TypeScript exits `0`.
- Worker type generation and Worker TypeScript checks exit `0`.
- Tests exit `0`.
- Build exits `0`.
- Package artifact verifier exits `0`.
- Release readiness verifier exits `0` for `VC_TOOLS_RELEASE_CHANNEL=cli-contract`.
- `VC_TOOLS_RELEASE_CHANNEL=live npm run verify:release` exits `0` only after
  `live-hosted-production` is marked locally verified by fresh production smoke
  evidence. It is expected to fail while that inspection is still
  `hosted-required`.
- Help identifies `vibecodr`. The `vc-tools` and `vibecodr-mcp` bin names are
  back-compat aliases that route into the same dispatcher.
- Help exposes examples, docs/support links, secure credential file/stdin
  inputs, and command-specific help via both `vibecodr help <command>` and
  `<command> --help`.
- `--quiet` suppresses non-essential human success output while `--json` remains
  stable.
- `plans` works without auth using local launch packaging fallback.
- `plans` includes Free, Creator, Pro, overage meters, and launch safety
  policies.
- `plans` fallback and `/v1/plans` are explicitly non-authoritative for actor
  entitlement; `usage`/`limits` are the account-state surface and are marked
  read-only/not client-mutable.
- `usage` renders allotted limits, numeric usage, and 0-100% quota bars; `limits`
  returns the same hosted usage state and keeps stable JSON.
- `dashboard usage` and `dashboard cogs` return hosted dashboard URLs without
  requiring or printing credentials.
- `inspect` reports one hosted-required check for CLI-contract releases and zero
  hosted-required checks after live production smoke.
- Unsafe browser URL smoke exits non-zero before any hosted request.
- The Worker returns health, MCP metadata, protected-resource discovery, Bearer
  auth challenges, and fail-closed auth responses; tests keep contract-mode
  coverage for no-cost route validation.
- The contract-mode Worker supports MCP `initialize`, `tools/list`, and
  `tools/call` JSON-RPC requests.
- Hosted dashboard sections render overview, usage, activity, artifacts, grants,
  retention, billing, and internal COGS launch-contract data.

## Hosted Service Production Checks

Run these after hosted Worker, D1, R2, Queue, Browser Run, Sandbox,
`VC_TOOLS_BROWSER_RUN_ACCOUNT_ID`, `VC_TOOLS_BROWSER_RUN_API_TOKEN`, and the
hosted/Browser/Sandbox account-cap vars plus `VC_TOOLS_CLI_GRANT_PUBLIC_JWKS`
or the controlled static `VC_TOOLS_TOKEN_SHA256` secret are configured. Also configure
`VC_TOOLS_INTERNAL_ALERT_TOKEN` through the repo-owned
`scripts/vc-tools-secrets.ps1` flow; that script stores the managed alert signer
in WinCred and uploads the same value to `vibecodr-internal-api` as
`INTERNAL_BINDING_TOKEN_NEXT` so the current internal mesh token is not rotated
just to enable vc-tools alerting. Keep the `VC_TOOLS_INTERNAL_API_WORKER`
service binding deployed, confirm internal-api `ALERT_CODES` includes
`E-VIBECODR-VC-TOOLS-SOFT-CAP`, and confirm internal-api has `NTFY_TOPIC`
configured if ntfy delivery is expected. vc-tools operator emails are reserved
for account-wide hosted, Browser Run, and Sandbox capacity pressure; per-user
quota/usage pressure remains enforced and audit-visible without outbound
operator email.
For the public auth paths, also configure parent API Worker secrets
`CLERK_SECRET_KEY` and `CLI_GRANT_PRIVATE_JWK`, set the parent/hosted grant
audience to `vibecodr:vc-tools`, and set the hosted Worker
`VC_TOOLS_CLI_GRANT_PUBLIC_JWKS` to the matching public JWKS. Legacy HMAC grants
require `CLI_GRANT_LEGACY_HMAC_ENABLED="true"` and
`VC_TOOLS_CLI_GRANT_LEGACY_HMAC_ENABLED="true"`, are beta/internal-only, and
should be removed by 2026-06-30 after live ES256 smoke and migration:

```powershell
$env:VC_TOOLS_API_URL = "https://tools.vibecodr.space"
vibecodr login
vibecodr login --credential-file .\clerk-oauth-token.txt
vibecodr login --credential-file .\vibecodr-api-key.txt
vibecodr start --client codex
vibecodr auth diagnose
vibecodr agent connect --client codex
vibecodr tools list
vibecodr browser render https://example.com
vibecodr browser screenshot https://example.com --format png
vibecodr browser read https://example.com
vibecodr browser pdf https://example.com
vibecodr browser crawl https://example.com/docs --max-pages 5 --max-depth 1
vibecodr browser ask https://example.com --timeout-ms 1200000 --idle-timeout-ms 600000 --instructions "Inspect the page and save a concise snapshot."
vibecodr computer run "node --version"
vibecodr usage
vibecodr grants list
vibecodr retention show
```

Expected hosted guarantees:

- Auth secrets are configured as Worker secrets, not committed config.
- Public human login uses `https://api.vibecodr.space/auth/vc-tools/device/*`;
  the verification URI opens `/settings/vc-tools/approve?vc_tools_code=...`,
  the browser approval response does not contain the grant, and the private
  device code is not printed or persisted.
- Public automation login accepts generic credential files/stdin, identifies
  Clerk OAuth tokens or scoped Clerk API keys, and exchanges them through
  `https://api.vibecodr.space/auth/cli/exchange`; explicit login paths store
  the durable local credential so short-lived Vibecodr grants can refresh.
- 2026-05-15 live OAuth proof: Clerk PKCE from the production
  `/agent/vibe` metadata completed through the in-app browser, and
  `scripts/smoke-vc-tools-oauth-token.mjs` exchanged the returned Clerk access
  token over stdin. Run `codex-oauth-20260515230549-tgn17r` passed
  `login-oauth-token`, `whoami-oauth-token`, and `usage-oauth-token` with
  `authMode=oauth`, `grantProfile=vc_tools`, scopes
  `["vc-tools:use","vc-tools:*"]`, plan `Pro`, `providerMode=live`,
  `secretPrinted=false`, and temporary config cleanup confirmed.
- Vibecodr CLI grants include the `vc-tools:use` scope, the requested tool
  scope such as `vc-tools:browser.render_url` or `vc-tools:*`, current plan,
  subject, `grant_profile`, `kid`, `iat`, `nbf`, `exp`, `jti`, and
  `vibecodr:vc-tools` audience; static-token fallback is reserved for
  controlled deployments.
- D1 migrations `0001_live_schema.sql`, `0002_actor_scope.sql`,
  `0003_quota_reservations.sql`, and
  `0004_sandbox_quota_reservations.sql`, and
  `0005_operator_alert_dedupe.sql`, and
  `0006_scheduled_qa.sql`, and `0007_job_queue_metadata.sql` are applied.
- Browser/Sandbox calls are quota checked by the API before cost-bearing
  Cloudflare work.
- Operator kill switches must be known before launch: setting
  `VC_TOOLS_PAUSE_COST_BEARING_JOBS=true` pauses all Browser/Sandbox work,
  `VC_TOOLS_DISABLE_BROWSER_RUN=true` pauses Browser Run Quick Actions and
  crawl, `VC_TOOLS_DISABLE_BROWSER_SESSIONS=true` pauses paid
  `browser.agent_task`, and `VC_TOOLS_DISABLE_SANDBOX=true` pauses Sandbox.
  Each pause returns `503 ops.cost_bearing_paused`, writes
  `tools.cost_bearing_paused`, and avoids D1 job insertion and Queue/Workflow
  dispatch.
- Crossing hosted, Browser Run, or Sandbox account-wide 70%, 85%, or 95%
  pressure emits a sanitized `E-VIBECODR-VC-TOOLS-SOFT-CAP` operator alert.
  User quota/usage thresholds do not emit operator emails. Alerts flow through
  internal-api email/ntfy fanout; optional
  `VC_TOOLS_OPERATOR_ALERT_WEBHOOK_URLS` and `VC_TOOLS_OPERATOR_NTFY_TOPIC`
  secrets are additive fallback channels. D1 dedupe suppresses repeats in the
  same reset window, and missing notifier bindings are audit-visible.
- Queue and DLQ backlog are checked by the scheduled Worker via
  `JOB_QUEUE.metrics()` and `JOB_DLQ.metrics()` and emit sanitized
  account-scoped `queue.backlog_messages` / `queue.dlq_messages` operator
  alerts. Tune `VC_TOOLS_QUEUE_BACKLOG_SOFT_CAP`,
  `VC_TOOLS_QUEUE_BACKLOG_HARD_CAP`, `VC_TOOLS_DLQ_MESSAGES_SOFT_CAP`, and
  `VC_TOOLS_DLQ_MESSAGES_HARD_CAP` only as platform-level thresholds; do not
  fan out per-user quota/usage alerts.
- Account-wide active artifact storage is checked by summing active,
  non-expired artifact bytes in D1 during the scheduled Worker pass and emits a
  sanitized account-scoped `artifact.storage_gb` operator alert. Tune
  `VC_TOOLS_ARTIFACT_STORAGE_ACCOUNT_SOFT_GB` and
  `VC_TOOLS_ARTIFACT_STORAGE_ACCOUNT_HARD_GB` as platform-level thresholds,
  separate from the customer plan allotment SSOT.
- Expired-artifact cleanup failures emit the account-scoped
  `E-VIBECODR-VC-TOOLS-RETENTION-CLEANUP-FAILED` /
  `retention.cleanup_failed` operator alert. Keep this code in the parent
  internal-api `ALERT_CODES` allowlist alongside
  `E-VIBECODR-VC-TOOLS-SOFT-CAP`; internal-api filters all user-scoped
  `source=vc-tools` payloads before email/ntfy fanout.
- Browser Run and Sandbox execution failure/timeout rates are checked from
  recent terminal job rows during the scheduled Worker pass and emit the
  account-scoped `E-VIBECODR-VC-TOOLS-EXECUTION-HEALTH-DEGRADED` alert with
  `browser.failure_rate`, `browser.timeout_rate`, `sandbox.failure_rate`, or
  `sandbox.timeout_rate`. Tune
  `VC_TOOLS_EXECUTION_HEALTH_WINDOW_MINUTES`,
  `VC_TOOLS_EXECUTION_HEALTH_MIN_TERMINAL_JOBS`,
  `VC_TOOLS_FAILURE_RATE_ALERT_PERCENT`, and
  `VC_TOOLS_TIMEOUT_RATE_ALERT_PERCENT` as platform-level thresholds.
- Unexpected hosted Worker HTTP 500s emit the account-scoped
  `E-VIBECODR-VC-TOOLS-HOSTED-WORKER-5XX` /
  `hosted.worker_5xx` operator alert through the same fanout path. Keep this
  code in parent internal-api `ALERT_CODES`; payloads must stay sanitized to
  method, path pattern, status, and redacted error text only.
- Hosted API/MCP auth failures write anonymous `auth.failed` audit rows. OAuth
  discovery probes are served before auth and must not enter this metric. The
  scheduled Worker aggregates auth failures and emits the account-scoped
  `E-VIBECODR-VC-TOOLS-AUTH-FAILURE-ANOMALY` /
  `auth.failure_anomaly` operator alert when
  `VC_TOOLS_AUTH_FAILURE_ALERT_THRESHOLD` is crossed inside
  `VC_TOOLS_AUTH_FAILURE_WINDOW_MINUTES`. Keep this code in parent internal-api
  `ALERT_CODES`; payloads must stay token/query/body/actor-free.
- Cloudflare spend anomaly checks are internal account-level early warnings,
  not user notifications and not invoice-backed billing truth. The scheduled
  Worker estimates current-month raw cost from vc-tools COGS meters and
  env-configured assumptions, then emits the account-scoped
  `E-VIBECODR-VC-TOOLS-CLOUDFLARE-SPEND-ANOMALY` /
  `cloudflare.estimated_spend_usd` alert when
  `VC_TOOLS_CLOUDFLARE_SPEND_SOFT_USD` is crossed. Keep this code in parent
  internal-api `ALERT_CODES`, tune
  `VC_TOOLS_CLOUDFLARE_SPEND_SOFT_USD` and
  `VC_TOOLS_CLOUDFLARE_SPEND_HARD_USD` only as platform thresholds, and compare
  any alert with Cloudflare Billable Usage / Budget Alerts before raising
  capacity or changing pricing.
- Unsafe URL and quota denials write analytics-only D1 audit metrics as
  `tools.denied_unsafe_url` and `tools.denied_quota`. These are intentionally
  per-actor COGS/ops signals and must not be promoted into email/ntfy fanout.
- `/dashboard/cogs` renders internal-only cost pressure by actor, plan, surface,
  warning threshold, and env-configured cost assumptions.
- Jobs, artifacts, usage, retention, and audit rows are scoped to the
  authenticated actor.
- All tool calls are logged by the hosted service without secrets before
  Queue/Workflow dispatch.
- Stateless browser jobs complete through Browser Run Quick Actions and produce
  R2 artifacts with metered browser time; paid browser agent jobs complete
  through Workflow-owned Browser Sessions with closure metadata.
- 2026-05-17 Workflow migration smoke: deployed `vc-tools-api`
  `aeeaab85-93ab-4219-acf7-fffbe2be834e` at 100%, then completed synthetic
  Creator `browser.agent_task`
  `job_0e8b0cc2-9a3c-4791-8e77-ce0da1191a3c` with
  `queue_delay_seconds=0`, `reserved_browser_seconds=120`, D1 audit event
  `tools.workflow_started`, and R2 artifact
  `art_466de507-1432-41eb-9253-c9f79aac8148` downloaded through
  `vibecodr proof save`.
- Scheduled QA create/list/update/delete works for a paid actor; explicit
  `--run-now` create/resume enqueues immediately, and due configs are enqueued
  by the Worker cron into the same D1 jobs and Queue path as manual Browser
  Quick Actions, with run/readback evidence and no cookies, credentials, or
  private targets accepted. Monthly cap denial leaves `lastJobId=null` and a
  skipped run row with `quota.scheduled_qa_monthly_runs_exceeded`. Natural
  cron-tick readback should be captured at a real deployed trigger time because
  Cloudflare's fire-now cron route is local Wrangler-dev-only.
- Creator browser agent tasks complete through the `BROWSER` Browser Session
  binding at up to 20 minutes; Pro browser agent tasks complete through the
  same binding at up to 1 hour. Both close in `finally`, record closure
  metadata/audit, and produce R2 artifacts.
- Browser crawl jobs complete through Browser Run `/crawl`, produce R2 crawl
  artifacts, and write crawl-page usage.
- Browser jobs reject unsafe initial URLs, DNS records without A/AAAA answers,
  unsafe redirects/subrequests, and unsafe final URLs.
- Creator sandbox jobs complete through Sandbox SDK `standard-1`; Pro sandbox
  jobs complete through the `ProSandbox` `standard-2` lane; Creator is capped
  at 10 minutes, Pro at 30 minutes, both paid plans cap active sandbox tasks at
  2 per user, and both produce R2 artifacts.
- Queue failures are bounded by the `vc-tools-jobs` consumer config:
  `max_batch_size=1`, `max_retries=3`, and
  `dead_letter_queue="vc-tools-jobs-dlq"`. A failed job message may rethrow only
  inside that retry window so Cloudflare can move it to the DLQ; retry
  deliveries of an already-failed job must not re-run Browser, Sandbox, R2, or
  other cost-bearing provider work.
- DLQ replay is operator-controlled, not automatic. Before replaying a message
  from `vc-tools-jobs-dlq`, fix the root cause, inspect and redact the message
  body, correlate the job id and actor id against D1 `jobs` and `audit_events`,
  confirm the payload is still a valid `ToolJobMessage`, and re-send only the
  intended message body into `vc-tools-jobs` with a fresh audit note. Do not
  attach a broad automatic DLQ consumer or replay unknown payloads.
- `/v1/usage` reflects browser and sandbox job usage after the smoke.
- Sandbox network remains disabled unless a grant and explicit request allow it.
- Browser recordings remain off by default.
- Authenticated browsing is not available to Creator or ordinary users by default.

## Publish Readiness

- `npm pack --dry-run` shows only intended package files.
- The public npm artifact contains only `dist`, `README.md`, `LICENSE`, and
  `package.json`; repository-maintainer docs, hosted Worker source, migrations,
  deployment config, tests, and scripts stay out of the package.
- Runtime `dependencies` contain only CLI-installed dependencies. Cloudflare
  platform primitive packages stay in repository development dependencies for
  hosted Worker verification and deployment.
- No token-like string appears in `dist`, docs, test fixtures, or package
  metadata.
- `docs/API-CONTRACT.md` matches the hosted service route contract.
- `docs/VALIDATION-MATRIX.md` maps every goal-file command and safety gate to
  implementation evidence.
- Release notes mention any hosted-service dependency that is degraded or paused.
