import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const version = process.argv[2]?.trim();
if (!version) fail("Usage: pnpm set-version <version>");

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  fail(`Invalid version: ${version}`);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf-8"));
}

function writeJson(file, obj) {
  writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");
}

function replaceInToml(file, key, value) {
  const raw = readFileSync(file, "utf-8");
  const re = new RegExp(`^${key}\\s*=\\s*\"[^\"]*\"\\s*$`, "m");
  if (!re.test(raw)) fail(`Could not find TOML key ${key} in ${file}`);
  const next = raw.replace(re, `${key} = "${value}"`);
  writeFileSync(file, next);
}

function replaceInJson(file, key, value) {
  const raw = readJson(file);
  if (!(key in raw)) fail(`Could not find JSON key ${key} in ${file}`);
  raw[key] = value;
  writeJson(file, raw);
}

const packageJson = path.join(root, "package.json");
const tauriConf = path.join(root, "src-tauri", "tauri.conf.json");
const cargoToml = path.join(root, "src-tauri", "Cargo.toml");

replaceInJson(packageJson, "version", version);
replaceInJson(tauriConf, "version", version);
replaceInToml(cargoToml, "version", version);

console.log(`Updated versions to ${version}`);
console.log(`- ${packageJson}`);
console.log(`- ${tauriConf}`);
console.log(`- ${cargoToml}`);
