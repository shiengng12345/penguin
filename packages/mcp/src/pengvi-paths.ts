// Mirrors Pengvi desktop's package layout under ~/.pengvi/. The MCP server
// reads the same directories so any package the user installed via the Pengvi
// UI is immediately discoverable from AI tools — no extra wiring.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type Protocol = "grpc-web" | "grpc" | "sdk";

export function pengviRoot(): string {
  return join(homedir(), ".pengvi");
}

export function protocolDir(protocol: Protocol): string {
  return join(pengviRoot(), protocol);
}

// List @snsoft/* packages installed under a protocol's node_modules.
// Returns each package's resolved directory + version string from its
// package.json. Silent on missing dirs (fresh install with no packages yet).
export function listInstalledPackages(protocol: Protocol): Array<{
  name: string;
  version: string;
  dir: string;
}> {
  const nodeModules = join(protocolDir(protocol), "node_modules", "@snsoft");
  if (!existsSync(nodeModules)) return [];

  const out: Array<{ name: string; version: string; dir: string }> = [];
  for (const entry of readdirSync(nodeModules)) {
    const dir = join(nodeModules, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
      const pkgJsonPath = join(dir, "package.json");
      if (!existsSync(pkgJsonPath)) continue;
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
        name?: string;
        version?: string;
      };
      out.push({
        name: pkg.name ?? `@snsoft/${entry}`,
        version: pkg.version ?? "unknown",
        dir,
      });
    } catch {
      // Skip unreadable entries — broken installs shouldn't block discovery.
    }
  }
  return out;
}
