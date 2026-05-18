I’ll translate the research into a concrete subscription package: target customer, tiers, included value, usage meters, limits, safety gates, launch scope, and cost/risk assumptions.

Canonical integration update (2026-05-11): vc-tools is included in existing
Vibecodr paid subscriptions instead of owning a standalone Stripe catalog. The
historical "Starter" package in this planning note maps to Vibecodr Creator at
`$19/mo`; Pro follows the existing Vibecodr Pro subscription unless a separate
Pro price change is approved. Browser Run and Sandbox remain separate vc-tools
meters/quotas and must not collapse into generic credits or Pulse usage.

The emerging spine is a governed remote agent tool layer, with MCP/service access as the product and CLI as setup/debug/retrieval support. It should sell predictable credits, auditability, artifact custody, and controlled browser/sandbox capability—not unlimited usage or raw infrastructure pass-through.

Thought for 7m 18s

Here’s the subscription product I’d build from this research:

Vibecodr Tools Cloud

A paid agent-infrastructure subscription that lets Vibecodr users give their AI agents safe, metered access to Quick Checks, Agent Browser, Sandbox, Crawl, Artifact Shelf, and activity/status controls — without exposing raw Cloudflare credentials or making the user’s local machine the trust boundary.

The research points pretty strongly away from “paid CLI” as the main product. The CLI should exist, but as a setup/debug/artifact helper. The product people pay for should be the hosted, Vibecodr-controlled remote MCP/tool service, with Browser Run and Sandbox SDK as the first paid capabilities. That matches the research’s recommendation: start with a remote MCP service, use the CLI as the local control plane, and prove Browser Run plus Sandbox under strict auth, quota, retention, and observability controls.

Product promise

“Give your coding agent hosted tools that return proof: it can browse the
public web, render pages, crawl sites, run code in an isolated sandbox, save
artifacts, and report progress under Vibecodr-owned limits.”

That’s the simplest buyer-facing framing. The user is not buying “Cloudflare Browser Run + Sandbox + Queues + R2.” They are buying the missing runtime layer between a coding agent and the outside world.

The core paid value is this:

An agent can inspect real rendered websites, produce screenshots/PDFs/markdown, run code in an isolated sandbox, crawl bounded public pages, store results, and report activity status. Vibecodr handles auth, quotas, logging, retention, artifact custody, and workspace-level permissions.

Cloudflare’s current Browser Run docs support the browser side of this: it runs headless Chrome on Cloudflare’s global network and supports rendered outputs like markdown, screenshots, PDFs, snapshots, links, structured data, crawled content, plus browser sessions through Playwright, Puppeteer, CDP, and Stagehand. The Sandbox SDK side is a good fit for code execution because Cloudflare describes it as running each sandbox in its own VM with filesystem, process, network, and resource isolation.

The subscription product

Call the first paid product Vibecodr Agent Tools or Vibecodr Tools Cloud.

It should not be sold as “unlimited agent capabilities.” That invites abuse, margin risk, and scary customer expectations. It should be sold as a metered capability bundle with clear safety modes.

The first version should include five visible tool families plus one supporting status surface:

Quick Checks
Render pages, capture screenshots, extract markdown, generate PDFs, inspect links, and optionally do controlled browser automation.
Agent Browser
Longer hosted browser tasks for Creator and Pro, capped by plan and idle timeout.
Sandbox
Run code, install packages within policy, execute tests, generate files, and return logs/artifacts.
Crawl
Collect bounded public-site context by page, depth, and monthly limits.
Artifact Shelf
Store screenshots, PDFs, logs, generated files, run outputs, and session traces with retention controls.

Activity/status controls
Longer work status, retries, cancellation, queueing, audit history, and failure reporting. This is backend machinery and a support/inspection surface, not a marketed user ability called "Jobs."

Cloudflare Workflows fit the durable job layer because they support multi-step execution, retries, persisted state, pauses for approvals, and external events. Queues fit the work-dispatch layer because they support guaranteed delivery, retries, delays, batching, dead-letter queues, and offloading work from request paths.

The first three plans

The canonical launch packaging is the existing public Vibecodr plan ladder:
Free, Creator, and Pro. vc-tools does not own a standalone Stripe catalog.
Creator rises to `$19/mo`; Pro stays on the existing Vibecodr Pro
subscription unless a separate Pro price change is approved.

The core rule is that builds and VC Tools are separate ledgers inside the same
subscription. Builds spend build seconds/minutes. VC Tools spend VC Tool
credits, browser seconds, crawl allowance, scheduled QA allowance, sandbox
compute where enabled, artifacts, retention, and concurrency. These ledgers do
not borrow from each other and must not collapse into Pulse usage.

Build limits

Plan	Monthly build minutes	Daily build minutes	Max jobs/day	Max wall time/job	Max concurrent builds	Max output bytes	Max output files
Free	30	10	5	180s	1	50 MB	20,000
Creator	750	90	50	300s	2	200 MB	60,000
Pro	4,000	360	150	600s	4	500 MB	120,000

Build accounting rules:

Rule	Setting
Billing unit	standard1-wall-second
Round-up interval	15 seconds
Queue time charged	No
Container active time charged	Yes
User-code build failures charged	Yes
Platform failures refunded	Yes
Warm idle charged	Yes, unless force-stopped
Force-stop on completion	Yes
Reserve before starting	Required
No reserve, no build	Required
Build ledger separate from VC Tools	Required

VC Tools limits

Plan	Monthly VC Tool credits	Daily credits	Max concurrent tool runs	Max browser seconds/run	Browser Sessions	Scheduled QA
Free	30	10	1	30s	No	0/mo
Creator	600	90	2	60s	No	30/mo
Pro	3,000	400	5	180s	Yes, capped	300/mo

Crawl limits:

Plan	Pages/run	Pages/month	Depth
Free	10	25	1
Creator	50	500	2
Pro	250	5,000	4

Account-wide hosted capacity breakers:

Lane	Soft cap	Hard cap	Policy
Hosted queue	24 active hosted jobs	30 active hosted jobs	Queue consumer `max_concurrency` is 30; plan limits still apply per user; soft-cap crossings notify operator email/ntfy through internal-api fanout
Quick Actions request rate	8 requests/sec	10 requests/sec	Provider 429s return to retry/defer
Browser jobs	24 concurrent hosted browser jobs	30 concurrent hosted browser jobs	Configurable through `VC_TOOLS_BROWSER_RUN_ACCOUNT_SOFT_CAP` and `VC_TOOLS_BROWSER_RUN_ACCOUNT_HARD_CAP`; soft-cap crossings notify operator email/ntfy through internal-api fanout
Sandbox containers	24 concurrent hosted sandboxes	30 concurrent hosted sandboxes	Configurable through `VC_TOOLS_SANDBOX_ACCOUNT_SOFT_CAP` and `VC_TOOLS_SANDBOX_ACCOUNT_HARD_CAP`; Wrangler `max_instances` is 30; soft-cap crossings notify operator email/ntfy through internal-api fanout
Browser Sessions	24 account-wide sessions	30 account-wide sessions	Pro/beta only; reserve slot before launch; queue after soft cap; never open above hard cap without an operator flag; close immediately after run

The product should sell outcomes rather than raw browser time. Public-facing
copy should lead with VC Tool credits, render checks, screenshots, console and
network capture, visual diffs, crawl limits, scheduled QA, artifacts, and
secure sandbox execution. Browser seconds remain a quota and accounting guard,
not the main thing being advertised.

What each plan actually unlocks for the agent

The product should expose named tool grants, not a single “tools enabled” toggle.

Use grants like:

Tool grant	What it allows
browser.render	Open public pages and return screenshot/markdown/PDF
browser.inspect	Extract links, metadata, DOM snapshots, console/network summaries
browser.automate	Use Playwright/Puppeteer-style controlled sessions
browser.live_view	Let a human inspect or step into the session
browser.record	Record session events for debugging
sandbox.run	Execute code in an isolated environment
sandbox.network	Allow outbound internet from sandbox
sandbox.preview_url	Expose a temporary preview
artifact.write	Store generated outputs
artifact.read	Retrieve generated outputs
job.long_running	Queue durable multi-step jobs
crawl.public	Crawl public pages through the first-class `browser.crawl_site` capability
crawl.authenticated	Crawl authenticated sessions; should be deferred or allowlisted

This matters because the product is fundamentally a permissions product, not just an infrastructure product. The research explicitly highlights security, paid-user gating, scoped tool grants, retention, custody, quota, and abuse as central product concerns.

Product surfaces

The correct interface stack:

Surface	Role	Launch priority
Remote MCP	Primary agent interface	Day one
CLI	Login, configure, test tools, retrieve artifacts, debug sessions	Day one
Web dashboard	Usage, grants, artifacts, activity history, billing, audit logs	Day one-ish
REST API	Programmatic integration for non-MCP clients	Later
SDK/package	Advanced app embedding	Later

Remote MCP should be the primary interface because Cloudflare’s Agents SDK supports MCP tools, and MCP tools are defined as functions exposed by an MCP server for clients/LLMs to call. For remote MCP, Cloudflare’s docs describe Streamable HTTP as the standard transport for remote MCP connections, with stdio intended for local connections. That maps neatly to the research’s recommendation: Vibecodr owns the hosted tool service; the CLI is useful, but not the whole product.

The CLI should be boring and reliable, but the primary model is now the
agent's computer rather than a human-operated control plane:

vc-tools login
vc-tools start
vc-tools agent connect
vc-tools computer start
vc-tools browser render https://example.com
vc-tools proof list
vc-tools proof save <artifact-id>
vc-tools work status <job-id>
vc-tools grants list

The agent-facing tool vocabulary should lead with `browser.*`, `computer.*`,
`work.*`, `proof.*`, and `usage.status`; low-level `tools test`, `jobs`,
`artifacts`, and `sandbox.*` remain advanced/debug or compatibility surfaces.

Do not make the CLI the place where the agent runs everything. That would make local user machines part of the trust boundary, reduce reliability, and make subscription value fuzzier.

The killer workflows

The subscription should sell outcomes, not primitives.

The first five workflows I’d productize:

Workflow	What the agent does	Why users pay
Rendered website inspection	Opens a real page, captures screenshot/markdown/DOM summary	Agents stop guessing what a page looks like
Bug reproduction	Visits app, captures console/network/errors, stores artifacts	Better debugging with proof
Code execution and test run	Runs code/tests in sandbox, returns logs/files	Safer than local execution
Research artifact generation	Renders sources, extracts markdown/PDF/screenshots	More credible agent research
Preview and verify	Runs generated app/code, stores output, optionally gives preview	Agent can build and check its own work

The strongest wedge is probably “agent-visible web + safe code execution.” It is easy to understand and high-frequency for builders.

What to avoid in v1

I would explicitly avoid these at launch:

Authenticated third-party browsing for all users. Defer it or keep it allowlisted and human-in-the-loop at first. The research calls out authenticated browsing as an unresolved product/security decision. Browser Run’s Human in the Loop feature can let a human step into a live browser session for MFA, sensitive credentials, CAPTCHAs, or complex manual steps, but that power is exactly why it should be gated.

Default screenshot/PDF/session retention. Make retention opt-in beyond short operational retention. Browser recordings are currently opt-in per session in Cloudflare’s docs, which is the right posture for Vibecodr too.

Unlimited crawl. Crawl should be a paid add-on, not bundled generously. It is too easy to turn into abuse, COGS leakage, or compliance headaches.

Sandbox internet by default. Start with outbound internet disabled or tightly allowlisted for sandbox jobs. The moment an agent can run code with broad egress, you need stronger abuse controls.

WebMCP as a core promise. Treat it as a watch item, not a launch dependency. Cloudflare’s MCP docs describe WebMCP as experimental and subject to change.

Selling “automation” before selling “rendering.” Rendering and artifact capture are easier to explain, easier to meter, lower-risk, and still valuable. Full browser automation should be a capped Pro feature.

Security and trust model

The default stance should be:

“Agents get capabilities, not credentials.”

That means:

Vibecodr stores Cloudflare credentials internally, not in user projects. Users authenticate to Vibecodr. Vibecodr issues scoped grants to agents. Every tool call is checked against workspace, project, user, plan, quota, and risk policy. MCP authorization should use OAuth-style limited grants rather than asking users to share API keys; Cloudflare’s MCP authorization docs also frame OAuth as the way users grant limited access without sharing API keys or other credentials.

Minimum launch controls:

Control	Free	Creator	Pro
User auth	Required	Required	Required
Workspace grants	Basic	Yes	Yes
Project grants	Basic	Yes	Yes
User grants	No	Yes	Yes
Audit log	Basic activity history	30 days	30+ days
Retention policy	Fixed	Plan-capped	Configurable within policy
Allowlisted domains	No	Optional	Optional
Sandbox egress controls	No Sandbox	Strict	Configurable within hosted grants
Spend caps	Required	Hard cap by default	Hard cap by default
Abuse review	Automated	Automated	Automated + manual path

The design choice I’d make now: tool grants should be workspace-scoped by default, project-overridable, and user-restrictable. That’s a mouthful, but product-wise it’s clean: admins set defaults, projects narrow them, users can be limited.

Retention policy

Default retention should be conservative:

Artifact type	Default
Job metadata	30 days
Logs	Free operational minimum, Creator 7 days, Pro 30 days
Screenshots/PDFs	Free operational minimum, Creator 7 days, Pro 30 days
Browser recordings	Off by default
Sensitive session artifacts	Off by default or 24 hours
Sandbox files	Deleted after job unless saved as artifact
Authenticated browsing artifacts	Opt-in only

Users should see this in plain English during setup:

“Your agent may create screenshots, logs, PDFs, and files. Choose what Vibecodr keeps.”

That one line will prevent a lot of future trust problems.

Pricing page structure

I’d make the pricing page very direct:

Free
Use Vibecodr with limited public-page Quick Actions: 30 VC Tool credits/month,
10/day, 1 concurrent run, 30s browser-run cap, no Sandbox, no Browser Sessions,
no scheduled QA.

Creator — $19/mo
For solo builders who want Vibecodr-native Agent QA, runtime diagnosis, safe
sandbox execution, artifacts, and scheduled checks. Includes 750 build
minutes/month and 600 VC Tool credits/month.

Pro — $39/mo
For builders who want heavier build capacity, capped Browser Sessions, larger
crawls, more scheduled QA, artifacts, and activity history. Includes 4,000 build
minutes/month and 3,000 VC Tool credits/month.

No enterprise SKU at launch. Do not advertise custom enterprise sales; keep the
focus on secure, human-usable self-serve subscriptions.

Then below the table:

“Build minutes and VC Tool credits are separate. Agents queue when a quota or
safety breaker is reached; browser sessions are Pro-only and capped.”

Do not sell raw browser minutes as the main product. Sell outcomes: render
checks, console/network capture, visual diffs, crawl reports, scheduled Agent
QA, sandboxed test runs, artifacts, and activity history.

Launch sequence
Phase 1: Paid alpha

Ship only:

Browser render
Browser screenshot
Browser markdown/PDF extraction
Sandbox run
Artifact store/read
Job status
CLI login/test/pull
Usage dashboard
Plan quotas
Hard spend cap
No authenticated browsing
No default recordings
No broad sandbox egress

Goal: prove that users will pay for agent-accessible web rendering and safe execution.

Open-source authority boundary: the public CLI/package may contain local
fallback plan packaging for explanation and offline help, but it is never the
SSOT for entitlement. Official hosted auth, grants, usage rows, quota checks,
billing state, and provider credentials remain server-side. `/v1/plans` is
packaging/reference data; `/v1/usage` and `usage.read` are the read-only account
state surfaces, and cost-bearing tools still require hosted quota checks before
queueing.

Phase 2: Pro workflows

Add:

Browser automation
Console/network capture
Longer Agent Browser tasks and activity status
Live View for debugging
Opt-in session recording
Project-scoped grants
Artifact retention settings
Overage billing
Public crawl add-on

Cloudflare’s Live View docs support the debugging/HITL direction because Live View lets users see and interact with a remote Browser Run session in real time.

Phase 3: Future shared workspace controls

Add:

Workspace admin
Audit logs
Domain allowlists
Sandbox egress policies
User-scoped grants
Shared billing controls
Longer retention
Authenticated browsing beta
Compliance/security docs

The MVP spec

The smallest sellable v1 is:

Remote MCP tools

browser.render_url
browser.screenshot_url
browser.extract_markdown
browser.render_pdf
sandbox.run_command
sandbox.run_tests
artifact.create
artifact.get
usage.read
job.status
job.cancel

CLI

login
connect
test
jobs
artifacts
usage
limits

Dashboard

Plan usage
Recent jobs
Artifacts
Tool grants
Retention settings
Billing

Policies

No authenticated third-party browsing by default
No sandbox internet by default
No browser recording by default
No unlimited crawl
No raw Cloudflare token exposure
All tool calls quota-checked and logged
The product’s strongest positioning

I’d position it like this:

Vibecodr Tools Cloud is the safe capability layer for coding agents.

Your agent can:

See the web.
Render real pages.
Run code safely.
Create artifacts.
Track long jobs.
Ask for human help when needed.
Stay inside your team’s permissions and budget.

That is a much cleaner pitch than “a CLI for Cloudflare tools.”

My recommended launch SKU

Launch with the existing visible public plans:

Free
Limited Quick Actions and no Sandbox.

Creator — $19/mo
The self-serve default for Agent QA and safe sandboxed checks.

Pro — $39/mo
The heavier self-serve plan with capped Browser Sessions and larger quotas.

Do not launch a Team or Enterprise plan as a real SKU yet. The target is secure,
human-ready self-serve use, not enterprise procurement.

The ideal first checkout page says:

“Upgrade to Creator to give your agent Vibecodr-native QA, Agent Browser tasks,
safe sandbox execution, bounded crawls, stored artifacts, and scheduled checks.”

That’s the subscription product hiding inside the research.

is this better than what agents typically use?

I’ll compare it against the common agent stack and separate “more powerful” from “more governable.” The real question is where this beats defaults versus specialist tools.

Thought for 4m 50s

Yes — better than what many agents typically use, but not automatically better than the best specialized agent infrastructure.

The honest version: this is better than the common “agent has local shell + repo access + maybe some MCP tools” setup. It is not magically better than Browserbase for browser automation, E2B/Daytona for sandbox execution, or Codex-style cloud coding environments. The win is not any single primitive. The win is one Vibecodr-owned agent runtime layer that combines Quick Checks, Agent Browser, Sandbox, Crawl, Artifact Shelf, activity status, auth, quotas, retention, and auditability.

A lot of coding agents today are strongest around codebase access, file edits, command execution, and tool integrations. Claude Code, for example, is described as reading a codebase, editing files, running commands, and integrating with development tools; it also connects to external tools through MCP. Codex cloud is already stronger than a local-only setup because it can work in its own cloud environment, and OpenAI describes Codex’s sandbox as the boundary that lets it act without unrestricted access to the user’s machine. So the Vibecodr product is not competing against a world where agents have no tools. It is competing against increasingly capable tool stacks.

Where Vibecodr’s version is better is composition and custody. Browser automation alone already exists: Playwright MCP gives LLMs browser automation through structured accessibility snapshots, and Browserbase positions itself as a complete platform for agents that browse and interact with the web. Sandbox execution also already exists: E2B provides isolated sandboxes for agents to execute code and run tools, and Daytona offers sandboxes for agent workflows. But most of those are point solutions. The Vibecodr idea is stronger if it becomes the policy layer above those capabilities: who can use which tool, on which project, with what budget, what gets stored, what gets deleted, and what the agent is allowed to do without human approval.

That matters because the research is already pointing at exactly that shape: a Vibecodr-controlled remote MCP/tool service, with the CLI as a setup/debug/artifact helper, and Browser Run plus Sandbox SDK proven under strict auth, quotas, retention, and observability. The same research calls out the real unresolved product risks: authenticated browsing, screenshot/PDF retention, whether sandbox jobs should have internet by default, whether crawl should be a paid add-on, and whether tool grants should be workspace-, user-, or project-scoped. Those questions are exactly where “better than typical agents” lives.

On the Cloudflare side, the primitives are credible. Browser Run supports headless Chrome on Cloudflare’s network, with screenshots, PDFs, scraping, testing, and browser sessions through Puppeteer, Playwright, CDP, or Stagehand. Cloudflare Sandbox SDK is also a real fit for untrusted code execution because each sandbox runs in a separate VM with filesystem, process, network, and resource limits per sandbox. Workflows can persist state and retry multi-step jobs over minutes, hours, or weeks, which is the missing “agent job didn’t vanish into smoke” layer. And Cloudflare’s MCP authorization docs support OAuth-style limited grants instead of sharing API keys or raw credentials with clients.

So my read is:

Comparison	Is Vibecodr better?	Why
Versus a local coding agent with shell access	Yes	Safer execution, cloud browser, artifacts, quotas, less dependence on the user’s laptop
Versus a simple MCP browser plugin	Yes, if bundled with storage, auth, activity history, and policy	Most browser MCP tools are capability-first, not product/control-plane-first
Versus Browserbase for pure browser automation	Not necessarily	Browserbase is purpose-built for browser agents and identity/persistence workflows
Versus E2B/Daytona for pure sandbox execution	Not necessarily	Those are focused sandbox platforms and may be more mature for that one job
Versus Codex cloud for repo-based coding tasks	Probably not on coding-agent depth alone	Codex already has a native cloud coding environment and sandbox story
Versus the average “agent tools” setup for builders	Yes	Unified browser + sandbox + crawl + artifacts + activity status + permissions is meaningfully better

The product should not be pitched as “our browser is better” or “our sandbox is better.” That is a knife fight with specialists. The pitch should be:

“Vibecodr gives your agent hosted tools that return proof: Quick Checks, Agent Browser tasks, crawl artifacts, isolated code execution, activity history, and permissions built in.”

That is better than what agents typically use because typical setups are either too local, too scattered, too permissive, or too annoying to configure. But the moat is not the Cloudflare wrapper. The moat is the Vibecodr-native agent control plane: scoped grants, safe defaults, retention choices, usage caps, artifact custody, and a dead-simple user experience.

My strongest recommendation: build this, but don’t overclaim it as superior infrastructure. Claim it as superior packaging and trust for Vibecodr users. That’s the believable wedge.
