# Changelog

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
