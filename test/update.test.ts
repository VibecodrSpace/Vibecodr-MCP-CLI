import test from "node:test";
import assert from "node:assert/strict";
import { compareVersions, runUpdateCommand } from "../src/commands/update.js";
import { Output, type JsonEnvelope } from "../src/cli/output.js";
import { ConfigStore } from "../src/storage/config-store.js";
import { SecretStore } from "../src/storage/secret-store.js";
import { TokenManager } from "../src/auth/token-manager.js";
import { McpRuntimeClient } from "../src/core/mcp-client.js";
import { CliError } from "../src/cli/errors.js";
import type { CommandContext } from "../src/commands/context.js";
import type { GlobalOptions } from "../src/types/config.js";

test("compareVersions handles patch, minor, major, and prerelease ordering", () => {
  assert.equal(compareVersions("1.0.2", "1.0.3"), -1);
  assert.equal(compareVersions("1.0.3", "1.0.2"), 1);
  assert.equal(compareVersions("1.0.3", "1.0.3"), 0);
  assert.equal(compareVersions("1.1.0", "1.0.99"), 1);
  assert.equal(compareVersions("2.0.0", "1.99.99"), 1);
  assert.equal(compareVersions("1.0.0-rc.0", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.0"), 1);
  assert.equal(compareVersions("1.0.0-rc.0", "1.0.0-rc.1"), -1);
});

class RecordingOutput extends Output {
  readonly envelopes: JsonEnvelope[] = [];
  readonly lines: string[] = [];
  readonly warnings: string[] = [];

  constructor(opts: GlobalOptions) {
    super(opts);
  }

  override write(value: string): void {
    this.lines.push(value);
  }

  override info(message: string): void {
    this.lines.push(message);
  }

  override warn(message: string): void {
    this.warnings.push(message);
  }

  override json(value: JsonEnvelope): void {
    this.envelopes.push(value);
  }

  override success(value: JsonEnvelope, humanLines: string[]): void {
    this.envelopes.push(value);
    for (const line of humanLines) this.lines.push(line);
  }
}

function buildContext(globalOptions: Partial<GlobalOptions>): { context: CommandContext; output: RecordingOutput } {
  const opts: GlobalOptions = {
    profile: "default",
    json: false,
    verbose: false,
    nonInteractive: false,
    ...globalOptions
  };
  const config = new ConfigStore();
  const secrets = new SecretStore();
  const output = new RecordingOutput(opts);
  return {
    output,
    context: {
      globalOptions: opts,
      output,
      configStore: config,
      secretStore: secrets,
      tokenManager: new TokenManager(config, secrets),
      runtimeClient: new McpRuntimeClient()
    }
  };
}

function withMockFetch(latestVersion: string, fn: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ version: latestVersion }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test("update --check reports already on latest when versions match", async () => {
  const { context, output } = buildContext({ json: true });
  const { readFile } = await import("node:fs/promises");
  const installed = (JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  ) as { version: string }).version;
  await withMockFetch(installed, async () => {
    await runUpdateCommand(["--check"], context);
  });
  assert.equal(output.envelopes.length, 1);
  const envelope = output.envelopes[0] as JsonEnvelope & {
    ok: boolean;
    upToDate: boolean;
    current: string;
    latest: string;
  };
  assert.equal(envelope.ok, true);
  assert.equal(envelope.upToDate, true);
  assert.equal(envelope.current, installed);
  assert.equal(envelope.latest, installed);
});

test("update --check reports an available upgrade without spawning", async () => {
  const { context, output } = buildContext({ json: true });
  await withMockFetch("99.99.99", async () => {
    await runUpdateCommand(["--check"], context);
  });
  assert.equal(output.envelopes.length, 1);
  const envelope = output.envelopes[0] as JsonEnvelope & { upToDate: boolean; latest: string };
  assert.equal(envelope.upToDate, false);
  assert.equal(envelope.latest, "99.99.99");
});

test("update rejects unsupported --via value before doing any work", async () => {
  const { context } = buildContext({ json: true, nonInteractive: true });
  await withMockFetch("99.99.99", async () => {
    await assert.rejects(async () => {
      await runUpdateCommand(["--yes", "--via", "snap"], context);
    }, (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.machineCode, "update.unsupported_manager");
      return true;
    });
  });
});

test("update refuses to run from the source repo checkout", async () => {
  const { context } = buildContext({ json: true, nonInteractive: true });
  await withMockFetch("99.99.99", async () => {
    await assert.rejects(async () => {
      await runUpdateCommand(["--yes"], context);
    }, (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.machineCode, "update.source_install");
      return true;
    });
  });
});

test("update --help prints usage and returns without fetching", async () => {
  const { context } = buildContext({});
  let fetchCalled = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  try {
    await runUpdateCommand(["--help"], context);
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(fetchCalled, false);
});
