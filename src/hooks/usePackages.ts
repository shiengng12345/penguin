import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "@/lib/store";
import { useActiveTab } from "@/lib/store";
import type { ProtocolTab } from "@/lib/store";
import type { InstalledPackage } from "@/lib/store";

function detectProtocol(spec: string): ProtocolTab {
  const lower = spec.toLowerCase();
  if (lower.includes("js-sdk")) return "sdk";
  if (lower.includes("grpc-web") || lower.includes("grpcweb")) return "grpc-web";
  return "grpc";
}

// Mirror of `.penguin.config.json` per-protocol section. Only `packages` is
// consumed here; environments live under their own loader and are not read
// from this hook.
interface ConfigSection {
  packages?: string[];
}

interface PenguinConfig {
  grpc?: ConfigSection;
  "grpc-web"?: ConfigSection;
  sdk?: ConfigSection;
}

async function autoInstallFromConfig(
  protocol: ProtocolTab,
  addInstallLog: (line: string) => void
): Promise<void> {
  let configRaw: string;
  try {
    configRaw = await invoke<string>("read_config");
  } catch {
    return;
  }
  if (!configRaw?.trim()) return;

  let config: PenguinConfig;
  try {
    config = JSON.parse(configRaw);
  } catch {
    return;
  }

  const section = config[protocol];
  const specs = section?.packages ?? [];
  if (specs.length === 0) return;

  const { listInstalledPackages } = await import("@/lib/package-manager");
  const installed = await listInstalledPackages(protocol);
  const installedNames = new Set(installed.map((p) => p.name));

  for (const spec of specs) {
    const atIdx = spec.lastIndexOf("@");
    const nameOnly = atIdx > 0 ? spec.substring(0, atIdx) : spec;
    const fullName = nameOnly.includes("/") ? nameOnly : `@snsoft/${nameOnly}`;
    if (installedNames.has(fullName)) continue;

    try {
      const { installPackage } = await import("@/lib/package-manager");
      const ok = await installPackage(protocol, spec, addInstallLog);
      if (ok) installedNames.add(fullName);
    } catch (e) {
      addInstallLog(`Auto-install failed for ${spec}: ${String(e)}`);
    }
  }
}

export function usePackages(): {
  packages: InstalledPackage[];
  refresh: () => Promise<void>;
  install: (packageSpec: string, overrideProtocol?: ProtocolTab) => Promise<void>;
  uninstall: (packageName: string) => Promise<void>;
} {
  const tab = useActiveTab();
  const protocolTab = tab?.protocolTab ?? "grpc-web";

  const {
    setGrpcWebPackages,
    setGrpcPackages,
    setSdkPackages,
    addInstallLog,
  } = useAppStore();

  const packages =
    protocolTab === "grpc-web"
      ? useAppStore((s) => s.grpcWebPackages)
      : protocolTab === "grpc"
        ? useAppStore((s) => s.grpcPackages)
        : useAppStore((s) => s.sdkPackages);

  const refresh = useCallback(async () => {
    const sortByName = (pkgs: InstalledPackage[]) =>
      [...pkgs].sort((a, b) => a.name.localeCompare(b.name));

    const { listInstalledPackages } = await import("@/lib/package-manager");
    const [gw, grpc, sdk] = await Promise.all([
      listInstalledPackages("grpc-web"),
      listInstalledPackages("grpc"),
      listInstalledPackages("sdk"),
    ]);
    setGrpcWebPackages(sortByName(gw));
    setGrpcPackages(sortByName(grpc));
    setSdkPackages(sortByName(sdk));
  }, [setGrpcWebPackages, setGrpcPackages, setSdkPackages]);

  const install = useCallback(
    async (packageSpec: string, overrideProtocol?: ProtocolTab) => {
      const protocol = overrideProtocol ?? detectProtocol(packageSpec);
      const { installPackage } = await import("@/lib/package-manager");
      await installPackage(protocol, packageSpec, addInstallLog);
      await refresh();
    },
    [addInstallLog, refresh]
  );

  const uninstall = useCallback(
    async (packageName: string) => {
      const { uninstallPackage } = await import("@/lib/package-manager");
      await uninstallPackage(protocolTab, packageName, addInstallLog);
      await refresh();
    },
    [protocolTab, addInstallLog, refresh]
  );

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      await refresh();
      if (cancelled) return;

      try {
        const configRaw = await invoke<string>("read_config");
        if (!configRaw?.trim()) return;

        const allProtocols: ProtocolTab[] = ["grpc-web", "grpc", "sdk"];
        for (const protocol of allProtocols) {
          if (cancelled) return;
          await autoInstallFromConfig(protocol, addInstallLog);
        }
        if (cancelled) return;
        await refresh();
      } catch {
        // ignore config parse/read errors
      }
    };

    // Defer one tick so the UI paints first, but enqueue immediately — earlier
    // requestIdleCallback could be deferred long enough that the command
    // palette opened with empty packages, returning wrong/missing results.
    const id = setTimeout(() => { if (!cancelled) run(); }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, []);

  // Re-fetch when the Rust watcher reports a node_modules change. Lets
  // out-of-band installs (e.g. via the MCP server, or the user running
  // `npm i` themselves) reflect in the UI without a reload.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    listen("packages-changed", () => {
      refresh();
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refresh]);

  return { packages, refresh, install, uninstall };
}
