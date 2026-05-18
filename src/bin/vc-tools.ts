#!/usr/bin/env node
process.env["__VCR_INVOKED_AS"] = "vc-tools";
const { reconcileEnv } = await import("../core/env.js");
reconcileEnv();
const { migrateLegacyDirsOnce } = await import("../storage/migrate.js");
await migrateLegacyDirsOnce();
const { runCli } = await import("../legacy/cli/run.js");
const code = await runCli(process.argv.slice(2));
process.exitCode = code;
