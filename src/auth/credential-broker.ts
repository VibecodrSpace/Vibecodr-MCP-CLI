// Unified credential broker. Routes "give me a credential for endpoint X"
// requests to the correct underlying store and surface, without callers
// having to know whether the credential is a durable Clerk API key (the
// vc-tools hosted Agent Computer surface) or an OAuth access token cached
// inside an encrypted session blob (the MCP gateway surface).
//
// Two underlying slots:
//   - "device-grant": durable API key stored by the legacy vc-tools
//     ConfigStore (src/legacy/config/store.ts), backed by @napi-rs/keyring
//     under service "@vibecodr/vc-tools". Used by the tools.vibecodr.space
//     endpoint family.
//   - "oauth": refreshable OAuth session stored by SecretStore
//     (src/storage/secret-store.ts), backed by @napi-rs/keyring under
//     service "@vibecodr/mcp" plus an AES-256-GCM encrypted file. Used by
//     the openai.vibecodr.space/mcp endpoint.
//
// The two service IDs are intentionally kept verbatim across the v1
// merger so existing keychain entries written by @vibecodr/vc-tools@0.1.x
// and @vibecodr/cli@0.2.x stay readable.

import { ConfigStore as McpConfigStore } from "../storage/config-store.js";
import { SecretStore } from "../storage/secret-store.js";
import { ConfigStore as VcToolsConfigStore } from "../legacy/config/store.js";

export type CredentialEndpoint = "tools.vibecodr.space" | "openai.vibecodr.space/mcp";

export type CredentialKind = "api_key" | "oauth" | "token";

export interface BrokeredCredential {
  endpoint: CredentialEndpoint;
  kind: CredentialKind;
  value: string;
  // The keyring service ID the backing store reads/writes. Surfaced so
  // diagnostics + upgrade tests can verify the v1 merger preserved the
  // historically-correct service IDs.
  serviceId: "@vibecodr/vc-tools" | "@vibecodr/mcp";
  expiresAt?: number;
}

export interface CredentialBroker {
  getCredentialForEndpoint(endpoint: CredentialEndpoint): Promise<BrokeredCredential | undefined>;
}

export interface BrokerConstruction {
  vcToolsStore: VcToolsConfigStore;
  mcpSecretStore: SecretStore;
  mcpConfigStore: McpConfigStore;
}

export class DefaultCredentialBroker implements CredentialBroker {
  constructor(private readonly stores: BrokerConstruction) {}

  async getCredentialForEndpoint(endpoint: CredentialEndpoint): Promise<BrokeredCredential | undefined> {
    if (endpoint === "tools.vibecodr.space") {
      return await this.readVcToolsCredential();
    }
    return await this.readMcpCredential();
  }

  private async readVcToolsCredential(): Promise<BrokeredCredential | undefined> {
    const state = await this.stores.vcToolsStore.readAuthState();
    const credential = state.credential;
    if (credential) {
      const result: BrokeredCredential = {
        endpoint: "tools.vibecodr.space",
        kind: credential.mode,
        value: credential.value,
        serviceId: "@vibecodr/vc-tools"
      };
      if (credential.expiresAt !== undefined) result.expiresAt = credential.expiresAt;
      return result;
    }
    // Fall back to the short-lived exchange grant if a durable credential isn't
    // present yet (the vc-tools start flow can leave only a grant after the
    // device approval step before the durable Clerk API key is minted).
    const grant = state.grant;
    if (!grant) return undefined;
    const result: BrokeredCredential = {
      endpoint: "tools.vibecodr.space",
      kind: "token",
      value: grant.token,
      serviceId: "@vibecodr/vc-tools"
    };
    if (grant.expiresAt !== undefined) result.expiresAt = grant.expiresAt;
    return result;
  }

  private async readMcpCredential(): Promise<BrokeredCredential | undefined> {
    const { name } = await this.stores.mcpConfigStore.getProfile();
    const session = await this.stores.mcpSecretStore.get(name);
    if (!session) return undefined;
    const result: BrokeredCredential = {
      endpoint: "openai.vibecodr.space/mcp",
      kind: "oauth",
      value: session.accessToken,
      serviceId: "@vibecodr/mcp"
    };
    if (session.expiresAt) {
      const ts = Date.parse(session.expiresAt);
      if (!Number.isNaN(ts)) result.expiresAt = ts;
    }
    return result;
  }
}
