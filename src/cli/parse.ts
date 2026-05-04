import { CliError, EXIT_CODES } from "./errors.js";
import type { GlobalOptions } from "../types/config.js";

type ParsedFlags = {
  flags: Record<string, string | boolean>;
  positionals: string[];
};

function normalizeFlagName(flag: string): string {
  return flag.replace(/^-+/, "");
}

export function isHelpToken(token: string | undefined): boolean {
  return token === "help" || token === "--help" || token === "-h" || token === "-help";
}

export function isVersionToken(token: string | undefined): boolean {
  return token === "--version" || token === "-v" || token === "-version";
}

export function parseFlags(
  args: string[],
  options: {
    valueFlags?: string[];
    booleanFlags?: string[];
  }
): ParsedFlags {
  const valueFlags = new Set(options.valueFlags || []);
  const booleanFlags = new Set(options.booleanFlags || []);
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === undefined) continue;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const name = normalizeFlagName(token);
    if (booleanFlags.has(name)) {
      flags[name] = true;
      continue;
    }
    if (valueFlags.has(name)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CliError("usage.missing_flag_value", `Missing value for --${name}.`, EXIT_CODES.usage);
      }
      flags[name] = value;
      index += 1;
      continue;
    }
    throw new CliError("usage.unknown_flag", `Unknown flag: ${token}`, EXIT_CODES.usage);
  }

  return { flags, positionals };
}

export function parseGlobalOptions(argv: string[]): {
  command?: string;
  commandArgs: string[];
  globalOptions: GlobalOptions;
} {
  const globalOptions: GlobalOptions = {
    profile: "default",
    json: false,
    verbose: false,
    nonInteractive: false
  };
  let command: string | undefined;
  const commandArgs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) continue;
    if (!command && (isHelpToken(token) || isVersionToken(token))) {
      command = token;
      continue;
    }
    if (token === "--profile") {
      const value = argv[index + 1];
      if (!value) throw new CliError("usage.missing_profile", "Missing value for --profile.", EXIT_CODES.usage);
      globalOptions.profile = value;
      index += 1;
      continue;
    }
    if (token === "--server-url") {
      throw new CliError(
        "usage.unknown_global_flag",
        "--server-url is no longer accepted as a global runtime override.",
        EXIT_CODES.usage,
        {
          nextStep:
            "Create a separate profile with `vibecodr config profile create <name> --server-url <url>` and login to that profile. Stored tokens are bound to the server they were issued for."
        }
      );
    }
    if (token === "--json") {
      globalOptions.json = true;
      continue;
    }
    if (token === "--verbose") {
      globalOptions.verbose = true;
      continue;
    }
    if (token === "--non-interactive") {
      globalOptions.nonInteractive = true;
      continue;
    }
    if (!command && !token.startsWith("--")) {
      command = token;
      continue;
    }
    commandArgs.push(token);
  }

  return { ...(command ? { command } : {}), commandArgs, globalOptions };
}
