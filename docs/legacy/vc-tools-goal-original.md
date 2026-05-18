# Browser Run on Containers vc-tools Goal

Date: 2026-05-14
Repo: `C:\Users\brade\OneDrive\Desktop\vibecodr\tools\vc-tools`
Package: `@vibecodr/vc-tools`
Binary: `vc-tools`

## Objective

Make `vc-tools` line up with the current Cloudflare Browser Run on Containers
reality while preserving Vibecodr Tools Cloud's product boundary:

- the CLI remains a local control plane for hosted work;
- Browser Run and Sandbox execution stay behind the hosted service;
- agents get broad useful public-web browser access by default;
- Vibecodr infrastructure, private networks, credentials, authenticated
  sessions, recordings, and provider secrets stay isolated unless an explicit
  future grant says otherwise;
- every changed behavior has tests, docs, and validation evidence.

Canonical product sentence:

> Broad public-web access, strict infrastructure isolation.

Useful public phrasing:

> Hosted browser checks that return artifacts: agents can inspect, render,
> screenshot, crawl, and prove public web surfaces without crossing into private
> networks, user accounts, or Vibecodr infrastructure unless an explicit grant
> exists.

## Current Cloudflare Facts

Cloudflare's 2026-05-13 Browser Run on Containers launch changes the operating
assumptions for `vc-tools`:

- Browser Run now runs on Cloudflare Containers, with higher platform capacity,
  faster Quick Actions, and no customer code migration required.
- Workers Paid Browser Sessions can run up to 120 concurrent browsers per
  account, but Browser Sessions carry separate concurrency pricing and remain
  a Pro/beta lane for Vibecodr.
- Quick Actions are still the right default for `vc-tools` v1 stateless browser
  work. They return `X-Browser-Ms-Used` for metering and are limited by
  request-rate behavior rather than Browser Session concurrency billing.
- Quick Actions have separate timeout knobs: navigation `goToOptions.timeout`
  maxes at 60 seconds, while `actionTimeout` and `PDFOptions.timeout` can go to
  five minutes.
- `/crawl` is a real Browser Run Quick Action. It starts an async provider crawl
  job, is fetched through a result endpoint, supports limits/depth/formats, and
  has its own crawler identity and bot detection ID.
- Browser Run requests self-identify with non-configurable headers and bot
  detection IDs. Vibecodr should use those signals narrowly for owned-surface
  proof/testing allowlisting, not as a general weakening of public internet
  safety policy.
- Browser Run does not bypass CAPTCHA, Turnstile, WAF, bot controls,
  `robots.txt`, or site-owner intent. Blocked targets must produce clear errors.

## User Decisions

1. Do the focused implementation pass first.
2. Make crawl first-class in this sprint, but after docs/contracts and fixes.
3. Raise Pro/value caps enough that the product does not feel artificially
   tiny, while keeping price feasibility and provider spend under Vibecodr-owned
   controls.
4. Keep Live View, HITL, recording, Playwright MCP, WebMCP, and authenticated
   browser features Pro/beta.
5. Public framing should highlight hosted checks that return artifacts, while
   leaving room for the broader truth: agents are getting a useful browser, not
   just a screenshot button.
6. The browser boundary should be broad on the public web and narrow at trust
   boundaries. The goal is not timid browsing; the goal is useful default web
   access with hard isolation around credentials, private networks,
   authenticated accounts, and Vibecodr/provider infrastructure.

## Browser Modes

### Public Web Mode

Default mode. Agents can use Browser Run for public HTTPS targets. Supported
outputs include rendered HTML, screenshots, PDFs, markdown extraction, and
bounded crawl artifacts.

Public web mode must reject:

- non-HTTPS URLs;
- localhost and private/internal/link-local/multicast/unspecified IP targets;
- URL credentials;
- hostnames that resolve to blocked network ranges;
- attempts to smuggle authenticated browser state.

### Authenticated Web Mode

Future Pro/beta mode only. A user knowingly grants access to a specific
session, account, or site. This requires explicit consent, retention policy,
recording policy, audit visibility, and a separate grant model.

This pass must not enable authenticated third-party browsing.

### Owned-Surface Mode

Internal/narrow mode for Vibecodr-owned domains. Browser Run identity signals
may be used so our own proof, QA, and testing flows are not blocked by our WAF
or bot controls.

This must never become a general bypass or a weakening of public target safety.

### Blocked Unsafe Target

When blocked, errors should say exactly why:

- "Browser tools only access public HTTPS URLs."
- "This target resolves to a private network address."
- "Browser URL credentials are not allowed."

Errors should feel factual and useful, not random or moralizing.

## Implementation Scope

### Contracts and Plans

- Add `browser.crawl_site` as a first-class capability and `browser.crawl` as
  the human alias.
- Keep Browser Run Quick Actions as the default browser lane.
- Keep Browser Sessions and interactive features Pro/beta.
- Keep Pro concurrent run packaging aligned with the parent `PLAN_LIMITS`
  SSOT while the hosted account/runtime layer is sized for 30 active jobs at
  launch.
- Split provider/account breakers from customer plan caps:
  - customer plan caps protect product packaging and spend;
  - provider/account caps protect Cloudflare account-level pressure and queue
    behavior.
  - queue consumer `max_concurrency`, Browser Run account caps, Sandbox account
    caps, and container `max_instances` all use the same 30-active-user launch
    ceiling.

### Hosted Worker

- Normalize browser tool timeouts up to the Pro 180-second product cap.
- Shape Quick Action timeout payloads correctly:
  - cap `gotoOptions.timeout` at 60 seconds;
  - pass long operation time through `actionTimeout`;
  - pass PDF operation time through `pdfOptions.timeout`.
- Add Browser Run `/crawl` Quick Action support:
  - validate the starting URL through the same public-web guard;
  - bound `limit`, `depth`, and `render`;
  - request markdown by default;
  - start the provider crawl job;
  - poll lightweight status until completion or the vc-tools timeout;
  - fetch and store a JSON crawl artifact;
  - meter browser time when `browserSecondsUsed` is returned.
- Handle provider 429s as retry/defer states instead of marking a job failed on
  first rate-limit response.
- Keep provider error payloads redacted.
- Make account-level hosted, Browser Run, and Sandbox caps configurable through
  `VC_TOOLS_*` environment variables with conservative defaults, and emit
  sanitized operator alerts to email/ntfy/webhook fanout when a soft cap is
  crossed.

### CLI

- Allow browser tool test timeout flags up to 180 seconds.
- Submit canonical crawl payloads from `vc-tools tools test browser.crawl ...`.
- Expose crawl in help and stable capability metadata.
- Continue rejecting unsafe browser targets locally before remote calls.

### Docs

- Update API contract with the 2026-05-14 Cloudflare assumptions.
- Document public-web mode, authenticated-web future mode, owned-surface mode,
  and blocked-target copy.
- Update `docs/VALIDATION-MATRIX.md` for crawl, timeout shaping, provider 429
  retry/defer handling, split caps, and Pro plan changes.
- Update primitive-fit docs so Browser Run on Containers strengthens the Quick
  Actions default instead of pushing `vc-tools` toward local browser execution
  or Dynamic Workers.
- Keep wording away from "safe cloud hands and eyes"; it does not match the
  current Vibecodr/vc-tools brand direction.

## Validation Plan

Required local validation for this pass:

- `git rev-parse --show-toplevel` must print the standalone `vc-tools` repo.
- `npm test`
- `npm run check`
- `git diff --check`

Targeted behaviors to prove with tests:

- `browser.crawl` aliases to `browser.crawl_site` and submits a canonical
  hosted payload.
- Browser Quick Action requests cap navigation timeout at 60 seconds while
  preserving the requested operation timeout.
- `/crawl` starts, polls, stores an artifact, and writes browser-minute usage
  when provider browser seconds are present.
- Browser Run provider 429 responses leave the job retryable/deferred instead
  of failed.
- Pro plan concurrent runs stay aligned to the Vibecodr plan SSOT while Browser
  Session caps stay Pro/beta.
- Hosted, Browser Run, and Sandbox soft-cap crossings emit metadata-only
  operator alerts without raw commands, target URLs, or actor identifiers.
- Existing unsafe URL, DNS, secret-redaction, sandbox-no-local-execution, quota,
  audit, cancellation, artifact, and JSON/exit-code contracts still pass.

Hosted-required validation after deployment:

- Apply D1 migrations if needed.
- Ensure `VC_TOOLS_BROWSER_RUN_ACCOUNT_ID` and
  `VC_TOOLS_BROWSER_RUN_API_TOKEN` are set.
- Ensure `VC_TOOLS_INTERNAL_ALERT_TOKEN` is set, internal-api accepts
  `E-VIBECODR-VC-TOOLS-SOFT-CAP`, and ntfy/email delivery is configured on the
  internal alert fanout.
- Deploy the hosted Worker.
- Smoke `https://tools.vibecodr.space/v1/health`.
- Run an authenticated real Browser Run render/screenshot job.
- Run an authenticated real Browser Run crawl job.
- Confirm R2 artifact readback, usage counters, quota denial, audit rows, and
  clear blocked-target errors.

## Done Means

- This file exists and is aligned with code/docs.
- The repo exposes crawl as a first-class capability without local execution.
- Browser Run timeouts match Cloudflare's current independent timer model.
- Product caps and provider caps are separate and documented.
- Public-web browser access is liberal enough to be useful and strict at
  infrastructure/account boundaries.
- All required local validation passes, or any remaining hosted-only dependency
  is stated plainly.

## 2026-05-15 Continuation Evidence

- Added an account-only Cloudflare spend anomaly lane:
  `E-VIBECODR-VC-TOOLS-CLOUDFLARE-SPEND-ANOMALY` /
  `cloudflare.estimated_spend_usd`.
- The hosted scheduled Worker estimates current-month raw Cloudflare usage cost
  from aggregate vc-tools meters: Browser Run minutes, plan-split Sandbox
  minutes, crawl pages, and active artifact GB-month exposure.
- Per-user COGS, quota denials, and unsafe URL denials remain analytics-only;
  only aggregate platform/account spend pressure can fan out to operator
  channels.
- Parent internal-api now allowlists the new account-scoped alert code while
  still filtering all `source=vc-tools` payloads with `details.scope="user"`.
- This alert is an internal early warning. Operators must compare it with
  Cloudflare Billable Usage / Budget Alerts before treating it as billing truth.
- Targeted validation passed:
  `npm test -- --test-name-pattern "Cloudflare spend|public health"`,
  `npm run check:worker`, and
  `pnpm --filter vibecodr-internal-api exec vitest run src/handlers/outboundAlerts.test.ts --testNamePattern "Cloudflare spend|account-wide"`.
