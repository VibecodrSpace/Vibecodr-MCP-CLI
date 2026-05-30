# Auth

The normal public setup path is `vibecodr start`. It opens the browser approval
flow shown on the Vibecodr CLI pages, stores the hosted Agent Computer
credential for this machine, and returns the connection details an agent needs.

`vibecodr login` is still the explicit MCP Gateway login for publishing,
uploads, Pulses, and direct MCP Gateway tools. It does not log Codex, Cursor, VS
Code, Windsurf, ChatGPT, or any other MCP client into MCP.

Vibecodr now has two CLI credential lanes:

- MCP Gateway: `vibecodr login` or `vibecodr login mcp`, stored under the historical `@vibecodr/mcp` service.
- Hosted Agent Computer: `vibecodr login agent` or the automatic `vibecodr start` approval flow, stored under the historical `@vibecodr/vc-tools` service.

The token types are intentionally separate. Status and doctor can read both lanes,
but the CLI does not merge or copy credentials between them.

Compatibility alias:

- `vibecodr-mcp login`
- `vc-tools login` for the Agent Computer compatibility path

## Implemented now

- protected-resource and authorization-server discovery against the MCP server
- PKCE S256 enforcement
- loopback callback on `127.0.0.1`
- secure token storage in the OS credential store via `@napi-rs/keyring`
- proactive refresh before protected runtime commands when a refresh token is available
- `logout` local token deletion plus best-effort revocation for MCP Gateway sessions
- `logout agent --yes` local Agent Computer credential deletion through the compatibility lane

The plaintext file secret store is for local automated tests only. It is ignored unless both `VIBECDR_MCP_INSECURE_SECRET_STORE_PATH` and `VIBECDR_MCP_ENABLE_INSECURE_SECRET_STORE=true` are set.

The local config and secure-token storage keys intentionally keep their historical `vibecodr-mcp` / `@vibecodr/mcp` names during the `@vibecodr/cli` package rename. That preserves existing CLI sessions instead of forcing users to re-authenticate for a package-name migration.

Supported OS credential stores:

- macOS: Keychain
- Windows: Credential Manager
- Linux: Secret Service through a desktop keyring such as GNOME Keyring or KWallet

Linux systems need a running, unlocked keyring on the current D-Bus session. Headless Linux should use a real Secret Service setup for persistent CLI login, or let the target MCP client own its own OAuth flow instead of storing CLI tokens.

## Registration modes

The CLI understands these internal modes:

- `auto`
- `preregistered`
- `cimd`
- `dcr`
- `manual`

Current repo reality:

- `auto` now uses the committed official client metadata document URL for `https://openai.vibecodr.space/mcp`
- `cimd` for non-official servers still requires a real `VIBECDR_MCP_CIMD_CLIENT_ID` URL
- `dcr` works when the authorization server advertises `registration_endpoint`
- `manual` works with `VIBECDR_MCP_MANUAL_CLIENT_ID` or an interactive prompt

## Runtime behavior

- `login` and `login mcp` print the authorization URL by default so the browser step is explicit and reliable across shells
- `login mcp --browser open` opts into automatic browser launch
- `login agent` starts the hosted Agent Computer approval flow; `start` also opens this flow when no Agent Computer credential is stored
- `status` reads local MCP Gateway and Agent Computer credential state without requiring the network unless `--probe` is used
- `mcp tools`, `tools`, `mcp call`, and `call` will attempt to reuse the stored MCP Gateway session
- if the access token is close to expiry and a refresh token is present, the CLI refreshes before making the MCP request

## Verified now

- automated mock coverage exercises DCR login, loopback callback handling, refresh, and logout revocation behavior
- unauthenticated `tools` works against public server surfaces without forcing login first
- unauthenticated public `call` works for noauth tools, while protected flows retry with refresh or interactive login

## Remaining constraints

- CIMD for non-official servers still needs a real externally hosted client-id metadata document to be genuinely usable
- dedicated scope step-up UX is still folded into the normal re-auth path rather than a specialized prompt flow
