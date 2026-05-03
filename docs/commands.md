# Commands

This page documents the command surface implemented in the current repo.

## Global flags

All commands accept:

- `--profile <name>`
- `--server-url <url>`
- `--json`
- `--verbose`
- `--non-interactive`

## Commands

### `login`

Syntax:

`vibecodr-mcp login [--scope <oauth-scope>] [--registration auto|preregistered|cimd|dcr|manual] [--browser open|print] [--timeout-sec <n>]`

Use this to authenticate the CLI itself.

Current default:

- `login` prints the authorization URL and waits for the loopback callback
- `--browser open` opts into automatic browser launch

### `logout`

Syntax:

`vibecodr-mcp logout [--all] [--no-revoke]`

Use this to clear CLI auth state. It does not touch editor-owned auth.

### `status`

Syntax:

`vibecodr-mcp status [--probe] [--show-installs]`

Without `--probe`, this reads only local state.

### `tools`

Syntax:

`vibecodr-mcp tools [<tool-name>] [--search <text>] [--schema] [--no-login]`

This always reads the live tool catalog from the MCP server.

### `call`

Syntax:

`vibecodr-mcp call <tool-name> [--input-json <json>] [--input-file <path>] [--stdin] [--interactive] [--no-login]`

`--interactive` currently supports top-level scalar object fields.

For `quick_publish_creation` with `payload.importMode: "direct_files"`, pass file paths as normal slash-separated project paths such as `src/main.tsx` or `src/server/binding-proof.js`. Do not pre-encode slashes as `%2F`; the hosted MCP gateway encodes each URL segment when it writes files to Vibecodr.

### `pulse-setup`

Syntax:

`vibecodr-mcp pulse-setup [--json] [--descriptor-setup-json <json> | --descriptor-setup-file <path>]`

Calls the live `get_pulse_setup_guidance` MCP tool. Pass a `PulseDescriptorSetupProjection` through `--descriptor-setup-json` or `--descriptor-setup-file` when you have one; the CLI forwards it as `descriptorSetup` and verifies the MCP response evaluated that descriptor. Without a descriptor projection, the command returns general Pulse setup rules and must not be treated as proof that a specific Pulse needs or does not need backend setup.

The CLI does not maintain separate Pulse setup copy; it reads MCP output derived from the API projection owned by `PulseDescriptor`.

The returned guidance should stay capability-shaped: `env.fetch` is Vibecodr policy-mediated fetch, `env.secrets.bearer/header/query/verifyHmac` are policy-bound secret helpers, `env.webhooks.verify("stripe")` is the first certified provider helper rather than the whole webhook model, non-Stripe signed webhooks use generic HMAC format presets such as `github-sha256`, `shopify-hmac-sha256`, and `slack-v0` until fixture-backed helpers exist, `env.connections.use(provider).fetch` is provider-scoped connected-account access, `env.log` is structured logging, `env.request` is sanitized request access, `env.runtime` is safe correlation metadata, and `env.waitUntil` is best-effort after-response work. The CLI must not introduce separate cleanup, platform-binding, dispatch, raw-token, raw-authorization, or physical-storage guidance.

### `doctor`

Syntax:

`vibecodr-mcp doctor [--client <client>]`

Supported client probes now:

- `codex`
- `cursor`
- `vscode`
- `windsurf`

### `config`

Syntax:

- `vibecodr-mcp config path`
- `vibecodr-mcp config show`
- `vibecodr-mcp config set <key> <value>`
- `vibecodr-mcp config unset <key>`
- `vibecodr-mcp config profile list`
- `vibecodr-mcp config profile create <name> [--server-url <url>]`
- `vibecodr-mcp config profile use <name>`
- `vibecodr-mcp config profile delete <name> [--force]`

### `install`

Syntax:

`vibecodr-mcp install <codex|cursor|vscode|windsurf> [--scope user|project] [--path <dir>] [--name <server-name>] [--open-client] [--overwrite] [--dry-run]`

Install config only. Runtime auth remains CLI-owned or editor-owned depending on where the server is used.

### `uninstall`

Syntax:

`vibecodr-mcp uninstall <codex|cursor|vscode|windsurf> [--scope user|project] [--path <dir>] [--name <server-name>] [--dry-run]`

## Exit codes

- `0` success
- `1` runtime or doctor check failure
- `2` usage error
- `3` config or filesystem error
- `4` auth required but unavailable in current mode
- `5` auth failed
- `6` network failure
- `7` protocol or discovery failure
- `8` tool failure
- `9` unsupported client or missing required executable
- `10` install or uninstall conflict
- `11` secure credential store unavailable
- `12` cancellation or auth timeout

## Current note

The commands above are implemented now. The main remaining product constraint is VS Code user-scope uninstall, because there is still no documented removal surface that this repo can safely automate without inventing one.
