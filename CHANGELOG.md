# Changelog

## 0.2.4

- clarify staged ZIP upload output so larger projects can move into Vibecodr's async heavy import lane automatically
- keep worker-gateway integration fixtures aligned with pulse compute quota fields

## 0.2.2

- show command-specific help for nested `vibecodr pulse <command> --help|-h|-help` requests

## 0.2.1

- preserve encrypted offline sessions when refresh fails because the authorization server is temporarily unavailable
- continue clearing stored auth on OAuth `invalid_grant` so revoked or expired refresh tokens fail closed

## 0.2.0

- rename the npm package to `@vibecodr/cli` while keeping `vibecodr` as the primary executable and `vibecodr-mcp` as a compatibility alias
- add the hardened `pulse` lifecycle command group for list/get/status/run/archive/restore plus create/deploy aliases
- redact source, descriptor, token, secret, and inline file-content fields from CLI-displayed MCP arguments and results
- require explicit confirmation for known mutating MCP tools when invoked through the generic `call` command

## 0.1.8

- report the actual package version in MCP client metadata instead of a stale hardcoded value
- publish the CLI after redeploying the hosted Vibecodr MCP gateway

## 0.1.7

- add the `pulse-setup` command for live Pulse setup guidance
- align CLI Pulse setup docs with the gateway runtime contract for policy-bound secrets, Stripe-first webhook helper guidance, generic HMAC presets, and provider-scoped connections
- refresh release-lock coverage for current in-range MCP SDK, keyring, and Node type packages before publishing

## 0.1.6

- make printed OAuth authorization URLs the default login behavior
- keep automatic browser launch available behind `--browser open`
- keep secret-store delete best-effort when keyring entry loading fails during cleanup

## 0.1.5

- replace the Windows browser launcher with `rundll32 url.dll,FileProtocolHandler` so OAuth URLs open in the default browser instead of File Explorer
- make `doctor` use the same browser-launcher availability check as runtime auth

## 0.1.4

- replace the Windows browser launcher with `explorer.exe` so OAuth URLs are passed through intact

## 0.1.3

- fix Windows command detection by resolving `where.exe` from the real system path
- make `status --show-installs` verify file-backed installs instead of blindly trusting the manifest

## 0.1.2

- fix Windows browser auto-open by launching the actual command shell instead of assuming `cmd` is on PATH
- make `doctor` validate the real browser launcher path instead of hardcoding Windows success

## 0.1.1

- add `vibecodr` as a first-class executable alias
- fix Windows login persistence by storing encrypted session blobs on disk with a small OS-keyring-backed encryption key
- keep `vibecodr-mcp` as a compatibility alias

## 0.1.0

- Initial Phase 0 scaffold for the direct Vibecodr MCP CLI.
