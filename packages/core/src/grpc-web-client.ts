import { createClient, type Interceptor } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import type { ResponseState, MetadataEntry, ConnectServiceDef } from "./types.js";
import { discoverServices } from "./discover-services.js";

// Module loader signature. Penguin desktop injects a Tauri-backed loader that
// reads bundle.js via the Rust side and dynamic-imports a blob URL; Node
// runtimes (MCP server, CLI) pass a plain dynamic-import wrapper.
export type LoadPackageModule = (
  packageName: string,
) => Promise<Record<string, unknown>>;

interface GrpcWebCallParams {
  url: string;
  servicePath: string;
  body: string;
  metadata: MetadataEntry[];
  packageName?: string;
  // Required — how to load the @snsoft package so we can extract Connect
  // service descriptors at runtime.
  loadModule: LoadPackageModule;
  // Optional — Penguin passes a Tauri proxy fetch to bypass CORS; Node
  // consumers can omit (defaults to globalThis.fetch).
  fetch?: typeof globalThis.fetch;
}

function cleanProtoResponse(result: unknown): string {
  const raw = JSON.stringify(result);
  const stripped = raw.replace(/,"_[a-zA-Z][a-zA-Z0-9]*":\s*"[^"]*"/g, "")
                      .replace(/"_[a-zA-Z][a-zA-Z0-9]*":\s*"[^"]*",?/g, "");
  try {
    return JSON.stringify(JSON.parse(stripped), null, 2);
  } catch {
    return JSON.stringify(JSON.parse(raw), null, 2);
  }
}

function buildErrorResponse(message: string, startTime: number): ResponseState {
  return {
    status: "ERROR",
    statusCode: 0,
    body: "",
    headers: {},
    duration: Math.round(performance.now() - startTime),
    error: message,
  };
}

const serviceCache = new Map<string, ConnectServiceDef>();

async function ensureServiceLoaded(
  packageName: string,
  typeName: string,
  loadModule: LoadPackageModule,
): Promise<ConnectServiceDef | null> {
  if (serviceCache.has(typeName)) {
    return serviceCache.get(typeName)!;
  }

  const mod = await loadModule(packageName);
  const { serviceMap } = discoverServices(mod);

  for (const [key, svc] of serviceMap) {
    serviceCache.set(key, svc);
  }

  return serviceMap.get(typeName) ?? null;
}

export async function callGrpcWeb(
  params: GrpcWebCallParams
): Promise<ResponseState> {
  const startTime = performance.now();
  const { url, servicePath, body, metadata, packageName, loadModule } = params;
  const fetchImpl = params.fetch ?? globalThis.fetch;

  // Validate JSON body — caller pasted this directly from the editor.
  let parsedBody: Record<string, unknown>;
  try {
    parsedBody = JSON.parse(body);
  } catch {
    return buildErrorResponse("Invalid JSON request body / 无效的 JSON 请求体", startTime);
  }

  // Service path must contain at least package, type, and method segments.
  const pathParts = servicePath.replace(/^\//, "").split("/");
  const isPathTooShort = pathParts.length < 3;
  if (isPathTooShort) {
    return buildErrorResponse(
      `Invalid service path: ${servicePath}. Expected /<package>/<typeName>/<method>`,
      startTime,
    );
  }

  const protoPackage = pathParts[0];
  const typeName = pathParts.slice(1, -1).join(".");
  const methodName = pathParts[pathParts.length - 1];

  // gRPC-Web needs the package name to load the generated client module.
  if (!packageName) {
    return buildErrorResponse(
      "Package name is required for gRPC-Web calls. Select a method from an installed package.",
      startTime,
    );
  }

  const serviceDef = await ensureServiceLoaded(packageName, typeName, loadModule);
  if (!serviceDef) {
    return buildErrorResponse(
      `Service definition not found: ${typeName}. Ensure the package is installed and contains this service.`,
      startTime,
    );
  }

  const methodNameLower = methodName[0].toLowerCase() +methodName.slice(1);
  const resolvedMethodName =
    serviceDef.methods[methodName] ? methodName
    : serviceDef.methods[methodNameLower] ? methodNameLower
    : Object.keys(serviceDef.methods).find(
        (k) => k.toLowerCase() === methodName.toLowerCase()
      );

  const methodMissingOnDef = !resolvedMethodName || !serviceDef.methods[resolvedMethodName];
  if (methodMissingOnDef) {
    return buildErrorResponse(
      `Method ${methodName} not found on service ${typeName}. Available: ${Object.keys(serviceDef.methods).join(", ")}`,
      startTime,
    );
  }

  const baseUrl = `${url.replace(/\/$/, "")}/${protoPackage}`;

  const headerInterceptor: Interceptor = (next) => async (req) => {
    for (const entry of metadata) {
      if (entry.enabled && entry.key.trim()) {
        req.header.set(entry.key, entry.value);
      }
    }
    return await next(req);
  };

  const transport = createGrpcWebTransport({
    baseUrl,
    interceptors: [headerInterceptor],
    fetch: fetchImpl,
  });

  // ConnectRPC service definition types are not exported publicly; the cast
  // bridges our discovered shape to its internal expected shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = createClient(serviceDef as any, transport);
  const dynamicClient = client as Record<
    string,
    ((data?: unknown) => Promise<unknown>) | undefined
  >;

  const clientMethod = dynamicClient[resolvedMethodName!];
  if (!clientMethod) {
    return buildErrorResponse(
      `Method ${resolvedMethodName} does not exist on the generated client`,
      startTime,
    );
  }

  // Only the network call is wrapped in try/catch — everything above is
  // pre-validation and now returns early. Errors here are gRPC ConnectErrors
  // (which carry .code and .rawMessage) or transport failures from fetch.
  try {
    const isEmpty = !parsedBody || Object.keys(parsedBody).length === 0;
    const result = isEmpty
      ? await clientMethod()
      : await clientMethod(parsedBody);

    const duration = performance.now() - startTime;
    const formattedBody = cleanProtoResponse(result);

    return {
      status: "OK",
      statusCode: 200,
      body: formattedBody,
      headers: {
        "x-penguin-request-url": `${baseUrl}/${typeName}/${methodName}`,
        "x-penguin-protocol": "grpc-web+proto",
      },
      duration: Math.round(duration),
    };
  } catch (error) {
    const duration = performance.now() - startTime;
    const errMsg =
      error instanceof Error ? error.message : String(error);

    const isConnectError =
      error &&
      typeof error === "object" &&
      "code" in error &&
      "rawMessage" in error;

    if (isConnectError) {
      const ce = error as { code: string; rawMessage: string; metadata?: Headers };
      const grpcHeaders: Record<string, string> = {
        "grpc-status": ce.code,
        "grpc-message": ce.rawMessage,
      };
      return {
        status: `gRPC ${ce.code}`,
        statusCode: 200,
        body: JSON.stringify(
          { code: ce.code, message: ce.rawMessage },
          null,
          2
        ),
        headers: grpcHeaders,
        duration: Math.round(duration),
      };
    }

    return {
      status: "ERROR",
      statusCode: 0,
      body: "",
      headers: {},
      duration: Math.round(duration),
      error: errMsg,
    };
  }
}
