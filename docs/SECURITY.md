# vc-tools Security Notes

`vc-tools` is a trust-boundary CLI. It validates local input before submitting
requests to the hosted Vibecodr Tools API, but the hosted API remains the source
of truth for auth, grants, quota, audit logging, retention, and Cloudflare
credential custody.

## Local Rules

- Plain `vc-tools login` is the default human path. It starts a browser/device
  approval session, prints a user-checkable code, optionally opens the Vibecodr
  approval page, and stores the durable credential returned to the polling CLI
  when the parent API issues one. The browser approval response must never
  include the signed grant, API key, OAuth token, refresh token, or private
  device code.
- Non-interactive credentials are preferably accepted through
  `--credential-file`, `--credential-stdin`, `VC_TOOLS_CREDENTIAL_FILE`, or
  local credentials. The input may be an existing vc-tools grant, a Clerk OAuth
  access token, or a scoped Clerk API key.
- Clerk OAuth access tokens and scoped Clerk API keys are exchanged through
  Vibecodr Auth for short-lived scoped `vc-tools` grants. When supplied through
  an explicit login path, they may be stored as the durable local credential so
  future grants refresh automatically without another human approval.
- Direct secret value flags and secret value environment variables
  (`--credential`, `--token`, `VC_TOOLS_CREDENTIAL`, `VC_TOOLS_TOKEN`) remain
  compatibility inputs for controlled automation, but public docs should prefer
  file/stdin/native credential paths to avoid shell-history, process-list, and
  environment leakage.
- The local auth SSOT is account-wide: one durable local credential plus a
  cached short-lived grant. Direct vc-tools grants can still be cached, but they
  are not refreshable and should be treated as advanced/temporary credentials.
- Stored credentials use the native OS credential store by default through
  `@napi-rs/keyring`. The file-backed credential store is only for local
  automation and must be explicitly selected with `VC_TOOLS_CREDENTIAL_STORE=file`.
- Authority-bearing tokens are redacted from stdout, stderr, JSON responses,
  warnings, hosted provider error details, and API error details. Safe operator
  handles and counters such as `artifactId`, `jobId`, `requestId`, `traceId`,
  `tokenCount`, `totalTokens`, and `tokenKind` remain visible so operators can
  debug without seeing reusable authority.
- API URLs must use HTTPS. Local HTTP API URLs are denied unless the operator
  explicitly passes `--allow-insecure-local-api` or sets
  `VC_TOOLS_ALLOW_INSECURE_LOCAL_API=true` for local development. This prevents a
  poisoned local config or environment variable from receiving a stored token.
- Browser URLs must use HTTPS and must not target localhost, private IP ranges,
  link-local ranges, multicast/unspecified ranges, internal hostnames, or URL
  credentials. IPv6 loopback, unique-local, link-local, IPv4-mapped, NAT64, and
  6to4 forms are denied before remote browser calls.
- Sandbox commands are remote submissions only. The CLI never executes them
  locally.
- Paid sandbox network access permits public HTTP(S) package/docs requests by
  default. Cloudflare host policy plus the hosted outbound handler block URL
  credentials, private/local/link-local/metadata/internal hosts, and hostnames
  resolving to those ranges.
- Mutations require explicit confirmation flags.
- `--quiet`, `--no-input`, and `--no-color` are accepted CLI convention flags;
  the CLI does not prompt or emit color by default.
- Artifact downloads must stay inside the current workspace unless a future
  release adds an explicitly audited export mode. Users may target a directory
  or an explicit file path inside the workspace, and `--filename` names the file
  inside a directory output without weakening the workspace boundary.
- Artifact downloads resolve existing output paths and nearest existing parents
  through real paths so symlinked or junctioned directories cannot redirect a
  pull outside the workspace.
- Artifact uploads must also originate inside the current workspace.
- Artifact upload size is enforced by the hosted service from the active plan
  contract, not by a separate CLI hardcode.

## Hosted Service Rules

The API must enforce these before any cost-bearing Cloudflare work:

- user authentication
- browser/device vc-tools login sessions in the parent Vibecodr API, stored as
  hashed device and user codes, single-use on redemption, and expired quickly
- Clerk OAuth/API-key verification in the parent Vibecodr Auth API before any
  public user receives a `vc-tools` grant
- scoped Vibecodr CLI grants with `vc-tools:use` plus a requested tool scope
  such as `vc-tools:browser.render_url` or `vc-tools:*`, or an explicitly
  configured static-token fallback for controlled deployments
- vc-tools grant audience validation. Hosted Tools accepts only grants intended
  for `vibecodr:vc-tools`, not broader Vibecodr CLI/API tokens.
- actor-scoped job, artifact, usage, retention, and audit rows
- authenticated hosted inspection and dashboard routes
- workspace/project/user grant checks
- plan entitlement checks
- quota/spend checks
- abuse/rate-limit checks
- audit-log emission
- retention policy classification
- Browser Run policy: initial URL, DNS address records, and bounded redirect
  chains must remain public HTTPS targets before cost-bearing dispatch and
  before the hosted Quick Action or Workflow-owned paid Browser Session request
  is sent; `browser.agent_task` is paid-only, capped at 20 minutes on Creator
  and 1 hour on Pro, closes after 10 minutes without meaningful action/artifact
  progress, and closes the browser in `finally` after storing a bounded artifact
  plus closure metadata in the job result and audit stream
- Browser mode policy: public-web browsing is broad by default for public HTTPS
  targets, while authenticated third-party sessions, private networks,
  Vibecodr-owned infrastructure, and provider credentials remain isolated unless
  a future explicit grant opens a narrow lane
- Browser auth boundary: hosted browser calls reject cookies, credentials,
  authorization headers, custom auth headers, storage state, sessions, or
  secrets before provider execution
- Browser Run crawl policy: bounded public crawls use the same URL/DNS guards,
  plan page/depth caps, hosted artifact retention, and usage metering as other
  browser tools
- Browser Run provider-pressure policy: provider 429 responses return queued
  jobs to a retry/defer state instead of exposing provider secrets or marking
  the job failed on first rate-limit pressure
- Hosted capacity policy: Queue consumer concurrency, Workflow-owned Browser
  Agent execution, Browser Run account caps, Sandbox account caps, and Sandbox
  container `max_instances` are aligned to a 30-active-job launch ceiling so
  plan entitlements cannot stampede the hosted Cloudflare account; Creator
  sandbox jobs route to Cloudflare `standard-1` containers with 10-minute task
  caps and Pro sandbox jobs route to `standard-2` containers with 30-minute task
  caps instead of the `lite` lane; both paid plans cap active sandbox tasks at 2
  per user
- Sandbox quota policy: monthly sandbox seconds are reserved atomically before
  queue insertion and reconciled when sandbox jobs are cancelled or reach a
  terminal state
- Sandbox egress policy: paid Agent Computer jobs can use public HTTP(S) egress
  for package installs and public docs. Private/local/link-local/metadata/
  internal CIDRs and host suffixes are denied by Cloudflare Sandbox host policy,
  HTTPS interception is enabled on the Sandbox classes, and every HTTP(S)
  request is rechecked in the outbound handler before forwarding. Raw non-HTTP
  internet stays closed by the Sandbox startup policy.
- Queue execution policy: the consumer checks current D1 job state before
  setting a queued job to running, so a job canceled before delivery is marked
  cancelled and skipped before stateless Browser Run Quick Action or Sandbox
  work starts. Queue consumers reject `browser.agent_task`; Browser Agent work is
  owned by the Cloudflare Workflow lane.
- Admission fairness policy: accepted repeat-actor jobs expose metadata-only
  queued-ahead counts without leaking payloads or adding a universal delay to
  interactive tools. Scheduled QA may still use bounded Cloudflare Queue
  per-message delays to spread due runs.
- Queue completion policy: the consumer rechecks current D1 job state after
  execution and cannot mark a job completed if cancellation was requested while
  it was running
- Retention policy: artifact retention is capped by the active plan, expired
  artifacts are hidden from list/get/download paths, and a scheduled cleanup
  removes expired R2 objects plus D1 metadata
- Artifact storage policy: uploaded and generated artifacts are checked against
  active actor storage before writes, D1 metadata insertion repeats the storage
  predicate, and newly written R2 bytes are deleted if that metadata reservation
  fails
- Artifact deletion is actor-scoped and explicit: the hosted Worker deletes the
  R2 object and D1 shelf row for the authenticated actor, and CLI deletion
  requires `--yes`

The CLI's validation is a usability and early-safety layer. It is not a
replacement for hosted enforcement.

## Open-Source Client Boundary

The public `@vibecodr/vc-tools` package is a client/control-plane helper, not
the quota or billing authority. Users can fork or edit the local CLI, local
fallback plan constants, local help text, and local development API targets, but
those edits do not change the official hosted service.

Authoritative state remains hosted:

- Vibecodr Auth verifies Clerk OAuth/API-key inputs passed through the generic
  credential path and issues scoped `vc-tools` grants.
- The hosted Tools API resolves the authenticated actor, plan, grants, and
  server-side limits.
- `/v1/usage` and the `usage.read` MCP tool expose read-only hosted account
  state. In live mode the response is marked authoritative and
  `mutableByClient: false`. User-facing usage and readiness responses stay
  account-scoped: operator alert configuration, internal binding presence,
  provider account caps, hosted account pressure, ntfy/webhook topics, and raw
  actor ids belong only on operator-scoped endpoints.
- `/v1/plans` and local fallback plan constants are packaging/reference data.
  They are not authoritative for an actor's entitlement, usage, billing, quota,
  or provider execution.
- Cost-bearing Browser Run and Sandbox work is accepted only after hosted auth,
  grant, plan, quota, audit, and reservation checks.

If a user points `VC_TOOLS_API_URL` or `--api-url` at a forked service, that
service can return different local display data. It is not Vibecodr Tools Cloud
authority and cannot spend Vibecodr provider credentials or mutate official D1,
R2, Queue, billing, grant, or usage state.

## Remaining Hosted Proofs

Local validation verifies the shipped control surface and contract behavior. A
live production release must still produce fresh smoke evidence for:

- deployed Worker secrets and routes
- D1 migrations, including actor-scope columns
- real Browser Run Quick Action execution with SSRF guards and metered-time
  usage active
- real Browser Run crawl execution with R2 artifact readback and crawl-page
  usage active
- real Sandbox execution with public HTTP(S) egress and private/internal denial
- real Pro `standard-2` Sandbox execution after the split lane is deployed
- R2 artifact download scoped to the authenticated actor
- usage/quota counters scoped to the authenticated actor
- audit rows written before cost-bearing Queue/Workflow dispatch

## Secret Handling

Do not add debug flags that print raw request headers, environment variables,
stored credentials, Cloudflare tokens, OAuth tokens, or hosted API responses
without redaction.

Clerk server secrets and the ES256 `CLI_GRANT_PRIVATE_JWK` belong only in the
parent Vibecodr API Worker secrets. The hosted Worker receives only
`VC_TOOLS_CLI_GRANT_PUBLIC_JWKS` for normal vc-tools grants, plus
`VC_TOOLS_TOKEN_SHA256`, `VC_TOOLS_INTERNAL_ALERT_TOKEN`, optional operator
alert webhook/ntfy secrets, and Cloudflare provider credentials as hosted
Worker secrets. Legacy HMAC grant secrets are beta/internal-only, require
the explicit `*_LEGACY_HMAC_ENABLED="true"` switches on both parent and hosted
surfaces, and should be removed by 2026-06-30 after live ES256 smoke and
migration. None of those values belong in source, Wrangler plaintext vars, docs,
tests, or package artifacts. Soft-cap operator alerts are account-wide capacity
signals only and must remain metadata-only: surface, capability, plan name,
current usage, included limit, percent used, and suggested action are allowed;
raw commands, target URLs, bearer tokens, provider API tokens, actor
identifiers, artifact contents, and user cookies are not. Per-user usage and
quota pressure stays in usage/COGS/audit analytics without outbound operator
notification fanout. D1 alert dedupe/reset-window rows may store capacity
metadata details and suppression counts, but not user payload contents.

The public npm artifact is a CLI/client package. Hosted Worker source,
migrations, deployment configuration, repository-maintainer docs, and
Cloudflare platform primitive packages must not be shipped as public CLI
runtime surface.
