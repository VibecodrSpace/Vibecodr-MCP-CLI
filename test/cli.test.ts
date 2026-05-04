import test from "node:test";
import assert from "node:assert/strict";
import { parseGlobalOptions } from "../src/cli/parse.js";
import { summarizeToolSchema, renderToolResult } from "../src/core/renderers.js";
import { OFFICIAL_CLIENT_METADATA_URL, OFFICIAL_SERVER_URL, officialClientInformation } from "../src/auth/official-client.js";
import { runCallCommand } from "../src/commands/call.js";
import { runLoginCommand } from "../src/commands/login.js";
import { runPulseSetupCommand } from "../src/commands/pulse-setup.js";
import { runPulsePublishCommand } from "../src/commands/pulse-publish.js";
import { runPulseCommand } from "../src/commands/pulse.js";
import { Output } from "../src/cli/output.js";
import { CliError, EXIT_CODES } from "../src/cli/errors.js";

test("parseGlobalOptions extracts shared flags around a command", () => {
  const parsed = parseGlobalOptions([
    "--profile",
    "staging",
    "tools",
    "--json"
  ]);
  assert.equal(parsed.command, "tools");
  assert.equal(parsed.globalOptions.profile, "staging");
  assert.equal(parsed.globalOptions.json, true);
  assert.equal(Object.hasOwn(parsed.globalOptions, "serverUrl"), false);
});

test("parseGlobalOptions keeps root help and version aliases as commands", () => {
  assert.equal(parseGlobalOptions(["--help"]).command, "--help");
  assert.equal(parseGlobalOptions(["-h"]).command, "-h");
  assert.equal(parseGlobalOptions(["-help"]).command, "-help");
  assert.equal(parseGlobalOptions(["--version"]).command, "--version");
  assert.equal(parseGlobalOptions(["-v"]).command, "-v");
  assert.equal(parseGlobalOptions(["-version"]).command, "-version");
});

test("parseGlobalOptions rejects global server-url overrides so stored tokens cannot be redirected", () => {
  assert.throws(
    () => parseGlobalOptions(["--server-url", "https://attacker.example/mcp", "tools"]),
    (error: unknown) =>
      error instanceof CliError &&
      error.machineCode === "usage.unknown_global_flag" &&
      /config profile create/.test(error.nextStep || "")
  );
});

test("summarizeToolSchema builds required and optional fields", () => {
  const summary = summarizeToolSchema({
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string" },
      published: { type: "boolean" },
      retries: { type: "number" }
    }
  });
  assert.deepEqual(summary.required, ["title"]);
  assert.deepEqual(summary.optional, ["published", "retries"]);
  assert.deepEqual(summary.skeleton, {
    title: "",
    published: false,
    retries: 0
  });
});

test("renderToolResult prefers text content when present", () => {
  const rendered = renderToolResult({
    content: [
      { type: "text", text: "Hello from a tool." }
    ],
    structuredContent: {
      ignored: true
    }
  });
  assert.equal(rendered, "Hello from a tool.");
});

test("call command forwards nested direct_files paths without pre-encoding them and redacts output arguments", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  const input = {
    sourceType: "codex_v1",
    confirmed: true,
    payload: {
      title: "Nested Path Probe",
      entry: "src/main.tsx",
      importMode: "direct_files",
      files: [
        { path: "src/main.tsx", content: "console.log('ok');" },
        { path: "src/server/binding-proof.js", content: "export default {};" }
      ]
    }
  };

  try {
    await runCallCommand(["quick_publish_creation", "--input-json", JSON.stringify(input), "--confirm"], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      }),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {
        resolveProfile: async () => ({ profileName: "default", serverUrl: "https://example.test/mcp" }),
        getSession: async () => ({ accessToken: "token-1" })
      } as never,
      runtimeClient: {
        callTool: async (_serverUrl: string, _accessToken: string | undefined, name: string, actualInput: Record<string, unknown>) => {
          assert.equal(name, "quick_publish_creation");
          assert.deepEqual(actualInput, input);
          assert.doesNotMatch(JSON.stringify(actualInput), /src%2F/i);
          return { structuredContent: { ok: true } };
        }
      } as never
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const parsed = JSON.parse(writes.join(""));
  assert.equal(parsed.tool, "quick_publish_creation");
  assert.deepEqual(parsed.arguments.payload.files.map((file: { path: string }) => file.path), [
    "src/main.tsx",
    "src/server/binding-proof.js"
  ]);
  assert.equal(parsed.arguments.payload.files[0].content, "[redacted]");
  assert.equal(parsed.arguments.payload.files[1].content, "[redacted]");
  assert.doesNotMatch(JSON.stringify(parsed.arguments), /console\.log|export default/);
});

test("call command redacts known secret-bearing arguments in json output", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  const input = {
    token: "tok_live_secret",
    Authorization: "Bearer private",
    nested: {
      OPENAI_API_KEY: "sk-private",
      harmless: "kept"
    }
  };

  try {
    await runCallCommand(["configure_secret", "--input-json", JSON.stringify(input)], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      }),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {
        resolveProfile: async () => ({ profileName: "default", serverUrl: "https://example.test/mcp" }),
        getSession: async () => ({ accessToken: "token-1" })
      } as never,
      runtimeClient: {
        callTool: async (_serverUrl: string, _accessToken: string | undefined, _name: string, actualInput: Record<string, unknown>) => {
          assert.deepEqual(actualInput, input);
          return { structuredContent: { ok: true } };
        }
      } as never
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const parsed = JSON.parse(writes.join(""));
  assert.equal(parsed.arguments.token, "[redacted]");
  assert.equal(parsed.arguments.Authorization, "[redacted]");
  assert.equal(parsed.arguments.nested.OPENAI_API_KEY, "[redacted]");
  assert.equal(parsed.arguments.nested.harmless, "kept");
  assert.doesNotMatch(JSON.stringify(parsed), /tok_live_secret|Bearer private|sk-private/);
});

test("call command redacts known secret-bearing tool results in json output", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await runCallCommand(["inspect_secret", "--input-json", "{}"], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      }),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {
        resolveProfile: async () => ({ profileName: "default", serverUrl: "https://example.test/mcp" }),
        getSession: async () => ({ accessToken: "token-1" })
      } as never,
      runtimeClient: {
        callTool: async () => ({
          content: [{ type: "text", text: "token: tok_private" }],
          structuredContent: {
            token: "tok_private",
            code: "export default {}",
            safe: "kept"
          }
        })
      } as never
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const parsed = JSON.parse(writes.join(""));
  assert.equal(parsed.result.structuredContent.token, "[redacted]");
  assert.equal(parsed.result.structuredContent.code, "[redacted]");
  assert.equal(parsed.result.structuredContent.safe, "kept");
  assert.equal(parsed.result.content, "[redacted]");
  assert.doesNotMatch(JSON.stringify(parsed), /tok_private|export default/);
});

test("call command requires explicit confirmation for known mutating tools", async () => {
  await assert.rejects(
    async () => runCallCommand(["archive_pulse", "--input-json", JSON.stringify({ pulseId: "pls_123" })], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      }),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {} as never,
      runtimeClient: {} as never
    }),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.machineCode, "usage.confirmation_required");
      return true;
    }
  );
});

test("pulse list command calls the lifecycle MCP tool with bounded pagination", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await runPulseCommand(["list", "--limit", "50", "--offset", "2"], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      }),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {
        resolveProfile: async () => ({ profileName: "default", serverUrl: "https://example.test/mcp" }),
        getSession: async () => ({ accessToken: "token-1" })
      } as never,
      runtimeClient: {
        callTool: async (_serverUrl: string, _accessToken: string | undefined, name: string, input: Record<string, unknown>) => {
          assert.equal(name, "list_pulses");
          assert.deepEqual(input, { limit: 25, offset: 2 });
          return { structuredContent: { pulses: [{ pulseId: "pls_1", name: "One" }] } };
        }
      } as never
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const parsed = JSON.parse(writes.join(""));
  assert.equal(parsed.tool, "list_pulses");
  assert.deepEqual(parsed.arguments, { limit: 25, offset: 2 });
});

test("pulse archive command requires explicit confirmation", async () => {
  await assert.rejects(
    async () => runPulseCommand(["archive", "pls_123"], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      }),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {} as never,
      runtimeClient: {} as never
    }),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.machineCode, "usage.confirmation_required");
      return true;
    }
  );
});

test("pulse run command forwards input without echoing secrets", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  const input = { request: { token: "secret", value: "kept" } };

  try {
    await runPulseCommand(["run", "pls_123", "--input-json", JSON.stringify(input), "--confirm"], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      }),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {
        resolveProfile: async () => ({ profileName: "default", serverUrl: "https://example.test/mcp" }),
        getSession: async () => ({ accessToken: "token-1" })
      } as never,
      runtimeClient: {
        callTool: async (_serverUrl: string, _accessToken: string | undefined, name: string, actualInput: Record<string, unknown>) => {
          assert.equal(name, "run_pulse");
          assert.deepEqual(actualInput, { pulseId: "pls_123", input, confirmed: true });
          return { structuredContent: { ok: true } };
        }
      } as never
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const parsed = JSON.parse(writes.join(""));
  assert.equal(parsed.tool, "run_pulse");
  assert.equal(parsed.arguments.input.request.token, "[redacted]");
  assert.equal(parsed.arguments.input.request.value, "kept");
  assert.doesNotMatch(JSON.stringify(parsed), /secret/);
});

test("call command does not send a stored token when the profile server changed", async () => {
  await runCallCommand(["get_account_capabilities"], {
    globalOptions: {
      profile: "default",
      json: true,
      verbose: false,
      nonInteractive: true
    },
    output: new Output({
      profile: "default",
      json: true,
      verbose: false,
      nonInteractive: true
    }),
    configStore: {} as never,
    secretStore: {} as never,
    tokenManager: {
      resolveProfile: async () => ({ profileName: "default", serverUrl: "https://new.example/mcp" }),
      getSession: async (_profileName: string, serverUrl?: string) => {
        assert.equal(serverUrl, "https://new.example/mcp");
        return undefined;
      }
    } as never,
    runtimeClient: {
      callTool: async (serverUrl: string, accessToken: string | undefined, name: string) => {
        assert.equal(serverUrl, "https://new.example/mcp");
        assert.equal(accessToken, undefined);
        assert.equal(name, "get_account_capabilities");
        return { structuredContent: { ok: true } };
      }
    } as never
  });
});

test("official client identity is committed in package code", () => {
  assert.equal(OFFICIAL_SERVER_URL, "https://openai.vibecodr.space/mcp");
  assert.equal(OFFICIAL_CLIENT_METADATA_URL, "https://openai.vibecodr.space/.well-known/oauth-client/vibecodr-mcp.json");
  assert.deepEqual(officialClientInformation(), {
    client_id: "https://openai.vibecodr.space/.well-known/oauth-client/vibecodr-mcp.json"
  });
});

test("login --json emits only structured output when the default browser mode prints the URL", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await runLoginCommand([], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: false
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: false
      }),
      configStore: {} as never,
      secretStore: {} as never,
      runtimeClient: {} as never,
      tokenManager: {
        login: async (_globalOptions: unknown, options?: { onAuthorizationUrl?: (url: string) => void }) => {
          options?.onAuthorizationUrl?.("https://example.com/authorize");
          return {
            schemaVersion: 1,
            profile: "default",
            serverUrl: OFFICIAL_SERVER_URL,
            registrationMode: "cimd",
            authenticated: true as const,
            hasRefreshToken: true
          };
        }
      } as never
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const output = writes.join("");
  assert.match(output, /^\{\n/);
  assert.ok(!output.startsWith("https://example.com/authorize"));
  const parsed = JSON.parse(output);
  assert.equal(parsed.authorizationUrl, "https://example.com/authorize");
});

test("pulse-setup command reads general MCP setup guidance without descriptor input", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await runPulseSetupCommand([], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      }),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {
        resolveProfile: async () => ({ profileName: "default", serverUrl: "https://example.test/mcp" }),
        getSession: async () => ({ accessToken: "token-1" })
      } as never,
      runtimeClient: {
        callTool: async (_serverUrl: string, _accessToken: string | undefined, name: string, input: Record<string, unknown>) => {
          assert.equal(name, "get_pulse_setup_guidance");
          assert.deepEqual(input, {});
          return {
            structuredContent: {
              descriptorMetadata: {
                sourceOfTruth: "PulseDescriptor",
                apiVersion: "pulse/v1",
                normalizedDescriptorVersion: 1,
                setupTaskKinds: ["pulse", "secret", "connection", "state"],
                activeSetupTaskKinds: [],
                requiresBackendSetup: false,
                guidanceSource: "general_contract",
                compatibility: {
                  blockerCount: 0,
                  warningCount: 0
                },
                runtimeEnv: {
                  fetch: "env.fetch",
                  secrets: "env.secrets.bearer/header/query/verifyHmac",
                  webhooks: 'env.webhooks.verify("stripe")',
                  connections: "env.connections.use(provider).fetch",
                  log: "env.log",
                  request: "env.request",
                  runtime: "env.runtime",
                  waitUntil: "env.waitUntil"
                },
                runtimeSemantics: {
                  fetch: "env.fetch is Vibecodr policy-mediated fetch.",
                  secrets: "env.secrets does not expose raw secret values.",
                  webhooks: "env.webhooks.verify(\"stripe\") is the first provider helper; non-Stripe signed webhooks use env.secrets.verifyHmac with github-sha256, shopify-hmac-sha256, or slack-v0 format presets until helpers have fixtures.",
                  connections: "env.connections.use(provider).fetch keeps provider tokens platform-owned.",
                  log: "env.log accepts structured event records.",
                  request: "env.request is sanitized request access.",
                  runtime: "env.runtime carries safe correlation metadata only.",
                  waitUntil: "env.waitUntil is best-effort after-response work."
                }
              },
              descriptorEvaluation: {
                status: "general_contract",
                guidanceSource: "general_contract",
                requiresBackendSetup: false,
                activeSetupTaskKinds: [],
                setupTasks: [],
                blockers: [],
                warnings: []
              }
            }
          };
        }
      } as never
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const parsed = JSON.parse(writes.join(""));
  assert.equal(parsed.tool, "get_pulse_setup_guidance");
  assert.equal(parsed.result.structuredContent.descriptorMetadata.sourceOfTruth, "PulseDescriptor");
  assert.equal(parsed.result.structuredContent.descriptorMetadata.apiVersion, "pulse/v1");
  assert.match(parsed.result.structuredContent.descriptorMetadata.runtimeSemantics.fetch, /policy-mediated/);
  assert.match(parsed.result.structuredContent.descriptorMetadata.runtimeSemantics.secrets, /raw secret values/);
  assert.match(parsed.result.structuredContent.descriptorMetadata.runtimeSemantics.webhooks, /first provider helper/);
  assert.match(parsed.result.structuredContent.descriptorMetadata.runtimeSemantics.webhooks, /env\.secrets\.verifyHmac/);
  assert.match(parsed.result.structuredContent.descriptorMetadata.runtimeSemantics.webhooks, /github-sha256/);
  assert.match(parsed.result.structuredContent.descriptorMetadata.runtimeSemantics.webhooks, /shopify-hmac-sha256/);
  assert.match(parsed.result.structuredContent.descriptorMetadata.runtimeSemantics.webhooks, /slack-v0/);
  assert.match(parsed.result.structuredContent.descriptorMetadata.runtimeSemantics.connections, /platform-owned/);
  const internalD1BindingName = ["Pro", "User_Binding"].join("_");
  assert.doesNotMatch(
    JSON.stringify(parsed.result),
    new RegExp(`${internalD1BindingName}|__VC_STATE_GATEWAY|grant header|delete_pulse|listClaims`, "i")
  );
});

test("pulse-publish command calls the standalone Pulse publish tool with explicit confirmation", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await runPulsePublishCommand([
      "--name",
      "Stripe webhook",
      "--code",
      "export default async function POST() { return Response.json({ ok: true }); }",
      "--descriptor-json",
      JSON.stringify({ apiVersion: "pulse/v1" }),
      "--visibility",
      "private",
      "--confirm"
    ], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      }),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {
        resolveProfile: async () => ({ profileName: "default", serverUrl: "https://example.test/mcp" }),
        getSession: async () => ({ accessToken: "token-1" })
      } as never,
      runtimeClient: {
        callTool: async (_serverUrl: string, _accessToken: string | undefined, name: string, input: Record<string, unknown>) => {
          assert.equal(name, "publish_standalone_pulse");
          assert.deepEqual(input, {
            name: "Stripe webhook",
            code: "export default async function POST() { return Response.json({ ok: true }); }",
            descriptor: { apiVersion: "pulse/v1" },
            visibility: "private",
            confirmed: true
          });
          return {
            content: [{
              type: "text",
              text: "Standalone Pulse Stripe webhook is being deployed. Private visibility protects source metadata, but the runtime URL still needs code-level auth if it should reject anonymous callers."
            }],
            structuredContent: {
              pulse: {
                pulseId: "pls_cli",
                name: "Stripe webhook",
                visibility: "private",
                status: "deploying",
                deployStatus: "deploying"
              },
              publicEndpointNotice: "Private visibility protects source metadata; it does not add authentication to the Pulse runtime URL."
            }
          };
        }
      } as never
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const parsed = JSON.parse(writes.join(""));
  assert.equal(parsed.tool, "publish_standalone_pulse");
  assert.equal(parsed.arguments.confirmed, true);
  assert.equal(parsed.arguments.descriptorProvided, true);
  assert.equal(parsed.result.structuredContent.pulse.pulseId, "pls_cli");
  assert.doesNotMatch(JSON.stringify(parsed), /wfpWorkerName|deployToken|export default|Response\.json|apiVersion/);
});

test("pulse-setup command reports malformed guidance as a protocol error", async () => {
  await assert.rejects(
    async () => runPulseSetupCommand([], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      }),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {
        resolveProfile: async () => ({ profileName: "default", serverUrl: "https://example.test/mcp" }),
        getSession: async () => ({ accessToken: "token-1" })
      } as never,
      runtimeClient: {
        callTool: async () => ({ structuredContent: { descriptorMetadata: { sourceOfTruth: "Other", apiVersion: "pulse/v1" } } })
      } as never
    }),
    (error) => {
      assert.ok(error instanceof CliError);
      assert.equal(error.machineCode, "mcp.pulse_setup_contract");
      assert.equal(error.exitCode, EXIT_CODES.protocol);
      return true;
    }
  );
});

test("pulse-publish command does not send a stored token when the profile server changed", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await runPulsePublishCommand([
      "--name",
      "Server-bound token probe",
      "--code",
      "export default async function POST() { return Response.json({ ok: true }); }",
      "--confirm"
    ], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      }),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {
        resolveProfile: async () => ({ profileName: "default", serverUrl: "https://new.example/mcp" }),
        getSession: async (_profileName: string, serverUrl?: string) => {
          assert.equal(serverUrl, "https://new.example/mcp");
          return undefined;
        }
      } as never,
      runtimeClient: {
        callTool: async (serverUrl: string, accessToken: string | undefined, name: string) => {
          assert.equal(serverUrl, "https://new.example/mcp");
          assert.equal(accessToken, undefined);
          assert.equal(name, "publish_standalone_pulse");
          return {
            structuredContent: {
              pulse: {
                pulseId: "pls_server_bound",
                name: "Server-bound token probe",
                visibility: "private",
                status: "deploying",
                deployStatus: "deploying"
              }
            }
          };
        }
      } as never
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const parsed = JSON.parse(writes.join(""));
  assert.equal(parsed.tool, "publish_standalone_pulse");
});

test("pulse-setup command refreshes an expired session before retrying the MCP call", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  let callCount = 0;

  try {
    await runPulseSetupCommand([], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      }),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {
        resolveProfile: async () => ({ profileName: "default", serverUrl: "https://example.test/mcp" }),
        getSession: async () => ({
          accessToken: "expired-token",
          refreshToken: "refresh-token",
          serverUrl: "https://example.test/mcp"
        }),
        refresh: async () => ({
          profileName: "default",
          session: {
            accessToken: "fresh-token",
            refreshToken: "refresh-token",
            serverUrl: "https://example.test/mcp"
          }
        })
      } as never,
      runtimeClient: {
        callTool: async (_serverUrl: string, accessToken: string | undefined, name: string, input: Record<string, unknown>) => {
          callCount += 1;
          assert.equal(name, "get_pulse_setup_guidance");
          assert.deepEqual(input, {});
          if (callCount === 1) {
            assert.equal(accessToken, "expired-token");
            throw new CliError("auth.required", "Authentication required.", EXIT_CODES.authRequired);
          }
          assert.equal(accessToken, "fresh-token");
          return {
            structuredContent: {
              descriptorMetadata: {
                sourceOfTruth: "PulseDescriptor",
                apiVersion: "pulse/v1"
              },
              descriptorEvaluation: {
                guidanceSource: "general_contract"
              }
            }
          };
        }
      } as never
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(callCount, 2);
  assert.equal(JSON.parse(writes.join("")).tool, "get_pulse_setup_guidance");
});

test("pulse-setup command passes descriptor setup projection into MCP guidance", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  const openAiSecretName = ["OPENAI", "API_KEY"].join("_");
  const descriptorSetup = {
    setupTasks: [
      { kind: "secret", name: openAiSecretName },
      { kind: "raw_body", label: "Webhook raw body" }
    ],
    compatibility: { blockers: [], warnings: [] }
  };

  try {
    await runPulseSetupCommand(["--descriptor-setup-json", JSON.stringify(descriptorSetup)], {
      globalOptions: {
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      },
      output: new Output({
        profile: "default",
        json: true,
        verbose: false,
        nonInteractive: true
      }),
      configStore: {} as never,
      secretStore: {} as never,
      tokenManager: {
        resolveProfile: async () => ({ profileName: "default", serverUrl: "https://example.test/mcp" }),
        getSession: async () => ({ accessToken: "token-1" })
      } as never,
      runtimeClient: {
        callTool: async (_serverUrl: string, _accessToken: string | undefined, name: string, input: Record<string, unknown>) => {
          assert.equal(name, "get_pulse_setup_guidance");
          assert.deepEqual(input, { descriptorSetup });
          return {
            structuredContent: {
              descriptorMetadata: {
                sourceOfTruth: "PulseDescriptor",
                apiVersion: "pulse/v1",
                normalizedDescriptorVersion: 1,
                setupTaskKinds: ["pulse", "secret", "connection", "raw_body", "state"],
                activeSetupTaskKinds: ["secret", "raw_body"],
                requiresBackendSetup: true,
                guidanceSource: "descriptor_setup",
                compatibility: {
                  blockerCount: 0,
                  warningCount: 0
                },
                runtimeSemantics: {
                  fetch: "env.fetch is Vibecodr policy-mediated fetch.",
                  secrets: "env.secrets does not expose raw secret values.",
                  webhooks: "env.webhooks.verify(\"stripe\") is the first provider helper; non-Stripe signed webhooks use env.secrets.verifyHmac with github-sha256, shopify-hmac-sha256, or slack-v0 format presets until helpers have fixtures.",
                  connections: "env.connections.use(provider).fetch keeps provider tokens platform-owned."
                }
              },
              descriptorEvaluation: {
                status: "descriptor_evaluated",
                guidanceSource: "descriptor_setup",
                requiresBackendSetup: true,
                activeSetupTaskKinds: ["secret", "raw_body"],
                setupTasks: descriptorSetup.setupTasks,
                blockers: [],
                warnings: []
              }
            }
          };
        }
      } as never
    });
  } finally {
    process.stdout.write = originalWrite;
  }

  const parsed = JSON.parse(writes.join(""));
  assert.deepEqual(parsed.arguments, { descriptorSetup });
  assert.equal(parsed.result.structuredContent.descriptorEvaluation.guidanceSource, "descriptor_setup");
  assert.deepEqual(parsed.result.structuredContent.descriptorEvaluation.activeSetupTaskKinds, ["secret", "raw_body"]);
});
