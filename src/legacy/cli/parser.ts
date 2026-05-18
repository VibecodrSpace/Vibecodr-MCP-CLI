import { CliError } from "./errors.js";

export interface GlobalOptions {
  json: boolean;
  help: boolean;
  version: boolean;
  quiet: boolean;
  noInput: boolean;
  noColor: boolean;
  debug: boolean;
  apiUrl?: string;
  allowInsecureLocalApi: boolean;
  configDir?: string;
  profile: string;
  credential?: string;
  credentialFile?: string;
  credentialStdin: boolean;
  token?: string;
  tokenFile?: string;
  tokenStdin: boolean;
  timeoutMs: number;
}

export interface ParsedArgv {
  globals: GlobalOptions;
  commandArgs: string[];
}

const GLOBAL_STRING_FLAGS = new Set([
  "api-url",
  "config-dir",
  "credential",
  "credential-file",
  "token",
  "token-file",
  "timeout-ms"
]);
const GLOBAL_BOOLEAN_FLAGS = new Set([
  "json",
  "help",
  "version",
  "quiet",
  "no-input",
  "no-color",
  "debug",
  "allow-insecure-local-api",
  "credential-stdin",
  "token-stdin"
]);

export function parseArgv(argv: string[]): ParsedArgv {
  const globals: GlobalOptions = {
    json: false,
    help: false,
    version: false,
    quiet: false,
    noInput: false,
    noColor: false,
    debug: false,
    allowInsecureLocalApi: false,
    profile: "default",
    credentialStdin: false,
    tokenStdin: false,
    timeoutMs: 30_000
  };
  const commandArgs: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "-h") {
      globals.help = true;
      continue;
    }

    if (arg === "-q") {
      globals.quiet = true;
      continue;
    }

    if (!arg.startsWith("--") || arg === "--") {
      commandArgs.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf("=");
    const key = equalsIndex === -1 ? raw : raw.slice(0, equalsIndex);
    const inlineValue = equalsIndex === -1 ? undefined : raw.slice(equalsIndex + 1);

    if (key === "timeout-ms" && commandArgs.length > 0) {
      commandArgs.push(arg);
      if (inlineValue === undefined && argv[index + 1] !== undefined && !argv[index + 1]?.startsWith("--")) {
        commandArgs.push(argv[index + 1] ?? "");
        index += 1;
      }
      continue;
    }

    if (GLOBAL_BOOLEAN_FLAGS.has(key)) {
      setGlobalBoolean(globals, key);
      continue;
    }

    if (GLOBAL_STRING_FLAGS.has(key)) {
      const value = inlineValue ?? argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new CliError("input.missing_flag_value", `--${key} requires a value.`, 2);
      }
      if (inlineValue === undefined) {
        index += 1;
      }
      setGlobalString(globals, key, value);
      continue;
    }

    commandArgs.push(arg);
  }

  return { globals, commandArgs };
}

export interface ParsedCommandOptions {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseCommandOptions(args: string[]): ParsedCommandOptions {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--") {
      positionals.push(...args.slice(index + 1));
      break;
    }

    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    if (raw.startsWith("no-")) {
      flags[toCamelCase(raw.slice(3))] = false;
      continue;
    }

    const equalsIndex = raw.indexOf("=");
    if (equalsIndex !== -1) {
      flags[toCamelCase(raw.slice(0, equalsIndex))] = raw.slice(equalsIndex + 1);
      continue;
    }

    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[toCamelCase(raw)] = next;
      index += 1;
    } else {
      flags[toCamelCase(raw)] = true;
    }
  }

  return { positionals, flags };
}

export function getStringFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export function getBooleanFlag(flags: Record<string, string | boolean>, name: string): boolean {
  return flags[name] === true;
}

function setGlobalBoolean(globals: GlobalOptions, key: string): void {
  if (key === "json") globals.json = true;
  if (key === "help") globals.help = true;
  if (key === "version") globals.version = true;
  if (key === "quiet") globals.quiet = true;
  if (key === "no-input") globals.noInput = true;
  if (key === "no-color") globals.noColor = true;
  if (key === "debug") globals.debug = true;
  if (key === "allow-insecure-local-api") globals.allowInsecureLocalApi = true;
  if (key === "credential-stdin") globals.credentialStdin = true;
  if (key === "token-stdin") globals.tokenStdin = true;
}

function setGlobalString(globals: GlobalOptions, key: string, value: string): void {
  if (key === "api-url") globals.apiUrl = value;
  if (key === "config-dir") globals.configDir = value;
  if (key === "credential") globals.credential = value;
  if (key === "credential-file") globals.credentialFile = value;
  if (key === "token") globals.token = value;
  if (key === "token-file") globals.tokenFile = value;
  if (key === "timeout-ms") {
    const timeoutMs = Number(value);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000) {
      throw new CliError("input.invalid_timeout", "--timeout-ms must be an integer from 1000 to 300000.", 2);
    }
    globals.timeoutMs = timeoutMs;
  }
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
}
