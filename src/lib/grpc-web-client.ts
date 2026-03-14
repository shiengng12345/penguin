import { createClient, type Interceptor } from "@connectrpc/connect";
import { createGrpcWebTransport } from "@connectrpc/connect-web";
import type { ResponseState, MetadataEntry } from "./store";
import {
  loadPackageModule,
  discoverServices,
  type ConnectServiceDef,
} from "./package-loader";
import { proxyFetch } from "./proxy-fetch";

interface GrpcWebCallParams {
  url: string;
  servicePath: string;
  body: string;
  metadata: MetadataEntry[];
  packageName?: string;
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

const serviceCache = new Map<string, ConnectServiceDef>();

async function ensureServiceLoaded(
  packageName: string,
  typeName: string
): Promise<ConnectServiceDef | null> {
  if (serviceCache.has(typeName)) {
    return serviceCache.get(typeName)!;
  }

  const mod = await loadPackageModule(packageName);
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
  const { url, servicePath, body, metadata, packageName } = params;

  try {
    let parsedBody: Record<string, unknown>;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      throw new Error("Invalid JSON request body / 无效的 JSON 请求体");
    }

    const pathParts = servicePath.replace(/^\//, "").split("/");
    if (pathParts.length < 3) {
      throw new Error(
        `Invalid service path: ${servicePath}. Expected /<package>/<typeName>/<method>`
      );
    }

    const protoPackage = pathParts[0];
    const typeName = pathParts.slice(1, -1).join(".");
    const methodName = pathParts[pathParts.length - 1];

    if (!packageName) {
      throw new Error(
        "Package name is required for gRPC-Web calls. Select a method from an installed package."
      );
    }

    const serviceDef = await ensureServiceLoaded(packageName, typeName);
    if (!serviceDef) {
      throw new Error(
        `Service definition not found: ${typeName}. Ensure the package is installed and contains this service.`
      );
    }

    const methodNameLower = methodName[0].toLowerCase() +methodName.slice(1);
    const resolvedMethodName =
      serviceDef.methods[methodName] ? methodName
      : serviceDef.methods[methodNameLower] ? methodNameLower
      : Object.keys(serviceDef.methods).find(
          (k) => k.toLowerCase() === methodName.toLowerCase()
        );

    if (!resolvedMethodName || !serviceDef.methods[resolvedMethodName]) {
      throw new Error(
        `Method ${methodName} not found on service ${typeName}. Available: ${Object.keys(serviceDef.methods).join(", ")}`
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
      fetch: proxyFetch,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = createClient(serviceDef as any, transport);
    const dynamicClient = client as Record<
      string,
      ((data?: unknown) => Promise<unknown>) | undefined
    >;

    const clientMethod = dynamicClient[resolvedMethodName];
    if (!clientMethod) {
      throw new Error(`Method ${resolvedMethodName} does not exist on the generated client`);
    }

    const isEmpty =
      !parsedBody || Object.keys(parsedBody).length === 0;
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
        "x-pengvi-request-url": `${baseUrl}/${typeName}/${methodName}`,
        "x-pengvi-protocol": "grpc-web+proto",
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
