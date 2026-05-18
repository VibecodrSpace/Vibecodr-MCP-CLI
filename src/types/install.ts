export type ClientTarget = "codex" | "cursor" | "vscode" | "windsurf" | "claude-desktop" | "claude-code";

export interface InstallManifestEntry {
  client: ClientTarget;
  scope: "user" | "project";
  name: string;
  location: string;
  method: "file" | "cli" | "uri";
  serverUrl: string;
  installedAt: string;
}

export interface InstallManifestFile {
  version: 1;
  installs: InstallManifestEntry[];
}

export interface InstallResult {
  client: ClientTarget;
  scope: "user" | "project";
  name: string;
  method: "file" | "cli" | "uri";
  changed: boolean;
  location: string;
  managed: true;
  nextStep: string;
  notes?: string[];
}
