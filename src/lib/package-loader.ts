import { invoke } from "@tauri-apps/api/core";

export interface ConnectMethodDef {
  name?: string;
  kind?: number;
  I?: { typeName: string; fields: unknown };
  O?: { typeName: string };
}

export interface ConnectServiceDef {
  typeName: string;
  methods: Record<string, ConnectMethodDef>;
}

interface PackageExports {
  [key: string]: unknown;
}

const moduleCache = new Map<string, PackageExports>();

export async function loadPackageModule(
  packageName: string,
  protocol: string = "grpc-web"
): Promise<PackageExports> {
  const cacheKey = `${protocol}:${packageName}`;
  if (moduleCache.has(cacheKey)) {
    return moduleCache.get(cacheKey)!;
  }

  const bundleJs: string = await invoke("read_package_bundle", {
    protocol,
    packageName,
  });

  const blob = new Blob([bundleJs], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);

  try {
    const mod = await import(/* @vite-ignore */ url);
    moduleCache.set(cacheKey, mod);
    return mod;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function discoverServices(
  packageExports: PackageExports
): { services: ConnectServiceDef[]; serviceMap: Map<string, ConnectServiceDef> } {
  const services: ConnectServiceDef[] = [];
  const serviceMap = new Map<string, ConnectServiceDef>();

  for (const [exportName, exportValue] of Object.entries(packageExports)) {
    if (!exportName.endsWith("Connect") || typeof exportValue !== "object" || !exportValue)
      continue;

    for (const [, propValue] of Object.entries(
      exportValue as Record<string, unknown>
    )) {
      if (
        propValue &&
        typeof propValue === "object" &&
        "typeName" in propValue &&
        "methods" in propValue
      ) {
        const svc = propValue as ConnectServiceDef;
        services.push(svc);
        serviceMap.set(svc.typeName, svc);
      }
    }
  }

  return { services, serviceMap };
}

export function clearModuleCache(packageName?: string): void {
  if (packageName) {
    moduleCache.delete(packageName);
  } else {
    moduleCache.clear();
  }
}
