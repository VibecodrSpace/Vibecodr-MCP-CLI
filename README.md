# Vibecodr CLI

[![npm](https://img.shields.io/npm/v/@vibecodr/cli.svg)](https://npmjs.com/package/@vibecodr/cli)

The official Vibecodr CLI. One package, one install command, one coherent surface for:

- Hosted browser tools (render, screenshot, PDF, crawl, snapshot, ask).
- Hosted computer tools (run, test, work follow, work submit, proof).
- Capsule uploads (zip + image) into Pulse and the hosted MCP gateway.
- Pulse lifecycle (setup, publish, list, get, status, run, archive, restore, create, deploy).
- Adding Vibecodr to the apps people actually use: Codex, Cursor, VS Code, Windsurf, Claude Desktop, and Claude Code.
- Direct OAuth login, device-code login, status, doctor, diagnostics.

## Install

```bash
npm install -g @vibecodr/cli
```

This installs three bin entries that all point at the same dispatcher:

- `vibecodr` — canonical name. The full unified command surface.
- `vibecodr-mcp` — compatibility alias for users coming from `@vibecodr/cli@0.2.x`.
- `vc-tools` — compatibility alias for users coming from `@vibecodr/vc-tools@0.1.x`. Produces byte-equivalent output to the standalone vc-tools binary on every hosted Agent Computer command.

You can also install the legacy tombstone package; it forwards to the same dispatcher:

```bash
npm install -g @vibecodr/vc-tools
```

Pin to a specific version (recommended for CI):

```bash
npm install -g @vibecodr/cli@1.0.0
```

## Quick start

If you are not sure what you need yet, start here:

```bash
vibecodr status
vibecodr doctor
```

The default human experience is intentionally simple: the CLI should tell you
what is connected, what is missing, and the next command to run. The underlying
surfaces stay explicit for scripting, debugging, and release verification.

```bash
# 1. Sign in for publishing, uploads, Pulses, and MCP Gateway tools.
vibecodr login

# 2. Add Vibecodr to Codex. Other supported apps: Cursor, VS Code, Windsurf,
#    Claude Desktop, and Claude Code.
vibecodr install codex

# 3. Set up the hosted Agent Computer when you want browser/computer work.
vibecodr start
vibecodr browser screenshot https://example.com --local
```

Power users and automation should prefer the explicit surfaces and stable JSON:

```bash
vibecodr mcp tools --json --non-interactive
vibecodr mcp call get_account_capabilities --input-json '{}' --json --non-interactive
vibecodr status --json --non-interactive
```

## Surfaces

The CLI talks to two hosted endpoints. Every command targets exactly one of them:

| Endpoint | Commands |
|---|---|
| `tools.vibecodr.space` | `start`, `setup`, `login agent`, `logout agent`, `agent`, `connect`, `try`, `browser`, `computer`, `work`, `proof`, `jobs`, `artifacts`, `usage`, `limits`, `grants`, `retention`, `scheduled-qa`, `plans`, `dashboard`, `inspect` |
| `openai.vibecodr.space/mcp` | `login mcp`, `logout mcp`, `mcp tools`, `mcp call`, `tools`, `call`, `feedback`, `upload`, `pulse`, `pulse-setup`, `pulse-publish`, `whoami` |
| Shared local diagnostics/install | `status`, `doctor`, `install`, `uninstall`, `config` |

CLI auth is independent of the auth your editor (Codex, Cursor, VS Code, Windsurf, Claude Desktop, Claude Code) negotiates with the gateway; each client owns its own session. `vibecodr login` defaults to the MCP Gateway lane. Use `vibecodr login agent` for the hosted Agent Computer credential lane.

## Migrating from `@vibecodr/vc-tools@0.1.x` or `@vibecodr/cli@0.2.x`

You should not need to change anything. Every bin name, env var prefix (`VC_TOOLS_*`, `VIBECDR_MCP_*`), keyring service ID (`@vibecodr/vc-tools`, `@vibecodr/mcp`), config dir, Cloudflare worker route, JWT claim, page slug, and durable API key remains addressable. See [MIGRATION.md](MIGRATION.md) for the three-section breakdown.

## Documentation

- [docs/auth.md](docs/auth.md) — auth flows, env vars, profiles.
- [docs/architecture.md](docs/architecture.md) — endpoints, surfaces, contract boundaries.
- [docs/install.md](docs/install.md) — agent-client install adapters.
- [docs/clients.md](docs/clients.md) — Codex, Cursor, VS Code, Windsurf, Claude Desktop, Claude Code.
- [docs/commands.md](docs/commands.md) — command reference.
- [docs/troubleshooting.md](docs/troubleshooting.md) — common error codes.
- [docs/contributors.md](docs/contributors.md) — repo layout and dev loop.
- [docs/licensing.md](docs/licensing.md) — Apache-2.0 details.
- [docs/API-CONTRACT.md](docs/API-CONTRACT.md) — hosted worker contract.
- [docs/SECURITY.md](docs/SECURITY.md) — trust boundary.
- [docs/VALIDATION-MATRIX.md](docs/VALIDATION-MATRIX.md) — goal coverage map.

## Repository status

This repository is the unified home of the Vibecodr CLI. It ships:

- The published npm package `@vibecodr/cli`.
- The Cloudflare worker source for `tools.vibecodr.space` (in `src/hosted/`) and the matching D1 migrations (in `migrations/`).

Apache-2.0 licensed.
