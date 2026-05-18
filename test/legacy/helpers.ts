import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { runCli } from "../../src/legacy/cli/run.js";

export interface CliRunResult {
  code: number;
  stdout: string;
  stderr: string;
  configDir: string;
  cwd: string;
  cleanup(): Promise<void>;
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
}

export interface MockRoute {
  method: string;
  path: string;
  response: unknown | ((request: RecordedRequest) => unknown | Promise<unknown>);
  status?: number;
  headers?: Record<string, string>;
}

export async function runWithMockApi(
  argv: string[],
  routes: MockRoute[] = [],
  options: { env?: NodeJS.ProcessEnv; cwd?: string; allowInsecureLocalApi?: boolean; stdin?: string } = {}
): Promise<CliRunResult & { requests: RecordedRequest[] }> {
  const configDir = await mkdtemp(path.join(os.tmpdir(), "vc-tools-config-"));
  const ownsCwd = options.cwd === undefined;
  const cwd = options.cwd ?? await mkdtemp(path.join(os.tmpdir(), "vc-tools-cwd-"));
  const stdout = new MemoryWritable();
  const stderr = new MemoryWritable();
  const requests: RecordedRequest[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    let body: unknown;
    if (typeof init?.body === "string") {
      body = JSON.parse(init.body);
    } else if (init?.body instanceof FormData) {
      body = Object.fromEntries(init.body.entries());
    }
    const headers = headersToRecord(init?.headers);
    const request: RecordedRequest = {
      method: init?.method ?? "GET",
      url: url.toString(),
      headers,
      body
    };
    requests.push(request);
    const route = routes.find((candidate) => candidate.method === request.method && url.pathname === candidate.path);
    if (!route) {
      return jsonResponse({ code: "not_found", message: `No mock route for ${request.method} ${url.pathname}` }, 404);
    }
    const payload = typeof route.response === "function" ? await route.response(request) : route.response;
    if (payload instanceof Uint8Array) {
      const body = new Uint8Array(payload);
      const init: ResponseInit = { status: route.status ?? 200 };
      if (route.headers !== undefined) {
        init.headers = route.headers;
      }
      return new Response(body.buffer, init);
    }
    return jsonResponse(payload, route.status ?? 200, route.headers);
  };

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VC_TOOLS_CREDENTIAL_STORE: "file",
    VC_TOOLS_CONFIG_DIR: configDir,
    VC_TOOLS_API_URL: "http://localhost:8787",
    VC_TOOLS_ALLOW_INSECURE_LOCAL_API: "true",
    VC_TOOLS_BROWSER_OPEN: "false",
    ...options.env
  };
  for (const key of [
    "VC_TOOLS_CREDENTIAL",
    "VC_TOOLS_CREDENTIAL_FILE",
    "VC_TOOLS_TOKEN",
    "VC_TOOLS_TOKEN_FILE",
    "VC_TOOLS_AUTH_API_URL"
  ]) {
    if (!Object.prototype.hasOwnProperty.call(options.env ?? {}, key)) {
      delete env[key];
    }
  }
  if (options.allowInsecureLocalApi === false) {
    delete env.VC_TOOLS_ALLOW_INSECURE_LOCAL_API;
  }

  const code = await runCli(argv, {
    cwd,
    stdout,
    stderr,
    stdin: Readable.from(options.stdin === undefined ? [] : [options.stdin]),
    fetchImpl,
    env
  });

  return {
    code,
    stdout: stdout.text,
    stderr: stderr.text,
    configDir,
    cwd,
    requests,
    async cleanup() {
      await rm(configDir, { recursive: true, force: true });
      if (ownsCwd) {
        await rm(cwd, { recursive: true, force: true });
      }
    }
  };
}

export function meRoute(): MockRoute {
  return {
    method: "GET",
    path: "/v1/me",
    response: {
      user: { id: "usr_123", email: "builder@example.com" },
      workspace: { id: "wrk_123", name: "Vibecodr" },
      plan: { name: "Pro" }
    }
  };
}

export function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers
    }
  });
}

class MemoryWritable extends Writable {
  text = "";

  override _write(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.text += String(chunk);
    callback();
  }
}

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map(([key, value]) => [key.toLowerCase(), value]));
  }
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}
