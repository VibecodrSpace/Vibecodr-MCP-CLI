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
  // CLI-shim adapters (claude-code; codex/vscode in their CLI paths) populate this
  // on --dry-run so the §4 clients-golden test can assert the exact spawn signature
  // without having the third-party CLI installed.
  spawn?: { command: string; args: string[] };
}
