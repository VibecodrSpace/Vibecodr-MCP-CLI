# vc-tools Agent Toolkit RFC

Status: draft
Owner: vc-tools
Last updated: 2026-05-16

This RFC captures the current product and architecture decisions for `vc-tools`
as a standalone agent toolkit. It is intentionally not a Vibecodr build/remix
RFC. Vibecodr may use `vc-tools`, and Vibecodr subscriptions may bundle
`vc-tools`, but the toolkit must make sense for agents doing work outside the
Vibecodr product surface.

This is a planning document for the next compute phase of the existing
`vc-tools` product, not a redesign from scratch. The live service already has
Browser, Sandbox/Compute, Jobs, Artifact Shelf, Grants, Usage, CLI/API/MCP,
quotas, retention, and hosted boundaries. E2B is the intended execution
provider for Pro Saved Computers and hosted Pro goal-run work. Creator compute
stays on the existing Cloudflare sandbox path unless Braden explicitly approves
a separate product change.

This document does not claim the live service has already moved to E2B. The
current production contract remains documented in `docs/API-CONTRACT.md` and
`docs/CLOUDFLARE-PRIMITIVE-FIT.md` until implementation, migration, and
production smoke evidence update those files.

## Primitives

`vc-tools` should be understood as a small set of durable primitives that agents
can use to get real work done.

The governing product test is:

> Code should be easier to share, use, and interact with.

Every system added to `vc-tools` should be judged by whether it makes that
sentence more true. If it does, keep going. If it only makes the architecture
more impressive, cut it, hide it, or defer it.

| Primitive | User-facing language | Provider / owner | Purpose |
| --- | --- | --- | --- |
| Browser | Agent browser | Cloudflare Browser Run | Let an agent inspect public web targets, render pages, capture screenshots, extract markdown, render PDFs, crawl bounded sites, and produce browser evidence. |
| Computer | Agent computer | Hosted `vc-tools` control plane; Creator one-shot compute stays on Cloudflare sandbox, while Pro Saved Computers and hosted Pro goal runs use E2B | Give an agent a real isolated Linux computer for commands, files, tests, package installs, tools, previews, and generated outputs. |
| Jobs | Agent jobs | `vc-tools-api`, D1, Queue, DLQ | Make tool work durable, async, cancellable, retryable, inspectable, and safe to queue under load. |
| Artifacts | Artifact Shelf / saved work outputs | R2 plus D1 metadata | Store automatic tool-result artifacts plus outputs the user or agent intentionally saves from browser or computer work. |
| Goals | Goal / work objective | Goal Durable Object plus D1 read model | Group jobs, artifacts, checkpoints, usage, and completion state around one user or agent objective. |
| Grants | Tool permissions | Vibecodr auth grants scoped to `vc-tools` | Let users and workspaces decide what an agent can do without exposing provider credentials or broad product authority. |
| Usage | Agent work capacity | Vibecodr subscription entitlement plus `vc-tools` meters | Bundle tool capacity into Vibecodr plans while preserving provider-cost controls, fair use, and hard caps. |
| API / CLI / MCP | Toolkit surfaces | `@vibecodr/vc-tools`, hosted HTTP API, remote MCP | Let humans, agents, scripts, and MCP clients call the same hosted toolkit through stable interfaces. |

The public language should lead with Browser, Computer, Jobs, Artifacts, Grants,
and Usage. "Sandbox", "E2B", "Cloudflare", "Browser Run", "containers", and
"provider credits" are implementation or operator terms unless the audience is
technical and explicitly asking for substrate details.

## Decisive Decisions So Far

1. `vc-tools` is an agent toolkit. Period.

2. `vc-tools` is bundled with Vibecodr subscriptions, but it is not dependent on
   Vibecodr builds, the Vibecodr feed, remix lineage, or the social runtime.

3. `vc-tools` is not the existing Vibecodr CLI, not `vibecodr-mcp`, and not
   `@vibecodr/cli`. It is the standalone `@vibecodr/vc-tools` package with the
   `vc-tools` binary.

4. The existing Vibecodr CLI should remain the product-specific control plane
   for Vibecodr workflows. `vc-tools` should own agent toolkit workflows:
   browser, computer, jobs, artifacts, grants, usage, diagnostics, and tool
   tests.

5. The phrase "attached to every build" is rejected for `vc-tools` positioning
   because it ties the toolkit too tightly to Vibecodr builds. Vibecodr builds
   may become one target type later, but they are not the product center.

6. Browser stays on Cloudflare Browser Run because Browser Run is the better
   browser product for `vc-tools`: Quick Actions, Browser Sessions, screenshots,
   PDFs, markdown extraction, crawl, Playwright/Puppeteer/CDP, and browser MCP
   patterns.

7. The hosted shell/test execution lane should move from "sandbox" language to
   "agent computer" product language without collapsing every plan onto the
   same provider. Creator one-shot compute remains on the existing Cloudflare
   sandbox path. Pro Saved Computers and hosted Pro goal-run work move toward
   E2B because E2B maps cleanly to a real isolated computer for an agent: Linux
   environment, commands, files, tools, templates, lifecycle, and persistence.

   This is an expansion of the existing Compute/Sandbox primitive, not a
   replacement for Browser, Jobs, Artifact Shelf, Grants, Usage, or the hosted
   `vc-tools` control plane.

8. The agent computer should not be marketed as E2B credits, sandbox minutes,
   container time, or infrastructure resale. Users buy agent work capacity and
   useful toolkit outcomes. Provider seconds remain internal meters.

9. The public product should not say "E2B powers this" in core copy. Provider
   language belongs in internal architecture, security/legal/subprocessor, and
   operator documentation. The user-facing primitive is the `vc-tools` Agent
   Computer.

10. The primary product object is an agent job, not a Vibecodr build. A job can
   target a URL, command, test suite, repo, uploaded project, generated file
   task, future saved computer, or later a Vibecodr build.

11. `vc-tools` is where a user's agent can actually get work done. The core
    promise is not "debug your app"; it is "give your agent tools, a browser, a
    computer, artifacts, and proof."

12. Goals are approved only as a continuation-capable coordination primitive. A
    goal groups jobs, artifacts, checkpoints, usage, budget, and completion
    state around an objective. Goals do not replace Browser, Agent Computer,
    Jobs, or Artifact Shelf; they organize work across those primitives.

13. A tracking-only `goals.*` protocol is not a finished product phase. It may
    exist as compatibility plumbing, but the first product-grade Goals release
    must include a runner that can keep an agent working until the goal is done,
    paused, blocked, abandoned, or budget-limited.

14. Hosted long-running Goals are a Pro-only post-E2B capability. Pro active goal
    runs should not inherit the short one-shot compute cap while meaningful work
    is happening. They are bounded by account limits, plan budget, concurrency,
    provider runtime ceilings, abuse controls, and user/operator stop controls.
    If the provider has a continuous-runtime ceiling, the runner should
    checkpoint, pause/resume, or rotate safely instead of treating wall-clock
    timeout as product completion.

15. Browser and computer are separate primitives. The browser is for seeing and
    verifying web surfaces. The computer is for executing and changing things.
    They can cooperate inside one agent job, but neither should swallow the
    other.

16. Cloudflare remains the hosted control plane for `vc-tools`: auth admission,
    grants, quota, D1 job and usage state, R2 artifacts, Queue/DLQ, audit,
    Browser Run integration, MCP/API routes, computer identity, saved-computer
    ownership, plan eligibility, expiry policy, and durable platform metadata.

17. E2B should be treated as the external execution plane for Pro Agent
    Computers, not as the source of truth for product identity, quota, billing,
    artifacts, grants, ownership, session identity, or retention policy.

18. Provider secrets and platform authority stay grant-gated. Agents must not
    receive raw Cloudflare tokens, E2B API keys, E2B sandbox access tokens,
    traffic access tokens, Vibecodr grant-signing secrets, raw Clerk
    credentials, or broad D1/R2 authority.

19. The first public vocabulary should be capability/outcome-oriented:
    "browser", "computer", "job", "artifact", "proof", "grant", and "usage".
    The implementation can retain compatibility aliases for existing
    `sandbox.*` capabilities while the product language moves to
    `computer.*`.

20. Agent Computers are broad working environments. Do not over-limit what the
    agent can do inside its own computer beyond OS permissions, plan limits,
    quota, network policy, abuse controls, and secret handling. Put stricter
    friction at durable export boundaries instead.

21. Pro E2B-backed Agent Computers should have public outbound internet access
    by default in the post-E2B v1 compute lane. Creator Cloudflare sandbox
    compute keeps its current network policy unless changed in a separate
    Creator-specific release. This is distinct from Browser Run: Browser Run
    remains the browser product for agents and humans; public internet inside
    the Agent Computer is for the agent's compute environment.

22. Computer persistence is a Pro-only product capability called Saved
    Computers. Free gets no Agent Computer. Creator remains on Cloudflare
    one-shot sandbox compute and should not see a locked Save Computer
    affordance during the task flow.

23. A Pro user's default Agent Computer is account-attached unless the user
    explicitly asks for a scratch, project, or otherwise separate computer. Pro
    includes one primary Saved Computer by default. Additional Saved Computers,
    project computers, or scratch computers are separate plan/add-on/future
    packaging decisions and must not blur the primary account-attached device
    promise.

24. Pro Saved Computers should auto-pause after 10 minutes of inactivity or
    sandbox timeout instead of being killed. Active Pro goal runs should not
    auto-pause merely because they pass a short wall-clock timeout; they should
    continue while meaningful work is happening and account limits allow it. The
    product expectation is that a user can walk away, the agent can keep working,
    and the computer sleeps only when work goes idle, finishes, stalls, is
    paused, or hits a limit. For Pro Saved Computers, automated cleanup means
    pause, reconcile, repair, or export guidance; it must not mean kill while the
    subscription and safety posture are valid.

25. Permanent kill of a Pro Saved Computer is reserved for explicit user delete,
    explicit reset/discard, plan/account lifecycle with clear notice or export
    window, abuse/security/legal action, or unrecoverable provider failure.
    Passive inactivity alone is not a kill reason for an active Pro subscriber.

26. Artifact Shelf has two modes: automatic tool-result artifacts and explicit
    user/agent saves. Hosted jobs may automatically store bounded result
    artifacts such as browser outputs, crawl results, command logs, and closure
    metadata. Arbitrary computer files are saved to Shelf only when the user or
    agent explicitly chooses to save them.

27. Save to Shelf can happen at any time during an Agent Computer run. The UX
    and DX must make it easy for an agent or user to save a specific file path
    from the computer into the Shelf.

28. Every Agent Computer run keeps a lightweight job record and short final
    summary even when no files are saved to the Shelf.

29. Agent Computers should not teach or require a `/workspace` concept. The
    product model is the computer itself. Use E2B's native `/home/user` home as
    the default working location, displayed as `~`, with simple conventional
    folders such as `~/project`, `~/outputs`, and `~/notes`.

30. Sensitive, hidden, credential-like, cache-heavy, or system-path Shelf
    exports are allowed, but require double confirmation with an explicit
    warning, reason, and audit record. The computer is liberal; durable export is
    deliberate.

31. For v1, sensitive/system Shelf export requires human approval unless the
    user has granted a specific sensitive-export permission to that agent,
    project, or workspace.

32. Setup must be zero-code for the primary user path. Users should not need to
    write config files, edit MCP JSON, understand templates, paste provider API
    keys, set environment variables, manage sandbox ids, choose base images, or
    install agent runners manually just to give their agent a computer.

33. The intended setup path is: install `vc-tools`, log in to Vibecodr, start a
    computer, connect the provider account or subscription the agent will use,
    then set the job or goal. Advanced configuration can exist, but it must be
    inspectable output from the setup flow, not the setup flow itself.

34. Provider login should feel like account connection, not infrastructure
    configuration. `vc-tools` should prefer provider-supported OAuth, device
    login, browser login, or guided in-computer login flows over raw API-key
    entry. Any provider credentials or runner session state must stay inside the
    approved secure boundary for that computer/profile and must not become
    visible CLI config by default.

35. Agent Computers can emit UI through temporary previews. A preview is an
    owner-scoped view of a service running inside the computer, not publishing,
    deployment, or public sharing.

36. Computer Preview is distinct from Browser Run. Computer Preview shows what
    the agent is running inside the computer. Browser Run remains the browser
    product for inspection, screenshots, PDFs, crawl, and browser-native
    verification.

37. Public preview links and durable publish/deploy are consequence boundaries.
    Private preview can be normal; public sharing and publishing require
    explicit user intent and policy-controlled grants.

38. Cost protection should be hard in the control plane and soft in the normal
    user experience. Normal agent work should not require repeated approvals,
    but every cost-bearing provider action must pass entitlement, quota,
    concurrency, budget, abuse, and operator-state checks before it starts.

39. Auto-pause is the primary cost-saving lifecycle behavior for Pro Saved
    Computers. Saved Computers sleep after 10 minutes of inactivity/timeout
    instead of being killed. Auto-resume stays off by default so passive traffic
    cannot wake a computer and spend money without an intentional user or
    authorized agent action through `vc-tools`.

40. Active Pro Goal Runs use renewable work leases rather than short wall-clock
    caps. A runner can keep working while it renews meaningful progress within
    account limits; if progress stalls, the goal becomes paused or `needs_human`
    and the computer auto-pauses instead of burning quietly.

41. Disposable one-shot computers remain aggressively bounded. Creator
    Cloudflare sandbox jobs stay in this category. They should kill on
    completion, cancellation, failure, or timeout, and they should not persist
    provider state unless the product path explicitly promotes eligible Pro work
    to a Saved Computer or saves specific outputs to Shelf.

## Product Canon

Internal canon:

> `vc-tools` is the hosted toolkit for agents. It gives agents a browser, a
> computer, durable jobs, artifacts, and scoped permissions. It is bundled with
> Vibecodr, but it is not dependent on Vibecodr.

Public canon:

> Give your agent a browser, a computer, and a place to put the work.

Computer canon:

> You have your computer. Give your agent theirs.

Setup canon:

> Install. Log in. Start a computer. Sign in to your agent provider. Give it
> the job.

Shorter positioning options:

- `vc-tools` is where your agent gets work done.
- Browser. Computer. Artifacts. Jobs. For agents that need to actually do
  things.
- Give your agent tools, not just prompts.
- Included with Vibecodr. Useful wherever your agent works.

Avoid as primary `vc-tools` positioning:

- Attached to every build.
- Every build gets an agent computer.
- Vibecodr's remix engine.
- E2B credits.
- Sandbox minutes.
- Cloudflare container time.
- A local execution wrapper.

## Surface Separation

| Surface | Product role | Should own | Should not own |
| --- | --- | --- | --- |
| Existing Vibecodr CLI / `@vibecodr/cli` | Vibecodr product control plane | Vibecodr-specific product workflows such as product auth, project/source/publish/runtime commands, and future product-specific diagnosis | Browser Run, E2B computers, general-purpose agent jobs, artifact shelves, or generic agent toolkit commands |
| `vc-tools` / `@vibecodr/vc-tools` | Agent toolkit control plane | Browser, computer, jobs, artifacts, grants, usage, diagnostics, remote MCP connection metadata, and tool tests | Vibecodr product publishing authority, product runtime internals, or local execution of hosted work |
| Vibecodr MCP / MCP CLI | Agent-facing Vibecodr product integration | Vibecodr-specific agent actions and product workflows | Owning the generic browser/computer/artifact/job primitives |

If the Vibecodr CLI or Vibecodr MCP needs agent toolkit behavior, it should call
or guide users to `vc-tools` instead of reimplementing those lanes.

## Existing Contract To Preserve

The E2B work is a compute-layer expansion. It must preserve the existing
`vc-tools` product contract unless Braden explicitly approves a separate product
change.

- Browser stays on Cloudflare Browser Run.
- Browser Run serves agents and humans that need browser-native work:
  rendering, screenshots, markdown extraction, PDFs, bounded crawl, and
  longer paid browser tasks.
- Agent Computer networking is for the agent's compute environment. It does not
  replace Browser Run and should not be sold as the browser product.
- Jobs remain D1/Queue/DLQ-backed, async, inspectable, cancellable, and
  quota-reserved before cost-bearing provider work.
- Artifact Shelf remains R2 bytes plus D1 metadata, with ownership, retention,
  quota, deletion, expiry, and storage accounting.
- Grants remain the permission model for tool capability, network expansion,
  preview/public exposure, sensitive export, and future computer features.
- Usage remains hosted authority: credits, browser time, computer time,
  artifact storage, active job counts, account-level caps, and operator alerts.
- CLI/API/MCP remain control-plane surfaces. The CLI must not become a local
  execution wrapper around browser or computer work.
- Existing `sandbox.*` capabilities remain compatibility surfaces while
  `computer.*` becomes the product language for the next compute phase.
- Creator one-shot compute is explicitly not part of the E2B provider swap.
  Creator stays on the current Cloudflare sandbox implementation, including its
  current 10-minute bounded compute run shape and no Saved Computer
  persistence.
- Pro one-shot/scratch compute can remain bounded, but the Pro product center is
  the account-attached E2B Saved Computer. Pro gets a primary Saved Computer by
  default; extra/scratch/project computers are explicit future packaging, not
  the normal device model.
- Pro hosted goal runs are a separate post-E2B lane. They should not have a
  short wall-clock cap while the agent is actively working; they are limited by
  account entitlement, goal budget, plan concurrency, provider runtime ceilings,
  provider spend controls, abuse controls, and explicit user/operator stop
  actions.
- Cost protections stay in the hosted control plane. The user should experience
  generous agent work, not provider-budget anxiety, until work approaches a real
  limit or consequence boundary.

## Capability Vocabulary

The current contract already has shipped `sandbox.*` capabilities. The product
language should move toward `computer.*` without breaking old clients.

Near-term compatibility:

| Existing capability | Product alias | User-facing label |
| --- | --- | --- |
| `sandbox.run_command` | `computer.run` | Run on agent computer |
| `sandbox.run_tests` | `computer.test` | Test on agent computer |

Future computer capabilities:

| Capability | Purpose |
| --- | --- |
| `computer.run` | Run one bounded command or script in a clean hosted computer. |
| `computer.test` | Run a test command and return structured output plus artifacts. |
| `computer.files` | Read/write/list scoped files in a task computer or saved computer. |
| `computer.preview.start` | Start or expose a private owner-scoped preview for a service running inside the computer. |
| `computer.preview.status` | Report preview URL/handle, port, visibility, owner access state, and expiration without leaking provider tokens. |
| `computer.preview.stop` | Stop or revoke a running computer preview. |
| `computer.session` | Create or resume a longer-lived computer session when the plan and grant allow it. |
| `computer.snapshot` | Save or branch a computer state only when the product contract needs it. |
| `computer.mcp` | Expose a controlled MCP gateway/toolbelt inside a computer. |

Future setup-facing capabilities:

| Capability | Purpose |
| --- | --- |
| `provider.connect` | Start a guided provider login/account-connection flow for an agent runner. |
| `provider.status` | Show whether a provider is connected for a computer/profile without exposing secrets. |
| `provider.disconnect` | Remove a provider connection or runner session from a computer/profile. |

Future Shelf-facing aliases:

| Capability | Purpose |
| --- | --- |
| `shelf.save` | Save a specific browser output, uploaded file, or Agent Computer file path into the Artifact Shelf. |
| `shelf.get` | Read a saved Shelf artifact subject to ownership, grants, and retention. |

Future Goal-facing capabilities:

| Capability | Purpose |
| --- | --- |
| `goals.create` | Create an active goal with objective, optional budget, and optional verification expectation. |
| `goals.get` | Read the goal status, budget burn, checkpoints, linked jobs, and linked artifacts. |
| `goals.checkpoint` | Append a user-facing progress checkpoint with label, evidence, job ids, and artifact ids. |
| `goals.complete` | Mark a goal complete with summary, evidence, and final budget report. |

Future usage-facing capabilities:

| Capability | Purpose |
| --- | --- |
| `usage.status` | Show plan capacity, current usage, active reservations, and approaching limits in user-readable terms. |
| `usage.limits` | Return machine-readable plan limits for agents without exposing provider cost internals. |

The implementation and security docs may continue to say "sandbox" where that
is the correct isolation term. Public docs, CLI help, and product pages should
prefer "computer" for the E2B-backed primitive.

## Offering Map

`vc-tools` should break primitives into offerings that work for technical and
non-technical developers.

| Offering | Non-technical phrasing | Technical phrasing |
| --- | --- | --- |
| Quick Check | Check this page and bring back proof. | Browser Run Quick Action with URL validation, quota reservation, R2 artifact, and D1 usage. |
| Agent Browser | Let the agent inspect a site. | Browser Run Session with bounded instructions, idle closure, artifacts, and audit. |
| Creator Sandbox | Run a bounded task in the hosted sandbox. | Existing Cloudflare sandbox one-shot compute with current Creator limits and no Saved Computer persistence. |
| Pro Agent Computer | Let the agent use its own cloud computer. | Account-attached E2B Saved Computer with commands, files, templates, lifecycle, private preview, pause-first persistence, and strict server-side tokens. |
| Computer Preview | See what the agent is running. | Private owner-scoped preview handle for a service running on a port inside the Agent Computer. |
| Provider Connection | Sign in to the AI account your agent uses. | Guided provider auth/profile setup with generated runner config, secure token/session handling, and no required hand-written config. |
| Test Run | Run the tests and show what failed. | Bounded command/test execution with stdout/stderr artifact, exit code, duration, and usage meter. |
| Save to Shelf | Save this file so it survives the computer. | Explicit artifact write from browser output, uploaded file, or agent computer file path into R2 with D1 metadata. |
| Durable Job | Start the work and check back. | Queue/DLQ-backed job with D1 status, retry, cancellation, and capacity controls. |
| Pro Goal Run | Give the agent the job and let it keep working. | Pro-only hosted runner inside an E2B Agent Computer, bounded by account limits and Goal DO state instead of a short wall-clock cap. |
| Tool Grant | Let the agent do only this kind of work. | Scoped grant claims with `vc-tools:*` or per-tool scopes and plan-derived limits. |

## Zero-Code Setup Doctrine

The primary setup experience must be product onboarding, not developer
configuration. The user should not need to know that the computer is an E2B
sandbox, that a runner needs MCP configuration, or that provider session files
exist. This doctrine applies to the Pro Agent Computer path. Creator's bounded
Cloudflare sandbox jobs should remain simple one-shot tool calls and must not
grow a fake locked-device onboarding flow.

Happy path:

```text
install vc-tools
vc-tools login
vc-tools computer start
connect provider
set goal
walk away
```

The CLI and dashboard should guide the same flow:

- `vc-tools login` authenticates the user through Vibecodr.
- `vc-tools computer start` creates or resumes an eligible computer and opens a
  guided setup surface when required.
- The setup flow lets the user choose or connect the agent provider account they
  already pay for.
- `vc-tools` installs or verifies the runner inside the computer from a managed
  template/profile.
- `vc-tools` generates any MCP config, runner config, env files, token files, or
  provider session wiring behind the scenes.
- The user sees connection state, plan limits, last activity, and the next
  action, not raw JSON.

Advanced configuration can exist for technical users, but it should be a
secondary inspect/edit/export surface. The normal path should never require:

- hand-written MCP JSON
- hand-written provider config
- copying provider API keys into shell commands
- choosing base images or templates
- editing `.env` files
- knowing E2B sandbox ids
- installing the agent runner manually
- understanding Cloudflare, E2B, Browser Run, D1, R2, Queues, or Durable Objects

Provider connection policy:

- Prefer provider-supported OAuth, device login, browser login, or guided
  in-computer login.
- Treat provider login as an account/profile connection, not a code task.
- Keep provider credentials and runner session state out of default CLI-visible
  config.
- Store only status, profile metadata, and revocation handles in Cloudflare
  platform state unless a provider flow explicitly requires otherwise.
- Keep provider-specific session files inside the Saved Computer or encrypted
  provider vault according to the final security design and provider terms.
- If raw API-key entry is unavoidable for a provider, label it Advanced and make
  the safer guided login path the default.

## Architecture Direction

The provider split should be:

- Browser stays on Cloudflare Browser Run.
- Creator one-shot sandbox/compute stays on the current Cloudflare sandbox
  provider path.
- Pro account-attached Agent Computers and hosted Pro goal runners move to E2B
  through a hosted provider boundary.
- `vc-tools-api` remains the authoritative control plane.
- D1 remains the job, quota, usage, audit, grant-derived status, and artifact
  metadata store.
- R2 remains the artifact byte store.
- Queue/DLQ remains the async dispatch and retry lane.
- Vibecodr subscription state remains the entitlement source.

For Cloudflare Workers, the E2B integration should start from REST/API calls,
not the E2B JavaScript SDK, unless current docs or a live build prove Worker
compatibility. E2B's Worker/Edge troubleshooting page currently says the JS SDK
does not support Cloudflare Workers because of sandbox transport dependencies.

Preferred Worker integration path:

> Option A: Direct REST from the Worker for everything.

Use `fetch()` from the hosted Worker to `api.e2b.app` for sandbox lifecycle, and
use `fetch()` to the sandbox's envd HTTP endpoints for commands and files. If
envd is callable from Workers over HTTP, this avoids a proxy, sidecar, or extra
infrastructure layer.

Phase 2 must prove this with a real spike before adding more infrastructure:

- create a live E2B sandbox from a Cloudflare Worker using REST
- call an envd command endpoint such as `POST /process/start` from that Worker
- prove stdout/stderr/result retrieval works
- prove file read/write over envd works or record the exact blocker
- prove timeout, cancellation/kill or pause, and provider-error handling shape
- prove no provider token or envd access token leaks to client/browser state

If this spike works, direct Worker REST remains the implementation direction.
Only introduce a proxy, sidecar, Node service, or extra infra if the real spike
proves the Worker cannot directly call the lifecycle/envd surfaces safely.

Provider boundary target:

```text
Hosted tool request
  -> auth and grant validation
  -> plan and quota reservation
  -> audit-before-cost event
  -> Queue job
  -> provider-specific worker path
       browser.*   -> Cloudflare Browser Run
       computer.*  -> route by plan/provider policy
          Creator one-shot -> Cloudflare sandbox provider
          Pro Saved/scratch/operator -> E2B REST/API
  -> artifact storage in R2
  -> D1 usage/job reconciliation
  -> user/agent receives result handles, not provider credentials
```

## Compute Provider Policy

There are two compute lanes after the refactor. They share the hosted
`vc-tools` control plane, grants, usage accounting, artifact rules, and stable
CLI/API/MCP surfaces, but they do not share the same provider or lifecycle
promise.

| Lane | Eligibility | Provider | Lifecycle promise |
| --- | --- | --- | --- |
| Creator one-shot sandbox | Creator | Current Cloudflare sandbox path | Bounded one-shot run; kill/cleanup on completion, failure, cancellation, or timeout |
| Pro Saved Computer | Pro | E2B | Account-attached primary computer; pause on idle, resume through `vc-tools`, never automated idle-kill while the subscription and safety posture are valid |
| Pro scratch/project computer | Pro or future Team/Add-on | E2B when offered | Explicitly requested separate computer with its own lifecycle contract |

The E2B lane is the Pro implementation of the Agent Computer primitive. It
should preserve the current hosted control plane while expanding what the
compute environment can do.

The E2B-backed Agent Computer lane should preserve these defaults:

- Server-side `E2B_API_KEY` only.
- Secure sandboxes by default.
- No raw `envdAccessToken`, traffic access token, MCP gateway token, or sandbox
  host token in browser-visible state.
- Pro E2B-backed Agent Computers have public outbound internet access by default for the
  agent's compute environment.
- Public outbound internet does not mean private/internal reach. `vc-tools`
  should block private networks, localhost outside the computer, link-local and
  metadata endpoints, Vibecodr/provider internal infrastructure, public inbound
  exposure, and abuse patterns unless an explicit future grant opens a narrow
  lane.
- Public preview URLs only through an explicit future product policy.
- Creator Cloudflare sandbox jobs and other disposable one-shot computers
  should kill on completion by default.
- Disposable one-shot computers should not auto-resume.
- Pro Saved Computers should use E2B lifecycle auto-pause:
  `timeoutMs: 10 * 60 * 1000` with `lifecycle.onTimeout: "pause"`.
  Timeout should sleep the computer instead of deleting state.
- Pro Saved Computers are account-attached by default. A separate scratch,
  project, or disposable computer must be an explicit user/product choice, not
  the silent default.
- Auto-pause is a Saved Computer behavior, not an implicit persistence promise
  for every disposable compute job.
- Auto-resume should stay off by default unless separately approved. The user or
  agent should resume through the `vc-tools` control plane so Cloudflare-owned
  plan, quota, activity, and audit state stay authoritative.
- Active hosted goal runs must hold a renewable work lease in the Goal DO. If
  the lease expires, new cost-bearing actions are denied and the computer should
  pause rather than continue burning provider time invisibly.
- Automated cleanup must not kill a Pro Saved Computer solely because it is idle
  or old. It may pause, repair, reconcile, prompt the user, or follow explicit
  account-lifecycle/export policy. Permanent kill requires explicit delete/reset,
  abuse/security/legal action, or unrecoverable provider failure.
- Snapshots should be a separate product capability, not implicit behavior for
  every command.
- E2B filesystem, volumes, and snapshots are execution-plane state, not
  `vc-tools` source of truth. Durable user-visible outputs must be promoted into
  R2/D1.
- Every cost-bearing computer job must have D1 reservation, audit, capacity
  gating, timeout, cancellation, artifact, and reconciliation behavior.

## Browser Versus Computer Network

Browser Run and Agent Computer internet are separate product surfaces:

| Surface | User | Default purpose | Provider |
| --- | --- | --- | --- |
| Browser Run | humans and agents | Browser-native public-web work: render, screenshot, PDF, markdown, crawl, and longer browser tasks | Cloudflare Browser Run |
| Creator sandbox internet | agents | Existing bounded one-shot compute behavior | Cloudflare sandbox path |
| Pro Agent Computer internet | agents | Compute-environment internet: package installs, git, public docs, public APIs, downloads, and tool execution inside the computer | E2B-backed Agent Computer |

The product line should be:

> Browser Run is the browser. Agent Computer internet is the agent's computer
> network.

This avoids ripping out or duplicating Browser Run. It also prevents the Agent
Computer from becoming a browser automation product just because it can reach
the internet.

## Agent Computer Preview

Agent Computers can emit UI by running services inside the computer and exposing
them through a policy-controlled preview handle.

User-facing rule:

> Computer Preview lets you see what your agent is running inside its computer.

Product boundary:

| Surface | Meaning | Default stance |
| --- | --- | --- |
| Private computer preview | Temporary owner-scoped view of a service running inside the Agent Computer | Allowed when the plan/grant allows previews |
| Browser Run verification | Browser product inspects or screenshots the preview for evidence | Allowed through Browser Run |
| Public preview link | Anyone with a link can view the temporary running service | Requires explicit user action and a future sharing policy |
| Publish/deploy | Durable external availability outside the Agent Computer | Separate stronger consent boundary |
| Desktop view | Full graphical view/control of the computer | Later Pro/Studio feature, not required for v1 preview |

Default preview policy:

- The agent may start a local web server or UI process inside the computer.
- `vc-tools` may detect or accept a port and create a private preview handle.
- The preview should be owner-scoped by default and routed through `vc-tools` or
  another token-gated boundary so raw provider URLs and traffic tokens are not
  exposed as the normal UX.
- Preview state should show service status, port, visibility, owner access,
  expiration, and revoke/stop controls.
- Preview traffic alone should not silently keep a Pro Saved Computer running
  forever. Owner activity can renew the interactive session, but public or
  background traffic should be time-bound and should not bypass the computer's
  idle/limit policy.
- Private preview is not public sharing, publishing, hosting, or deployment.
- Public preview links require explicit user intent and a policy-controlled
  grant.
- Durable publish/deploy requires a separate stronger consent flow.
- Browser Run remains the verification partner for previewed web surfaces.

## Goals Coordination Primitive

Goals are a future coordination layer above VC Tools jobs. They organize hosted
work around an objective without replacing Browser Run, Agent Computers, Jobs,
Artifact Shelf, Grants, or Usage.

Goals answer:

- what the agent is trying to accomplish
- whether the work is active, complete, paused, budget-limited, or abandoned
- what budget the work is allowed to burn
- which jobs belong to the goal
- which artifacts belong to the goal
- what checkpoints the user should read when they return
- what verification expectation or final evidence applies

Goals have one product requirement: continuation. A goal that only stores state
is useful internally, but it is antithetical to the user promise if it ships as
the product. The product promise is not "your agent may tag work with a goal."
It is "give your agent a job and let it keep working until it is done, paused,
blocked, abandoned, or out of budget."

### Goal Contract And Enforcement

The goal contract is the shared substrate for every runner. It is required, but
it is not shippable as the standalone product.

Required contract behavior:

- Agents can call `goals.create`, `goals.get`, `goals.checkpoint`, and
  `goals.complete` through CLI/API/MCP.
- Hosted tool calls may include `goal_id`.
- Jobs tagged with `goal_id` are linked to the goal.
- Artifacts produced by those jobs are linked to the goal.
- Goal budgets are enforced in addition to actor/account quota.
- A terminal goal state blocks future cost-bearing tool calls tagged with that
  goal.
- Checkpoints are user-facing progress notes, not internal audit events.

Preferred architecture:

- A Goal Durable Object is the hot synchronization point for one goal.
- Durable Object SQL stores canonical per-goal state, reservations,
  checkpoints, and activity.
- D1 stores the account-scoped read model for lists, dashboard views, linked
  jobs, linked artifacts, and reporting.
- The hosted Worker routes cost-bearing tool calls through the Goal DO before
  provider execution when `goal_id` is present.
- The Goal DO decides whether the goal is active and whether budget can be
  reserved.
- D1 remains the broader product query surface; the Goal DO owns hot atomic
  lifecycle and budget enforcement for the goal.

### Goal Runner Surfaces

The first product-grade Goals release must include at least one continuation
surface that `vc-tools` controls enough to reprompt, resume, or relaunch the
agent while the Goal DO says the work is still active.

The canonical first product lane is hosted, Pro-only, and post-E2B. Local
adapters can follow as reach/compatibility, but they should not be the spine of
the first real Goals product.

There are two acceptable runner lanes:

| Runner lane | Where the agent runs | Product role |
| --- | --- | --- |
| Hosted Goal Runner | E2B-backed Agent Computer | Pro-only first product lane. Lets a user park a goal and walk away while `vc-tools` runs the agent inside the computer until done, paused, blocked, budget-limited, or explicitly stopped. |
| Local Goal Runner | User's machine, launched by `vc-tools` | Later adapter lane. Lets a user bring their own agent CLI while `vc-tools` owns the goal loop, grants, checkpoints, and continuation guardrails where the harness supports it. |

In the hosted runner lane, the user gives `vc-tools` a goal plus a runner
choice. `vc-tools` starts or resumes an Agent Computer, boots an agent runner
inside it, gives the runner a scoped `vc-tools` grant, and lets that runner work
against the same goal contract.

The local runner is acceptable later only if it truly owns continuation. It may
launch Claude Code, Codex, or another supported harness, but it must be able to
observe the child run ending, read goal state, and use a supported hook, resume
command, or relaunch loop to continue work. A manually started external agent
that merely calls `goals.*` is compatibility mode, not the shippable Goals
product.

Required runner behavior:

- The runner uses the same `goals.*`, `browser.*`, `computer.*`, `shelf.*`,
  `jobs.*`, and `usage.*` surfaces available to external agents.
- The runner, not a Worker request handler, owns the continuation loop.
- The Worker remains the control plane for auth, grants, goal state, quota,
  provider lifecycle, artifacts, and usage.
- Active hosted goal runs keep the Agent Computer alive while meaningful work is
  progressing within plan and budget limits.
- Active Pro hosted goal runs do not have a short wall-clock cap. They continue
  while meaningful work is happening and the account remains within plan limits,
  goal budget, concurrency caps, provider runtime ceilings, and abuse controls.
- The hosted runner must checkpoint and safely pause/resume or rotate before a
  provider continuous-runtime ceiling, so long goals can continue without
  pretending a single computer process is immortal.
- When the runner becomes idle, finishes, stalls, pauses, or hits a limit, a Pro
  Saved Computer can auto-pause after 10 minutes instead of losing state.
- The CLI runner must not execute browser or computer work locally; it only
  starts and supervises an agent process that calls hosted `vc-tools` tools.

## Goal Continuation And Reprompting

`vc-tools` cannot reliably reprompt an arbitrary external agent that it did not
launch, configure, or host. MCP tools alone are not enough: a remote MCP server
can expose tools, prompts, resources, and optional client-side features, but it
does not give `vc-tools` a universal background channel to push a new prompt
into every agent after that agent has ended its turn.

Current MCP client-side features are useful but not sufficient as the primary
continuation channel:

- Server prompts can expose templates, but the client decides how and when to
  show or use them.
- Sampling can let a server request model output through a client, but client
  support and UX are optional, and server-to-client requests must be associated
  with an originating client request.
- Elicitation can request user input through a client during an interaction, but
  it is not a universal "resume this agent later" primitive.

Therefore Goals need explicit continuation surfaces:

| Surface | Product role | Continuation strength |
| --- | --- | --- |
| Hosted E2B runner | Pro product lane | Strongest: `vc-tools` owns the runner process inside an Agent Computer and can continue while the account remains within limits. |
| Goal-bound grant | Enforcement | Medium: every hosted tool call is attached to the goal and blocked when the goal is terminal, but the agent still decides whether to continue. |
| `vc-tools goal run -- <agent command>` | Later local runner | Strong when supported: `vc-tools` launches the agent, injects goal context, and can reprompt/relaunch while the goal remains active. |
| Agent-specific adapters | Later local runner | Stronger when supported: use known agent CLI/session/resume hooks where available. |
| MCP-only goal tools | Compatibility substrate | Weak: agent must voluntarily use goals and keep working. This cannot be the shipped Goals phase. |

The later local continuation surface should be:

```text
vc-tools goal run "Objective..." -- <agent command>
```

This wrapper should:

- create the goal
- mint a short-lived goal-bound `vc-tools` grant
- configure the child process with `VC_TOOLS_GOAL_ID`, token file, MCP URL, and
  any agent-specific config the adapter supports
- pass a continuation prompt containing objective, budget, current status,
  checkpoint expectations, and completion criteria
- watch the child process exit
- read the goal state after each iteration
- relaunch or reprompt the agent while the goal remains active and within the
  wrapper's continuation guardrails
- stop when the goal is complete, budget-limited, abandoned, paused, or when an
  iteration produces no meaningful tool work/checkpoint progress

Named adapters should be evaluated in this order:

1. Supported hook/plugin integration. Prefer native lifecycle hooks such as a
   Stop hook that can block agent shutdown and inject a continuation message.
2. Non-interactive launch/resume integration. Use CLI surfaces that accept a
   prompt and resume an existing session when available.
3. Generic subprocess relaunch. Use this only when the agent can persist enough
   state in files, checkpoints, or a session id to make relaunch safe.
4. UI or keystroke injection. Do not ship this as a v1 continuation surface.

The Ralph Wiggum pattern belongs in the first two categories: it proves that a
Claude Code continuation product works when the harness has either a Stop hook
or an outer loop that owns the next prompt. That is the model to copy, not
MCP-only goal tagging.

The generic wrapper should be honest about support:

- Agents launched through the wrapper can be reprompted or relaunched.
- Agents manually started elsewhere can use goals, but cannot be forced to
  continue unless their host/client exposes a supported hook.
- UI/keystroke injection into arbitrary agent apps is not a v1 product surface;
  use explicit wrappers, adapters, or hosted runners instead.

Goal continuation should include a no-progress guard similar in spirit to
Codex's continuation suppression:

- if an iteration produces no `vc-tools` tool call, checkpoint, artifact, or
  state change, the wrapper should stop and mark the goal `needs_human` or pause
  with a clear reason instead of relaunching forever
- the Goal DO remains the enforcement point for terminal state and budget
  exhaustion
- the wrapper is the continuation driver, not the source of truth

## Agent Computer Filesystem

Agent Computers should feel like real computers, not fake container folders.
The product should not teach `/workspace` as the main concept.

Default filesystem contract:

| Filesystem concept | Decision |
| --- | --- |
| Provider default user | `user` |
| Default home / cwd | `/home/user` |
| Human-facing display | `~` |
| Default project folder | `~/project` |
| Default output folder | `~/outputs` |
| Optional agent notes folder | `~/notes` |

Agents may create, inspect, install, configure, and modify files according to
the computer's OS permissions and `vc-tools` safety policy. This includes
dotfiles, package-manager state, config files, and system paths where the OS
allows it. `vc-tools` should not turn the computer into a narrow fake
filesystem.

The stricter boundary is durable export, not local computer use.

## Artifact Shelf And Save To Shelf Policy

Artifact Shelf is durable agentic storage, not a formal memory system and not
an automatic backup of the computer.

There are two Shelf paths:

1. Hosted tools can automatically store bounded job-result artifacts. Examples
   include browser screenshots, PDFs, markdown, crawl JSON, command/test logs,
   closure metadata, and result bundles that are part of the tool output.
2. Users and agents can explicitly save selected computer files to Shelf at any
   time. This is the path-targeted "Save to Shelf" action.

Closed policy:

- Automatic job-result artifacts are allowed when they are the expected output
  of a hosted tool run and remain bounded by ownership, retention, storage
  quota, type validation, and cleanup policy.
- Arbitrary computer files, package caches, intermediate work, generated files,
  reports, screenshots, logs, and downloaded files are not swept into Shelf
  automatically just because they exist in the Agent Computer.
- The agent or user can save a specific file path at any time during an Agent
  Computer run.
- Save UX/DX should make the happy path easy:

```text
vc-tools shelf save ~/outputs/report.pdf
vc-tools shelf save ~/project/final.patch
vc-tools shelf save ~/project/dist.zip
```

- The API/tool contract should support a path-targeted save from a computer:

```json
{
  "capability": "shelf.save",
  "computerId": "comp_123",
  "path": "~/outputs/report.pdf",
  "name": "QA report"
}
```

- `shelf.save` can map internally to the existing `artifact.create`
  capability while public docs and agent instructions prefer "Save to Shelf".
- If a disposable computer is discarded, unsaved files disappear with the
  computer. Saved Shelf artifacts follow artifact retention policy instead.

Sensitive, hidden, credential-like, cache-heavy, or system-path exports are
allowed but must require double confirmation. This avoids silently preserving
secrets or irrelevant machine state while keeping the computer honest and
powerful.

Double-confirmation exports require:

- a clear warning about credential/system/machine-state risk
- an explicit user/agent reason
- a confirmation challenge or token
- an audit record
- human approval in v1 unless a specific sensitive-export grant exists

## Saved Computers

Saved Computers are the Pro-only persistence feature for Agent Computers.
They should feel like account-attached devices, not disposable jobs. A Pro
user's primary Saved Computer is attached to that user's account by default
unless the user explicitly chooses a scratch, project, or otherwise separate
computer.

Closed policy:

| Field | Decision |
| --- | --- |
| Eligibility | Pro only |
| Free affordance | Free gets no Agent Computer |
| Creator affordance | Creator stays on Cloudflare one-shot sandbox compute and does not see a locked Save Computer action in the task flow |
| Pro included count | One primary account-attached Saved Computer by default |
| Additional computers | Explicit future plan/add-on/project/scratch decision, not the default device model |
| Retention model | Pause-first persistence while Pro subscription and safety posture are valid |
| Auto-pause | Pro Saved Computers pause after 10 minutes of inactivity/timeout instead of killing state |
| Active Pro goal run | Do not auto-pause for a short wall-clock timeout while meaningful work is happening and account/provider limits allow continuation |
| Provider-held state | E2B may hold persisted filesystem and machine state |
| Platform truth | Cloudflare/D1 owns identity, ownership, eligibility, audit, job metadata, artifact metadata, quota, and billing state |
| Deletion after inactivity | No automated inactivity kill for active Pro subscribers |
| Kill/delete path | Explicit user delete/reset, plan/account lifecycle with clear notice or export window, abuse/security/legal action, or unrecoverable provider failure |
| Artifacts after computer expiry | Existing Shelf artifacts, usage records, audit records, and job records follow their own retention policies |

Activity that can resume or keep the Pro Saved Computer active must be
intentional user- or agent-initiated use:

- user opens or resumes the Saved Computer
- agent successfully resumes the Saved Computer
- agent runs a command
- agent writes, creates, deletes, or updates files
- user or agent creates a Shelf artifact from that computer
- user renames, pins, restores, deletes, or changes settings on the computer
- successful resume after sleep

Passive platform behavior must not resume a sleeping computer or prevent
auto-pause:

- dashboard list views
- background scans
- quota checks
- billing checks
- passive health checks
- provider cleanup retries
- internal migration jobs
- alerting or telemetry processing
- failed resume attempts that do not restore usable access

The user-facing contract should be:

> Your Pro computer is yours while your plan is active. When you walk away, it
> sleeps instead of disappearing.

The lifecycle contract should be:

> When you walk away from a Pro Saved Computer, it sleeps after 10 minutes
> instead of being deleted. Kill is deletion, not cleanup.

## Operator Computer

The Operator Computer is a separate private lane for Braden to learn and test
cloud-side compute before productizing the Pro Saved Computer. It is not a
Creator feature, not a Free feature, and not the customer-facing default.

Purpose:

- let Braden use and inspect a durable E2B-backed cloud workbench
- exercise Cloudflare AI Gateway model routing from inside a sandboxed computer
- test MCP, previews, artifacts, pause/resume, package installs, and hosted
  agent behavior under real cloud conditions
- discover which pieces should become the Pro Saved Computer product contract

Closed operator policy:

| Field | Decision |
| --- | --- |
| Owner | Braden/operator only |
| Product promise | Experimental operator workbench, not public `vc-tools` entitlement |
| Provider | E2B |
| Model route | Cloudflare AI Gateway `dynamic/vibecodr-primary` by default |
| Network | Builder network tier for package installs, git, public docs, and provider experiments |
| Preview | Private owner-only preview |
| MCP/access | Owner-scoped and token-gated; no public raw provider tokens |
| Lifecycle | Pause on idle, manual resume, manual delete only |
| Cleanup | Pause/reconcile/repair by default; kill only by explicit operator delete/reset or safety/provider failure |

The Operator Computer may be more permissive and tool-rich than the eventual
Pro default. It can include `node`, `pnpm`, `bun`, `python`, `uv`, `git`, `gh`,
`wrangler`, E2B CLI, Playwright dependencies, MCP test clients, and agent
runner experiments. It still must not receive broad Cloudflare admin authority,
raw provider secrets, or platform signing secrets by default. Use narrow grants,
Cloudflare AI Gateway BYOK, and server-side control-plane calls instead.

The Operator Computer should feed product learning, but product docs must not
inherit its extra privileges automatically. Anything promoted from operator
practice into Pro must pass the normal grants, usage, network, preview,
artifact, and security review.

## Job Records And Summaries

Every Agent Computer run keeps lightweight platform metadata even when no files
are saved to the Shelf.

Minimum durable record:

- job id
- computer id
- actor/user id
- workspace or account scope when applicable
- capability
- plan
- status
- created, started, and completed timestamps
- duration and metered computer usage
- exit code or failure reason
- short final summary
- saved Shelf artifact ids, if any
- provider reference where needed, server-side only
- audit event ids

The final summary should be short and user-readable, not a full transcript or
raw log dump.

## Cost Protection Doctrine

Cost protection must be strict underneath the product and quiet in the normal
user path. VC Tools should feel generous, but never unbounded.

User-facing rule:

> Your agent can keep working while it is making progress and your account has
> capacity. VC Tools will pause, ask, or stop before work can quietly run past
> your limits.

Product stance:

| Boundary | Protection | User friction |
| --- | --- | --- |
| Starting cost-bearing work | Entitlement, grant, quota, budget, concurrency, and operator-state checks before provider creation/resume/command execution | Invisible unless denied |
| Normal active work | Reservation and settlement meters track actual usage against account and goal budgets | Invisible |
| Approaching limit | Calm status/warning in CLI/dashboard/work receipt | Visible but non-blocking |
| Hitting account or goal limit | Pause/stop new cost-bearing work and preserve resumable state when possible | Blocking with clear reason |
| Idle Saved Computer | Auto-pause after 10 minutes of inactivity/timeout | Invisible or low-noise status |
| Active Pro Goal Run | Renewable work lease while meaningful progress continues | Invisible while healthy |
| Stalled/no-progress goal | Pause or `needs_human`, auto-pause computer, keep work receipt | Visible with next action |
| Provider runtime ceiling | Checkpoint and pause/resume or rotate before hard stop | Invisible if successful, visible if blocked |
| Creator/disposable one-shot job | Kill on completion, cancel, failure, or timeout | Expected lifecycle |
| Public preview/share/publish | Explicit user action and policy grant | Intentional confirmation |
| Operator spend anomaly | Pause new admissions or downgrade capacity before provider spend escapes | Usually invisible; visible only if user action is blocked |

Required cost-control layers:

- Admission control: every cost-bearing action must check plan, grant, account
  quota, goal budget, active reservations, concurrency, kill switches, and abuse
  state before contacting E2B or Browser Run.
- Reservation before spend: browser, computer, preview, Shelf storage, and
  hosted goal work must reserve capacity before dispatch and settle against
  actual usage afterward.
- Atomic goal accounting: Goal Durable Objects own hot goal-budget reservations
  and terminal-state blocking; D1 remains the account/reporting read model.
- Queue and concurrency gates: use hosted queues, per-account active job caps,
  and fair scheduling so one account cannot consume shared provider capacity.
- Lifecycle savings: Creator/disposable computers kill by default; Pro Saved
  Computers auto-pause after 10 minutes idle; active Pro Goal Runs renew
  progress leases and pause on stall/limit rather than burn indefinitely.
- Provider ceiling handling: E2B continuous-runtime limits must be treated as a
  lifecycle boundary. Long goals checkpoint and pause/resume or rotate before
  provider hard stop.
- Orphan cleanup: a watchdog/DO alarm path must reconcile provider state against
  D1/Goal DO state. Creator/disposable provider state can be killed when the
  job is terminal or lease-less. Pro Saved Computers should be paused and marked
  for repair/reconciliation, not killed, unless an explicit delete/reset,
  account-lifecycle, abuse/security/legal, or unrecoverable-provider condition
  applies.
- Preview containment: private previews are owner-scoped and time-bound;
  preview/public traffic cannot bypass auto-pause, quota, or share policy.
- Artifact containment: automatic artifacts are bounded; arbitrary files enter
  Shelf only by explicit save; Shelf bytes count against storage quota.
- Operator controls: global and per-provider pause switches must deny before
  D1 job insertion, queue dispatch, provider creation, or resume.
- Spend reconciliation: internal meters must be reconciled with provider usage
  and surfaced to operators as capacity/spend drift, not shown to users as raw
  provider anxiety.

Auto-pause rules:

| Computer state | Default lifecycle |
| --- | --- |
| Creator Cloudflare sandbox or disposable one-shot computer completes/fails/cancels/times out | Kill provider state after required artifacts and summaries are persisted |
| Pro Saved Computer goes inactive | Pause after 10 minutes using E2B lifecycle `onTimeout: "pause"` |
| Pro Saved Computer is manually resumed | Resume only through `vc-tools` after entitlement/quota checks |
| Pro Saved Computer receives passive/public traffic while paused | Do not auto-resume by default |
| Pro Saved Computer is idle for a long period while subscription remains active | Keep paused; do not automated-kill for inactivity alone |
| Active Pro Goal Run is making meaningful progress | Keep running within account, goal, concurrency, abuse, and provider-runtime limits |
| Active Pro Goal Run reaches provider continuous-runtime ceiling window | Checkpoint and pause/resume or rotate safely before hard stop |
| Goal runner stops producing meaningful progress | Mark paused/`needs_human`, write work receipt, and auto-pause computer |
| Account/goal budget is exhausted | Stop new cost-bearing work, preserve resumable state when possible, and show the exact limit reached |
| Abuse/security/operator stop triggers | Pause or kill according to severity; preserve audit/work receipt where safe |
| User explicitly deletes/resets a Pro Saved Computer | Kill provider state after export/confirmation policy is satisfied |

Meaningful progress for hosted goal runs should include at least one of:

- active command/process lease owned by the runner
- `vc-tools` tool call, checkpoint, artifact, file write, test result, or preview
  update
- runner heartbeat that references the current active command or task step
- explicit user interaction with the active goal or computer

Do not treat raw stdout alone as enough to renew an expensive long-running goal
forever. Conversely, do not pause a healthy long-running command merely because
it is quiet. The runner must track command/process leases separately from log
volume.

## Usage And Packaging Direction

Public usage language should describe agent work capacity, not provider meters.

Prefer:

- agent browser checks
- agent computer runs
- test runs
- concurrent jobs
- artifact storage
- retention
- saved computers
- priority queue
- tool grants

Avoid:

- E2B credits
- Cloudflare credits
- sandbox minutes as the headline
- container time
- raw provider rate limits

Internal meters can remain precise:

- browser seconds
- computer seconds
- job count
- active job count
- artifact bytes
- retention days
- provider error/rate-limit counts
- operator capacity thresholds

Pricing and exact plan packaging are not decided in this RFC. The current
decision is product-shape only: `vc-tools` should sell and explain useful agent
work, while the hosted control plane protects margins with hard caps, soft caps,
queued-ahead reporting, scheduled backpressure, provider spend alarms, and
plan-derived limits.

## First Implementation Phases

### Phase 0: Language And Contract Preparation

- Add `computer.run` and `computer.test` aliases while preserving
  `sandbox.run_command` and `sandbox.run_tests`.
- Update CLI help, API docs, public copy, and validation matrix to prefer
  "computer" for the Pro user-facing primitive while keeping Creator one-shot
  sandbox language intact where that is still the shipped provider path.
- Keep security docs explicit that the computer is an isolated sandbox.

### Phase 1: Provider Boundary

- Extract the current Cloudflare Sandbox SDK execution path behind a provider
  boundary.
- Keep current live behavior intact while making provider choice explicit.
- Preserve Creator one-shot compute on the Cloudflare sandbox provider path.
- Add tests proving quota, audit, artifact, cancellation, and reconciliation
  remain provider-independent.

### Phase 2: E2B Hidden Pro Provider

- Add an E2B REST provider behind an operator flag such as
  `VC_TOOLS_COMPUTER_PROVIDER=e2b`.
- Route only Pro/operator/internal canaries to E2B while Creator continues using
  the Cloudflare sandbox provider.
- Start with Option A: direct REST from the hosted Worker to E2B lifecycle APIs
  and sandbox envd endpoints.
- Run the required Worker spike: create a live sandbox, call an envd command
  endpoint such as `POST /process/start`, retrieve stdout/stderr/result, and
  prove file read/write from the Worker.
- Treat a successful Worker REST spike as the no-extra-infra path.
- Add a proxy/sidecar/Node service only if the spike proves direct Worker REST
  cannot safely cover lifecycle, commands, files, timeout, cancellation, and
  error handling.
- Run internal smoke jobs only.
- Store provider metadata in D1 without exposing provider tokens.
- Keep the Cloudflare sandbox provider as the Creator production lane even after
  E2B behavior is proven for Pro.

### Phase 3: Pro Agent Computer

- Switch Pro product language from "Sandbox" to "Agent Computer".
- Keep Creator product language and implementation tied to bounded one-shot
  sandbox/compute unless a separate Creator release changes that surface.
- Keep compatibility aliases for `sandbox.*`.
- Use Browser Run as the verification partner for web-preview computer jobs.
- Add private owner-scoped Computer Preview for services running inside the
  Agent Computer.
- Keep public preview links and publish/deploy behind explicit user action and
  future policy-controlled grants.
- Add the zero-code setup path: `vc-tools login`, `vc-tools computer start`,
  guided computer setup, and generated config.
- Add provider connection status surfaces without exposing raw provider secrets.
- Enable public outbound internet for Pro E2B-backed Agent Computers while
  preserving Browser Run as the browser product.
- Block private/internal/metadata reach, public inbound exposure, provider
  secrets, Vibecodr internal infrastructure, and abuse patterns unless an
  explicit future grant opens a narrow lane.

### Phase 4: Saved Computers

- Introduce pause/resume or snapshot-backed saved computers only after one-shot
  jobs are stable.
- Add Pro-only persistence with one primary account-attached Saved Computer by
  default. Additional Saved/project/scratch computers are explicit future
  packaging decisions.
- Create/resume Pro Saved Computers with a 10-minute timeout and
  `onTimeout: "pause"` so idle computers sleep rather than disappear.
- Keep auto-resume disabled by default unless a later policy explicitly allows
  waking on traffic/activity without a `vc-tools` resume action.
- Add user-facing last-used and sleeping/running/error status.
- Add explicit delete/reset/export flows before provider-held Pro computer state
  can be killed.
- Add orphan reconciliation: if Cloudflare state says a computer is idle,
  terminal, or lease-less while E2B still reports it running, pause Pro Saved
  Computers and mark them for repair/reconciliation; kill only disposable or
  explicit-delete provider state.

### Goals Track: Continuation-Capable Runner First

Goals are a cross-cutting product track, not part of the initial E2B provider
swap. The tracking protocol is implementation substrate, not a finished phase.
Do not ship or market Goals until at least one supported runner can keep working
after the agent would otherwise stop.

Goal substrate:

- Add Goal Durable Object and D1 read-model schema.
- Add `goals.create`, `goals.get`, `goals.checkpoint`, and `goals.complete`.
- Add `goal_id` to hosted job submission and job readback.
- Add goal budget reservation before provider execution when `goal_id` is
  present.
- Link jobs and artifacts to goals.
- Add a dashboard/status surface for objective, status, budget burn,
  checkpoints, jobs, and artifacts.
- Add tests for terminal-state blocking, budget exhaustion, concurrent
  reservations, checkpoint append, artifact linking, and D1 read-model sync.
- Add tests for expired work leases, idle auto-pause, stalled-goal pause,
  provider-runtime checkpoint/rotate, and account-limit enforcement.

Hosted continuation runner:

- Wait until E2B-backed Agent Computers and Pro Saved Computers are
  production-ready.
- Ship hosted goal runs as Pro-only.
- Add a hosted runner template/profile inside an Agent Computer so users do not
  manually install or configure the runner.
- Require provider connection through the guided setup flow before the first
  hosted goal run when the chosen runner needs a user-owned provider account.
- Mint a scoped `vc-tools` grant for the runner.
- Boot the runner with the objective, goal id, budget, and continuation
  contract.
- Keep goal state, quota, artifacts, and provider lifecycle under the hosted
  `vc-tools` control plane.
- Do not enforce a short wall-clock cap while the runner is actively making
  meaningful progress.
- Enforce account entitlement, goal budget, concurrency, provider spend controls,
  abuse controls, and explicit user/operator stop actions.
- Require the hosted runner to renew a Goal DO work lease while active. Lease
  renewal must be tied to meaningful progress or an active command/process lease,
  not log spam.
- Track provider continuous-runtime ceilings and make checkpoint/pause/resume or
  computer rotation part of the runner contract before the provider can hard-stop
  useful work.
- Use Pro Saved Computer auto-pause after 10 minutes only after idle/finished/
  stalled/paused/limited work, while keeping active hosted goal runs alive during
  meaningful progress.

Later local continuation runner:

- Add `vc-tools goal run "..." -- <agent command>` as a supervised runner, not a
  local browser/computer execution path.
- Mint a scoped goal-bound grant and inject goal context into the child process.
- Relaunch, resume, or reprompt the child while the Goal DO says the goal is
  active and each iteration produces meaningful progress.
- Stop with a clear state when the goal is complete, budget-limited, paused,
  abandoned, blocked, or progress stalls.
- Prove at least one named adapter before treating the local runner as
  product-grade: Claude Code via supported hook/plugin or prompt loop, Codex via
  supported non-interactive/resume surfaces, or another harness with equivalent
  lifecycle hooks.
- Keep MCP-only `goals.*` as compatibility mode and internal plumbing. It should
  not be called a phase.

## Open Questions

- Should the public binary remain only `vc-tools`, or should there eventually be
  top-level command aliases such as `vc-tools computer run` in addition to
  `vc-tools tools test computer.run`?
- How many additional Saved/project/scratch computers should Pro or Team plans
  include beyond the primary account-attached Pro Saved Computer?
- Which provider connection flow ships first, and can it be completed without
  raw API keys, hand-written config, or code knowledge?
- What provider session state belongs inside the Saved Computer versus an
  encrypted provider vault versus Cloudflare metadata?
- Should private Computer Preview be routed through a `vc-tools` preview proxy,
  a provider token-gated URL, or both depending on environment?
- What is the first public-preview/share policy, and how long should shared
  preview links live by default?
- What exact egress controls, denylist categories, provider settings, and
  abuse-detection hooks are needed to make Pro E2B Agent Computer public
  outbound internet safe without making the computer feel fake?
- How should MCP tools inside the E2B computer be exposed without leaking
  gateway tokens or confusing them with the hosted `vc-tools` remote MCP?
- Which agent runner should ship first inside the Pro hosted E2B Goal Runner:
  Codex, Claude Code, a custom runner, or a narrow vc-tools-owned harness?
- Which local agent CLIs should receive later first-class adapters, and what
  exact Stop hooks, resume commands, session APIs, MCP config injection points,
  and structured-output surfaces do they support?
- Which Vibecodr product surfaces, if any, should call `vc-tools` first after
  the standalone toolkit is stable?

## Source Links

- E2B documentation: https://e2b.dev/docs
- E2B sandbox lifecycle: https://e2b.dev/docs/sandbox
- E2B persistence: https://e2b.dev/docs/sandbox/persistence
- E2B snapshots: https://e2b.dev/docs/sandbox/snapshots
- E2B auto-resume: https://e2b.dev/docs/sandbox/auto-resume
- E2B internet access and sandbox URLs: https://e2b.dev/docs/sandbox/internet-access
- E2B computer use / desktop: https://e2b.dev/docs/use-cases/computer-use
- E2B user and workdir: https://e2b.dev/docs/template/user-and-workdir
- E2B create sandbox API: https://e2b.dev/docs/api-reference/sandboxes/create-sandbox
- E2B Worker/Edge runtime caveat: https://e2b-preview.mintlify.app/troubleshooting/sdks/workers-edge-runtime
- Cloudflare Durable Object alarms: https://developers.cloudflare.com/durable-objects/api/alarms/
- Cloudflare Queues: https://developers.cloudflare.com/queues/
- MCP Sampling: https://modelcontextprotocol.io/specification/draft/client/sampling
- MCP Elicitation: https://modelcontextprotocol.io/specification/draft/client/elicitation
- MCP server-to-client request association: https://modelcontextprotocol.io/seps/2260-Require-Server-requests
- Cloudflare Browser Run: https://developers.cloudflare.com/browser-run/
- Existing `vc-tools` API contract: `docs/API-CONTRACT.md`
- Existing Cloudflare primitive-fit document: `docs/CLOUDFLARE-PRIMITIVE-FIT.md`
