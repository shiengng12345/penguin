// Node-flavored implementations of the abstractions @penguin/core requires.
// Penguin desktop has its own Tauri-backed versions; the MCP server lives in a
// regular Node process so it gets to use child_process + fs.readFile directly.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SidecarRunner, LoadPackageModule } from "@penguin/core";
import { protocolDir, type Protocol } from "./penguin-paths.js";

// Dynamic-imports the @snsoft package's main entry point. Resolves the same
// way Penguin desktop does: read the package's package.json, follow `main`.
export function makeLoadModule(protocol: Protocol): LoadPackageModule {
  return async (packageName: string) => {
    const dir = join(protocolDir(protocol), "node_modules", packageName);
    if (!existsSync(dir)) {
      throw new Error(
        `Package ${packageName} not installed for ${protocol} (looked in ${dir})`,
      );
    }
    const pkgJsonPath = join(dir, "package.json");
    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
      main?: string;
      module?: string;
    };
    const entryRel = pkgJson.module ?? pkgJson.main ?? "index.js";
    const entry = join(dir, entryRel);
    if (!existsSync(entry)) {
      throw new Error(
        `Entry point ${entryRel} missing for ${packageName} (expected at ${entry})`,
      );
    }
    return await import(pathToFileURL(entry).href);
  };
}

// Streams the sidecar script into `node -` via stdin. Mirrors the Penguin
// desktop runner (which goes through zsh-login) but skips the shell layer —
// MCP servers don't need user PATH inheritance the way the GUI does.
export const nodeSidecarRunner: SidecarRunner = async (script: string) => {
  return await new Promise((resolve, reject) => {
    const child = spawn("node", ["-"], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
    child.stdin.write(script);
    child.stdin.end();
  });
};
