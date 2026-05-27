import type { ConnectServiceDef } from "./types";

// Inspects the runtime exports of an installed @snsoft package and walks the
// generated *Connect modules to recover ConnectRPC service descriptors. Pure
// reflection — no Tauri / fs / network access. Caller is responsible for
// loading the module (Pengvi uses Tauri invoke + blob URL, Node consumers can
// use plain dynamic import).
export function discoverServices(
  packageExports: Record<string, unknown>,
): { services: ConnectServiceDef[]; serviceMap: Map<string, ConnectServiceDef> } {
  const services: ConnectServiceDef[] = [];
  const serviceMap = new Map<string, ConnectServiceDef>();

  for (const [exportName, exportValue] of Object.entries(packageExports)) {
    if (!exportName.endsWith("Connect") || typeof exportValue !== "object" || !exportValue)
      continue;

    for (const [, propValue] of Object.entries(
      exportValue as Record<string, unknown>,
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
