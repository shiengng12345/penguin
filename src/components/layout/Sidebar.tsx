import { useAppStore, useActiveTab, type ProtoMethod, type InstalledPackage } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Package,
  Bookmark,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  Server,
  Zap,
  Globe,
  Network,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, useCallback } from "react";
import { openSavedRequest } from "@/lib/saved-request";
import { cn } from "@/lib/utils";

interface SidebarProps {
  packages: InstalledPackage[];
  onInstallClick: () => void;
  onUninstall: (name: string) => void;
  onUpdate: (packageSpec: string) => Promise<boolean>;
}

export function Sidebar({ packages, onInstallClick, onUninstall, onUpdate }: SidebarProps) {
  const { updateActiveTab, savedRequests } = useAppStore();
  const tab = useActiveTab();
  if (!tab) return null;

  const protocolTab = tab.protocolTab;
  const selectedPackage = tab.selectedPackage;
  const selectedService = tab.selectedService;
  const selectedMethod = tab.selectedMethod;

  const [expandedPkgs, setExpandedPkgs] = useState<Set<string>>(new Set());
  const [expandedSvcs, setExpandedSvcs] = useState<Set<string>>(new Set());
  const [updatingPkg, setUpdatingPkg] = useState<string | null>(null);
  const [newVersion, setNewVersion] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [sidebarView, setSidebarView] = useState<"packages" | "collections">("packages");
  const collectionEntries = savedRequests.filter((entry) => entry.protocol !== "rest");

  useEffect(() => {
    setExpandedPkgs(new Set());
    setExpandedSvcs(new Set());
    setSidebarView("packages");
  }, [protocolTab]);

  useEffect(() => {
    const collapse = () => {
      setExpandedPkgs(new Set());
      setExpandedSvcs(new Set());
    };
    const focusMethod = (e: Event) => {
      const { packageName, serviceName } = (e as CustomEvent).detail;
      setExpandedPkgs(new Set([packageName]));
      setExpandedSvcs(new Set([serviceName]));
    };
    document.addEventListener("penguin:collapse-sidebar", collapse);
    document.addEventListener("penguin:focus-method", focusMethod);
    return () => {
      document.removeEventListener("penguin:collapse-sidebar", collapse);
      document.removeEventListener("penguin:focus-method", focusMethod);
    };
  }, []);

  useEffect(() => {
    if (selectedPackage && selectedService) {
      setExpandedPkgs((prev) => {
        if (prev.has(selectedPackage)) return prev;
        return new Set(prev).add(selectedPackage);
      });
      setExpandedSvcs((prev) => {
        if (prev.has(selectedService)) return prev;
        return new Set(prev).add(selectedService);
      });
    }
  }, [selectedPackage, selectedService, selectedMethod]);

  const sortedPackages = useMemo(() => {
    return [...packages]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((pkg) => ({
        ...pkg,
        services: [...pkg.services]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((svc) => ({
            ...svc,
            methods: [...svc.methods].sort((a, b) => a.name.localeCompare(b.name)),
          })),
      }));
  }, [packages]);

  const effectivePkgs = expandedPkgs;
  const effectiveSvcs = expandedSvcs;

  const togglePkg = (name: string) => {
    const next = new Set(expandedPkgs);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    setExpandedPkgs(next);
    updateActiveTab({ selectedPackage: name, selectedService: null, selectedMethod: null });
  };

  const toggleSvc = (fullName: string) => {
    const next = new Set(expandedSvcs);
    if (next.has(fullName)) {
      next.delete(fullName);
    } else {
      next.add(fullName);
    }
    setExpandedSvcs(next);
    updateActiveTab({ selectedService: fullName, selectedMethod: null });
  };

  const handleMethodClick = async (pkgName: string, svcFullName: string, method: ProtoMethod) => {
    let body = "{}";
    if (method.requestFields && method.requestFields.length > 0) {
      const { generateDefaultJson } = await import("@/lib/proto-parser");
      body = JSON.stringify(generateDefaultJson(method.requestFields), null, 2);
    }
    updateActiveTab({
      selectedPackage: pkgName,
      selectedService: svcFullName,
      selectedMethod: method,
      requestBody: body,
      pathOverride: null,
    });
  };

  const handleStartUpdate = (e: React.MouseEvent, pkg: InstalledPackage) => {
    e.stopPropagation();
    setUpdatingPkg(pkg.name);
    setNewVersion("");
  };

  const handleCancelUpdate = () => {
    setUpdatingPkg(null);
    setNewVersion("");
  };

  const handleConfirmUpdate = async (pkgName: string) => {
    if (!newVersion.trim()) return;
    setIsUpdating(true);
    await onUpdate(`${pkgName}@${newVersion.trim()}`);
    setIsUpdating(false);
    setUpdatingPkg(null);
    setNewVersion("");
  };

  const selectedMethodRef = useCallback((el: HTMLDivElement | null) => {
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMethod?.fullName]);

  const extractVersion = (version: string) => {
    return version.replace(/^\^|~/, "");
  };

  const protocolName = protocolTab === "grpc-web" ? "gRPC-Web" : protocolTab === "sdk" ? "JS-SDK" : protocolTab === "rest" ? "REST" : "gRPC";
  const protocolIcon = protocolTab === "grpc-web" || protocolTab === "rest" ? (
    <Globe className="h-3.5 w-3.5 text-primary" />
  ) : protocolTab === "sdk" ? (
    <Zap className="h-3.5 w-3.5 text-primary" />
  ) : (
    <Network className="h-3.5 w-3.5 text-primary" />
  );

  const sidebarTabs = (
    <div className="grid grid-cols-2 border-b border-border px-2">
      <button
        type="button"
        aria-pressed={sidebarView === "packages"}
        onClick={() => setSidebarView("packages")}
        className={cn(
          "flex h-7 min-w-0 items-center justify-center gap-1.5 border-b-2 border-transparent px-2 text-[11px] font-medium transition-colors",
          sidebarView === "packages"
            ? "border-primary text-primary"
            : "text-muted-foreground hover:border-border hover:text-foreground",
        )}
      >
        <Package className="h-3 w-3 shrink-0" />
        <span className="truncate">Packages</span>
        <span
          className={cn(
            "ml-auto rounded px-1 py-0.5 text-[10px] leading-none",
            sidebarView === "packages"
              ? "bg-primary/10 text-primary"
              : "bg-muted/60 text-muted-foreground",
          )}
        >
          {packages.length}
        </span>
      </button>
      <button
        type="button"
        aria-pressed={sidebarView === "collections"}
        onClick={() => setSidebarView("collections")}
        className={cn(
          "flex h-7 min-w-0 items-center justify-center gap-1.5 border-b-2 border-transparent px-2 text-[11px] font-medium transition-colors",
          sidebarView === "collections"
            ? "border-primary text-primary"
            : "text-muted-foreground hover:border-border hover:text-foreground",
        )}
      >
        <Bookmark className="h-3 w-3 shrink-0" />
        <span className="truncate">Collections</span>
        <span
          className={cn(
            "ml-auto rounded px-1 py-0.5 text-[10px] leading-none",
            sidebarView === "collections"
              ? "bg-primary/10 text-primary"
              : "bg-muted/60 text-muted-foreground",
          )}
        >
          {collectionEntries.length}
        </span>
      </button>
    </div>
  );

  const collectionsContent = (
    <div className="flex-1 overflow-y-auto">
      {collectionEntries.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <Bookmark className="h-9 w-9 text-muted-foreground/45" />
          <p className="text-sm text-muted-foreground">No saved requests</p>
        </div>
      ) : (
        <div className="space-y-1 p-2">
          {collectionEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => openSavedRequest(entry)}
              className="flex w-full min-w-0 items-center gap-2 rounded border border-transparent px-2 py-2 text-left hover:border-border hover:bg-accent/50"
              title={entry.name}
            >
              <Bookmark className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">
                  {entry.name}
                </span>
                <span className="block truncate font-mono text-[10px] text-muted-foreground">
                  {entry.methodFullName || entry.url}
                </span>
              </span>
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">
                {entry.protocol === "grpc-web" ? "gw" : entry.protocol === "sdk" ? "js" : entry.protocol}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const restPackagesContent = (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
      <Server className="h-9 w-9 text-muted-foreground/45" />
      <p className="text-sm">Manual REST mode</p>
    </div>
  );

  const packagesContent = (
    <>
      <div className="flex-1 overflow-y-auto">
        {packages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <Package className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <p className="text-sm text-muted-foreground">
                No {protocolName} packages
              </p>
              <p className="text-xs text-muted-foreground/60">
                Click + to install a package
              </p>
            </div>
          </div>
        ) : (
          <div className="py-1">
            {sortedPackages.map((pkg) => (
              <div key={pkg.name}>
                <div
                  className={`group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-accent/50 ${
                    selectedPackage === pkg.name ? "bg-accent/30" : ""
                  }`}
                  onClick={() => togglePkg(pkg.name)}
                >
                  {effectivePkgs.has(pkg.name) ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <Package className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="flex-1 truncate text-xs font-medium">
                    {pkg.name.replace(/^@\w+\//, "")}
                  </span>
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {pkg.services.length}
                  </Badge>
                  <span
                    role="button"
                    className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center h-5 w-5 rounded cursor-pointer hover:bg-accent transition-opacity"
                    onClick={(e) => handleStartUpdate(e, pkg)}
                    title="Update version"
                  >
                    <RefreshCw className="h-3 w-3 text-primary" />
                  </span>
                  <span
                    role="button"
                    className="opacity-0 group-hover:opacity-100 inline-flex items-center justify-center h-5 w-5 rounded cursor-pointer hover:bg-destructive/20 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onUninstall(pkg.name);
                    }}
                    title="Uninstall"
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </span>
                </div>

                <div className="flex items-center gap-1 px-2 pl-8 pb-1">
                  <span className="text-[10px] text-muted-foreground/70 font-mono truncate">
                    v{extractVersion(pkg.version)}
                  </span>
                </div>

                {updatingPkg === pkg.name && (
                  <div className="mx-2 mb-1.5 p-2 rounded-md border border-border bg-background space-y-1.5">
                    <p className="text-[10px] text-muted-foreground">
                      New version for <span className="font-medium text-foreground">{pkg.name}</span>
                    </p>
                    <div className="flex gap-1">
                      <Input
                        value={newVersion}
                        onChange={(e) => setNewVersion(e.target.value)}
                        placeholder="1.0.0-20260308..."
                        className="h-6 flex-1 font-mono text-[10px] px-1.5"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleConfirmUpdate(pkg.name);
                          if (e.key === "Escape") handleCancelUpdate();
                        }}
                        autoFocus
                        disabled={isUpdating}
                      />
                      <Button
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => handleConfirmUpdate(pkg.name)}
                        disabled={!newVersion.trim() || isUpdating}
                      >
                        {isUpdating ? "..." : "Update"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={handleCancelUpdate}
                        disabled={isUpdating}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}

                {effectivePkgs.has(pkg.name) && (
                  <div className="ml-3">
                    {pkg.services.map((svc) => (
                      <div key={svc.fullName}>
                        <div
                          className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-accent/50 ${
                            selectedService === svc.fullName ? "bg-accent/30" : ""
                          }`}
                          onClick={() => toggleSvc(svc.fullName)}
                        >
                          {effectiveSvcs.has(svc.fullName) ? (
                            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                          )}
                          <Server className="h-3 w-3 shrink-0 text-success" />
                          <span className="truncate text-xs">{svc.name}</span>
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            {svc.methods.length}
                          </span>
                        </div>

                        {effectiveSvcs.has(svc.fullName) && (
                          <div className="ml-5">
                            {svc.methods.map((method) => (
                              <div
                                key={method.fullName}
                                ref={selectedMethod?.fullName === method.fullName ? selectedMethodRef : undefined}
                                className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-accent/50 rounded-sm ${
                                  selectedMethod?.fullName === method.fullName
                                    ? "bg-primary/10 text-primary"
                                    : ""
                                }`}
                                onClick={() => handleMethodClick(pkg.name, svc.fullName, method)}
                              >
                                <Zap className="h-3 w-3 shrink-0 text-warning" />
                                <span className="truncate text-xs">{method.name}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
        {packages.length} package{packages.length !== 1 ? "s" : ""} ·{" "}
        {packages.reduce((sum, p) => sum + p.services.length, 0)} services
      </div>
    </>
  );

  return (
    <aside className="flex h-full w-72 flex-col border-r border-border bg-card" data-tour="sidebar">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {protocolIcon}
          <span className="truncate text-sm font-medium text-muted-foreground">
            {protocolTab === "rest" ? "REST Requests" : `${protocolName} Packages`}
          </span>
        </div>
        {protocolTab !== "rest" && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onInstallClick} data-tour="install-btn">
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {sidebarTabs}

      {sidebarView === "packages"
        ? protocolTab === "rest"
          ? restPackagesContent
          : packagesContent
        : collectionsContent}
    </aside>
  );
}
