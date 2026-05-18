import { mkdir, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const temp = path.join(root, "tmp", "pack-verify");

await rm(temp, { recursive: true, force: true });
await mkdir(temp, { recursive: true });

const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
if (packageJson.name !== "@vibecodr/cli") {
  throw new Error(`Unexpected package name: ${packageJson.name}`);
}
const expectedBinTargets = {
  vibecodr: "dist/bin/vibecodr-mcp.js",
  "vibecodr-mcp": "dist/bin/vibecodr-mcp.js",
  "vc-tools": "dist/bin/vc-tools.js"
};
for (const [bin, expected] of Object.entries(expectedBinTargets)) {
  if (packageJson.bin?.[bin] !== expected) {
    throw new Error(`package.json bin map for ${bin} must be ${expected}, got ${packageJson.bin?.[bin]}.`);
  }
}

const forbiddenRuntimeDependencies = [
  "@cloudflare/puppeteer",
  "@cloudflare/sandbox",
  "@cloudflare/workers-types",
  "wrangler"
];
const leakedRuntimeDependencies = forbiddenRuntimeDependencies.filter((name) =>
  Object.prototype.hasOwnProperty.call(packageJson.dependencies ?? {}, name)
);
if (leakedRuntimeDependencies.length > 0) {
  throw new Error(
    `Public CLI runtime dependencies must not include hosted platform primitives: ${leakedRuntimeDependencies.join(", ")}`
  );
}

const result = process.platform === "win32"
  ? await run("cmd.exe", ["/d", "/s", "/c", "npm", "pack", "--json", "--pack-destination", temp])
  : await run("npm", ["pack", "--json", "--pack-destination", temp]);
const packs = JSON.parse(result.stdout);
const pack = packs[0];
if (!pack?.filename || !Array.isArray(pack.files)) {
  throw new Error("npm pack did not return package metadata.");
}

const names = new Set(pack.files.map((file) => file.path));
const required = [
  "dist/bin/vibecodr-mcp.js",
  "dist/bin/vc-tools.js",
  "dist/legacy/cli/run.js",
  "README.md",
  "LICENSE",
  "package.json"
];
const missing = required.filter((file) => !names.has(file));
if (missing.length > 0) {
  throw new Error(`Packed artifact is missing required files: ${missing.join(", ")}`);
}

const forbiddenPatterns = [
  /\.env/i,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.agent(s)?(\/|$)/,
  /(^|\/)tmp[-_]/i,
  /(^|\/).*scratch/i,
  /(^|\/).*bak$/i,
  /(^|\/).*log$/i
];
const allowedRootFiles = new Set(["LICENSE", "README.md", "CHANGELOG.md", "MIGRATION.md", "package.json"]);
const forbiddenPackagePaths = pack.files
  .map((file) => file.path)
  .filter((file) =>
    file.startsWith("src/") ||
    file.startsWith("test/") ||
    file.startsWith("scripts/") ||
    file.startsWith("migrations/") ||
    file.startsWith("dist/hosted/") ||
    file.startsWith("dist-worker/") ||
    file === "Dockerfile" ||
    file === "wrangler.jsonc" ||
    file === "worker-configuration.d.ts" ||
    file === "tsconfig.json" ||
    file === "tsconfig.build.json" ||
    file === "tsconfig.worker.json" ||
    forbiddenPatterns.some((pattern) => pattern.test(file)) ||
    (!file.startsWith("dist/") && !file.startsWith("docs/") && !allowedRootFiles.has(file))
  );
if (forbiddenPackagePaths.length > 0) {
  throw new Error(`Packed CLI artifact includes repository-only files: ${forbiddenPackagePaths.join(", ")}`);
}

const versionResult = await run(process.execPath, ["dist/bin/vibecodr-mcp.js", "--version"]);
const expectedVersionText = `${packageJson.version}`;
if (versionResult.stdout.trim() !== expectedVersionText) {
  throw new Error(
    `Built CLI reports the wrong version. Expected "${expectedVersionText}", received "${versionResult.stdout.trim()}".`
  );
}

const vcToolsVersionResult = await run(process.execPath, ["dist/bin/vc-tools.js", "--version"]);
const expectedVcToolsVersionText = `vc-tools ${packageJson.version}`;
if (vcToolsVersionResult.stdout.trim() !== expectedVcToolsVersionText) {
  throw new Error(
    `Built vc-tools bin reports the wrong version. Expected "${expectedVcToolsVersionText}", received "${vcToolsVersionResult.stdout.trim()}".`
  );
}

console.log(`Verified package artifact ${pack.filename} (${pack.files.length} files).`);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} ${args.join(" ")} failed with ${code}\n${stderr}`));
      }
    });
  });
}
