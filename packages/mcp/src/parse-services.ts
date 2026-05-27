// Single entry point that produces a uniform ProtoService[] for any protocol.
// Replaces the per-protocol switch that the original list_methods handler had
// — describe_method, list_methods, and any future tool that wants schema can
// now share one code path. Reads the same .proto / *_pb.d.ts / .d.ts files the
// desktop app discovers (via the Rust list_installed_packages command).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseProtoContent, parseSdkDts, type ProtoService } from "@penguin/core";
import { protocolDir, type Protocol } from "./penguin-paths.js";

function walk(dir: string, predicate: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) out.push(...walk(full, predicate));
    else if (predicate(entry)) out.push(full);
  }
  return out;
}

export function packageDir(protocol: Protocol, packageName: string): string {
  return join(protocolDir(protocol), "node_modules", packageName);
}

// In-process cache for parser output. parseProtoContent / parseSdkDts each
// walk the package tree and JSON.parse every .d.ts — cheap individually but
// search_methods runs it across every installed package on every call, so
// even a tiny memoization pays off. Keyed by (protocol, packageName) and
// invalidated via the package.json mtime: npm install rewrites it on every
// upgrade, so a changed mtime is a reliable "schema may have changed" signal.
const parseCache = new Map<string, { mtimeMs: number; services: ProtoService[] }>();

function packageJsonMtime(dir: string): number {
  const pkgJson = join(dir, "package.json");
  if (!existsSync(pkgJson)) return 0;
  try {
    return statSync(pkgJson).mtimeMs;
  } catch {
    return 0;
  }
}

export function parseServicesForPackage(
  protocol: Protocol,
  packageName: string,
): ProtoService[] {
  const dir = packageDir(protocol, packageName);
  if (!existsSync(dir)) {
    // Surface what IS available so the caller can self-correct instead of
    // playing twenty questions with the AI agent.
    const scopeRoot = join(protocolDir(protocol), "node_modules", "@snsoft");
    const available = existsSync(scopeRoot) ? readdirSync(scopeRoot) : [];
    const hint = available.length
      ? ` Installed @snsoft packages for ${protocol}: ${available
          .map((n) => `@snsoft/${n}`)
          .join(", ")}.`
      : ` No @snsoft packages installed for ${protocol} yet — try install_package.`;
    throw new Error(`Package ${packageName} not installed for ${protocol}.${hint}`);
  }

  const cacheKey = `${protocol}:${packageName}`;
  const mtimeMs = packageJsonMtime(dir);
  const cached = parseCache.get(cacheKey);
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.services;
  }

  let services: ProtoService[];

  if (protocol === "sdk") {
    const moduleDir = join(dir, "dist", "module");
    if (!existsSync(moduleDir)) {
      throw new Error(`SDK dist/module dir missing at ${moduleDir}`);
    }
    // Recursively pick up every .d.ts under dist/module — including
    // interfaces/request/*.d.ts which holds the actual request shapes. The
    // parser figures out which file is a class vs. an interface library.
    const dtsFiles = walk(moduleDir, (n) => n.endsWith(".d.ts")).map((p) => ({
      // Path relative to moduleDir so the parser's "skip files inside
      // interfaces/" check can fire on the right tokens.
      name: p.slice(moduleDir.length + 1),
      content: readFileSync(p, "utf-8"),
    }));
    services = parseSdkDts(dtsFiles);
  } else {
    // grpc + grpc-web both ship .proto plus generated *_pb.d.ts / *_connect.d.ts.
    // parseProtoContent handles both shapes and produces requestFields with the
    // schema info AI tools need to construct a valid body.
    const files = walk(
      dir,
      (n) =>
        n.endsWith(".proto") ||
        n.endsWith("_connect.d.ts") ||
        n.endsWith("_pb.d.ts"),
    ).map((p) => ({ name: basename(p), content: readFileSync(p, "utf-8") }));
    services = parseProtoContent(files);
  }

  parseCache.set(cacheKey, { mtimeMs, services });
  return services;
}
