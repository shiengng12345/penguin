import { useEffect, useCallback, useState, lazy, Suspense } from "react";
import { useAppStore, useActiveTab, createTab, getDefaultHeadersForProtocol } from "@/lib/store";
import { usePackages } from "@/hooks/usePackages";
import { useEnvironments } from "@/hooks/useEnvironments";
import { interpolate } from "@/lib/environment-store";
import { Header } from "@/components/layout/Header";
import { TabBar } from "@/components/layout/TabBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { UrlBar } from "@/components/layout/UrlBar";
import { RequestPanel } from "@/components/request/RequestPanel";
import { ResponsePanel } from "@/components/request/ResponsePanel";
import { ResizablePanels } from "@/components/ui/resizable-panels";

const PackageInstaller = lazy(() => import("@/components/packages/PackageInstaller").then(m => ({ default: m.PackageInstaller })));
const EnvManager = lazy(() => import("@/components/environment/EnvManager").then(m => ({ default: m.EnvManager })));
const SettingsDialog = lazy(() => import("@/components/settings/SettingsDialog").then(m => ({ default: m.SettingsDialog })));
const CommandSearch = lazy(() => import("@/components/search/CommandSearch").then(m => ({ default: m.CommandSearch })));
const HistoryPanel = lazy(() => import("@/components/history/HistoryPanel").then(m => ({ default: m.HistoryPanel })));
const SavedRequestsPanel = lazy(() => import("@/components/saved/SavedRequestsPanel").then(m => ({ default: m.SavedRequestsPanel })));
const RequestDocDialog = lazy(() => import("@/components/request/RequestDocDialog").then(m => ({ default: m.RequestDocDialog })));
const ShortcutCheatSheet = lazy(() => import("@/components/shortcuts/ShortcutCheatSheet").then(m => ({ default: m.ShortcutCheatSheet })));
const NetworkCheck = lazy(() => import("@/components/network/NetworkCheck").then(m => ({ default: m.NetworkCheck })));
const CurlImport = lazy(() => import("@/components/environment/CurlImport").then(m => ({ default: m.CurlImport })));
const ProtoViewer = lazy(() => import("@/components/request/ProtoViewer").then(m => ({ default: m.ProtoViewer })));
const InteractiveTutorial = lazy(() => import("@/components/onboarding/InteractiveTutorial").then(m => ({ default: m.InteractiveTutorial })));
const Welcome = lazy(() => import("@/components/onboarding/Welcome").then(m => ({ default: m.Welcome })));

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [envManagerOpen, setEnvManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [curlImportOpen, setCurlImportOpen] = useState(false);
  const [protoViewerOpen, setProtoViewerOpen] = useState(false);

  const displayPackages = packages;

  const resolvedUrl = activeEnv
    ? interpolate(activeTab?.targetUrl ?? "", activeEnv)
    : null;

  const handleCycleProtocol = useCallback(() => {
    if (!activeTabId || !activeTab) return;

    const order = ["grpc-web", "grpc", "sdk"] as const;
    const idx = order.indexOf(activeTab.protocolTab);
    const nextProtocol = order[(idx +1) % 3];

    const allPkgs =
      nextProtocol === "grpc-web"
        ? useAppStore.getState().grpcWebPackages
        : nextProtocol === "grpc"
          ? useAppStore.getState().grpcPackages
          : useAppStore.getState().sdkPackages;

    const methodName = activeTab.selectedMethod?.name;
    let matchedMethod: typeof activeTab.selectedMethod = null;
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

    const newMetadata = getDefaultHeadersForProtocol(nextProtocol);
    if (matchedMethod) {
      updateActiveTab({
        protocolTab: nextProtocol,
        selectedPackage: matchedPkg,
        selectedService: matchedSvc,
        selectedMethod: matchedMethod,
        metadata: newMetadata,
      });
    } else {
      updateActiveTab({
        protocolTab: nextProtocol,
        metadata: newMetadata,
      });
    }
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

      const { installPackage } = await import("@/lib/package-manager");
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
            metadata: getDefaultHeadersForProtocol(activeTab?.protocolTab ?? "grpc-web"),
          });
          refresh();
          document.dispatchEvent(new CustomEvent("pengvi:collapse-sidebar"));
          break;
        case "s":
          e.preventDefault();
          if (e.shiftKey) {
            document.dispatchEvent(new CustomEvent("pengvi:save-request"));
          } else {
            setInstallerOpen(true);
          }
          break;
        case "e":
          e.preventDefault();
          handleCycleProtocol();
          break;
        case "h":
          e.preventDefault();
          setHistoryOpen((o) => !o);
          break;
        case "o":
          e.preventDefault();
          setSavedOpen((o) => !o);
          break;
        case "d":
          e.preventDefault();
          setDocOpen((o) => !o);
          break;
        case "enter":
          e.preventDefault();
          document.dispatchEvent(new CustomEvent("pengvi:send-request"));
          break;
        case "/":
          e.preventDefault();
          setShortcutsOpen((o) => !o);
          break;
        case "p":
          e.preventDefault();
          setProtoViewerOpen((o) => !o);
          break;
        case "i":
          e.preventDefault();
          if (e.shiftKey) {
            setCurlImportOpen((o) => !o);
          } else {
            setNetworkOpen((o) => !o);
          }
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
    const openDoc = () => setDocOpen(true);
    const openProto = () => setProtoViewerOpen(true);
    document.addEventListener("pengvi:open-doc", openDoc);
    document.addEventListener("pengvi:open-proto", openProto);
    return () => {
      document.removeEventListener("pengvi:open-doc", openDoc);
      document.removeEventListener("pengvi:open-proto", openProto);
    };
  }, []);

  useEffect(() => {
    const closeAll = () => {
      setInstallerOpen(false);
      setSearchOpen(false);
      setHistoryOpen(false);
      setSavedOpen(false);
      setDocOpen(false);
      setEnvManagerOpen(false);
      setSettingsOpen(false);
      setShortcutsOpen(false);
      setNetworkOpen(false);
      setCurlImportOpen(false);
      setProtoViewerOpen(false);
    };
    document.addEventListener("pengvi:close-all-dialogs", closeAll);
    return () => document.removeEventListener("pengvi:close-all-dialogs", closeAll);
  }, [setInstallerOpen]);

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
          <ResizablePanels
            left={<RequestPanel />}
            right={<ResponsePanel />}
            defaultRatio={0.45}
            minRatio={0.25}
            maxRatio={0.75}
          />
        </div>
      </div>

      <Suspense fallback={null}>
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
        {searchOpen && <CommandSearch open={searchOpen} onClose={() => setSearchOpen(false)} />}
        {historyOpen && <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />}
        {savedOpen && <SavedRequestsPanel open={savedOpen} onClose={() => setSavedOpen(false)} />}
        {docOpen && <RequestDocDialog open={docOpen} onClose={() => setDocOpen(false)} />}
        {shortcutsOpen && <ShortcutCheatSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />}
        {networkOpen && <NetworkCheck open={networkOpen} onClose={() => setNetworkOpen(false)} />}
        {curlImportOpen && <CurlImport open={curlImportOpen} onClose={() => setCurlImportOpen(false)} />}
        {protoViewerOpen && <ProtoViewer open={protoViewerOpen} onClose={() => setProtoViewerOpen(false)} />}
        <Welcome />
        <InteractiveTutorial />
      </Suspense>
    </div>
  );
}
