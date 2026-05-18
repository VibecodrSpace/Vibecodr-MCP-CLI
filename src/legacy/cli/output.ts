import type { Writable } from "node:stream";
import { redactObject, redactSecrets } from "../core/redaction.js";
import type { CliError } from "./errors.js";

export interface CommandResult {
  message?: string;
  data?: unknown;
  warnings?: string[];
  humanData?: "show" | "hide";
}

export interface OutputOptions {
  json: boolean;
  quiet: boolean;
  stdout: Writable;
  stderr: Writable;
}

export function writeResult(result: CommandResult, options: OutputOptions): void {
  const warnings = result.warnings ?? [];
  const redactedWarnings = warnings.map((warning) => redactSecrets(warning));
  if (options.json) {
    options.stdout.write(`${JSON.stringify({ ok: true, data: redactObject(result.data ?? {}), warnings: redactedWarnings }, null, 2)}\n`);
    return;
  }

  if (!options.quiet) {
    if (result.message) {
      options.stdout.write(`${redactSecrets(result.message)}\n`);
    }
    if (result.data !== undefined && result.humanData !== "hide") {
      options.stdout.write(`${JSON.stringify(redactObject(result.data), null, 2)}\n`);
    }
  }

  for (const warning of redactedWarnings) {
    options.stderr.write(`Warning: ${warning}\n`);
  }
}

export function writeError(error: CliError, options: OutputOptions): void {
  if (options.json) {
    options.stderr.write(`${JSON.stringify({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        status: error.exitCode,
        details: redactObject(error.details)
      }
    }, null, 2)}\n`);
    return;
  }

  options.stderr.write(`Error (${error.code}): ${error.message}\n`);
}
