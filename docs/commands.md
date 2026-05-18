# Commands

The Vibecodr CLI talks to two hosted endpoints. Every command targets exactly one of them:

| Badge | Endpoint | Auth path |
|---|---|---|
| `H` | `tools.vibecodr.space` | device-code (`vibecodr start` / `vc-tools start`) -> durable Clerk API key in OS keychain (`@vibecodr/vc-tools` service) |
| `M` | `openai.vibecodr.space/mcp` | CIMD/PKCE OAuth (`vibecodr login`) -> encrypted session in OS keychain (`@vibecodr/mcp` service) + AES-GCM session file |
| `*` | both | command picks the credential by what it talks to; no shared bin state |

The three bin entries — `vibecodr`, `vibecodr-mcp`, `vc-tools` — all resolve to the same dispatcher. The `vc-tools` bin sets `__VCR_INVOKED_AS=vc-tools` and routes every command through the legacy code path so output is byte-equivalent to `@vibecodr/vc-tools@0.1.4`. The `vibecodr` bin runs the MCP-gateway commands inline and cross-routes the hosted Agent Computer commands into the legacy code path. The `vibecodr-mcp` bin is the alias preserved from `@vibecodr/cli@0.2.x`.

## Global flags

All commands accept:

- `--profile <name>` (M)
- `--json` (\*)
- `--verbose` (\*)
- `--non-interactive` (\*)

The legacy `vc-tools` bin also accepts:

- `--api-url <url>`
- `--config-dir <path>`
- `--credential <value>` / `--credential-file <path>` / `--credential-stdin`
- `--token <value>` / `--token-file <path>` / `--token-stdin`
- `--timeout-ms <n>` (1000..300000)
- `--quiet` / `-q`
- `--no-input`
- `--no-color`
- `--debug`
- `--allow-insecure-local-api`

Alternate MCP servers are profile-scoped, not runtime overrides. Use `vibecodr config profile create <name> --server-url <url>` and then login to that profile; stored tokens are bound to the server that issued them.

## Authentication

### `vibecodr login` (M)

`vibecodr login [--scope <oauth-scope>] [--registration auto|preregistered|cimd|dcr|manual] [--browser open|print] [--timeout-sec <n>]`

Authenticates this CLI against the MCP gateway via CIMD/PKCE. Prints the authorization URL by default; `--browser open` launches the browser automatically. Stores the encrypted session under the `@vibecodr/mcp` keyring service.

### `vibecodr logout` (M)

`vibecodr logout [--all] [--no-revoke]`

Clears the MCP gateway session. Does not touch editor-owned auth or the hosted Agent Computer credential.

### `vibecodr status` (M)

`vibecodr status [--probe] [--show-installs]`

Without `--probe`, reads only local state. `--show-installs` distinguishes configured, missing, and external managed installs.

### `vibecodr whoami` (M)

`vibecodr whoami [--no-login]`

Calls the protected `get_account_capabilities` MCP tool. Prints account identity, plan, CLI profile, server URL, and session state. Same refresh + interactive login retry path as `call`.

### `vc-tools start` / `vc-tools setup` (H)

`vc-tools start [--api-url <url>] [--browser open|print] [--credential ...] [--token ...] [--no-input]`

`setup` is an alias for `start`. Walks device-code login against `api.vibecodr.space`, shows the matching approval code, waits for the user to approve in-browser, stores a durable Clerk API key under the `@vibecodr/vc-tools` keyring service (visible in the user's Clerk-managed API keys list as `"vc-tools Agent Computer"`), then returns the hosted MCP connection details an agent needs.

### `vc-tools auth diagnose` / `vc-tools auth export-agent-env` (H)

`auth diagnose` reports local credential health and which surface owns the active session. `auth export-agent-env` emits `VC_TOOLS_*` environment variables so an isolated agent shell can pick up the cached credential.

## Agent client installation (*)

### `vibecodr install <client>` / `vibecodr uninstall <client>`

`vibecodr install <codex|cursor|vscode|windsurf|claude-desktop|claude-code> [--scope user|project] [--path <dir>] [--name <server-name>] [--open-client] [--overwrite] [--dry-run]`

Adds (or removes) the hosted Vibecodr MCP server to the client's MCP catalog. `codex`, `vscode`, and `claude-code` prefer their own CLI shim (`codex mcp add`, `code --add-mcp`, `claude mcp add`) and fall back to writing the client's config file. `cursor`, `windsurf`, `claude-desktop` always write the client's config file directly. Records the install in `installs.json` so `uninstall` can find it.

### `vc-tools connect` / `vc-tools agent connect` (H)

`vc-tools connect --client <codex|cursor|vscode|windsurf|claude-desktop|claude-code> [--print] [--name <server-name>] [--install] [--overwrite]`

Prints (`--print`) or installs (`--install`) the MCP connection details for the hosted Agent Computer. The `vc-tools agent connect` form is the legacy spelling; both reach the same code path.

## Hosted browser (H)

### `vc-tools browser <subcommand>`

- `browser read <https-url> [--out ./proof] [--no-wait] [--details]`
- `browser screenshot <https-url> [--format png|jpg] [--out ./proof] [--no-wait] [--details]`
- `browser render <https-url> [--out ./proof] [--no-wait] [--details]`
- `browser pdf <https-url> [--out ./proof] [--no-wait] [--details]`
- `browser crawl <https-url> [--max-pages n] [--max-depth n] [--out ./proof]`
- `browser snapshot <https-url> [--instructions <text>] [--out ./proof]`
- `browser ask <https-url> --instructions <text>`

Public HTTPS URLs only. Localhost, private network ranges, URL credentials, and internal hostnames are blocked before any hosted work is submitted. `--no-wait` returns immediately with a `jobId` you can follow via `vc-tools work follow`. `--details` includes capability metadata in the response.

## Hosted computer (H)

### `vc-tools computer <subcommand>`

- `computer run <command> [--out ./proof] [--no-wait]`
- `computer test <command> [--out ./proof] [--no-wait]`
- `computer status`

`run` and `test` submit bounded commands to the hosted sandbox container (Sandbox or ProSandbox class depending on plan). Public HTTP(S) network is enabled for sandbox tests; private/metadata networks remain blocked.

## Hosted work + proof (H)

### `vc-tools work <subcommand>`

- `work list`
- `work follow <jobId> [--no-wait] [--timeout-sec <n>]`
- `work show <jobId>`
- `work cancel <jobId>`
- `work submit <command-spec>`

### `vc-tools proof <subcommand>`

- `proof list [--limit <n>] [--cursor <c>]`
- `proof get <artifactId>`
- `proof save <artifactId> --out <path>`
- `proof download <artifactId> --out <path>`
- `proof delete <artifactId>`

Artifact output is workspace-bounded: downloaded bytes can only be written to files you intentionally target inside the current workspace. Use `--out ./artifacts`, `--out ./artifacts/report.pdf`, or `cd` to the intended workspace and use `--out .`.

### `vc-tools jobs <subcommand>` / `vc-tools artifacts <subcommand>`

`jobs list|status|cancel` and `artifacts list|get|delete` are lower-level surfaces over the same underlying entities; prefer `work` and `proof` for the common flows.

## Plan + usage (H)

### `vc-tools usage` / `vc-tools limits`

`vc-tools usage [--json]` (and the `limits` alias) reports the account's plan name, monthly and daily credit counters, current concurrent runs, and remaining headroom. The hosted worker is the authority; the CLI does not cache quotas.

### `vc-tools grants <subcommand>`

- `grants list`
- `grants refresh`

Inspects scoped grants the worker issues to bind a tool call to a plan + capability set.

### `vc-tools retention` / `vc-tools scheduled-qa`

`retention` shows or sets the account's proof-retention policy. `scheduled-qa` shows or schedules recurring QA runs (rate-limited per plan).

### `vc-tools plans [--details]`

Prints the plan packaging matrix (Free / Creator / Pro). With `--details`, includes per-capability limits and the tool-credit breakdown.

### `vc-tools dashboard`

Prints the URL of the hosted supervision dashboard. Does not open a browser; that is left to the caller.

## MCP gateway tooling (M)

### `vibecodr tools` / `vibecodr tools test`

`vibecodr tools [<tool-name>] [--search <text>] [--schema] [--no-login]`

Lists the live MCP tool catalog from `openai.vibecodr.space/mcp`. With `<tool-name>`, prints the schema for that tool. `--schema` includes the full JSON schema. `tools test <tool-name>` runs the gateway's `validators` against a sample input.

### `vibecodr call <tool-name>`

`vibecodr call <tool-name> [--input-json <json>] [--input-file <path>] [--stdin] [--interactive] [--timeout-sec <n>] [--no-login] [--confirm]`

Invokes the named MCP tool. `--interactive` supports top-level scalar object fields; richer schemas should use `--input-json` or `--input-file`. `--confirm` is required for known mutating tools. The CLI redacts source, descriptor, token, secret, and inline file-content fields from displayed arguments and results while preserving safe operator handles (`artifactId`, `jobId`, `requestId`, `traceId`, `errorCode`, `credentialType`, `tokenCount`, `tokenKind`). The gateway remains the authority boundary for OAuth, owner scoping, confirmation policy, and output shaping. `--timeout-sec <n>` changes only the local MCP transport timeout and is not forwarded as a server tool argument.

For `quick_publish_creation` with `payload.importMode: "direct_files"`, pass file paths as normal slash-separated project paths (`src/main.tsx`, `src/server/binding-proof.js`). Do not pre-encode slashes as `%2F`; the hosted gateway encodes each URL segment when it writes files to Vibecodr.

### `vibecodr upload`

`vibecodr upload --zip <path>` or `vibecodr upload --image <path> [--kind cover_image|avatar_image]`

Direct-to-R2 staged uploads (no base64 payloads). Hosted gateway returns a presigned R2 PUT URL, the CLI streams the file, then the gateway records the upload metadata. Image uploads accept the kind discriminator.

## Pulse (M)

### `vibecodr pulse-setup`

`vibecodr pulse-setup [--descriptor-setup-json <json> | --descriptor-setup-file <path>]`

Walks live Pulse setup (provider connections, secret bindings, Stripe-first webhook helper). Without args, prompts interactively.

### `vibecodr pulse-publish`

`vibecodr pulse-publish --name <name> (--code <source> | --code-file <path>) --confirm`

Publishes a standalone Pulse with private source/metadata visibility by default. Runtime URL is public HTTP unless the Pulse code rejects callers. `--confirm` is required.

### `vibecodr pulse <subcommand>`

- `pulse list`
- `pulse get <pulseId>`
- `pulse status <pulseId>`
- `pulse run <pulseId>`
- `pulse archive <pulseId> --confirm`
- `pulse restore <pulseId> --confirm`
- `pulse create --confirm`
- `pulse deploy <pulseId>`

Convenience wrappers over the gateway's Pulse lifecycle. `create` and `deploy` are aliases for the create-and-publish sequence; prefer the explicit form when scripting.

## Convenience (*)

### `vc-tools try` (H)

`vc-tools try [--out ./proof]`

Runs a small browser + computer + proof + usage check end-to-end to verify the account, the credential, and the hosted plumbing.

### `vibecodr doctor` / `vc-tools doctor` (*)

`vibecodr doctor [--json]` walks local health: secret store availability, browser launcher, network reachability, MCP gateway handshake, hosted worker handshake.

`vc-tools doctor` does the same plus device-code surface checks.

### `vibecodr config` / `vc-tools config` (*)

`config` reads and writes the CLI's profile catalog. Sub-surfaces include profile create, profile select, profile list, get, set.

### `vc-tools inspect` (H)

`vc-tools inspect --json`

Emits the goal-coverage map (which hosted capabilities are local-verified vs hosted-required vs production-smoked). Used by the release-readiness check.

## Legacy bin aliases

`vibecodr-mcp <command> ...` and `vc-tools <command> ...` are bin entries that route into the same dispatcher.

- `vibecodr-mcp` produces output byte-equivalent to `@vibecodr/cli@0.2.11` for every MCP-gateway command.
- `vc-tools` produces output byte-equivalent to `@vibecodr/vc-tools@0.1.4` for every hosted Agent Computer command.

If you have scripts that call either binary, no changes are required.

## Output and exit codes

All commands return non-zero on failure. Stable codes:

| Code | Meaning |
|---|---|
| 0 | success |
| 2 | usage / input validation |
| 3 | auth / session |
| 4 | quota / plan limit |
| 5 | local config / storage |
| 6 | install / uninstall conflict |
| 7 | runtime / hosted failure |

`--json` shape is `{ ok: true, data, warnings }` on success and `{ ok: false, error: { code, message, status, details } }` on failure. Volatile fields (`requestId`, `traceId`, timestamps) appear in `data` / `error.details` but are filtered out of the §14 output-baseline regression contract.
