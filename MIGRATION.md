# Migrating to @vibecodr/cli v1

`@vibecodr/cli@1.0.0` merges the former `@vibecodr/vc-tools@0.1.x` package and the former `@vibecodr/cli@0.2.x` package into a single coordinated release. Three bin entries — `vibecodr`, `vibecodr-mcp`, and `vc-tools` — all resolve to the same install tree, and every contract that crosses a process or network boundary is frozen.

You should not need to change anything to keep working. This page documents the back-compat guarantees and the small set of *additions* you can opt into.

## What happens on first 1.0.x run

The first time you invoke any of `vibecodr`, `vibecodr-mcp`, or `vc-tools` from v1.0.0+, the CLI does a one-shot migration of your legacy config dirs into a unified `~/.vibecodr/` tree:

- `%APPDATA%\vc-tools\` (Windows) / `$XDG_CONFIG_HOME/vc-tools/` (macOS/Linux) -> `~/.vibecodr/tools/`
- `%APPDATA%\Vibecodr\MCP\` (Windows) / `~/Library/Application Support/Vibecodr MCP/` (macOS) / `$XDG_CONFIG_HOME/vibecodr-mcp/` (Linux) -> `~/.vibecodr/mcp/`

The legacy roots are **renamed to `<root>.bak`** so the old code paths can't accidentally re-read stale state. The migration is idempotent — running the CLI again is a no-op once `~/.vibecodr/` exists.

**What this means for you:**

- All your existing credentials, profiles, and install manifests come along; no re-login is required. The OS keychain entries are not touched (service IDs `@vibecodr/vc-tools` and `@vibecodr/mcp` stay where they are).
- Set `VIBECDR_CONFIG_DIR` to a custom path to override the new canonical location. Legacy `VC_TOOLS_CONFIG_DIR` and `VIBECDR_MCP_CONFIG_PATH` env vars still work too — they read as fallbacks and write to the canonical location going forward.
- Any external script that reads the legacy paths directly (instead of going through the CLI) will stop seeing fresh data after the migration. Update those scripts to read `~/.vibecodr/{tools,mcp}/` or rely on the `<root>.bak` snapshots which preserve the pre-migration state.
- If you absolutely don't want the migration to run, set `VIBECDR_CONFIG_DIR=<your-explicit-path>` before the first invocation; the CLI prefers explicit overrides over the auto-migration trigger.

The migration is one-shot per machine. If you need to redo it (for example after rolling back to a 0.2.x line and back to 1.x), delete `~/.vibecodr/tools/` or `~/.vibecodr/mcp/` and the next 1.x invocation re-copies from the legacy roots (which now live at `<root>.bak`).

## If you used `vc-tools`

You installed `npm install -g @vibecodr/vc-tools` and your scripts run `vc-tools start`, `vc-tools browser screenshot ...`, `vc-tools computer run ...`, etc.

**What stays the same:**

- Every `vc-tools <command> [...]` invocation continues to work, byte-equivalent JSON output, byte-equivalent exit codes. The §14 output-baseline regression contract checks this on every release.
- Your durable API key in the OS keychain remains under the service ID `@vibecodr/vc-tools` (username `agent-computer`). No re-login is required after upgrade.
- Your config dir moves from `%APPDATA%\vc-tools\` (Windows) / `$XDG_CONFIG_HOME/vc-tools/` (macOS/Linux) to `~/.vibecodr/tools/` on first 1.0.x invocation. The legacy root is renamed to `<root>.bak` and preserved. `VC_TOOLS_CONFIG_DIR` and `VC_TOOLS_CREDENTIAL_STORE` env vars still work; the canonical name is `VIBECDR_CONFIG_DIR` and either set wins. See "What happens on first 1.0.x run" above.
- The hosted worker endpoint `tools.vibecodr.space` is unchanged. All HTTP routes (`/auth/vc-tools/device/*`, `/me/api-keys/vc-tools/*`) are frozen. JWT claims (`grant_profile="vc_tools"`, `aud="vibecodr:vc-tools"`) are frozen. The Clerk-managed API key is still labeled `"vc-tools Agent Computer"`.

**What's new (opt-in):**

- You can install the same package as `npm install -g @vibecodr/cli` instead of `@vibecodr/vc-tools`. The bin name `vc-tools` still resolves; the help banner adds a one-line "this is now part of @vibecodr/cli" footnote.
- `@vibecodr/vc-tools` itself becomes a thin forwarder at version 0.2.0 that depends on `@vibecodr/cli`. Existing pinned installs (`@vibecodr/vc-tools@0.1.4`) continue to work; the 0.2.0 forwarder lets `npm i @vibecodr/vc-tools` (no version) drag in the merged CLI for users who type the legacy package name from memory.

**If `npm install -g @vibecodr/cli` fails with `EEXIST: file already exists` pointing at `<npm-bin>/vc-tools`:**

That's the global-bin collision: both `@vibecodr/cli` and the legacy `@vibecodr/vc-tools` register a `vc-tools` bin under the same path, and npm refuses to overwrite a bin owned by a different package. The fix is one command:

```bash
npm uninstall -g @vibecodr/vc-tools
npm install -g @vibecodr/cli
```

This is safe: the uninstall removes only the npm package and its bin shim. Your OS keychain entry (service `@vibecodr/vc-tools`, the durable Clerk API key) and your config dir are untouched; the merged CLI reads both on first run. From `@vibecodr/cli@1.0.1` onwards, the package ships a `preinstall` script that detects this collision and prints the same instructions instead of letting npm surface a bare `EEXIST`.

**What you can update in CI (no rush):**

- Switch your install command to `npm install -g @vibecodr/cli`. The bin entry `vc-tools` is still mapped, so no script changes are required.
- Optionally call the same commands as `vibecodr <command>` (instead of `vc-tools <command>`). The `vibecodr` bin cross-routes the full hosted Agent Computer command set (start, agent, connect, computer, browser, work, proof, usage, plans, jobs, artifacts, etc.) to the same code path that `vc-tools` uses.

## If you used `vibecodr-mcp`

You installed `npm install -g @vibecodr/cli` and your scripts run `vibecodr-mcp login`, `vibecodr-mcp tools`, `vibecodr-mcp pulse-publish ...`, etc.

**What stays the same:**

- Every `vibecodr-mcp <command>` invocation continues to work unchanged.
- Your encrypted OAuth session moves with the rest of the MCP-CLI config dir on first 1.0.x invocation: from `%APPDATA%\Vibecodr\MCP\secrets\` (Windows) / `~/Library/Application Support/Vibecodr MCP/secrets/` (macOS) / `$XDG_CONFIG_HOME/vibecodr-mcp/secrets/` (Linux) to `~/.vibecodr/mcp/secrets/`. Keyring service ID stays `@vibecodr/mcp` (untouched). No re-login is required. See "What happens on first 1.0.x run" above.
- The hosted MCP gateway endpoint `openai.vibecodr.space/mcp` is unchanged.
- `VIBECDR_MCP_*` env vars (`VIBECDR_MCP_CONFIG_PATH`, `VIBECDR_MCP_CIMD_CLIENT_ID`, `VIBECDR_MCP_MANUAL_CLIENT_ID`, `VIBECDR_MCP_INSTALL_MANIFEST_PATH`, etc.) work unchanged.

**What's new:**

- `vibecodr install claude-code` is a new MCP install adapter; uses `claude mcp add --transport http <name> <serverUrl>` and registers the install in the install manifest for later `vibecodr uninstall claude-code`.

## If you used `vibecodr`

You installed `npm install -g @vibecodr/cli` and your scripts run `vibecodr login`, `vibecodr install codex`, `vibecodr tools`, etc.

**What stays the same:**

- All commands you currently run continue to work, byte-equivalent output.

**What's new:**

- `vibecodr <command>` now also accepts the full hosted Agent Computer surface (start, browser, computer, work, proof, usage, plans, dashboard, agent, connect, try, jobs, artifacts, grants, retention, scheduled-qa, inspect, auth). These commands cross-route to `tools.vibecodr.space` using the legacy vc-tools code path so output is byte-equivalent to the `vc-tools <command>` form.
- `vibecodr install claude-code` is supported (see above).

## What you absolutely do not need to change

The following identifiers and contracts are frozen in this release and intentionally retain their `vc-tools` or `vibecodr-mcp` names:

- Bin names: `vc-tools`, `vibecodr-mcp` (and the new `vibecodr`)
- Env var prefixes: `VC_TOOLS_*`, `VIBECDR_MCP_*`
- Keyring service IDs: `@vibecodr/vc-tools`, `@vibecodr/mcp`
- OS Keychain entry names: `vc-tools Agent Computer`
- Cloudflare worker route paths: `/auth/vc-tools/device/*`, `/me/api-keys/vc-tools/*`
- Hosted worker D1 database binding: `vc-tools-db`
- JWT audience claims: `vibecodr:vc-tools`, `vibecodr:cli`
- JWT grant profile claims: `vc_tools`, `publish_assistant`
- Marketing page slugs: `/vc-tools`, `/docs/vc-tools`, `/settings/vc-tools/approve`
- Query parameter `vc_tools_code` on the device-approval page
- Plan schema field `vcTools`
- D1 schema columns named `vcTools*`

These names are how scripts, signed grants, deployed configurations, and bookmarked URLs reference the surface today. Renaming any of them would break live users. Treat them as permanent.
