#!/usr/bin/env node
process.env["__VCR_INVOKED_AS"] = "vc-tools";
const { runCli } = await import("../legacy/cli/run.js");
const code = await runCli(process.argv.slice(2));
process.exitCode = code;
