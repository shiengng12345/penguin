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
  type MetadataEntry,
  type ProtoMethod,
  type ResponseState,
} from "@penguin/core";
import {
  findEnvironment,
  getSection,
  readConfig,
  type EnvironmentEntry,
} from "./config.js";
import {
  listInstalledPackages,
  protocolDir,
  type Protocol,
} from "./penguin-paths.js";
import { parseServicesForPackage } from "./parse-services.js";
import {
  installPackageViaNpm,
  makeLoadModule,
  nodeSidecarRunner,
} from "./runners.js";

const PROTOCOLS: readonly Protocol[] = ["grpc-web", "grpc", "sdk"] as const;

function asMetadata(headers: Record<string, string> | undefined): MetadataEntry[] {
  if (!headers) return [];
  return Object.entries(headers).map(([k, v]) => ({ key: k, value: v, enabled: true }));
}

function findMethod(
  protocol: Protocol,
  packageName: string,
  serviceName: string,
  methodName: string,
): { service: { fullName: string }; method: ProtoMethod } {
  const services = parseServicesForPackage(protocol, packageName);
  // Match by short name OR fullName so callers can pass either "Auth" or
  // "pengvi.auth.Auth". Methods are matched case-insensitively because SDK
  // uses camelCase ("lookupNationalId") while proto uses PascalCase
  // ("LookupNationalId") — same RPC, different stringly-typed conventions.
  const service = services.find(
    (s) => s.name === serviceName || s.fullName === serviceName,
  );
  if (!service) {
    throw new Error(
      `Service ${serviceName} not found in ${packageName} (have: ${services
        .map((s) => s.fullName)
        .join(", ")})`,
    );
  }
  const lowered = methodName.toLowerCase();
  const method = service.methods.find(
    (m) => m.name === methodName || m.name.toLowerCase() === lowered,
  );
  if (!method) {
    throw new Error(
      `Method ${methodName} not found on ${service.fullName} (have: ${service.methods
        .map((m) => m.name)
        .join(", ")})`,
    );
  }
  return { service, method };
}

async function invokeRpc(args: {
  protocol: Protocol;
  url: string;
  body: string;
  metadata: MetadataEntry[];
  servicePath?: string;
  packageName?: string;
  serviceName?: string;
  methodName?: string;
}): Promise<ResponseState> {
  if (args.protocol === "grpc-web") {
    return await callGrpcWeb({
      url: args.url,
      servicePath: args.servicePath as string,
      body: args.body,
      metadata: args.metadata,
      packageName: args.packageName,
      loadModule: makeLoadModule("grpc-web"),
    });
  }
  if (args.protocol === "grpc") {
    return await callGrpcNative(
      {
        url: args.url,
        servicePath: args.servicePath as string,
        body: args.body,
        metadata: args.metadata,
        packagesDir: protocolDir("grpc"),
      },
      nodeSidecarRunner,
    );
  }
  return await callSdk(
    {
      url: args.url,
      serviceName: args.serviceName as string,
      methodName: args.methodName as string,
      body: args.body,
      metadata: args.metadata,
      packagesDir: protocolDir("sdk"),
    },
    nodeSidecarRunner,
  );
}

// Extract the @snsoft package name out of a config-declared spec like
// "@snsoft/auth-grpc-web@1.2.3" or bare "@snsoft/auth-grpc-web". Returns null
// for shapes we don't understand so package_status surfaces them as-is.
function packageNameFromSpec(spec: string): string | null {
  if (!spec.startsWith("@")) return null;
  // "@snsoft/foo" or "@snsoft/foo@1.2.3"
  const firstSlash = spec.indexOf("/");
  if (firstSlash === -1) return null;
  const afterScope = spec.slice(firstSlash + 1);
  const at = afterScope.indexOf("@");
  const namePart = at === -1 ? afterScope : afterScope.slice(0, at);
  return `${spec.slice(0, firstSlash)}/${namePart}`;
}

function jsonResult(value: unknown, isError = false) {
  return {
    isError: isError || undefined,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
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
      name: "describe_method",
      description:
        "Return one RPC method's full schema — request/response type names plus the nested FieldInfo trees (name, type, repeated, optional, enumValues). Use this before call_method to construct a valid body without guessing field names. Note: SDK packages currently expose method names only (no field schema yet).",
      inputSchema: {
        type: "object",
        required: ["protocol", "packageName", "serviceName", "methodName"],
        properties: {
          protocol: { type: "string", enum: ["grpc-web", "grpc", "sdk"] },
          packageName: { type: "string", description: "e.g. @snsoft/auth-grpc-web" },
          serviceName: {
            type: "string",
            description: "Short name (e.g. 'Auth') or fullName (e.g. 'pengvi.auth.Auth')",
          },
          methodName: {
            type: "string",
            description: "PascalCase or camelCase — match is case-insensitive",
          },
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
      name: "list_environments",
      description:
        "List environments configured in .penguin config — name, color, and variables (URL, X_ENV_TAG, TOKEN, ...). Optional `protocol` filter.",
      inputSchema: {
        type: "object",
        properties: {
          protocol: { type: "string", enum: ["grpc-web", "grpc", "sdk"] },
        },
      },
    },
    {
      name: "resolve_environment",
      description:
        "Look up one environment by name and return its URL + variables. Useful for composing call_method args (URL field comes from variables.URL; X_ENV_TAG is typically sent as the `x-env-tag` header).",
      inputSchema: {
        type: "object",
        required: ["protocol", "environmentName"],
        properties: {
          protocol: { type: "string", enum: ["grpc-web", "grpc", "sdk"] },
          environmentName: { type: "string" },
        },
      },
    },
    {
      name: "package_status",
      description:
        "Diagnose package install state — lists every package declared in .penguin config alongside what's actually present in ~/.penguin/<protocol>/node_modules, plus any installed packages that aren't declared. Useful when debugging 'why is this method missing?'",
      inputSchema: {
        type: "object",
        properties: {
          protocol: { type: "string", enum: ["grpc-web", "grpc", "sdk"] },
        },
      },
    },
    {
      name: "compare_environments",
      description:
        "Invoke the same RPC across multiple environments and return all responses side-by-side. The AI can then diff them. Each environment's URL is resolved from .penguin config by name.",
      inputSchema: {
        type: "object",
        required: ["protocol", "environmentNames", "body"],
        properties: {
          protocol: { type: "string", enum: ["grpc-web", "grpc", "sdk"] },
          environmentNames: {
            type: "array",
            items: { type: "string" },
            description: "Two or more environment names from list_environments",
          },
          servicePath: { type: "string", description: "grpc-web/grpc only" },
          packageName: { type: "string", description: "grpc-web only — for module loading" },
          serviceName: { type: "string", description: "sdk only" },
          methodName: { type: "string", description: "sdk only" },
          body: { type: "string", description: "JSON-stringified request body" },
          headers: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Extra HTTP headers applied to every environment",
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
      const all = (protocol ? [protocol] : PROTOCOLS).flatMap((p) =>
        listInstalledPackages(p).map((pkg) => ({ protocol: p, ...pkg })),
      );
      return jsonResult(all);
    }

    if (name === "list_methods") {
      const services = parseServicesForPackage(
        a.protocol as Protocol,
        a.packageName as string,
      );
      const summary = services.map((svc) => ({
        name: svc.name,
        fullName: svc.fullName,
        methods: svc.methods.map((m) => m.name),
      }));
      return jsonResult(summary);
    }

    if (name === "describe_method") {
      const { service, method } = findMethod(
        a.protocol as Protocol,
        a.packageName as string,
        a.serviceName as string,
        a.methodName as string,
      );
      return jsonResult({ service: service.fullName, ...method });
    }

    if (name === "install_package") {
      const result = await installPackageViaNpm(
        a.protocol as Protocol,
        a.packageSpec as string,
      );
      return jsonResult(
        {
          ok: result.ok,
          exitCode: result.code,
          dir: result.dir,
          npmBinary: result.npmBinary,
          output: result.output,
        },
        !result.ok,
      );
    }

    if (name === "list_environments") {
      const protocol = a.protocol as Protocol | undefined;
      const cfg = readConfig();
      const targets = protocol ? [protocol] : PROTOCOLS;
      const out = targets.flatMap((p) =>
        (getSection(cfg, p).environments ?? []).map((env) => ({
          protocol: p,
          ...env,
        })),
      );
      return jsonResult(out);
    }

    if (name === "resolve_environment") {
      const protocol = a.protocol as Protocol;
      const envName = a.environmentName as string;
      const env = findEnvironment(readConfig(), protocol, envName);
      if (!env) {
        throw new Error(
          `Environment ${envName} not found for ${protocol}. Run list_environments to see available ones.`,
        );
      }
      return jsonResult({
        protocol,
        name: env.name,
        url: env.variables.URL ?? "",
        variables: env.variables,
      });
    }

    if (name === "package_status") {
      const protocol = a.protocol as Protocol | undefined;
      const cfg = readConfig();
      const targets = protocol ? [protocol] : PROTOCOLS;
      const out = targets.map((p) => {
        const declared = getSection(cfg, p).packages ?? [];
        const installed = listInstalledPackages(p);
        const installedMap = new Map(installed.map((i) => [i.name, i.version]));

        const declaredStatus = declared.map((spec) => {
          const name = packageNameFromSpec(spec);
          const installedVersion = name ? installedMap.get(name) : undefined;
          return {
            spec,
            name,
            installed: installedVersion !== undefined,
            installedVersion: installedVersion ?? null,
          };
        });

        const declaredNames = new Set(
          declaredStatus.map((d) => d.name).filter((n): n is string => Boolean(n)),
        );
        const unmanaged = installed
          .filter((i) => !declaredNames.has(i.name))
          .map((i) => ({ name: i.name, version: i.version }));

        return { protocol: p, declared: declaredStatus, unmanaged };
      });
      return jsonResult(out);
    }

    if (name === "compare_environments") {
      const protocol = a.protocol as Protocol;
      const envNames = (a.environmentNames as string[]) ?? [];
      const body = (a.body as string) ?? "{}";
      const headers = a.headers as Record<string, string> | undefined;
      const metadata = asMetadata(headers);
      const cfg = readConfig();

      const results = await Promise.all(
        envNames.map(async (envName) => {
          const env = findEnvironment(cfg, protocol, envName);
          if (!env || !env.variables.URL) {
            return {
              environment: envName,
              error: env
                ? `Environment ${envName} has no URL variable`
                : `Environment ${envName} not found for ${protocol}`,
            };
          }
          try {
            const response = await invokeRpc({
              protocol,
              url: env.variables.URL,
              body,
              metadata,
              servicePath: a.servicePath as string | undefined,
              packageName: a.packageName as string | undefined,
              serviceName: a.serviceName as string | undefined,
              methodName: a.methodName as string | undefined,
            });
            return { environment: envName, url: env.variables.URL, response };
          } catch (err) {
            return {
              environment: envName,
              url: env.variables.URL,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );
      return jsonResult({ protocol, results });
    }

    if (name === "call_method") {
      const metadata = asMetadata(a.headers as Record<string, string> | undefined);
      const body = (a.body as string) ?? "{}";
      const result = await invokeRpc({
        protocol: a.protocol as Protocol,
        url: a.url as string,
        body,
        metadata,
        servicePath: a.servicePath as string | undefined,
        packageName: a.packageName as string | undefined,
        serviceName: a.serviceName as string | undefined,
        methodName: a.methodName as string | undefined,
      });
      return jsonResult(result);
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResult(`Error: ${msg}`, true);
  }
});

// Silence the unused-import warning while keeping EnvironmentEntry in the
// public surface — downstream tooling may want to import it from this module.
export type { EnvironmentEntry };

const transport = new StdioServerTransport();
await server.connect(transport);
