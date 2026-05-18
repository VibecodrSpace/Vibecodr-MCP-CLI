// One-off script: run each client adapter against a tmpdir with the fixture
// inputs and dump the produced file (or spawn JSON for claude-code) into this
// directory. Used to seed the clients-golden fixtures on a clean checkout.
// Re-run after a deliberate adapter shape change; otherwise the test guards
// against drift.
//
// Usage: node test/fixtures/clients-golden/__capture.mjs
//   (must be run AFTER `npm run build` so dist/ exists)

import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installCodex } from "../../../dist/clients/codex.js";
import { installCursor } from "../../../dist/clients/cursor.js";
import { installVsCode } from "../../../dist/clients/vscode.js";
import { installWindsurf } from "../../../dist/clients/windsurf.js";
import { installClaudeDesktop } from "../../../dist/clients/claude-desktop.js";
import { installClaudeCode } from "../../../dist/clients/claude-code.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER_URL = "https://example.test/mcp";
const NAME = "test-server";

async function capture(label, adapter, options, fixtureName) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `vibecodr-golden-capture-${label}-`));
  try {
    const result = await adapter({
      serverUrl: SERVER_URL,
      name: NAME,
      scope: "user",
      ...options(dir)
    });
    if (fixtureName.endsWith(".spawn.json")) {
      await writeFile(path.join(here, fixtureName), JSON.stringify(result.spawn, null, 0));
      console.log(`captured spawn -> ${fixtureName}`);
    } else {
      await copyFile(result.location, path.join(here, fixtureName));
      console.log(`captured file -> ${fixtureName} from ${result.location}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

await capture("cursor", installCursor, (dir) => ({ path: path.join(dir, ".cursor") }), "cursor.mcp.json");
await capture("windsurf", installWindsurf, (dir) => ({ path: dir }), "windsurf.mcp_config.json");
await capture("vscode", installVsCode, (dir) => ({ scope: "project", path: dir }), "vscode.workspace.mcp.json");
await capture("claude-desktop", installClaudeDesktop, (dir) => ({ path: dir }), "claude-desktop.config.json");
await capture("codex", installCodex, (dir) => ({ path: dir }), "codex.config.toml");
await capture("claude-code", installClaudeCode, () => ({ dryRun: true }), "claude-code.spawn.json");
