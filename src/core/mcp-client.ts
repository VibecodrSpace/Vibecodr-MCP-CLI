import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { extractWWWAuthenticateParams } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json") as { version?: unknown };
const packageVersion = typeof packageJson.version === "string" && packageJson.version.length > 0
  ? packageJson.version
  : "0.0.0";

export const CLIENT_INFO = {
  name: "vibecodr-mcp",
  version: packageVersion
};

export type ListedTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];
export type CalledToolResult = Awaited<ReturnType<Client["callTool"]>>;

export type CallToolOptions = {
  timeoutSeconds?: number | undefined;
};

type CapturedAuthChallenge = {
  status: number;
  scope?: string | undefined;
  error?: string | undefined;
  resourceMetadataUrl?: string | undefined;
};

export function resolveToolRequestTimeoutMs(args: Record<string, unknown>, options?: CallToolOptions): number | undefined {
  const raw = options?.timeoutSeconds ?? args["timeoutSeconds"];
  if (raw === undefined) return undefined;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const timeoutSeconds = Math.min(Math.max(Math.floor(raw), 5), 600);
  return timeoutSeconds * 1000 + 15_000;
}

function isMcpRequestTimeout(error: unknown): boolean {
  return error instanceof McpError && error.code === ErrorCode.RequestTimeout;
}

export class McpRuntimeClient {
  async listTools(serverUrl: string, accessToken?: string): Promise<ListedTool[]> {
    return await this.withClient(serverUrl, accessToken, async (client) => {
      const result = await client.listTools();
      return result.tools;
    });
  }

  async callTool(
    serverUrl: string,
    accessToken: string | undefined,
    name: string,
    args: Record<string, unknown>,
    options?: CallToolOptions
  ): Promise<CalledToolResult> {
    return await this.withClient(serverUrl, accessToken, async (client) => {
      const timeout = resolveToolRequestTimeoutMs(args, options);
      return await client.callTool({
        name,
        arguments: args
      }, undefined, timeout === undefined ? undefined : { timeout });
    });
  }

  private async withClient<T>(serverUrl: string, accessToken: string | undefined, fn: (client: Client) => Promise<T>): Promise<T> {
    let authChallenge: CapturedAuthChallenge | undefined;
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      ...(accessToken ? { requestInit: {
        headers: {
          authorization: `Bearer ${accessToken}`
        }
      } } : {}),
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        if (response.status === 401 || response.status === 403) {
          const challenge = extractWWWAuthenticateParams(response);
          authChallenge = {
            status: response.status,
            scope: challenge.scope,
            error: challenge.error,
            resourceMetadataUrl: challenge.resourceMetadataUrl?.toString()
          };
        }
        return response;
      }
    });
    const client = new Client(CLIENT_INFO, {
      capabilities: {}
    });
    try {
      await client.connect(transport as Parameters<Client["connect"]>[0]);
      return await fn(client);
    } catch (error) {
      if (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403)) {
        const requiredScope = authChallenge?.scope;
        const isScopeStepUp = authChallenge?.error === "insufficient_scope" || error.code === 403;
        throw new CliError(
          isScopeStepUp ? "auth.insufficient_scope" : "auth.required",
          isScopeStepUp
            ? "The MCP server requires a broader OAuth scope for this operation."
            : "The MCP server requires authentication for this operation.",
          EXIT_CODES.authRequired,
          {
            cause: error,
            debugDetails: authChallenge,
            nextStep: requiredScope
              ? `Run vibecodr login --scope "${requiredScope}", or retry interactively to complete CLI MCP OAuth. CLI auth is separate from Codex, editor, ChatGPT, and other MCP client auth.`
              : "Run vibecodr login, or retry interactively to complete CLI MCP OAuth. CLI auth is separate from Codex, editor, ChatGPT, and other MCP client auth."
          }
        );
      }
      if (isMcpRequestTimeout(error)) {
        throw new CliError(
          "mcp.request_timeout",
          "The MCP request timed out before Vibecodr finished the operation.",
          EXIT_CODES.protocol,
          {
            cause: error,
            debugDetails: { code: ErrorCode.RequestTimeout },
            nextStep: "If this was an import or publish, run vibecodr call resume_latest_publish_flow --json to pick up the operation without restarting."
          }
        );
      }

      throw new CliError("mcp.protocol", "Failed to complete the MCP request.", EXIT_CODES.protocol, {
        cause: error,
        nextStep: "Run vibecodr doctor to inspect auth, discovery, and connectivity."
      });
    } finally {
      await transport.close().catch(() => undefined);
    }
  }
}
