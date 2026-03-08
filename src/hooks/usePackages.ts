import { useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  installPackage,
  uninstallPackage,
  listInstalledPackages,
} from "@/lib/package-manager";
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

interface ConfigSection {
  packages?: string[];
  environments?: unknown[];
}

interface PengviConfig {
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

  let config: PengviConfig;
  try {
    config = JSON.parse(configRaw);
  } catch {
    return;
  }

  const section = config[protocol];
  const specs = section?.packages ?? [];
  if (specs.length === 0) return;

  const installed = await listInstalledPackages(protocol);
  const installedNames = new Set(installed.map((p) => p.name));

  for (const spec of specs) {
    const atIdx = spec.lastIndexOf("@");
    const nameOnly = atIdx > 0 ? spec.substring(0, atIdx) : spec;
    const fullName = nameOnly.includes("/") ? nameOnly : `@snsoft/${nameOnly}`;
    if (installedNames.has(fullName)) continue;

    try {
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
      await installPackage(protocol, packageSpec, addInstallLog);
      await refresh();
    },
    [addInstallLog, refresh]
  );

  const uninstall = useCallback(
    async (packageName: string) => {
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

      const others: ProtocolTab[] = ["grpc-web", "grpc", "sdk"].filter(
        (p) => p !== protocolTab
      ) as ProtocolTab[];
      for (const p of others) {
        await listInstalledPackages(p);
        if (cancelled) return;
      }
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

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return { packages, refresh, install, uninstall };
}
