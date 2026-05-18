const TOKENISH_PATTERNS: RegExp[] = [
  /\bvc_[A-Za-z0-9._~+/=-]{12,}\b/g,
  /\bsk-[A-Za-z0-9._~+/=-]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
  /("?(?:token|access_token|refresh_token|authorization|secret|apiKey|api_key)"?\s*[:=]\s*")([^"\s]+)("?)/gi
];

const SAFE_OPERATOR_KEY_PARTS = new Set([
  "artifactid",
  "allowbrowsersessions",
  "browsermsused",
  "cachedtokens",
  "capability",
  "completiontokens",
  "concurrentbrowsersessions",
  "concurrentsandboxjobs",
  "contenttype",
  "credentialsexist",
  "credentialstore",
  "credentialtype",
  "errorcode",
  "errorkey",
  "inputtokens",
  "jobid",
  "maxbrowsersessionseconds",
  "maxconcurrentbrowsersessionsperuser",
  "maxsandboxtaskseconds",
  "meter",
  "outputtokens",
  "prompttokens",
  "providerMode",
  "quantity",
  "reasoningtokens",
  "requestid",
  "reservedbrowserseconds",
  "reservedcredits",
  "reservedsandboxseconds",
  "scopes",
  "status",
  "tokenCount",
  "tokenKind",
  "tokensUsed",
  "totalTokens",
  "traceid"
].map(normalizeKey));

const AUTHORITY_KEY_PARTS = [
  "accesstoken",
  "apikey",
  "authorization",
  "bearer",
  "clientsecret",
  "cookie",
  "credential",
  "jwt",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "session",
  "token"
];

export function redactSecrets(value: unknown): string {
  let text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) {
    return "";
  }

  for (const pattern of TOKENISH_PATTERNS) {
    text = text.replace(pattern, (match, prefix: string | undefined, _secret: string | undefined, suffix: string | undefined) => {
      if (prefix !== undefined && suffix !== undefined) {
        return `${prefix}[redacted]${suffix}`;
      }
      return match.toLowerCase().startsWith("bearer ") ? "Bearer [redacted]" : "[redacted]";
    });
  }

  return text;
}

export function redactObject<T>(value: T): T {
  return redactObjectValue(value) as T;
}

export function isSecretBearingKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (SAFE_OPERATOR_KEY_PARTS.has(normalized)) {
    return false;
  }
  return AUTHORITY_KEY_PARTS.some((part) => normalized.includes(part));
}

function redactObjectValue(value: unknown, key?: string): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return key && isSafeOperatorKey(key) ? redactSafeOperatorString(value) : redactSecrets(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactObjectValue(item));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (isSecretBearingKey(key)) {
        output[key] = "[redacted]";
      } else {
        output[key] = redactObjectValue(item, key);
      }
    }
    return output;
  }

  return value;
}

function isSafeOperatorKey(key: string): boolean {
  return SAFE_OPERATOR_KEY_PARTS.has(normalizeKey(key));
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function redactSafeOperatorString(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9._~+/=-]{12,}\b/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, "Bearer [redacted]");
}
