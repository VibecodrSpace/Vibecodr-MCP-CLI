import { formatJson, summarizeToolSchema } from "../core/renderers.js";
import { parseFlags } from "../cli/parse.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { showHelpIfRequested } from "./help.js";
import type { CommandContext } from "./context.js";
import type { SessionRecord } from "../types/auth.js";

function challengedScope(error: CliError): string | undefined {
  if (!error.debugDetails || typeof error.debugDetails !== "object") return undefined;
  const scope = (error.debugDetails as Record<string, unknown>)["scope"];
  return typeof scope === "string" && scope.trim() ? scope : undefined;
}

async function loadToolsWithRetry(
  context: CommandContext,
  allowLogin: boolean
): Promise<{ tools: Awaited<ReturnType<CommandContext["runtimeClient"]["listTools"]>>; session?: SessionRecord }> {
  const { profileName, serverUrl } = await context.tokenManager.resolveProfile(context.globalOptions);
  const existingSession = await context.tokenManager.getSession(profileName, serverUrl);
  try {
    return {
      tools: await context.runtimeClient.listTools(serverUrl, existingSession?.accessToken),
      ...(existingSession ? { session: existingSession } : {})
    };
  } catch (error) {
    if (!(error instanceof CliError) || !["auth.required", "auth.insufficient_scope"].includes(error.machineCode)) throw error;
    if (error.machineCode === "auth.required" && existingSession?.refreshToken) {
      const refreshed = await context.tokenManager.refresh(profileName, existingSession);
      return {
        tools: await context.runtimeClient.listTools(serverUrl, refreshed.session.accessToken),
        session: refreshed.session
      };
    }
    if (allowLogin && !context.globalOptions.nonInteractive) {
      await context.tokenManager.login(context.globalOptions, {
        scope: challengedScope(error)
      });
      const nextSession = await context.tokenManager.getSession(profileName, serverUrl);
      return {
        tools: await context.runtimeClient.listTools(serverUrl, nextSession?.accessToken),
        ...(nextSession ? { session: nextSession } : {})
      };
    }
    throw error;
  }
}

export async function runToolsCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(args, context, "Usage: vibecodr tools [<tool-name>] [--search <text>] [--schema] [--no-login]")) return;
  const { flags, positionals } = parseFlags(args, {
    valueFlags: ["search"],
    booleanFlags: ["schema", "no-login"]
  });
  const toolName = positionals[0];
  const { tools, session } = await loadToolsWithRetry(context, !flags["no-login"]);
  const serverUrl = session?.serverUrl || (await context.tokenManager.resolveProfile(context.globalOptions)).serverUrl;
  const sortedTools = tools
    .sort((left, right) => left.name.localeCompare(right.name));
  const search = typeof flags["search"] === "string" ? flags["search"].toLowerCase() : "";
  const filtered = search
    ? sortedTools.filter((tool) =>
        tool.name.toLowerCase().includes(search) || (tool.description || "").toLowerCase().includes(search)
      )
    : sortedTools;

  if (!toolName) {
    context.output.success(
      {
        schemaVersion: 1,
        serverUrl,
        toolCount: filtered.length,
        tools: filtered
      },
      filtered.map((tool) => `${tool.name}${tool.description ? `: ${tool.description}` : ""}`)
    );
    return;
  }

  const tool = sortedTools.find((item) => item.name === toolName);
  if (!tool) {
    throw new CliError("tool.not_found", `Tool not found: ${toolName}`, EXIT_CODES.toolFailed);
  }
  const summary = summarizeToolSchema(tool.inputSchema as Record<string, unknown> | undefined);
  context.output.success(
    {
      schemaVersion: 1,
      tool
    },
    [
      `Name: ${tool.name}`,
      `Description: ${tool.description || ""}`,
      `Required: ${summary.required.join(", ") || "none"}`,
      `Optional: ${summary.optional.join(", ") || "none"}`,
      "Input skeleton:",
      formatJson(summary.skeleton),
      ...(flags["schema"] ? ["Schema:", formatJson(tool.inputSchema)] : [])
    ]
  );
}
