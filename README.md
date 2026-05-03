# ACTIVE DEVELOPMENT - USE AT YOUR OWN RISK #




# Vibecodr MCP CLI

Direct terminal client for the hosted Vibecodr MCP server.

This repository is intentionally separate from the PolyForm-licensed server implementation. The CLI is a client and installer surface, not a second server. It talks to the same hosted Vibecodr MCP gateway used by Codex, Cursor, VS Code, Windsurf, ChatGPT, and other MCP-capable clients.

The CLI is the permissively licensed public client surface for:

- direct CLI OAuth login
- live MCP tool discovery
- live MCP tool invocation
- environment and auth diagnostics
- thin client install and uninstall adapters

Currently implemented command surface:

- `login`
- `logout`
- `status`
- `tools`
- `call`
- `pulse-setup`
- `doctor`
- `config`
- `install`
- `uninstall`

Primary executable:

- `vibecodr`

Compatibility alias:

- `vibecodr-mcp`

The runtime path talks directly to `https://openai.vibecodr.space/mcp`. Editor installers are not part of the runtime path.

CLI login authenticates this CLI only. It does not share token storage with Codex, Cursor, VS Code, Windsurf, ChatGPT, or other MCP clients; those clients own their own OAuth sessions against the same server.

The official production auth path is now committed in package code through the server-hosted client metadata document:

- `https://openai.vibecodr.space/.well-known/oauth-client/vibecodr-mcp.json`

Documentation:

- [docs/auth.md](docs/auth.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/install.md](docs/install.md)
- [docs/clients.md](docs/clients.md)
- [docs/commands.md](docs/commands.md)
- [docs/troubleshooting.md](docs/troubleshooting.md)
- [docs/contributors.md](docs/contributors.md)
- [docs/licensing.md](docs/licensing.md)
