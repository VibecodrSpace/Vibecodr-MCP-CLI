// §14 output-baseline contract for the MCP-gateway-side commands that the
// vc-tools runWithMockApi pattern can't drive: `vibecodr mcp tools --json` (talks
// to the MCP gateway via runtimeClient.listTools) and `vibecodr install
// codex --path <tmp> --dry-run --json` (file-write adapter under
// tokenManager-resolved serverUrl). Each test stubs the runtimeClient or
// tokenManager directly, intercepts stdout, filters volatile fields, and
// asserts against a committed fixture under test/fixtures/output-baseline/.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInstallCommand } from "../src/commands/install.js";
import { runToolsCommand } from "../src/commands/tools.js";
import { Output } from "../src/cli/output.js";

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

function captureStdout(): { restore(): void; collected(): string } {
  const writes: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  return {
    restore() { process.stdout.write = original; },
    collected() { return writes.join(""); }
  };
}

test("baseline (MCP): vibecodr mcp tools --json (mocked runtimeClient.listTools)", async () => {
  const capture = captureStdout();
  const globals = { profile: "default", json: true, verbose: false, nonInteractive: true };
  const FIXED_TOOLS = [
    {
      name: "get_vibecodr_platform_overview",
      description: "Return a structured overview of the Vibecodr platform surface.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
    },
    {
      name: "quick_publish_creation",
      description: "Publish a small piece of source as a runnable Vibecodr creation.",
      inputSchema: {
        type: "object",
        properties: { payload: { type: "object" } },
        required: ["payload"]
      }
    }
  ];
  try {
    await runToolsCommand(["--no-login"], {
      globalOptions: globals,
      output: new Output(globals),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {
        resolveProfile: async () => ({ profileName: "default", serverUrl: "https://openai.vibecodr.space/mcp" }),
        getSession: async () => ({ accessToken: "mocked-access-token-1234567890" })
      } as never,
      runtimeClient: {
        listTools: async () => FIXED_TOOLS
      } as never
    });
  } finally {
    capture.restore();
  }
  const payload = JSON.parse(capture.collected());
  await assertOrWriteFixture("vibecodr-tools.json", filterVolatile(payload));
});

test("baseline (MCP): vibecodr install codex --path <tmp> --dry-run --json", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "vibecodr-install-baseline-"));
  try {
    const capture = captureStdout();
    const globals = { profile: "default", json: true, verbose: false, nonInteractive: true };
    try {
      await runInstallCommand(["codex", "--path", tmp, "--dry-run"], {
        globalOptions: globals,
        output: new Output(globals),
        configStore: {} as never,
        secretStore: {} as never,
        tokenManager: {
          resolveProfile: async () => ({ profileName: "default", serverUrl: "https://openai.vibecodr.space/mcp" }),
          getSession: async () => undefined
        } as never,
        runtimeClient: {} as never
      });
    } finally {
      capture.restore();
    }
    const payload = JSON.parse(capture.collected()) as { location?: string };
    // The MCP-CLI install command emits a flat JSON envelope (schemaVersion
    // + the installer-result fields at the top level); the `location` field
    // carries the tmpdir path. Replace it with a stable placeholder so the
    // fixture stays cross-machine.
    if (typeof payload.location === "string" && payload.location.startsWith(tmp)) {
      // Replace the tmpdir prefix with a placeholder AND normalize backslashes
      // to forward slashes so the fixture stays byte-equal on Windows and POSIX.
      payload.location = payload.location.replace(tmp, "<tmpdir>").replace(/\\/g, "/");
    }
    await assertOrWriteFixture("vibecodr-install-codex.json", filterVolatile(payload));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("install refuses hosted Agent Computer URLs because clients need gateway OAuth", async () => {
  const globals = { profile: "default", json: true, verbose: false, nonInteractive: true };
  await assert.rejects(
    runInstallCommand(["codex", "--dry-run"], {
      globalOptions: globals,
      output: new Output(globals),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {
        resolveProfile: async () => ({ profileName: "agent-computer", serverUrl: "https://tools.vibecodr.space/mcp" }),
        getSession: async () => undefined
      } as never,
      runtimeClient: {} as never
    }),
    /tools\.vibecodr\.space\/mcp/
  );
});
