import { CliError } from "../cli/errors.js";

const SERVICE_NAME = "@vibecodr/vc-tools";

type AsyncEntryCtor = {
  new(service: string, username: string): {
    getPassword(): Promise<string | undefined>;
    setPassword(password: string): Promise<void>;
    deleteCredential(): Promise<boolean>;
  };
};

export interface CredentialStore {
  readonly kind: "native" | "file";
  readAuthState(): Promise<string | undefined>;
  saveAuthState(value: string): Promise<void>;
  clearAuthState(): Promise<boolean>;
}

export function createCredentialStore(env: NodeJS.ProcessEnv, fileStore: CredentialStore): CredentialStore {
  if (env.VC_TOOLS_CREDENTIAL_STORE === "file") {
    return fileStore;
  }

  if (env.VC_TOOLS_CREDENTIAL_STORE && env.VC_TOOLS_CREDENTIAL_STORE !== "native") {
    throw new CliError("config.invalid_credential_store", "VC_TOOLS_CREDENTIAL_STORE must be native or file.", 5);
  }

  return new NativeCredentialStore();
}

class NativeCredentialStore implements CredentialStore {
  readonly kind = "native" as const;
  private ctorPromise: Promise<AsyncEntryCtor> | undefined;

  async readAuthState(): Promise<string | undefined> {
    const entry = await this.entry();
    return await entry.getPassword();
  }

  async saveAuthState(value: string): Promise<void> {
    const entry = await this.entry();
    await entry.setPassword(value);
  }

  async clearAuthState(): Promise<boolean> {
    const entry = await this.entry();
    return await entry.deleteCredential();
  }

  private async entry(): Promise<InstanceType<AsyncEntryCtor>> {
    const AsyncEntry = await this.loadCtor();
    return new AsyncEntry(SERVICE_NAME, "agent-computer");
  }

  private async loadCtor(): Promise<AsyncEntryCtor> {
    this.ctorPromise ??= import("@napi-rs/keyring")
      .then((mod) => mod.AsyncEntry as AsyncEntryCtor)
      .catch((error) => {
        throw new CliError(
          "storage.native_credentials_unavailable",
          `Native credential storage is unavailable. ${platformHint()} For local automation only, set VC_TOOLS_CREDENTIAL_STORE=file.`,
          5,
          { cause: error instanceof Error ? error.message : String(error) }
        );
      });
    return await this.ctorPromise;
  }
}

function platformHint(platform: NodeJS.Platform = process.platform): string {
  switch (platform) {
    case "win32":
      return "Windows uses Credential Manager; run from a normal signed-in desktop session.";
    case "darwin":
      return "macOS uses Keychain; unlock the login keychain if prompted.";
    case "linux":
      return "Linux uses Secret Service; make sure a desktop keyring is installed, running, and unlocked.";
    default:
      return "Install or unlock the native credential store for this platform.";
  }
}
