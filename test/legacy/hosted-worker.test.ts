import assert from "node:assert/strict";
import { createHash, createHmac, createPrivateKey, sign as signCrypto } from "node:crypto";
import test from "node:test";
import puppeteer from "@cloudflare/puppeteer";

(globalThis as typeof globalThis & { __VC_TOOLS_HOSTED_WORKER_TEST__?: boolean }).__VC_TOOLS_HOSTED_WORKER_TEST__ = true;

type SandboxTestGlobal = typeof globalThis & {
  __VC_TOOLS_SANDBOX_TEST_FACTORY__?: () => {
    exec(command: string, options?: Record<string, unknown>): Promise<Record<string, unknown>>;
    destroy(): Promise<void>;
  };
};

const { BrowserAgentTaskWorkflow, Sandbox, default: worker } = await import("../../src/hosted/worker.js");

const baseEnv = {
  VC_TOOLS_PUBLIC_BASE_URL: "https://tools.vibecodr.space",
  VC_TOOLS_PROVIDER_MODE: "contract" as const
};

const fakeSecret = (...parts: string[]) => parts.join("_");
const bearerHeader = (token: string) => ["Bearer", token].join(" ");
const browserRunApiToken = () => fakeSecret("cf", "quick", "action", "token");

const TEST_CLI_PRIVATE_JWK = {
  kty: "EC",
  x: "v4PQ4PtIjhq3mBltq-tMwZS3tVlF2neJYKBE2oalCkQ",
  y: "Vi-FtvtmClYF7R2SL-z-zp3lK9tZiINjAXl2hK8VbCA",
  crv: "P-256",
  d: "H4O-ymKQ05CMbTvXFqVB6hU8VP1f6H3y7_uYnGC7D0o",
  kid: "test-cli-grant-p256-1",
  alg: "ES256",
  use: "sig"
};

const TEST_CLI_PUBLIC_JWKS = JSON.stringify({
  keys: [
    {
      kty: "EC",
      x: TEST_CLI_PRIVATE_JWK.x,
      y: TEST_CLI_PRIVATE_JWK.y,
      crv: "P-256",
      kid: TEST_CLI_PRIVATE_JWK.kid,
      alg: "ES256",
      use: "sig"
    }
  ]
});

test("hosted worker exposes public health and MCP metadata while protecting inspection", async () => {
  const health = await fetchWorker("https://tools.vibecodr.space/v1/health", baseEnv);
  assert.equal(health.response.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal("providerMode" in health.body, false);
  assert.equal((health.body.live as { providerMode?: string }).providerMode, undefined);
  assert.equal((health.body.live as { network?: { computerPublicHttps?: string } }).network?.computerPublicHttps, "available");
  assert.equal(JSON.stringify(health.body.live).includes("operatorAlerts"), false);

  const unauthenticatedInspect = await fetchWorker("https://tools.vibecodr.space/v1/inspect", authedEnv("inspect-token"));
  assert.equal(unauthenticatedInspect.response.status, 401);
  assert.equal(unauthenticatedInspect.body.code, "auth.missing");

  const inspect = await fetchWorker("https://tools.vibecodr.space/v1/inspect", authedEnv("inspect-token"), {
    headers: { authorization: "Bearer inspect-token" }
  });
  assert.equal(inspect.response.status, 200);
  assert.equal(inspect.body.summary.hostedRequired, 1);
  assert.equal(inspect.body.inspections.some((item: { id: string; status: string }) => item.id === "hosted-service" && item.status === "local-verified"), true);
  assert.equal(inspect.body.inspections.some((item: { id: string; status: string }) => item.id === "human-use-security-hardening" && item.status === "local-verified"), true);
  assert.equal(inspect.body.inspections.some((item: { id: string; status: string }) => item.id === "live-hosted-production" && item.status === "hosted-required"), true);

  const mcp = await fetchWorker("https://tools.vibecodr.space/mcp", baseEnv);
  assert.equal(mcp.response.status, 200);
  assert.equal(mcp.body.transport, "streamable_http");
  assert.equal(mcp.body.protocolVersion, "2025-11-25");
  assert.equal(mcp.body.tools.some((tool: { name: string; capability: string }) => tool.name === "browser.render" && tool.capability === "browser.render_url"), true);
});

test("hosted worker fails closed without auth secret", async () => {
  const missingSecret = await fetchWorker("https://tools.vibecodr.space/v1/me", baseEnv);
  assert.equal(missingSecret.response.status, 503);
  assert.equal(missingSecret.body.code, "auth.not_configured");

  const env = authedEnv("correct-token");

  const missingToken = await fetchWorker("https://tools.vibecodr.space/v1/me", env);
  assert.equal(missingToken.response.status, 401);
  assert.equal(missingToken.body.code, "auth.missing");

  const badToken = await fetchWorker("https://tools.vibecodr.space/v1/me", env, {
    headers: { authorization: "Bearer wrong-token" }
  });
  assert.equal(badToken.response.status, 403);
  assert.equal(badToken.body.code, "auth.denied");
});

test("hosted worker records auth failure metrics without token material", async () => {
  const env = fakeLiveEnv("auth-metric-token");
  const result = await fetchWorker("https://tools.vibecodr.space/v1/me?token=query-secret", env, {
    headers: { authorization: "Bearer wrong-auth-token" }
  });
  await result.drainWaitUntil();

  assert.equal(result.response.status, 403);
  assert.equal(result.body.code, "auth.denied");
  const authFailureAudit = env.DB.runs.find((run) => run.sql.includes("INSERT INTO audit_events") && run.values.includes("auth.failed"));
  assert.ok(authFailureAudit);
  assert.equal(authFailureAudit.values.includes("anonymous"), true);
  assert.equal(authFailureAudit.values.includes("auth.denied"), true);
  assert.equal(authFailureAudit.values.includes("/v1/me"), true);
  const serialized = JSON.stringify(authFailureAudit);
  assert.equal(serialized.includes("wrong-auth-token"), false);
  assert.equal(serialized.includes("query-secret"), false);
});

test("hosted worker accepts scoped Vibecodr CLI grants and denies missing vc-tools scope", async () => {
  const grant = signEs256Grant({
    iss: "https://api.vibecodr.space",
    aud: "vibecodr:vc-tools",
    sub: "usr_signed",
    kind: "vibecodr_cli",
    scp: ["vc-tools:use"],
    plan: "Pro",
    email: "signed@example.com",
    workspace_id: "wrk_signed",
    exp: Math.floor(Date.now() / 1000) + 300
  });
  const env = {
    ...baseEnv,
    VC_TOOLS_CLI_GRANT_PUBLIC_JWKS: TEST_CLI_PUBLIC_JWKS
  };

  const accepted = await fetchWorker("https://tools.vibecodr.space/v1/me", env, {
    headers: { authorization: `Bearer ${grant}` }
  });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.user.id, "usr_signed");
  assert.equal(accepted.body.user.email, "signed@example.com");
  assert.equal(accepted.body.workspace.id, "wrk_signed");
  assert.equal(accepted.body.plan.name, "Pro");
  assert.equal("auth" in accepted.body, false);
  assert.equal("providerMode" in accepted.body, false);

  const noEmailGrant = signEs256Grant({
    iss: "https://api.vibecodr.space",
    aud: "vibecodr:vc-tools",
    sub: "usr_no_email",
    kind: "vibecodr_cli",
    scp: ["vc-tools:use"],
    plan: "Pro",
    exp: Math.floor(Date.now() / 1000) + 300
  });
  const noEmail = await fetchWorker("https://tools.vibecodr.space/v1/me", env, {
    headers: { authorization: `Bearer ${noEmailGrant}` }
  });
  assert.equal(noEmail.response.status, 200);
  assert.equal("email" in (noEmail.body.user as Record<string, unknown>), false);

  const rejectedGrantScenarios = [
    {
      name: "wrong issuer",
      payload: { iss: "https://evil.example", aud: "vibecodr:vc-tools" }
    },
    {
      name: "wrong audience",
      payload: { iss: "https://api.vibecodr.space", aud: "vibecodr:cli" }
    },
    {
      name: "missing vc-tools scope",
      payload: { iss: "https://api.vibecodr.space", aud: "vibecodr:vc-tools", scp: ["vibes:publish"] }
    },
    {
      name: "wrong grant profile",
      payload: { iss: "https://api.vibecodr.space", aud: "vibecodr:vc-tools", grant_profile: "default" }
    },
    {
      name: "expired token",
      payload: { iss: "https://api.vibecodr.space", aud: "vibecodr:vc-tools", exp: Math.floor(Date.now() / 1000) - 30 }
    },
    {
      name: "not-yet-valid token",
      payload: { iss: "https://api.vibecodr.space", aud: "vibecodr:vc-tools", nbf: Math.floor(Date.now() / 1000) + 300 }
    }
  ];
  for (const scenario of rejectedGrantScenarios) {
    const rejectedGrant = signEs256Grant({
      iss: "https://api.vibecodr.space",
      aud: "vibecodr:vc-tools",
      sub: `usr_${scenario.name.replace(/\W+/g, "_")}`,
      kind: "vibecodr_cli",
      scp: ["vc-tools:use"],
      plan: "Pro",
      exp: Math.floor(Date.now() / 1000) + 300,
      ...scenario.payload
    });
    const rejected = await fetchWorker("https://tools.vibecodr.space/v1/me", env, {
      headers: { authorization: `Bearer ${rejectedGrant}` }
    });
    assert.equal(rejected.response.status, 403, scenario.name);
    assert.equal(rejected.body.code, "auth.denied", scenario.name);
  }

  const deniedGrant = signEs256Grant({
    iss: "https://api.vibecodr.space",
    aud: "vibecodr:vc-tools",
    sub: "usr_other",
    kind: "vibecodr_cli",
    scp: ["vibes:publish"],
    plan: "Pro",
    exp: Math.floor(Date.now() / 1000) + 300
  });
  const denied = await fetchWorker("https://tools.vibecodr.space/v1/me", env, {
    headers: { authorization: `Bearer ${deniedGrant}` }
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.code, "auth.denied");

  const unknownKidGrant = signEs256Grant({
    iss: "https://api.vibecodr.space",
    aud: "vibecodr:vc-tools",
    sub: "usr_unknown_kid",
    kind: "vibecodr_cli",
    scp: ["vc-tools:use"],
    exp: Math.floor(Date.now() / 1000) + 300
  }, "unknown-kid");
  const unknownKid = await fetchWorker("https://tools.vibecodr.space/v1/me", env, {
    headers: { authorization: `Bearer ${unknownKidGrant}` }
  });
  assert.equal(unknownKid.response.status, 403);
  assert.equal(unknownKid.body.code, "auth.denied");

  const revokedGrant = signEs256Grant({
    iss: "https://api.vibecodr.space",
    aud: "vibecodr:vc-tools",
    sub: "usr_revoked",
    kind: "vibecodr_cli",
    scp: ["vc-tools:use"],
    jti: "revoked-jti",
    exp: Math.floor(Date.now() / 1000) + 300
  });
  const revoked = await fetchWorker("https://tools.vibecodr.space/v1/me", {
    ...env,
    VC_TOOLS_CLI_GRANT_REVOKED_JTIS: JSON.stringify(["revoked-jti"])
  }, {
    headers: { authorization: `Bearer ${revokedGrant}` }
  });
  assert.equal(revoked.response.status, 403);
  assert.equal(revoked.body.code, "auth.denied");
});

test("hosted worker requires scoped CLI grants to include requested tool capability", async () => {
  const secret = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
  const env = {
    ...baseEnv,
    VC_TOOLS_CLI_GRANT_SECRET: secret,
    VC_TOOLS_CLI_GRANT_LEGACY_HMAC_ENABLED: "true"
  };
  const basePayload = {
    iss: "https://api.vibecodr.space",
    aud: "vibecodr:vc-tools",
    kind: "vibecodr_cli",
    plan: "Pro",
    exp: Math.floor(Date.now() / 1000) + 300
  };
  const useOnlyGrant = signGrant(secret, {
    ...basePayload,
    sub: "usr_use_only",
    scp: ["vc-tools:use"]
  });

  const denied = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
    method: "POST",
    headers: {
      authorization: `Bearer ${useOnlyGrant}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "browser.render_url",
      input: { url: "https://example.com/" }
    })
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.code, "auth.capability_scope_denied");

  const scopedGrant = signGrant(secret, {
    ...basePayload,
    sub: "usr_tool_scoped",
    scp: ["vc-tools:use", "vc-tools:browser.render_url"]
  });
  const accepted = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
    method: "POST",
    headers: {
      authorization: `Bearer ${scopedGrant}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "browser.render_url",
      input: { url: "https://example.com/" }
    })
  });
  assert.equal(accepted.response.status, 202);
  assert.equal(accepted.body.capability, "browser.render_url");
});

test("hosted worker enforces scoped CLI grant capabilities on direct hosted routes", async () => {
  const usageOnlyGrant = signEs256Grant({
    iss: "https://api.vibecodr.space",
    aud: "vibecodr:vc-tools",
    sub: "usr_usage_only",
    kind: "vibecodr_cli",
    scp: ["vc-tools:use", "vc-tools:usage.read"],
    plan: "Creator",
    exp: Math.floor(Date.now() / 1000) + 300
  });
  const env = {
    ...fakeLiveEnv("route-scope-fallback-token"),
    VC_TOOLS_CLI_GRANT_PUBLIC_JWKS: TEST_CLI_PUBLIC_JWKS
  };
  const authHeaders = { authorization: `Bearer ${usageOnlyGrant}` };

  const usage = await fetchWorker("https://tools.vibecodr.space/v1/usage", env, {
    headers: authHeaders
  });
  assert.equal(usage.response.status, 200);
  assert.equal("actorId" in usage.body, false);
  assert.equal("operatorAlerts" in usage.body, false);
  assert.equal("hostedAccount" in usage.body, false);
  assert.equal("offeringClassifications" in usage.body, false);
  assert.equal("providerMode" in usage.body, false);
  assert.equal("authority" in usage.body, false);

  for (const scenario of [
    { method: "GET", url: "https://tools.vibecodr.space/v1/jobs" },
    { method: "POST", url: "https://tools.vibecodr.space/v1/jobs/job_scope/cancel" },
    { method: "GET", url: "https://tools.vibecodr.space/v1/artifacts" },
    { method: "GET", url: "https://tools.vibecodr.space/v1/artifacts/art_scope/download" },
    { method: "POST", url: "https://tools.vibecodr.space/v1/artifacts" },
    { method: "GET", url: "https://tools.vibecodr.space/v1/scheduled-qa" }
  ]) {
    const result = await fetchWorker(scenario.url, env, {
      method: scenario.method,
      headers: authHeaders
    });
    assert.equal(result.response.status, 403, `${scenario.method} ${scenario.url}`);
    assert.equal(result.body.code, "auth.capability_scope_denied", `${scenario.method} ${scenario.url}`);
  }

  const scheduledCreate = await fetchWorker("https://tools.vibecodr.space/v1/scheduled-qa", env, {
    method: "POST",
    headers: {
      ...authHeaders,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "browser.screenshot_url",
      input: { url: "https://example.com/" },
      intervalMinutes: 720
    })
  });
  assert.equal(scheduledCreate.response.status, 403);
  assert.equal(scheduledCreate.body.code, "auth.capability_scope_denied");
  assert.equal(env.JOB_QUEUE.sent.length, 0);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO jobs")), false);
});

test("hosted worker accepts tool tests in contract mode", async () => {
  const result = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", authedEnv("tool-token"), {
    method: "POST",
    headers: {
      authorization: "Bearer tool-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "browser.render_url",
      input: { url: "https://example.com/" }
    })
  });

  assert.equal(result.response.status, 202);
  assert.equal(result.body.status, "contract_only");
  assert.equal(result.body.capability, "browser.render_url");
  assert.equal(result.body.quotaChecked, true);
  assert.equal(result.body.auditLogged, true);
  assert.equal(result.body.providerMode, "contract");
  await result.drainWaitUntil();
});

test("hosted worker exposes paid agent browser task limits without widening quick actions", async () => {
  const freeDenied = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", {
    ...authedEnv("agent-free-token"),
    VC_TOOLS_PLAN_NAME: "Free"
  }, {
    method: "POST",
    headers: {
      authorization: "Bearer agent-free-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "browser.agent_task",
      input: { url: "https://example.com/", timeoutMs: 1_200_000 }
    })
  });
  assert.equal(freeDenied.response.status, 403);
  assert.equal(freeDenied.body.code, "quota.plan_denied");

  await withPublicDns(async () => {
    const creatorAccepted = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", fakeLiveEnv("agent-creator-token"), {
      method: "POST",
      headers: {
        authorization: bearerHeader("agent-creator-token"),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        capability: "browser.agent_task",
        input: {
          url: "https://example.com/",
          timeoutMs: 1_200_000,
          idleTimeoutMs: 600_000,
          actions: [{ action: "snapshot" }]
        }
      })
    });
    assert.equal(creatorAccepted.response.status, 202);
    assert.equal(creatorAccepted.body.capability, "browser.agent_task");

    const creatorDenied = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", fakeLiveEnv("agent-creator-too-long-token"), {
      method: "POST",
      headers: {
        authorization: bearerHeader("agent-creator-too-long-token"),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        capability: "browser.agent_task",
        input: {
          url: "https://example.com/",
          timeoutMs: 1_200_001,
          idleTimeoutMs: 600_000,
          actions: [{ action: "snapshot" }]
        }
      })
    });
    assert.equal(creatorDenied.response.status, 429);
    assert.equal(creatorDenied.body.code, "quota.browser_run_timeout_exceeded");
  });

  const proAccepted = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", {
    ...authedEnv("agent-pro-token"),
    VC_TOOLS_PLAN_NAME: "Pro"
  }, {
    method: "POST",
    headers: {
      authorization: "Bearer agent-pro-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "browser.agent_task",
      input: {
        url: "https://example.com/",
        timeoutMs: 3_600_000,
        idleTimeoutMs: 600_000,
        actions: [{ action: "snapshot" }]
      }
    })
  });
  assert.equal(proAccepted.response.status, 202);
  assert.equal(proAccepted.body.status, "contract_only");
  assert.equal(proAccepted.body.capability, "browser.agent_task");
});

test("hosted worker returns Streamable HTTP connection metadata for authenticated CLI clients", async () => {
  const result = await fetchWorker("https://tools.vibecodr.space/v1/mcp/connection", authedEnv("connect-token"), {
    headers: { authorization: "Bearer connect-token" }
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.transport, "streamable_http");
  assert.equal(result.body.url, "https://tools.vibecodr.space/mcp");
  assert.equal(result.body.protocolVersion, "2025-11-25");
  assert.equal("scopes" in result.body, false);
  assert.equal("providerMode" in result.body, false);
  assert.equal(result.body.tools.some((tool: { name: string; capability: string }) => tool.name === "computer.run" && tool.capability === "sandbox.run_command"), true);
});

test("hosted worker implements MCP initialize, tools/list, and tools/call contract flow", async () => {
  const env = authedEnv("mcp-token");

  const initialized = await fetchWorker("https://tools.vibecodr.space/mcp", env, mcpRequest("mcp-token", {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test-client", version: "0.0.0" }
    }
  }));
  assert.equal(initialized.response.status, 200);
  assert.equal(initialized.body.result.protocolVersion, "2025-11-25");
  assert.equal(initialized.body.result.capabilities.tools.listChanged, false);

  const listed = await fetchWorker("https://tools.vibecodr.space/mcp", env, mcpRequest("mcp-token", {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  }));
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.result.tools.some((tool: { name: string; capability: string; inputSchema: unknown }) => tool.name === "computer.run" && tool.capability === "sandbox.run_command" && tool.inputSchema), true);
  assert.equal(listed.body.result.tools.some((tool: { name: string; capability: string; inputSchema: unknown }) => tool.name === "usage.status" && tool.capability === "usage.read" && tool.inputSchema), true);

  const called = await fetchWorker("https://tools.vibecodr.space/mcp", env, mcpRequest("mcp-token", {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "browser.render",
      arguments: { url: "https://example.com/" }
    }
  }));
  assert.equal(called.response.status, 200);
  assert.equal(called.body.result.isError, false);
  const accepted = JSON.parse(called.body.result.content[0].text);
  assert.equal(accepted.status, "contract_only");
  assert.equal(accepted.quotaChecked, true);
  assert.equal(accepted.auditLogged, true);
  await called.drainWaitUntil();

  const usage = await fetchWorker("https://tools.vibecodr.space/mcp", env, mcpRequest("mcp-token", {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "usage.status",
      arguments: {}
    }
  }));
  assert.equal(usage.response.status, 200);
  assert.equal(usage.body.result.isError, false);
  const usageResult = JSON.parse(usage.body.result.content[0].text);
  assert.equal(usageResult.capability, "usage.read");
  assert.equal(usageResult.alias, "limits.read");
  assert.equal(usageResult.costBearing, false);
  assert.equal(usageResult.usage.vcToolCredits.included, 600);
  assert.equal("authority" in usageResult.usage, false);
  assert.equal("providerMode" in usageResult.usage, false);
  await usage.drainWaitUntil();
});

test("hosted worker exposes customer-safe plan metadata while keeping internal launch metadata actor-scoped", async () => {
  const plans = await fetchWorker("https://tools.vibecodr.space/v1/plans", baseEnv);
  assert.equal(plans.response.status, 200);
  assert.equal(plans.body.plans.some((plan: { name: string }) => plan.name === "Free"), true);
  const creator = plans.body.plans.find((plan: { name: string }) => plan.name === "Creator");
  assert.equal(creator?.priceUsdMonthly, 19);
  assert.equal(creator?.monthlyCredits, 600);
  assert.equal(creator?.browser.monthlyJobs, 600);
  assert.equal(creator?.computer.monthlyJobs, 600);
  assert.equal(creator?.browser.maxSecondsPerRun, 60);
  assert.equal(creator?.browser.agentBrowserTasks, "included");
  assert.equal(creator?.computer.maxTaskSeconds, 10 * 60);
  assert.equal(plans.body.plans.some((plan: { name: string }) => plan.name === "Starter"), false);
  const pro = plans.body.plans.find((plan: { name: string }) => plan.name === "Pro");
  assert.equal(Boolean(pro), true);
  assert.equal(pro?.browser.agentBrowserTasks, "included");
  assert.equal(pro?.computer.publicHttpEgress, "available");
  assert.equal(pro?.computer.maxTaskSeconds, 30 * 60);
  assert.equal(pro?.runningLimit, 5);
  assert.equal("overageMeters" in plans.body, false);
  assert.equal("offeringClassifications" in plans.body, false);
  assert.equal("policies" in plans.body, false);
  assert.equal("authority" in plans.body, false);

  const internalMetadataGrant = signEs256Grant({
    iss: "https://api.vibecodr.space",
    aud: "vibecodr:vc-tools",
    sub: "usr_internal_metadata",
    kind: "vibecodr_cli",
    scp: ["vc-tools:use"],
    plan: "Pro",
    exp: Math.floor(Date.now() / 1000) + 300
  });
  const internalMetadataEnv = {
    ...baseEnv,
    VC_TOOLS_CLI_GRANT_PUBLIC_JWKS: TEST_CLI_PUBLIC_JWKS,
    VC_TOOLS_INTERNAL_METADATA_ACTOR_IDS: "usr_internal_metadata"
  };
  const internalPlans = await fetchWorker("https://tools.vibecodr.space/v1/plans?operator=true", internalMetadataEnv, {
    headers: { authorization: `Bearer ${internalMetadataGrant}` }
  });
  assert.equal(internalPlans.response.status, 200);
  assert.equal(internalPlans.body.overageMeters.some((meter: { id: string }) => meter.id === "browser-minute"), true);
  assert.equal(
    internalPlans.body.offeringClassifications.some((item: { id: string; status: string }) => item.id === "overage_meters" && item.status === "internal-only"),
    true
  );
  assert.equal(
    internalPlans.body.offeringClassifications.some((item: { id: string; status: string }) => item.id === "stripe_metered_billing" && item.status === "future"),
    true
  );

  const grants = await fetchWorker("https://tools.vibecodr.space/v1/grants", authedEnv("grant-token"), {
    headers: { authorization: "Bearer grant-token" }
  });
  assert.equal(grants.response.status, 200);
  assert.equal(grants.body.grants.some((grant: { grant: string; allowedPlans: string[] }) => grant.grant === "browser.render" && grant.allowedPlans.includes("Creator")), true);
  assert.equal(grants.body.grants.some((grant: { grant: string; allowedPlans: string[] }) => grant.grant === "browser.agent_task" && grant.allowedPlans.includes("Creator") && grant.allowedPlans.includes("Pro")), true);
  assert.equal(grants.body.grants.some((grant: { grant: string; defaultScope: string }) => grant.grant === "sandbox.network" && grant.defaultScope === "workspace"), true);

  const legacyStarterAlias = await fetchWorker("https://tools.vibecodr.space/v1/me", {
    ...authedEnv("starter-token"),
    VC_TOOLS_PLAN_NAME: "starter"
  }, {
    headers: { authorization: "Bearer starter-token" }
  });
  assert.equal(legacyStarterAlias.response.status, 200);
  assert.equal(legacyStarterAlias.body.plan.name, "Creator");

  const dashboardEnv = authedEnv("dashboard-token");
  const unauthenticatedDashboard = await fetchWorker("https://tools.vibecodr.space/dashboard/billing/", dashboardEnv);
  assert.equal(unauthenticatedDashboard.response.status, 401);
  assert.equal(unauthenticatedDashboard.body.code, "auth.missing");

  const dashboard = await fetchWorkerText("https://tools.vibecodr.space/dashboard/billing/", dashboardEnv, {
    headers: { authorization: "Bearer dashboard-token" }
  });
  assert.equal(dashboard.response.status, 200);
  assert.match(dashboard.text, /Vibecodr Tools Cloud/);
  assert.doesNotMatch(dashboard.text, /browser-minute/);
  assert.doesNotMatch(dashboard.text, /stripe_metered_billing/);
  assert.doesNotMatch(dashboard.text, /href="\/dashboard\/cogs\/"/);

  const overviewDashboard = await fetchWorkerText("https://tools.vibecodr.space/dashboard/", dashboardEnv, {
    headers: { authorization: "Bearer dashboard-token" }
  });
  assert.equal(overviewDashboard.response.status, 200);
  assert.match(overviewDashboard.text, /Running work/);
  assert.match(overviewDashboard.text, /Recent work/);
  assert.match(overviewDashboard.text, /Saved proof/);
  assert.match(overviewDashboard.text, /Connected agents/);
  assert.doesNotMatch(overviewDashboard.text, /providerMode/);

  const internalDashboardGrant = signEs256Grant({
    iss: "https://api.vibecodr.space",
    aud: "vibecodr:vc-tools",
    sub: "usr_internal_dashboard",
    kind: "vibecodr_cli",
    scp: ["vc-tools:use"],
    plan: "Pro",
    exp: Math.floor(Date.now() / 1000) + 300
  });
  const internalDashboard = await fetchWorkerText("https://tools.vibecodr.space/dashboard/billing/", {
    ...baseEnv,
    VC_TOOLS_CLI_GRANT_PUBLIC_JWKS: TEST_CLI_PUBLIC_JWKS,
    VC_TOOLS_INTERNAL_METADATA_ACTOR_IDS: "usr_internal_dashboard"
  }, {
    headers: { authorization: `Bearer ${internalDashboardGrant}` }
  });
  assert.equal(internalDashboard.response.status, 200);
  assert.match(internalDashboard.text, /browser-minute/);
  assert.match(internalDashboard.text, /stripe_metered_billing/);

  const customerCogs = await fetchWorker("https://tools.vibecodr.space/dashboard/cogs/", dashboardEnv, {
    headers: { authorization: "Bearer dashboard-token" }
  });
  assert.equal(customerCogs.response.status, 403);
  assert.equal(customerCogs.body.code, "auth.operator_scope_denied");

  const operatorGrant = signEs256Grant({
    iss: "https://api.vibecodr.space",
    aud: "vibecodr:vc-tools",
    sub: "usr_operator",
    kind: "vibecodr_cli",
    scp: ["vc-tools:use", "vc-tools:operator"],
    plan: "Pro",
    exp: Math.floor(Date.now() / 1000) + 300
  });
  const operatorDashboard = await fetchWorkerText("https://tools.vibecodr.space/dashboard/cogs/", {
    ...baseEnv,
    VC_TOOLS_CLI_GRANT_PUBLIC_JWKS: TEST_CLI_PUBLIC_JWKS
  }, {
    headers: { authorization: `Bearer ${operatorGrant}` }
  });
  assert.equal(operatorDashboard.response.status, 200);
  assert.match(operatorDashboard.text, /Internal cost pressure/);
  assert.match(operatorDashboard.text, /internalOnly/);
});

test("hosted live mode caps artifact retention to the active plan", async () => {
  const env = fakeLiveEnv("retention-token");
  env.DB.firstRows.push({ scope: "actor:any", logs_days: 45, artifacts_days: 365, recordings: "off", updated_at: new Date().toISOString() });

  const shown = await fetchWorker("https://tools.vibecodr.space/v1/retention", env, {
    headers: { authorization: "Bearer retention-token" }
  });
  assert.equal(shown.response.status, 200);
  assert.equal(shown.body.logsDays, 45);
  assert.equal(shown.body.artifactsDays, 7);

  const rejected = await fetchWorker("https://tools.vibecodr.space/v1/retention", env, {
    method: "PATCH",
    headers: {
      authorization: "Bearer retention-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({ logsDays: 30, artifactsDays: 30, recordings: "off" })
  });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.body.code, "input.invalid_artifacts_days");

  const accepted = await fetchWorker("https://tools.vibecodr.space/v1/retention", env, {
    method: "PATCH",
    headers: {
      authorization: "Bearer retention-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({ logsDays: 30, artifactsDays: 7, recordings: "off" })
  });
  assert.equal(accepted.response.status, 200);
  assert.equal(accepted.body.artifactsDays, 7);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO retention_policies") && run.values.includes(7)), true);
});

test("hosted live mode enforces plan-owned artifact upload caps", async () => {
  const env = fakeLiveEnv("free-artifact-token");
  env.VC_TOOLS_PLAN_NAME = "Free";
  const form = new FormData();
  form.set("file", new Blob(["hello"], { type: "text/plain" }), "report.txt");
  form.set("kind", "log");

  const result = await fetchWorker("https://tools.vibecodr.space/v1/artifacts", env, {
    method: "POST",
    headers: { authorization: "Bearer free-artifact-token" },
    body: form
  });

  assert.equal(result.response.status, 403);
  assert.equal(result.body.code, "quota.artifact_upload_not_included");
  assert.equal(env.ARTIFACTS.puts.length, 0);

  const usage = await fetchWorker("https://tools.vibecodr.space/v1/usage?details=true", env, {
    headers: { authorization: "Bearer free-artifact-token" }
  });
  assert.equal(usage.response.status, 200);
  assert.equal(usage.body.maxArtifactUploadBytes, 0);
});

test("hosted live mode enforces total artifact storage before upload writes", async () => {
  const env = fakeLiveEnv("artifact-storage-token");
  env.DB.firstRows.push(
    { scope: "actor:static_22dca73dbb959e8f", logs_days: 30, artifacts_days: 7, recordings: "off", updated_at: new Date().toISOString() },
    { bytes: 1024 * 1024 * 1024 - 4 }
  );
  const form = new FormData();
  form.set("file", new Blob(["hello"], { type: "text/plain" }), "report.txt");
  form.set("kind", "log");

  const result = await fetchWorker("https://tools.vibecodr.space/v1/artifacts", env, {
    method: "POST",
    headers: { authorization: "Bearer artifact-storage-token" },
    body: form
  });

  assert.equal(result.response.status, 429);
  assert.equal(result.body.code, "quota.artifact_storage_exceeded");
  assert.equal(env.ARTIFACTS.puts.length, 0);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO artifacts")), false);
});

test("hosted live mode removes R2 bytes when artifact reservation loses the race", async () => {
  const env = fakeLiveEnv("artifact-race-token");
  env.DB.failArtifactInsert = true;
  const form = new FormData();
  form.set("file", new Blob(["hello"], { type: "text/plain" }), "report.txt");
  form.set("kind", "log");

  const result = await fetchWorker("https://tools.vibecodr.space/v1/artifacts", env, {
    method: "POST",
    headers: { authorization: "Bearer artifact-race-token" },
    body: form
  });

  assert.equal(result.response.status, 429);
  assert.equal(result.body.code, "quota.artifact_storage_exceeded");
  assert.equal(env.ARTIFACTS.puts.length, 1);
  assert.deepEqual(env.ARTIFACTS.deletes, [env.ARTIFACTS.puts[0]?.key]);
});

test("hosted live mode applies unsafe browser URL policy to all Quick Actions before binding checks", async () => {
  const capabilities: CapabilityName[] = [
    "browser.render_url",
    "browser.screenshot_url",
    "browser.extract_markdown",
    "browser.render_pdf"
  ];

  for (const capability of capabilities) {
    const env = fakeLiveEnv(`unsafe-${capability}`);
    const result = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
      method: "POST",
      headers: {
        authorization: `Bearer unsafe-${capability}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        capability,
        input: { url: "https://127.0.0.1/" }
      })
    });

    assert.equal(result.response.status, 400, capability);
    assert.equal(result.body.code, "input.blocked_url", capability);
    assert.equal(env.JOB_QUEUE.sent.length, 0, capability);
    assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO jobs")), false, capability);
    assert.equal(env.DB.runs.some((run) => run.values.includes("tools.denied_unsafe_url") && run.values.includes(`${capability}:input.blocked_url`)), true, capability);
  }
});

test("hosted worker rejects authenticated browser material before provider execution", async () => {
  const result = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", liveAuthedEnv("auth-browser-token"), {
    method: "POST",
    headers: {
      authorization: "Bearer auth-browser-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "browser.render_url",
      input: {
        url: "https://example.com/",
        headers: { cookie: "sid=secret" },
        storageState: { cookies: [] }
      }
    })
  });

  assert.equal(result.response.status, 403);
  assert.equal(result.body.code, "policy.authenticated_browser_denied");
});

test("hosted live mode fails closed when required Cloudflare bindings are missing", async () => {
  const result = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", liveAuthedEnv("live-token"), {
    method: "POST",
    headers: {
      authorization: "Bearer live-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "browser.render_url",
      input: { url: "https://example.com/" }
    })
  });

  assert.equal(result.response.status, 503);
  assert.equal(result.body.code, "live.bindings_missing");
  assert.equal(result.body.details.missing.includes("DB"), true);
});

test("hosted live mode lets operators pause all cost-bearing work before dispatch", async () => {
  const env = { ...fakeLiveEnv("pause-token"), VC_TOOLS_PAUSE_COST_BEARING_JOBS: "true" };
  const result = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
    method: "POST",
    headers: {
      authorization: "Bearer pause-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "sandbox.run_command",
      input: { command: "npm test" }
    })
  });

  assert.equal(result.response.status, 503);
  assert.equal(result.body.code, "ops.cost_bearing_paused");
  assert.deepEqual(result.body.details, { disabledReason: "all_cost_bearing" });
  assert.equal(env.JOB_QUEUE.sent.length, 0);
  assert.equal(env.DB.runs.some((run) => run.values.includes("tools.cost_bearing_paused")), true);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO jobs")), false);
});

test("hosted live mode lets operators disable Browser Run, Browser Sessions, and Sandbox lanes separately", async () => {
  const browserRunEnv = { ...fakeLiveEnv("browser-run-disabled-token"), VC_TOOLS_DISABLE_BROWSER_RUN: "true" };
  const browserRunResult = await withPublicDns(() => fetchWorker("https://tools.vibecodr.space/v1/tools/test", browserRunEnv, {
    method: "POST",
    headers: {
      authorization: bearerHeader("browser-run-disabled-token"),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "browser.screenshot_url",
      input: { url: "https://example.com/", format: "jpeg" }
    })
  }));
  assert.equal(browserRunResult.response.status, 503);
  assert.equal(browserRunResult.body.code, "ops.cost_bearing_paused");
  assert.deepEqual(browserRunResult.body.details, { disabledReason: "browser_run" });
  assert.equal(browserRunEnv.JOB_QUEUE.sent.length, 0);

  const browserSessionEnv = { ...fakeLiveEnv("browser-session-disabled-token"), VC_TOOLS_DISABLE_BROWSER_SESSIONS: "true" };
  const browserSessionResult = await withPublicDns(() => fetchWorker("https://tools.vibecodr.space/v1/tools/test", browserSessionEnv, {
    method: "POST",
    headers: {
      authorization: bearerHeader("browser-session-disabled-token"),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "browser.agent_task",
      input: { url: "https://example.com/", instructions: "Summarize the page" }
    })
  }));
  assert.equal(browserSessionResult.response.status, 503);
  assert.equal(browserSessionResult.body.code, "ops.cost_bearing_paused");
  assert.deepEqual(browserSessionResult.body.details, { disabledReason: "browser_sessions" });
  assert.equal(browserSessionEnv.JOB_QUEUE.sent.length, 0);

  const sandboxEnv = { ...fakeLiveEnv("sandbox-disabled-token"), VC_TOOLS_DISABLE_SANDBOX: "true" };
  const sandboxResult = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", sandboxEnv, {
    method: "POST",
    headers: {
      authorization: "Bearer sandbox-disabled-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "sandbox.run_command",
      input: { command: "npm test" }
    })
  });
  assert.equal(sandboxResult.response.status, 503);
  assert.equal(sandboxResult.body.code, "ops.cost_bearing_paused");
  assert.deepEqual(sandboxResult.body.details, { disabledReason: "sandbox" });
  assert.equal(sandboxEnv.JOB_QUEUE.sent.length, 0);
});

test("hosted live mode queues paid sandbox work with public network available by default", async () => {
  const env = fakeLiveEnv("sandbox-token");
  const result = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
    method: "POST",
    headers: {
      authorization: "Bearer sandbox-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "sandbox.run_command",
      input: { command: "npm view typescript version" }
    })
  });

  assert.equal(result.response.status, 202);
  assert.equal(env.JOB_QUEUE.sent.length, 1);
  const queuedInput = isRecord(env.JOB_QUEUE.sent[0]) && isRecord(env.JOB_QUEUE.sent[0].input) ? env.JOB_QUEUE.sent[0].input : {};
  assert.equal(queuedInput.network, true);
  assert.equal("allowedHosts" in queuedInput, false);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO jobs")), true);
});

test("hosted sandbox outbound handler permits public HTTP(S) and denies private/internal destinations", async () => {
  const originalFetch = globalThis.fetch;
  const fetchedTargets: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      const dnsBody = url.includes("internal.example.com")
        ? { Status: 0, Answer: [{ type: 1, data: "10.0.0.7" }] }
        : { Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] };
      return new Response(JSON.stringify(dnsBody), { headers: { "content-type": "application/json" } });
    }
    fetchedTargets.push(url);
    return new Response("ok", { status: 200 });
  };

  try {
    const publicResponse = await (Sandbox as unknown as { outbound: (request: Request, env: unknown, ctx: unknown) => Promise<Response> })
      .outbound(new Request("https://registry.npmjs.org/typescript"), {}, {});
    assert.equal(publicResponse.status, 200);
    assert.deepEqual(fetchedTargets, ["https://registry.npmjs.org/typescript"]);

    const localResponse = await (Sandbox as unknown as { outbound: (request: Request, env: unknown, ctx: unknown) => Promise<Response> })
      .outbound(new Request("http://127.0.0.1/"), {}, {});
    assert.equal(localResponse.status, 403);

    const privateDnsResponse = await (Sandbox as unknown as { outbound: (request: Request, env: unknown, ctx: unknown) => Promise<Response> })
      .outbound(new Request("https://internal.example.com/"), {}, {});
    assert.equal(privateDnsResponse.status, 403);
    assert.deepEqual(fetchedTargets, ["https://registry.npmjs.org/typescript"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted live mode writes audit and job state before dispatching browser work", async () => {
  const env = fakeLiveEnv("browser-token");
  env.DB.firstRows.push({ scope: "actor:static_012632faba814fab", logs_days: 12, artifacts_days: 5, recordings: "off", updated_at: new Date().toISOString() });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] }), {
        headers: { "content-type": "application/json" }
      });
    }
    if (init?.method === "HEAD") {
      return new Response(null, { status: 204 });
    }
    return originalFetch(input, init);
  };

  try {
    const result = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
      method: "POST",
      headers: {
        authorization: "Bearer browser-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        capability: "browser.screenshot_url",
        input: { url: "https://example.com/", format: "jpeg" }
      })
    });

    assert.equal(result.response.status, 202);
    assert.equal(result.body.status, "queued");
    assert.equal(result.body.providerMode, "live");
    assert.equal(env.JOB_QUEUE.sent.length, 1);
    assert.equal(env.JOB_QUEUE.sent[0]?.capability, "browser.screenshot_url");
    assert.equal(env.JOB_QUEUE.sent[0]?.actorId, "static_012632faba814fab");
    assert.equal(env.JOB_QUEUE.sent[0]?.planName, "Creator");
    assert.equal(env.JOB_QUEUE.sent[0]?.retentionDays, 5);
    assert.equal(env.JOB_QUEUE.sent[0]?.reservedCredits, 1);
    assert.equal(env.JOB_QUEUE.sent[0]?.reservedBrowserSeconds, 30);
    assert.equal(env.JOB_QUEUE.sent[0]?.reservedSandboxSeconds, 0);

    const auditIndex = env.DB.runs.findIndex((run) => run.sql.includes("INSERT INTO audit_events"));
    const jobIndex = env.DB.runs.findIndex((run) => run.sql.includes("INSERT INTO jobs"));
    assert.notEqual(auditIndex, -1);
    assert.notEqual(jobIndex, -1);
    assert.equal(auditIndex < jobIndex, true);
    assert.equal(env.DB.runs[jobIndex]?.sql.includes("actor_id"), true);
    assert.equal(env.DB.runs[jobIndex]?.sql.includes("reserved_credits"), true);
    assert.equal(env.DB.runs[jobIndex]?.sql.includes("reserved_browser_seconds"), true);
    assert.equal(env.DB.runs[jobIndex]?.sql.includes("reserved_sandbox_seconds"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted live mode creates, lists, and schedules browser Quick Action QA", async () => {
  const env = fakeLiveEnv("scheduled-qa-token");
  await withPublicDns(async () => {
    const created = await fetchWorker("https://tools.vibecodr.space/v1/scheduled-qa", env, {
      method: "POST",
      headers: {
        authorization: "Bearer scheduled-qa-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        url: "https://example.com/",
        capability: "browser.screenshot",
        intervalMinutes: 720,
        label: "homepage",
        runNow: true
      })
    });

    assert.equal(created.response.status, 201);
    assert.equal(created.body.config.capability, "browser.screenshot_url");
    assert.equal(created.body.config.intervalMinutes, 720);
    assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO scheduled_qa_configs")), true);
    assert.equal(env.JOB_QUEUE.sent.length, 1);
    assert.equal(isRecord(env.JOB_QUEUE.sent[0]) && env.JOB_QUEUE.sent[0].capability, "browser.screenshot_url");
    assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO scheduled_qa_runs")), true);

    env.DB.allRows.push([{
      id: "sqa_test",
      actor_id: "static_855b834e4750b718",
      plan_name: "Creator",
      label: "homepage",
      capability: "browser.screenshot_url",
      input_json: JSON.stringify({
        kind: "browser",
        url: "https://example.com/",
        timeoutMs: 30_000,
        output: "png"
      }),
      interval_minutes: 720,
      enabled: 1,
      next_run_at: "2026-05-14T00:00:00.000Z",
      last_run_at: null,
      last_job_id: null,
      last_error_code: null,
      last_error_message: null,
      created_at: "2026-05-14T00:00:00.000Z",
      updated_at: "2026-05-14T00:00:00.000Z"
    }]);
    const listed = await fetchWorker("https://tools.vibecodr.space/v1/scheduled-qa", env, {
      headers: { authorization: "Bearer scheduled-qa-token" }
    });
    assert.equal(listed.response.status, 200);
    assert.equal(Array.isArray(listed.body.configs), true);
    assert.equal(listed.body.configs[0]?.id, "sqa_test");

    env.DB.allRows.push([{
      id: "sqa_due",
      actor_id: "static_855b834e4750b718",
      plan_name: "Creator",
      label: "homepage",
      capability: "browser.screenshot_url",
      input_json: JSON.stringify({
        kind: "browser",
        url: "https://example.com/",
        timeoutMs: 30_000,
        output: "png"
      }),
      interval_minutes: 720,
      enabled: 1,
      next_run_at: "2026-05-14T00:00:00.000Z",
      last_run_at: null,
      last_job_id: null,
      last_error_code: null,
      last_error_message: null,
      created_at: "2026-05-14T00:00:00.000Z",
      updated_at: "2026-05-14T00:00:00.000Z"
    }]);
    const pending: Promise<unknown>[] = [];
    await worker.scheduled?.({
      cron: "17 */6 * * *",
      scheduledTime: Date.parse("2026-05-14T00:00:00.000Z"),
      type: "scheduled"
    } as ScheduledController, env as never, testExecutionContext(pending));
    await Promise.all(pending);

    assert.equal(env.JOB_QUEUE.sent.some((message) => isRecord(message) && message.capability === "browser.screenshot_url"), true);
    assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO scheduled_qa_runs") && run.values.includes("sqa_due")), true);
    assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE scheduled_qa_configs SET last_run_at")), true);
    assert.equal(env.DB.runs.some((run) => run.values.includes("scheduled_qa.enqueued")), true);
  });
});

test("hosted live mode denies Scheduled QA on plans without a scheduler allowance", async () => {
  const env = {
    ...fakeLiveEnv("scheduled-free-token"),
    VC_TOOLS_PLAN_NAME: "Free"
  };
  const denied = await fetchWorker("https://tools.vibecodr.space/v1/scheduled-qa", env, {
    method: "POST",
    headers: {
      authorization: "Bearer scheduled-free-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      url: "https://example.com/",
      capability: "browser.render",
      intervalMinutes: 720
    })
  });

  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.code, "quota.plan_denied");
  assert.equal(env.JOB_QUEUE.sent.length, 0);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO scheduled_qa_configs")), false);
});

test("hosted live mode reports queued-ahead metadata without delaying interactive tools", async () => {
  const env = fakeLiveEnv("fairness-token");
  env.DB.firstRows.push(
    { scope: "actor:static_bcb4c3a3b3bef8b7", logs_days: 12, artifacts_days: 5, recordings: "off", updated_at: new Date().toISOString() },
    { count_value: 1 },
    { count_value: 0 },
    { count_value: 0 },
    { quantity: 0 },
    { quantity: 0 },
    { bytes: 0 },
    { count_value: 7 },
    { count_value: 1 }
  );

  const result = await withPublicDns(() => fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
    method: "POST",
    headers: {
      authorization: "Bearer fairness-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "browser.render_url",
      input: { url: "https://example.com/" }
    })
  }));

  assert.equal(result.response.status, 202);
  assert.deepEqual(result.body.queue, {
    globalQueuedAhead: 7,
    actorQueuedAhead: 1,
    fairDelaySeconds: 0
  });
  assert.equal(env.JOB_QUEUE.sent.length, 1);
  assert.equal(env.JOB_QUEUE.options[0], undefined);
  assert.equal(env.JOB_QUEUE.sent[0]?.fairDelaySeconds, 0);
  const inserted = env.DB.runs.find((run) => run.sql.includes("INSERT INTO jobs"));
  assert.ok(inserted);
  assert.equal(inserted.sql.includes("queue_delay_seconds"), true);
  assert.equal(inserted.values.includes(7), true);
  assert.equal(inserted.values.includes(0), true);
});

test("hosted live mode starts browser agent tasks through Workflows instead of Queue execution", async () => {
  const env = fakeLiveEnv("agent-workflow-token");
  env.VC_TOOLS_PLAN_NAME = "Pro";
  const result = await withPublicDns(() => fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
    method: "POST",
    headers: {
      authorization: "Bearer agent-workflow-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "browser.agent_task",
      input: {
        url: "https://example.com/",
        timeoutMs: 3_600_000,
        idleTimeoutMs: 600_000,
        actions: [{ action: "snapshot" }]
      }
    })
  }));

  assert.equal(result.response.status, 202);
  assert.equal(result.body.status, "queued");
  assert.equal(env.JOB_QUEUE.sent.length, 0);
  assert.equal(env.BROWSER_AGENT_WORKFLOW.created.length, 1);
  assert.equal(env.BROWSER_AGENT_WORKFLOW.created[0]?.options.id, result.body.id);
  assert.equal(env.BROWSER_AGENT_WORKFLOW.created[0]?.options.params?.capability, "browser.agent_task");
  assert.equal(env.BROWSER_AGENT_WORKFLOW.created[0]?.options.params?.reservedBrowserSeconds, 3600);
  assert.equal(env.DB.runs.some((run) => run.values.includes("tools.workflow_started")), true);
});

test("hosted live mode does not require the Queue binding to start Browser Agent Workflow jobs", async () => {
  const env = fakeLiveEnv("agent-workflow-no-queue-token");
  delete (env as Record<string, unknown>).JOB_QUEUE;
  env.VC_TOOLS_PLAN_NAME = "Creator";
  const result = await withPublicDns(() => fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
    method: "POST",
    headers: {
      authorization: "Bearer agent-workflow-no-queue-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "browser.agent_task",
      input: {
        url: "https://example.com/",
        timeoutMs: 1_200_000,
        idleTimeoutMs: 600_000,
        actions: [{ action: "snapshot" }]
      }
    })
  }));

  assert.equal(result.response.status, 202);
  assert.equal(env.BROWSER_AGENT_WORKFLOW.created.length, 1);
  assert.equal(env.BROWSER_AGENT_WORKFLOW.created[0]?.options.params?.reservedBrowserSeconds, 1200);
});

test("hosted live mode reserves sandbox seconds before queueing sandbox work", async () => {
  const env = fakeLiveEnv("sandbox-reserve-token");
  env.DB.firstRows.push({ scope: "actor:static_fc9366f2b4d3a1a3", logs_days: 12, artifacts_days: 5, recordings: "off", updated_at: new Date().toISOString() });

  const result = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
    method: "POST",
    headers: {
      authorization: "Bearer sandbox-reserve-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "sandbox.run_command",
      input: { command: "npm test", timeoutMs: 45000 }
    })
  });

  assert.equal(result.response.status, 202);
  assert.equal(result.body.status, "queued");
  assert.equal(env.JOB_QUEUE.sent.length, 1);
  assert.equal(env.JOB_QUEUE.sent[0]?.capability, "sandbox.run_command");
  assert.equal(env.JOB_QUEUE.sent[0]?.reservedCredits, 1);
  assert.equal(env.JOB_QUEUE.sent[0]?.reservedBrowserSeconds, 0);
  assert.equal(env.JOB_QUEUE.sent[0]?.reservedSandboxSeconds, 45);
  const jobInsert = env.DB.runs.find((run) => run.sql.includes("INSERT INTO jobs"));
  assert.ok(jobInsert);
  assert.equal(jobInsert.sql.includes("reserved_sandbox_seconds"), true);
  assert.equal(jobInsert.sql.includes("SUM(reserved_sandbox_seconds)"), true);
  assert.equal(jobInsert.values.includes(45), true);
  assert.equal(jobInsert.values.includes(600 * 60), true);
});

test("hosted live mode enforces VC Tool quotas before dispatching cost-bearing work", async () => {
  const cases: Array<{
    name: string;
    capability: string;
    input: Record<string, unknown>;
    rows: unknown[];
    expectedCode: string;
    withDns?: boolean;
  }> = [
    {
      name: "concurrent run cap",
      capability: "sandbox.run_command",
      input: { command: "npm test" },
      rows: [null, { count_value: 2 }],
      expectedCode: "quota.concurrent_runs_exceeded"
    },
    {
      name: "monthly credit cap",
      capability: "sandbox.run_command",
      input: { command: "npm test" },
      rows: [null, { count_value: 0 }, { count_value: 600 }, { count_value: 0 }],
      expectedCode: "quota.exceeded"
    },
    {
      name: "daily credit cap",
      capability: "sandbox.run_command",
      input: { command: "npm test" },
      rows: [null, { count_value: 0 }, { count_value: 0 }, { count_value: 90 }],
      expectedCode: "quota.daily_exceeded"
    },
    {
      name: "sandbox task timeout cap",
      capability: "sandbox.run_command",
      input: { command: "npm test", timeoutMs: 600_001 },
      rows: [null],
      expectedCode: "quota.sandbox_timeout_exceeded"
    },
    {
      name: "sandbox concurrent cap",
      capability: "sandbox.run_command",
      input: { command: "npm test" },
      rows: [null, { count_value: 0 }, { count_value: 0 }, { count_value: 0 }, { count_value: 2 }],
      expectedCode: "quota.sandbox_concurrent_jobs_exceeded"
    },
    {
      name: "monthly sandbox seconds cap",
      capability: "sandbox.run_command",
      input: { command: "npm test" },
      rows: [null, { count_value: 0 }, { count_value: 0 }, { count_value: 0 }, { count_value: 0 }, { quantity: 600 }],
      expectedCode: "quota.sandbox_monthly_seconds_exceeded"
    },
    {
      name: "monthly browser seconds cap",
      capability: "browser.render_url",
      input: { url: "https://example.com/" },
      rows: [null, { count_value: 0 }, { count_value: 0 }, { count_value: 0 }, { quantity: 600 }, { quantity: 0 }],
      expectedCode: "quota.browser_monthly_seconds_exceeded",
      withDns: true
    },
    {
      name: "artifact storage cap before cost",
      capability: "browser.render_url",
      input: { url: "https://example.com/" },
      rows: [null, { count_value: 0 }, { count_value: 0 }, { count_value: 0 }, { quantity: 0 }, { quantity: 0 }, { bytes: 1024 * 1024 * 1024 }],
      expectedCode: "quota.artifact_storage_exceeded",
      withDns: true
    }
  ];

  for (const scenario of cases) {
    const env = fakeLiveEnv(`quota-${scenario.name}`);
    env.DB.firstRows.push(...scenario.rows);
    const run = async () => fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
      method: "POST",
      headers: {
        authorization: `Bearer quota-${scenario.name}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        capability: scenario.capability,
        input: scenario.input
      })
    });
    const result = scenario.withDns ? await withPublicDns(run) : await run();

    assert.equal(result.response.status, 429, scenario.name);
    assert.equal(result.body.code, scenario.expectedCode, scenario.name);
    assert.equal(env.JOB_QUEUE.sent.length, 0, scenario.name);
    assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO jobs")), false, scenario.name);
    assert.equal(env.DB.runs.some((run) => run.values.includes("tools.denied_quota") && run.values.includes(`${scenario.capability}:${scenario.expectedCode}`)), true, scenario.name);
  }
});

test("hosted live mode enforces plan-specific browser concurrent run caps before dispatch", async () => {
  const cases = [
    { plan: "Free", activeRuns: 1, attempts: 20 },
    { plan: "Creator", activeRuns: 2, attempts: 3 },
    { plan: "Pro", activeRuns: 5, attempts: 6 }
  ];

  for (const scenario of cases) {
    const grant = signEs256Grant({
      iss: "https://api.vibecodr.space",
      aud: "vibecodr:vc-tools",
      sub: `usr_${scenario.plan.toLowerCase()}_browser_cap`,
      kind: "vibecodr_cli",
      scp: ["vc-tools:use", "vc-tools:browser.render_url"],
      plan: scenario.plan,
      exp: Math.floor(Date.now() / 1000) + 300
    });
    const env = {
      ...fakeLiveEnv(`browser-concurrent-${scenario.plan.toLowerCase()}-token`),
      VC_TOOLS_CLI_GRANT_PUBLIC_JWKS: TEST_CLI_PUBLIC_JWKS
    };
    for (let index = 0; index < scenario.attempts; index += 1) {
      env.DB.firstRows.push(null, { count_value: scenario.activeRuns });
    }

    const results = await withPublicDns(() => Promise.all(Array.from({ length: scenario.attempts }, () => (
      fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
        method: "POST",
        headers: {
          authorization: `Bearer ${grant}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          capability: "browser.render_url",
          input: { url: "https://example.com/" }
        })
      })
    ))));

    assert.equal(results.length, scenario.attempts, scenario.plan);
    assert.equal(results.every((result) => result.response.status === 429), true, scenario.plan);
    assert.equal(results.every((result) => result.body.code === "quota.concurrent_runs_exceeded"), true, scenario.plan);
    assert.equal(env.JOB_QUEUE.sent.length, 0, scenario.plan);
    assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO jobs")), false, scenario.plan);
  }
});

test("hosted live mode does not queue when atomic quota reservation loses the race", async () => {
  const env = fakeLiveEnv("race-token");
  env.DB.failJobInsert = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] }), {
        headers: { "content-type": "application/json" }
      });
    }
    if (init?.method === "HEAD") {
      return new Response(null, { status: 204 });
    }
    return originalFetch(input, init);
  };

  try {
    const result = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
      method: "POST",
      headers: {
        authorization: "Bearer race-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        capability: "browser.render_url",
        input: { url: "https://example.com/" }
      })
    });

    assert.equal(result.response.status, 429);
    assert.equal(result.body.code, "quota.reservation_conflict");
    assert.equal(env.JOB_QUEUE.sent.length, 0);
    assert.equal(env.DB.runs.some((run) => run.values.includes("tools.denied_quota") && run.values.includes("browser.render_url:quota.reservation_conflict")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted live mode allows only one queue send when parallel requests race the atomic reservation", async () => {
  const env = fakeLiveEnv("parallel-race-token");
  env.DB.jobInsertChanges.push(1, 0);

  const run = () => fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
    method: "POST",
    headers: {
      authorization: "Bearer parallel-race-token",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      capability: "browser.render_url",
      input: { url: "https://example.com/" }
    })
  });

  const results = await withPublicDns(() => Promise.all([run(), run()]));
  const statuses = results.map((result) => result.response.status).sort();
  const codes = results.map((result) => result.body.code ?? "queued").sort();

  assert.deepEqual(statuses, [202, 429]);
  assert.deepEqual(codes, ["queued", "quota.reservation_conflict"]);
  assert.equal(env.DB.runs.filter((runRecord) => runRecord.sql.includes("INSERT INTO jobs")).length, 2);
  assert.equal(env.JOB_QUEUE.sent.length, 1);
  assert.equal(
    env.DB.runs.some((runRecord) => runRecord.values.includes("tools.denied_quota") && runRecord.values.includes("browser.render_url:quota.reservation_conflict")),
    true
  );
});

test("hosted live mode rejects DNS responses without address records", async () => {
  const env = fakeLiveEnv("cname-token");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 5, data: "alias.example.com" }] }), {
        headers: { "content-type": "application/json" }
      });
    }
    return originalFetch(input, init);
  };

  try {
    const result = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
      method: "POST",
      headers: {
        authorization: "Bearer cname-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        capability: "browser.render_url",
        input: { url: "https://example.com/" }
      })
    });

    assert.equal(result.response.status, 400);
    assert.equal(result.body.code, "input.unresolvable_url");
    assert.equal(env.JOB_QUEUE.sent.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted live mode rejects unsafe redirects before dispatching browser work", async () => {
  const env = fakeLiveEnv("redirect-token");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] }), {
        headers: { "content-type": "application/json" }
      });
    }
    if (url === "https://safe.example/" && init?.method === "HEAD") {
      return new Response(null, {
        status: 302,
        headers: { location: "https://127.0.0.1/" }
      });
    }
    return originalFetch(input, init);
  };

  try {
    const result = await fetchWorker("https://tools.vibecodr.space/v1/tools/test", env, {
      method: "POST",
      headers: {
        authorization: "Bearer redirect-token",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        capability: "browser.render_url",
        input: { url: "https://safe.example/" }
      })
    });

    assert.equal(result.response.status, 400);
    assert.equal(result.body.code, "input.blocked_url");
    assert.equal(env.JOB_QUEUE.sent.length, 0);
    assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO jobs")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted live mode denies expired artifact downloads before reading R2 bytes", async () => {
  const env = fakeLiveEnv("expired-token");
  env.DB.firstRows.push({
    id: "art_expired",
    actor_id: "static_4fa4b89ee02c6a7a",
    job_id: "job_expired",
    kind: "markdown",
    key: "artifacts/art_expired/markdown",
    content_type: "text/markdown",
    bytes: 12,
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2026-01-02T00:00:00.000Z"
  });

  const result = await fetchWorker("https://tools.vibecodr.space/v1/artifacts/art_expired/download", env, {
    headers: { authorization: "Bearer expired-token" }
  });

  assert.equal(result.response.status, 410);
  assert.equal(result.body.status, "expired");
  assert.equal(env.ARTIFACTS.gets.length, 0);
});

test("hosted live mode hides expired artifact metadata from active reads", async () => {
  const env = fakeLiveEnv("expired-metadata-token");
  const actorId = "static_3e5671b4114a4584";
  env.DB.artifactRows.push({
    id: "art_expired_meta",
    actor_id: actorId,
    job_id: "job_expired_meta",
    kind: "markdown",
    key: "artifacts/art_expired_meta/markdown",
    content_type: "text/markdown",
    bytes: 12,
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2026-01-02T00:00:00.000Z"
  });

  const metadata = await fetchWorker("https://tools.vibecodr.space/v1/artifacts/art_expired_meta", env, {
    headers: { authorization: "Bearer expired-metadata-token" }
  });

  assert.equal(metadata.response.status, 200);
  assert.equal(metadata.body.status, "not_found");
  assert.equal(
    env.DB.reads.some((read) => read.sql.includes("expires_at > ?") && read.values[0] === "art_expired_meta" && read.values[1] === actorId),
    true
  );
});

test("hosted scheduled cleanup removes expired artifact bytes and metadata only", async () => {
  const env = fakeLiveEnv("artifact-cleanup-token");
  env.DB.artifactRows.push(
    {
      id: "art_cleanup_expired",
      actor_id: "static_cleanup",
      job_id: "job_cleanup_expired",
      kind: "log",
      key: "artifacts/art_cleanup_expired/log",
      content_type: "text/plain",
      bytes: 12,
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-01-02T00:00:00.000Z"
    },
    {
      id: "art_cleanup_active",
      actor_id: "static_cleanup",
      job_id: "job_cleanup_active",
      kind: "log",
      key: "artifacts/art_cleanup_active/log",
      content_type: "text/plain",
      bytes: 12,
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-12-31T00:00:00.000Z"
    }
  );
  const pending: Promise<unknown>[] = [];

  await worker.scheduled?.({
    cron: "17 */6 * * *",
    scheduledTime: Date.parse("2026-05-15T00:00:00.000Z"),
    type: "scheduled"
  } as ScheduledController, env as never, testExecutionContext(pending));
  await Promise.all(pending);

  assert.deepEqual(env.ARTIFACTS.deletes, ["artifacts/art_cleanup_expired/log"]);
  assert.equal(
    env.DB.runs.some((run) => run.sql.includes("DELETE FROM artifacts WHERE id = ?") && run.values[0] === "art_cleanup_expired"),
    true
  );
  assert.equal(
    env.DB.runs.some((run) => run.sql.includes("DELETE FROM artifacts WHERE id = ?") && run.values[0] === "art_cleanup_active"),
    false
  );
});

test("hosted scheduled cleanup alerts when expired artifact cleanup fails without user fanout", async () => {
  const env = fakeLiveEnv("artifact-cleanup-alert-token");
  env.VC_TOOLS_INTERNAL_ALERT_TOKEN = Buffer.from(new Uint8Array(32).fill(12)).toString("base64url");
  env.DB.artifactRows.push({
    id: "art_cleanup_failure",
    actor_id: "static_cleanup_failure",
    job_id: "job_cleanup_failure",
    kind: "log",
    key: "artifacts/art_cleanup_failure/log",
    content_type: "text/plain",
    bytes: 12,
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2026-01-02T00:00:00.000Z"
  });
  env.ARTIFACTS.deleteFailures.add("artifacts/art_cleanup_failure/log");
  const internalRequests: Request[] = [];
  env.VC_TOOLS_INTERNAL_API_WORKER = {
    async fetch(request: Request) {
      internalRequests.push(request);
      return new Response(JSON.stringify({ received: true, sent: true }), {
        headers: { "content-type": "application/json" }
      });
    }
  } as Fetcher;

  const pending: Promise<unknown>[] = [];
  await worker.scheduled?.({
    cron: "17 */6 * * *",
    scheduledTime: Date.parse("2026-05-15T00:00:00.000Z"),
    type: "scheduled"
  } as ScheduledController, env as never, testExecutionContext(pending));
  await drainPendingWaitUntil(pending);

  assert.equal(internalRequests.length, 1);
  const firstRequest = internalRequests[0];
  assert.ok(firstRequest);
  const payload = await firstRequest.clone().json() as Record<string, unknown>;
  assert.equal(payload.code, "E-VIBECODR-VC-TOOLS-RETENTION-CLEANUP-FAILED");
  assert.equal((payload.details as { scope?: string }).scope, "account");
  assert.equal((payload.details as { surface?: string }).surface, "retention.cleanup_failed");
  assert.equal((payload.details as { unit?: string }).unit, "failures");
  assert.equal((payload.details as { failedStage?: string }).failedStage, "artifact.delete");
  assert.equal(JSON.stringify(payload).includes("usr_"), false);
  assert.equal(env.DB.runs.some((run) => run.values.includes("tools.retention_cleanup_failed_alert")), true);
  assert.equal(
    env.DB.runs.some((run) => run.sql.includes("DELETE FROM artifacts WHERE id = ?") && run.values[0] === "art_cleanup_failure"),
    false
  );
  assert.equal(env.DB.operatorAlertClaims.size, 1);
});

test("hosted live mode scopes artifact list, metadata, and downloads to the authenticated actor", async () => {
  const env = fakeLiveEnv("artifact-owner-token");
  const ownerActor = "static_10203a17ee683e0d";
  const otherActor = "static_15f83ca655c7a5f2";
  env.DB.artifactRows.push(
    {
      id: "art_owner",
      actor_id: ownerActor,
      job_id: "job_owner",
      kind: "markdown",
      key: "artifacts/art_owner/markdown",
      content_type: "text/markdown",
      bytes: 12,
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-12-31T00:00:00.000Z"
    },
    {
      id: "art_other",
      actor_id: otherActor,
      job_id: "job_other",
      kind: "log",
      key: "artifacts/art_other/log",
      content_type: "text/plain",
      bytes: 24,
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-12-31T00:00:00.000Z"
    }
  );

  const list = await fetchWorker("https://tools.vibecodr.space/v1/artifacts", env, {
    headers: { authorization: "Bearer artifact-owner-token" }
  });
  assert.equal(list.response.status, 200);
  assert.deepEqual(list.body.artifacts.map((artifact: { id: string }) => artifact.id), ["art_owner"]);
  assert.equal(JSON.stringify(list.body).includes("artifacts/art_owner/markdown"), false);
  assert.equal(JSON.stringify(list.body).includes("artifacts/art_other/log"), false);

  const ownMetadata = await fetchWorker("https://tools.vibecodr.space/v1/artifacts/art_owner", env, {
    headers: { authorization: "Bearer artifact-owner-token" }
  });
  assert.equal(ownMetadata.response.status, 200);
  assert.equal(ownMetadata.body.id, "art_owner");
  assert.equal(ownMetadata.body.actorId, ownerActor);
  assert.equal(Object.prototype.hasOwnProperty.call(ownMetadata.body, "key"), false);
  assert.match(String(ownMetadata.body.downloadUrl), /^https:\/\/tools\.vibecodr\.space\/v1\/artifacts\/art_owner\/download$/);

  const otherMetadata = await fetchWorker("https://tools.vibecodr.space/v1/artifacts/art_other", env, {
    headers: { authorization: "Bearer artifact-owner-token" }
  });
  assert.equal(otherMetadata.response.status, 200);
  assert.equal(otherMetadata.body.status, "not_found");

  const otherDownload = await fetchWorker("https://tools.vibecodr.space/v1/artifacts/art_other/download", env, {
    headers: { authorization: "Bearer artifact-owner-token" }
  });
  assert.equal(otherDownload.response.status, 404);
  assert.equal(otherDownload.body.status, "not_found");
  assert.equal(env.ARTIFACTS.gets.length, 0);
  assert.equal(
    env.DB.reads.some((read) => read.sql.includes("FROM artifacts WHERE actor_id = ?") && read.values[0] === ownerActor),
    true
  );
  assert.equal(
    env.DB.reads.some((read) => read.sql.includes("FROM artifacts WHERE id = ? AND actor_id = ?") && read.values[0] === "art_other" && read.values[1] === ownerActor),
    true
  );
});

test("hosted live mode honors bounded list limits for jobs and artifacts", async () => {
  const token = "list-limit-token";
  const env = fakeLiveEnv(token);
  const actorId = `static_${sha256(token).slice(0, 16)}`;
  env.DB.artifactRows.push(
    {
      id: "art_first",
      actor_id: actorId,
      job_id: "job_first",
      kind: "log",
      key: "artifacts/art_first/log",
      content_type: "application/json",
      bytes: 10,
      created_at: "2026-01-02T00:00:00.000Z",
      expires_at: "2026-12-31T00:00:00.000Z"
    },
    {
      id: "art_second",
      actor_id: actorId,
      job_id: "job_second",
      kind: "log",
      key: "artifacts/art_second/log",
      content_type: "application/json",
      bytes: 20,
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-12-31T00:00:00.000Z"
    }
  );

  const artifacts = await fetchWorker("https://tools.vibecodr.space/v1/artifacts?limit=1", env, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(artifacts.response.status, 200);
  assert.deepEqual(artifacts.body.artifacts.map((artifact: { id: string }) => artifact.id), ["art_first"]);
  assert.equal(
    env.DB.reads.some((read) => read.sql.includes("FROM artifacts WHERE actor_id = ?") && read.sql.includes("LIMIT ?") && read.values[0] === actorId && read.values[2] === 1),
    true
  );

  const jobs = await fetchWorker("https://tools.vibecodr.space/v1/jobs?limit=3", env, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(jobs.response.status, 200);
  assert.equal(
    env.DB.reads.some((read) => read.sql.includes("FROM jobs WHERE actor_id = ?") && read.sql.includes("LIMIT ?") && read.values[0] === actorId && read.values[1] === 3),
    true
  );

  const invalid = await fetchWorker("https://tools.vibecodr.space/v1/artifacts?limit=101", env, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.body.code, "input.invalid_number");
});

test("hosted live mode deletes artifact bytes and actor-scoped metadata", async () => {
  const env = fakeLiveEnv("delete-artifact-token");
  env.DB.firstRows.push({
    id: "art_delete",
    actor_id: "static_delete",
    job_id: "job_delete",
    kind: "log",
    key: "artifacts/art_delete/log",
    content_type: "text/plain",
    bytes: 24,
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2026-01-08T00:00:00.000Z"
  });

  const result = await fetchWorker("https://tools.vibecodr.space/v1/artifacts/art_delete", env, {
    method: "DELETE",
    headers: { authorization: "Bearer delete-artifact-token" }
  });

  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, "deleted");
  assert.deepEqual(env.ARTIFACTS.deletes, ["artifacts/art_delete/log"]);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("DELETE FROM artifacts WHERE id = ? AND actor_id = ?") && run.values[0] === "art_delete"), true);
});

test("hosted queue handler stores control artifacts and completes jobs", async () => {
  const env = fakeLiveEnv("queue-token");
  const message = {
    id: "job_control",
    capability: "artifact.get",
    input: { kind: "artifact", artifactId: "art_existing" },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_queue",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 0,
    reservedBrowserSeconds: 0
  };

  await worker.queue?.({
    messages: [{ body: message }],
    queue: "vc-tools-jobs",
    retryAll() {},
    ackAll() {}
  } as MessageBatch, env as never, testExecutionContext());

  assert.equal(env.ARTIFACTS.puts.length, 1);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'running'")), true);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'completed'")), true);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO artifacts")), true);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO artifacts") && run.values.includes("usr_queue")), true);
  const expectedExpiryDay = addDaysForTest(3).slice(0, 10);
  assert.equal(
    env.DB.runs.some((run) =>
      run.sql.includes("INSERT INTO artifacts") &&
      run.values.some((value) => typeof value === "string" && value.includes(expectedExpiryDay))
    ),
    true
  );
});

test("hosted queue handler uses Browser Run Quick Actions and metered browser time", async () => {
  const env = fakeLiveEnv("quick-action-token");
  const quickActionToken = browserRunApiToken();
  env.VC_TOOLS_BROWSER_RUN_ACCOUNT_ID = "acct_123";
  env.VC_TOOLS_BROWSER_RUN_API_TOKEN = quickActionToken;
  const quickActionCalls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://api.cloudflare.com/client/v4/accounts/acct_123/browser-rendering/screenshot")) {
      quickActionCalls.push({
        url,
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      });
      return new Response(new Uint8Array([9, 8, 7]), {
        headers: {
          "content-type": "image/png",
          "x-browser-ms-used": "120000"
        }
      });
    }
    return originalFetch(input, init);
  };
  const message = {
    id: "job_quick_action",
    capability: "browser.screenshot_url",
    input: { kind: "browser", url: "https://example.com/", timeoutMs: 180000, output: "png" },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_quick_action",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 1,
    reservedBrowserSeconds: 180
  };

  try {
    await worker.queue?.({
      messages: [{ body: message }],
      queue: "vc-tools-jobs",
      retryAll() {},
      ackAll() {}
    } as MessageBatch, env as never, testExecutionContext());
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(quickActionCalls.length, 1);
  assert.equal(quickActionCalls[0]?.headers.get("authorization"), bearerHeader(quickActionToken));
  assert.equal(quickActionCalls[0]?.body.url, "https://example.com/");
  assert.equal((quickActionCalls[0]?.body.gotoOptions as Record<string, unknown> | undefined)?.timeout, 60000);
  assert.equal("actionTimeout" in (quickActionCalls[0]?.body ?? {}), false);
  assert.equal(env.ARTIFACTS.puts.length, 1);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'completed'")), true);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO usage_events") && run.values.includes("browser-minute") && run.values.includes(2)), true);
});

test("hosted queue handler bounds large-page Browser Run Quick Action timeouts", async () => {
  const env = fakeLiveEnv("quick-action-timeout-shape-token");
  const quickActionToken = browserRunApiToken();
  env.VC_TOOLS_BROWSER_RUN_ACCOUNT_ID = "acct_123";
  env.VC_TOOLS_BROWSER_RUN_API_TOKEN = quickActionToken;
  const quickActionCalls: Array<{ endpoint: string; headers: Headers; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://api.cloudflare.com/client/v4/accounts/acct_123/browser-rendering/")) {
      const endpoint = new URL(url).pathname.split("/").pop() ?? "";
      quickActionCalls.push({
        endpoint,
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      });
      if (endpoint === "pdf") {
        return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "application/pdf" } });
      }
      return new Response(JSON.stringify({ success: true, result: `<main>${endpoint}</main>` }), {
        headers: { "content-type": "application/json" }
      });
    }
    return originalFetch(input, init);
  };

  const cases = [
    { id: "job_quick_action_render_timeout_shape", capability: "browser.render_url", output: "html", endpoint: "content" },
    { id: "job_quick_action_markdown_timeout_shape", capability: "browser.extract_markdown", output: "markdown", endpoint: "markdown" },
    { id: "job_quick_action_pdf_timeout_shape", capability: "browser.render_pdf", output: "pdf", endpoint: "pdf" }
  ];

  try {
    for (const item of cases) {
      await worker.queue?.({
        messages: [{
          body: {
            id: item.id,
            capability: item.capability,
            input: { kind: "browser", url: "https://example.com/large", timeoutMs: 180000, output: item.output },
            enqueuedAt: new Date().toISOString(),
            actorId: "usr_quick_action_timeout_shape",
            planName: "Creator",
            retentionDays: 3,
            reservedCredits: 1,
            reservedBrowserSeconds: 180
          }
        }],
        queue: "vc-tools-jobs",
        retryAll() {},
        ackAll() {}
      } as MessageBatch, env as never, testExecutionContext());
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(quickActionCalls.length, cases.length);
  for (const item of cases) {
    const call = quickActionCalls.find((candidate) => candidate.endpoint === item.endpoint);
    assert.ok(call, item.endpoint);
    assert.equal(call.headers.get("authorization"), bearerHeader(quickActionToken));
    assert.equal(call.body.url, "https://example.com/large");
    assert.equal((call.body.gotoOptions as Record<string, unknown> | undefined)?.waitUntil, "networkidle2");
    assert.equal((call.body.gotoOptions as Record<string, unknown> | undefined)?.timeout, 60000);
    if (item.endpoint === "pdf") {
      assert.equal(((call.body.pdfOptions as Record<string, unknown> | undefined)?.timeout), 180000);
    } else {
      assert.equal("actionTimeout" in call.body, false);
    }
  }
  assert.equal(env.ARTIFACTS.puts.length, cases.length);
  assert.equal(env.DB.runs.filter((run) => run.sql.includes("UPDATE jobs SET status = 'completed'")).length, cases.length);
});

test("hosted queue handler closes Browser Sessions when large-page navigation times out", async () => {
  const env = { ...fakeLiveEnv("browser-session-timeout-token"), VC_TOOLS_PROVIDER_MODE: "contract" as const };
  const state = await withMockTimedOutBrowserSession(async (browserState) => {
    await assert.rejects(
      worker.queue?.({
        messages: [{
          body: {
            id: "job_browser_session_large_page_timeout",
            capability: "browser.render_url",
            input: { kind: "browser", url: "https://example.com/large", timeoutMs: 1000, output: "html" },
            enqueuedAt: new Date().toISOString(),
            actorId: "usr_browser_session_large_page_timeout",
            planName: "Creator",
            retentionDays: 3,
            reservedCredits: 1,
            reservedBrowserSeconds: 1
          }
        }],
        queue: "vc-tools-jobs",
        retryAll() {},
        ackAll() {}
      } as MessageBatch, env as never, testExecutionContext()),
      /Navigation timeout of 1000 ms exceeded/
    );
    return browserState;
  });

  assert.deepEqual(state.defaultNavigationTimeouts, [1000]);
  assert.deepEqual(state.launchOptions, [{ keep_alive: 10_000 }]);
  assert.deepEqual(state.gotoCalls, [{
    url: "https://example.com/large",
    timeout: 1000,
    waitUntil: "networkidle2"
  }]);
  assert.equal(state.closed, 1);
  assert.equal(env.ARTIFACTS.puts.length, 0);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'failed'")), true);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'completed'")), false);
  assert.equal(env.DB.runs.some((run) => run.values.includes("browser-minute")), false);
});

test("hosted Browser Agent Workflow uses paid Browser Sessions and records closure metadata", async () => {
  const env = fakeLiveEnv("agent-session-token");
  const state = await withMockBrowserSession(async (browserState) => {
    await withPublicDns(async () => {
      await runBrowserAgentWorkflow(env, {
        id: "job_agent_session",
        capability: "browser.agent_task",
        input: {
          kind: "browser",
          url: "https://example.com/",
          timeoutMs: 3_600_000,
          idleTimeoutMs: 600_000,
          output: "html",
          actions: [{ action: "snapshot" }]
        },
        enqueuedAt: new Date().toISOString(),
        actorId: "usr_agent_session",
        planName: "Pro",
        retentionDays: 30,
        reservedCredits: 1,
        reservedBrowserSeconds: 3600,
        reservedSandboxSeconds: 0
      });
    });
    return browserState;
  });

  assert.equal(state.closed, 1);
  assert.deepEqual(state.launchOptions, [{ keep_alive: 600_000 }]);
  assert.deepEqual(state.navigations, ["https://example.com/"]);
  assert.equal(env.ARTIFACTS.puts.length, 1);
  const payload = JSON.parse(new TextDecoder().decode(env.ARTIFACTS.puts[0]?.value as Uint8Array));
  assert.equal(payload.closureReason, "completed");
  assert.equal(payload.idleTimeoutMs, 600_000);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'completed'") && String(run.values[0]).includes('"closureReason":"completed"')), true);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO audit_events") && run.values.includes("tools.browser_agent.completed")), true);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO usage_events") && run.values.includes("browser-minute")), true);
});

test("hosted queue handler rejects Browser Agent execution because Workflows own that lane", async () => {
  const env = fakeLiveEnv("agent-queue-rejected-token");
  await assert.rejects(
    worker.queue?.({
      messages: [{
        body: {
          id: "job_agent_queue_rejected",
          capability: "browser.agent_task",
          input: {
            kind: "browser",
            url: "https://example.com/",
            timeoutMs: 30_000,
            output: "html",
            actions: [{ action: "snapshot" }]
          },
          enqueuedAt: new Date().toISOString(),
          actorId: "usr_agent_queue_rejected",
          planName: "Creator",
          retentionDays: 3,
          reservedCredits: 1,
          reservedBrowserSeconds: 30,
          reservedSandboxSeconds: 0
        }
      }],
      queue: "vc-tools-jobs",
      retryAll() {},
      ackAll() {}
    } as MessageBatch, env as never, testExecutionContext()),
    /Browser agent tasks must run through the Cloudflare Workflow lane/
  );

  assert.equal(env.ARTIFACTS.puts.length, 0);
  assert.equal(env.DB.runs.some((run) => run.values.includes("tools.browser_agent.queue_rejected")), true);
});

test("hosted Browser Agent Workflow does not email operators for Browser Session user-cap pressure", async () => {
  const env = fakeLiveEnv("agent-session-user-cap-token");
  env.VC_TOOLS_INTERNAL_ALERT_TOKEN = Buffer.from(new Uint8Array(32).fill(8)).toString("base64url");
  const internalRequests: Request[] = [];
  env.VC_TOOLS_INTERNAL_API_WORKER = {
    async fetch(request: Request) {
      internalRequests.push(request);
      return new Response(JSON.stringify({ received: true, sent: true }), {
        headers: { "content-type": "application/json" }
      });
    }
  } as Fetcher;

  const pending: Promise<unknown>[] = [];
  await withMockBrowserSession(async () => {
    await withPublicDns(async () => {
      await runBrowserAgentWorkflow(env, {
        id: "job_agent_user_cap_no_operator_alert",
        capability: "browser.agent_task",
        input: {
          kind: "browser",
          url: "https://example.com/",
          timeoutMs: 1_200_000,
          idleTimeoutMs: 600_000,
          output: "html",
          actions: [{ action: "snapshot" }]
        },
        enqueuedAt: new Date().toISOString(),
        actorId: "usr_agent_user_cap_no_operator_alert",
        planName: "Creator",
        retentionDays: 30,
        reservedCredits: 1,
        reservedBrowserSeconds: 1200,
        reservedSandboxSeconds: 0
      }, pending);
    });
  });
  await Promise.allSettled(pending);

  assert.equal(env.DB.runs.some((run) => run.values.includes("tools.capacity_soft_cap_alert")), false);
  assert.equal(env.DB.operatorAlertClaims.size, 0);
  assert.equal(internalRequests.length, 0);
});

test("hosted Browser Agent Workflow idle-closes wait-only paid browser agent tasks and still closes the browser", async () => {
  const env = fakeLiveEnv("agent-idle-token");
  const state = await withMockBrowserSession(async (browserState) => {
    await withPublicDns(async () => {
      await runBrowserAgentWorkflow(env, {
        id: "job_agent_idle",
        capability: "browser.agent_task",
        input: {
          kind: "browser",
          url: "https://example.com/",
          timeoutMs: 3_600_000,
          idleTimeoutMs: 1_000,
          output: "html",
          actions: [{ action: "wait", ms: 30_000 }, { action: "snapshot" }]
        },
        enqueuedAt: new Date().toISOString(),
        actorId: "usr_agent_idle",
        planName: "Pro",
        retentionDays: 30,
        reservedCredits: 1,
        reservedBrowserSeconds: 3600,
        reservedSandboxSeconds: 0
      });
    });
    return browserState;
  });

  assert.equal(state.closed, 1);
  const payload = JSON.parse(new TextDecoder().decode(env.ARTIFACTS.puts[0]?.value as Uint8Array));
  assert.equal(payload.closureReason, "idle_timeout");
  assert.equal(payload.actions.some((action: { action: string }) => action.action === "wait"), true);
  assert.equal(payload.actions.some((action: { action: string }) => action.action === "snapshot"), false);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO audit_events") && run.values.includes("tools.browser_agent.idle_timeout")), true);
});

test("hosted queue handler uses Browser Run crawl Quick Action and meters crawl pages", async () => {
  const env = fakeLiveEnv("quick-action-crawl-token");
  const quickActionToken = browserRunApiToken();
  env.VC_TOOLS_BROWSER_RUN_ACCOUNT_ID = "acct_123";
  env.VC_TOOLS_BROWSER_RUN_API_TOKEN = quickActionToken;
  const quickActionCalls: Array<{ url: string; method: string; headers: Headers; body?: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://api.cloudflare.com/client/v4/accounts/acct_123/browser-rendering/crawl") {
      quickActionCalls.push({
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      });
      return new Response(JSON.stringify({ success: true, result: "crawl_123" }), {
        headers: { "content-type": "application/json" }
      });
    }
    if (url === "https://api.cloudflare.com/client/v4/accounts/acct_123/browser-rendering/crawl/crawl_123?limit=1") {
      quickActionCalls.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({
        success: true,
        result: {
          id: "crawl_123",
          status: "completed",
          browserSecondsUsed: 12.4,
          total: 2,
          finished: 2,
          records: []
        }
      }), { headers: { "content-type": "application/json" } });
    }
    if (url === "https://api.cloudflare.com/client/v4/accounts/acct_123/browser-rendering/crawl/crawl_123?limit=5") {
      quickActionCalls.push({ url, method: init?.method ?? "GET", headers: new Headers(init?.headers) });
      return new Response(JSON.stringify({
        success: true,
        result: {
          id: "crawl_123",
          status: "completed",
          browserSecondsUsed: 12.4,
          total: 2,
          finished: 2,
          records: [
            { url: "https://example.com/docs", status: "completed", markdown: "# Docs", metadata: { status: 200, url: "https://example.com/docs", title: "Docs" } },
            { url: "https://example.com/docs/a", status: "completed", markdown: "# A", metadata: { status: 200, url: "https://example.com/docs/a", title: "A" } }
          ]
        }
      }), { headers: { "content-type": "application/json" } });
    }
    return originalFetch(input, init);
  };
  const message = {
    id: "job_crawl_action",
    capability: "browser.crawl_site",
    input: {
      kind: "browser",
      url: "https://example.com/docs",
      timeoutMs: 180000,
      output: "crawl",
      maxPages: 5,
      maxDepth: 2,
      render: false,
      format: "markdown"
    },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_crawl_action",
    planName: "Pro",
    retentionDays: 3,
    reservedCredits: 1,
    reservedBrowserSeconds: 180
  };

  try {
    await worker.queue?.({
      messages: [{ body: message }],
      queue: "vc-tools-jobs",
      retryAll() {},
      ackAll() {}
    } as MessageBatch, env as never, testExecutionContext());
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(quickActionCalls.length, 3);
  assert.equal(quickActionCalls[0]?.headers.get("authorization"), bearerHeader(quickActionToken));
  assert.equal(quickActionCalls[0]?.body?.url, "https://example.com/docs");
  assert.equal(quickActionCalls[0]?.body?.limit, 5);
  assert.equal(quickActionCalls[0]?.body?.depth, 2);
  assert.deepEqual(quickActionCalls[0]?.body?.formats, ["markdown"]);
  assert.equal(quickActionCalls[0]?.body?.render, false);
  assert.equal((quickActionCalls[0]?.body?.gotoOptions as Record<string, unknown> | undefined)?.timeout, 60000);
  assert.equal("actionTimeout" in (quickActionCalls[0]?.body ?? {}), false);
  assert.equal(env.ARTIFACTS.puts.length, 1);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'completed'")), true);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO usage_events") && run.values.includes("browser-minute")), true);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("INSERT INTO usage_events") && run.values.includes("crawl-page") && run.values.includes(2)), true);
});

test("hosted provider error details redact authority without hiding operator counters", async () => {
  const env = fakeLiveEnv("quick-action-error-token");
  const quickActionToken = browserRunApiToken();
  env.VC_TOOLS_BROWSER_RUN_ACCOUNT_ID = "acct_123";
  env.VC_TOOLS_BROWSER_RUN_API_TOKEN = quickActionToken;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://api.cloudflare.com/client/v4/accounts/acct_123/browser-rendering/screenshot")) {
      assert.equal(new Headers(init?.headers).get("authorization"), bearerHeader(quickActionToken));
      return new Response(JSON.stringify({
        success: false,
        errors: [{
          code: "provider.failed",
          message: "Validation failed for request body.",
          requestId: "cf_req_123",
          tokenCount: 42,
          tokenKind: "provider_diagnostic",
          access_token: fakeSecret("cf", "provider", "token", "1234567890"),
          authToken: fakeSecret("cf", "auth", "token", "1234567890")
        }]
      }), {
        status: 500,
        headers: { "content-type": "application/json" }
      });
    }
    return originalFetch(input, init);
  };
  const message = {
    id: "job_quick_action_error",
    capability: "browser.screenshot_url",
    input: { kind: "browser", url: "https://example.com/", timeoutMs: 30000, output: "png" },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_quick_action_error",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 1,
    reservedBrowserSeconds: 30
  };

  try {
    await worker.queue?.({
      messages: [{ body: message }],
      queue: "vc-tools-jobs",
      retryAll() {},
      ackAll() {}
    } as MessageBatch, env as never, testExecutionContext());
    assert.fail("Expected provider failure");
  } catch (error) {
    const details = (error as { details?: { payload?: { errors?: Array<Record<string, unknown>> } } }).details;
    const providerError = details?.payload?.errors?.[0];
    assert.equal(providerError?.requestId, "cf_req_123");
    assert.equal(providerError?.tokenCount, 42);
    assert.equal(providerError?.tokenKind, "provider_diagnostic");
    assert.equal(providerError?.access_token, "[redacted]");
    assert.equal(providerError?.authToken, "[redacted]");
    assert.equal(error instanceof Error && error.message.includes("Provider: Validation failed for request body."), true);
    assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'failed'")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted queue handler defers provider rate limits without marking jobs failed", async () => {
  const env = fakeLiveEnv("quick-action-rate-limit-token");
  const quickActionToken = browserRunApiToken();
  env.VC_TOOLS_BROWSER_RUN_ACCOUNT_ID = "acct_123";
  env.VC_TOOLS_BROWSER_RUN_API_TOKEN = quickActionToken;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://api.cloudflare.com/client/v4/accounts/acct_123/browser-rendering/screenshot")) {
      assert.equal(new Headers(init?.headers).get("authorization"), bearerHeader(quickActionToken));
      return new Response(JSON.stringify({ success: false, errors: [{ code: 429, message: "rate limited" }] }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": "2"
        }
      });
    }
    return originalFetch(input, init);
  };
  const message = {
    id: "job_quick_action_rate_limited",
    capability: "browser.screenshot_url",
    input: { kind: "browser", url: "https://example.com/", timeoutMs: 30000, output: "png" },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_quick_action_rate_limited",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 1,
    reservedBrowserSeconds: 30
  };

  try {
    await assert.rejects(
      worker.queue?.({
        messages: [{ body: message }],
        queue: "vc-tools-jobs",
        retryAll() {},
        ackAll() {}
      } as MessageBatch, env as never, testExecutionContext()),
      /retry this job/
    );
    assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'queued'")), true);
    assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'failed'")), false);
    assert.equal(env.DB.runs.some((run) => run.sql.includes("tools.provider_retry_deferred") || run.values.includes("tools.provider_retry_deferred")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("hosted queue handler defers browser jobs above the account-wide hard cap", async () => {
  const env = fakeLiveEnv("browser-cap-token");
  env.VC_TOOLS_BROWSER_RUN_ACCOUNT_HARD_CAP = "12";
  env.DB.statusRows.push({ status: "queued" });
  const message = {
    id: "job_browser_cap",
    capability: "browser.render_url",
    input: { kind: "browser", url: "https://example.com/", timeoutMs: 30000, output: "html" },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_browser_cap",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 1,
    reservedBrowserSeconds: 30
  };

  await assert.rejects(
    worker.queue?.({
      messages: [{ body: message }],
      queue: "vc-tools-jobs",
      retryAll() {},
      ackAll() {}
    } as MessageBatch, env as never, testExecutionContext()),
    /Account-wide Browser Run concurrency is full/
  );

  assert.equal(env.ARTIFACTS.puts.length, 0);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("tools.browser_account_cap_deferred") || run.values.includes("tools.browser_account_cap_deferred")), true);
  assert.equal(env.DB.runs.some((run) => run.values.includes(12)), true);
});

test("hosted Browser Agent Workflow defers Browser Session jobs above the account-wide hard cap", async () => {
  const env = fakeLiveEnv("browser-session-cap-token");
  env.VC_TOOLS_BROWSER_RUN_ACCOUNT_HARD_CAP = "12";
  env.DB.statusRows.push({ status: "queued" });
  const message = {
    id: "job_browser_session_cap",
    capability: "browser.agent_task",
    input: {
      kind: "browser",
      url: "https://example.com/",
      timeoutMs: 30000,
      output: "html",
      instructions: "Summarize the page"
    },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_browser_session_cap",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 1,
    reservedBrowserSeconds: 30,
    reservedSandboxSeconds: 0
  };

  await assert.rejects(
    runBrowserAgentWorkflow(env, message),
    /Account-wide Browser Run concurrency is full/
  );

  assert.equal(env.ARTIFACTS.puts.length, 0);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("tools.browser_account_cap_deferred") || run.values.includes("tools.browser_account_cap_deferred")), true);
  assert.equal(env.DB.runs.some((run) => run.values.includes(12)), true);
});

test("hosted queue handler defers sandbox jobs above the account-wide hard cap", async () => {
  const env = fakeLiveEnv("sandbox-cap-token");
  env.VC_TOOLS_SANDBOX_ACCOUNT_HARD_CAP = "30";
  env.DB.statusRows.push({ status: "queued" });
  const message = {
    id: "job_sandbox_cap",
    capability: "sandbox.run_command",
    input: { kind: "sandbox", command: "npm test", network: true, timeoutMs: 30000 },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_sandbox_cap",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 1,
    reservedBrowserSeconds: 0
  };

  await assert.rejects(
    worker.queue?.({
      messages: [{ body: message }],
      queue: "vc-tools-jobs",
      retryAll() {},
      ackAll() {}
    } as MessageBatch, env as never, testExecutionContext()),
    /Account-wide Sandbox concurrency is full/
  );

  assert.equal(env.ARTIFACTS.puts.length, 0);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("tools.sandbox_account_cap_deferred") || run.values.includes("tools.sandbox_account_cap_deferred")), true);
  assert.equal(env.DB.runs.some((run) => run.values.includes(30)), true);
});

test("hosted queue handler reconciles sandbox reservations for failed execution", async () => {
  const env = fakeLiveEnv("sandbox-failure-token");
  const message = {
    id: "job_sandbox_failure",
    capability: "sandbox.run_command",
    input: { kind: "sandbox", command: "npm test", network: true, timeoutMs: 30000 },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_sandbox_failure",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 1,
    reservedBrowserSeconds: 0,
    reservedSandboxSeconds: 30
  };

  await assert.rejects(
    worker.queue?.({
      messages: [{ body: message }],
      queue: "vc-tools-jobs",
      retryAll() {},
      ackAll() {}
    } as MessageBatch, env as never, testExecutionContext()),
    /Sandbox execution is not available/
  );

  assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'failed'")), true);
  assert.equal(
    env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET reserved_sandbox_seconds = ?") && run.values[1] === "job_sandbox_failure"),
    true
  );
});

test("hosted queue handler lets failed job messages reach the configured DLQ retry boundary", async () => {
  const env = fakeLiveEnv("failed-retry-token");
  env.DB.firstRows.push({ status: "failed", actor_id: "usr_failed_retry", plan_name: "Creator" });
  const message = {
    id: "job_failed_retry",
    capability: "sandbox.run_command",
    input: { kind: "sandbox", command: "npm test", network: true, timeoutMs: 30000 },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_failed_retry",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 1,
    reservedBrowserSeconds: 0,
    reservedSandboxSeconds: 30
  };

  await assert.rejects(
    worker.queue?.({
      messages: [{ body: message, attempts: 3 }],
      queue: "vc-tools-jobs",
      retryAll() {},
      ackAll() {}
    } as MessageBatch, env as never, testExecutionContext()),
    /DLQ policy will own terminal delivery/
  );

  assert.equal(env.ARTIFACTS.puts.length, 0);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'running'")), false);
  assert.equal(env.DB.runs.some((run) => run.values.includes("tools.failed_queue_retry_pending")), true);
});

test("hosted queue handler stops exhausted failed job messages from looping forever", async () => {
  const env = fakeLiveEnv("failed-exhausted-token");
  env.DB.firstRows.push({ status: "failed", actor_id: "usr_failed_exhausted", plan_name: "Creator" });
  const message = {
    id: "job_failed_exhausted",
    capability: "sandbox.run_command",
    input: { kind: "sandbox", command: "npm test", network: true, timeoutMs: 30000 },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_failed_exhausted",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 1,
    reservedBrowserSeconds: 0,
    reservedSandboxSeconds: 30
  };

  await worker.queue?.({
    messages: [{ body: message, attempts: 4 }],
    queue: "vc-tools-jobs",
    retryAll() {},
    ackAll() {}
  } as MessageBatch, env as never, testExecutionContext());

  assert.equal(env.ARTIFACTS.puts.length, 0);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'running'")), false);
  assert.equal(env.DB.runs.some((run) => run.values.includes("tools.failed_queue_retry_exhausted")), true);
});

test("hosted queue handler runs sandbox jobs with timeout, capped output, minimal env, and teardown", async () => {
  const env = fakeLiveEnv("sandbox-success-token");
  (env as Record<string, unknown>).CLERK_SECRET_KEY = "clerk_should_not_enter_sandbox";
  const execCalls: Array<{ command: string; options?: Record<string, unknown> }> = [];
  const destroyed: string[] = [];
  const sandboxGlobal = globalThis as SandboxTestGlobal;
  sandboxGlobal.__VC_TOOLS_SANDBOX_TEST_FACTORY__ = () => ({
    async exec(command: string, options?: Record<string, unknown>) {
      execCalls.push({ command, options });
      return {
        success: true,
        exitCode: 0,
        stdout: "o".repeat(200_010),
        stderr: "e".repeat(200_010),
        duration: 123,
        timestamp: "2026-05-01T00:00:00.000Z"
      };
    },
    async destroy() {
      destroyed.push("destroyed");
    }
  });

  const message = {
    id: "job_sandbox_success",
    capability: "sandbox.run_command",
    input: { kind: "sandbox", command: "printf ok", network: true, timeoutMs: 30000 },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_sandbox_success",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 1,
    reservedBrowserSeconds: 0,
    reservedSandboxSeconds: 30
  };
  const pending: Promise<unknown>[] = [];

  try {
    await worker.queue?.({
      messages: [{ body: message }],
      queue: "vc-tools-jobs",
      retryAll() {},
      ackAll() {}
    } as MessageBatch, env as never, testExecutionContext(pending));
    await Promise.all(pending);
  } finally {
    delete sandboxGlobal.__VC_TOOLS_SANDBOX_TEST_FACTORY__;
  }

  assert.equal(execCalls.length, 1);
  assert.equal(execCalls[0]?.command, "printf ok");
  assert.equal(execCalls[0]?.options?.timeout, 30000);
  assert.equal(execCalls[0]?.options?.cwd, "/workspace");
  const sandboxEnv = execCalls[0]?.options?.env;
  assert.equal(isRecord(sandboxEnv), true);
  assert.equal(isRecord(sandboxEnv) && sandboxEnv.VC_TOOLS_JOB_ID, "job_sandbox_success");
  assert.equal(isRecord(sandboxEnv) && sandboxEnv.VC_TOOLS_SANDBOX_NETWORK, "true");
  assert.equal(isRecord(sandboxEnv) && Object.prototype.hasOwnProperty.call(sandboxEnv, "CLERK_SECRET_KEY"), false);
  assert.deepEqual(destroyed, ["destroyed"]);
  assert.equal(env.ARTIFACTS.puts.length, 1);
  const artifactText = new TextDecoder().decode(env.ARTIFACTS.puts[0]?.value as Uint8Array);
  const payload = JSON.parse(artifactText) as { stdout: string; stderr: string };
  assert.equal(payload.stdout.endsWith("\n[truncated]"), true);
  assert.equal(payload.stderr.endsWith("\n[truncated]"), true);
  assert.equal(payload.stdout.length, 200_012);
  assert.equal(payload.stderr.length, 200_012);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'completed'")), true);
  assert.equal(env.DB.runs.some((run) => run.values.includes("sandbox-compute-minute")), true);
});

test("hosted queue handler runs sandbox network jobs without per-command host allowlist setup", async () => {
  const env = fakeLiveEnv("sandbox-network-exec-token");
  const execCalls: Array<{ command: string; options?: Record<string, unknown> }> = [];
  const destroyed: string[] = [];
  const sandboxGlobal = globalThis as SandboxTestGlobal;
  sandboxGlobal.__VC_TOOLS_SANDBOX_TEST_FACTORY__ = () => ({
    async exec(command: string, options?: Record<string, unknown>) {
      execCalls.push({ command, options });
      return {
        success: true,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        duration: 42,
        timestamp: "2026-05-01T00:00:00.000Z"
      };
    },
    async destroy() {
      destroyed.push("destroyed");
    }
  });

  const message = {
    id: "job_sandbox_network_exec",
    capability: "sandbox.run_command",
    input: { kind: "sandbox", command: "npm install", network: true, timeoutMs: 30000 },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_sandbox_network_exec",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 1,
    reservedBrowserSeconds: 0,
    reservedSandboxSeconds: 30
  };
  const pending: Promise<unknown>[] = [];

  try {
    await withPublicDns(async () => {
      await worker.queue?.({
        messages: [{ body: message }],
        queue: "vc-tools-jobs",
        retryAll() {},
        ackAll() {}
      } as MessageBatch, env as never, testExecutionContext(pending));
      await Promise.all(pending);
    });
  } finally {
    delete sandboxGlobal.__VC_TOOLS_SANDBOX_TEST_FACTORY__;
  }

  assert.equal(execCalls.length, 1);
  const sandboxEnv = execCalls[0]?.options?.env;
  assert.equal(isRecord(sandboxEnv) && sandboxEnv.VC_TOOLS_SANDBOX_NETWORK, "true");
  assert.deepEqual(destroyed, ["destroyed"]);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'completed'")), true);
});

test("hosted queue handler destroys timed-out sandbox attempts including process storms", async () => {
  const sandboxGlobal = globalThis as SandboxTestGlobal;
  const scenarios = [
    {
      name: "infinite_loop",
      command: "node -e \"while (true) {}\""
    },
    {
      name: "process_storm",
      command: "node -e \"require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true }); setInterval(()=>{},1000)\""
    }
  ];

  for (const scenario of scenarios) {
    const env = fakeLiveEnv(`sandbox-timeout-${scenario.name}`);
    const execCalls: Array<{ command: string; options?: Record<string, unknown> }> = [];
    const destroyed: string[] = [];
    sandboxGlobal.__VC_TOOLS_SANDBOX_TEST_FACTORY__ = () => ({
      async exec(command: string, options?: Record<string, unknown>) {
        execCalls.push({ command, options });
        throw new Error(`Sandbox command timed out for ${scenario.name}`);
      },
      async destroy() {
        destroyed.push(scenario.name);
      }
    });

    const message = {
      id: `job_sandbox_timeout_${scenario.name}`,
      capability: "sandbox.run_command",
      input: { kind: "sandbox", command: scenario.command, network: true, timeoutMs: 1000 },
      enqueuedAt: new Date().toISOString(),
      actorId: `usr_sandbox_timeout_${scenario.name}`,
      planName: "Creator",
      retentionDays: 3,
      reservedCredits: 1,
      reservedBrowserSeconds: 0,
      reservedSandboxSeconds: 1
    };
    const pending: Promise<unknown>[] = [];

    try {
      await assert.rejects(
        worker.queue?.({
          messages: [{ body: message }],
          queue: "vc-tools-jobs",
          retryAll() {},
          ackAll() {}
        } as MessageBatch, env as never, testExecutionContext(pending)),
        /timed out/
      );
      await Promise.all(pending);
    } finally {
      delete sandboxGlobal.__VC_TOOLS_SANDBOX_TEST_FACTORY__;
    }

    assert.equal(execCalls.length, 1, scenario.name);
    assert.equal(execCalls[0]?.command, scenario.command, scenario.name);
    assert.equal(execCalls[0]?.options?.timeout, 1000, scenario.name);
    assert.equal(execCalls[0]?.options?.cwd, "/workspace", scenario.name);
    assert.deepEqual(destroyed, [scenario.name], scenario.name);
    assert.equal(env.ARTIFACTS.puts.length, 0, scenario.name);
    assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'failed'")), true, scenario.name);
    assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'completed'")), false, scenario.name);
    assert.equal(
      env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET reserved_sandbox_seconds = ?") && run.values[1] === message.id),
      true,
      scenario.name
    );
    assert.equal(env.DB.runs.some((run) => run.values.includes("tools.failed")), true, scenario.name);
  }
});

test("hosted queue handler ignores sandbox-returned files and keeps artifact keys fixed", async () => {
  const env = fakeLiveEnv("sandbox-output-files-token");
  const sandboxGlobal = globalThis as SandboxTestGlobal;
  sandboxGlobal.__VC_TOOLS_SANDBOX_TEST_FACTORY__ = () => ({
    async exec() {
      return {
        success: true,
        exitCode: 0,
        stdout: "ok",
        stderr: "",
        duration: 25,
        timestamp: "2026-05-01T00:00:00.000Z",
        files: Array.from({ length: 200 }, (_, index) => ({
          path: index === 0 ? "../platform-secret.txt" : `/workspace/output-${index}.txt`,
          content: `file-${index}`
        })),
        outputFiles: [
          { path: "/workspace/../../escape.txt", content: "escape" },
          { path: "nested/../../../secret.txt", content: "secret" }
        ],
        artifactPath: "../../owned-surface.txt"
      };
    },
    async destroy() {}
  });

  const message = {
    id: "job_sandbox_output_files",
    capability: "sandbox.run_command",
    input: { kind: "sandbox", command: "npm test", network: true, timeoutMs: 30000 },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_sandbox_output_files",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 1,
    reservedBrowserSeconds: 0,
    reservedSandboxSeconds: 30
  };
  const pending: Promise<unknown>[] = [];

  try {
    await worker.queue?.({
      messages: [{ body: message }],
      queue: "vc-tools-jobs",
      retryAll() {},
      ackAll() {}
    } as MessageBatch, env as never, testExecutionContext(pending));
    await Promise.all(pending);
  } finally {
    delete sandboxGlobal.__VC_TOOLS_SANDBOX_TEST_FACTORY__;
  }

  assert.equal(env.ARTIFACTS.puts.length, 1);
  const put = env.ARTIFACTS.puts[0];
  assert.equal(put?.key.startsWith("artifacts/art_"), true);
  assert.equal(put?.key.endsWith("/sandbox-log"), true);
  assert.equal(put?.key.includes(".."), false);
  assert.equal(put?.key.includes("workspace"), false);
  assert.equal(put?.key.includes("secret"), false);
  const artifactText = new TextDecoder().decode(put?.value as Uint8Array);
  const payload = JSON.parse(artifactText) as Record<string, unknown>;
  assert.deepEqual(Object.keys(payload).sort(), ["duration", "exitCode", "stderr", "stdout", "success", "timestamp"].sort());
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("platform-secret"), false);
  assert.equal(serialized.includes("../../"), false);
  assert.equal(serialized.includes("outputFiles"), false);
  assert.equal(serialized.includes("files"), false);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'completed'")), true);
});

test("hosted queue handler fans soft-cap alerts to internal alert channels", async () => {
  const env = fakeLiveEnv("soft-cap-token");
  env.VC_TOOLS_HOSTED_ACCOUNT_SOFT_CAP = "2";
  env.VC_TOOLS_BROWSER_RUN_ACCOUNT_SOFT_CAP = "2";
  env.VC_TOOLS_INTERNAL_ALERT_TOKEN = Buffer.from(new Uint8Array(32).fill(7)).toString("base64url");
  env.VC_TOOLS_OPERATOR_NTFY_TOPIC = "vc-tools-test-alerts";
  env.DB.runningCountRows.push({ count_value: 1 }, { count_value: 1 });
  env.DB.statusRows.push({ status: "queued" });

  const internalRequests: Request[] = [];
  env.VC_TOOLS_INTERNAL_API_WORKER = {
    async fetch(request: Request) {
      internalRequests.push(request);
      return new Response(JSON.stringify({ received: true, sent: true }), {
        headers: { "content-type": "application/json" }
      });
    }
  } as Fetcher;

  const ntfyRequests: Array<{ url: string; body: string; title: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://ntfy.sh/")) {
      ntfyRequests.push({
        url,
        body: String(init?.body ?? ""),
        title: String(new Headers(init?.headers).get("Title") ?? "")
      });
      return new Response("ok");
    }
    return originalFetch(input, init);
  };

  const message = {
    id: "job_soft_cap",
    capability: "browser.render_url",
    input: { kind: "browser", url: "https://example.com/", timeoutMs: 30000, output: "html" },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_soft_cap",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 1,
    reservedBrowserSeconds: 30
  };
  const pending: Promise<unknown>[] = [];

  try {
    await assert.rejects(
      worker.queue?.({
        messages: [{ body: message }],
        queue: "vc-tools-jobs",
        retryAll() {},
        ackAll() {}
      } as MessageBatch, env as never, testExecutionContext(pending)),
      /Account-wide Browser Run concurrency is full/
    );
    await Promise.allSettled(pending);
    env.DB.runningCountRows.push({ count_value: 1 }, { count_value: 1 });
    env.DB.statusRows.push({ status: "queued" });
    await assert.rejects(
      worker.queue?.({
        messages: [{ body: message }],
        queue: "vc-tools-jobs",
        retryAll() {},
        ackAll() {}
      } as MessageBatch, env as never, testExecutionContext(pending)),
      /Account-wide Browser Run concurrency is full/
    );
    await Promise.allSettled(pending);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(internalRequests.length, 2);
  assert.equal(ntfyRequests.length, 2);
  assert.equal(internalRequests.every((request) => request.headers.has("X-Internal-Signature")), true);
  const payloads = await Promise.all(internalRequests.map((request) => request.clone().json() as Promise<Record<string, unknown>>));
  assert.equal(payloads.every((payload) => payload.code === "E-VIBECODR-VC-TOOLS-SOFT-CAP"), true);
  assert.deepEqual(
    payloads.map((payload) => (payload.details as { surface?: string }).surface).sort(),
    ["browser.active_jobs", "hosted.active_jobs"]
  );
  assert.equal(payloads.every((payload) => (payload.details as { scope?: string }).scope === "account"), true);
  const serializedPayloads = JSON.stringify(payloads);
  assert.equal(serializedPayloads.includes("usr_soft_cap"), false);
  assert.equal(serializedPayloads.includes("https://example.com"), false);
  assert.equal(ntfyRequests.every((request) => request.title.includes("alert")), true);
  assert.equal(env.DB.runs.filter((run) => run.values.includes("tools.capacity_soft_cap_alert")).length, 2);
  assert.equal(env.DB.operatorAlertClaims.size, 2);
  assert.equal(env.DB.operatorAlertSuppressions, 2);
});

test("hosted Browser Agent Workflow emits account-wide soft-cap alerts for Browser Session jobs", async () => {
  const env = fakeLiveEnv("browser-session-soft-cap-token");
  env.VC_TOOLS_HOSTED_ACCOUNT_SOFT_CAP = "2";
  env.VC_TOOLS_BROWSER_RUN_ACCOUNT_SOFT_CAP = "2";
  env.VC_TOOLS_INTERNAL_ALERT_TOKEN = Buffer.from(new Uint8Array(32).fill(19)).toString("base64url");
  env.DB.runningCountRows.push({ count_value: 1 }, { count_value: 1 });
  env.DB.statusRows.push({ status: "queued" });

  const internalRequests: Request[] = [];
  env.VC_TOOLS_INTERNAL_API_WORKER = {
    async fetch(request: Request) {
      internalRequests.push(request);
      return new Response(JSON.stringify({ received: true, sent: true }), {
        headers: { "content-type": "application/json" }
      });
    }
  } as Fetcher;

  const message = {
    id: "job_browser_session_soft_cap",
    capability: "browser.agent_task",
    input: {
      kind: "browser",
      url: "https://example.com/session",
      timeoutMs: 30000,
      output: "html",
      instructions: "Summarize the signed-in workspace"
    },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_browser_session_soft_cap",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 1,
    reservedBrowserSeconds: 30,
    reservedSandboxSeconds: 0
  };
  const pending: Promise<unknown>[] = [];

  await assert.rejects(
    runBrowserAgentWorkflow(env, message, pending),
    /Account-wide Browser Run concurrency is full/
  );
  await Promise.allSettled(pending);

  assert.equal(internalRequests.length, 2);
  const payloads = await Promise.all(internalRequests.map((request) => request.clone().json() as Promise<Record<string, unknown>>));
  assert.equal(payloads.every((payload) => payload.code === "E-VIBECODR-VC-TOOLS-SOFT-CAP"), true);
  assert.deepEqual(
    payloads.map((payload) => (payload.details as { surface?: string }).surface).sort(),
    ["browser.active_jobs", "hosted.active_jobs"]
  );
  assert.equal(payloads.every((payload) => (payload.details as { scope?: string }).scope === "account"), true);
  const serializedPayloads = JSON.stringify(payloads);
  assert.equal(serializedPayloads.includes("usr_browser_session_soft_cap"), false);
  assert.equal(serializedPayloads.includes("signed-in workspace"), false);
  assert.equal(serializedPayloads.includes("https://example.com/session"), false);
  assert.equal(env.ARTIFACTS.puts.length, 0);
  assert.equal(env.DB.runs.filter((run) => run.values.includes("tools.capacity_soft_cap_alert")).length, 2);
  assert.equal(env.DB.runs.some((run) => run.values.includes("tools.browser_account_cap_deferred")), true);
});

test("hosted queue handler audits missing operator alert notifier bindings", async () => {
  const env = fakeLiveEnv("soft-cap-missing-token");
  env.VC_TOOLS_HOSTED_ACCOUNT_SOFT_CAP = "2";
  env.VC_TOOLS_BROWSER_RUN_ACCOUNT_SOFT_CAP = "2";
  env.DB.runningCountRows.push({ count_value: 1 }, { count_value: 1 });
  env.DB.statusRows.push({ status: "queued" });

  const pending: Promise<unknown>[] = [];
  const message = {
    id: "job_soft_cap_missing_notifier",
    capability: "browser.render_url",
    input: { kind: "browser", url: "https://example.com", timeoutMs: 30000, output: "html" },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_soft_cap_missing",
    planName: "Creator",
    retentionDays: 7,
    reservedCredits: 1,
    reservedBrowserSeconds: 30,
    reservedSandboxSeconds: 0
  };

  await assert.rejects(
    worker.queue?.({
      messages: [{ body: message }],
      queue: "vc-tools-jobs",
      retryAll() {},
      ackAll() {}
    } as MessageBatch, env as never, testExecutionContext(pending)),
    /Account-wide Browser Run concurrency is full/
  );
  await Promise.allSettled(pending);

  assert.equal(env.DB.runs.filter((run) => run.values.includes("tools.capacity_soft_cap_alert")).length, 2);
  assert.equal(env.DB.runs.filter((run) => run.values.includes("tools.operator_alert_delivery_unconfigured")).length, 2);
  assert.equal(env.DB.operatorAlertClaims.size, 2);
});

test("hosted scheduled check alerts on account-level queue backlog without user fanout", async () => {
  const env = fakeLiveEnv("queue-alert-token");
  env.VC_TOOLS_INTERNAL_ALERT_TOKEN = Buffer.from(new Uint8Array(32).fill(10)).toString("base64url");
  env.VC_TOOLS_QUEUE_BACKLOG_SOFT_CAP = "30";
  env.VC_TOOLS_QUEUE_BACKLOG_HARD_CAP = "100";
  env.JOB_QUEUE.metricsSnapshot = {
    backlogCount: 30,
    backlogBytes: 8192,
    oldestMessageTimestamp: new Date("2026-05-15T00:00:00.000Z")
  };
  const internalRequests: Request[] = [];
  env.VC_TOOLS_INTERNAL_API_WORKER = {
    async fetch(request: Request) {
      internalRequests.push(request);
      return new Response(JSON.stringify({ received: true, sent: true }), {
        headers: { "content-type": "application/json" }
      });
    }
  } as Fetcher;

  const pending: Promise<unknown>[] = [];
  await worker.scheduled?.({
    cron: "17 */6 * * *",
    scheduledTime: Date.parse("2026-05-15T00:00:00.000Z"),
    type: "scheduled"
  } as ScheduledController, env as never, testExecutionContext(pending));
  await drainPendingWaitUntil(pending);

  assert.equal(internalRequests.length, 1);
  const firstRequest = internalRequests[0];
  assert.ok(firstRequest);
  const payload = await firstRequest.clone().json() as Record<string, unknown>;
  assert.equal(payload.code, "E-VIBECODR-VC-TOOLS-SOFT-CAP");
  assert.equal((payload.details as { scope?: string }).scope, "account");
  assert.equal((payload.details as { surface?: string }).surface, "queue.backlog_messages");
  assert.equal((payload.details as { unit?: string }).unit, "messages");
  assert.equal((payload.details as { currentUsage?: number }).currentUsage, 30);
  assert.equal(JSON.stringify(payload).includes("usr_"), false);
  assert.equal(env.DB.runs.some((run) => run.values.includes("tools.capacity_soft_cap_alert")), true);
  assert.equal(env.DB.operatorAlertClaims.size, 1);
});

test("hosted scheduled check alerts on account-level DLQ backlog without user fanout", async () => {
  const env = fakeLiveEnv("dlq-alert-token");
  env.VC_TOOLS_INTERNAL_ALERT_TOKEN = Buffer.from(new Uint8Array(32).fill(9)).toString("base64url");
  env.VC_TOOLS_DLQ_MESSAGES_SOFT_CAP = "1";
  env.VC_TOOLS_DLQ_MESSAGES_HARD_CAP = "4";
  env.JOB_DLQ.metricsSnapshot = {
    backlogCount: 1,
    backlogBytes: 2048,
    oldestMessageTimestamp: new Date("2026-05-15T00:00:00.000Z")
  };
  const internalRequests: Request[] = [];
  env.VC_TOOLS_INTERNAL_API_WORKER = {
    async fetch(request: Request) {
      internalRequests.push(request);
      return new Response(JSON.stringify({ received: true, sent: true }), {
        headers: { "content-type": "application/json" }
      });
    }
  } as Fetcher;

  const pending: Promise<unknown>[] = [];
  await worker.scheduled?.({
    cron: "17 */6 * * *",
    scheduledTime: Date.parse("2026-05-15T00:00:00.000Z"),
    type: "scheduled"
  } as ScheduledController, env as never, testExecutionContext(pending));
  await drainPendingWaitUntil(pending);

  assert.equal(internalRequests.length, 1);
  const firstRequest = internalRequests[0];
  assert.ok(firstRequest);
  const payload = await firstRequest.clone().json() as Record<string, unknown>;
  assert.equal(payload.code, "E-VIBECODR-VC-TOOLS-SOFT-CAP");
  assert.equal((payload.details as { scope?: string }).scope, "account");
  assert.equal((payload.details as { surface?: string }).surface, "queue.dlq_messages");
  assert.equal((payload.details as { unit?: string }).unit, "messages");
  assert.equal((payload.details as { currentUsage?: number }).currentUsage, 1);
  assert.equal(JSON.stringify(payload).includes("usr_"), false);
  assert.equal(env.DB.runs.some((run) => run.values.includes("tools.capacity_soft_cap_alert")), true);
  assert.equal(env.DB.operatorAlertClaims.size, 1);
});

test("hosted scheduled check alerts on account-level artifact storage growth without user fanout", async () => {
  const env = fakeLiveEnv("artifact-storage-alert-token");
  env.VC_TOOLS_INTERNAL_ALERT_TOKEN = Buffer.from(new Uint8Array(32).fill(11)).toString("base64url");
  env.VC_TOOLS_ARTIFACT_STORAGE_ACCOUNT_SOFT_GB = "24";
  env.VC_TOOLS_ARTIFACT_STORAGE_ACCOUNT_HARD_GB = "30";
  env.DB.firstRowsByQuery.push(
    {
      sqlIncludes: "SELECT COALESCE(SUM(bytes), 0) AS bytes FROM artifacts",
      row: { bytes: 24 * 1024 * 1024 * 1024 }
    },
    {
      sqlIncludes: "SELECT COUNT(1) AS count_value FROM audit_events",
      row: { count_value: 0 }
    }
  );
  const internalRequests: Request[] = [];
  env.VC_TOOLS_INTERNAL_API_WORKER = {
    async fetch(request: Request) {
      internalRequests.push(request);
      return new Response(JSON.stringify({ received: true, sent: true }), {
        headers: { "content-type": "application/json" }
      });
    }
  } as Fetcher;

  const pending: Promise<unknown>[] = [];
  await worker.scheduled?.({
    cron: "17 */6 * * *",
    scheduledTime: Date.parse("2026-05-15T00:00:00.000Z"),
    type: "scheduled"
  } as ScheduledController, env as never, testExecutionContext(pending));
  await drainPendingWaitUntil(pending);

  assert.equal(internalRequests.length, 1);
  const firstRequest = internalRequests[0];
  assert.ok(firstRequest);
  const payload = await firstRequest.clone().json() as Record<string, unknown>;
  assert.equal(payload.code, "E-VIBECODR-VC-TOOLS-SOFT-CAP");
  assert.equal((payload.details as { scope?: string }).scope, "account");
  assert.equal((payload.details as { surface?: string }).surface, "artifact.storage_gb");
  assert.equal((payload.details as { unit?: string }).unit, "GB");
  assert.equal((payload.details as { currentUsage?: number }).currentUsage, 24);
  assert.equal(JSON.stringify(payload).includes("usr_"), false);
  assert.equal(env.DB.runs.some((run) => run.values.includes("tools.capacity_soft_cap_alert")), true);
  assert.equal(env.DB.operatorAlertClaims.size, 1);
});

test("hosted scheduled check alerts on account-level execution failure and timeout rates without user fanout", async () => {
  const env = fakeLiveEnv("execution-health-alert-token");
  env.VC_TOOLS_INTERNAL_ALERT_TOKEN = Buffer.from(new Uint8Array(32).fill(13)).toString("base64url");
  env.VC_TOOLS_EXECUTION_HEALTH_WINDOW_MINUTES = "15";
  env.VC_TOOLS_EXECUTION_HEALTH_MIN_TERMINAL_JOBS = "5";
  env.VC_TOOLS_FAILURE_RATE_ALERT_PERCENT = "25";
  env.VC_TOOLS_TIMEOUT_RATE_ALERT_PERCENT = "10";
  env.DB.firstRowsByQuery.push(
    {
      sqlIncludes: "SELECT COALESCE(SUM(bytes), 0) AS bytes FROM artifacts",
      row: { bytes: 0 }
    },
    {
      sqlIncludes: "FROM jobs",
      valuesInclude: ["browser.%"],
      row: { total: 10, failed: 3, timed_out: 2 }
    },
    {
      sqlIncludes: "FROM jobs",
      valuesInclude: ["sandbox.%"],
      row: { total: 8, failed: 3, timed_out: 2 }
    },
    {
      sqlIncludes: "SELECT COUNT(1) AS count_value FROM audit_events",
      row: { count_value: 0 }
    }
  );
  const internalRequests: Request[] = [];
  env.VC_TOOLS_INTERNAL_API_WORKER = {
    async fetch(request: Request) {
      internalRequests.push(request);
      return new Response(JSON.stringify({ received: true, sent: true }), {
        headers: { "content-type": "application/json" }
      });
    }
  } as Fetcher;

  const pending: Promise<unknown>[] = [];
  await worker.scheduled?.({
    cron: "17 */6 * * *",
    scheduledTime: Date.parse("2026-05-15T00:00:00.000Z"),
    type: "scheduled"
  } as ScheduledController, env as never, testExecutionContext(pending));
  await drainPendingWaitUntil(pending);

  assert.equal(internalRequests.length, 4);
  const payloads = await Promise.all(internalRequests.map((request) => request.clone().json() as Promise<Record<string, unknown>>));
  assert.equal(payloads.every((payload) => payload.code === "E-VIBECODR-VC-TOOLS-EXECUTION-HEALTH-DEGRADED"), true);
  assert.deepEqual(
    payloads.map((payload) => (payload.details as { surface?: string }).surface).sort(),
    ["browser.failure_rate", "browser.timeout_rate", "sandbox.failure_rate", "sandbox.timeout_rate"]
  );
  assert.equal(payloads.every((payload) => (payload.details as { scope?: string }).scope === "account"), true);
  assert.equal(payloads.every((payload) => (payload.details as { unit?: string }).unit === "%"), true);
  assert.equal(JSON.stringify(payloads).includes("usr_"), false);
  assert.equal(env.DB.runs.filter((run) => run.values.includes("tools.execution_failure_rate_alert")).length, 2);
  assert.equal(env.DB.runs.filter((run) => run.values.includes("tools.execution_timeout_rate_alert")).length, 2);
  assert.equal(env.DB.operatorAlertClaims.size, 4);
});

test("hosted scheduled check alerts on account-level auth failure anomalies without user fanout", async () => {
  const env = fakeLiveEnv("auth-failure-alert-token");
  env.VC_TOOLS_INTERNAL_ALERT_TOKEN = Buffer.from(new Uint8Array(32).fill(15)).toString("base64url");
  env.VC_TOOLS_AUTH_FAILURE_WINDOW_MINUTES = "15";
  env.VC_TOOLS_AUTH_FAILURE_ALERT_THRESHOLD = "5";
  env.DB.firstRowsByQuery.push(
    {
      sqlIncludes: "SELECT COALESCE(SUM(bytes), 0) AS bytes FROM artifacts",
      row: { bytes: 0 }
    },
    {
      sqlIncludes: "FROM jobs",
      valuesInclude: ["browser.%"],
      row: { total: 0, failed: 0, timed_out: 0 }
    },
    {
      sqlIncludes: "FROM jobs",
      valuesInclude: ["sandbox.%"],
      row: { total: 0, failed: 0, timed_out: 0 }
    },
    {
      sqlIncludes: "SELECT COUNT(1) AS count_value FROM audit_events",
      row: { count_value: 5 }
    }
  );
  const internalRequests: Request[] = [];
  env.VC_TOOLS_INTERNAL_API_WORKER = {
    async fetch(request: Request) {
      internalRequests.push(request);
      return new Response(JSON.stringify({ received: true, sent: true }), {
        headers: { "content-type": "application/json" }
      });
    }
  } as Fetcher;

  const pending: Promise<unknown>[] = [];
  await worker.scheduled?.({
    cron: "17 */6 * * *",
    scheduledTime: Date.parse("2026-05-15T00:00:00.000Z"),
    type: "scheduled"
  } as ScheduledController, env as never, testExecutionContext(pending));
  await drainPendingWaitUntil(pending);

  assert.equal(internalRequests.length, 1);
  const firstRequest = internalRequests[0];
  assert.ok(firstRequest);
  const payload = await firstRequest.clone().json() as Record<string, unknown>;
  assert.equal(payload.code, "E-VIBECODR-VC-TOOLS-AUTH-FAILURE-ANOMALY");
  const details = payload.details as { scope?: string; surface?: string; unit?: string; currentUsage?: number; windowMinutes?: number };
  assert.equal(details.scope, "account");
  assert.equal(details.surface, "auth.failure_anomaly");
  assert.equal(details.unit, "failures");
  assert.equal(details.currentUsage, 5);
  assert.equal(details.windowMinutes, 15);
  assert.equal(JSON.stringify(payload).includes("usr_"), false);
  assert.equal(env.DB.runs.some((run) => run.values.includes("tools.auth_failure_anomaly_alert")), true);
  assert.equal(env.DB.operatorAlertClaims.size, 1);
});

test("hosted scheduled check alerts on account-level Cloudflare spend anomaly without user fanout", async () => {
  const env = fakeLiveEnv("cloudflare-spend-alert-token");
  env.VC_TOOLS_INTERNAL_ALERT_TOKEN = Buffer.from(new Uint8Array(32).fill(16)).toString("base64url");
  env.VC_TOOLS_CLOUDFLARE_SPEND_SOFT_USD = "80";
  env.VC_TOOLS_CLOUDFLARE_SPEND_HARD_USD = "100";
  env.VC_TOOLS_COGS_BROWSER_MINUTE_USD = "1";
  env.VC_TOOLS_COGS_SANDBOX_STANDARD1_MINUTE_USD = "2";
  env.VC_TOOLS_COGS_SANDBOX_STANDARD2_MINUTE_USD = "3";
  env.VC_TOOLS_COGS_CRAWL_PAGE_USD = "4";
  env.VC_TOOLS_COGS_ARTIFACT_GB_MONTH_USD = "5";
  env.DB.firstRowsByQuery.push(
    {
      sqlIncludes: "SELECT COALESCE(SUM(bytes), 0) AS bytes FROM artifacts",
      row: { bytes: 0 }
    },
    {
      sqlIncludes: "FROM jobs",
      valuesInclude: ["browser.%"],
      row: { total: 0, failed: 0, timed_out: 0 }
    },
    {
      sqlIncludes: "FROM jobs",
      valuesInclude: ["sandbox.%"],
      row: { total: 0, failed: 0, timed_out: 0 }
    },
    {
      sqlIncludes: "SELECT COUNT(1) AS count_value FROM audit_events",
      row: { count_value: 0 }
    },
    {
      sqlIncludes: "FROM usage_events WHERE meter = ?",
      valuesInclude: ["browser-minute"],
      row: { quantity: 20 }
    },
    {
      sqlIncludes: "sandbox-compute-minute",
      row: { standard1_minutes: 10, standard2_minutes: 10 }
    },
    {
      sqlIncludes: "FROM usage_events WHERE meter = ?",
      valuesInclude: ["crawl-page"],
      row: { quantity: 5 }
    },
    {
      sqlIncludes: "SELECT COALESCE(SUM(bytes), 0) AS bytes FROM artifacts",
      row: { bytes: 2 * 1024 * 1024 * 1024 }
    }
  );
  const internalRequests: Request[] = [];
  env.VC_TOOLS_INTERNAL_API_WORKER = {
    async fetch(request: Request) {
      internalRequests.push(request);
      return new Response(JSON.stringify({ received: true, sent: true }), {
        headers: { "content-type": "application/json" }
      });
    }
  } as Fetcher;

  const pending: Promise<unknown>[] = [];
  await worker.scheduled?.({
    cron: "17 */6 * * *",
    scheduledTime: Date.parse("2026-05-15T00:00:00.000Z"),
    type: "scheduled"
  } as ScheduledController, env as never, testExecutionContext(pending));
  await drainPendingWaitUntil(pending);

  assert.equal(internalRequests.length, 1);
  const firstRequest = internalRequests[0];
  assert.ok(firstRequest);
  const payload = await firstRequest.clone().json() as Record<string, unknown>;
  assert.equal(payload.code, "E-VIBECODR-VC-TOOLS-CLOUDFLARE-SPEND-ANOMALY");
  const details = payload.details as {
    scope?: string;
    surface?: string;
    unit?: string;
    currentUsage?: number;
    includedUsage?: number;
    billingPeriod?: string;
    browserMinutes?: number;
    sandboxStandard1Minutes?: number;
    sandboxStandard2Minutes?: number;
    crawlPages?: number;
    artifactStorageGb?: number;
    estimatedRawCostUsd?: number;
  };
  assert.equal(details.scope, "account");
  assert.equal(details.surface, "cloudflare.estimated_spend_usd");
  assert.equal(details.unit, "USD");
  assert.equal(details.currentUsage, 100);
  assert.equal(details.includedUsage, 100);
  assert.equal(details.billingPeriod, "2026-05");
  assert.equal(details.browserMinutes, 20);
  assert.equal(details.sandboxStandard1Minutes, 10);
  assert.equal(details.sandboxStandard2Minutes, 10);
  assert.equal(details.crawlPages, 5);
  assert.equal(details.artifactStorageGb, 2);
  assert.equal(details.estimatedRawCostUsd, 100);
  assert.equal(JSON.stringify(payload).includes("usr_"), false);
  assert.equal(env.DB.runs.some((run) => run.values.includes("tools.cloudflare_spend_anomaly_alert")), true);
  assert.equal(env.DB.operatorAlertClaims.size, 1);
});

test("hosted worker alerts on unexpected 500s without leaking user or query data", async () => {
  const env = fakeLiveEnv("hosted-5xx-token");
  env.VC_TOOLS_INTERNAL_ALERT_TOKEN = Buffer.from(new Uint8Array(32).fill(14)).toString("base64url");
  env.DB.failPrepare = true;
  const internalRequests: Request[] = [];
  env.VC_TOOLS_INTERNAL_API_WORKER = {
    async fetch(request: Request) {
      internalRequests.push(request);
      return new Response(JSON.stringify({ received: true, sent: true }), {
        headers: { "content-type": "application/json" }
      });
    }
  } as Fetcher;

  const pending: Promise<unknown>[] = [];
  const response = await worker.fetch(new Request("https://tools.vibecodr.space/v1/usage?token=query-secret", {
    headers: { authorization: "Bearer hosted-5xx-token" }
  }), env as never, testExecutionContext(pending));
  const body = await response.json() as Record<string, unknown>;
  await drainPendingWaitUntil(pending);

  assert.equal(response.status, 500);
  assert.equal(body.code, "server.error");
  assert.equal(internalRequests.length, 1);
  const payload = await internalRequests[0].clone().json() as Record<string, unknown>;
  assert.equal(payload.code, "E-VIBECODR-VC-TOOLS-HOSTED-WORKER-5XX");
  const details = payload.details as { scope?: string; surface?: string; method?: string; path?: string; status?: number; unit?: string; errorMessage?: string };
  assert.equal(details.scope, "account");
  assert.equal(details.surface, "hosted.worker_5xx");
  assert.equal(details.method, "GET");
  assert.equal(details.path, "/v1/usage");
  assert.equal(details.status, 500);
  assert.equal(details.unit, "failures");
  assert.equal(details.errorMessage, "simulated D1 prepare failure Bearer [REDACTED]");
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("usr_"), false);
  assert.equal(serialized.includes("hosted-5xx-token"), false);
  assert.equal(serialized.includes("query-secret"), false);
  assert.equal(serialized.includes("leaked-secret"), false);
});

test("hosted queue handler does not complete jobs cancelled during execution", async () => {
  const env = fakeLiveEnv("queue-cancel-token");
  env.DB.statusRows.push({ status: "running" }, { status: "cancel_requested" });
  const message = {
    id: "job_cancel_during_execution",
    capability: "artifact.get",
    input: { kind: "artifact", artifactId: "art_existing" },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_queue_cancel",
    planName: "Creator",
    retentionDays: 3,
    reservedCredits: 0,
    reservedBrowserSeconds: 0
  };

  await worker.queue?.({
    messages: [{ body: message }],
    queue: "vc-tools-jobs",
    retryAll() {},
    ackAll() {}
  } as MessageBatch, env as never, testExecutionContext());

  assert.equal(env.ARTIFACTS.puts.length, 1);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'completed'")), false);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("UPDATE jobs SET status = 'cancelled'")), true);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("tools.completed_after_cancel") || run.values.includes("tools.completed_after_cancel")), true);
});

test("hosted queue handler skips cancelled jobs before cost-bearing execution", async () => {
  const env = fakeLiveEnv("cancelled-token");
  env.DB.firstRows.push({ status: "cancel_requested", actor_id: "usr_cancelled", plan_name: "Creator" });
  const message = {
    id: "job_cancelled",
    capability: "browser.render_url",
    input: { kind: "browser", url: "https://example.com/", timeoutMs: 30000, output: "html" },
    enqueuedAt: new Date().toISOString(),
    actorId: "usr_cancelled",
    planName: "Creator",
    retentionDays: 7,
    reservedCredits: 1,
    reservedBrowserSeconds: 30
  };

  await worker.queue?.({
    messages: [{ body: message }],
    queue: "vc-tools-jobs",
    retryAll() {},
    ackAll() {}
  } as MessageBatch, env as never, testExecutionContext());

  assert.equal(env.ARTIFACTS.puts.length, 0);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("status = 'running'")), false);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("status = 'cancelled'")), true);
  assert.equal(env.DB.runs.some((run) => run.sql.includes("tools.skipped_cancelled") || run.values.includes("tools.skipped_cancelled")), true);
});

function authedEnv(token: string): typeof baseEnv & { VC_TOOLS_TOKEN_SHA256: string } {
  return {
    ...baseEnv,
    VC_TOOLS_TOKEN_SHA256: sha256(token)
  };
}

function liveAuthedEnv(token: string) {
  return {
    ...authedEnv(token),
    VC_TOOLS_PROVIDER_MODE: "live" as const
  };
}

function fakeLiveEnv(token: string) {
  return {
    ...liveAuthedEnv(token),
    DB: new FakeD1Database(),
    ARTIFACTS: new FakeR2Bucket(),
    JOB_QUEUE: new FakeQueue(),
    JOB_DLQ: new FakeQueue(),
    BROWSER: { fetch: async () => new Response(null) },
    BROWSER_AGENT_WORKFLOW: new FakeWorkflow(),
    Sandbox: {},
    ProSandbox: {}
  };
}

async function fetchWorker(url: string, env: Record<string, unknown>, init: RequestInit = {}) {
  const pending: Promise<unknown>[] = [];
  const ctx = testExecutionContext(pending);

  const response = await worker.fetch(new Request(url, init), env as never, ctx);
  const body = await response.json() as Record<string, unknown>;
  return {
    response,
    body,
    async drainWaitUntil() {
      await Promise.all(pending);
    }
  };
}

async function fetchWorkerText(url: string, env: Record<string, unknown>, init: RequestInit = {}) {
  const ctx = testExecutionContext();

  const response = await worker.fetch(new Request(url, init), env as never, ctx);
  const text = await response.text();
  return { response, text };
}

function testExecutionContext(pending: Promise<unknown>[] = []): ExecutionContext {
  return {
    waitUntil(promise) {
      pending.push(promise);
    },
    passThroughOnException() {
      throw new Error("vc-tools hosted worker must not use passThroughOnException");
    }
  };
}

type TestToolJobMessage = {
  id: string;
  capability: string;
  input: Record<string, unknown>;
  enqueuedAt: string;
  actorId: string;
  planName: string;
  retentionDays: number;
  reservedCredits: number;
  reservedBrowserSeconds: number;
  reservedSandboxSeconds: number;
  fairDelaySeconds?: number;
};

async function runBrowserAgentWorkflow(
  env: Record<string, unknown>,
  message: TestToolJobMessage,
  pending: Promise<unknown>[] = []
): Promise<Record<string, unknown>> {
  const workflow = new BrowserAgentTaskWorkflow(testExecutionContext(pending), env as never);
  return await workflow.run({
    payload: message as never,
    timestamp: new Date(),
    instanceId: message.id
  }, new FakeWorkflowStep() as never);
}

async function drainPendingWaitUntil(pending: Promise<unknown>[]): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    const before = pending.length;
    await Promise.allSettled(pending);
    if (pending.length === before) {
      return;
    }
  }
}

function mcpRequest(token: string, body: unknown): RequestInit {
  return {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function addDaysForTest(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

async function withPublicDns<T>(callback: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://cloudflare-dns.com/dns-query")) {
      return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: "93.184.216.34" }] }), {
        headers: { "content-type": "application/json" }
      });
    }
    if (init?.method === "HEAD") {
      return new Response(null, { status: 204 });
    }
    return originalFetch(input, init);
  };
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withMockBrowserSession<T>(
  callback: (state: {
    closed: number;
    launchOptions: Array<Record<string, unknown> | undefined>;
    navigations: string[];
    clicks: string[];
    typed: string[];
    scrolls: number[];
  }) => Promise<T>
): Promise<T> {
  const state = {
    closed: 0,
    launchOptions: [] as Array<Record<string, unknown> | undefined>,
    navigations: [] as string[],
    clicks: [] as string[],
    typed: [] as string[],
    scrolls: [] as number[]
  };
  let currentUrl = "https://example.com/";
  const page = {
    setDefaultNavigationTimeout(_ms: number) {},
    async setRequestInterception(_enabled: boolean) {},
    on(_event: string, _handler: unknown) {},
    async goto(url: string) {
      currentUrl = url;
      state.navigations.push(url);
    },
    url() {
      return currentUrl;
    },
    async click(selector: string) {
      state.clicks.push(selector);
    },
    async type(selector: string, text: string) {
      state.typed.push(`${selector}:${text}`);
    },
    async evaluate(_fn: unknown, arg?: unknown) {
      if (typeof arg === "number") {
        state.scrolls.push(arg);
      }
      return {
        title: "Example",
        finalUrl: currentUrl,
        text: "Example page text",
        links: [{ text: "Docs", href: "https://example.com/docs" }]
      };
    }
  };
  const puppeteerMock = puppeteer as unknown as {
    launch: (binding: unknown, options?: Record<string, unknown>) => Promise<{ newPage(): Promise<typeof page>; close(): Promise<void> }>;
  };
  const originalLaunch = puppeteerMock.launch;
  puppeteerMock.launch = async (_binding, options) => {
    state.launchOptions.push(options);
    return {
      async newPage() {
        return page;
      },
      async close() {
        state.closed += 1;
      }
    };
  };
  try {
    return await callback(state);
  } finally {
    puppeteerMock.launch = originalLaunch;
  }
}

async function withMockTimedOutBrowserSession<T>(
  callback: (state: {
    closed: number;
    launchOptions: Array<Record<string, unknown> | undefined>;
    defaultNavigationTimeouts: number[];
    gotoCalls: Array<{ url: string; timeout: number | undefined; waitUntil: unknown }>;
  }) => Promise<T>
): Promise<T> {
  const state = {
    closed: 0,
    launchOptions: [] as Array<Record<string, unknown> | undefined>,
    defaultNavigationTimeouts: [] as number[],
    gotoCalls: [] as Array<{ url: string; timeout: number | undefined; waitUntil: unknown }>
  };
  const page = {
    setDefaultNavigationTimeout(ms: number) {
      state.defaultNavigationTimeouts.push(ms);
    },
    async setRequestInterception(_enabled: boolean) {},
    on(_event: string, _handler: unknown) {},
    async goto(url: string, options?: Record<string, unknown>) {
      const timeout = typeof options?.timeout === "number" ? options.timeout : undefined;
      state.gotoCalls.push({ url, timeout, waitUntil: options?.waitUntil });
      throw new Error(`Navigation timeout of ${timeout ?? "unknown"} ms exceeded`);
    },
    url() {
      return "https://example.com/large";
    },
    async evaluate() {
      return {};
    }
  };
  const puppeteerMock = puppeteer as unknown as {
    launch: (binding: unknown, options?: Record<string, unknown>) => Promise<{ newPage(): Promise<typeof page>; close(): Promise<void> }>;
  };
  const originalLaunch = puppeteerMock.launch;
  puppeteerMock.launch = async (_binding, options) => {
    state.launchOptions.push(options);
    return {
      async newPage() {
        return page;
      },
      async close() {
        state.closed += 1;
      }
    };
  };
  try {
    return await callback(state);
  } finally {
    puppeteerMock.launch = originalLaunch;
  }
}

function signGrant(secret: string, payload: Record<string, unknown>): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify({
    iat: now,
    nbf: now - 5,
    jti: crypto.randomUUID(),
    grant_profile: "vc_tools",
    ...payload
  }));
  const signature = createHmac("sha256", hmacKey(secret)).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function signEs256Grant(payload: Record<string, unknown>, kid = TEST_CLI_PRIVATE_JWK.kid): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
  const body = base64Url(JSON.stringify({
    iat: now,
    nbf: now - 5,
    jti: crypto.randomUUID(),
    grant_profile: "vc_tools",
    ...payload
  }));
  const privateKey = createPrivateKey({ key: TEST_CLI_PRIVATE_JWK, format: "jwk" });
  const signature = signCrypto(
    "sha256",
    Buffer.from(`${header}.${body}`),
    { key: privateKey, dsaEncoding: "ieee-p1363" }
  ).toString("base64url");
  return `${header}.${body}.${signature}`;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function hmacKey(secret: string): string | Buffer {
  const decoded = Buffer.from(secret.replace(/=/g, ""), "base64url");
  return decoded.byteLength === 32 ? decoded : secret;
}

class FakeD1Database {
  runs: Array<{ sql: string; values: unknown[] }> = [];
  reads: Array<{ sql: string; values: unknown[] }> = [];
  artifactRows: Array<Record<string, unknown>> = [];
  firstRows: unknown[] = [];
  firstRowsByQuery: Array<{ sqlIncludes: string; valuesInclude?: unknown[]; row: unknown }> = [];
  allRows: unknown[][] = [];
  statusRows: unknown[] = [];
  runningCountRows: unknown[] = [];
  operatorAlertClaims = new Set<string>();
  operatorAlertSuppressions = 0;
  failPrepare = false;
  failJobInsert = false;
  jobInsertChanges: number[] = [];
  failArtifactInsert = false;

  prepare(sql: string) {
    if (this.failPrepare) {
      throw new Error("simulated D1 prepare failure Bearer leaked-secret");
    }
    return new FakeD1Statement(this, sql);
  }
}

class FakeD1Statement {
  private values: unknown[] = [];

  constructor(private readonly db: FakeD1Database, readonly sql: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first() {
    this.db.reads.push({ sql: this.sql, values: this.values });
    if (this.db.artifactRows.length > 0 && this.sql.includes("FROM artifacts WHERE id = ? AND actor_id = ?")) {
      const [id, actorId, now] = this.values;
      const row = this.db.artifactRows.find((candidate) => {
        if (candidate.id !== id || candidate.actor_id !== actorId) {
          return false;
        }
        if (!this.sql.includes("expires_at > ?")) {
          return true;
        }
        const expiresAt = candidate.expires_at;
        return expiresAt === null || expiresAt === undefined || String(expiresAt) > String(now);
      });
      return row ?? null;
    }
    if (this.sql.includes("COUNT(1)") && this.sql.includes("status = 'running'")) {
      const count = this.db.runningCountRows.shift();
      if (count !== undefined) {
        return count;
      }
    }
    const queryRowIndex = this.db.firstRowsByQuery.findIndex((candidate) => {
      if (!this.sql.includes(candidate.sqlIncludes)) {
        return false;
      }
      return candidate.valuesInclude?.every((value) => this.values.includes(value)) ?? true;
    });
    if (queryRowIndex >= 0) {
      const [queuedByQuery] = this.db.firstRowsByQuery.splice(queryRowIndex, 1);
      return queuedByQuery?.row ?? null;
    }
    const queued = this.db.firstRows.shift();
    if (queued !== undefined) {
      return queued;
    }
    if (this.sql.includes("SELECT status, actor_id, plan_name FROM jobs")) {
      return { status: "queued", actor_id: "usr_queue", plan_name: "Creator" };
    }
    if (this.sql.includes("SELECT status FROM jobs")) {
      const status = this.db.statusRows.shift();
      if (status !== undefined) {
        return status;
      }
      return { status: "running" };
    }
    if (this.sql.includes("COUNT(1)")) {
      return { count_value: 0 };
    }
    if (this.sql.includes("SUM(quantity)")) {
      return { quantity: 0 };
    }
    if (this.sql.includes("SUM(bytes)")) {
      return { bytes: 0 };
    }
    if (this.sql.includes("retention_policies")) {
      return { scope: "default", logs_days: 30, artifacts_days: 30, recordings: "off", updated_at: new Date().toISOString() };
    }
    return null;
  }

  async all() {
    this.db.reads.push({ sql: this.sql, values: this.values });
    if (this.db.artifactRows.length > 0 && this.sql.includes("FROM artifacts WHERE expires_at IS NOT NULL")) {
      const [now] = this.values;
      return {
        results: this.db.artifactRows.filter((row) => {
          const expiresAt = row.expires_at;
          return expiresAt !== null && expiresAt !== undefined && String(expiresAt) <= String(now);
        })
      };
    }
    if (this.db.artifactRows.length > 0 && this.sql.includes("FROM artifacts WHERE actor_id = ?")) {
      const [actorId, now, limitValue] = this.values;
      const limit = Number(limitValue ?? 50);
      return {
        results: this.db.artifactRows.filter((row) => {
          if (row.actor_id !== actorId) {
            return false;
          }
          const expiresAt = row.expires_at;
          return expiresAt === null || expiresAt === undefined || String(expiresAt) > String(now);
        }).slice(0, limit)
      };
    }
    if (this.sql.includes("scheduled_qa_configs")) {
      const queued = this.db.allRows.shift();
      if (queued !== undefined) {
        return { results: queued };
      }
    }
    return { results: [] };
  }

  async run() {
    this.db.runs.push({ sql: this.sql, values: this.values });
    if (this.sql.includes("INSERT INTO operator_alert_dedupe")) {
      const key = `${String(this.values[0])}:${String(this.values[1])}`;
      if (this.db.operatorAlertClaims.has(key)) {
        return { success: true, meta: { changes: 0 } };
      }
      this.db.operatorAlertClaims.add(key);
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.includes("UPDATE operator_alert_dedupe")) {
      this.db.operatorAlertSuppressions += 1;
      return { success: true, meta: { changes: 1 } };
    }
    if (this.sql.includes("INSERT INTO jobs")) {
      if (this.db.jobInsertChanges.length > 0) {
        return { success: true, meta: { changes: this.db.jobInsertChanges.shift() ?? 0 } };
      }
      if (this.db.failJobInsert) {
        return { success: true, meta: { changes: 0 } };
      }
    }
    if (this.db.failArtifactInsert && this.sql.includes("INSERT INTO artifacts")) {
      return { success: true, meta: { changes: 0 } };
    }
    return { success: true };
  }
}

class FakeR2Bucket {
  puts: Array<{ key: string; value: unknown; options: unknown }> = [];
  gets: string[] = [];
  deletes: string[] = [];
  deleteFailures = new Set<string>();

  async put(key: string, value: unknown, options: unknown) {
    this.puts.push({ key, value, options });
    return null;
  }

  async get(key: string) {
    this.gets.push(key);
    return null;
  }

  async delete(key: string) {
    if (this.deleteFailures.has(key)) {
      throw new Error("simulated R2 delete failure");
    }
    this.deletes.push(key);
  }
}

class FakeQueue {
  sent: unknown[] = [];
  options: unknown[] = [];
  metricsSnapshot = { backlogCount: 0, backlogBytes: 0 } satisfies QueueMetrics;

  async send(message: unknown, options?: unknown) {
    this.sent.push(message);
    this.options.push(options);
  }

  async metrics() {
    return this.metricsSnapshot;
  }
}

class FakeWorkflow {
  created: Array<{ options: { id?: string; params?: TestToolJobMessage; retention?: unknown } }> = [];

  async create(options: { id?: string; params?: TestToolJobMessage; retention?: unknown } = {}) {
    this.created.push({ options });
    return {
      id: options.id ?? `workflow_${this.created.length}`,
      async status() {
        return { status: "queued" };
      }
    };
  }
}

class FakeWorkflowStep {
  calls: Array<{ name: string; config?: unknown }> = [];

  async do(name: string, configOrCallback: unknown, callback?: unknown) {
    const actualCallback = typeof configOrCallback === "function" ? configOrCallback : callback;
    const config = typeof configOrCallback === "function" ? undefined : configOrCallback;
    this.calls.push({ name, config });
    if (typeof actualCallback !== "function") {
      throw new Error("FakeWorkflowStep.do requires a callback");
    }
    return await (actualCallback as (context: unknown) => Promise<unknown>)({
      step: { name, count: 1 },
      attempt: 1,
      config: config ?? {}
    });
  }
}
