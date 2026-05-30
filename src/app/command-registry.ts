export type CommandSurface = "shared" | "agent-computer" | "mcp-gateway" | "compatibility";

export interface CommandDefinition {
  name: string;
  surface: CommandSurface;
  summary: string;
  preferred?: string | undefined;
}

export const COMMAND_REGISTRY: readonly CommandDefinition[] = [
  { name: "login", surface: "shared", summary: "Authorize the CLI against Vibecodr surfaces." },
  { name: "logout", surface: "shared", summary: "Clear stored Vibecodr CLI credentials." },
  { name: "status", surface: "shared", summary: "Show Agent Computer and MCP Gateway credential state." },
  { name: "whoami", surface: "mcp-gateway", summary: "Show the connected Vibecodr account from the MCP Gateway." },
  { name: "doctor", surface: "shared", summary: "Diagnose gateway, install, and hosted readiness." },
  { name: "install", surface: "shared", summary: "Install the MCP gateway into an agent client." },
  { name: "uninstall", surface: "shared", summary: "Remove a managed MCP client install." },
  { name: "config", surface: "shared", summary: "Manage local CLI profiles and configuration." },
  { name: "update", surface: "shared", summary: "Check or run CLI package updates." },
  { name: "feedback", surface: "shared", summary: "Send product feedback straight to the Vibecodr dev." },

  { name: "start", surface: "agent-computer", summary: "Approve and verify the hosted Agent Computer connection." },
  { name: "setup", surface: "agent-computer", summary: "Compatibility alias for start.", preferred: "start" },
  { name: "try", surface: "agent-computer", summary: "Run a small Agent Computer end-to-end check." },
  { name: "agent", surface: "agent-computer", summary: "Connect an agent to the hosted computer." },
  { name: "auth", surface: "agent-computer", summary: "Diagnose or export Agent Computer credentials." },
  { name: "connect", surface: "agent-computer", summary: "Compatibility alias for agent connect.", preferred: "agent connect" },
  { name: "computer", surface: "agent-computer", summary: "Run hosted computer commands." },
  { name: "browser", surface: "agent-computer", summary: "Render, read, screenshot, crawl, or inspect public HTTPS pages." },
  { name: "work", surface: "agent-computer", summary: "List, follow, show, or cancel hosted work." },
  { name: "proof", surface: "agent-computer", summary: "List, show, save, or delete hosted artifacts." },
  { name: "usage", surface: "agent-computer", summary: "Show Agent Computer capacity and quota progress." },
  { name: "limits", surface: "agent-computer", summary: "Compatibility alias for usage.", preferred: "usage" },
  { name: "dashboard", surface: "agent-computer", summary: "Print the hosted supervision dashboard URL." },
  { name: "jobs", surface: "compatibility", summary: "Compatibility alias for work.", preferred: "work" },
  { name: "artifacts", surface: "compatibility", summary: "Compatibility alias for proof.", preferred: "proof" },
  { name: "grants", surface: "agent-computer", summary: "Show effective Agent Computer grants." },
  { name: "retention", surface: "agent-computer", summary: "Show or update hosted retention policy." },
  { name: "scheduled-qa", surface: "agent-computer", summary: "Manage scheduled browser checks." },
  { name: "plans", surface: "agent-computer", summary: "Show Agent Computer plan details." },
  { name: "inspect", surface: "compatibility", summary: "Show legacy goal-coverage inspections." },

  { name: "mcp", surface: "mcp-gateway", summary: "Use the Vibecodr MCP Gateway namespace." },
  { name: "tools", surface: "mcp-gateway", summary: "Compatibility alias for mcp tools.", preferred: "mcp tools" },
  { name: "call", surface: "mcp-gateway", summary: "Compatibility alias for mcp call.", preferred: "mcp call" },
  { name: "upload", surface: "mcp-gateway", summary: "Upload capsule archives or image assets through the MCP gateway." },
  { name: "pulse-setup", surface: "mcp-gateway", summary: "Prepare a standalone Pulse descriptor." },
  { name: "pulse-publish", surface: "mcp-gateway", summary: "Publish a standalone Pulse." },
  { name: "pulse", surface: "mcp-gateway", summary: "Manage Pulse lifecycle operations." }
];

export const AGENT_COMPUTER_COMMANDS = new Set(
  COMMAND_REGISTRY.filter((command) => command.surface === "agent-computer" || command.surface === "compatibility")
    .map((command) => command.name)
);

export const MCP_GATEWAY_COMMANDS = new Set(
  COMMAND_REGISTRY.filter((command) => command.surface === "mcp-gateway")
    .map((command) => command.name)
);

export function findCommandDefinition(name: string | undefined): CommandDefinition | undefined {
  if (!name) return undefined;
  return COMMAND_REGISTRY.find((command) => command.name === name);
}

export function commandNamesForSurface(surface: CommandSurface): string[] {
  return COMMAND_REGISTRY
    .filter((command) => command.surface === surface)
    .map((command) => command.name);
}
