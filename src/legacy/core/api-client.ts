import { CliError } from "../cli/errors.js";
import { redactObject, redactSecrets } from "./redaction.js";

export interface ApiClientOptions {
  baseUrl: string;
  token?: string | undefined;
  timeoutMs: number;
  allowInsecureLocalApi?: boolean | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface BaseClientOptions {
  baseUrl: string;
  timeoutMs: number;
  allowInsecureLocalApi?: boolean | undefined;
  fetchImpl?: typeof fetch | undefined;
  serviceName?: string | undefined;
  redactResponses?: boolean | undefined;
}

export interface BaseRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ApiRequestOptions extends BaseRequestOptions {
  auth?: boolean;
}

export interface DownloadResponse {
  bytes: Uint8Array;
  contentType: string;
  filename?: string | undefined;
}

export interface ApiClient {
  readonly baseUrl: string;
  request<T = unknown>(method: string, path: string, options?: ApiRequestOptions): Promise<T>;
  download(path: string, options?: ApiRequestOptions): Promise<DownloadResponse>;
  upload<T = unknown>(path: string, form: FormData, options?: ApiRequestOptions): Promise<T>;
}

export interface BaseClient {
  readonly baseUrl: string;
  request<T = unknown>(method: string, path: string, options?: BaseRequestOptions): Promise<T>;
  download(path: string, options?: BaseRequestOptions): Promise<DownloadResponse>;
  upload<T = unknown>(path: string, form: FormData, options?: BaseRequestOptions): Promise<T>;
}

export function createBaseClient(options: BaseClientOptions): BaseClient {
  const base = normalizeBaseUrl(options.baseUrl, options.allowInsecureLocalApi === true);
  const fetchImpl = options.fetchImpl ?? fetch;
  const serviceName = options.serviceName ?? "Remote API";
  const redactResponses = options.redactResponses !== false;

  async function send(method: string, requestPath: string, requestOptions: BaseRequestOptions = {}, body?: BodyInit): Promise<Response> {
    const url = buildUrl(base, requestPath, requestOptions.query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    const headers: Record<string, string> = {
      ...requestOptions.headers
    };

    try {
      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal
      };
      if (body !== undefined) {
        init.body = body;
      }
      return await fetchImpl(url, init);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new CliError("upstream.timeout", `Timed out calling ${url.origin}.`, 6);
      }
      throw new CliError("upstream.unavailable", `Could not reach ${url.origin}.`, 6);
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    baseUrl: base.toString().replace(/\/$/, ""),
    async request<T = unknown>(method: string, path: string, requestOptions: BaseRequestOptions = {}): Promise<T> {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...requestOptions.headers
      };
      let body: BodyInit | undefined;
      if (requestOptions.body !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(requestOptions.body);
      }
      const response = await send(method, path, { ...requestOptions, headers }, body);
      return parseJsonResponse<T>(response, serviceName, redactResponses);
    },
    async download(path: string, requestOptions: BaseRequestOptions = {}): Promise<DownloadResponse> {
      const response = await send("GET", path, {
        ...requestOptions,
        headers: {
          Accept: "application/octet-stream",
          ...requestOptions?.headers
        }
      });
      if (!response.ok) {
        await throwApiError(response, serviceName);
      }
      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      const contentDisposition = response.headers.get("content-disposition") ?? undefined;
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType,
        filename: filenameFromContentDisposition(contentDisposition)
      };
    },
    async upload<T = unknown>(path: string, form: FormData, requestOptions: BaseRequestOptions = {}): Promise<T> {
      const response = await send("POST", path, {
        ...requestOptions,
        headers: {
          Accept: "application/json",
          ...requestOptions.headers
        }
      }, form);
      return parseJsonResponse<T>(response, serviceName, redactResponses);
    }
  };
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const base = createBaseClient({ ...options, serviceName: "Hosted Tools API" });

  function authorizedOptions(requestOptions: ApiRequestOptions = {}): BaseRequestOptions {
    const { auth: _auth, ...baseOptions } = requestOptions;
    if (requestOptions.auth === false) {
      return baseOptions;
    }

    if (!options.token) {
      throw new CliError("auth.missing", "Run vc-tools login or provide a credential file/stdin source before calling the hosted Tools API.", 3);
    }

    return {
      ...baseOptions,
      headers: {
        ...baseOptions.headers,
        Authorization: `Bearer ${options.token}`
      }
    };
  }

  return {
    baseUrl: base.baseUrl,
    request<T = unknown>(method: string, path: string, requestOptions?: ApiRequestOptions): Promise<T> {
      return base.request<T>(method, path, authorizedOptions(requestOptions));
    },
    download(path: string, requestOptions?: ApiRequestOptions): Promise<DownloadResponse> {
      return base.download(path, authorizedOptions(requestOptions));
    },
    upload<T = unknown>(path: string, form: FormData, requestOptions?: ApiRequestOptions): Promise<T> {
      return base.upload<T>(path, form, authorizedOptions(requestOptions));
    }
  };
}

export function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

async function parseJsonResponse<T>(response: Response, serviceName: string, redactResponse: boolean): Promise<T> {
  if (!response.ok) {
    await throwApiError(response, serviceName);
  }

  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new CliError("upstream.invalid_response", `${serviceName} returned a non-JSON response.`, 6);
  }

  const json = await response.json();
  return (redactResponse ? redactObject(json) : json) as T;
}

async function throwApiError(response: Response, serviceName: string): Promise<never> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = await response.text().catch(() => "");
  }

  const record = isRecord(payload) ? payload : {};
  const code = typeof record.code === "string" ? record.code : typeof record.errorKey === "string" ? record.errorKey : "upstream.error";
  const rawMessage = typeof record.message === "string" ? record.message : `${serviceName} returned HTTP ${response.status}.`;
  const message = friendlyAuthMessage(response.status, code) ?? rawMessage;
  const exit = response.status >= 500 ? 6 : response.status === 401 || response.status === 403 ? 3 : 1;
  throw new CliError(code, redactSecrets(message), exit, redactObject({ status: response.status, payload }));
}

function friendlyAuthMessage(status: number, code: string): string | undefined {
  if (status !== 401 && status !== 403) {
    return undefined;
  }
  if (code === "auth.missing") {
    return "This Agent Computer is not connected yet. Run vc-tools start to connect it, or provide VC_TOOLS_CREDENTIAL_FILE for automation.";
  }
  if (code === "auth.denied" || code.startsWith("auth.")) {
    return "This Agent Computer credential was rejected or expired. Run vc-tools start to reconnect, or refresh the credential file/env source this command uses.";
  }
  return undefined;
}

export function normalizeBaseUrl(input: string, allowInsecureLocalApi: boolean): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CliError("config.invalid_api_url", "API URL must be an absolute URL.", 5);
  }

  if (url.username || url.password) {
    throw new CliError("config.invalid_api_url", "API URL must not include credentials.", 5);
  }

  if (url.protocol !== "https:") {
    if (isLocalDevUrl(url)) {
      if (!allowInsecureLocalApi) {
        throw new CliError(
          "config.insecure_local_api_denied",
          "Local HTTP API URLs require --allow-insecure-local-api or VC_TOOLS_ALLOW_INSECURE_LOCAL_API=true.",
          5
        );
      }
    } else {
      throw new CliError("config.invalid_api_url", "API URL must use https.", 5);
    }
  }

  url.pathname = url.pathname.replace(/\/+$/, "/");
  return url;
}

function buildUrl(base: URL, requestPath: string, query: ApiRequestOptions["query"]): URL {
  const url = new URL(requestPath.replace(/^\/+/, ""), base);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function filenameFromContentDisposition(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(value);
  return match?.[1] ? decodeURIComponent(match[1]) : undefined;
}

function isLocalDevUrl(url: URL): boolean {
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(hostname);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
