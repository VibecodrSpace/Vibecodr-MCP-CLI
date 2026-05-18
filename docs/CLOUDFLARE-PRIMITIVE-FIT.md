# Cloudflare Primitive Fit

Last checked against Cloudflare docs: 2026-05-17.

This document records which current Cloudflare primitives belong in
`vc-tools`, and which ones are intentionally deferred. The goal is to avoid
shipping an older Durable Object mental model where Cloudflare now has a
better dynamic primitive, while also avoiding a novelty-driven replatform that
would weaken the hosted Tools Cloud boundary.

## Current Decision

`vc-tools` should use Cloudflare's newest dynamic offerings when it is loading
customer- or agent-authored Worker code at runtime. It should not use them as a
replacement for the platform-owned quota, audit, artifact, job, Browser Run, or
Sandbox control plane.

The v1 production substrate remains:

- Browser Run Quick Actions for stateless screenshots, PDFs, markdown, rendered
  HTML, and first-class bounded crawl artifacts.
- Cloudflare Workflows for durable `browser.agent_task` execution. The Workflow
  owns the long-running task lifecycle and retries, while Browser Run Sessions
  remain the browser provider inside that lane: Creator up to 20 minutes and Pro
  up to 1 hour per task, both with 10-minute idle closure and artifact output.
- Cloudflare Sandbox SDK for hosted shell/test command execution, with Creator
  on `standard-1` and Pro on `standard-2` container lanes.
- D1 for actor-scoped job, usage, audit, retention, and artifact indexes.
- R2 for artifact bytes.
- Queues plus DLQ for bounded async dispatch and retry of stateless browser,
  sandbox, scheduled QA, and other single-step jobs.
- The Sandbox SDK's required Durable Object and Container binding for sandbox
  lifecycle and process isolation.

That is not a rejection of Dynamic Workers. It is a boundary decision: Dynamic
Workers are an execution substrate for dynamically loaded Worker modules, not a
ledger, not an artifact store, not a Browser Run substitute, and not a shell
container.

## Current Cloudflare Facts

Cloudflare Browser Run is the correct browser provider, but its lanes should be
split by workflow shape:

- Quick Actions remain the best default for `vc-tools` public-web browser work
  because the hosted service can submit a bounded request, meter browser time,
  store an artifact, and avoid local browser execution.
- Browser Sessions support direct browser control and session reuse. They carry
  separate concurrency/pricing pressure and belong only inside the paid
  `browser.agent_task` lane, not the stateless Quick Actions lane.
- `/crawl` is a Browser Run Quick Action, not a Dynamic Workers feature. It
  starts an async provider crawl job and returns site records as a hosted
  artifact under `vc-tools` quota, retention, and audit.

Cloudflare Workflows are the right durable primitive for long paid browser
tasks:

- Workflow classes extend `WorkflowEntrypoint` and are bound through Wrangler
  with `name`, `binding`, and `class_name`.
- Workers create instances through the Workflow binding with an instance `id`
  and typed `params`, which maps cleanly to the existing D1 job id and queued
  job payload.
- `step.do()` provides durable execution, retry configuration, and resume from
  the last successful step instead of relying on a Queue consumer invocation.
- Cloudflare Workers limits cap Queue Consumers at 15 minutes of wall-clock
  time, while Workflows are designed for durable multi-step work. That makes
  Queue consumers a poor owner for the 20-minute Creator and 1-hour Pro browser
  agent-task lane.

Cloudflare Dynamic Workers provide a Worker Loader binding that can load Worker
code at runtime:

- `load(code)` creates a fresh Dynamic Worker for one-time execution.
- `get(id, callback)` caches a Dynamic Worker by ID so it can stay warm across
  requests.
- Dynamic Workers can be given selected bindings and can have outbound network
  disabled with `globalOutbound: null`.
- Dynamic Workers are priced by Dynamic Workers created daily, requests, and
  CPU time.

Cloudflare Durable Object Facets build on Dynamic Workers:

- A platform-owned supervisor Durable Object loads dynamic code.
- The dynamically loaded facet runs as a child of the supervisor.
- Each facet gets its own isolated SQLite database.
- The supervisor controls access and decides what requests reach the facet.

Cloudflare Dynamic Workflows add durable steps to runtime-loaded code:

- Dynamic Worker code can create Workflow instances without pre-registering
  each tenant's Workflow class.
- Workflow steps can retry, sleep, wait for events, and resume after isolate
  restarts.

Cloudflare Sandbox SDK is different:

- The Sandbox SDK is explicitly built from Workers, Durable Objects, and
  Containers.
- Its Wrangler configuration requires `containers`, a `durable_objects` binding,
  and a migration for the `Sandbox` class.
- `getSandbox()` returns a Durable Object-backed sandbox whose container starts
  lazily and can execute shell commands, manage files, expose ports, and be
  destroyed after use.

## Fit Matrix

| Need | Preferred primitive | Why |
| --- | --- | --- |
| Screenshot, PDF, markdown, rendered page inspection, bounded crawl | Browser Run Quick Actions | Stateless, Cloudflare-hosted, no Worker code loading required |
| Paid browser agent task up to 20 minutes on Creator or 1 hour on Pro | Cloudflare Workflow plus Browser Run Session | Workflow owns durable job execution/retry; Browser Session provides browser-native control with explicit close/finally behavior, 10-minute idle closure, and saved JSON artifacts |
| Shell command or test execution | Sandbox SDK | Real isolated container/process/filesystem boundary; Creator uses `standard-1`, Pro uses `standard-2` |
| Agent-authored JavaScript tool code | Dynamic Workers `load(code)` | Runtime-loaded Worker module with controlled bindings and egress |
| Reused user-defined HTTP tool/app code | Dynamic Workers `get(id, callback)` | Stable ID can keep the Worker warm and avoid reloading every call |
| User-defined durable object/reducer with private storage | Durable Object Facets | Supervisor-owned dynamic code plus isolated facet SQLite |
| Long-running user-defined workflow steps | Dynamic Workflows | Runtime-loaded code with Workflow retry/sleep/event semantics |
| Product billing, quota, audit, grants, retention, artifact index | D1 plus platform Worker logic | Needs platform-owned authority and queryability, not dynamic user code |
| Artifact bytes | R2 | Large binary/object storage, not Durable Object storage |
| Cross-user reporting and dashboards | D1 or Analytics Engine | Cross-object query/reporting plane |
| Job dispatch and retries for single-step tools | Queues plus DLQ | Simple bounded retry and backpressure path for non-agent long-running jobs |

## vc-tools Invariants

- Dynamic Workers must not receive raw Cloudflare account tokens, Stripe
  secrets, Vibecodr grant-signing secrets, D1 global authority, R2 bucket-wide
  authority, or the Browser Run API token.
- Dynamic Workers, if added, must receive only a purpose-built host proxy with
  explicit inputs, output size limits, egress policy, timeout, plan quota, and
  audit context.
- Durable Object Facets, if added, must be children of a platform supervisor
  Durable Object. The facet may own facet-local state, but it must not own
  subscription authority, grant validation, global quota, or billing.
- Cloudflare Workflows are allowed as platform-owned durable execution for
  `browser.agent_task`. Dynamic Workflows, if added later for runtime-loaded
  user code, must persist only user-defined workflow state and step outputs.
  Platform admission, quota reservation, audit, and cancellation must still
  happen before dynamic code starts.
- The Sandbox SDK Durable Object is not optional ceremony. It is part of
  Cloudflare's current Sandbox architecture and should remain while Sandbox SDK
  is the shell/test execution provider.
- For the current v1 toolset, using Dynamic Workers to replace Browser Run
  Quick Actions or Sandbox SDK would be a downgrade: Dynamic Workers do not
  provide Chrome sessions and do not provide a shell/container boundary.
- Browser access should be liberal for public HTTPS targets and strict at trust
  boundaries. Browser Run must not cross into private networks, authenticated
  user accounts, Vibecodr infrastructure, or provider secrets without an
  explicit future grant.

## Adoption Gate

Add Dynamic Workers only when at least one of these product capabilities exists:

1. `tool.dynamic_worker.run`: execute a bounded JavaScript/Worker module as a
   hosted tool.
2. `tool.dynamic_worker.app`: reuse a stable user-defined Worker by ID.
3. `tool.facet.run`: run a user-defined durable reducer/object behind a
   supervisor Durable Object.
4. `tool.dynamic_workflow.run`: run user-defined multi-step workflows that need
   retries, sleep, waits, or approvals.

Before shipping any of those capabilities:

- Add a Worker Loader binding and generated Worker types.
- Add strict module/source validation and output limits.
- Disable outbound by default with `globalOutbound: null`.
- Pass only least-privilege bindings or host proxies.
- Reserve quota before loading dynamic code.
- Record audit before and after dynamic code execution.
- Add cancellation and timeout proof.
- Add tests proving no raw platform secret, binding, D1, R2, Browser Run, or
  Sandbox authority leaks into the dynamic code.

## Current Conclusion

I agree that Cloudflare's dynamic offerings are the right future substrate for
agent-authored Worker code and user-defined durable logic. I disagree that they
should replace the current `vc-tools` v1 Browser Run/Sandbox/D1/R2/Queue shape.

The best production architecture is:

- Keep the current control plane on platform-owned Worker, D1, R2, Queue,
  Workflows, and explicit provider bindings.
- Keep Browser Run Quick Actions as the default browser lane.
- Keep Cloudflare Workflows as the durable paid `browser.agent_task` execution
  lane, with Browser Run Sessions as the browser provider inside that Workflow.
- Keep `browser.crawl_site` in that Quick Actions lane, with plan-owned page and
  depth limits.
- Keep Queues plus DLQ for stateless browser, sandbox, scheduled QA, and other
  single-step work; do not use a universal Queue fairness delay for interactive
  tools.
- Keep Sandbox SDK for command/test execution, with the paid user-facing lane
  split by plan: Creator `standard-1`, Pro `standard-2`.
- Add Dynamic Workers/Facets later as a separate, explicitly named capability
  family for supervised user-defined code, with no ambient platform authority.

## Source Links

- Cloudflare Dynamic Workers:
  https://developers.cloudflare.com/dynamic-workers/getting-started/
- Cloudflare Dynamic Workers API reference:
  https://developers.cloudflare.com/dynamic-workers/api-reference/
- Cloudflare Dynamic Workers custom limits:
  https://developers.cloudflare.com/dynamic-workers/usage/limits/
- Cloudflare Durable Object Facets:
  https://developers.cloudflare.com/dynamic-workers/usage/durable-object-facets/
- Cloudflare Dynamic Workflows:
  https://developers.cloudflare.com/dynamic-workers/usage/dynamic-workflows/
- Cloudflare Browser Run:
  https://developers.cloudflare.com/browser-run/
- Cloudflare Sandbox SDK architecture:
  https://developers.cloudflare.com/sandbox/concepts/architecture/
- Cloudflare Sandbox SDK Wrangler configuration:
  https://developers.cloudflare.com/sandbox/configuration/wrangler/
