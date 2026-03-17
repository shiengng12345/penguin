import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf-8",
    stdio: options.capture ? "pipe" : "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result.stdout?.trim() ?? "";
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const version = args.find((arg) => !arg.startsWith("-"))?.trim();

if (!version) {
  fail("Usage: pnpm release:ship <version> [--dry-run]");
}

const tag = `v${version}`;
const versionFiles = [
  "package.json",
  path.join("src-tauri", "tauri.conf.json"),
  path.join("src-tauri", "Cargo.toml"),
];

const statusOutput = run("git", ["status", "--short"], { capture: true });
if (statusOutput) {
  if (dryRun) {
    console.log("[dry-run] Working tree is not clean. Actual run would stop.");
  } else {
    fail("Working tree is not clean. Commit or stash your changes before running release:ship.");
  }
}

const existingTag = spawnSync("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}`], {
  cwd: root,
  encoding: "utf-8",
  stdio: "ignore",
});
if (existingTag.status === 0) {
  fail(`Tag ${tag} already exists.`);
}

const setVersionScript = path.join(root, "scripts", "set-version.mjs");

if (dryRun) {
  console.log(`[dry-run] Would run: ${process.execPath} ${setVersionScript} ${version}`);
  console.log(`[dry-run] Would run: git add ${versionFiles.join(" ")}`);
  console.log(`[dry-run] Would run: git commit -m "release: ${tag}"`);
  console.log(`[dry-run] Would run: git tag ${tag}`);
} else {
  run(process.execPath, [setVersionScript, version]);
  run("git", ["add", ...versionFiles]);
  run("git", ["commit", "-m", `release: ${tag}`]);
  run("git", ["tag", tag]);
}

console.log("");
console.log("Next step:");
console.log(`- git push origin main --tags`);
