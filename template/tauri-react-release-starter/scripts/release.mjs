import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const version = args.find((arg) => !arg.startsWith("-"))?.trim();

if (!version) {
  fail("Usage: pnpm release <version> [--dry-run]");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const setVersionScript = path.join(root, "scripts", "set-version.mjs");

if (dryRun) {
  console.log(`[dry-run] Would update versions to ${version}`);
} else {
  const result = spawnSync(process.execPath, [setVersionScript, version], {
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("");
console.log("Next steps:");
console.log(`- git add -A`);
console.log(`- git commit -m "release: v${version}"`);
console.log(`- git tag v${version}`);
console.log(`- git push origin main --tags`);
