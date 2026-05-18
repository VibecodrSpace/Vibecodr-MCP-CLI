import { redactSecrets } from "../core/redaction.js";

export type CliExitCode = 1 | 2 | 3 | 4 | 5 | 6;

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: CliExitCode;
  readonly details?: unknown;

  constructor(code: string, message: string, exitCode: CliExitCode = 1, details?: unknown) {
    super(redactSecrets(message));
    this.name = "CliError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function toCliError(error: unknown): CliError {
  if (error instanceof CliError) {
    return error;
  }

  if (error instanceof Error) {
    return new CliError("unexpected.failure", redactSecrets(error.message), 1);
  }

  return new CliError("unexpected.failure", "An unexpected failure occurred.", 1);
}
