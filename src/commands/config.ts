import { parseFlags } from "../cli/parse.js";
import { CliError, EXIT_CODES } from "../cli/errors.js";
import { defaultProfileConfig } from "../types/config.js";
import { showHelpIfRequested } from "./help.js";
import type { BrowserMode, ConfigFile, LogLevel, ProfileConfig, RegistrationMode } from "../types/config.js";
import type { CommandContext } from "./context.js";

function updateProfileKey(profile: ProfileConfig, key: string, value: string): ProfileConfig {
  switch (key) {
    case "server-url":
      return { ...profile, serverUrl: value };
    case "browser-mode":
      return { ...profile, browserMode: value as BrowserMode };
    case "registration-mode":
      return { ...profile, registrationMode: value as RegistrationMode };
    case "default-install-scope":
      return { ...profile, defaultInstallScope: value as ProfileConfig["defaultInstallScope"] };
    case "log-level":
      return { ...profile, logLevel: value as LogLevel };
    default:
      throw new CliError("usage.unknown_config_key", `Unknown config key: ${key}`, EXIT_CODES.usage);
  }
}

function unsetProfileKey(profile: ProfileConfig, key: string): ProfileConfig {
  switch (key) {
    case "server-url":
      return { ...profile, serverUrl: "https://openai.vibecodr.space/mcp" };
    case "browser-mode":
      return { ...profile, browserMode: "print" };
    case "registration-mode":
      return { ...profile, registrationMode: "auto" };
    case "default-install-scope":
      return { ...profile, defaultInstallScope: "user" };
    case "log-level":
      return { ...profile, logLevel: "normal" };
    default:
      throw new CliError("usage.unknown_config_key", `Unknown config key: ${key}`, EXIT_CODES.usage);
  }
}

async function saveConfig(context: CommandContext, config: ConfigFile): Promise<void> {
  await context.configStore.save(config);
}

export async function runConfigCommand(args: string[], context: CommandContext): Promise<void> {
  if (showHelpIfRequested(args, context, "Usage: vibecodr config path|show|set|unset|profile ...")) return;
  const action = args[0];
  const config = await context.configStore.load();
  const currentProfileName = context.globalOptions.profile || config.currentProfile;
  const currentProfile = config.profiles[currentProfileName] || config.profiles[config.currentProfile] || defaultProfileConfig();

  if (action === "path") {
    context.output.success({ schemaVersion: 1, path: context.configStore.path() }, [context.configStore.path()]);
    return;
  }
  if (action === "show") {
    context.output.success({ schemaVersion: 1, config }, [JSON.stringify(config, null, 2)]);
    return;
  }
  if (action === "set") {
    const key = args[1];
    const value = args[2];
    if (!key || !value) throw new CliError("usage.config_set", "Usage: config set <key> <value>", EXIT_CODES.usage);
    config.profiles[currentProfileName] = updateProfileKey(currentProfile, key, value);
    await saveConfig(context, config);
    context.output.success({ schemaVersion: 1, profile: currentProfileName, key, value }, [`${currentProfileName}: set ${key}=${value}`]);
    return;
  }
  if (action === "unset") {
    const key = args[1];
    if (!key) throw new CliError("usage.config_unset", "Usage: config unset <key>", EXIT_CODES.usage);
    config.profiles[currentProfileName] = unsetProfileKey(currentProfile, key);
    await saveConfig(context, config);
    context.output.success({ schemaVersion: 1, profile: currentProfileName, key }, [`${currentProfileName}: unset ${key}`]);
    return;
  }
  if (action === "profile") {
    const subAction = args[1];
    if (subAction === "list") {
      const profiles = Object.keys(config.profiles);
      context.output.success({ schemaVersion: 1, currentProfile: config.currentProfile, profiles }, profiles);
      return;
    }
    if (subAction === "create") {
      const name = args[2];
      if (!name) throw new CliError("usage.profile_create", "Usage: config profile create <name> [--server-url <url>]", EXIT_CODES.usage);
      const { flags } = parseFlags(args.slice(3), { valueFlags: ["server-url"] });
      config.profiles[name] = {
        ...currentProfile,
        ...(typeof flags["server-url"] === "string" ? { serverUrl: flags["server-url"] } : {})
      };
      await saveConfig(context, config);
      context.output.success({ schemaVersion: 1, created: name }, [`Created profile ${name}.`]);
      return;
    }
    if (subAction === "use") {
      const name = args[2];
      if (!name || !config.profiles[name]) throw new CliError("usage.profile_use", "Usage: config profile use <name>", EXIT_CODES.usage);
      config.currentProfile = name;
      await saveConfig(context, config);
      context.output.success({ schemaVersion: 1, currentProfile: name }, [`Current profile: ${name}`]);
      return;
    }
    if (subAction === "delete") {
      const name = args[2];
      const { flags } = parseFlags(args.slice(3), { booleanFlags: ["force"] });
      if (!name || !config.profiles[name]) throw new CliError("usage.profile_delete", "Usage: config profile delete <name> [--force]", EXIT_CODES.usage);
      if (config.currentProfile === name && !flags["force"]) {
        throw new CliError("config.profile_in_use", "Cannot delete the current profile without --force.", EXIT_CODES.config);
      }
      delete config.profiles[name];
      if (!Object.keys(config.profiles).length) {
        throw new CliError("config.last_profile", "Cannot delete the last profile.", EXIT_CODES.config);
      }
      if (config.currentProfile === name) {
        const nextProfile = Object.keys(config.profiles)[0];
        if (!nextProfile) throw new CliError("config.last_profile", "Cannot delete the last profile.", EXIT_CODES.config);
        config.currentProfile = nextProfile;
      }
      await saveConfig(context, config);
      context.output.success({ schemaVersion: 1, deleted: name }, [`Deleted profile ${name}.`]);
      return;
    }
  }

  throw new CliError("usage.config", "Usage: config path|show|set|unset|profile ...", EXIT_CODES.usage);
}
