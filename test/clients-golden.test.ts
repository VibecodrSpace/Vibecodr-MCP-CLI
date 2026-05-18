import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { installCodex } from "../src/clients/codex.js";
import { installCursor } from "../src/clients/cursor.js";
import { installVsCode } from "../src/clients/vscode.js";
import { installWindsurf } from "../src/clients/windsurf.js";
import { installClaudeDesktop } from "../src/clients/claude-desktop.js";
import { installClaudeCode } from "../src/clients/claude-code.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "clients-golden");
const FIXTURE_SERVER_URL = "https://example.test/mcp";
const FIXTURE_SERVER_NAME = "test-server";

async function withScratchDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibecodr-clients-golden-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readGolden(name: string): Promise<string> {
  return await readFile(path.join(fixturesDir, name), "utf8");
}

test("cursor install writes the exact mcpServers.url shape Cursor expects", async () => {
  await withScratchDir(async (dir) => {
    const result = await installCursor({
      serverUrl: FIXTURE_SERVER_URL,
      name: FIXTURE_SERVER_NAME,
      scope: "user",
      path: path.join(dir, ".cursor")
    });
    const actual = await readFile(result.location, "utf8");
    const expected = await readGolden("cursor.mcp.json");
    assert.equal(actual, expected);
  });
});

test("windsurf install writes the exact mcpServers.serverUrl shape Windsurf expects", async () => {
  await withScratchDir(async (dir) => {
    const result = await installWindsurf({
      serverUrl: FIXTURE_SERVER_URL,
      name: FIXTURE_SERVER_NAME,
      scope: "user",
      path: dir
    });
    const actual = await readFile(result.location, "utf8");
    const expected = await readGolden("windsurf.mcp_config.json");
    assert.equal(actual, expected);
  });
});

test("vscode install (workspace scope) writes the exact servers.type|url shape VS Code expects", async () => {
  await withScratchDir(async (dir) => {
    const result = await installVsCode({
      serverUrl: FIXTURE_SERVER_URL,
      name: FIXTURE_SERVER_NAME,
      scope: "project",
      path: dir
    });
    const actual = await readFile(result.location, "utf8");
    const expected = await readGolden("vscode.workspace.mcp.json");
    assert.equal(actual, expected);
  });
});

test("claude-desktop install writes the exact npx + mcp-remote stdio-proxy shape", async () => {
  await withScratchDir(async (dir) => {
    const result = await installClaudeDesktop({
      serverUrl: FIXTURE_SERVER_URL,
      name: FIXTURE_SERVER_NAME,
      scope: "user",
      path: dir
    });
    const actual = await readFile(result.location, "utf8");
    const expected = await readGolden("claude-desktop.config.json");
    assert.equal(actual, expected);
  });
});

test("codex install (file-path fallback) writes the exact TOML mcp_servers section", async () => {
  await withScratchDir(async (dir) => {
    // Pass path to force the file-write path (skips the `codex mcp add` CLI shim).
    const result = await installCodex({
      serverUrl: FIXTURE_SERVER_URL,
      name: FIXTURE_SERVER_NAME,
      scope: "user",
      path: dir
    });
    const actual = await readFile(result.location, "utf8");
    const expected = await readGolden("codex.config.toml");
    assert.equal(actual, expected);
  });
});

test("claude-code dry-run emits the exact spawn signature for `claude mcp add`", async () => {
  const result = await installClaudeCode({
    serverUrl: FIXTURE_SERVER_URL,
    name: FIXTURE_SERVER_NAME,
    scope: "user",
    dryRun: true
  });
  assert.ok(result.spawn, "expected dry-run to surface the spawn signature");
  const expected = JSON.parse(await readGolden("claude-code.spawn.json"));
  assert.deepEqual(result.spawn, expected);
});
