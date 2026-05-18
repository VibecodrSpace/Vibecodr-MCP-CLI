import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { __resetMigrationStateForTests, migrateLegacyDirsOnce } from "../src/storage/migrate.js";

async function withScratch<T>(fn: (scratch: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibecodr-migrate-"));
  __resetMigrationStateForTests();
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function seedLegacyDir(root: string, files: Record<string, string>): Promise<void> {
  await mkdir(root, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(root, relPath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, { encoding: "utf8" });
  }
}

test("migrateLegacyDirsOnce copies an existing vc-tools legacy dir into the canonical tools/ tree and renames the legacy root to .bak", async () => {
  await withScratch(async (scratch) => {
    const legacyVc = path.join(scratch, "legacy-vc");
    const canonicalTools = path.join(scratch, "tools-canonical");
    const canonicalMcp = path.join(scratch, "mcp-canonical");
    await seedLegacyDir(legacyVc, {
      "config.json": JSON.stringify({ version: 1, selectedProfile: "default", profiles: { default: { apiUrl: "https://tools.vibecodr.space" } } }),
      "credentials.json": "encrypted-blob"
    });

    await migrateLegacyDirsOnce({
      toolsHome: canonicalTools,
      mcpHome: canonicalMcp,
      vcToolsLegacyRoots: [legacyVc],
      mcpLegacyRoots: []
    });

    assert.equal(existsSync(canonicalTools), true);
    assert.equal(existsSync(legacyVc), false, "legacy root should be renamed");
    assert.equal(existsSync(`${legacyVc}.bak`), true);
    const movedConfig = JSON.parse(await readFile(path.join(canonicalTools, "config.json"), "utf8"));
    assert.equal(movedConfig.selectedProfile, "default");
    const movedCreds = await readFile(path.join(canonicalTools, "credentials.json"), "utf8");
    assert.equal(movedCreds, "encrypted-blob");
  });
});

test("migrateLegacyDirsOnce copies an existing MCP-CLI legacy dir into the canonical mcp/ tree and renames the legacy root to .bak", async () => {
  await withScratch(async (scratch) => {
    const legacyMcp = path.join(scratch, "legacy-mcp");
    const canonicalMcp = path.join(scratch, "mcp-canonical");
    await seedLegacyDir(legacyMcp, {
      "config.json": JSON.stringify({ version: 1, currentProfile: "default", profiles: {} }),
      "installs.json": JSON.stringify({ version: 1, installs: [] }),
      "secrets/default.json": JSON.stringify({ version: 1, iv: "x", tag: "y", ciphertext: "z" })
    });

    await migrateLegacyDirsOnce({
      toolsHome: path.join(scratch, "tools-canonical"),
      mcpHome: canonicalMcp,
      vcToolsLegacyRoots: [],
      mcpLegacyRoots: [legacyMcp]
    });

    assert.equal(existsSync(canonicalMcp), true);
    assert.equal(existsSync(legacyMcp), false);
    assert.equal(existsSync(`${legacyMcp}.bak`), true);
    assert.equal(existsSync(path.join(canonicalMcp, "installs.json")), true);
    assert.equal(existsSync(path.join(canonicalMcp, "secrets/default.json")), true);
  });
});

test("migrateLegacyDirsOnce is idempotent: a second call with canonical already present is a no-op", async () => {
  await withScratch(async (scratch) => {
    const legacyVc = path.join(scratch, "legacy-vc");
    const canonicalTools = path.join(scratch, "tools-canonical");
    await seedLegacyDir(legacyVc, { "config.json": "{}" });

    // First call: copies + renames.
    await migrateLegacyDirsOnce({
      toolsHome: canonicalTools,
      mcpHome: path.join(scratch, "mcp-canonical"),
      vcToolsLegacyRoots: [legacyVc],
      mcpLegacyRoots: []
    });
    assert.equal(existsSync(canonicalTools), true);
    assert.equal(existsSync(`${legacyVc}.bak`), true);

    // Seed a NEW legacy dir at the same path; second call must not touch the
    // canonical destination (idempotent skip).
    await seedLegacyDir(legacyVc, { "config.json": JSON.stringify({ changed: true }) });
    await migrateLegacyDirsOnce({
      toolsHome: canonicalTools,
      mcpHome: path.join(scratch, "mcp-canonical"),
      vcToolsLegacyRoots: [legacyVc],
      mcpLegacyRoots: []
    });
    // Canonical still has the ORIGINAL config (not the second seed).
    const canonicalConfig = await readFile(path.join(canonicalTools, "config.json"), "utf8");
    assert.equal(canonicalConfig, "{}");
    // Newly-seeded legacy dir is untouched (no second rename).
    assert.equal(existsSync(legacyVc), true);
  });
});

test("migrateLegacyDirsOnce is a no-op when no legacy dirs exist", async () => {
  await withScratch(async (scratch) => {
    const canonicalTools = path.join(scratch, "tools-canonical");
    const canonicalMcp = path.join(scratch, "mcp-canonical");
    await migrateLegacyDirsOnce({
      toolsHome: canonicalTools,
      mcpHome: canonicalMcp,
      vcToolsLegacyRoots: [path.join(scratch, "missing-vc")],
      mcpLegacyRoots: [path.join(scratch, "missing-mcp")]
    });
    assert.equal(existsSync(canonicalTools), false);
    assert.equal(existsSync(canonicalMcp), false);
  });
});

test("migrateLegacyDirsOnce uses a unique .bak suffix when a .bak already exists", async () => {
  await withScratch(async (scratch) => {
    const legacyVc = path.join(scratch, "legacy-vc");
    await seedLegacyDir(legacyVc, { "config.json": "{}" });
    // Pre-seed a stale .bak directory.
    await seedLegacyDir(`${legacyVc}.bak`, { "old-config.json": "stale" });

    await migrateLegacyDirsOnce({
      toolsHome: path.join(scratch, "tools-canonical"),
      mcpHome: path.join(scratch, "mcp-canonical"),
      vcToolsLegacyRoots: [legacyVc],
      mcpLegacyRoots: []
    });

    // Stale .bak preserved; new backup got a .bak.1 suffix.
    assert.equal(existsSync(`${legacyVc}.bak`), true);
    assert.equal(existsSync(`${legacyVc}.bak.1`), true);
    const staleContent = await readFile(path.join(`${legacyVc}.bak`, "old-config.json"), "utf8");
    assert.equal(staleContent, "stale");
  });
});

test("migrateLegacyDirsOnce migrates both vc-tools and MCP-CLI in the same call", async () => {
  await withScratch(async (scratch) => {
    const legacyVc = path.join(scratch, "legacy-vc");
    const legacyMcp = path.join(scratch, "legacy-mcp");
    const canonicalTools = path.join(scratch, "tools-canonical");
    const canonicalMcp = path.join(scratch, "mcp-canonical");
    await seedLegacyDir(legacyVc, { "config.json": "{\"selectedProfile\":\"default\"}" });
    await seedLegacyDir(legacyMcp, { "config.json": "{\"currentProfile\":\"default\"}" });

    await migrateLegacyDirsOnce({
      toolsHome: canonicalTools,
      mcpHome: canonicalMcp,
      vcToolsLegacyRoots: [legacyVc],
      mcpLegacyRoots: [legacyMcp]
    });

    assert.equal(existsSync(canonicalTools), true);
    assert.equal(existsSync(canonicalMcp), true);
    const vcCfg = await readFile(path.join(canonicalTools, "config.json"), "utf8");
    const mcpCfg = await readFile(path.join(canonicalMcp, "config.json"), "utf8");
    assert.match(vcCfg, /selectedProfile/);
    assert.match(mcpCfg, /currentProfile/);
  });
});
