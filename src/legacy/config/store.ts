import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CliError } from "../cli/errors.js";
import { createCredentialStore, type CredentialStore } from "./credential-store.js";

export const DEFAULT_API_URL = "https://tools.vibecodr.space";

export interface StoredProfile {
  apiUrl: string;
  workspaceId?: string | undefined;
  mcpUrl?: string | undefined;
}

export interface StoredConfig {
  version: 1;
  selectedProfile: string;
  profiles: Record<string, StoredProfile>;
}

export type StoredCredentialMode = "api_key" | "oauth" | "token";

export interface StoredLocalCredential {
  mode: StoredCredentialMode;
  value: string;
  savedAt: string;
  source: "browser_device" | "login" | "flag" | "file" | "stdin" | "env" | "token";
  expiresAt?: number | undefined;
}

export interface StoredGrant {
  token: string;
  savedAt: string;
  source: "exchange" | "browser_device" | "token";
  expiresAt?: number | undefined;
}

export interface StoredAuthState {
  version: 2;
  credential?: StoredLocalCredential | undefined;
  grant?: StoredGrant | undefined;
}

const DEFAULT_CONFIG: StoredConfig = {
  version: 1,
  selectedProfile: "default",
  profiles: {
    default: {
      apiUrl: DEFAULT_API_URL
    }
  }
};

export class ConfigStore {
  readonly dir: string;
  readonly credentialKind: "native" | "file";
  private readonly credentials: CredentialStore;

  constructor(dir: string, env: NodeJS.ProcessEnv) {
    this.dir = dir;
    this.credentials = createCredentialStore(env, new FileCredentialStore(this));
    this.credentialKind = this.credentials.kind;
  }

  static resolve(env: NodeJS.ProcessEnv, override?: string): ConfigStore {
    return new ConfigStore(resolveConfigDir(env, override), env);
  }

  async loadConfig(): Promise<StoredConfig> {
    const file = this.configPath();
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return normalizeConfig(parsed);
    } catch (error) {
      if (isNotFound(error)) {
        return structuredClone(DEFAULT_CONFIG);
      }
      throw new CliError("config.invalid", `Could not read vc-tools config at ${file}.`, 5);
    }
  }

  async saveProfile(profileName: string, profile: StoredProfile, select = true): Promise<void> {
    const config = await this.loadConfig();
    config.profiles[profileName] = profile;
    if (select) {
      config.selectedProfile = profileName;
    }
    await this.writeJsonPrivate(this.configPath(), config);
  }

  async getProfile(profileName?: string): Promise<{ name: string; profile: StoredProfile }> {
    const config = await this.loadConfig();
    const name = profileName ?? config.selectedProfile;
    const profile = config.profiles[name];
    if (!profile) {
      throw new CliError("config.profile_missing", `Profile "${name}" does not exist. Run vc-tools login first.`, 5);
    }
    return { name, profile };
  }

  async readAuthState(): Promise<StoredAuthState> {
    const raw = await this.credentials.readAuthState();
    return normalizeAuthState(raw);
  }

  async saveAuthState(state: StoredAuthState): Promise<void> {
    await this.credentials.saveAuthState(JSON.stringify(normalizeAuthState(state)));
  }

  async saveDurableCredential(credential: StoredLocalCredential, grant?: StoredGrant): Promise<void> {
    const current = await this.readAuthStateForOverwrite();
    await this.saveAuthState({
      ...current,
      version: 2,
      credential,
      ...(grant ? { grant } : {})
    });
  }

  async saveGrant(grant: StoredGrant): Promise<void> {
    const current = await this.readAuthStateForOverwrite();
    await this.saveAuthState({
      ...current,
      version: 2,
      grant
    });
  }

  async readToken(_profileName: string): Promise<string | undefined> {
    return (await this.readAuthState()).grant?.token;
  }

  async saveToken(_profileName: string, token: string): Promise<void> {
    await this.saveGrant({ token, savedAt: new Date().toISOString(), source: "token" });
  }

  async clearToken(_profileName: string): Promise<boolean> {
    return await this.credentials.clearAuthState();
  }

  async inspect(): Promise<{ dir: string; configExists: boolean; credentialsExist: boolean; credentialStore: "native" | "file" }> {
    const [configExists, credentialsExist] = await Promise.all([
      exists(this.configPath()),
      exists(this.credentialsPath())
    ]);
    return { dir: this.dir, configExists, credentialsExist, credentialStore: this.credentialKind };
  }

  configPath(): string {
    return path.join(this.dir, "config.json");
  }

  credentialsPath(): string {
    return path.join(this.dir, "credentials.json");
  }

  private async writeJsonPrivate(file: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, file);
    try {
      await fs.chmod(file, 0o600);
    } catch {
      // WHY: Windows may not honor POSIX modes, but the write still uses the narrowest practical Node mode.
    }
  }

  async writeJsonPrivateForCredentialStoreOnly(file: string, value: unknown): Promise<void> {
    await this.writeJsonPrivate(file, value);
  }

  private async readAuthStateForOverwrite(): Promise<StoredAuthState> {
    try {
      return await this.readAuthState();
    } catch (error) {
      if (error instanceof CliError && error.code === "config.credentials_invalid_shape") {
        return { version: 2 };
      }
      throw error;
    }
  }
}

class FileCredentialStore implements CredentialStore {
  readonly kind = "file" as const;

  constructor(private readonly store: ConfigStore) {}

  async readAuthState(): Promise<string | undefined> {
    if (!(await exists(this.store.credentialsPath()))) {
      return undefined;
    }
    const state = await this.loadCredentials();
    return JSON.stringify(state);
  }

  async saveAuthState(value: string): Promise<void> {
    await this.writeCredentials(normalizeAuthState(value));
  }

  async clearAuthState(): Promise<boolean> {
    const existed = await exists(this.store.credentialsPath());
    await fs.rm(this.store.credentialsPath(), { force: true });
    return existed;
  }

  private async loadCredentials(): Promise<StoredAuthState> {
    const file = this.store.credentialsPath();
    try {
      const raw = await fs.readFile(file, "utf8");
      return normalizeAuthState(raw);
    } catch (error) {
      if (isNotFound(error)) {
        return { version: 2 };
      }
      if (error instanceof CliError) {
        throw error;
      }
      throw new CliError("config.credentials_invalid", `Could not read vc-tools credentials at ${file}.`, 5);
    }
  }

  private async writeCredentials(credentials: StoredAuthState): Promise<void> {
    await this.store.writeJsonPrivateForCredentialStoreOnly(this.store.credentialsPath(), credentials);
  }
}

export function resolveConfigDir(env: NodeJS.ProcessEnv, override?: string): string {
  if (override) {
    return path.resolve(override);
  }

  if (env.VC_TOOLS_CONFIG_DIR) {
    return path.resolve(env.VC_TOOLS_CONFIG_DIR);
  }

  if (process.platform === "win32") {
    return path.join(env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "vc-tools");
  }

  return path.join(env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "vc-tools");
}

function normalizeConfig(value: unknown): StoredConfig {
  if (!isRecord(value) || value.version !== 1 || typeof value.selectedProfile !== "string" || !isRecord(value.profiles)) {
    throw new CliError("config.invalid_shape", "vc-tools config has an unsupported shape.", 5);
  }

  const profiles: Record<string, StoredProfile> = {};
  for (const [name, profile] of Object.entries(value.profiles)) {
    if (!isRecord(profile) || typeof profile.apiUrl !== "string") {
      throw new CliError("config.invalid_profile", `Profile "${name}" is invalid.`, 5);
    }
    const storedProfile: StoredProfile = { apiUrl: profile.apiUrl };
    if (typeof profile.workspaceId === "string") {
      storedProfile.workspaceId = profile.workspaceId;
    }
    if (typeof profile.mcpUrl === "string") {
      storedProfile.mcpUrl = profile.mcpUrl;
    }
    profiles[name] = storedProfile;
  }

  return {
    version: 1,
    selectedProfile: value.selectedProfile,
    profiles
  };
}

function normalizeAuthState(value: unknown): StoredAuthState {
  if (value === undefined) {
    return { version: 2 };
  }
  const parsed = typeof value === "string" ? parseAuthStateJson(value) : value;
  if (!isRecord(parsed)) {
    throw new CliError("config.credentials_invalid_shape", "vc-tools credentials have an unsupported shape.", 5);
  }

  if (parsed.version === 1 && isRecord(parsed.profiles)) {
    const legacy = parsed.profiles.default;
    if (isRecord(legacy) && typeof legacy.token === "string") {
      return {
        version: 2,
        grant: {
          token: legacy.token,
          savedAt: typeof legacy.savedAt === "string" ? legacy.savedAt : new Date().toISOString(),
          source: "token"
        }
      };
    }
    return { version: 2 };
  }

  if (parsed.version !== 2) {
    throw new CliError("config.credentials_invalid_shape", "vc-tools credentials have an unsupported shape.", 5);
  }

  const state: StoredAuthState = { version: 2 };
  const credential = normalizeStoredCredential(parsed.credential);
  const grant = normalizeStoredGrant(parsed.grant);
  if (credential) {
    state.credential = credential;
  }
  if (grant) {
    state.grant = grant;
  }

  return state;
}

function parseAuthStateJson(value: string): unknown {
  if (!value.trim()) {
    return { version: 2 };
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new CliError("config.credentials_invalid_shape", "vc-tools credentials have an unsupported shape.", 5);
  }
}

function normalizeStoredCredential(value: unknown): StoredLocalCredential | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const mode = value.mode;
  if (mode !== "api_key" && mode !== "oauth" && mode !== "token") {
    return undefined;
  }
  if (typeof value.value !== "string" || typeof value.savedAt !== "string") {
    return undefined;
  }
  const source = value.source;
  return {
    mode,
    value: value.value,
    savedAt: value.savedAt,
    source:
      source === "browser_device" ||
      source === "login" ||
      source === "flag" ||
      source === "file" ||
      source === "stdin" ||
      source === "env" ||
      source === "token"
        ? source
        : "login",
    expiresAt: typeof value.expiresAt === "number" ? value.expiresAt : undefined
  };
}

function normalizeStoredGrant(value: unknown): StoredGrant | undefined {
  if (!isRecord(value) || typeof value.token !== "string" || typeof value.savedAt !== "string") {
    return undefined;
  }
  const source = value.source;
  return {
    token: value.token,
    savedAt: value.savedAt,
    source: source === "exchange" || source === "browser_device" || source === "token" ? source : "exchange",
    expiresAt: typeof value.expiresAt === "number" ? value.expiresAt : undefined
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function isNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
