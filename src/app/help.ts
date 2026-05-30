import { COMMAND_REGISTRY, findCommandDefinition } from "./command-registry.js";

const COMMON_CONFUSIONS: ReadonlyMap<string, string> = new Map([
  ["check", "doctor"],
  ["diagnose", "doctor"],
  ["health", "doctor"],
  ["signin", "login"],
  ["sign-in", "login"],
  ["sign_in", "login"],
  ["signout", "logout"],
  ["sign-out", "logout"],
  ["sign_out", "logout"],
  ["profile", "whoami"],
  ["account", "whoami"],
  ["feedbacks", "feedback"],
  ["suggest", "feedback"],
  ["tool", "mcp tools"],
  ["mcp-tool", "mcp tools"],
  ["mcp-tools", "mcp tools"],
  ["invoke", "mcp call"],
  ["publish", "pulse-publish"],
  ["zip", "upload"],
  ["screenshot", "browser screenshot"],
  ["read", "browser read"]
]);

const MCP_CONFUSIONS: ReadonlyMap<string, string> = new Map([
  ["tool", "tools"],
  ["list", "tools"],
  ["describe", "tools"],
  ["schema", "tools"],
  ["invoke", "call"],
  ["run", "call"]
]);

export function rootHelpText(): string {
  return [
    "Vibecodr CLI",
    "Usage: vibecodr <command> [options]",
    "",
    "Start here:",
    "  vibecodr start           Approve the Agent Computer account connection.",
    "  vibecodr status          See Agent Computer and MCP Gateway state.",
    "  vibecodr doctor          Check your local setup and get the next fix.",
    "  vibecodr install codex   Add the MCP Gateway to Codex. Also supports Cursor, Claude, VS Code, and Windsurf.",
    "  vibecodr login           Sign in for publishing, uploads, Pulses, and MCP Gateway tools.",
    "",
    "Do useful things:",
    "  vibecodr browser read https://example.com",
    "  vibecodr browser screenshot https://example.com --out ./proof",
    "  vibecodr upload --zip ./project.zip",
    "  vibecodr pulse list",
    "  vibecodr feedback \"This part was confusing\"",
    "",
    "For scripts and advanced use:",
    "  vibecodr mcp tools       List MCP Gateway tools.",
    "  vibecodr mcp call <tool> --input-json '{}'",
    "  vibecodr usage           Show Agent Computer capacity.",
    "  vibecodr work list       Show hosted work.",
    "  vibecodr proof list      Show saved proof.",
    "",
    "Compatibility aliases:",
    "  vibecodr-mcp <command>   Old MCP CLI name.",
    "  vc-tools <command>       Old Agent Computer CLI name.",
    "  vibecodr tools           Alias for vibecodr mcp tools.",
    "  vibecodr call            Alias for vibecodr mcp call.",
    "",
    "Global flags:",
    "  --profile <name>         Use a saved profile.",
    "  --json                   Stable machine-readable output.",
    "  --verbose                Include extra diagnostic details.",
    "  --non-interactive        Fail instead of prompting.",
    "",
    "More help:",
    "  vibecodr help <command>",
    "  vibecodr mcp --help",
    "  vibecodr browser --help",
    "",
    "If you are not sure what is broken, run: vibecodr doctor"
  ].join("\n");
}

export function mcpHelpText(): string {
  return [
    "Vibecodr MCP Gateway",
    "",
    "Use this when you want the tool catalog behind openai.vibecodr.space/mcp.",
    "Most users should start with `vibecodr status`, `vibecodr login`, or `vibecodr install codex`.",
    "",
    "Common commands:",
    "  vibecodr mcp tools",
    "      List available MCP tools.",
    "  vibecodr mcp tools get_account_capabilities --schema",
    "      Describe one tool and its input shape.",
    "  vibecodr mcp call get_account_capabilities --input-json '{}'",
    "      Call one tool with structured input.",
    "",
    "Compatibility aliases:",
    "  vibecodr tools           Equivalent to vibecodr mcp tools.",
    "  vibecodr call            Equivalent to vibecodr mcp call.",
    "",
    "Power flags:",
    "  --json                   Keep output stable for scripts.",
    "  --non-interactive        Never open login or prompt."
  ].join("\n");
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let row = 1; row <= a.length; row += 1) {
    current[0] = row;
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a.charAt(row - 1) === b.charAt(column - 1) ? 0 : 1;
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length] ?? Number.MAX_SAFE_INTEGER;
}

function nearestRegisteredCommand(input: string): string | undefined {
  const normalized = input.toLowerCase();
  let best: { name: string; distance: number } | undefined;
  for (const command of COMMAND_REGISTRY) {
    const name = command.name.toLowerCase();
    const distance = editDistance(normalized, name);
    if (!best || distance < best.distance) {
      best = { name: command.name, distance };
    }
  }
  if (!best) return undefined;
  const maxDistance = normalized.length <= 4 ? 1 : 2;
  return best.distance <= maxDistance ? best.name : undefined;
}

function preferredCommand(command: string): string {
  return findCommandDefinition(command)?.preferred ?? command;
}

export function commandSuggestion(input: string | undefined): string {
  const normalized = (input ?? "").toLowerCase();
  const manual = COMMON_CONFUSIONS.get(normalized);
  const suggestion = manual ?? nearestRegisteredCommand(normalized);
  if (suggestion) {
    return `Try \`vibecodr ${preferredCommand(suggestion)}\`. Run \`vibecodr --help\` for the common paths.`;
  }
  return "Run `vibecodr --help` for the common paths, or `vibecodr doctor` if setup is failing.";
}

export function mcpCommandSuggestion(input: string | undefined): string {
  const normalized = (input ?? "").toLowerCase();
  const suggestion = MCP_CONFUSIONS.get(normalized) ?? (editDistance(normalized, "tools") <= 1 ? "tools" : undefined);
  if (suggestion === "tools") return "Try `vibecodr mcp tools`. Run `vibecodr mcp --help` for MCP Gateway examples.";
  if (suggestion === "call") return "Try `vibecodr mcp call <tool> --input-json '{}'`. Run `vibecodr mcp --help` for examples.";
  return "Run `vibecodr mcp --help`, `vibecodr mcp tools`, or `vibecodr mcp call <tool> --input-json '{}'`.";
}
