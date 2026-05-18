# vc-tools Completion Audit

This audit maps `vc-tools-goal.md` to concrete repo evidence. It is intentionally
stricter than a green test suite: a verifier only counts when it covers the
actual requirement.

## Objective

Build `tools/vc-tools` as a standalone production-grade CLI and hosted live
surface for Vibecodr Tools Cloud, separate from the existing Vibecodr CLI,
covering the goal file's remote MCP, browser, sandbox, artifact, activity status,
usage, grants, retention, dashboard, plan, quota, audit, and safety posture.

## Current Gate

The CLI-contract surface is locally verified. `live-hosted-production` is
intentionally marked `hosted-required` after the human-use security hardening
work because the hosted service must be fully smoked before advertising it as
live. D1 migrations through `0006_scheduled_qa.sql` were applied and
read back on 2026-05-14, Browser Run/grant secrets were applied and read back
by secret name on 2026-05-14, and `vc-tools-api` was deployed on 2026-05-14 as
version `9846c9ad-641d-43f4-be5e-7a2ce574eb82`, then redeployed as
`fb83e4dc-8142-414f-94ba-66ec14821a68` after redirect-preflight hardening. Live
render, screenshot, markdown, PDF, Sandbox command, Sandbox tests, artifact
metadata, artifact list/readback, artifact bytes, usage,
retention, dashboard COGS URL, Scheduled QA create/list/run-now/job/artifact,
Scheduled QA monthly cap denial, `status`, `connect`, `tools list`, and direct
MCP JSON-RPC `initialize`, `tools/list`, and `tools/call` smokes
passed. Operator alert delivery is configured, but the historical production
delivery proof covered a retired per-user usage notification lane. Current
release proof must use the supported account-wide hosted, Browser Run, or
Sandbox capacity alert path. This is still not live release clearance because
short Creator Workflow-owned Browser Session agent tasks, Creator Sandbox command execution,
real Clerk OAuth, real user-scoped API-key exchange, and revoked-key denial have
been production-proven, while real paid-user Pro provider breadth,
Pro/long-duration Browser Session proof, natural Scheduled QA cron readback, and
account-wide operator alert fanout proof remain open. Monthly and daily credit
exhaustion have synthetic production proof: 429 `quota.exceeded` and 429
`quota.daily_exceeded` returned before job insertion, with D1 readback showing
zero accepted jobs for the probe actors. Unsafe-target denial now has live
shape-level, DNS-preflight including private-AAAA, and unsafe-redirect proof.
Synthetic CLI-grant smokes proved the Free paid-sandbox denial, Pro
`standard-2` sandbox lane, and cross-actor artifact denial; those do not replace
real paid-account provider-path proof. Historical
`production-smoked` bullets below are not current release clearance unless
explicitly refreshed by the 2026-05-14 notes.
Scheduled QA is live-smoked for manual run-now behavior and monthly cap denial;
natural cron-tick readback at a real deployed trigger time remains open.

## Prompt-to-Artifact Checklist

| Goal requirement | Evidence | Verification | Status |
| --- | --- | --- | --- |
| Separate tool from Vibecodr CLI | `package.json` uses `@vibecodr/vc-tools`, bin `vc-tools`; `AGENTS.md` defines separate namespace; `vc-tools-goal.md` examples use `vc-tools` | `test/cli.behavior.test.ts` help/version test; `git rev-parse --show-toplevel` in child repo | Locally verified |
| CLI as setup/debug/artifact helper | `src/cli/run.ts` implements login, status, connect, tools, jobs, artifacts, usage/limits, grants, retention, plans, dashboard, inspect, doctor | `test/cli.behavior.test.ts`; `npm run verify` | Locally verified |
| Remote MCP is primary agent surface | `src/hosted/worker.ts` exposes `/mcp`; `docs/API-CONTRACT.md` documents Streamable HTTP and JSON-RPC methods | `test/hosted-worker.test.ts` verifies `initialize`, `tools/list`, and `tools/call`; direct production JSON-RPC smoke on 2026-05-14 verified `initialize`, `tools/list`, and `tools/call` for `usage.read` | Locally verified; live-smoked 2026-05-14 |
| Browser render/screenshot/markdown/PDF/crawl/agent tools | `CAPABILITIES` and CLI aliases cover `browser.render_url`, `browser.screenshot_url`, `browser.extract_markdown`, `browser.render_pdf`, `browser.crawl_site`, and paid `browser.agent_task`; live Worker uses Browser Run Quick Actions for stateless browser jobs and the Browser Session binding for Creator/Pro agent tasks; direct cookie/header/storage-state auth material is denied before provider execution | CLI payload tests, crawl payload tests, paid agent-task payload test, unsafe URL validation tests, hosted authenticated-browser material denial test, hosted DNS preflight, Quick Action routing test, paid agent-task contract test, Browser Session closure metadata tests, metered-time usage test, crawl artifact and crawl-page metering test | Locally verified |
| Scheduled QA | `src/hosted/worker.ts` implements `/v1/scheduled-qa` create/list/update/delete plus the Worker `scheduled()` cron enqueuer; `migrations/0006_scheduled_qa.sql` stores actor-scoped configs and run rows; CLI exposes `vc-tools scheduled-qa`; public and docs surfaces classify Scheduled QA as gated beta | hosted Worker scheduled-QA create/list/cron-enqueue tests, CLI scheduled-QA route tests, plan/classification tests, shared plan presentation tests; live run-now/job/artifact and monthly cap-denial smokes on 2026-05-14 | Locally verified; live-smoked 2026-05-14 |
| Sandbox run/tests tools | `CAPABILITIES` and CLI aliases cover `sandbox.run_command`, `sandbox.run_tests`; sandbox command validation prevents local execution; live Worker exports Creator `Sandbox` and Pro `ProSandbox` SDK classes with public HTTP(S) egress enabled for package/docs work; Cloudflare host policy plus the hosted outbound handler block private, local, link-local, metadata, and internal destinations | CLI sandbox tests, validator tests, hosted public-network-default and outbound-denial tests, Wrangler config split test; fresh production smoke required after redeploy | Locally verified |
| Artifact store/read/pull/delete | CLI implements artifact list/get/pull/create/delete; live Worker stores generated/uploaded artifacts in R2 with D1 metadata, active-storage quota predicates, R2 cleanup on D1 reservation failure, explicit actor-scoped deletion, and expiry | CLI artifact tests; hosted upload cap tests; hosted artifact storage race cleanup test; hosted explicit artifact delete test; hosted queue artifact completion test; expired artifact download denial test; scheduled cleanup path | Locally verified |
| Hosted work status/cancel/list | CLI implements job list/status/cancel; live Worker stores hosted work records in D1, dispatches stateless/sandbox/scheduled jobs through Queue/DLQ, dispatches paid Browser Agent jobs through `BROWSER_AGENT_WORKFLOW`, reports queued-ahead metadata without delaying interactive tools, lets failed Queue job messages reach the configured DLQ retry boundary without re-running cost-bearing provider work, and returns cleanly for exhausted failed-job deliveries | CLI job tests; hosted queue completion test; hosted queued-ahead metadata test; hosted Browser Agent Workflow dispatch/rejection tests; pre-execution and during-execution cancellation tests; failed-job DLQ retry-boundary and exhausted-loop tests; Wrangler queue/workflow config assertion | Locally verified |
| Usage and limits | `DASHBOARD_SECTIONS`, CLI dashboard URL generation including internal COGS, hosted `/dashboard/*` HTML, live `/v1/usage` from D1 usage events, `usage.read` MCP tool, and `vc-tools limits` alias | CLI usage/limits tests, CLI dashboard tests, hosted MCP usage test, hosted dashboard contract test, shared API URL validation test | Locally verified |
| Open-source client authority boundary | `vc-tools plans` local fallback and `/v1/plans` are marked non-authoritative for actor entitlement; `/v1/usage`/`usage.read` are read-only and marked not client-mutable; docs state forks cannot change official hosted entitlement or provider access | CLI plans fallback test, CLI usage/limits test, hosted plan contract test, hosted MCP usage test, docs/security review | Locally verified |
| Plan usage, recent activity, artifacts, tool grants, retention, billing, internal COGS dashboard sections | `DASHBOARD_SECTIONS` and `dashboardData()` cover overview, usage, activity, artifacts, grants, retention, billing, and COGS; live COGS uses D1 usage plus env-configured per-surface assumptions | `hosted worker exposes dashboard, plan, offering classification, grant, and policy launch contract`; CLI dashboard tests cover the COGS URL; live plan/quota gate uses `DEFAULT_PLANS` | Locally verified |
| Creator and Pro subscription plan packaging | `DEFAULT_PLANS` includes Free, Creator, and Pro and omits the retired standalone Starter package; Creator is the `$19/mo` baseline | CLI plans test and hosted plan contract test | Locally verified |
| Free vc-tools floor | `DEFAULT_PLANS` includes limited Free Quick Actions only: 30 VC Tool credits/month, 10/day, 1 concurrent run, 30s browser-run cap, no Sandbox, no Browser Sessions, no scheduled QA | CLI plans test and hosted plan contract test | Locally verified |
| Separate build and VC Tools ledgers | Parent `PLAN_LIMITS[*].builds` owns build seconds/jobs/concurrency/output caps; parent and child `vcTools` owns VC Tool credits/browser seconds/crawl/scheduled QA; hosted `enforceQuota` counts browser and sandbox jobs against one VC Tools ledger and enforces Free/Creator/Pro active-run caps before Queue/Workflow dispatch | parent shared-plan tests, parent build reserve tests, hosted plan/quota and browser-concurrency tests | Locally verified |
| Overage meters | `OVERAGE_METERS` covers browser time, sandbox time, storage, retention, concurrency, crawl, and scheduled QA while customer-facing pricing leads with VC Tool credits and outcomes | CLI plans test and hosted plan contract test | Locally verified |
| Account-wide hosted capacity and operator alerting | `wrangler.jsonc` caps queue consumer concurrency and both paid Sandbox container lanes at 30, and binds `BROWSER_AGENT_WORKFLOW` for durable paid Browser Agent execution; Creator routes to Cloudflare `standard-1` with 10-minute task caps, Pro routes to Cloudflare `standard-2` with 30-minute task caps, and both paid plans cap per-user active sandbox tasks at 2; the Worker enforces hosted, Browser Run, and Sandbox account hard caps before cost-bearing execution, reports queued-ahead metadata without adding interactive Queue delay, emits metadata-only 70/85/95 account-wide capacity plus Queue/DLQ backlog, artifact-storage, retention-cleanup-failure, Browser/Sandbox execution-health, unexpected hosted Worker 500, auth-failure-anomaly, and Cloudflare spend-anomaly operator alerts through internal-api/email/ntfy/webhook fanout, suppresses every user-scoped vc-tools payload before operator fanout, and dedupes alerts through `operator_alert_dedupe` reset windows | parent shared-plan tests, parent outbound-alert vc-tools filtering tests, hosted Browser/Sandbox account-cap tests, hosted queued-ahead metadata test, hosted Browser Agent Workflow dispatch/rejection tests, hosted soft-cap alert fanout/dedupe/missing-notifier tests, scheduled Queue/DLQ/artifact-storage/retention-cleanup/execution-health/auth-failure/Cloudflare-spend alert tests, hosted Worker 5xx sanitized-alert test, auth-failure metric redaction test, Browser Session user-cap no-alert test, Wrangler config split test, `wrangler types --check`; production deploy/readback on 2026-05-14 shows only `E-VIBECODR-VC-TOOLS-SOFT-CAP` configured, so the new cleanup-failure, execution-health, hosted Worker 5xx, auth-failure-anomaly, Cloudflare spend-anomaly, and Browser Agent Workflow lanes still need deploy/readback | Deployed/read back 2026-05-14 for soft-cap code; Queue/DLQ/artifact-storage/retention-cleanup/execution-health/hosted-5xx/auth-failure/Cloudflare-spend alerts and Browser Agent Workflow dispatch locally verified |
| Workspace/project/user scoped grants | `LAUNCH_TOOL_GRANTS` records grant, capability, default scope, phase, and allowed plans | Hosted grant contract test checks workspace-scoped sandbox network metadata | Locally verified |
| Policy: no raw provider credential exposure | Plain `vc-tools login` stores the durable scoped local credential returned to the polling CLI plus a cached short-lived grant; file/stdin OAuth/API-key paths store the durable local credential so grants can refresh; private device codes, browser approval responses, and Cloudflare/provider credentials stay behind hosted/API boundaries | redaction tests; browser/device login tests; OAuth/API-key exchange tests; expired-grant refresh test; secret scan; docs | Locally verified |
| Policy: quota checked before cost | live Worker checks D1 monthly/daily VC Tool credits, browser seconds, sandbox seconds, and concurrent active runs against the active plan before Queue/Workflow dispatch; D1 job insertion is atomic with the quota reservation and sandbox reservations reconcile on terminal/cancelled jobs; quota denials write analytics-only `tools.denied_quota` audit metrics for COGS/ops review without operator notification fanout | hosted live audit/job-before-dispatch test; hosted quota denial metric assertions; sandbox reservation test; sandbox reservation reconciliation test; atomic reservation conflict test; parallel atomic reservation race test | Locally verified |
| Policy: audit logged before cost | live Worker inserts a D1 audit event before inserting the job and sending a Queue message or creating a Workflow instance | hosted live audit/job-before-dispatch test; hosted Browser Agent Workflow dispatch test | Locally verified |
| Policy: no authenticated browsing by default | `LAUNCH_POLICIES` and plan posture disable or gate authenticated browsing | goal verifier markers and hosted policy contract test | Locally verified |
| Policy: sandbox public egress with private denial | CLI sandbox payloads normalize to public HTTP(S) network available for paid Agent Computer jobs; `LAUNCH_POLICIES` records private/internal denial; hosted outbound policy rejects URL credentials, private/local/internal destinations, and private-resolving hostnames before forwarding HTTP(S) requests | CLI sandbox test; hosted policy contract test; hosted public-network-default and outbound-denial tests | Locally verified |
| Policy: no browser recording by default | `LAUNCH_POLICIES` and plan posture disable recording by default | hosted policy contract test | Locally verified |
| Policy: no unlimited crawl | `LAUNCH_POLICIES` and plan posture gate crawl through `browser.crawl_site`, plan page/depth caps, and crawl-page metering | hosted policy contract test; hosted crawl artifact and crawl-page metering test | Locally verified |
| Human-use security hardening | CLI denies stored-token forwarding to insecure local API URLs unless explicitly allowed; OAuth/API-key login exchanges through Vibecodr Auth, stores the durable local account credential, and refreshes expired grants; artifact uploads/downloads are workspace-bounded including symlink/junction denial; artifact deletion requires explicit confirmation; hosted artifact writes hard-enforce active storage caps and clean up R2 after D1 reservation failure; hosted artifact delete removes actor-scoped D1 shelf rows plus R2 bytes; hosted auth supports scoped Vibecodr CLI grants with per-tool capability scopes; hosted auth failures write anonymous, token/query-free `auth.failed` metrics before any aggregate account-level anomaly alert; live rows are actor-scoped; Browser Run has DNS preflight plus Quick Action routing, Scheduled QA uses only public-HTTPS Browser Quick Actions, paid Browser Agent Workflow routing, crawl routing, timeout shaping, 10-minute idle closure metadata/audit, unsafe URL denial metrics, and provider 429 retry/defer handling; sandbox public HTTP(S) egress is allowed for normal package/docs work while private/local/internal destinations stay denied; sandbox seconds are reserved and reconciled; artifacts inherit and enforce retention; operator alerts remain metadata-only and D1-deduped | CLI behavior tests, validators tests, parent `cliAuth` tests, hosted Worker tests, `migrations/0002_actor_scope.sql`, `migrations/0003_quota_reservations.sql`, `migrations/0004_sandbox_quota_reservations.sql`, `migrations/0005_operator_alert_dedupe.sql`, `migrations/0006_scheduled_qa.sql` | Locally verified |
| Stable JSON output and exit codes | `src/cli/output.ts`, `src/cli/errors.ts` | CLI behavior tests | Locally verified |
| Native credential storage by default | `src/config/credential-store.ts` uses native keyring unless file mode is explicitly selected | login tests use explicit file store; docs warn file mode is for tests/automation | Locally verified |
| Package is publishable | `package.json`, `scripts/check-pack-artifact.mjs`, `.github/workflows/ci.yml` | `npm run verify:artifact`; `npm pack` metadata checked by script | Locally verified |
| Cloudflare Worker production shape | `wrangler.jsonc`, generated `worker-configuration.d.ts`, `src/hosted/worker.ts`, `Dockerfile`, `migrations/0001_live_schema.sql`, `migrations/0002_actor_scope.sql`, `migrations/0003_quota_reservations.sql`, `migrations/0004_sandbox_quota_reservations.sql`, `migrations/0005_operator_alert_dedupe.sql`, `migrations/0006_scheduled_qa.sql`; Durable Object classes `Sandbox` and `ProSandbox` back Creator/Pro container lanes | `npm run check:worker`; dry-run deploy; remote migrations; live smoke | Hosted-required after hardening |
| Current Cloudflare guidance used | `docs/API-CONTRACT.md` records Browser Run on Containers, Quick Action timeout, crawl, Sandbox, Workers, and MCP assumptions | Cloudflare docs fetched during implementation; Worker uses current compatibility date and generated types | Verified for this build date |
| Release channel cannot hide live gaps | `scripts/check-release-readiness.mjs` imports built goal coverage and validates release channel semantics | `npm run verify:release`; `VC_TOOLS_RELEASE_CHANNEL=live npm run verify:release`; included in `npm run verify` | Verified |

## Hosted Production Evidence

`live-hosted-production` was previously provisioned and production-smoked before
the latest security hardening. The entries below distinguish older historical
evidence from the 2026-05-14 refreshed production smokes that still do not add
up to live release clearance:

- `scripts/wrangler-wincred.ps1 d1 migrations apply vc-tools-db --remote`
  applied `0004_sandbox_quota_reservations.sql` and
  `0005_operator_alert_dedupe.sql` on 2026-05-14 after remote readback showed
  them pending. Follow-up readback reported no pending migrations, returned
  both names from `d1_migrations`, returned `reserved_sandbox_seconds` from
  `PRAGMA table_info(jobs)`, and returned `operator_alert_dedupe` plus expected
  indexes from `sqlite_master`.
- `scripts/wrangler-wincred.ps1 -CredentialTarget
  vibecodr:cloudflare:wrangler-deploy-token-prod deploy` deployed
  `vc-tools-api` version `9846c9ad-641d-43f4-be5e-7a2ce574eb82` to
  `https://tools.vibecodr.space` on 2026-05-14. The first deploy attempt with
  the admin token uploaded version `88334d51-e255-4051-aae8-68f48434b0e7` but
  failed during route update because that token lacked zone-route permission;
  the deploy-token retry completed.
- Redirect-preflight hardening was verified with `npm run verify`, then
  redeployed with the same deploy-token path as version
  `fb83e4dc-8142-414f-94ba-66ec14821a68`; Cloudflare deployments readback showed
  that version at 100%.
- Historical live health returned `providerMode=live`, `version=0.1.3`, no missing
  bindings, and after the alert-secret bootstrap returned
  `operatorAlerts.configured=true`, `operatorAlerts.internalApiBinding=true`,
  and `operatorAlerts.internalAlertToken=true`. Current public health/readiness
  hides operator alert readiness from user-facing payloads.
- `scripts/vc-tools-secrets.ps1` now owns the hosted alert signer:
  `vibecodr:vc-tools:internal-alert-secret:prod` is uploaded to `vc-tools-api`
  as `VC_TOOLS_INTERNAL_ALERT_TOKEN` and to `vibecodr-internal-api` as
  `INTERNAL_BINDING_TOKEN_NEXT`, leaving the current production
  `INTERNAL_BINDING_TOKEN` untouched. Secret-name readback listed both
  `VC_TOOLS_INTERNAL_ALERT_TOKEN` and `INTERNAL_BINDING_TOKEN_NEXT`.
- `workers/internal-api/wrangler.toml` previously included
  `E-VIBECODR-VC-TOOLS-USAGE-THRESHOLD` in `ALERT_CODES` for a now-retired
  user-usage operator email lane. The current local contract allows
  `E-VIBECODR-VC-TOOLS-SOFT-CAP` for account-wide capacity pressure and
  `E-VIBECODR-VC-TOOLS-RETENTION-CLEANUP-FAILED` for account-wide
  expired-artifact cleanup failure, and
  `E-VIBECODR-VC-TOOLS-EXECUTION-HEALTH-DEGRADED` for account-wide
  Browser/Sandbox failure or timeout rate pressure, and
  `E-VIBECODR-VC-TOOLS-HOSTED-WORKER-5XX` for unexpected account-wide hosted
  Worker HTTP 500s, and
  `E-VIBECODR-VC-TOOLS-AUTH-FAILURE-ANOMALY` for account-wide hosted auth
  failure bursts, and
  `E-VIBECODR-VC-TOOLS-CLOUDFLARE-SPEND-ANOMALY` for account-wide estimated
  Cloudflare usage spend pressure; all user-scoped vc-tools payloads are
  filtered before delivery or outbound-alert dedupe.
  The earlier dry-run deploy passed and production deploy published internal-api version
  `51a7fdce-ac37-4c55-ba9a-eb5420d38cfd`; Cloudflare deployments readback showed
  that version at 100% on 2026-05-14.
- The per-user notification fanout retirement was deployed on 2026-05-14:
  parent `vibecodr-api` version
  `2ece601a-7c72-4e53-b496-9478eb9e16ee`, `vibecodr-internal-api` version
  `5d6dc724-c92b-478f-b0fc-aa4e2b966c79`, and `vc-tools-api` version
  `520f70b6-ec3e-4a4d-859c-e77161b00f11` all read back at 100%. Production
  `GET https://tools.vibecodr.space/v1/health` returned
  `operatorAlerts.codes=["E-VIBECODR-VC-TOOLS-SOFT-CAP"]`,
  `operatorAlerts.configured=true`, `operatorAlerts.internalApiBinding=true`,
  and `operatorAlerts.internalAlertToken=true`, proving the then-current
  operator-readiness payload no longer exposed retired user-usage alert codes.
  Current public health/readiness hides operator alert readiness from
  user-facing payloads. A fresh deploy/readback is still needed for the new
  `E-VIBECODR-VC-TOOLS-RETENTION-CLEANUP-FAILED`,
  `E-VIBECODR-VC-TOOLS-EXECUTION-HEALTH-DEGRADED`,
  `E-VIBECODR-VC-TOOLS-HOSTED-WORKER-5XX`, and
  `E-VIBECODR-VC-TOOLS-AUTH-FAILURE-ANOMALY`, and
  `E-VIBECODR-VC-TOOLS-CLOUDFLARE-SPEND-ANOMALY` codes.
- Parent API Worker secret-name readback for `workers/api/wrangler.toml` listed
  both `CLERK_SECRET_KEY` and `CLI_GRANT_SECRET` on 2026-05-14. That proves
  configuration presence by name, not a real Clerk OAuth/API-key exchange.
- Parent API Worker deployment/readback closed a stale-route blocker on
  2026-05-14: `vibecodr-api` version
  `e0307c63-4df5-4b07-b491-0a739ac185fe` is at 100%, and the previously
  404ing `POST https://api.vibecodr.space/auth/vc-tools/device/start` now
  returned HTTP 200 with the then-current `vibecodr.space/settings/api-keys`
  verification URI. Current CLI approval uses `/settings/vc-tools/approve`.
- The canonical parent Worker deployment pass later on 2026-05-14 read back all
  deployed versions at 100%: `vibecodr-outbound-alerts`
  `c9f60791-38e4-494f-9990-6deab45e9875`, `vibecodr-clerk-proxy`
  `29d21b3c-89a3-42fd-97fa-3a98661530a8`, `vibecodr-outreach-email`
  `2d165f68-ff57-46a1-b381-b44aa61c7bc6`, `vibecodr-internal-api`
  `e506348f-fdef-4171-9abe-5716d2977083`, `vibecodr-outbound`
  `349746cf-958d-4d67-b478-3b4161adad89`, `vibecodr-dispatch`
  `9da1465c-7c1c-42bd-a1ba-90a409268e5e`, `vibecodr-vibe-edge`
  `8fbbc418-5af2-4a82-82fb-1fd2cb97a9a7`, `vibecodr-pulse-state-gateway`
  `b80edff8-7e5b-450f-b70d-8fd4fcc7b7ba`, and `vibecodr-api`
  `b19e2ddf-8b33-4ea7-948f-3bcb0d7d3121`.
- A post-deploy device-start smoke returned HTTP 200 with the expected
  verification URI, then remote parent D1 marked smoke session
  `vctda_5cbe90cf-09ee-4543-acd6-89cbd6cf30c7` `expired`.
- Post-deploy `https://tools.vibecodr.space/v1/health` returned
  `providerMode=live`, `dnsPreflight=true`, and all operator-alert secret and
  binding booleans true. `vc-tools status --json` returned authenticated health
  OK against `https://tools.vibecodr.space`.
- A fresh read-only hosted smoke on 2026-05-15 returned `/v1/health`
  `ok=true`, `providerMode=live`, version `0.1.3`, no missing bindings,
  `dnsPreflight=true`, `sandboxInternetDefault=off`, account-wide
  hosted/Browser/Sandbox caps `24/30`, and operator-alert config containing only
  `E-VIBECODR-VC-TOOLS-SOFT-CAP` at `70/85/95` thresholds with internal alert
  binding/token present. `vc-tools status --json` used the native credential
  store and returned authenticated live health; `whoami --json` returned plan
  `Creator`; `usage --json`, `tools list --json`, `grants list --json`,
  `retention show --json`, and `inspect --json` also succeeded. `inspect --json`
  still reports `live-hosted-production` as the single hosted-required
  inspection; this smoke refreshes deployed-service evidence, not release
  clearance.
- Earlier production smoke returned plan `Pro` and workspace `wrk_tools` under the
  then-current static worker config; current local source defaults the contract
  baseline to Creator and should be redeployed/smoked before broad paid rollout.
- Earlier direct-grant smoke verified the CLI credential path without printing
  the token. `vc-tools status` succeeded through the native credential store on
  2026-05-14.
- Real user-scoped API-key login passed on 2026-05-14: a signed-in production
  API Keys page created a temporary scoped `vc-tools` key, `vc-tools login
  --credential-stdin` exchanged it through the parent API as an isolated smoke
  approval, and `status --json` plus `whoami --json` read back authenticated
  production health and plan `Pro`. The temporary local approval was removed
  after proof.
- Revoked API-key denial passed on 2026-05-14: temporary smoke keys were removed
  from a fresh signed-in API Keys page, and a follow-up `vc-tools login
  --credential-stdin` against a revoked smoke secret exited 3 with
  `E-VIBECODR-0001` / parent Auth API HTTP 401.
- Plain browser/device `vc-tools login` passed after the production Pages
  release. Real Clerk OAuth token login is also production-proven as of
  2026-05-15.
- An isolated `vc-tools login` attempt with profile `smoke-real-device` reached
  the production browser approval loop for code `4YBH-EBFH`; no signed-in
  browser approval occurred during the run, so it remains an interactive
  blocker. The two smoke device sessions were marked `expired` by exact D1 IDs.
- A later Chrome-backed browser/device attempt reached code `CSYS-TC3J`, but
  the production API Keys page did not render the expected approval panel for
  `vc_tools_code`; parent D1 session
  `vctda_d867c439-e318-4ef4-a689-06adeed384ab` was marked `expired` after the
  blocked attempt. This keeps browser/device login blocked on frontend/Pages
  deployment rather than on the parent API route.
- The frontend/Pages blocker was closed on 2026-05-14: commit
  `097870a2a` was pushed to `origin/master`, and Cloudflare Pages deployment
  list read back active production deployment
  `bbba8b07-0f83-4bc9-90be-7faf1340373c` for source `097870a`.
  `vc-tools login --no-browser` with profile
  `smoke-real-device-prod-097870a` produced code `E2FW-3R8R`; the signed-in
  production API Keys page rendered `Approve vc-tools login`, approved the
  matching code, and the CLI exited 0 with `authMode=browser_device`,
  `grantProfile=vc_tools`, `grantScopes=["vc-tools:use","vc-tools:*"]`,
  `verified=true`, and plan `Pro`. Follow-up `status --json` and
  `whoami --json` read back authenticated production health, `tokenKind=cli_grant`,
  `providerMode=live`, and plan `Pro`; the temporary local profile was removed.
- Invalid API-key-shaped and OAuth-token-shaped production exchange requests to
  `/auth/cli/exchange` both failed closed with HTTP 401
  `auth.verificationFailed`.
- Real Clerk OAuth token login passed on 2026-05-15 through the live Clerk PKCE
  path advertised by `GET https://api.vibecodr.space/agent/vibe`: issuer
  `https://vibecodr.space/__clerk`, client id `g3NwTqUg7nRzHeHo`, redirect
  `http://localhost:3000/oauth_callback`, and scopes `openid profile email`.
  The in-app browser completed sign-in/consent, the local callback listener
  exchanged the authorization code for a Clerk access token, and
  `scripts/smoke-vc-tools-oauth-token.mjs` consumed that token over stdin
  without printing or persisting it. Smoke run
  `codex-oauth-20260515230549-tgn17r` passed `login-oauth-token`,
  `whoami-oauth-token`, and `usage-oauth-token`: `authMode=oauth`,
  `grantProfile=vc_tools`, `grantScopes=["vc-tools:use","vc-tools:*"]`,
  `verified=true`, plan `Pro`, `providerMode=live`,
  `vcToolCreditsIncluded=3000`, `browserSecondsIncluded=180000`,
  `sandboxMinutesIncluded=3000`, `secretPrinted=false`, and
  `configDirRemoved=true`.
- Direct MCP JSON-RPC POSTs to `https://tools.vibecodr.space/mcp` passed on
  2026-05-14: `initialize` returned status 200 and protocol version
  `2025-11-25`, `tools/list` returned status 200 with 13 tools and
  `usage.read`, and `tools/call` for `usage.read` returned status 200,
  `isError=false`, alias `limits.read`, and `providerMode=live`.
- A live `browser.extract_markdown` job completed on 2026-05-14 as
  `job_e1d68ee7-7dd2-4583-9a65-41fd1127e1dc`, producing R2 artifact
  `art_590d9c04-8dda-4b0c-a1e4-b9c6892776bd`; metadata readback and byte pull
  succeeded.
- Live `browser.render_url`, `browser.screenshot_url`, and `browser.render_pdf`
  jobs completed on 2026-05-14 as
  `job_4182910d-41bd-49cb-972b-84544647ce88`,
  `job_0db62b80-48b5-4824-b35b-ad360a3bb427`, and
  `job_820ced20-4e8b-42d1-97f1-fa14cc3df076`.
- Queued cancellation passed on 2026-05-14:
  `job_c73d936e-a736-4f19-b6da-104f7887adfe` was accepted as `queued`,
  canceled immediately, finalized as `cancelled`, and D1 readback showed
  `started_at=null`, `reserved_sandbox_seconds=0`, and audit rows
  `jobs.cancel` plus `tools.skipped_cancelled`.
- `npm run verify` passed after the latest production-proof updates: `check`,
  `test` (88 passing tests), `build`, `verify:artifact`, `verify:goal`, and
  default-channel `verify:release` all completed. Live hosted production
  release remains separately gated until the remaining real-user/provider proof
  blockers close.
- Workflow migration smoke passed on 2026-05-17 after deploying
  `vc-tools-api` version `aeeaab85-93ab-4219-acf7-fffbe2be834e` at 100%.
  A short-lived synthetic Creator grant submitted `browser.agent_task` against
  `https://example.com`; the hosted API accepted
  `job_0e8b0cc2-9a3c-4791-8e77-ce0da1191a3c` with `providerMode=live`,
  `capability=browser.agent_task`, `queue.fairDelaySeconds=0`, and no queued
  actor/global backlog. The job completed through the Workflow-owned Browser
  Session lane and produced R2 artifact
  `art_466de507-1432-41eb-9253-c9f79aac8148` as
  `browser-agent-task-json`, 834 bytes,
  `application/json; charset=utf-8`, expiring on 2026-05-24. CLI proof
  metadata readback and byte download both succeeded; post-run usage for the
  smoke actor showed one browser job and eight browser seconds. Remote D1
  readback showed `queue_delay_seconds=0`, `reserved_credits=1`,
  `reserved_browser_seconds=120`, `status=completed`, and audit events
  `tools.accept_requested`, `tools.accepted`, `tools.workflow_started`,
  `tools.browser_agent.completed`, and `tools.completed` for the same job.
  The smoke wrapper reported `secretPrinted=false` and removed its temporary
  config/workspace directory.
- Root `pnpm run check` passed after regenerating the system map and fixing the
  docs contract guardrail command wording, so the parent repo gate is fresh as
  of the 2026-05-14 Worker deployment/readback pass.
- A short live Creator `browser.agent_task` job has been smoked through the
  `BROWSER` binding with closure metadata and artifact readback. New real
  paid-user Creator/Pro Browser Session breadth and Creator 20-minute / Pro
  1-hour cap validation still need production proof.
- A live `browser.crawl_site` job completed on 2026-05-14 with `--max-pages 1
  --max-depth 1` as `job_bf15485f-d0be-4bd8-820d-e89cdaa3509d`, producing R2
  artifact `art_171deebb-8e41-43e4-add7-01fc80c10565`. An earlier
  `--max-depth 0` attempt was accepted but failed with Browser Run HTTP 400, so
  keep the production-safe crawl smoke at depth 1 unless provider docs prove a
  different minimum.
- Scheduled QA was deployed live on 2026-05-14 after applying
  `0006_scheduled_qa.sql` to remote `vc-tools-db`. `scheduled-qa create
  --run-now` now immediately enqueues the first Browser Quick Action instead of
  merely waiting for the next six-hour cron tick. Live config
  `sqa_5309a4d4-b2b2-4063-aacc-82d5bacbd972` created job
  `job_5695beee-edba-4caa-8beb-15169e06a78a`, which completed as
  `browser.extract_markdown` and produced artifact
  `art_9ae9d043-9bb1-46a5-8b4b-b79666fa74eb`. The smoke config was paused,
  listed disabled, deleted, and the disposable artifact was deleted.
- Scheduled QA monthly cap denial was production-proven on 2026-05-14. The
  static Creator smoke actor had zero May queued Scheduled QA rows before the
  test. A marked seed config `sqa_monthcap_static_20260514_2130` plus 300 marked
  queued rows filled the Creator `maxRunsPerMonth=300` cap. Live
  `scheduled-qa create --run-now` for config
  `sqa_dd9dd9f9-4903-442b-9872-b2752c295d5c` returned `providerMode=live`,
  `lastJobId=null`, and
  `lastError.code=quota.scheduled_qa_monthly_runs_exceeded`; D1 readback showed
  one `status=skipped` run with the same error code. The cap-test config was
  deleted through the CLI, the seed config was deleted from D1, and final
  readback returned `leftover_configs=0`, `leftover_runs=0`, and
  `queued_count_after=0`.
- A live Creator `sandbox.run_command` job completed on 2026-05-14 as
  `job_a8c9827a-a6f4-4c4e-abbf-9e38557f9cb5`, producing R2 artifact
  `art_50e5f37e-f28d-4db8-afe6-27c1f4b3f99f` through the deployed
  `standard-1` lane. Real paid-user Pro sandbox smoke remains open; the
  synthetic Pro grant smoke below only proves hosted lane routing and execution.
- A live `sandbox.run_tests` job completed on 2026-05-14 as
  `job_bdf491df-ad11-4e15-a07b-c236a8aa691c`, producing R2 artifact
  `art_614ffaf3-d64e-449a-bb02-b271400ea853` through the deployed
  `standard-1` lane.
- A synthetic short-lived Pro CLI grant for actor `smoke_pro_1778761722370`
  read back plan `Pro`, `sandbox.containerInstanceType=standard-2`, and
  `maxSandboxTaskSeconds=1800`, then completed `sandbox.run_command` as
  `job_928afe9c-1760-4f6b-9d87-380524425f10`, producing R2 artifact
  `art_8abce620-b8c1-40cd-bf51-27cf74828aed`. Post-run usage for that actor
  reported `vcToolCredits=1`, `dailyVcToolCredits=1`, `sandboxJobs=1`, and
  `sandboxMinutes=0.04`.
- A synthetic short-lived Free CLI grant for actor `smoke_free_1778761722370`
  read back plan `Free`, `sandbox.containerInstanceType=none`, and
  `maxSandboxTaskSeconds=0`; `sandbox.run_command` returned HTTP 403
  `quota.plan_denied`, with usage and jobs unchanged at zero.
- The synthetic Free actor could not read or download the synthetic Pro actor's
  artifact `art_8abce620-b8c1-40cd-bf51-27cf74828aed`; metadata returned
  `not_found` and download returned HTTP 404.
- Production D1 `vc-tools-db` `audit_events` readback returned
  `tools.accept_requested`, `tools.accepted`, and `tools.completed` rows for
  `job_bdf491df-ad11-4e15-a07b-c236a8aa691c` (`sandbox.run_tests`) and
  `job_928afe9c-1760-4f6b-9d87-380524425f10` (`sandbox.run_command`, synthetic
  Pro actor).
- `/v1/tools/test` for `browser.render_url` with `https://127.0.0.1/` returned
  HTTP 400 `input.blocked_url`; MCP `tools/call` for the same input returned
  HTTP 200 with JSON-RPC error `-32602` and hosted code `input.blocked_url`.
  Immediate before/after readback showed usage unchanged
  (`vcToolCredits=14`, `dailyVcToolCredits=12`, `browserJobs=11`,
  `browserSeconds=37`, `sandboxJobs=3`, `sandboxMinutes=0.21`) and the jobs
  list unchanged at 14 rows.
- A broader live unsafe-target matrix through `/v1/tools/test` rejected
  `https://localhost/`, `https://127.0.0.1/`, `https://10.0.0.1/`,
  `https://192.168.1.10/`, `https://[::1]/`, `https://[fe80::1]/`, and
  `https://service.internal/` as `input.blocked_url`, and rejected
  `https://user:pass@example.com/` plus `http://example.com/` as
  `input.invalid_url`; usage and jobs were unchanged before/after.
- DNS preflight denial happened before cost-bearing dispatch: Cloudflare DNS resolved
  `127.0.0.1.nip.io` to `127.0.0.1`, and the hosted API rejected
  `https://127.0.0.1.nip.io/` as `input.blocked_url`; an unresolvable
  `example.com` subdomain returned `input.unresolvable_url`. Both synthetic
  actors kept usage and jobs at zero.
- Redirect preflight denial happened before cost-bearing dispatch on the redeployed
  Worker: synthetic Creator actor `smoke_redirect_1778762601247` submitted
  `https://httpbin.org/redirect-to?url=https%3A%2F%2F127.0.0.1%2F`, which
  returned HTTP 400 `input.blocked_url` with usage and jobs still zero.
- `/v1/usage` after the `sandbox.run_tests` smoke reported `vcToolCredits=15`,
  `dailyVcToolCredits=13`, `browserJobs=11`, `sandboxJobs=4`,
  `browserMinutes=0.62`, and `sandboxMinutes=0.25`.
- `/v1/artifacts` listed 12 generated artifacts after the `sandbox.run_tests`
  smoke, with newest artifact
  `art_614ffaf3-d64e-449a-bb02-b271400ea853`.
- `browser.agent_task` was accepted as
  `job_408d648f-5985-43df-9ce1-2a48a2a7e213` on 2026-05-14 but failed with
  `provider.execution_failed` / `No browser available`.
- Browser Session capacity was retried on 2026-05-14: live
  `browser.agent_task` job `job_b6aa6cde-b46d-4e5f-b402-85a34c3b431f` was
  accepted, started, then failed with `provider.execution_failed` and
  `Unable to create new browser: code: 503: message: No browser available`.
- A later short Creator Browser Session retry succeeded on 2026-05-14:
  static Creator actor `static_a7baba1d3429c27b` submitted
  `browser.agent_task` against `https://example.com` with
  `--timeout-ms 120000`; the hosted API accepted
  `job_9c9fe3fb-a9dc-46cd-b0a7-6370018636bb` with `quotaChecked=true`,
  `auditLogged=true`, and no fair delay. `jobs status` read back
  `status=completed`, plan `Creator`, artifact
  `art_acd11f82-58af-475e-a83a-d102332c64c4`, `closureReason=completed`,
  `idleTimeoutMs=600000`, `maxDurationMs=120000`, and `durationMs=6238`.
  Artifact metadata readback returned kind `browser-agent-task-json`,
  767 bytes, and a one-week expiration. Usage readback showed
  `allowBrowserSessions=true`, `maxBrowserSessionSeconds=1200`,
  `maxConcurrentBrowserSessionsPerUser=1`, `browserSeconds=43`, and
  `concurrentRuns=0`. This clears the stale provider-capacity blocker for a
  short Creator task, but not real paid-user Free/Creator/Pro breadth,
  Pro Browser Session, or long-duration boundary proof.
- A fresh short Creator Browser Session retry succeeded on 2026-05-15 after the
  temporary-completion handoff. Static Creator actor
  `static_a7baba1d3429c27b` submitted `browser.agent_task` against
  `https://example.com` with `--timeout-ms 60000` and
  `--idle-timeout-ms 30000`; hosted accepted
  `job_1860e308-7702-4d03-9b00-a2657d8dac51` with `quotaChecked=true`,
  `auditLogged=true`, and no queue backlog. `jobs status` read back
  `status=completed`, plan `Creator`, artifact
  `art_0b580e26-7b76-4edf-8811-1d2c5b68a61b`,
  `closureReason=completed`, `idleTimeoutMs=30000`, `maxDurationMs=60000`,
  and `durationMs=7675`.
- A fresh Creator Sandbox command smoke succeeded on 2026-05-15. The same
  static Creator actor submitted `sandbox.run_command` for `node --version`;
  hosted accepted `job_395a5f17-a3ad-43c0-b694-c87fc303bc7d` with
  `quotaChecked=true` and `auditLogged=true`, then completed with artifact
  `art_9438a0e0-ad65-4893-97c7-bcb0fd7b684c` through the deployed
  `standard-1` lane. Usage readback moved from 22 to 24 monthly VC Tool
  credits, from 1 to 3 daily credits, from 16 to 17 browser jobs, from 6 to 7
  sandbox jobs, from 63 to 70 browser seconds, and from 0.25 to 0.29 sandbox
  minutes, with zero active concurrency afterward.
- The 2026-05-15 artifact readback exposed a hosted-list bug: the CLI sent
  `--limit`, but the deployed Worker ignored the query and returned up to 50
  artifacts/jobs. The fix now validates `--limit` as `1..100` in the CLI,
  applies the same bound in the hosted Worker, and binds `LIMIT ?` for both
  `/v1/jobs` and `/v1/artifacts`. Verification passed with
  `node --import tsx --test test/cli.behavior.test.ts`,
  `node --import tsx --test test/hosted-worker.test.ts`, `npm run check`,
  `npm test`, `npm run verify:goal`, `npm run verify:release`,
  `git diff --check`, `npx wrangler deploy --dry-run --outdir
  tmp\wrangler-dry-run` through the WinCred wrapper, and full `npm run verify`.
  Production deploy published `vc-tools-api` version
  `cde73e4b-16f3-4faa-a122-63171a3ea3b4`; `wrangler deployments list` read it
  back at 100%. Live readback then returned exactly two artifacts for
  `artifacts list --limit 2`, exactly one artifact for
  `artifacts list --limit 1`, and exactly two completed jobs for
  `jobs list --limit 2`.
- Historical operator alert delivery smoke passed on 2026-05-14 for the retired
  user-usage alert lane: synthetic Creator actor
  `smoke_alert_creator_1778763846` completed live `browser.extract_markdown`
  job `job_3bacc8b9-022b-41ba-a655-9721b8c34104`, moving monthly credits from
  419/600 to 420/600 and crossing the 70% threshold. That proof row remains in
  D1 history, but the current product decision supersedes it: per-user
  quota/usage pressure is still metered and COGS-visible, but no longer enters
  operator notification fanout. Current production release proof must use an
  account-wide hosted, Browser Run, or Sandbox capacity soft-cap crossing.
- Monthly and daily quota exhaustion smokes passed on 2026-05-14. Synthetic
  Creator actor `smoke_quota_month_1778764445` was seeded at 600/600 monthly
  credits and a live `browser.extract_markdown` request returned HTTP 429
  `quota.exceeded`. Synthetic Creator actor `smoke_quota_day_1778764445` was
  seeded at 90/90 daily credits and the same request shape returned HTTP 429
  `quota.daily_exceeded`. `vc-tools-db` readback showed `accepted_jobs=0` for
  both actors, then cleanup removed 690 synthetic seed rows.
- Private-AAAA unsafe URL smoke passed on 2026-05-14. DNS readback showed
  `fd00--1.sslip.io` resolves to `fd00::1`; synthetic Creator actor
  `smoke_private_aaaa_1778764692` submitted live `browser.extract_markdown`
  against `https://fd00--1.sslip.io/`; the hosted API returned HTTP 400
  `input.blocked_url`, usage stayed at zero, and `vc-tools-db` readback showed
  zero jobs for that actor.

Commercial packaging is locally wired to the existing Vibecodr Creator and Pro
subscription model. The live Stripe production path was operator-validated on
2026-05-15, and real Clerk OAuth is now production-proven. The remaining
pre-rollout production work is the paid-account provider breadth smoke before
charging customers for vc-tools quota: Pro Browser Session, Pro Sandbox,
natural scheduled cron-tick readback, account-wide operator alert fanout proof,
and any not-yet-refreshed internal COGS readback. Browser Run owned-surface
allowlisting is pinned until Cloudflare enablement confirms the bot-detection
signals and should not block temporary completion.
`CLI_GRANT_SECRET`, `VC_TOOLS_CLI_GRANT_SECRET`,
`VC_TOOLS_BROWSER_RUN_ACCOUNT_ID`, and `VC_TOOLS_BROWSER_RUN_API_TOKEN` were
applied and read back by secret name on 2026-05-14; synthetic CLI-grant smokes
prove the deployed Worker can use them. Parent API auth routes are now deployed
invalid exchange requests fail closed, and real user-scoped Clerk API-key
exchange plus revoked-key denial are production-proven. Successful real
browser/device login is also production-proven after the Pages deployment.
Successful real Clerk OAuth is production-proven by
`codex-oauth-20260515230549-tgn17r`.

Asymmetric grant hardening is locally implemented after this live-smoke batch:
the parent API can sign ES256 vc-tools grants from `CLI_GRANT_PRIVATE_JWK`, the
hosted Worker verifies ES256 grants from `VC_TOOLS_CLI_GRANT_PUBLIC_JWKS`, grant
claims now include `kid`, `grant_profile`, `nbf`, and `jti`, and revoked `jti`
denial is locally enforced. Local proof on 2026-05-14:
`pnpm exec vitest run workers/api/src/auth.cliGrant.test.ts
workers/api/src/handlers/cliAuth.test.ts
workers/api/src/handlers/vcToolsDeviceAuth.test.ts` passed 3 files / 40 tests
in the parent repo, and `node --import tsx --test test/hosted-worker.test.ts`
passed 40 hosted Worker tests in this repo. This is not live clearance until
production ES256 key material is uploaded as Worker secrets, Workers are
redeployed/read back, and a live ES256 exchange plus revoked-`jti` denial smoke
is captured.

## 2026-05-17 Product-Surface Finetune

- `vc-tools-finetune.md` now captures the combined founder/agent critique for
  the v1 surface: split human/agent/operator contracts, remove default
  operator/roadmap metadata, make proof saving automatic, make `browser ask`
  honest as a snapshot lane, improve safety denials, and add a first-success
  `try` command.
- The default hosted/user surfaces now filter internal and operator metadata:
  `start`, `usage`, `plans`, `health`, and `mcp/connection` no longer expose
  launch classifications, overage meters, provider mode, sandbox internet
  defaults, auth scopes/token kind, operator alerts, COGS, webhook/ntfy, or
  account-pressure internals unless details/operator mode is explicitly used
  and the hosted actor is authorized.
- Browser/computer aliases now submit hosted work, poll until terminal by
  default, summarize the outcome, and save proof with `--out` without making
  the caller copy `job_...` or `art_...` IDs. `work follow` now actually polls
  until terminal and can save terminal proof. `vc-tools try` verifies auth,
  hosted API, public Browser work, hosted computer work, proof saving, and
  usage readback. `browser snapshot` is the honest name for the
  `browser.agent_task` snapshot lane; `browser ask` remains a compatibility
  alias with explicit copy that it is not a separate chat answerer.
- Local verification passed on 2026-05-17 with `npm run verify`, including CLI
  and Worker type checks, full tests, build, package artifact verification,
  goal coverage, and release-readiness gate. Focused checks also passed for
  `test/cli.behavior.test.ts`, `test/hosted-worker.test.ts`, and
  `test/limits.test.ts`.
- No D1 migrations changed in this product-surface pass. Dry-run deploy with
  `npx wrangler deploy --dry-run --outdir tmp\wrangler-dry-run` succeeded. The
  final production deploy published `vc-tools-api` version
  `ada2ce72-7493-4b5e-98c7-e788729c30bc` to `tools.vibecodr.space`;
  `wrangler deployments list` read it back at 100%.
- Post-deploy smoke with the built CLI passed: `plans --json` and
  `usage --json`, and `agent connect --client codex --json` were checked for
  forbidden default keys, `agent connect` exposed `browser.snapshot` rather
  than `browser.ask`, dashboard section order read back
  `overview,jobs,artifacts,usage,agents`,
  `vc-tools try --json --out tmp/live-vc-tools-proof-final2` returned
  `ready=true` while saving `browser-read.md` and `computer-run.json`, and
  `computer run ... --network off --out tmp/live-vc-tools-proof-final2`
  completed while saving `offline-computer.json`.
