// §14 output-baseline regression contract. Runs each vc-tools-side command
// through the mocked dispatcher (runWithMockApi from test/legacy/helpers.ts)
// with canonical mock responses, filters volatile fields the server stamps
// on every reply (requestId, traceId, timestamp, version, etc.), and
// asserts the resulting JSON matches a committed fixture under
// test/fixtures/output-baseline/ byte-for-byte after the filter.
//
// To deliberately re-derive the fixtures (e.g. after a documented adapter-
// shape change), set VIBECDR_REGENERATE_BASELINE_FIXTURES=1 and re-run the
// test; it writes the current output to disk instead of asserting. Commit
// the regenerated fixtures and the test resumes its drift-guard role.
//
// Scope: this version covers the read-only / dry-run command set that
// doesn't require device-code login or interactive prompts. Commands that
// need a live auth flow (start, login --credential, work follow live) are
// covered separately by cli.behavior.test.ts and live-smoke.smoke.ts; the
// baseline contract here is the subset useful as a JSON-shape drift guard.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { meRoute, runWithMockApi } from "./legacy/helpers.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "output-baseline");
const REGENERATE = process.env["VIBECDR_REGENERATE_BASELINE_FIXTURES"] === "1";

const VOLATILE_KEYS = new Set([
  "requestId",
  "traceId",
  "timestamp",
  "createdAt",
  "updatedAt",
  "version"
]);

function filterVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(filterVolatile);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = filterVolatile(sub);
    }
    return out;
  }
  return value;
}

interface BaselineCase {
  name: string;
  argv: string[];
  routes?: import("./legacy/helpers.js").MockRoute[];
  // Some commands need state seeded before the run (e.g. a stored credential).
  // The setup callback gets the config dir runWithMockApi creates and can
  // write files into it.
  configDir?: string;
}

async function assertOrWriteFixture(name: string, actual: unknown): Promise<void> {
  await mkdir(fixturesDir, { recursive: true });
  const fixturePath = path.join(fixturesDir, name);
  const serialized = JSON.stringify(actual, null, 2) + "\n";
  if (REGENERATE || !existsSync(fixturePath)) {
    await writeFile(fixturePath, serialized, "utf8");
    return;
  }
  const expected = await readFile(fixturePath, "utf8");
  assert.equal(serialized, expected, `output drift for ${name} -- re-run with VIBECDR_REGENERATE_BASELINE_FIXTURES=1 to update if the new shape is intentional`);
}

test("baseline: plans --json", async () => {
  const result = await runWithMockApi(["--json", "plans"]);
  try {
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-plans.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

test("baseline: plans --details --json", async () => {
  const result = await runWithMockApi(["--json", "plans", "--details"]);
  try {
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-plans-details.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

test("baseline: inspect --json (goal coverage)", async () => {
  const result = await runWithMockApi(["--json", "inspect"]);
  try {
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-inspect.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

test("baseline: dashboard --json", async () => {
  const result = await runWithMockApi(["--json", "dashboard"]);
  try {
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-dashboard.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

// doctor's output is mostly stable but the `node` and `config` checks
// include the running node version and the (random) tmp config-dir path
// runWithMockApi creates per-call. A check-name-aware filter erases the
// `detail` field for those two known cases so the rest of the shape (which
// checks ran + their ok flags + their stable-detail strings) stays in the
// regression contract.
function filterDoctorChecks(value: unknown): unknown {
  const filtered = filterVolatile(value) as { data?: { checks?: Array<Record<string, unknown>> } };
  const checks = filtered?.data?.checks;
  if (Array.isArray(checks)) {
    for (const check of checks) {
      const name = check["name"];
      if (name === "node" || name === "config") {
        check["detail"] = "<machine-specific; redacted in fixture>";
      }
    }
  }
  return filtered;
}

test("baseline: doctor --json (machine-specific detail strings redacted)", async () => {
  const result = await runWithMockApi(["--json", "doctor"], [
    {
      method: "GET",
      path: "/v1/health",
      response: {
        ok: true,
        service: "vc-tools-api",
        live: {
          configured: true,
          dnsPreflight: true,
          network: {
            browserPublicHttps: "available",
            computerPublicHttps: "available",
            privateLocalNetworks: "blocked",
            metadataServices: "blocked",
            rawNetwork: "restricted"
          }
        }
      }
    }
  ]);
  try {
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-doctor.json", filterDoctorChecks(payload));
  } finally {
    await result.cleanup();
  }
});

test("baseline: status --json (with mocked /v1/health, unauthenticated)", async () => {
  const result = await runWithMockApi(["--json", "status"], [
    { method: "GET", path: "/health", response: { ok: true, service: "vc-tools-api" } }
  ]);
  try {
    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    // The status payload's data.config block carries machine-specific values:
    //   - `dir`: the active config dir (a per-test tmpdir created by runWithMockApi)
    //   - `defaultDir`: os.homedir() + "/.vibecodr/tools" (per-user)
    //   - `defaultConfigExists`, `defaultCredentialsExist`: depend on whether the
    //     running user already has a ~/.vibecodr/tools tree from prior CLI runs
    // All four are zeroed before the fixture comparison so this test stays
    // byte-equal across developer machines and CI runners (the GitHub Actions
    // Windows runner uses `runneradmin` as its home, which a developer's local
    // capture would never produce).
    const REDACTED = "<machine-specific; redacted in fixture>";
    const filtered = filterVolatile(payload) as { data?: { config?: Record<string, unknown> } };
    if (filtered.data?.config) {
      const config = filtered.data.config;
      if ("dir" in config) config["dir"] = REDACTED;
      if ("defaultDir" in config) config["defaultDir"] = REDACTED;
      if ("defaultConfigExists" in config) config["defaultConfigExists"] = REDACTED;
      if ("defaultCredentialsExist" in config) config["defaultCredentialsExist"] = REDACTED;
    }
    await assertOrWriteFixture("vc-tools-status.json", filtered);
  } finally {
    await result.cleanup();
  }
});

test("baseline: work follow job_test --no-wait --json (mocked terminal job)", async () => {
  const token = "vct_test_grant_token_1234567890";
  const result = await runWithMockApi(
    ["--json", "--token", token, "work", "follow", "job_test", "--no-wait"],
    [
      {
        method: "GET",
        path: "/v1/jobs/job_test",
        response: {
          id: "job_test",
          status: "completed",
          capability: "browser.screenshot_url",
          result: { artifactId: "art_test_1234567890" }
        }
      }
    ]
  );
  try {
    assert.equal(result.code, 0, `work follow failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-work-follow.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

test("baseline: start --json (full device-code + handshake chain)", async () => {
  const grantToken = "vct_grant_baseline_1234567890";
  const apiKey = "ak_live_baseline_1234567890";
  const result = await runWithMockApi(
    ["--json", "start", "--client", "codex"],
    [
      {
        method: "POST",
        path: "/auth/vc-tools/device/start",
        response: {
          device_code: "vctd_baseline_device_secret_1234567890",
          user_code: "BASE-LINE",
          verification_uri: "https://vibecodr.space/settings/vc-tools/approve",
          verification_uri_complete: "https://vibecodr.space/settings/vc-tools/approve?vc_tools_code=BASE-LINE",
          expires_at: 1_900_000_000,
          interval: 0
        }
      },
      {
        method: "POST",
        path: "/auth/vc-tools/device/token",
        response: {
          token_type: "Bearer",
          access_token: grantToken,
          expires_at: 1_900_000_000,
          user_id: "user_baseline",
          credential_type: "browser_device",
          grant_profile: "vc_tools",
          scopes: ["vc-tools:use", "vc-tools:*"],
          durable_credential: {
            type: "api_key",
            id: "ak_baseline_device_1",
            name: "vc-tools Agent Computer",
            expires_at: 1_900_000_000,
            api_key: apiKey
          }
        }
      },
      meRoute(),
      { method: "GET", path: "/v1/health", response: { ok: true, service: "vc-tools-api" } },
      { method: "GET", path: "/v1/mcp/connection", response: { client: "codex", url: "https://tools.vibecodr.space/mcp" } },
      { method: "GET", path: "/v1/usage", response: { plan: "Pro" } }
    ],
    { env: { VC_TOOLS_BROWSER_OPEN: "false" } }
  );
  try {
    assert.equal(result.code, 0, `start failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    // The start payload echoes back the device code + verification URLs;
    // those are stable across mocked runs because the mock returns fixed
    // strings, so no extra filter beyond filterVolatile is needed.
    await assertOrWriteFixture("vc-tools-start.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

test("baseline: whoami --json (with mocked /v1/me + seeded credential)", async () => {
  const token = "vct_test_grant_token_1234567890";
  const result = await runWithMockApi(
    ["--json", "--token", token, "whoami"],
    [meRoute(), { method: "GET", path: "/v1/health", response: { ok: true, service: "vc-tools-api" } }]
  );
  try {
    assert.equal(result.code, 0, `whoami failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-whoami.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

test("baseline: usage --json (with mocked /v1/me + /v1/usage)", async () => {
  const token = "vct_test_grant_token_1234567890";
  const result = await runWithMockApi(
    ["--json", "--token", token, "usage"],
    [
      meRoute(),
      {
        method: "GET",
        path: "/v1/usage",
        response: {
          plan: "Pro",
          monthlyCredits: { total: 3000, used: 12, remaining: 2988 },
          dailyCredits: { total: 400, used: 4, remaining: 396 },
          concurrentRuns: { limit: 5, active: 0 }
        }
      }
    ]
  );
  try {
    assert.equal(result.code, 0, `usage failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-usage.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

test("baseline: connect --client codex --print --json", async () => {
  const token = "vct_test_grant_token_1234567890";
  const result = await runWithMockApi(
    ["--json", "--token", token, "connect", "--client", "codex", "--print"],
    [meRoute(), { method: "GET", path: "/v1/mcp/connection", response: { client: "codex", url: "https://tools.vibecodr.space/mcp" } }]
  );
  try {
    assert.equal(result.code, 0, `connect failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-connect-codex.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});

test("baseline: agent connect --client codex --print --json (legacy spelling)", async () => {
  const token = "vct_test_grant_token_1234567890";
  const result = await runWithMockApi(
    ["--json", "--token", token, "agent", "connect", "--client", "codex", "--print"],
    [meRoute(), { method: "GET", path: "/v1/mcp/connection", response: { client: "codex", url: "https://tools.vibecodr.space/mcp" } }]
  );
  try {
    assert.equal(result.code, 0, `agent connect failed:\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    await assertOrWriteFixture("vc-tools-agent-connect-codex.json", filterVolatile(payload));
  } finally {
    await result.cleanup();
  }
});
