# Changelog

Pre-1.0.0 history for the `@vibecodr/cli@0.2.x` and `0.1.x` lines lives at [`docs/legacy/CHANGELOG-mcp-cli.md`](docs/legacy/CHANGELOG-mcp-cli.md). The `@vibecodr/vc-tools@0.1.x` line was the other half of the May 2026 merge; its source history is preserved in the archived [`BradenHartsell/vc-tools`](https://github.com/BradenHartsell/vc-tools) repository.

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
