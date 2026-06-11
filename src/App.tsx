import { useEffect, useCallback, useState, lazy, Suspense } from "react";
import { protocolFromSnsoftPackageSpec } from "@penguin/core";
import { useAppStore, useActiveTab, getDefaultHeadersForProtocol, visibleProtocolForTab, type ProtocolTab } from "@/lib/store";
import { usePackages } from "@/hooks/usePackages";
import { useEnvironments } from "@/hooks/useEnvironments";
import { useAppUpdateScheduler } from "@/hooks/useAppUpdateScheduler";
import { interpolate } from "@/lib/environment-store";
import { Header } from "@/components/layout/Header";
import { UpdateNotification } from "@/components/layout/UpdateNotification";
import { TabBar } from "@/components/layout/TabBar";
import { Sidebar } from "@/components/layout/Sidebar";
import { UrlBar } from "@/components/layout/UrlBar";
import { VaultPage } from "@/components/vault/VaultPage";
import { ApiDocsPage } from "@/components/docs/ApiDocsPage";
import { HomePage } from "@/components/home/HomePage";
import { PENGUIN_OPEN_SETTINGS_EVENT, PENGUIN_GO_HOME_EVENT } from "@/components/vault/VaultEmptyGate";
import { initializeDevModeOnAppStart } from "@/lib/dev-mode-store";
import { RequestPanel } from "@/components/request/RequestPanel";
import { ResponsePanel } from "@/components/request/ResponsePanel";
import { SnowLayer } from "@/components/theme/SnowLayer";
import { ResizablePanels } from "@/components/ui/resizable-panels";

const PackageInstaller = lazy(() => import("@/components/packages/PackageInstaller").then(m => ({ default: m.PackageInstaller })));
const EnvManager = lazy(() => import("@/components/environment/EnvManager").then(m => ({ default: m.EnvManager })));
const SettingsDialog = lazy(() => import("@/components/settings/SettingsDialog").then(m => ({ default: m.SettingsDialog })));
const CommandSearch = lazy(() => import("@/components/search/CommandSearch").then(m => ({ default: m.CommandSearch })));
const HistoryPanel = lazy(() => import("@/components/history/HistoryPanel").then(m => ({ default: m.HistoryPanel })));
const SavedRequestsPanel = lazy(() => import("@/components/saved/SavedRequestsPanel").then(m => ({ default: m.SavedRequestsPanel })));
const NewRequestDialog = lazy(() => import("@/components/request/NewRequestDialog").then(m => ({ default: m.NewRequestDialog })));
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
    removeTab,
    resetPackageTabs,
    sanitizeHiddenRestTabs,
    updateActiveTab,
    isInstallerOpen,
    setInstallerOpen,
    addInstallLog,
    clearInstallLog,
    theme,
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
  const [newRequestOpen, setNewRequestOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [networkOpen, setNetworkOpen] = useState(false);
  const [curlImportOpen, setCurlImportOpen] = useState(false);
  const [protoViewerOpen, setProtoViewerOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [homeOpen, setHomeOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeVault = useCallback(() => setVaultOpen(false), []);
  const toggleVault = useCallback(() => {
    setDocsOpen(false);
    setVaultOpen((v) => !v);
  }, []);
  const openHome = useCallback(() => {
    setVaultOpen(false);
    setDocsOpen(false);
    setHomeOpen(true);
  }, []);
  const selectApiClient = useCallback(() => {
    setVaultOpen(false);
    setDocsOpen(false);
    setHomeOpen(false);
  }, []);
  const selectVaultFromHome = useCallback(() => {
    setHomeOpen(false);
    setDocsOpen(false);
    setVaultOpen(true);
  }, []);
  const selectDocsFromHome = useCallback(() => {
    setHomeOpen(false);
    setVaultOpen(false);
    setDocsOpen(true);
  }, []);
  const appUpdate = useAppUpdateScheduler(openSettings);
  const handlePackagesCleared = useCallback(async () => {
    resetPackageTabs();
    await refresh();
  }, [refresh, resetPackageTabs]);

  useEffect(() => {
    sanitizeHiddenRestTabs();
  }, [sanitizeHiddenRestTabs]);

  // Restore Dev Mode token at boot so once-on stays on across sessions —
  // Dev Mode boolean is hydrated synchronously by the store; the token has
  // to be pulled off disk asynchronously here.
  useEffect(() => {
    void initializeDevModeOnAppStart();
  }, []);

  const resolvedUrl = activeEnv
    ? interpolate(activeTab?.targetUrl ?? "", activeEnv)
    : null;

  const handleCycleProtocol = useCallback(() => {
    if (!activeTabId || !activeTab) return;

    const order = ["grpc-web", "grpc", "sdk"] as const;
    const idx = order.indexOf(visibleProtocolForTab(activeTab.protocolTab));
    const nextProtocol = order[(idx +1) % order.length];

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
    async (spec: string, overrideProtocol?: ProtocolTab): Promise<boolean> => {
      const protocol = overrideProtocol ?? protocolFromSnsoftPackageSpec(spec);
      if (!protocol || protocol === "rest") return false;

      clearInstallLog();
      addInstallLog(`Installing ${spec}...`);

      const { installPackage } = await import("@/lib/package-manager");
      const ok = await installPackage(
        protocol,
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
          setNewRequestOpen(true);
          break;
        case "w": {
          e.preventDefault();
          if (activeTabId) {
            removeTab(activeTabId);
          }
          break;
        }
        case "r":
          e.preventDefault();
          if (activeTab) {
            updateActiveTab({
              requestBody: "{}",
              response: undefined,
              selectedMethod: null,
              selectedService: null,
              selectedPackage: null,
              metadata: getDefaultHeadersForProtocol(activeTab.protocolTab),
            });
          }
          refresh();
          document.dispatchEvent(new CustomEvent("penguin:collapse-sidebar"));
          break;
        case "s":
          e.preventDefault();
          if (e.shiftKey) {
            document.dispatchEvent(new CustomEvent("penguin:save-request"));
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
          document.dispatchEvent(new CustomEvent("penguin:send-request"));
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
    removeTab,
    refresh,
    setInstallerOpen,
    handleCycleProtocol,
  ]);

  useEffect(() => {
    const openDoc = () => setDocOpen(true);
    const openProto = () => setProtoViewerOpen(true);
    document.addEventListener("penguin:open-doc", openDoc);
    document.addEventListener("penguin:open-proto", openProto);
    return () => {
      document.removeEventListener("penguin:open-doc", openDoc);
      document.removeEventListener("penguin:open-proto", openProto);
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
      setNewRequestOpen(false);
      setShortcutsOpen(false);
      setNetworkOpen(false);
      setCurlImportOpen(false);
      setProtoViewerOpen(false);
    };
    document.addEventListener("penguin:close-all-dialogs", closeAll);
    return () => document.removeEventListener("penguin:close-all-dialogs", closeAll);
  }, [setInstallerOpen]);

  // Listens for VaultEmptyGate's request to open Settings — see DEC #57 / #59.
  useEffect(() => {
    const handleOpenSettings = () => setSettingsOpen(true);
    document.addEventListener(PENGUIN_OPEN_SETTINGS_EVENT, handleOpenSettings);
    return () => document.removeEventListener(PENGUIN_OPEN_SETTINGS_EVENT, handleOpenSettings);
  }, []);

  // Listens for a "go home" request from inside any module (e.g. the Lark
  // setup card's close button) — pops back to the Home hub instead of the
  // API client default.
  useEffect(() => {
    const handleGoHome = (): void => {
      setVaultOpen(false);
      setDocsOpen(false);
      setHomeOpen(true);
    };
    document.addEventListener(PENGUIN_GO_HOME_EVENT, handleGoHome);
    return () => document.removeEventListener(PENGUIN_GO_HOME_EVENT, handleGoHome);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      useAppStore.getState().theme
    );
  }, []);

  return (
    <div className="penguin-app-shell relative h-screen w-screen overflow-hidden bg-background text-foreground">
      <SnowLayer active={theme === "antarctic-snow"} />
      <div className="relative z-10 flex h-full flex-col">
        <Header
          onOpenSettings={openSettings}
          onToggleVault={toggleVault}
          isVaultOpen={vaultOpen}
          onOpenHome={openHome}
          appUpdate={appUpdate}
        />
        <UpdateNotification
          open={appUpdate.shouldShowToast}
          updateVersion={appUpdate.updateVersion}
          isWorking={appUpdate.status === "downloading"}
          downloadProgress={appUpdate.downloadProgress}
          onLater={appUpdate.dismiss}
          onUpdate={appUpdate.downloadInstallAndRestart}
        />
        {homeOpen ? (
          <HomePage
            onSelectApiClient={selectApiClient}
            onSelectVault={selectVaultFromHome}
            onSelectDocs={selectDocsFromHome}
          />
        ) : vaultOpen ? (
          <VaultPage onClose={closeVault} />
        ) : docsOpen ? (
          <ApiDocsPage onClose={openHome} />
        ) : (
          <>
            <TabBar
              onCycleProtocol={handleCycleProtocol}
              onNewRequest={() => setNewRequestOpen(true)}
            />
            <div className="flex flex-1 min-h-0">
            <Sidebar
              packages={packages}
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
          </>
        )}

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
              appUpdate={appUpdate}
              onPackagesCleared={handlePackagesCleared}
            />
          )}
          {envManagerOpen && (
            <EnvManager onClose={() => setEnvManagerOpen(false)} />
          )}
          {searchOpen && <CommandSearch open={searchOpen} onClose={() => setSearchOpen(false)} />}
          {historyOpen && <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />}
          {savedOpen && <SavedRequestsPanel open={savedOpen} onClose={() => setSavedOpen(false)} />}
          {newRequestOpen && <NewRequestDialog open={newRequestOpen} onClose={() => setNewRequestOpen(false)} />}
          {docOpen && <RequestDocDialog open={docOpen} onClose={() => setDocOpen(false)} />}
          {shortcutsOpen && <ShortcutCheatSheet open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />}
          {networkOpen && <NetworkCheck open={networkOpen} onClose={() => setNetworkOpen(false)} />}
          {curlImportOpen && <CurlImport open={curlImportOpen} onClose={() => setCurlImportOpen(false)} />}
          {protoViewerOpen && <ProtoViewer open={protoViewerOpen} onClose={() => setProtoViewerOpen(false)} />}
          <Welcome />
          <InteractiveTutorial />
        </Suspense>
      </div>
    </div>
  );
}
