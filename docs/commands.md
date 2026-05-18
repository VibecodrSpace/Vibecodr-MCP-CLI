# Commands

This page documents the command surface implemented in the current repo.

## Global flags

All commands accept:

- `--profile <name>`
- `--json`
- `--verbose`
- `--non-interactive`

Alternate MCP servers are profile-scoped, not runtime overrides. Use
`vibecodr config profile create <name> --server-url <url>` and then login to
that profile; stored tokens are bound to the server that issued them.

## Commands

### `login`

Syntax:

`vibecodr login [--scope <oauth-scope>] [--registration auto|preregistered|cimd|dcr|manual] [--browser open|print] [--timeout-sec <n>]`

Use this to authenticate the CLI itself.

Current default:

- `login` prints the authorization URL and waits for the loopback callback
- `--browser open` opts into automatic browser launch

### `logout`

Syntax:

`vibecodr logout [--all] [--no-revoke]`

Use this to clear CLI auth state. It does not touch editor-owned auth.

### `status`

Syntax:

`vibecodr status [--probe] [--show-installs]`

Without `--probe`, this reads only local state.

### `whoami`

Syntax:

`vibecodr whoami [--no-login]`

Shows the connected Vibecodr account and plan by calling the protected
`get_account_capabilities` MCP tool. It uses the same refresh and interactive
login retry path as `call`, but prints only account identity, plan, CLI profile,
server URL, and session state.

### `tools`

Syntax:

`vibecodr tools [<tool-name>] [--search <text>] [--schema] [--no-login]`

This always reads the live tool catalog from the MCP server.

### `call`

Syntax:

`vibecodr call <tool-name> [--input-json <json>] [--input-file <path>] [--stdin] [--interactive] [--timeout-sec <n>] [--no-login] [--confirm]`

`--interactive` currently supports top-level scalar object fields.

For `quick_publish_creation` with `payload.importMode: "direct_files"`, pass file paths as normal slash-separated project paths such as `src/main.tsx` or `src/server/binding-proof.js`. Do not pre-encode slashes as `%2F`; the hosted MCP gateway encodes each URL segment when it writes files to Vibecodr.

Known mutating tools require explicit confirmation through `--confirm`. The CLI redacts secret, token, source, descriptor, and inline file-content fields from displayed arguments and results while preserving safe operator handles and counters such as `artifactId`, `jobId`, `requestId`, `traceId`, `errorCode`, `credentialType`, `tokenCount`, and `tokenKind`; the MCP gateway remains the authority boundary for OAuth, owner checks, confirmation, and output shaping.

Use `--timeout-sec <n>` when a protected tool is expected to run longer than the default client wait, such as a build-backed publish retry. This changes only the local MCP transport timeout and is not forwarded as a server tool argument.

Use `vibecodr call get_account_capabilities --json` to read the live model-safe plan snapshot before promising hosted tool work. The gateway returns Quick Checks, Agent Browser, Sandbox, Crawl, and Artifact Shelf limits when the platform API exposes them.

### `upload`

Syntax:

`vibecodr upload --zip <path> [--idempotency-key <key>] [--root-hint <path>] [--entry-hint <path>] [--timeout-sec <n>] [--no-login]`

`vibecodr upload --image <path> [--kind cover_image|avatar_image] [--content-type <mime>] [--timeout-sec <n>] [--no-login]`

Stages a local ZIP or image through Vibecodr's API-owned upload session flow. The CLI asks the MCP gateway for a short-lived direct R2 PUT URL, uploads the bytes directly to R2, completes server-side verification, and prints safe identifiers only.

ZIP uploads print a `quickPublishPayload` snippet using `payload.importMode: "staged_upload"`. The snippet asks Vibecodr to use the async staged-upload import path so larger projects can move to the heavy import lane automatically instead of making the CLI guess. Cover image uploads print a `thumbnailStagedUpload` snippet that can be passed to publish metadata tools. Avatar image uploads print an `avatarStagedUpload` identifier for avatar promotion flows.

Cover images support PNG, JPEG, WebP, and AVIF. Avatar images support PNG, JPEG, WebP, and GIF.

Staged upload MCP setup and completion calls use a longer client-side wait by default so large ZIP verification does not fail only because the local CLI stopped waiting. Use `--timeout-sec <n>` only when a slower network needs a different local wait; this value is transport behavior and is not forwarded as a server tool argument.

The presigned URL is a bearer credential and is never printed in command output. Legacy `zip_import` / `fileBase64` remains a compatibility path for small payloads, not the preferred CLI path for whole repos or launch images.

### `pulse-setup`

Syntax:

`vibecodr pulse-setup [--json] [--descriptor-setup-json <json> | --descriptor-setup-file <path>]`

Calls the live `get_pulse_setup_guidance` MCP tool. Pass a `PulseDescriptorSetupProjection` through `--descriptor-setup-json` or `--descriptor-setup-file` when you have one; the CLI forwards it as `descriptorSetup` and verifies the MCP response evaluated that descriptor. Without a descriptor projection, the command returns general Pulse setup rules and must not be treated as proof that a specific Pulse needs or does not need backend setup.

The CLI does not maintain separate Pulse setup copy; it reads MCP output derived from the API projection owned by `PulseDescriptor`.

The returned guidance should stay capability-shaped: `env.fetch` is Vibecodr policy-mediated fetch, `env.secrets.bearer/header/query/verifyHmac` are policy-bound secret helpers, `env.webhooks.verify("stripe")` is the first certified provider helper rather than the whole webhook model, non-Stripe signed webhooks use generic HMAC format presets such as `github-sha256`, `shopify-hmac-sha256`, and `slack-v0` until fixture-backed helpers exist, `env.connections.use(provider).fetch` is provider-scoped connected-account access, `env.log` is structured logging, `env.request` is sanitized request access, `env.runtime` is safe correlation metadata, and `env.waitUntil` is best-effort after-response work. The CLI must not introduce separate cleanup, platform-binding, dispatch, raw-token, raw-authorization, or physical-storage guidance.

### `pulse-publish`

Syntax:

`vibecodr pulse-publish --name <name> (--code <source> | --code-file <path>) [--descriptor-json <json> | --descriptor-file <path>] [--slug <slug>] [--visibility public|unlisted|private] --confirm`

Calls `publish_standalone_pulse`. Standalone Pulse source/metadata visibility defaults to private. Private visibility does not add runtime authentication to the public Pulse URL. The CLI does not echo source code or descriptors in successful output.

### `pulse`

Syntax:

- `vibecodr pulse list [--limit <n>] [--offset <n>]`
- `vibecodr pulse get <pulse-id>`
- `vibecodr pulse status <pulse-id>`
- `vibecodr pulse run <pulse-id> [--input-json <json> | --input-file <path>] --confirm`
- `vibecodr pulse archive <pulse-id> --confirm`
- `vibecodr pulse restore <pulse-id> --confirm`
- `vibecodr pulse create --name <name> (--code <source> | --code-file <path>) --confirm`
- `vibecodr pulse deploy --name <name> (--code <source> | --code-file <path>) --confirm`

`create` and `deploy` are aliases for the standalone publish flow. `run`, `archive`, and `restore` require explicit confirmation. `delete` is intentionally unavailable; archive a Pulse instead. `logs` are not exposed through the hardened lifecycle surface yet.

The CLI forwards lifecycle calls to MCP tools owned by the hosted gateway: `list_pulses`, `get_pulse`, `get_pulse_status`, `run_pulse`, `archive_pulse`, and `restore_pulse`. These server tools are hidden from default discovery but callable by exact name for owner recovery and CLI use.

### `doctor`

Syntax:

`vibecodr doctor [--client <client>]`

Supported client probes now:

- `codex`
- `cursor`
- `vscode`
- `windsurf`

### `config`

Syntax:

- `vibecodr config path`
- `vibecodr config show`
- `vibecodr config set <key> <value>`
- `vibecodr config unset <key>`
- `vibecodr config profile list`
- `vibecodr config profile create <name> [--server-url <url>]`
- `vibecodr config profile use <name>`
- `vibecodr config profile delete <name> [--force]`

### `install`

Syntax:

`vibecodr install <codex|cursor|vscode|windsurf|claude-desktop> [--scope user|project] [--path <dir>] [--name <server-name>] [--open-client] [--overwrite] [--dry-run]`

Install config only. Runtime auth remains CLI-owned or editor-owned depending on where the server is used.

Claude Desktop does not load remote HTTP MCP servers natively, so the installer writes the documented `mcp-remote` stdio proxy entry (`{ command: "npx", args: ["mcp-remote", <url>] }`). Node.js / npx must be on PATH for the proxy to launch. Users can alternatively add the MCP URL via Settings -> Connectors -> Add custom connector in the desktop app.

Platform support matrix:
- **macOS**: writes to `~/Library/Application Support/Claude/claude_desktop_config.json`.
- **Windows**: writes to `%APPDATA%\Claude\claude_desktop_config.json`.
- **Linux**: Anthropic does not ship an official Claude Desktop build for Linux. The installer writes to `${XDG_CONFIG_HOME:-$HOME/.config}/Claude/claude_desktop_config.json`, the path used by community repackages. If you are not running such a build, install Claude Code and use `vibecodr install codex` / equivalent instead.

### `uninstall`

Syntax:

`vibecodr uninstall <codex|cursor|vscode|windsurf|claude-desktop> [--scope user|project] [--path <dir>] [--name <server-name>] [--dry-run]`

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
