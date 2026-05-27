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

export function parseServicesForPackage(
  protocol: Protocol,
  packageName: string,
): ProtoService[] {
  const dir = packageDir(protocol, packageName);
  if (!existsSync(dir)) {
    throw new Error(`Package ${packageName} not installed for ${protocol}`);
  }

  if (protocol === "sdk") {
    const moduleDir = join(dir, "dist", "module");
    if (!existsSync(moduleDir)) {
      throw new Error(`SDK dist/module dir missing at ${moduleDir}`);
    }
    const dtsFiles = readdirSync(moduleDir)
      .filter((f) => f.endsWith(".d.ts"))
      .map((f) => ({
        name: f,
        content: readFileSync(join(moduleDir, f), "utf-8"),
      }));
    return parseSdkDts(dtsFiles);
  }

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
  return parseProtoContent(files);
}
