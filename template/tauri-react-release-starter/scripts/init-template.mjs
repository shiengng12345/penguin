import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith("--")) {
      fail(`Unexpected argument: ${current}`);
    }
    const key = current.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for --${key}`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function replaceInFile(file, replacements) {
  let content = readFileSync(file, "utf-8");
  for (const [token, value] of Object.entries(replacements)) {
    content = content.split(token).join(value);
  }
  writeFileSync(file, content);
}

const args = parseArgs(process.argv.slice(2));
const appName = args["app-name"];
const packageName = args["package-name"];
const identifier = args.identifier;
const description = args.description;
const repoOwner = args["repo-owner"];
const repoName = args["repo-name"];

if (!appName || !packageName || !identifier || !description || !repoOwner || !repoName) {
  fail(
    "Usage: node scripts/init-template.mjs --app-name <name> --package-name <package> --identifier <bundle-id> --description <text> --repo-owner <owner> --repo-name <repo>",
  );
}

const rustCrateName = packageName
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

if (!rustCrateName) {
  fail("Could not derive a Rust crate name from package name.");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const files = [
  "README.md",
  "index.html",
  "package.json",
  "vite.config.ts",
  "src/App.tsx",
  "src/lib/external-links.ts",
  "src/lib/theme.ts",
  "src-tauri/Cargo.toml",
  "src-tauri/src/main.rs",
  "src-tauri/tauri.conf.json",
  ".github/workflows/build.yml",
];

const replacements = {
  "__APP_NAME__": appName,
  "__PACKAGE_NAME__": packageName,
  "__RUST_CRATE_NAME__": rustCrateName,
  "__APP_IDENTIFIER__": identifier,
  "__APP_DESCRIPTION__": description,
  "__REPO_OWNER__": repoOwner,
  "__REPO_NAME__": repoName,
};

for (const relativeFile of files) {
  replaceInFile(path.join(root, relativeFile), replacements);
}

console.log("Template initialized:");
console.log(`- app name: ${appName}`);
console.log(`- package name: ${packageName}`);
console.log(`- bundle identifier: ${identifier}`);
console.log(`- repo: ${repoOwner}/${repoName}`);
console.log("");
console.log("Next steps:");
console.log("- pnpm install");
console.log("- replace src-tauri/icons with your own app icons");
console.log("- replace the updater pubkey in src-tauri/tauri.conf.json");
console.log("- pnpm tauri dev");
