import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DefaultCredentialBroker } from "../src/auth/credential-broker.js";
import { ConfigStore as McpConfigStore } from "../src/storage/config-store.js";
import { SecretStore } from "../src/storage/secret-store.js";
import { ConfigStore as VcToolsConfigStore } from "../src/legacy/config/store.js";
import type { ConfigFile } from "../src/types/config.js";

async function withScratch<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vibecodr-broker-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function seedMcpConfig(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const configPath = path.join(dir, "config.json");
  const config: ConfigFile = {
    version: 1,
    currentProfile: "default",
    profiles: {
      default: {
        serverUrl: "https://openai.vibecodr.space/mcp",
        browserMode: "print",
        registrationMode: "cimd",
        defaultInstallScope: "user",
        logLevel: "normal"
      }
    }
  };
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return configPath;
}

test("broker returns the vc-tools durable API key for the tools.vibecodr.space endpoint", async () => {
  await withScratch(async (scratch) => {
    const vcDir = path.join(scratch, "vc-tools-store");
    await mkdir(vcDir, { recursive: true });
    const vcToolsStore = new VcToolsConfigStore(vcDir, { ...process.env, VC_TOOLS_CREDENTIAL_STORE: "file" });
    await vcToolsStore.saveDurableCredential(
      {
        mode: "api_key",
        value: "vct-test-key-1234567890",
        savedAt: new Date().toISOString(),
        source: "browser_device",
        expiresAt: 1_900_000_000
      },
      { token: "grant-token-1234567890", savedAt: new Date().toISOString(), source: "exchange" }
    );

    const mcpConfigPath = await seedMcpConfig(path.join(scratch, "mcp-config"));
    const mcpConfigStore = new McpConfigStore(mcpConfigPath);
    const secretsDir = path.join(scratch, "mcp-secrets");
    await mkdir(secretsDir, { recursive: true });
    const fileStorePath = path.join(scratch, "mcp-file-store.json");
    const mcpSecretStore = new SecretStore({
      fileStorePath,
      encryptedStoreDir: secretsDir,
      entryFactory: async () => ({
        getPassword: async () => undefined,
        setPassword: async () => {},
        deleteCredential: async () => false
      })
    });

    const broker = new DefaultCredentialBroker({ vcToolsStore, mcpSecretStore, mcpConfigStore });
    const result = await broker.getCredentialForEndpoint("tools.vibecodr.space");
    assert.ok(result);
    assert.equal(result.kind, "api_key");
    assert.equal(result.value, "vct-test-key-1234567890");
    assert.equal(result.serviceId, "@vibecodr/vc-tools");
    assert.equal(result.expiresAt, 1_900_000_000);
  });
});

test("broker returns the vc-tools short-lived grant when no durable credential is present", async () => {
  await withScratch(async (scratch) => {
    const vcDir = path.join(scratch, "vc-tools-store");
    await mkdir(vcDir, { recursive: true });
    const vcToolsStore = new VcToolsConfigStore(vcDir, { ...process.env, VC_TOOLS_CREDENTIAL_STORE: "file" });
    await vcToolsStore.saveGrant({ token: "grant-token-only-1234567890", savedAt: new Date().toISOString(), source: "exchange" });

    const mcpConfigPath = await seedMcpConfig(path.join(scratch, "mcp-config"));
    const mcpConfigStore = new McpConfigStore(mcpConfigPath);
    const secretsDir = path.join(scratch, "mcp-secrets");
    await mkdir(secretsDir, { recursive: true });
    const mcpSecretStore = new SecretStore({
      fileStorePath: path.join(scratch, "mcp-file-store.json"),
      encryptedStoreDir: secretsDir,
      entryFactory: async () => ({
        getPassword: async () => undefined,
        setPassword: async () => {},
        deleteCredential: async () => false
      })
    });

    const broker = new DefaultCredentialBroker({ vcToolsStore, mcpSecretStore, mcpConfigStore });
    const result = await broker.getCredentialForEndpoint("tools.vibecodr.space");
    assert.ok(result);
    assert.equal(result.kind, "token");
    assert.equal(result.value, "grant-token-only-1234567890");
    assert.equal(result.serviceId, "@vibecodr/vc-tools");
  });
});

test("broker returns the MCP gateway OAuth access token for the openai.vibecodr.space/mcp endpoint", async () => {
  await withScratch(async (scratch) => {
    const vcDir = path.join(scratch, "vc-tools-store");
    await mkdir(vcDir, { recursive: true });
    const vcToolsStore = new VcToolsConfigStore(vcDir, { ...process.env, VC_TOOLS_CREDENTIAL_STORE: "file" });

    const mcpConfigPath = await seedMcpConfig(path.join(scratch, "mcp-config"));
    const mcpConfigStore = new McpConfigStore(mcpConfigPath);
    const fileStorePath = path.join(scratch, "mcp-file-store.json");
    const mcpSecretStore = new SecretStore({
      fileStorePath,
      encryptedStoreDir: path.join(scratch, "mcp-secrets"),
      entryFactory: async () => ({
        getPassword: async () => undefined,
        setPassword: async () => {},
        deleteCredential: async () => false
      })
    });
    await mcpSecretStore.set("default", {
      schemaVersion: 1,
      serverUrl: "https://openai.vibecodr.space/mcp",
      accessToken: "mcp-access-token-1234567890",
      registrationMode: "cimd",
      authorizationServerUrl: "https://openai.vibecodr.space",
      clientInformation: { client_id: "test-client" },
      updatedAt: new Date().toISOString(),
      expiresAt: "2027-01-01T00:00:00.000Z"
    });

    const broker = new DefaultCredentialBroker({ vcToolsStore, mcpSecretStore, mcpConfigStore });
    const result = await broker.getCredentialForEndpoint("openai.vibecodr.space/mcp");
    assert.ok(result);
    assert.equal(result.kind, "oauth");
    assert.equal(result.value, "mcp-access-token-1234567890");
    assert.equal(result.serviceId, "@vibecodr/mcp");
    assert.equal(typeof result.expiresAt, "number");
  });
});

test("broker returns undefined when no credential is stored for the requested endpoint", async () => {
  await withScratch(async (scratch) => {
    const vcDir = path.join(scratch, "vc-tools-store");
    await mkdir(vcDir, { recursive: true });
    const vcToolsStore = new VcToolsConfigStore(vcDir, { ...process.env, VC_TOOLS_CREDENTIAL_STORE: "file" });

    const mcpConfigPath = await seedMcpConfig(path.join(scratch, "mcp-config"));
    const mcpConfigStore = new McpConfigStore(mcpConfigPath);
    const mcpSecretStore = new SecretStore({
      fileStorePath: path.join(scratch, "mcp-file-store.json"),
      encryptedStoreDir: path.join(scratch, "mcp-secrets"),
      entryFactory: async () => ({
        getPassword: async () => undefined,
        setPassword: async () => {},
        deleteCredential: async () => false
      })
    });

    const broker = new DefaultCredentialBroker({ vcToolsStore, mcpSecretStore, mcpConfigStore });
    assert.equal(await broker.getCredentialForEndpoint("tools.vibecodr.space"), undefined);
    assert.equal(await broker.getCredentialForEndpoint("openai.vibecodr.space/mcp"), undefined);
  });
});
