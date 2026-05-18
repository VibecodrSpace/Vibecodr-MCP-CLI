// Pulse end-to-end smoke (plan §17). Gated behind VIBECDR_SMOKE_PULSE=1
// because it requires a CLI session authenticated against the staging MCP
// gateway. Skip mechanism: the test no-ops when the env var isn't set.
// Default `npm test` runs `test/**/*.test.ts` and doesn't pick up
// `.smoke.ts` files.
//
// Run manually (operator must have an active `vibecodr login` session):
//
//   VIBECDR_SMOKE_PULSE=1 node --import tsx --test test/pulse-e2e.smoke.ts
//
// Walks the full Pulse lifecycle: list -> setup -> create -> get -> status ->
// publish -> run -> archive -> restore. Spot-checks bin equivalence by
// running `pulse get <id>` through both `vibecodr` and `vibecodr-mcp` and
// asserting the JSON output matches after filtering volatile fields.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ENABLED = process.env["VIBECDR_SMOKE_PULSE"] === "1";

interface RunResult { code: number | null; stdout: string; stderr: string }

function run(args: string[], options: { binEntry?: string; timeoutMs?: number } = {}): Promise<RunResult> {
  const binEntry = options.binEntry ?? "src/bin/vibecodr-mcp.ts";
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["--import", "tsx", binEntry, ...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timeout = options.timeoutMs ? setTimeout(() => child.kill("SIGTERM"), options.timeoutMs) : undefined;
    child.on("error", reject);
    child.on("exit", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

interface JsonPayload<T> { ok: boolean; data?: T; error?: { code: string; message: string } }

function parsePayload<T>(stdout: string, label: string): JsonPayload<T> {
  try {
    return JSON.parse(stdout) as JsonPayload<T>;
  } catch (error) {
    throw new Error(`${label} did not return JSON.\nstdout:\n${stdout}\n${error instanceof Error ? error.message : String(error)}`);
  }
}

// Volatile-field filter so bin-equivalence comparisons aren't tripped by
// requestId / traceId / timestamps the server stamps on each response.
function filterVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(filterVolatile);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries(value as Record<string, unknown>)) {
      if (key === "requestId" || key === "traceId" || key === "timestamp" || key === "createdAt" || key === "updatedAt") continue;
      out[key] = filterVolatile(sub);
    }
    return out;
  }
  return value;
}

async function buildPulseFixtures(scratch: string): Promise<{ descriptorPath: string; codePath: string }> {
  const descriptorPath = path.join(scratch, "pulse-test-descriptor.json");
  const codePath = path.join(scratch, "pulse-test-code.js");
  const descriptor = {
    schemaVersion: 1,
    title: "smoke-pulse",
    tags: ["smoke", "auto-cleanup"],
    runtime: "node22",
    visibility: "private"
  };
  await writeFile(descriptorPath, JSON.stringify(descriptor, null, 2), "utf8");
  const code = `export default async function handler() {\n  return { ok: true };\n}\n`;
  await writeFile(codePath, code, "utf8");
  return { descriptorPath, codePath };
}

test("pulse smoke: list -> setup -> create -> get -> status -> publish -> run -> archive -> restore", { timeout: 600_000 }, async (t) => {
  if (!ENABLED) {
    t.skip("VIBECDR_SMOKE_PULSE != 1");
    return;
  }

  const scratch = await mkdtemp(path.join(os.tmpdir(), "vibecodr-pulse-smoke-"));
  let pulseId: string | undefined;
  try {
    const { descriptorPath, codePath } = await buildPulseFixtures(scratch);

    const initial = await run(["pulse", "list", "--json", "--non-interactive"], { timeoutMs: 30_000 });
    assert.equal(initial.code, 0, `pulse list failed:\n${initial.stderr}`);
    const initialPayload = parsePayload(initial.stdout, "pulse list");
    assert.equal(initialPayload.ok, true);

    const setup = await run(["pulse-setup", "--descriptor-setup-file", descriptorPath, "--json", "--non-interactive"], { timeoutMs: 60_000 });
    assert.equal(setup.code, 0, `pulse-setup failed:\n${setup.stderr}`);

    const create = await run(["pulse", "create", "--confirm", "--json", "--non-interactive"], { timeoutMs: 60_000 });
    assert.equal(create.code, 0, `pulse create failed:\n${create.stderr}`);
    const createPayload = parsePayload<{ id: string }>(create.stdout, "pulse create");
    pulseId = createPayload.data?.id;
    assert.ok(pulseId, "pulse create did not return an id");

    const get = await run(["pulse", "get", pulseId, "--json", "--non-interactive"], { timeoutMs: 30_000 });
    assert.equal(get.code, 0, `pulse get failed:\n${get.stderr}`);
    const getPayload = parsePayload<{ id: string }>(get.stdout, "pulse get");
    assert.equal(getPayload.data?.id, pulseId);

    const status = await run(["pulse", "status", pulseId, "--json", "--non-interactive"], { timeoutMs: 30_000 });
    assert.equal(status.code, 0, `pulse status failed:\n${status.stderr}`);
    const statusPayload = parsePayload<{ state: string }>(status.stdout, "pulse status");
    const validStates = ["draft", "ready", "active", "archived", "running"];
    assert.ok(validStates.includes(statusPayload.data?.state ?? ""), `pulse status returned unexpected state: ${statusPayload.data?.state}`);

    const publish = await run(["pulse-publish", "--name", pulseId, "--code-file", codePath, "--confirm", "--json", "--non-interactive"], { timeoutMs: 120_000 });
    assert.equal(publish.code, 0, `pulse-publish failed:\n${publish.stderr}`);
    const publishPayload = parsePayload(publish.stdout, "pulse-publish");
    assert.equal(publishPayload.ok, true);

    const runResult = await run(["pulse", "run", pulseId, "--json", "--non-interactive"], { timeoutMs: 60_000 });
    assert.equal(runResult.code, 0, `pulse run failed:\n${runResult.stderr}`);
    const runPayload = parsePayload<{ runId: string }>(runResult.stdout, "pulse run");
    assert.ok(runPayload.data?.runId, "pulse run did not return a runId");

    const archive = await run(["pulse", "archive", pulseId, "--confirm", "--json", "--non-interactive"], { timeoutMs: 30_000 });
    assert.equal(archive.code, 0, `pulse archive failed:\n${archive.stderr}`);
    const archivedStatus = parsePayload<{ state: string }>(
      (await run(["pulse", "status", pulseId, "--json", "--non-interactive"], { timeoutMs: 30_000 })).stdout,
      "pulse status (post-archive)"
    );
    assert.equal(archivedStatus.data?.state, "archived");

    const restore = await run(["pulse", "restore", pulseId, "--confirm", "--json", "--non-interactive"], { timeoutMs: 30_000 });
    assert.equal(restore.code, 0, `pulse restore failed:\n${restore.stderr}`);
    const restoredStatus = parsePayload<{ state: string }>(
      (await run(["pulse", "status", pulseId, "--json", "--non-interactive"], { timeoutMs: 30_000 })).stdout,
      "pulse status (post-restore)"
    );
    assert.notEqual(restoredStatus.data?.state, "archived");

    // Bin-equivalence: pulse get via the legacy vibecodr-mcp bin should produce
    // the same payload (modulo volatile fields).
    const viaLegacy = await run(["pulse", "get", pulseId, "--json", "--non-interactive"], {
      binEntry: "src/bin/vibecodr-mcp.ts",
      timeoutMs: 30_000
    });
    assert.equal(viaLegacy.code, 0);
    const viaLegacyPayload = parsePayload(viaLegacy.stdout, "pulse get (vibecodr-mcp)");
    const viaCanonical = parsePayload(
      (await run(["pulse", "get", pulseId, "--json", "--non-interactive"], { timeoutMs: 30_000 })).stdout,
      "pulse get (vibecodr)"
    );
    assert.deepEqual(filterVolatile(viaLegacyPayload), filterVolatile(viaCanonical));
  } finally {
    // Best-effort cleanup: archive the test pulse so it doesn't accumulate
    // in the staging account.
    if (pulseId) {
      await run(["pulse", "archive", pulseId, "--confirm", "--json", "--non-interactive"], { timeoutMs: 30_000 }).catch(() => undefined);
    }
    await rm(scratch, { recursive: true, force: true });
  }
});
