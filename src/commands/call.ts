import { readFile } from "node:fs/promises";
import { promptText } from "../platform/prompt.js";
import { parseFlags } from "../cli/parse.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { renderToolResult } from "../core/renderers.js";
import { promptObjectBySchema } from "../core/interactive-input.js";
import type { CommandContext } from "./context.js";
import type { SessionRecord } from "../types/auth.js";

function challengedScope(error: CliError): string | undefined {
  if (!error.debugDetails || typeof error.debugDetails !== "object") return undefined;
  const scope = (error.debugDetails as Record<string, unknown>)["scope"];
  return typeof scope === "string" && scope.trim() ? scope : undefined;
}

async function requiredScopeForTool(context: CommandContext, toolName: string): Promise<string | undefined> {
  const { serverUrl } = await context.tokenManager.resolveProfile(context.globalOptions);
  const tools = await context.runtimeClient.listTools(serverUrl);
  const tool = tools.find((item) => item.name === toolName);
  const directSchemes = Array.isArray((tool as Record<string, unknown> | undefined)?.["securitySchemes"])
    ? ((tool as unknown as { securitySchemes: Array<{ type?: string; scopes?: string[] }> }).securitySchemes)
    : [];
  const metaSchemes = tool?._meta && typeof tool._meta === "object" && Array.isArray((tool._meta as Record<string, unknown>)["securitySchemes"])
    ? ((tool._meta as Record<string, unknown>)["securitySchemes"] as Array<{ type?: string; scopes?: string[] }>)
    : [];
  const scopes = [...directSchemes, ...metaSchemes].find((scheme) => scheme.type === "oauth2")?.scopes;
  return Array.isArray(scopes) && scopes.length ? scopes.join(" ") : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function callToolWithRetry(
  context: CommandContext,
  toolName: string,
  input: Record<string, unknown>,
  allowLogin: boolean
): Promise<{ result: Awaited<ReturnType<CommandContext["runtimeClient"]["callTool"]>>; session?: SessionRecord }> {
  const { profileName, serverUrl } = await context.tokenManager.resolveProfile(context.globalOptions);
  const existingSession = await context.tokenManager.getSession(profileName);
  try {
    return {
      result: await context.runtimeClient.callTool(serverUrl, existingSession?.accessToken, toolName, input),
      ...(existingSession ? { session: existingSession } : {})
    };
  } catch (error) {
    if (!(error instanceof CliError) || !["auth.required", "auth.insufficient_scope"].includes(error.machineCode)) throw error;
    if (error.machineCode === "auth.required" && existingSession?.refreshToken) {
      const refreshed = await context.tokenManager.refresh(profileName, existingSession);
      return {
        result: await context.runtimeClient.callTool(serverUrl, refreshed.session.accessToken, toolName, input),
        session: refreshed.session
      };
    }
    if (allowLogin && !context.globalOptions.nonInteractive) {
      const scope = challengedScope(error) || await requiredScopeForTool(context, toolName);
      await context.tokenManager.login(context.globalOptions, {
        scope
      });
      const nextSession = await context.tokenManager.getSession(profileName);
      return {
        result: await context.runtimeClient.callTool(serverUrl, nextSession?.accessToken, toolName, input),
        ...(nextSession ? { session: nextSession } : {})
      };
    }
    throw error;
  }
}

async function listToolsWithRetry(
  context: CommandContext,
  allowLogin: boolean
): Promise<Awaited<ReturnType<CommandContext["runtimeClient"]["listTools"]>>> {
  const { profileName, serverUrl } = await context.tokenManager.resolveProfile(context.globalOptions);
  const existingSession = await context.tokenManager.getSession(profileName);
  try {
    return await context.runtimeClient.listTools(serverUrl, existingSession?.accessToken);
  } catch (error) {
    if (!(error instanceof CliError) || !["auth.required", "auth.insufficient_scope"].includes(error.machineCode)) throw error;
    if (error.machineCode === "auth.required" && existingSession?.refreshToken) {
      const refreshed = await context.tokenManager.refresh(profileName, existingSession);
      return await context.runtimeClient.listTools(serverUrl, refreshed.session.accessToken);
    }
    if (allowLogin && !context.globalOptions.nonInteractive) {
      await context.tokenManager.login(context.globalOptions, {
        scope: challengedScope(error)
      });
      const nextSession = await context.tokenManager.getSession(profileName);
      return await context.runtimeClient.listTools(serverUrl, nextSession?.accessToken);
    }
    throw error;
  }
}

export async function runCallCommand(args: string[], context: CommandContext): Promise<void> {
  const { flags, positionals } = parseFlags(args, {
    valueFlags: ["input-json", "input-file"],
    booleanFlags: ["stdin", "interactive", "no-login"]
  });
  const toolName = positionals[0];
  if (!toolName) {
    throw new CliError("usage.tool_name_required", "A tool name is required.", EXIT_CODES.usage);
  }

  let input: Record<string, unknown> = {};
  if (typeof flags["input-json"] === "string") {
    input = JSON.parse(flags["input-json"]) as Record<string, unknown>;
  } else if (typeof flags["input-file"] === "string") {
    input = JSON.parse(await readFile(flags["input-file"], "utf8")) as Record<string, unknown>;
  } else if (flags["stdin"]) {
    input = JSON.parse(await readStdin()) as Record<string, unknown>;
  } else if (flags["interactive"]) {
    const tools = await listToolsWithRetry(context, !flags["no-login"]);
    const tool = tools.find((item) => item.name === toolName);
    if (!tool) {
      throw new CliError("tool.not_found", `Tool not found: ${toolName}`, EXIT_CODES.toolFailed);
    }
    input = await promptObjectBySchema(promptText, toolName, tool.inputSchema as Record<string, unknown> | undefined);
  }

  const { result } = await callToolWithRetry(context, toolName, input, !flags["no-login"]);
  context.output.success(
    {
      schemaVersion: 1,
      tool: toolName,
      arguments: input,
      result
    },
    [renderToolResult(result)]
  );
}
