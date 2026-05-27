#!/usr/bin/env node
// Penguin MCP server — exposes Penguin's installed @snsoft packages and
// protocol clients (gRPC-Web / gRPC native / @snsoft SDK) as MCP tools so AI
// assistants (Claude, Cursor, etc.) can list and call backend RPCs directly.
//
// Reads from the same ~/.penguin/ tree that the desktop app manages — packages
// you installed via Penguin UI work here automatically. No duplicate install.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  callGrpcWeb,
  callGrpcNative,
  callSdk,
  discoverServices,
  parseProtoContent,
  parseSdkDts,
  type MetadataEntry,
} from "@penguin/core";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
  listInstalledPackages,
  protocolDir,
  type Protocol,
} from "./penguin-paths.js";
import {
  installPackageViaNpm,
  makeLoadModule,
  nodeSidecarRunner,
} from "./runners.js";

function walk(dir: string, predicate: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let s;
    try { s = statSync(full); } catch { continue; }
    if (s.isDirectory()) out.push(...walk(full, predicate));
    else if (predicate(entry)) out.push(full);
  }
  return out;
}

// Each protocol's "what methods does this package expose?" is answered
// differently, so this dispatcher hides the asymmetry behind one signature.
async function listMethodsForPackage(protocol: Protocol, packageName: string) {
  const dir = join(protocolDir(protocol), "node_modules", packageName);
  if (!existsSync(dir)) {
    throw new Error(`Package ${packageName} not installed for ${protocol}`);
  }

  if (protocol === "grpc-web") {
    const mod = await makeLoadModule("grpc-web")(packageName);
    const { services } = discoverServices(mod);
    return services.map((svc) => ({
      typeName: svc.typeName,
      methods: Object.keys(svc.methods),
    }));
  }

  if (protocol === "grpc") {
    const files = walk(dir, (n) =>
      n.endsWith(".proto") || n.endsWith("_connect.d.ts") || n.endsWith("_pb.d.ts"),
    ).map((p) => ({ name: basename(p), content: readFileSync(p, "utf-8") }));
    const services = parseProtoContent(files);
    return services.map((svc) => ({
      typeName: svc.fullName,
      methods: svc.methods.map((m) => m.name),
    }));
  }

  // sdk
  const moduleDir = join(dir, "dist", "module");
  if (!existsSync(moduleDir)) {
    throw new Error(`SDK dist/module dir missing at ${moduleDir}`);
  }
  const dtsFiles = readdirSync(moduleDir)
    .filter((f) => f.endsWith(".d.ts"))
    .map((f) => ({ name: f, content: readFileSync(join(moduleDir, f), "utf-8") }));
  const services = parseSdkDts(dtsFiles);
  return services.map((svc) => ({
    typeName: svc.fullName,
    methods: svc.methods.map((m) => m.name),
  }));
}

function asMetadata(headers: Record<string, string> | undefined): MetadataEntry[] {
  if (!headers) return [];
  return Object.entries(headers).map(([k, v]) => ({ key: k, value: v, enabled: true }));
}

const server = new Server(
  { name: "penguin-mcp", version: "0.0.1" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "list_packages",
      description:
        "List @snsoft packages installed under ~/.penguin/. Optional `protocol` filter (grpc-web | grpc | sdk).",
      inputSchema: {
        type: "object",
        properties: {
          protocol: { type: "string", enum: ["grpc-web", "grpc", "sdk"] },
        },
      },
    },
    {
      name: "list_methods",
      description:
        "List services + methods exposed by a specific @snsoft package for a given protocol.",
      inputSchema: {
        type: "object",
        required: ["protocol", "packageName"],
        properties: {
          protocol: { type: "string", enum: ["grpc-web", "grpc", "sdk"] },
          packageName: { type: "string", description: "e.g. @snsoft/auth-grpc-web" },
        },
      },
    },
    {
      name: "install_package",
      description:
        "Install an @snsoft npm package into ~/.penguin/<protocol>/. Runs `npm install --save <packageSpec>` in the protocol's package dir. Penguin desktop's filesystem watcher will pick up the change and refresh the UI automatically.",
      inputSchema: {
        type: "object",
        required: ["protocol", "packageSpec"],
        properties: {
          protocol: { type: "string", enum: ["grpc-web", "grpc", "sdk"] },
          packageSpec: {
            type: "string",
            description:
              "npm spec, e.g. '@snsoft/auth-grpc-web' or '@snsoft/auth-grpc-web@1.2.3'",
          },
        },
      },
    },
    {
      name: "call_method",
      description:
        "Invoke an RPC method on the live backend. URL is the env target (e.g. https://fpms-nt-swim.platform88.me). For grpc-web/grpc, `servicePath` is /<package>/<typeName>/<method>; for sdk, `serviceName` + `methodName`.",
      inputSchema: {
        type: "object",
        required: ["protocol", "url", "body"],
        properties: {
          protocol: { type: "string", enum: ["grpc-web", "grpc", "sdk"] },
          url: { type: "string" },
          servicePath: { type: "string", description: "grpc-web/grpc only" },
          packageName: { type: "string", description: "grpc-web only — for module loading" },
          serviceName: { type: "string", description: "sdk only — e.g. Auth" },
          methodName: { type: "string", description: "sdk only — e.g. lookupNationalId" },
          body: { type: "string", description: "JSON-stringified request body" },
          headers: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Extra HTTP headers, e.g. {x-env-tag: brazil, platform-id: 550}",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const a = args as Record<string, unknown>;

  try {
    if (name === "list_packages") {
      const protocol = a.protocol as Protocol | undefined;
      const all = (protocol ? [protocol] : (["grpc-web", "grpc", "sdk"] as Protocol[]))
        .flatMap((p) =>
          listInstalledPackages(p).map((pkg) => ({ protocol: p, ...pkg })),
        );
      return { content: [{ type: "text", text: JSON.stringify(all, null, 2) }] };
    }

    if (name === "install_package") {
      const result = await installPackageViaNpm(
        a.protocol as Protocol,
        a.packageSpec as string,
      );
      return {
        isError: !result.ok,
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ok: result.ok,
                exitCode: result.code,
                dir: result.dir,
                npmBinary: result.npmBinary,
                output: result.output,
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    if (name === "list_methods") {
      const services = await listMethodsForPackage(
        a.protocol as Protocol,
        a.packageName as string,
      );
      return { content: [{ type: "text", text: JSON.stringify(services, null, 2) }] };
    }

    if (name === "call_method") {
      const metadata = asMetadata(a.headers as Record<string, string> | undefined);
      const body = (a.body as string) ?? "{}";

      if (a.protocol === "grpc-web") {
        const result = await callGrpcWeb({
          url: a.url as string,
          servicePath: a.servicePath as string,
          body,
          metadata,
          packageName: a.packageName as string | undefined,
          loadModule: makeLoadModule("grpc-web"),
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      if (a.protocol === "grpc") {
        const result = await callGrpcNative({
          url: a.url as string,
          servicePath: a.servicePath as string,
          body,
          metadata,
          packagesDir: protocolDir("grpc"),
        }, nodeSidecarRunner);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      if (a.protocol === "sdk") {
        const result = await callSdk({
          url: a.url as string,
          serviceName: a.serviceName as string,
          methodName: a.methodName as string,
          body,
          metadata,
          packagesDir: protocolDir("sdk"),
        }, nodeSidecarRunner);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      throw new Error(`Unknown protocol: ${a.protocol}`);
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [{ type: "text", text: `Error: ${msg}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
