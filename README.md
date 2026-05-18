# Vibecodr CLI

[![npm](https://img.shields.io/npm/v/@vibecodr/cli.svg)](https://npmjs.com/package/@vibecodr/cli)

The official Vibecodr CLI. One package, one install command, one coherent surface for:

- Hosted browser tools (render, screenshot, PDF, crawl, snapshot, ask).
- Hosted computer tools (run, test, work follow, work submit, proof).
- Capsule uploads (zip + image) into Pulse and the hosted MCP gateway.
- Pulse lifecycle (setup, publish, list, get, status, run, archive, restore, create, deploy).
- Agent-client MCP installation (Codex, Cursor, VS Code, Windsurf, Claude Desktop, Claude Code).
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

```bash
# 1. Authenticate against the hosted Agent Computer (tools.vibecodr.space).
vibecodr start

# 2. Tell your agent client how to find the hosted MCP gateway (openai.vibecodr.space/mcp).
vibecodr connect --client codex

# 3. Smoke-test the connection.
vibecodr computer status
vibecodr browser screenshot https://example.com --out ./proof
```

## Surfaces

The CLI talks to two hosted endpoints. Every command targets exactly one of them:

| Endpoint | Commands |
|---|---|
| `tools.vibecodr.space` | `start`, `setup`, `agent`, `connect`, `try`, `browser`, `computer`, `work`, `proof`, `jobs`, `artifacts`, `usage`, `limits`, `grants`, `retention`, `scheduled-qa`, `plans`, `dashboard`, `inspect` |
| `openai.vibecodr.space/mcp` | `tools`, `call`, `upload`, `pulse`, `pulse-setup`, `pulse-publish` |
| Both | `login`, `logout`, `status`, `whoami`, `doctor`, `install`, `uninstall`, `config` |

CLI auth is independent of the auth your editor (Codex, Cursor, VS Code, Windsurf, Claude Desktop, Claude Code) negotiates with the gateway; each client owns its own session.

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
