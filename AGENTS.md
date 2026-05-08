# AGENTS.md (Vibecodr MCP CLI)

This repository is the standalone Vibecodr CLI package. It is related to the Vibecodr MCP gateway and the main `vibecodr.space` application, but it is not part of the main Vibecodr monorepo.

## Git Ownership - Read This First

This repo is locally nested at `C:\Users\brade\OneDrive\Desktop\vibecodr\tools\mcp\Vibecodr-MCP-CLI` for agent ergonomics only.

This is its own Git repository. It is connected to this GitHub repo:

`https://github.com/BradenHartsell/Vibecodr-MCP-CLI.git`

Expected Git facts before committing, pushing, or publishing:

- `git rev-parse --show-toplevel` prints `C:/Users/brade/OneDrive/Desktop/vibecodr/tools/mcp/Vibecodr-MCP-CLI`
- `git remote get-url origin` prints `https://github.com/BradenHartsell/Vibecodr-MCP-CLI.git`
- the normal branch is `main`
- the package name is `@vibecodr/cli`

Do not stage, commit, push, publish, or deploy this project from the parent `vibecodr` Git repository. The parent repo ignores `/tools/`, and this child repo must stay independently versioned. If the Git root is `C:\Users\brade\OneDrive\Desktop\vibecodr`, stop and move into this repository first.

The sibling `Vibecodr-MCP` repo is the hosted MCP gateway. The main `vibecodr` checkout is the application/platform monorepo. Keep changes, commits, branches, releases, and verification results separate unless the user explicitly asks for a coordinated multi-repo change.

## Operating Stance

The CLI is a trust-boundary tool. Treat command arguments, config files, environment variables, credentials, MCP payloads, local paths, and upstream responses as hostile or malformed until validated.

Preserve these invariants:

- never print, log, serialize, cache, or commit secrets or tokens
- keep auth token storage platform-appropriate and redacted in diagnostics
- keep destructive or remote-mutating commands explicit and hard to misuse
- keep stdout, stderr, JSON output, and exit codes stable for automation
- keep MCP tool invocation behavior compatible with the hosted gateway contract
- prefer narrow commands and shaped responses over broad "do anything" wrappers

## External Systems

For work involving MCP protocol behavior, Node.js runtime behavior, package publishing, credential storage, GitHub/NPM, Cloudflare, OAuth, or any upstream Vibecodr API surface, check current authoritative docs and the installed package versions before implementing. Do not rely on training data for external behavior.

## Verification

Choose checks by blast radius:

- type-only or CLI presentation changes: `npm run check`
- command behavior, auth, config, or MCP invocation changes: `npm test` plus `npm run check`
- package surface or release changes: `npm run verify`
- docs-only changes: `git diff --check`

If a check is skipped, say exactly why in the final response.
