# vc-tools CLI Guidelines Audit

Source: https://clig.dev/

This audit maps `vc-tools` against the Command Line Interface Guidelines. The
goal is not to copy every nice-to-have literally; it is to make the standalone
`vc-tools` binary a good CLI citizen while preserving the Vibecodr Tools Cloud
trust boundary.

## Current Verdict

`vc-tools` satisfies the applicable CLI Guidelines release bar for a hosted
Agent Computer CLI:

- human-readable output by default
- stable `--json` output for automation
- success output on stdout and errors/warnings on stderr
- zero exit on success and non-zero exit by failure class
- `-h`, `--help`, `help <command>`, and `<command> --help`
- examples, docs link, and support link in top-level help
- agent-first top-level nouns: `start`, `agent`, `computer`, `browser`, `work`,
  `proof`, `usage`, and `doctor`
- command and subcommand typo suggestions
- explicit mutating confirmations with `--yes`
- no local execution for sandbox commands
- local validation before cost-bearing hosted calls
- native credential store by default
- browser/device approval through `vc-tools start`/`login` without raw-token
  copy/paste
- file/stdin credential inputs for secret-bearing login paths
- `--quiet`, `--no-input`, and `--no-color` convention flags
- no telemetry or analytics collection in the CLI package

## Compliance Matrix

| clig.dev area | vc-tools implementation | Evidence |
| --- | --- | --- |
| Basics: parse args consistently | Small explicit parser with tested global flags and command flags | `src/cli/parser.ts`, `test/cli.behavior.test.ts` |
| Basics: stdout/stderr | Results go to stdout; warnings and errors go to stderr | `src/cli/output.ts` |
| Basics: exit codes | `CliError` maps input/auth/confirm/file/upstream failures to non-zero exit codes | `src/cli/errors.ts` |
| Help | Top-level help plus `help <command>` and `<command> --help`; examples lead the page | `src/cli/run.ts`, `test/cli.behavior.test.ts` |
| Documentation | Help links to the web page and support path; repo docs cover security, release, API contract, and validation | `README.md`, `docs/*` |
| Output | Human success output includes redacted payload data whenever a command returns data, with command-family coverage for every successful data-returning path; stable pretty JSON remains available with `--json`, and `--quiet` remains available for scripts | `src/cli/output.ts`, `test/output.test.ts`, `test/cli.behavior.test.ts` |
| Errors | Expected failures are rewritten as `CliError` messages with stable codes and redaction | `src/cli/errors.ts`, `src/core/redaction.ts` |
| Arguments and flags | Full-length flags exist; short flags are reserved for `-h` and `-q`; mutations use `--yes` | `src/cli/parser.ts`, `src/cli/run.ts` |
| Secret-bearing inputs | Preferred inputs are `--credential-file`, `--credential-stdin`, `VC_TOOLS_CREDENTIAL_FILE`, and native credential storage | `src/cli/run.ts`, `docs/SECURITY.md` |
| Interactivity | Plain `vc-tools start` opens or prints a browser approval URL and code when needed; `--no-input` refuses that path for automation; `--*-stdin` refuses interactive TTY reads | `src/cli/run.ts` |
| Subcommands | Primary noun/verb families are agent-shaped: `computer run`, `browser screenshot`, `work follow`, `proof save`; advanced aliases remain for `jobs`, `artifacts`, and `tools test` | `src/cli/run.ts` |
| Robustness | Network requests have timeouts; user input is validated before hosted work; unsafe URLs and file escapes fail early | `src/core/api-client.ts`, `src/core/validators.ts`, `src/cli/run.ts` |
| Future-proofing | No catch-all subcommand or implicit abbreviation support; suggestions do not execute inferred commands | `src/cli/run.ts` |
| Signals | The CLI does not wrap long-lived local processes. Hosted jobs are durable and cancelable with explicit commands | `src/cli/run.ts`, `docs/API-CONTRACT.md` |
| Configuration | Flags and `VC_TOOLS_*` env override stored account credential/config; default config path follows platform conventions; config-directory isolation is advanced-only copy | `src/config/store.ts` |
| Environment variables | Env names are uppercase `VC_TOOLS_*`; secret-value env vars are compatibility paths and docs prefer file vars | `README.md`, `docs/SECURITY.md` |
| Naming | Binary is short, lowercase, dash-separated, and distinct from `vibecodr` | `package.json`, `AGENTS.md` |
| Distribution | npm package exposes one binary, explicit root exports, CLI-only runtime dependencies, and package artifact checks guard the published file set | `package.json`, `scripts/check-pack-artifact.mjs` |
| Analytics | The CLI does not phone home for usage/crash telemetry; only user-invoked hosted API calls are made | `src/cli/run.ts`, `docs/SECURITY.md` |

## Deliberate Compatibility Notes

Direct secret value inputs (`--credential`, `--token`,
`VC_TOOLS_CREDENTIAL`, `VC_TOOLS_TOKEN`) remain accepted for controlled
automation. They are not promoted in the primary help examples because
command-line arguments and secret-value environment variables can leak through
shell history, process inspection, debug logs, and CI metadata. New user-facing
docs should prefer `vc-tools start` for connection and generic file/stdin/native
credential storage for agents and automation.

`vc-tools` currently emits no ANSI color by default. `--no-color`, `NO_COLOR`,
and `TERM=dumb` are therefore compatibility controls rather than active color
switches.

`vc-tools` does not implement a pager. The current output is intentionally short
except JSON/inspection payloads, and JSON is the supported automation surface.

## Local Validation

The CLI Guidelines evidence is covered by the normal child-repo verification
gate:

```powershell
npm run check
npm test
npm run build
npm run verify
```

Focused smoke commands:

```powershell
node dist/bin/vc-tools.js --help
node dist/bin/vc-tools.js help computer
node dist/bin/vc-tools.js help browser
node dist/bin/vc-tools.js --quiet usage
node dist/bin/vc-tools.js --json plans
```
