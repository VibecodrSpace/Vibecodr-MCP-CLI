import net from "node:net";
import path from "node:path";
import { CliError } from "../cli/errors.js";
import { CAPABILITIES, CAPABILITY_ALIASES, type CapabilityName } from "./contracts.js";

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{2,127}$/;
const INTERNAL_HOST_SUFFIXES = [".local", ".internal", ".localhost", ".home.arpa", ".lan"];

export function normalizeCapabilityName(input: string): CapabilityName {
  const normalized = CAPABILITY_ALIASES[input.trim()];
  if (!normalized) {
    throw new CliError(
      "input.unknown_capability",
      `Unknown capability "${input}". Supported capabilities: ${CAPABILITIES.join(", ")}.`,
      2
    );
  }
  return normalized;
}

export function validateBrowserUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new CliError("input.invalid_url", "Browser URL must be a valid absolute URL.", 2);
  }

  if (url.protocol !== "https:") {
    throw new CliError("input.invalid_url", "Blocked for safety: vc-tools can browse public HTTPS pages. Try a deployed or preview HTTPS URL.", 2);
  }

  if (url.username || url.password) {
    throw new CliError("input.invalid_url", "Blocked for safety: browser URLs cannot include credentials. Use a public page, or connect an authenticated browsing session when that beta is available.", 2);
  }

  const hostname = normalizedHostname(url.hostname);
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new CliError("input.blocked_url", "Blocked for safety: vc-tools can browse public HTTPS pages, but not localhost or private networks. Try a public preview URL, deploy preview, or a future consented private-network connector.", 2);
  }

  if (INTERNAL_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw new CliError("input.blocked_url", "Blocked for safety: vc-tools can browse public HTTPS pages, but not internal hostnames. Try a public preview URL, deploy preview, or a future consented private-network connector.", 2);
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion !== 0 && isBlockedIp(hostname)) {
    throw new CliError("input.blocked_url", "Blocked for safety: vc-tools can browse public HTTPS pages, but not private, loopback, link-local, multicast, or unspecified IPs. Try a public preview URL, deploy preview, or a future consented private-network connector.", 2);
  }

  return url.toString();
}

export function validateEntityId(input: string, label: string): string {
  if (!ID_PATTERN.test(input)) {
    throw new CliError("input.invalid_id", `${label} must be 3-128 characters and contain only letters, numbers, underscores, and dashes.`, 2);
  }
  return input;
}

export function validatePositiveInt(input: string | undefined, label: string, min: number, max: number): number | undefined {
  if (input === undefined) {
    return undefined;
  }
  const value = Number(input);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new CliError("input.invalid_number", `${label} must be an integer from ${min} to ${max}.`, 2);
  }
  return value;
}

export function validateSandboxCommand(input: string): string {
  const command = input.trim();
  if (command.length === 0) {
    throw new CliError("input.empty_command", "Sandbox command must not be empty.", 2);
  }
  if (command.length > 4000) {
    throw new CliError("input.command_too_large", "Sandbox command must be 4000 characters or fewer.", 2);
  }
  return command;
}

export function sanitizeFilename(input: string | undefined, fallback: string): string {
  const base = path.basename(input || fallback).replace(/[^A-Za-z0-9._-]/g, "_");
  const trimmed = base.replace(/^\.+/, "").slice(0, 180);
  return trimmed || fallback;
}

function isBlockedIp(ip: string): boolean {
  if (ip.includes(":")) {
    const normalized = ip.toLowerCase();
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab][0-9a-f]:/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("::ffff:") ||
      normalized.startsWith("64:ff9b:") ||
      normalized.startsWith("2002:")
    );
  }

  const parts = ip.split(".").map((part) => Number(part));
  const [a, b] = parts;
  if (a === undefined || b === undefined) {
    return true;
  }
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function normalizedHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}
