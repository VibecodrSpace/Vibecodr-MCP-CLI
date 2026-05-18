# Changelog

Pre-1.0.0 history for the `@vibecodr/cli@0.2.x` and `0.1.x` lines lives at [`docs/legacy/CHANGELOG-mcp-cli.md`](docs/legacy/CHANGELOG-mcp-cli.md). The `@vibecodr/vc-tools@0.1.x` line was the other half of the May 2026 merge; its source history is preserved in the archived [`BradenHartsell/vc-tools`](https://github.com/BradenHartsell/vc-tools) repository.

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

### Preserved (frozen)

- `vc-tools` binary, `vibecodr-mcp` binary, all existing env vars (`VC_TOOLS_*`, `VIBECDR_MCP_*`), keyring service IDs (`@vibecodr/vc-tools` and `@vibecodr/mcp`), config dirs, install-manifest schema, and hosted worker contracts (D1 binding, JWT claims, route paths, page slugs).
- Output JSON shape for every command captured in test/fixtures/output-baseline/ as the §14 regression contract.

### Migrated

- From @vibecodr/cli@0.2.x (no behavior change): login, logout, status, whoami, tools, call, upload, doctor, install, uninstall, config, pulse-setup, pulse-publish, pulse.
- From @vibecodr/vc-tools@0.1.x (no behavior change for vc-tools bin; new cross-routing from vibecodr bin): start, setup, try, agent, connect, computer, browser, work, proof, usage, limits, dashboard, jobs, artifacts, grants, retention, scheduled-qa, plans, inspect, auth.

### Deprecated

- `@vibecodr/vc-tools` npm package becomes a thin forwarder at 0.2.0. Plan: `npm deprecate` 90 days after this release.

See MIGRATION.md for upgrade guidance.
