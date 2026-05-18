# AGENTS.md (Vibecodr CLI)

This repository is the unified Vibecodr CLI package and its hosted Cloudflare worker. It was formed in May 2026 by merging the standalone `@vibecodr/vc-tools` package (CLI + hosted worker for `tools.vibecodr.space`) into the former `@vibecodr/cli` (which started life as the MCP gateway client). The result is one package with three bin entries (`vibecodr`, `vibecodr-mcp`, `vc-tools`) and one repo that owns both the CLI source and the worker source.

## Git Ownership - Read This First

This repo lives locally at `C:\Users\brade\OneDrive\Desktop\vibecodr-tools\mcp\Vibecodr-CLI`. A compatibility junction at `C:\Users\brade\OneDrive\Desktop\vibecodr\tools\mcp\Vibecodr-CLI` resolves it from inside the parent Vibecodr checkout for the release scripts in that repo.

This is its own Git repository. It is connected to this GitHub repo:

`https://github.com/BradenHartsell/Vibecodr-CLI.git`

The GitHub slug was renamed from `BradenHartsell/Vibecodr-MCP-CLI` to `BradenHartsell/Vibecodr-CLI` in May 2026; GitHub's redirect keeps the old URL working for ~30 days. The VibecodrSpace org mirror was renamed in the same operation: `VibecodrSpace/Vibecodr-MCP-CLI` -> `VibecodrSpace/Vibecodr-CLI`. The mirror workflow in `.github/workflows/mirror-to-vibecodrspace.yml` reflects the new slugs.

Expected Git facts before committing, pushing, or publishing:

- `git rev-parse --show-toplevel` prints `C:/Users/brade/OneDrive/Desktop/vibecodr-tools/mcp/Vibecodr-CLI`
- `git remote get-url origin` prints `https://github.com/BradenHartsell/Vibecodr-CLI.git`
- the normal branch is `main`
- the package name is `@vibecodr/cli`

Do not stage, commit, push, publish, or deploy this project from the parent `vibecodr` Git repository. The parent repo ignores `/tools/`, and this child repo must stay independently versioned. If the Git root is `C:\Users\brade\OneDrive\Desktop\vibecodr`, stop and move into this repository first.

The sibling `Vibecodr-MCP` repo is the hosted MCP gateway. The main `vibecodr` checkout is the application/platform monorepo. Keep changes, commits, branches, releases, and verification results separate unless the user explicitly asks for a coordinated multi-repo change.

## Dependency On Vibecodr

This CLI is a separate Git repo, but it depends on the main Vibecodr platform
and the hosted MCP gateway. It is not an island.

Before changing command behavior, output contracts, auth storage, MCP tool
calls, upload/import flows, product wording, or release behavior, inspect the
parent checkout at:

`C:\Users\brade\OneDrive\Desktop\vibecodr`

Useful parent anchors include `docs\DOMAIN-REFERENCE.md`,
`docs\SYSTEMS-REFERENCE.md`, `docs\agent-context\staged-upload-contract.md`,
`workers\api`, `openapi.yaml`, and the release scripts under `scripts`. Keep
the CLI, gateway, and parent repo aligned whenever a behavior crosses that
boundary.

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

## Repository layout

- `src/bin/{vibecodr-mcp,vc-tools}.ts`: three bin entries (`vibecodr`, `vibecodr-mcp`, `vc-tools`) compile to `dist/bin/`. `vc-tools.ts` sets `__VCR_INVOKED_AS=vc-tools` and dispatches via `await import("../legacy/cli/run.js")` for byte-equivalent output to vc-tools@0.1.4. `vibecodr-mcp.ts` is the canonical dispatcher; it cross-routes hosted Agent Computer commands into the legacy dispatcher and runs the MCP-gateway commands inline.
- `src/cli/`, `src/commands/`, `src/clients/`, `src/core/`, `src/auth/`, `src/storage/`, `src/platform/`, `src/types/`, `src/doctor/`: the MCP-gateway-side surface.
- `src/legacy/`: vendored copy of @vibecodr/vc-tools@0.1.4 (cli/, config/, core/, index.ts). Kept byte-equivalent to preserve the §14 output-baseline regression contract. Edits here are high risk.
- `src/hosted/worker.ts`: Cloudflare Worker for `tools.vibecodr.space`. Imports type/constant modules from `src/legacy/core/{contracts,goal-coverage,version}.ts` (the only legacy paths the worker touches).
- `migrations/0001..0007_*.sql`: D1 migration history for `vc-tools-db`. Hashes are part of the §11.2.1 D1 gate; do not modify without coordinating with the worker deploy.
- `wrangler.jsonc`, `Dockerfile`, `worker-configuration.d.ts`, `tsconfig.worker.json`: worker-only build inputs. Excluded from the npm tarball by `scripts/check-pack-artifact.mjs`.
- `test/`: MCP-gateway-side tests at the top level; `test/legacy/` mirrors the vc-tools test suite (imports rewritten to `src/legacy/...`). `test/cli-dispatch.test.ts` spawns the built bins and asserts both `--version` outputs agree.
- `test/fixtures/output-baseline/`: per-command JSON outputs captured from vc-tools@0.1.4 and @vibecodr/cli@0.2.11 before the merge. The §14 regression contract checks merged output against these byte-for-byte (after filtering volatile fields).

## Verification

Choose checks by blast radius:

- type-only or CLI presentation changes: `npm run check` (runs `check:cli` and `check:worker`)
- command behavior, auth, config, or MCP invocation changes: `npm test` plus `npm run check`
- package surface or release changes: `npm run verify` (check + build + test + verify:artifact)
- worker-side changes: also run `npx wrangler deploy --dry-run --outdir dist/dryrun` and compare against the prior dry-run output
- docs-only changes: `git diff --check`

If a check is skipped, say exactly why in the final response.

## Releasing

Manual local publish only. CI runs matrix verify but does NOT publish to npm; there is no `NPM_TOKEN` secret and the publish job was removed from `release.yml` to keep the supply-chain surface narrow.

```powershell
npm run verify
npm publish --tag <next|latest> --access public   # rc.* -> next; plain semver -> latest
git tag -a v<version> -m "Release CLI <version>"
git push origin v<version>                        # triggers matrix verify, not publish
```

Worker deploy is also manual: `npx wrangler deploy` from this directory. The D1 binding name and database UUID are frozen contracts; verify `tools.vibecodr.space/v1/health` reports the expected version after each deploy.
