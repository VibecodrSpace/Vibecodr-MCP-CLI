# Local Computer Migration Execution Plan

Status: proposed execution plan
Owner surface: `@vibecodr/cli`, `Vibecodr-MCP`, and the main `vibecodr` app/API
Source pass: Orca commit `3ef4a42` (`Add Cmd-J settings and quick actions (#2769)`)
Cloudflare docs pass: checked 2026-05-25 against official Cloudflare docs linked below

## Decision

Move the meaning of `vibecodr computer` to the user's local device. When a user explicitly grants access, local agents can receive real computer-use tools for the machine they are sitting on: screenshots, app/window discovery, UI element state, pointer actions, keyboard input, paste/type, scroll, drag, set values, and native accessibility actions.

Keep the hosted tool product, but stop calling its remote code/browser execution lane a "computer." The hosted product becomes:

- `vibecodr browser`: hosted public-web browser work through Cloudflare Browser Run.
- `vibecodr sandbox`: hosted isolated command/test/code execution through Cloudflare Sandbox SDK.
- `vibecodr proof`, `vibecodr work`, `vibecodr usage`, `vibecodr grants`, `vibecodr retention`, `vibecodr scheduled-qa`, and `vibecodr dashboard`: hosted job, artifact, metering, permission, retention, and observability surfaces for browser/sandbox work.
- `vibecodr computer`: local device control, permissioned by the device owner, served by the installed CLI/local MCP server, not by the hosted MCP gateway.

This is the product split we want:

```text
Local device
  vibecodr computer
    full local UI control after explicit user grant
    local daemon, local audit, local pause/revoke

Hosted tools cloud
  vibecodr browser
    Cloudflare Browser Run Quick Actions and Browser Sessions
    public HTTPS web, crawl, screenshots, PDFs, markdown, inspect, agent tasks

  vibecodr sandbox
    Cloudflare Sandbox SDK backed code/test execution
    isolated containers, files, processes, preview URLs, artifacts

Remote MCP gateway
  openai.vibecodr.space/mcp
    hosted browser/sandbox tools and Vibecodr product tools
    no authority to grant local device control
```

## Non-Negotiables

- Full local computer control is allowed when the local user asks for it. Do not bake in a "just 30 seconds" posture as the only model.
- Full control still needs explicit permission, local visibility, and a fast revoke/pause path.
- The hosted gateway must never be able to silently self-grant local desktop authority.
- Local computer authority must be scoped to the local device. A hosted token, Clerk token, or `vc-tools` grant is not enough.
- Hosted sandbox execution stays remote. Do not weaken `docs/SECURITY.md` by turning sandbox commands into local shell execution.
- Hosted browser work stays public-web-first unless a later phase adds a separate authenticated-browser threat model.
- Keep browser and sandbox as first-class hosted offerings. The migration removes the misleading hosted "computer" label, not the hosted product.
- Preserve artifact custody, quotas, audit, and retention for hosted browser/sandbox jobs.

## Current Repo Readback

### Orca Extraction Points

Orca has a real cross-platform local computer-use stack under MIT license. The high-value pieces are separable from Orca's Electron UI and worktree features:

| Orca area | Current files | Extract into Vibecodr |
| --- | --- | --- |
| Agent-facing skill contract | `skills/computer-use/SKILL.md` | Rewrite as Vibecodr local computer guidance. Keep explicit-permission language, safety checks, and `capabilities --json` first. |
| CLI command contract | `src/cli/specs/computer.ts`, `src/cli/handlers/computer.ts`, tests | Use as command-shape reference for `vibecodr computer capabilities`, `apps`, `windows`, `state`, `screenshot`, and `action`. Adapt output style to Vibecodr CLI conventions. |
| RPC method schemas | `src/main/runtime/rpc/methods/computer.ts`, tests | Port the method schema ideas into the local daemon RPC boundary. Do not port Orca's whole runtime server. |
| Provider capability type | `src/shared/runtime-types.ts` around `ComputerProviderCapabilities` | Create a Vibecodr-owned `LocalComputerCapabilities` type with provider, platform, protocol, screenshots, apps, windows, and supported actions. |
| Sidecar process | `src/main/computer/sidecar-client.ts`, `sidecar-entry.ts` | Adapt into a CLI daemon child-process model. Replace Electron paths and `ELECTRON_RUN_AS_NODE` assumptions. |
| Windows/Linux bridge | `src/main/computer/desktop-script-provider-client.ts`, `desktop-script-provider-paths.ts` | Port the JSON operation file plus PowerShell/Python bridge pattern, with Vibecodr app-data paths and stricter cleanup. |
| Windows provider | `native/computer-use-windows/runtime.ps1` | Highest-priority provider for Vibecodr's Windows users. Rename provider strings, keep UIAutomation and blocked-app handling, add Vibecodr permission tokens. |
| Linux provider | `native/computer-use-linux/runtime.py` | Phase after Windows. Keep AT-SPI/GDK/xdotool/clipboard model, but gate on package availability. |
| macOS provider | `native/computer-use-macos/**`, `macos-native-provider-client.ts`, `macos-computer-use-permissions.ts` | Phase after Windows. Preserve native helper/token-file/socket design. Add Vibecodr naming, signing/notarization plan, Accessibility/Screen Recording guidance. |
| Packaging | `config/electron-builder.config.cjs`, `config/scripts/build-computer-macos.mjs`, `config/scripts/verify-computer-native.mjs` | Convert from Electron `extraResources` to npm package assets and platform-specific verification scripts. |
| Tests | `src/main/runtime/rpc/methods/computer.test.ts`, `desktop-script-provider-client.test.ts`, CLI tests, native verify script | Port as unit/contract tests plus opt-in native smoke tests. |

Things not to extract:

- Orca's Electron app, renderer UI, worktree management, terminal panes, browser session code, or app-specific runtime metadata.
- Orca's socket/auth model as-is. Vibecodr needs its own local daemon identity, grant store, and MCP install story.
- Any Orca branding, provider names, or assumptions that the public CLI command is `orca computer`.

License work:

- Keep the Orca MIT license notice in a third-party notice file if code is copied.
- Prefer preserving file-level provenance comments in copied native providers until they are substantially rewritten.
- Track the exact source commit in the first extraction PR.

### Vibecodr CLI Current Shape

The CLI is the hinge. Current readback shows:

- `package.json` still describes the CLI as "hosted browser, hosted computer, capsule uploads, Pulse operations, and agent-client MCP setup."
- `src/app/command-registry.ts` uses `CommandSurface = "shared" | "agent-computer" | "mcp-gateway" | "compatibility"`.
- The `computer` command is currently registered as `agent-computer` with summary "Run hosted computer commands."
- `src/bin/vibecodr-mcp.ts` delegates `browser`, `computer`, `work`, and related commands into the legacy `vc-tools` dispatcher.
- `src/hosted/worker.ts` already has clean internal capability names for browser and sandbox:
  - `browser.render_url`
  - `browser.screenshot_url`
  - `browser.extract_markdown`
  - `browser.render_pdf`
  - `browser.crawl_site`
  - `browser.agent_task`
  - `sandbox.run_command`
  - `sandbox.run_tests`
- The hosted worker still exposes sandbox capabilities through agent tool names `computer.run` and `computer.test`.
- `docs/SECURITY.md` correctly says sandbox commands are remote submissions only and the CLI never executes them locally. Keep that invariant, but move it under the hosted sandbox wording.

### Vibecodr-MCP Current Shape

The remote MCP gateway already has quota summary support for hosted tool limits:

- `src/types.ts` contains `vcTools.browser`, `vcTools.sandbox`, crawl, scheduled QA, artifact, and retention-related limit fields.
- `src/vibecodr/client.ts` parses hosted browser/sandbox limits and currently emits recommendation copy that still says "Vibecodr Agent Computer capabilities."
- Docs already warn that the MCP server is not a generic code execution sandbox.

Target: remote MCP should expose hosted browser/sandbox tools and Vibecodr product tools. Local device control belongs to a local MCP server installed by the CLI.

### Main Vibecodr Current Shape

The main repo owns product language, account grants, billing limits, dashboard routes, and admin prototypes:

- `/vc-tools` and `/vc-tools/tool-lanes` are product surfaces.
- `/settings/vc-tools/approve` owns approval UX for hosted tools grants.
- Parent API routes mint `vc-tools` grants using audience `vibecodr:vc-tools`.
- The admin-only E2B operator computer and admin Agent Computer prototype are not the public local computer feature. Keep them separate.
- `DOMAIN-REFERENCE.md` already distinguishes the private operator computer from the public Pro Agent Computer entitlement surface. The migration should update the public terminology without breaking the private admin lane.

## Current Cloudflare Grounding

Checked official Cloudflare docs on 2026-05-25. Treat these as live-current anchors before implementation, and refresh again before any code changes touching Cloudflare behavior:

- Browser Run overview: `https://developers.cloudflare.com/browser-run/`
- Browser Run Quick Actions: `https://developers.cloudflare.com/browser-run/quick-actions/`
- Browser Run CDP/browser sessions: `https://developers.cloudflare.com/browser-run/cdp/`
- Browser Run Playwright: `https://developers.cloudflare.com/browser-run/playwright/`
- Browser Run Puppeteer: `https://developers.cloudflare.com/browser-run/puppeteer/`
- Browser Run limits: `https://developers.cloudflare.com/browser-run/limits/`
- Sandbox SDK architecture: `https://developers.cloudflare.com/sandbox/concepts/architecture/`
- Sandbox SDK security: `https://developers.cloudflare.com/sandbox/concepts/security/`
- Sandbox SDK limits: `https://developers.cloudflare.com/sandbox/platform/limits/`
- Workflows: `https://developers.cloudflare.com/workflows/`
- Queues batching/retries: `https://developers.cloudflare.com/queues/configuration/batching-retries/`

Cloudflare fit that survives this migration:

- Browser Run remains the right hosted browser substrate.
- Browser Run Quick Actions remain the default lane for stateless render/screenshot/markdown/PDF/crawl outputs.
- Browser Sessions remain the lane for longer browser automation, Playwright/Puppeteer/CDP/Stagehand sessions, live view, human-in-the-loop, and recording where available and plan-gated.
- Sandbox SDK remains the hosted command/test execution lane. It runs in Cloudflare's Worker/Durable Object/Container architecture, not on the user's local machine.
- Workflows remain the orchestration lane for durable long-running browser agent tasks.
- Queues and DLQ remain the retry/backpressure lane for bounded async hosted work.
- D1/R2 remain job, audit, usage, retention, artifact index, and artifact byte custody surfaces.

## Target Product Surface

### Local Computer

CLI commands:

```text
vibecodr computer status
vibecodr computer capabilities --json
vibecodr computer grant --agent codex --scope desktop --until revoked
vibecodr computer grant --agent claude-desktop --scope app --app "Chrome" --until 4h
vibecodr computer pause
vibecodr computer resume
vibecodr computer revoke --agent codex
vibecodr computer audit --tail
vibecodr computer daemon start --foreground
vibecodr computer daemon stop
vibecodr computer doctor
```

MCP tools served locally by the CLI:

```text
local_computer.capabilities
local_computer.screenshot
local_computer.apps
local_computer.windows
local_computer.state
local_computer.click
local_computer.type_text
local_computer.paste_text
local_computer.press_key
local_computer.hotkey
local_computer.scroll
local_computer.drag
local_computer.set_value
local_computer.perform_action
local_computer.pause
```

Full-control grant model:

- `observe`: screenshot, apps, windows, element tree/state.
- `app`: observe plus actions within a selected app/window.
- `desktop`: global pointer, keyboard, clipboard, app/window control across the desktop.
- `trusted-agent`: durable `desktop` authority until revoked, intended for users who explicitly want a long-lived local assistant.

Time model:

- `--until revoked` is valid for users who want persistent full control.
- Short sessions like `--until 30m` or `--until 4h` are convenience options, not the only permitted posture.
- `pause` freezes all action methods immediately while leaving grants visible for later resume.
- `revoke` removes the grant and invalidates local session tokens.

### Hosted Browser

CLI commands should stay first-class:

```text
vibecodr browser render https://example.com
vibecodr browser read https://example.com
vibecodr browser screenshot https://example.com --out ./proof
vibecodr browser pdf https://example.com --out ./proof
vibecodr browser crawl https://example.com --limit 20
vibecodr browser snapshot https://example.com --wait
```

Hosted browser capabilities:

- Render public HTTPS pages.
- Extract markdown/readable text.
- Capture screenshots.
- Generate PDFs.
- Crawl bounded public sites.
- Inspect links, metadata, console/network summaries where supported.
- Run Browser Session based agent tasks for plan-gated long-running automation.
- Support live view, human-in-the-loop, and recording only as explicitly gated Browser Session features.
- Save useful outputs to hosted artifacts.
- Meter browser seconds and enforce plan/account concurrency.

### Hosted Sandbox

The hosted sandbox should be named directly:

```text
vibecodr sandbox run "node -e \"console.log('ok')\"" --wait
vibecodr sandbox test --project ./some-uploaded-artifact --wait
vibecodr sandbox files list <job-id>
vibecodr sandbox files get <job-id> path/to/file --out ./proof
vibecodr sandbox preview <job-id> --port 3000
```

Hosted sandbox capabilities:

- Run commands in isolated Cloudflare Sandbox SDK environments.
- Run test commands with bounded timeout and output caps.
- Upload/download files through hosted artifact policy.
- Manage background processes where the provider supports it.
- Expose temporary preview URLs for services started inside the sandbox.
- Capture logs, exit codes, file artifacts, and proof metadata.
- Enforce sandbox network policy. Public HTTP(S) docs/package access can remain paid-plan gated; private/local/link-local/metadata/internal hosts stay blocked.
- Meter sandbox seconds and enforce plan/account concurrency.

### Hosted Work And Proof

Keep the supporting surfaces:

```text
vibecodr work list
vibecodr work status <job-id>
vibecodr work cancel <job-id>
vibecodr proof list
vibecodr proof save <artifact-id> --out ./proof
vibecodr usage
vibecodr grants
vibecodr retention
vibecodr scheduled-qa
vibecodr dashboard
```

These remain hosted because they refer to hosted browser/sandbox jobs, artifacts, quotas, retention, and audit rows.

## Local Computer Architecture

Plain-text architecture:

```text
Agent client
  |
  | local MCP stdio/http
  v
@vibecodr/cli local MCP server
  |
  | local named pipe / unix socket, short-lived bearer token
  v
Vibecodr Computer daemon
  |
  +-- grant store
  |     local OS keychain for bearer material
  |     local app-data grant metadata with owner-only ACLs
  |
  +-- audit log
  |     local append-only action/event records
  |     optional redacted cloud sync later
  |
  +-- provider sidecar
        Windows: PowerShell UIAutomation provider
        macOS: Swift accessibility helper
        Linux: Python AT-SPI/GDK/xdotool provider
```

Daemon responsibilities:

- Own all local grants, sessions, and pause/revoke state.
- Authenticate every local caller with a local-only bearer token.
- Bind each grant to an agent/client identity and the current OS user.
- Expose a stable RPC protocol to the CLI and local MCP tools.
- Spawn and monitor the platform provider sidecar.
- Normalize provider capabilities and errors.
- Write local audit records for observations and actions.
- Keep screenshots local by default unless a user explicitly saves or shares them.

Provider responsibilities:

- Talk to OS accessibility/UI automation APIs.
- Return structured capabilities.
- Return screenshots and element/window/app state.
- Execute only the normalized action set allowed by the daemon.
- Preserve provider-level blocked-app defaults for password managers and sensitive system panes.
- Return permission-denied states clearly instead of silently degrading.

Why the daemon exists:

- A stateless CLI command cannot safely be the long-lived authority holder.
- MCP tools need low-latency repeated calls without restarting native providers every time.
- Pause/revoke must interrupt active sessions immediately.
- The local grant store must have one owner rather than each agent client inventing one.

## Permission And Safety Model

Local grants:

- Are created only from local user action: CLI prompt, browser callback from local CLI, or future native tray UI.
- Are visible in `vibecodr computer status`.
- Can be paused or revoked locally even when the agent client is still running.
- Are separate from hosted `vc-tools` grants.
- Are not minted by `openai.vibecodr.space/mcp`.
- Are not accepted by hosted browser/sandbox APIs.

Local session tokens:

- Are generated by the daemon.
- Are stored in the OS credential store when durable.
- Are scoped to the local socket/pipe.
- Are never printed in normal output.
- Are not reusable against `tools.vibecodr.space` or `openai.vibecodr.space`.

Sensitive actions:

- Full control means the agent can drive real UI. The product should be honest about that.
- The daemon should still require high-friction confirmation for grant creation and for changing grant scope upward.
- Seed blocked-app fragments from Orca for password managers and sensitive credential apps.
- Let advanced users override blocked-app defaults only with explicit per-app allow records and loud audit entries.
- For posting, purchasing, deleting, changing settings, signing in, or exposing secrets, agent guidance should require explicit user permission even inside a broad grant.
- Clipboard writes and paste actions should be audited distinctly.
- Screenshots should be treated as local sensitive data. Any cloud upload or artifact save must be an explicit user/tool action with redaction policy.

Visibility:

- `vibecodr computer status` must show enabled/paused, current grants, connected clients, provider, and last action.
- `vibecodr computer audit --tail` must be easy to run.
- A tray/status indicator is desirable after CLI MVP, especially for durable grants.
- `Ctrl+C` in foreground daemon mode must pause or stop cleanly.

Remote agent to local device:

- Same-machine local agents are the first supported lane.
- A future remote-to-local lane must use an outbound local relay pairing flow with visible local approval, short-lived session binding, and local revoke.
- Do not treat the hosted MCP gateway as the local computer relay by default.

## Repo Execution Plan

### Phase 0 - ADR And Naming Freeze

Goal: create a stable product vocabulary before moving code.

CLI repo:

- Add this plan as the seed ADR.
- Add a follow-up ADR named something like `docs/HOSTED-TOOLS-NAMING.md`.
- Freeze new public copy that says "hosted Agent Computer" unless it refers to deprecated compatibility.
- Decide internal terms:
  - Recommended public: `Computer`, `Browser`, `Sandbox`.
  - Recommended internal surfaces: `local-computer`, `hosted-tools`, `mcp-gateway`, `compatibility`.
  - Deprecated public: hosted `computer.run`, hosted `computer.test`.

Main repo:

- Identify all public strings that say "Agent Computer" for hosted browser/sandbox.
- Decide whether `/vc-tools` keeps its URL and changes content to "Vibecodr Tools" or whether a later `/tools` URL is needed.
- Keep admin/private operator-computer terminology out of the public migration unless explicitly referenced.

MCP repo:

- Decide remote MCP tool naming:
  - Prefer `browser.*`, `sandbox.*`, `proof.*`, `work.*`, `usage.*`.
  - Do not list `local_computer.*` from the hosted gateway.

### Phase 1 - Extract Local Computer Core Behind A Flag

Goal: make local provider code compile and test inside the CLI without changing default behavior.

CLI repo changes:

- Add `src/local-computer/`:
  - `capabilities.ts`
  - `protocol.ts`
  - `daemon.ts`
  - `client.ts`
  - `grants.ts`
  - `audit.ts`
  - `paths.ts`
  - `provider-sidecar.ts`
  - `providers/desktop-script-provider.ts`
  - `providers/macos-native-provider.ts`
- Add `native/local-computer/windows/runtime.ps1` based on Orca's Windows provider.
- Add `native/local-computer/linux/runtime.py` based on Orca's Linux provider.
- Add `native/local-computer/macos/` based on Orca's Swift package, but keep macOS disabled until signing/permissions are settled.
- Add `scripts/verify-local-computer-native.mjs`.
- Add `test/local-computer/*.test.ts`.
- Add package artifact checks so the published npm package includes native assets.
- Add `VIBECDR_LOCAL_COMPUTER_EXPERIMENTAL=1` to enable the surface.

Implementation notes:

- Replace Orca provider strings with `vibecodr-local-computer-windows`, `vibecodr-local-computer-linux`, and `vibecodr-local-computer-macos`.
- Replace Electron resource path logic with npm package relative paths and app-data runtime paths.
- Keep the JSON operation-file bridge for Windows/Linux because it is simple and auditable.
- Add operation file cleanup and owner-only permissions.
- Keep PowerShell invocation non-interactive and hidden on Windows.
- Convert Orca runtime schemas to Vibecodr-owned Zod schemas or equivalent local validation.

Verification:

- `npm run check`
- `npm test`
- `npm run verify`
- `npm run verify:local-computer-native`
- Package tarball inspection for native assets.

### Phase 2 - Windows Local Computer MVP

Goal: ship a usable Windows local computer behind explicit experimental opt-in.

CLI commands:

- `vibecodr computer status`
- `vibecodr computer capabilities --json`
- `vibecodr computer daemon start --foreground`
- `vibecodr computer grant --agent <id> --scope desktop --until revoked`
- `vibecodr computer pause`
- `vibecodr computer resume`
- `vibecodr computer revoke`
- `vibecodr computer audit --tail`
- `vibecodr computer doctor`

Windows provider smoke:

- `capabilities` returns provider, protocol version, platform, and supported actions.
- `screenshot` returns non-empty image bytes and dimensions.
- `apps` and `windows` return structured data.
- `state` works for a known benign app such as Notepad.
- `click`, `type_text`, `press_key`, `hotkey`, `paste_text`, and `scroll` work in a benign app.
- Password manager blocked-app checks return denied action results.

Test strategy:

- Unit test grant store, audit, path resolution, redaction, command parsing, daemon auth, and protocol schemas.
- Contract test provider command payloads without moving the real pointer.
- Add opt-in native smoke tests guarded by environment variables, for example `VIBECDR_LOCAL_COMPUTER_NATIVE_SMOKE=1`.
- Keep tests deterministic enough for CI without requiring desktop access.

### Phase 3 - Local MCP Server Integration

Goal: let agent clients use local computer tools through the installed CLI.

CLI repo changes:

- Extend install flow:
  - `vibecodr agent connect --client codex --local-computer`
  - or `vibecodr install --client codex --include local-computer`
- Add local MCP tool descriptors for `local_computer.*`.
- Ensure local MCP server checks daemon status and grant scope before every action.
- Return clear errors:
  - `local_computer.not_enabled`
  - `local_computer.permission_required`
  - `local_computer.paused`
  - `local_computer.provider_unavailable`
  - `local_computer.action_denied`
- Add `computer-use` skill guidance to install output for compatible agent clients.
- Keep local computer tools out of hosted remote MCP discovery.

Security tests:

- Local MCP cannot call action tools without a matching local grant.
- Hosted `vc-tools` grants do not authorize local computer tools.
- A local grant for one client id does not authorize another client id.
- Paused grants deny actions and allow status/audit.
- Tokens are redacted in text and JSON error paths.

### Phase 4 - Recast Hosted CLI As Browser And Sandbox

Goal: remove misleading hosted-computer semantics while keeping compatibility.

CLI repo changes:

- Rename `CommandSurface`:
  - from `agent-computer`
  - to `hosted-tools` and `local-computer`
- Reclassify commands:
  - `computer`: local-computer
  - `browser`: hosted-tools
  - `sandbox`: hosted-tools
  - `work`, `proof`, `usage`, `grants`, `retention`, `scheduled-qa`, `plans`, `dashboard`: hosted-tools
  - `start`, `setup`, `try`, `agent`, `auth`, `connect`: shared or hosted-tools depending on final semantics.
- Add a real `sandbox` top-level command.
- Stop routing `computer` into the legacy hosted dispatcher once local computer is enabled.
- Keep compatibility:
  - `computer run` prints a deprecation warning and routes to `sandbox run` for one major version.
  - `computer test` prints a deprecation warning and routes to `sandbox test` for one major version.
  - JSON output must include a machine-readable deprecation field before removal.
- Update `package.json` description and keywords.
- Update `src/app/help.ts`.
- Update `docs/architecture.md`.
- Update `docs/SECURITY.md`.
- Update `docs/CLOUDFLARE-PRIMITIVE-FIT.md`.
- Update legacy output baselines intentionally, with a compatibility matrix.

Hosted worker changes:

- Rename agent instructions from "hosted Vibecodr Agent Computer" to "hosted Vibecodr Tools Cloud."
- Change MCP tool aliases:
  - `computer.run` -> compatibility alias for `sandbox.run`
  - `computer.test` -> compatibility alias for `sandbox.test`
  - new first-class names: `sandbox.run`, `sandbox.test`
- Keep internal capability names `sandbox.run_command` and `sandbox.run_tests`.
- Keep `browser.*` capabilities as-is.
- Update audit event names only if there is a migration strategy. Prefer preserving internal event names until a later cleanup if dashboards depend on them.

Verification:

- Existing hosted browser/sandbox tests still pass.
- Compatibility aliases are tested.
- `vibecodr computer status` exercises local computer path, not hosted legacy path.
- `vibecodr sandbox run` exercises hosted worker path, not local shell.
- `docs/SECURITY.md` still says sandbox execution is remote.

### Phase 5 - MCP Gateway Tool Catalog Split

Goal: make the remote MCP surface tell the truth.

Vibecodr-MCP changes:

- Update tool descriptors to expose hosted:
  - `browser.render`
  - `browser.screenshot`
  - `browser.read`
  - `browser.pdf`
  - `browser.crawl`
  - `browser.snapshot` or `browser.agent_task`
  - `sandbox.run`
  - `sandbox.test`
  - `proof.get`
  - `work.status`
  - `work.cancel`
  - `usage.status`
- Keep `computer.run` and `computer.test` only as hidden or deprecated compatibility aliases if required.
- Update tool instructions to say local computer control is provided by the installed CLI/local MCP server.
- Update quota recommendation copy in `src/vibecodr/client.ts`:
  - "Vibecodr Agent Computer capabilities" -> "Vibecodr hosted tools capabilities"
  - Keep "Quick Checks", "Agent Browser", "Sandbox", "Crawl", "Artifact Shelf" as hosted product lanes.
- Add a read-only informational tool only if needed:
  - `local_computer.setup_instructions`
  - It must not control the device and must not imply hosted authority.
- Update docs:
  - `docs/build-with-vibecodr-mcp.md`
  - `docs/mcp-client-setup.md`
  - `docs/mcp-server.md`
- Update schema snapshots and visible tool count tests.

Security invariants:

- Remote MCP OAuth scopes authorize hosted tools only.
- Remote MCP cannot mint local grants.
- Remote MCP cannot receive local screenshots by default.
- Remote MCP can link to CLI install docs for local computer setup.

### Phase 6 - Main Vibecodr Product And API Alignment

Goal: align site, plan limits, account settings, and docs with the split.

Main repo changes:

- Update product copy:
  - `/vc-tools`
  - `/vc-tools/tool-lanes`
  - `/settings/vc-tools/approve`
  - pricing/plan copy where vc-tools appears
  - public docs pages that mention Agent Computer as hosted browser/sandbox
- Update account/grant labels:
  - `vc-tools:use` can remain as the hosted tools umbrella scope.
  - Add more specific hosted labels for UI where useful:
    - `vc-tools:browser`
    - `vc-tools:sandbox`
    - `vc-tools:artifacts`
  - Do not add server-side local computer grants unless a future relay service is explicitly designed.
- Update API docs and generated references:
  - `docs/DOMAIN-REFERENCE.md`
  - `docs/SYSTEMS-REFERENCE.md`
  - `docs/WORKER-LANDSCAPE.md`
  - `docs/agent-context/*` where vc-tools, Browser Run, or Agent Computer appears.
- Keep private admin E2B operator-computer routes clearly admin-only and not the public local device feature.
- Preserve `workers/api/src/lib/vcToolsGrant.ts` compatibility unless a migration explicitly renames scopes.
- Update `workers/api/src/lib/vcToolsBillingUsage.ts` and tests only if response labels change.
- Update system map after code route/doc ownership changes if the repo requires it.

Hosted infrastructure that stays:

- Browser Run binding and owned-surface WAF allowlist.
- Cloudflare Sandbox SDK bindings and container classes.
- D1 `vc-tools-db` job/artifact/usage/audit tables.
- R2 artifact storage.
- Queues/DLQ.
- Workflows for browser agent tasks.
- Internal operator alerting for capacity, cleanup, execution health, hosted 5xx, auth anomaly, and spend anomaly.

### Phase 7 - macOS And Linux Local Providers

Goal: bring parity after Windows MVP proves the daemon contract.

macOS:

- Rename and build Swift helper.
- Decide signing/notarization distribution path.
- Implement permission doctor for Accessibility and Screen Recording.
- Preserve token-file and local socket validation.
- Add helper app installation/update flow.
- Add native smoke test instructions.

Linux:

- Verify AT-SPI, GDK, xdotool, and clipboard dependencies.
- Add distro-specific doctor output.
- Add Wayland/X11 support matrix.
- Fail clearly when the desktop environment blocks automation.
- Add native smoke tests for a benign app where CI or local test machines allow it.

### Phase 8 - Deprecation And Cleanup

Goal: remove the old hosted `computer.*` surface when usage is low and compatibility window is over.

Steps:

- Emit warnings for hosted `computer.run` and `computer.test`.
- Track usage of deprecated aliases.
- Update docs to use `sandbox.*` only.
- Move old docs into `docs/legacy/`.
- Remove alias tests only when the public removal version is reached.
- Do not delete hosted artifacts, usage rows, or audit rows from old jobs before retention policy allows it.
- Keep database capability strings stable internally if changing them would create migration risk. Public names can change first.

## File Change Map

### `@vibecodr/cli`

High-confidence changes:

- `package.json`
  - Update description and keywords.
  - Add native verification script.
  - Ensure package files include native local-computer assets.
- `src/app/command-registry.ts`
  - Split `agent-computer` into `hosted-tools` and `local-computer`.
  - Reclassify `computer`.
  - Add `sandbox`.
- `src/bin/vibecodr-mcp.ts`
  - Stop routing `computer` to legacy hosted dispatcher.
  - Route `sandbox` to hosted dispatcher.
  - Keep compatibility alias logic for old `computer run/test`.
- `src/app/help.ts`
  - Rewrite examples around `browser`, `sandbox`, and local `computer`.
- `src/commands/*`
  - Add local computer command module.
  - Add sandbox command module or clean top-level routing to hosted sandbox.
- `src/hosted/worker.ts`
  - Rename public instructions.
  - Add `sandbox.run` and `sandbox.test` first-class MCP tool names.
  - Keep deprecated `computer.run/test` aliases.
- `src/legacy/**`
  - Touch only where compatibility baselines require it.
- `docs/architecture.md`
  - Explain local computer vs hosted tools.
- `docs/SECURITY.md`
  - Add local computer trust boundary.
  - Preserve remote-only sandbox rule.
- `docs/CLOUDFLARE-PRIMITIVE-FIT.md`
  - Reframe Browser Run and Sandbox SDK as hosted tools after local computer migration.
- `docs/legacy/*`
  - Mark older Agent Computer docs as legacy.
- `test/**`
  - Add local daemon, grant, MCP, and compatibility tests.
- `scripts/**`
  - Add native verification.
  - Add package artifact verification if absent.

New folders:

- `src/local-computer/`
- `native/local-computer/`
- `test/local-computer/`

### `Vibecodr-MCP`

High-confidence changes:

- `src/types.ts`
  - Rename public recommendation wording while keeping `vcTools` structure stable unless the API changes.
- `src/vibecodr/client.ts`
  - Replace "Agent Computer" hosted copy with "hosted tools."
  - Keep Quick Checks, Agent Browser, Sandbox, Crawl, and Artifact Shelf recommendations.
- `src/mcp/tools.ts` or current tool descriptor owner
  - Expose `sandbox.*` first-class tools.
  - Hide or deprecate `computer.*` hosted aliases.
- `src/mcp/handler.ts`
  - Preserve compatibility routing.
- `docs/build-with-vibecodr-mcp.md`
  - Clarify remote MCP does not control local devices.
- `docs/mcp-client-setup.md`
  - Point local computer setup to CLI local MCP install.
- `docs/mcp-server.md`
  - Update OAuth scope descriptions.
- `test/**`
  - Tool list snapshots.
  - Deprecated alias tests.
  - Auth/scope tests.

### Main `vibecodr`

High-confidence changes:

- `apps/web/app/(site)/vc-tools/page.tsx`
  - Product wording: hosted Browser, hosted Sandbox, local Computer.
- `apps/web/app/(site)/vc-tools/tool-lanes/page.tsx`
  - Split lanes.
- `apps/web/app/(site)/settings/vc-tools/approve/page.tsx`
  - Approval copy: hosted tools grant, not local computer grant.
- `workers/api/src/lib/vcToolsGrant.ts`
  - Keep hosted grant semantics; add labels/scopes only if UI/API needs them.
- `workers/api/src/lib/vcToolsBillingUsage.ts`
  - Update labels from Agent Computer to hosted tools if surfaced.
- `workers/api/src/routes/coreRoutes.ts`
  - Device grant routes remain hosted tools approval, not local computer permission.
- `workers/api/src/routes/userAccountRoutes.ts`
  - API key copy should say hosted tools.
- `docs/DOMAIN-REFERENCE.md`
  - Add local computer product boundary and keep private E2B operator computer separate.
- `docs/SYSTEMS-REFERENCE.md`
  - Update system descriptions.
- `docs/WORKER-LANDSCAPE.md`
  - Keep `vc-tools-db` as hosted tools DB.
- `docs/agent-context/*`
  - Update references that agents use for product truth.
- `docs/SYSTEM-MAP.md` / generated map
  - Regenerate only if source routes/owners change.

Watch-outs:

- The main repo has many scoped `AGENTS.md` files. Read the relevant scoped file before editing any path.
- Keep generated files out of manual edits unless the repo's generator owns them.
- Do not conflate the admin E2B operator computer with the public local computer.

## Compatibility Matrix

| Old command/tool | New public shape | Compatibility behavior |
| --- | --- | --- |
| `vibecodr computer run ...` | `vibecodr sandbox run ...` | Warn and route to hosted sandbox during compatibility window. |
| `vibecodr computer test ...` | `vibecodr sandbox test ...` | Warn and route to hosted sandbox during compatibility window. |
| `computer.run` MCP tool | `sandbox.run` MCP tool | Hidden/deprecated alias if old clients need it. |
| `computer.test` MCP tool | `sandbox.test` MCP tool | Hidden/deprecated alias if old clients need it. |
| "hosted Agent Computer" docs | "hosted browser/sandbox tools" | Update active docs, archive legacy docs. |
| `vibecodr computer status` | local computer status | New local-device command. |
| `vibecodr computer grant` | local grant | New local-device command. |

## Verification Matrix

### CLI Local

- `npm run check`
- `npm test`
- `npm run verify`
- `npm run verify:local-computer-native`
- `npm pack --dry-run` or package-file assertion to prove native assets ship.
- `vibecodr computer capabilities --json` on Windows with experimental flag.
- `vibecodr computer grant --agent codex --scope desktop --until revoked`
- Local MCP tool call without grant is denied.
- Local MCP tool call with grant succeeds.
- `pause` denies action calls immediately.
- `revoke` invalidates active session.
- Redaction tests prove local tokens do not appear in stdout/stderr/JSON errors.

### CLI Hosted

- `vibecodr browser screenshot https://vibecodr.space/vc-tools --out ./proof`
- `vibecodr sandbox run "node -e \"console.log('ok')\"" --wait`
- `vibecodr work status <job-id>`
- `vibecodr proof save <artifact-id> --out ./proof`
- Deprecated `computer run/test` route to hosted sandbox with warning.
- `docs/SECURITY.md` still verifies sandbox commands are remote submissions only.

### Hosted Worker

- Unit tests for capability normalization.
- MCP `tools/list` shows `sandbox.*` first-class.
- `computer.*` aliases are present only as compatibility if intentionally kept.
- Browser Run Quick Actions still store artifacts.
- Browser Session workflow still rejects queue execution and uses Workflow lane.
- Sandbox jobs still use Cloudflare Sandbox SDK and outbound policy.
- D1/R2/Queue/Workflow tests remain green.

### Vibecodr-MCP

- `npm run check`
- `npm test`
- Tool list snapshot.
- OAuth scope regression.
- Hosted browser tool smoke if staging/live credentials are available.
- Hosted sandbox tool smoke if staging/live credentials are available.
- No local computer control tool appears from the remote gateway.

### Main Vibecodr

- `pnpm run check`
- Targeted tests for `vcTools` limit parsing/copy if changed.
- Route tests for `/vc-tools`, `/vc-tools/tool-lanes`, and approval pages.
- API grant tests for hosted tools scopes.
- System map/doc generation if required.
- Live post-deploy readback for hosted browser/sandbox, not for local computer.

## Rollout Plan

Recommended order:

1. Land docs/ADR in CLI repo.
2. Land naming-only PRs that introduce `sandbox` while keeping old hosted `computer` aliases.
3. Land local computer daemon behind experimental flag.
4. Land Windows local MVP and local MCP tools behind explicit opt-in.
5. Update MCP gateway to expose hosted `sandbox.*` names and stop advertising remote local computer.
6. Update main Vibecodr public product copy and approval copy.
7. Run hosted browser/sandbox live proofs.
8. Run local Windows proof on a real desktop.
9. Announce compatibility window for hosted `computer.run/test`.
10. Remove hosted `computer.*` aliases in the next major release after usage is low.

Release gates:

- Do not release local computer until pause/revoke works.
- Do not release local MCP tools until no-grant denial is tested.
- Do not rename hosted `computer.*` without compatibility warnings.
- Do not edit Cloudflare-bound behavior without refreshing official docs again.
- Do not claim macOS/Linux support until native provider smoke tests pass on those OSes.

## Open Questions

1. Do we want `vibecodr computer` to auto-start the daemon or require `vibecodr computer daemon start` first?
2. Should the first durable grant scope be called `trusted-agent`, `full`, or `desktop`?
3. Should app-specific grants be app-name based, process-id based, window-id based, or a combination?
4. How loud should blocked-app overrides be for users who explicitly want full control?
5. Should local audit logs be local-only forever, or can users opt into syncing redacted audit summaries to Vibecodr?
6. Do we need a native tray indicator before public release, or is CLI status enough for the first experimental release?
7. Should remote-to-local relay be a separate paid feature, or only a future advanced local pairing mode?
8. Should `/vc-tools` remain the canonical product URL, or should main Vibecodr add `/tools` as the clearer public URL later?

## First Implementation PR Shape

The first code PR should be narrow:

- Add `src/local-computer/protocol.ts` and `capabilities.ts`.
- Add daemon skeleton with no native actions.
- Add grant store and audit interfaces.
- Add `vibecodr computer status` and `capabilities --json` behind `VIBECDR_LOCAL_COMPUTER_EXPERIMENTAL=1`.
- Add tests proving:
  - default disabled state
  - local grant/token redaction
  - hosted grants do not authorize local computer
  - command registry classifies `computer` as local-computer when the flag is enabled
- No hosted worker behavior changes in that PR.

The second PR should port Windows provider assets and the provider-sidecar bridge.

The third PR should add local MCP tools.

The fourth PR should recast hosted `computer.run/test` as `sandbox.run/test` with compatibility aliases.

That sequencing keeps the blast radius sane: first establish local trust boundaries, then native control, then agent access, then public hosted naming.
