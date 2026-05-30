# Changelog

Pre-1.0.0 history for the `@vibecodr/cli@0.2.x` and `0.1.x` lines lives at [`docs/legacy/CHANGELOG-mcp-cli.md`](docs/legacy/CHANGELOG-mcp-cli.md). The `@vibecodr/vc-tools@0.1.x` line was the other half of the May 2026 merge; its source history is preserved in the archived [`BradenHartsell/vc-tools`](https://github.com/BradenHartsell/vc-tools) repository.

## 1.0.14

Renames the note-attaching snapshot helper to match what it does.

- `vibecodr browser notes <url> --note <text>` is now the visible command for saving a note with a Browser snapshot.
- The previous command spelling remains a hidden compatibility alias for existing scripts, but help, errors, and docs point users to `browser notes`.
- Browser help now simply says `browser notes` saves your note with the snapshot.

## 1.0.13

Makes `browser snapshot` a plain capture command instead of a confusing ask-style lane.

- `vibecodr browser snapshot <url>` no longer advertises or accepts `--instructions`; the help text now says plainly that snapshot captures page state and does not prompt an agent or model.
- The old advanced compatibility alias uses `--note`, and the help text says it saves that note with the snapshot.
- The hosted MCP `browser.snapshot` tool schema no longer exposes `instructions` or `actions`; raw `browser.agent_task` remains the lower-level compatibility capability for advanced callers.

## 1.0.12

Makes hosted Agent Computer outputs visible and easy to save from the first command result.

- `vibecodr browser ...`, `vibecodr computer ...`, and `vibecodr work follow` now accept `--local`, which waits for the hosted job and saves the completed artifact into `./vibecodr-proof`.
- Completed output now includes the artifact handle plus ready-to-run `vibecodr proof show` and `vibecodr proof save` commands instead of returning only `{ "status": "completed" }`.
- Root help, command help, docs, fixtures, and tests now advertise and lock the `--local` path for the simplest user flow.

## 1.0.11

Supersedes 1.0.10 with the same CLI auth guidance plus a release-packaging guard.

- `prepack`, `publish:release`, and `verify:artifact` now remove and forbid `dist/dryrun/` so Wrangler dry-run output can never be swept into the npm package.
- Published after the `vc-tools-api` worker read back `1.0.10`; the runtime behavior remains the first-run guidance from 1.0.10.

## 1.0.10

Aligns the CLI first-run guidance with the Vibecodr CLI product pages without renaming Agent Computer, MCP Gateway, or the underlying credential lanes.

- `vibecodr --help` and `vibecodr login --help` now put `vibecodr start` first for the normal Agent Computer account connection, while keeping `vibecodr login` as the explicit MCP Gateway login for publishing, uploads, Pulses, and MCP Gateway tools.
- `vibecodr status` now points brand-new users to `vibecodr start` first. After Agent Computer is connected, missing MCP Gateway auth is framed as optional and scoped to the MCP Gateway/publishing surfaces.
- `vibecodr doctor` and `vibecodr install` now use the same setup boundary: apps own their MCP Gateway OAuth sessions, and `vibecodr start` owns Agent Computer setup.
- Docs and tests lock the behavior while preserving the separate `@vibecodr/vc-tools` and `@vibecodr/mcp` credential stores internally.

## 1.0.9

Fixes the hosted Agent Computer MCP auth contract at `tools.vibecodr.space/mcp`.

- `src/hosted/worker.ts`: publishes OAuth protected-resource metadata for `/mcp`, includes `WWW-Authenticate` resource metadata and scope hints on unauthenticated MCP POSTs, returns unauthenticated 404s for authorization-server discovery probes on the tools host, and keeps those discovery probes out of `auth.failed` anomaly metrics.
- `src/legacy/cli/run.ts`: stops `vibecodr agent connect --client <editor>` from writing or printing bare named-client configs for `tools.vibecodr.space/mcp` until a supported `vc_tools` client auth flow is proven. The Agent Computer CLI credential lane remains available through `vibecodr start`, `vibecodr try`, and direct CLI commands.
- `src/commands/install.ts`: refuses `vibecodr install <client>` when the active MCP profile points at `tools.vibecodr.space/mcp`; `install` is for the OAuth-backed MCP Gateway profile, normally `https://openai.vibecodr.space/mcp`.
- Docs and tests now lock the separation between the MCP Gateway OAuth lane and the hosted Agent Computer `vc_tools` grant lane.

## 1.0.7

Verbiage and discoverability cleanup driven by user reports on 1.0.6.

**1. Every user-facing string now teaches `vibecodr`, not `vc-tools`.** Through 1.0.6, the dispatcher correctly cross-routed commands like `agent`, `browser`, `retention` from the canonical `vibecodr` / `vibecodr-mcp` bins, but the legacy dispatcher's help text, Usage lines, error nextStep hints, version banner, and Examples block still printed `vc-tools <command>` everywhere. Running `vibecodr agent -h` would show `Usage: vc-tools agent connect`. Running `vibecodr retention` (no subcommand) would error with `Use vc-tools retention show`. ~176 hits in `src/legacy/cli/run.ts` plus 5 docs files, 4 output-baseline fixtures, and assorted test assertions are now aligned. The compatibility-only `vc-tools` bin still ships, but it now teaches `vibecodr <command>` in its own help to nudge users toward the canonical name.

The package name (`@vibecodr/cli`), the `vc-tools` bin entry, the OS keyring service IDs, the legacy `VC_TOOLS_*` env var aliases, the legacy config dir migration paths, the `serverName: "vc-tools"` default for MCP client install entries, and the `.vc-tools.bak` backup-file suffix on legacy MCP upgrades all kept their existing names — those are real identifiers that would break orphan stored credentials / installed agent clients / migration on rename.

- `src/legacy/cli/run.ts`: dispatcher-side user-facing strings flipped from `vc-tools` to `vibecodr`.
- `src/legacy/cli/install.ts`, `src/legacy/config/store.ts`, `src/legacy/core/api-client.ts`, `src/legacy/core/validators.ts`: error messages and prose aligned.
- `docs/{commands,API-CONTRACT,RELEASE-CHECKLIST,SECURITY,VALIDATION-MATRIX}.md`: command examples flipped to `vibecodr`.
- `test/legacy/cli.behavior.test.ts`, `test/cli-dispatch.test.ts`: assertions flipped to the new verbiage.
- `test/fixtures/output-baseline/vc-tools-{doctor,plans,start,status}.json`: fixture contents updated (filenames stay opaque keys).
- Default `vibecodr try` output dir flipped from `vc-tools-proof/` to `vibecodr-proof/`.

**2. `vibecodr --help` reorganized.** Through 1.0.6 the help text had a flat `Advanced / diagnostic:` line listing `auth, setup, connect, inspect, jobs, artifacts, grants, retention, scheduled-qa, limits` — most of which are either redundant aliases (`setup`=`start`, `limits`=`usage`, `jobs`=`work`, `artifacts`=`proof`, `connect`=`agent connect`) or genuinely useful product features the user didn't realize were available. The help now:
- **Hides the redundant aliases and the dev-only `inspect` command** from `--help`. The routing stays — existing scripts that learned `vc-tools jobs list` still work — they're just no longer advertised in the canonical bin's help.
- **Promotes the real product features into their own `Account policy & monitoring:` section** with inline subcommand hints: `grants`, `retention <show|set>`, `scheduled-qa <list|create|pause|resume|delete>`. These hit real authenticated endpoints (`GET /grants`, `GET /retention`, the `*/scheduled-qa` family) and were buried.
- **Surfaces `auth` in a dedicated `Automation handoff:` section** with the `<diagnose|status|export-agent-env>` subcommand hint, framed as the CI/automation credential workflow it actually is (rather than as "diagnostic" alongside random aliases).
- **Adds inline subcommand syntax** to the Hosted Agent Computer section (e.g., `agent <connect|instructions|status>`, `computer <start|status|run|test>`, `browser <render|screenshot|read|markdown|pdf|crawl|snapshot|ask>`, `work <list|show|...>`, `proof <list|show|save|delete>`) so `vibecodr retention` no longer feels like it stranded the user when it asks for a subcommand.

- `src/bin/vibecodr-mcp.ts`: `helpText()` restructured into Hosted Agent Computer / Account & install / Pulses / Account policy & monitoring / Automation handoff / CLI maintenance / Global flags.

**3. `vibecodr tools` output is now scannable.** The MCP gateway returns long-paragraph descriptions for each tool — they're written for AI agents that read the description to decide which tool to call, so they're verbose by design. Through 1.0.6 the CLI dumped them one-tool-per-line as `name: full_paragraph`, which produced a wall of wrapped text. The default human path now:
- Shows only the **first sentence** of each description, truncated to fit terminal width with `…`.
- **Column-aligns** tool names against descriptions for scanning.
- **Groups** tools visually by name prefix (so `get_*` / `list_*` / `publish_*` cluster together).
- Adds a **header** with tool count and gateway URL, and a **footer** pointing to `vibecodr tools <tool-name>` for the full description, `--search <query>` for filtering, and `--json` for machine-readable output.

The `--json` envelope is byte-identical to 1.0.6 (the existing `test/output-baseline-mcp.test.ts` fixture still passes unchanged); only the human-readable lines changed.

- `src/commands/tools.ts`: `renderToolsList()` helper + first-sentence summarizer + prefix-grouping.

## 1.0.6

Hardens `vibecodr update` against three issues reported on Windows after the 1.0.4/1.0.5 releases.

**1. Auto-detection now derives the install root from the CLI's own file location.** Previously the command spawned `pnpm root -g` / `yarn global dir` / `npm root -g` and compared the result against `import.meta.url`. On at least one Windows machine that comparison failed even though the CLI was installed via npm globally to the standard `%APPDATA%\npm\node_modules`, producing the misleading `Could not auto-detect the package manager that installed @vibecodr/cli` warning. The new detection walks up 4 levels from `update.js` to get the actual install root, then matches that against each manager's global root using a normalized, case-insensitive comparison (Windows paths are case-insensitive). The spawned `<mgr> root -g` commands are still consulted, but the platform default locations (`%APPDATA%\npm\node_modules`, `%LOCALAPPDATA%\Yarn\Data\global\node_modules`, the Bun-install candidates) act as fallbacks when the spawned command isn't available or fails.

**2. Default-yes confirmation prompt.** The prompt was `[y/N]` (default no) which forced an explicit `y` for every routine upgrade. Now `[Y/n]` — pressing Enter accepts.

**3. DEP0190 deprecation warning silenced.** The install spawn previously used `spawn(cmd, args, { shell: process.platform === "win32" })`, which Node 22+ deprecated because the shell concatenates the args without escaping. On Windows the command now spawns `cmd.exe /d /s /c "<command-line>"` directly with a small `quoteWindowsArg` helper that wraps any arg containing shell-meaningful characters and doubles trailing backslashes per [Microsoft's quoting rules](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-commandlinetoargvw). On POSIX, plain `spawn(cmd, rest)` with no shell.

- `src/commands/update.ts`: install-root walk + normalized `samePath`, default-yes prompt, `cmd.exe` spawn on Windows.
- `test/update.test.ts`: case-insensitive `samePath` cases and `quoteWindowsArg` coverage; 8 tests in total.

## 1.0.5

Fixes two user-reported issues from the 1.0.4 release.

**1. `vibecodr whoami` failed against the live MCP gateway.** The command read `structuredContent.profile` and `structuredContent.quota` from the `get_account_capabilities` response, but the gateway wraps both under `account`: the actual response is `structuredContent: { account: { profile, quota, ... } }` per the schema at `Vibecodr-MCP/src/mcp/tools.ts:2208` and the handler at line 5284. The CLI was reading the wrong path, ended up with an empty profile, and threw `mcp.whoami_contract` ("The MCP gateway did not return account identity for the connected user."). The corresponding unit-test fixture in `test/cli.test.ts` mocked the wrong (flat) shape, so the unit test passed against a wrong contract and the bug went unnoticed until it hit the live gateway.

- `src/commands/whoami.ts`: read `structured.account.{profile,quota}` instead of `structured.{profile,quota}`.
- `test/cli.test.ts`: fixture updated to match the real gateway response shape (`{ account: { profile, quota, ... } }`).

**2. `vibecodr --help` omitted ~20 cross-routed commands.** Through 1.0.4 the help only listed the canonical MCP-gateway commands. The dispatcher actually cross-routes the entire hosted Agent Computer surface (`start`, `try`, `agent`, `computer`, `browser`, `work`, `proof`, `usage`, `plans`, `dashboard`) plus advanced/diagnostic commands (`auth`, `setup`, `connect`, `inspect`, `jobs`, `artifacts`, `grants`, `retention`, `scheduled-qa`, `limits`) through the legacy dispatcher, but `vibecodr` / `vibecodr-mcp` never advertised them. Users invoking the canonical bin couldn't discover the hosted Agent Computer surface.

- `src/bin/vibecodr-mcp.ts`: `helpText()` reorganized into named groups (`Hosted Agent Computer`, `Account & install`, `Pulses`, `CLI maintenance`, `Advanced / diagnostic`) with a one-line description per command, mirroring the legacy `vc-tools --help` summaries. No behavior change — the commands were always callable from the canonical bin via the `VC_TOOLS_ONLY_COMMANDS` fall-through; they're now also visible in `--help`.

## 1.0.4

Adds `vibecodr update` (alias: `vibecodr-mcp update`) for in-place upgrades of the global install. The command fetches the latest `@vibecodr/cli` version from the npm registry, compares against the currently-installed version, and (with confirmation by default) runs the appropriate package-manager install command.

Behavior summary:

- **`vibecodr update --check`** prints `current → latest` and exits without installing. Always safe to run.
- **`vibecodr update`** with no flags fetches the latest version, prints the install command that's about to run, and prompts before executing. `--yes` (or the global `--non-interactive`) skips the prompt.
- **`vibecodr update --via <npm|pnpm|yarn|bun>`** forces the install channel. Without the flag, the command auto-detects which manager owns the current install by intersecting `pnpm root -g`, `yarn global dir`, the Bun global root, and `npm root -g` against the CLI's own install location. If no match is found the command defaults to npm with a warning.
- Refuses to run from a source-tree checkout of `@vibecodr/cli` (use `git pull` for those) or from an `npx` ephemeral cache (`npx` invocations are already ephemeral; the message recommends `npm install -g` for persistence).
- Honors `--json` for scripted invocations; envelopes carry `current`, `latest`, `upToDate`, and on a successful install `previousVersion`, `installedVersion`, `via`.

The command is wired into the canonical `vibecodr` / `vibecodr-mcp` bins only. The legacy `vc-tools` bin does not gain `update` — that surface stays byte-equivalent to vc-tools@0.1.4.

- `src/commands/update.ts`: new command module.
- `src/bin/vibecodr-mcp.ts`: dispatcher case + help text entry.
- `test/update.test.ts`: 6 cases (version comparator, both `--check` paths, unsupported `--via`, source-tree refusal, `--help` short-circuit).
- `test/e2e-cli.test.ts`: extends the per-command `--help` matrix to include `update`.

## 1.0.3

Closes a Windows-CI flake in the hosted Browser Agent Workflow's idle-timeout closure path. No behavior change to the dispatcher or any CLI surface; the fix lives entirely inside `src/hosted/worker.ts` and matters only for the worker test suite plus the deployed Cloudflare Worker.

The worker's post-wait idle check measured `Date.now() - lastMeaningfulAt` after a `setTimeout` whose duration was capped at `idleTimeoutMs`. On Windows the OS system clock has ~15.6 ms tick resolution while Node's `setTimeout` uses a higher-resolution wakeup, so a `setTimeout(1_000)` could complete and a subsequent `Date.now()` read could still report 985-999 ms of elapsed wall clock — causing `>= idleTimeoutMs` to fall through and leave `closureReason` as `"completed"` when the workflow had clearly consumed its entire idle window.

The fix accounts for waits against the idle budget using the planned sleep duration (`performed.ms`) — the value the worker already requested from `setTimeout` — rather than measuring `Date.now()` across the sleep. This is the deterministic source of truth for "did this wait consume the idle window," matches the existing semantic that wait actions consume idle budget by their requested duration, and preserves all existing behavior for the happy `"completed"` path and for explicit sub-budget waits.

- `src/hosted/worker.ts`: switch post-wait idle accounting from wall-clock delta to planned-sleep duration.

## 1.0.2

Hardens `preinstall-check.mjs` to also catch the **orphan-bin-shim** case that the 1.0.1 check missed.

When an earlier `npm install -g @vibecodr/cli` (or `@vibecodr/vc-tools`) was aborted mid-flight on Windows — typically because antivirus or an IDE held a file handle on the just-extracted tree during npm's cleanup — npm leaves the bin shim files (`vc-tools`, `vc-tools.cmd`, `vc-tools.ps1`, the `vibecodr` and `vibecodr-mcp` triples) at the global bin dir but the package itself isn't fully registered. The retry trips the same EEXIST because npm refuses to overwrite shim files it didn't write in the current install run.

The preinstall now:

- Inspects the global bin dir (`%APPDATA%\npm\` on Windows, `<prefix>/bin/` on POSIX) for any of the nine Windows shim names or three POSIX shim names.
- Cross-references against the global node_modules tree: if `<global-root>/@vibecodr/cli/package.json` doesn't exist or doesn't name `@vibecodr/cli`, the shim files are orphans.
- Prints an actionable cleanup recipe (`Remove-Item ... -Force` on Windows, `rm -f ...` on POSIX) listing the exact files to delete plus the half-installed package directory if present, then `npm install -g @vibecodr/cli`.

The check still bails for non-global installs, local dev installs from the source repo, and `VIBECDR_SKIP_PREINSTALL_CHECK=1` opt-outs, and false-positive-proofs itself: a clean re-install / upgrade of `@vibecodr/cli` (shims present + valid `@vibecodr/cli/package.json` present) passes through silently.

- `preinstall-check.mjs`: orphan-shim detection on top of the existing legacy-package check.
- `test/preinstall-check.test.ts`: 2 new cases (orphan-blocks, upgrade-passes-through) on top of the original 4.

## 1.0.1

Fixes the global-install collision for users who already had `@vibecodr/vc-tools@0.1.x` installed globally. Both packages register a `vc-tools` bin under the same path; npm refuses to overwrite a bin owned by a different package, so the install fails with `EEXIST: file already exists`.

- Adds a `preinstall` lifecycle script (`preinstall-check.mjs`) that runs `npm ls -g --depth 0 --json @vibecodr/vc-tools` before file copy. When a legacy `0.1.x` is detected, the install aborts with a clear actionable message listing the two-command fix (`npm uninstall -g @vibecodr/vc-tools` followed by `npm install -g @vibecodr/cli`). The check is purely read-only, opts itself out during local dev installs from the source repo, and honors `VIBECDR_SKIP_PREINSTALL_CHECK=1` for operators who want to bypass.
- Documents the collision and the unblock recipe in MIGRATION.md under the "If you used `vc-tools`" section.

No source or behavior changes to the dispatcher, the worker, or the published bins. The only delta in the tarball is the new `preinstall-check.mjs` at the package root.

## 1.0.0

Same source as 1.0.0-rc.0. Promoted to `latest` after the rc.0 release cleared smoke against the production endpoints (tools.vibecodr.space + openai.vibecodr.space/mcp) and the §14 output-baseline fixtures matched byte-for-byte.

## 1.0.0-rc.0

First release candidate of the unified Vibecodr CLI. Merges @vibecodr/vc-tools@0.1.4 and @vibecodr/cli@0.2.11 into a single coordinated release.

### Added

- Single package `@vibecodr/cli` with three bin entries that all resolve to the same install tree:
  - `vibecodr` — canonical (MCP gateway commands + hosted Agent Computer cross-routed)
  - `vibecodr-mcp` — compatibility alias preserved from 0.2.x
  - `vc-tools` — compatibility alias for the legacy vc-tools surface, byte-equivalent output to vc-tools@0.1.4
- Hosted Agent Computer commands (start, browser, computer, work, proof, usage, plans, dashboard, jobs, artifacts, agent, connect, try, etc.) now reachable from the `vibecodr` bin via legacy-dispatcher cross-routing.
- New MCP install adapter `claude-code` (alongside codex, cursor, vscode, windsurf, claude-desktop).
- Cloudflare worker source, wrangler config, D1 migrations, and Dockerfile vendored from vc-tools so a single repo owns the CLI and its hosted worker.
- New canonical `VIBECDR_*` env var prefix (e.g. `VIBECDR_CONFIG_DIR`) backed by `src/core/env.ts`. Legacy `VC_TOOLS_*` and `VIBECDR_MCP_*` env vars stay readable as fallbacks; the CLI emits a one-time stderr deprecation note when a legacy var is hit. Set `VIBECDR_NO_DEPRECATION_NOTICE=1` to silence.

### Behavior change on first 1.0.x run

The first invocation of any v1.0.0+ bin entry runs a one-shot migration: the
legacy `%APPDATA%\vc-tools\` and `%APPDATA%\Vibecodr\MCP\` (or platform
equivalents) are **copied** into a unified `~/.vibecodr/{tools,mcp}/` tree,
and the legacy roots are **renamed to `<root>.bak`**. The migration is
idempotent (subsequent runs are no-ops) and preserves OS keychain entries
(service IDs `@vibecodr/vc-tools` and `@vibecodr/mcp` are not touched). See
[MIGRATION.md](MIGRATION.md#what-happens-on-first-10x-run) for the full
breakdown and how to override the destination via `VIBECDR_CONFIG_DIR`.

### Preserved (frozen)

- `vc-tools` binary, `vibecodr-mcp` binary, all existing env vars (`VC_TOOLS_*`, `VIBECDR_MCP_*`), keyring service IDs (`@vibecodr/vc-tools` and `@vibecodr/mcp`), config dirs, install-manifest schema, and hosted worker contracts (D1 binding, JWT claims, route paths, page slugs).
- Output JSON shape for every command captured in test/fixtures/output-baseline/ as the §14 regression contract.

### Migrated

- From @vibecodr/cli@0.2.x (no behavior change): login, logout, status, whoami, tools, call, upload, doctor, install, uninstall, config, pulse-setup, pulse-publish, pulse.
- From @vibecodr/vc-tools@0.1.x (no behavior change for vc-tools bin; new cross-routing from vibecodr bin): start, setup, try, agent, connect, computer, browser, work, proof, usage, limits, dashboard, jobs, artifacts, grants, retention, scheduled-qa, plans, inspect, auth.

### Deprecated

- `@vibecodr/vc-tools` npm package becomes a thin forwarder at 0.2.0. Plan: `npm deprecate` 90 days after this release.

See MIGRATION.md for upgrade guidance.
