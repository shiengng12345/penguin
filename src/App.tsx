import { useEffect, useCallback, useState } from "react";
import { useAppStore, useActiveTab, createTab } from "@/lib/store";
import { usePackages } from "@/hooks/usePackages";
import { useEnvironments } from "@/hooks/useEnvironments";
import { interpolate } from "@/lib/environment-store";
import { Header } from "@/components/layout/Header";
import { TabBar } from "@/components/layout/TabBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { UrlBar } from "@/components/layout/UrlBar";
import { RequestPanel } from "@/components/request/RequestPanel";
import { ResponsePanel } from "@/components/request/ResponsePanel";
import { PackageInstaller } from "@/components/packages/PackageInstaller";
import { EnvManager } from "@/components/environment/EnvManager";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { CommandSearch } from "@/components/search/CommandSearch";
import { Tutorial } from "@/components/onboarding/Tutorial";
import { Welcome } from "@/components/onboarding/Welcome";
import { installPackage } from "@/lib/package-manager";

export default function App() {
  const {
    activeTabId,
    addTab,
    removeTab,
    updateActiveTab,
    isInstallerOpen,
    setInstallerOpen,
    addInstallLog,
    clearInstallLog,
  } = useAppStore();

  const { packages, refresh, uninstall } = usePackages();
  const { activeEnv } = useEnvironments();
  const activeTab = useActiveTab();

  const [searchOpen, setSearchOpen] = useState(false);
  const [envManagerOpen, setEnvManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const displayPackages = packages;

  const resolvedUrl = activeEnv
    ? interpolate(activeTab?.targetUrl ?? "", activeEnv)
    : null;

  const handleCycleProtocol = useCallback(() => {
    if (!activeTabId || !activeTab) return;

    const order = ["grpc-web", "grpc", "sdk"] as const;
    const idx = order.indexOf(activeTab.protocolTab);
    const nextProtocol = order[(idx + 1) % 3];

    const allPkgs =
      nextProtocol === "grpc-web"
        ? useAppStore.getState().grpcWebPackages
        : nextProtocol === "grpc"
          ? useAppStore.getState().grpcPackages
          : useAppStore.getState().sdkPackages;

    const methodName = activeTab.selectedMethod?.name;
    let matchedMethod = null;
    let matchedPkg: string | null = null;
    let matchedSvc: string | null = null;

    if (methodName) {
      for (const pkg of allPkgs) {
        for (const svc of pkg.services) {
          const m = svc.methods.find(
            (mm) => mm.name.toLowerCase() === methodName.toLowerCase()
          );
          if (m) {
            matchedMethod = m;
            matchedPkg = pkg.name;
            matchedSvc = svc.fullName;
            break;
          }
        }
        if (matchedMethod) break;
      }
    }

    updateActiveTab({
      protocolTab: nextProtocol,
      selectedPackage: matchedPkg,
      selectedService: matchedSvc,
      selectedMethod: matchedMethod,
    });
  }, [activeTabId, activeTab, updateActiveTab]);

  const handleInstall = useCallback(
    async (spec: string): Promise<boolean> => {
      const lower = spec.toLowerCase();
      const protocol = lower.includes("js-sdk")
        ? "sdk"
        : lower.includes("grpc-web") || lower.includes("grpcweb")
          ? "grpc-web"
          : "grpc";

      clearInstallLog();
      addInstallLog(`Installing ${spec}...`);

      const ok = await installPackage(
        protocol as "grpc-web" | "grpc" | "sdk",
        spec,
        addInstallLog
      );

      if (ok) {
        await refresh();
      }
      return ok;
    },
    [addInstallLog, clearInstallLog, refresh]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;

      switch (e.key.toLowerCase()) {
        case "f":
          e.preventDefault();
          setSearchOpen((o) => !o);
          break;
        case "n":
          e.preventDefault();
          addTab();
          break;
        case "w": {
          e.preventDefault();
          const state = useAppStore.getState();
          if (state.tabs.length <= 1) {
            const fresh = createTab();
            useAppStore.setState({ tabs: [fresh], activeTabId: fresh.id });
            document.dispatchEvent(new CustomEvent("pengvi:collapse-sidebar"));
          } else if (activeTabId) {
            removeTab(activeTabId);
          }
          break;
        }
        case "r":
          e.preventDefault();
          updateActiveTab({
            requestBody: "{}",
            response: undefined,
            selectedMethod: null,
            selectedService: null,
            selectedPackage: null,
            metadata: [
              { key: "Authorization", value: "Bearer ", enabled: true },
              { key: "eId", value: "", enabled: true },
            ],
          });
          refresh();
          document.dispatchEvent(new CustomEvent("pengvi:collapse-sidebar"));
          break;
        case "s":
          e.preventDefault();
          setInstallerOpen(true);
          break;
        case "e":
          e.preventDefault();
          handleCycleProtocol();
          break;
        case "enter":
          e.preventDefault();
          document.dispatchEvent(new CustomEvent("pengvi:send-request"));
          break;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    activeTabId,
    addTab,
    removeTab,
    refresh,
    setInstallerOpen,
    handleCycleProtocol,
  ]);

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      useAppStore.getState().theme
    );
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Header onOpenSettings={() => setSettingsOpen(true)} />
      <TabBar onCycleProtocol={handleCycleProtocol} />

      <div className="flex flex-1 min-h-0">
        <Sidebar
          packages={displayPackages}
          onInstallClick={() => setInstallerOpen(true)}
          onUninstall={(name) => {
            uninstall(name);
          }}
          onUpdate={async (spec) => {
            const ok = await handleInstall(spec);
            return ok;
          }}
        />

        <div className="flex flex-1 flex-col min-w-0">
          <UrlBar resolvedUrl={resolvedUrl} />
          <div className="flex flex-1 min-h-0">
            <RequestPanel />
            <ResponsePanel />
          </div>
        </div>
      </div>

      {isInstallerOpen && (
        <PackageInstaller
          onInstall={handleInstall}
          onClose={() => setInstallerOpen(false)}
        />
      )}

      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onOpenEnvManager={() => setEnvManagerOpen(true)}
        />
      )}

      {envManagerOpen && (
        <EnvManager onClose={() => setEnvManagerOpen(false)} />
      )}

      <CommandSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
      <Welcome />
      <Tutorial />
    </div>
  );
}
