import assert from "node:assert/strict";
import test from "node:test";
import { isSecretBearingKey, redactObject, redactSecrets } from "../../src/legacy/core/redaction.js";

const fakeSecret = (...parts: string[]) => parts.join("_");
const fakeSkAuthority = () => ["sk", "testsecret1234567890"].join("-");
const fakeBearerAuthority = () => ["Bearer", "abcdefghijklmno"].join(" ");

test("redaction preserves safe operator handles and usage counters", () => {
  const authToken = fakeSecret("vc", "secret", "token", "1234567890");
  const accessToken = fakeSecret("oauth", "access", "token", "1234567890");
  const apiKey = fakeSkAuthority();

  const redacted = redactObject({
    artifactId: "vc_artifact_1234567890",
    requestId: "req_1234567890",
    traceId: "trace_1234567890",
    errorCode: "provider.browser_run_failed",
    tokenCount: 123,
    tokenKind: "cli_grant",
    tokensUsed: 456,
    totalTokens: 789,
    promptTokens: 300,
    completionTokens: 489,
    authToken,
    access_token: accessToken,
    nested: {
      apiKey,
      browserMsUsed: 1200,
      reservedCredits: 1,
      maxBrowserSessionSeconds: 3600,
      maxConcurrentBrowserSessionsPerUser: 1,
      concurrentBrowserSessions: 1,
      maxSandboxTaskSeconds: 1800,
      concurrentSandboxJobs: 2,
      reservedSandboxSeconds: 30
    }
  });

  assert.equal(redacted.artifactId, "vc_artifact_1234567890");
  assert.equal(redacted.requestId, "req_1234567890");
  assert.equal(redacted.traceId, "trace_1234567890");
  assert.equal(redacted.errorCode, "provider.browser_run_failed");
  assert.equal(redacted.tokenCount, 123);
  assert.equal(redacted.tokenKind, "cli_grant");
  assert.equal(redacted.tokensUsed, 456);
  assert.equal(redacted.totalTokens, 789);
  assert.equal(redacted.promptTokens, 300);
  assert.equal(redacted.completionTokens, 489);
  assert.equal(redacted.authToken, "[redacted]");
  assert.equal(redacted.access_token, "[redacted]");
  assert.equal(redacted.nested.apiKey, "[redacted]");
  assert.equal(redacted.nested.browserMsUsed, 1200);
  assert.equal(redacted.nested.reservedCredits, 1);
  assert.equal(redacted.nested.maxBrowserSessionSeconds, 3600);
  assert.equal(redacted.nested.maxConcurrentBrowserSessionsPerUser, 1);
  assert.equal(redacted.nested.concurrentBrowserSessions, 1);
  assert.equal(redacted.nested.maxSandboxTaskSeconds, 1800);
  assert.equal(redacted.nested.concurrentSandboxJobs, 2);
  assert.equal(redacted.nested.reservedSandboxSeconds, 30);
});

test("safe operator strings still redact explicit bearer or sk-style authority", () => {
  const bearerAuthority = fakeBearerAuthority();
  const skAuthority = fakeSkAuthority();

  const redacted = redactObject({
    requestId: bearerAuthority,
    artifactId: skAuthority
  });

  assert.equal(redacted.requestId, "Bearer [redacted]");
  assert.equal(redacted.artifactId, "[redacted]");
});

test("generic diagnostics still redact token-like strings", () => {
  const secret = fakeSecret("vc", "secret", "token", "1234567890");
  const text = redactSecrets(`provider returned ${secret} for trace trace_123`);

  assert.equal(text.includes(secret), false);
  assert.match(text, /\[redacted\]/);
});

test("key classifier distinguishes token metrics from token authority", () => {
  assert.equal(isSecretBearingKey("tokenCount"), false);
  assert.equal(isSecretBearingKey("total_tokens"), false);
  assert.equal(isSecretBearingKey("tokenKind"), false);
  assert.equal(isSecretBearingKey("maxBrowserSessionSeconds"), false);
  assert.equal(isSecretBearingKey("maxConcurrentBrowserSessionsPerUser"), false);
  assert.equal(isSecretBearingKey("authToken"), true);
  assert.equal(isSecretBearingKey("access_token"), true);
});
