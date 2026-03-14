import { useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openPenguinSite } from "@/lib/external-links";
import { useAppStore, type ProtocolTab, type MetadataEntry } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  X,
  Trash2,
  Loader2,
  CheckCircle,
  Plus,
  Copy,
  ClipboardPaste,
  Download,
  Upload,
  Globe,
  Server,
  Box,
  User,
  Pencil,
  RefreshCw,
  ArrowDownToLine,
  RotateCcw,
  BookOpenText,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PROTOCOL_TABS: { id: ProtocolTab; label: string; icon: typeof Globe }[] = [
  { id: "grpc-web", label: "gRPC-Web", icon: Globe },
  { id: "grpc", label: "gRPC", icon: Server },
  { id: "sdk", label: "SDK", icon: Box },
];

const HISTORY_SIZES = [100, 200, 500, 1000];

interface SettingsDialogProps {
  onClose: () => void;
  onOpenEnvManager: () => void;
}

export function SettingsDialog({
  onClose,
  onOpenEnvManager,
}: SettingsDialogProps) {
  const [clearing, setClearing] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [exportMode, setExportMode] = useState<"idle" | "export" | "import">("idle");
  const [importText, setImportText] = useState("");
  const [importStatus, setImportStatus] = useState<"idle" | "success" | "error">("idle");
  const [copied, setCopied] = useState(false);
  const [headerProtocol, setHeaderProtocol] = useState<ProtocolTab>("grpc-web");
  const [editingName, setEditingName] = useState(false);
  const exportRef = useRef<HTMLTextAreaElement>(null);

  const userName = useAppStore((s) => s.userName);
  const setUserName = useAppStore((s) => s.setUserName);
  const [draftName, setDraftName] = useState(userName);
  const maxHistorySize = useAppStore((s) => s.maxHistorySize);
  const setMaxHistorySize = useAppStore((s) => s.setMaxHistorySize);
  const defaultHeaders = useAppStore((s) => s.defaultHeaders);
  const setDefaultHeaders = useAppStore((s) => s.setDefaultHeaders);
  const historyCount = useAppStore((s) => s.history.length);

  const [appVersion, setAppVersion] = useState<string>("");
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "available" | "up-to-date" | "downloading" | "ready" | "error"
  >("idle");
  const [updateInfo, setUpdateInfo] = useState<Update | null>(null);
  const [updateError, setUpdateError] = useState<string>("");
  const [downloadProgress, setDownloadProgress] = useState(0);

  useState(() => {
    getVersion().then(setAppVersion).catch(() => setAppVersion("unknown"));
  });

  const handleCheckUpdate = useCallback(async () => {
    setUpdateStatus("checking");
    setUpdateError("");
    try {
      const update = await check();
      if (update) {
        setUpdateInfo(update);
        setUpdateStatus("available");
      } else {
        setUpdateStatus("up-to-date");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("fetch") || msg.includes("release") || msg.includes("remote")) {
        setUpdateStatus("up-to-date");
      } else {
        setUpdateError(msg);
        setUpdateStatus("error");
      }
    }
  }, []);

  const handleDownloadAndInstall = useCallback(async () => {
    if (!updateInfo) return;
    setUpdateStatus("downloading");
    setDownloadProgress(0);
    try {
      let totalLen = 0;
      let downloaded = 0;
      await updateInfo.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalLen = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (totalLen > 0) {
            setDownloadProgress(Math.round((downloaded / totalLen) * 100));
          }
        } else if (event.event === "Finished") {
          setDownloadProgress(100);
        }
      });
      setUpdateStatus("ready");
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err));
      setUpdateStatus("error");
    }
  }, [updateInfo]);

  const handleRelaunch = useCallback(async () => {
    await relaunch();
  }, []);

  const currentHeaders = defaultHeaders[headerProtocol];

  const handleClearCache = () => {
    setClearing(true);
    setCleared(false);
    localStorage.clear();
    invoke<string>("clear_all_packages").catch((err) =>
      console.error("Failed to clear packages:", err),
    );
    window.location.reload();
  };

  const updateHeader = (index: number, patch: Partial<MetadataEntry>) => {
    const next = [...currentHeaders];
    next[index] = { ...next[index], ...patch };
    setDefaultHeaders(headerProtocol, next);
  };

  const addHeader = () => {
    setDefaultHeaders(headerProtocol, [
      ...currentHeaders,
      { key: "", value: "", enabled: true },
    ]);
  };

  const removeHeader = (index: number) => {
    setDefaultHeaders(
      headerProtocol,
      currentHeaders.filter((_, i) => i !== index),
    );
  };

  const buildExportData = () => {
    const s = useAppStore.getState();
    return JSON.stringify(
      {
        version: 1,
        environments: {
          "grpc-web": s.grpcWebEnvironments,
          grpc: s.grpcEnvironments,
          sdk: s.sdkEnvironments,
        },
        activeEnvIds: {
          "grpc-web": s.grpcWebActiveEnvId,
          grpc: s.grpcActiveEnvId,
          sdk: s.sdkActiveEnvId,
        },
        savedRequests: s.savedRequests,
        history: s.history,
        defaultHeaders: s.defaultHeaders,
        maxHistorySize: s.maxHistorySize,
        theme: s.theme,
        userName: s.userName,
      },
      null,
      2,
    );
  };

  const handleImport = () => {
    try {
      const data = JSON.parse(importText.trim());
      const s = useAppStore.getState();

      if (data.environments) {
        if (data.environments["grpc-web"]) s.setGrpcWebEnvironments(data.environments["grpc-web"]);
        if (data.environments.grpc) s.setGrpcEnvironments(data.environments.grpc);
        if (data.environments.sdk) s.setSdkEnvironments(data.environments.sdk);
      }
      if (data.activeEnvIds) {
        if (data.activeEnvIds["grpc-web"] !== undefined) s.setGrpcWebActiveEnvId(data.activeEnvIds["grpc-web"]);
        if (data.activeEnvIds.grpc !== undefined) s.setGrpcActiveEnvId(data.activeEnvIds.grpc);
        if (data.activeEnvIds.sdk !== undefined) s.setSdkActiveEnvId(data.activeEnvIds.sdk);
      }
      if (Array.isArray(data.savedRequests)) {
        useAppStore.setState({ savedRequests: data.savedRequests });
        localStorage.setItem("pengvi-saved-requests", JSON.stringify(data.savedRequests));
      }
      if (Array.isArray(data.history)) {
        useAppStore.setState({ history: data.history });
        localStorage.setItem("pengvi-history", JSON.stringify(data.history));
      }
      if (data.defaultHeaders) {
        for (const p of ["grpc-web", "grpc", "sdk"] as ProtocolTab[]) {
          if (data.defaultHeaders[p]) s.setDefaultHeaders(p, data.defaultHeaders[p]);
        }
      }
      if (typeof data.maxHistorySize === "number") s.setMaxHistorySize(data.maxHistorySize);
      if (data.theme) s.setTheme(data.theme);
      if (data.userName) s.setUserName(data.userName);

      setImportStatus("success");
      setTimeout(() => setImportStatus("idle"), 2000);
    } catch {
      setImportStatus("error");
      setTimeout(() => setImportStatus("idle"), 2000);
    }
  };

  const handleCopyExport = () => {
    exportRef.current?.select();
    navigator.clipboard.writeText(exportRef.current?.value ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-hidden rounded-lg border border-border bg-popover shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4 shrink-0">
          <h2 className="text-lg font-semibold text-foreground">
            Settings / 设置
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Display Name */}
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" />
              Display Name / 显示名称
            </h3>
            {editingName ? (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draftName.trim()) {
                    setUserName(draftName.trim());
                    setEditingName(false);
                  }
                }}
              >
                <Input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Enter your name"
                  autoFocus
                  className="h-8 flex-1 text-sm"
                  autoCorrect="off"
                  autoCapitalize="words"
                  spellCheck={false}
                />
                <Button type="submit" size="sm" className="h-8" disabled={!draftName.trim()}>
                  Save
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={() => {
                    setDraftName(userName);
                    setEditingName(false);
                  }}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="mt-2 flex items-center justify-between">
                <span className="text-sm text-foreground">{userName}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => {
                    setDraftName(userName);
                    setEditingName(true);
                  }}
                >
                  <Pencil className="mr-1 h-3 w-3" />
                  Edit
                </Button>
              </div>
            )}
          </div>

          {/* App Updates */}
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <ArrowDownToLine className="h-3.5 w-3.5" />
              App Updates / 应用更新
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Current version: <span className="font-mono">{appVersion || "..."}</span>
            </p>

            <div className="mt-3">
              {updateStatus === "idle" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={handleCheckUpdate}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Check for Updates
                </Button>
              )}

              {updateStatus === "checking" && (
                <Button variant="outline" size="sm" className="w-full" disabled>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Checking...
                </Button>
              )}

              {updateStatus === "up-to-date" && (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs text-green-500">
                    <CheckCircle className="h-3.5 w-3.5" />
                    You're up to date!
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={handleCheckUpdate}
                  >
                    Check again
                  </Button>
                </div>
              )}

              {updateStatus === "available" && updateInfo && (
                <div className="space-y-2">
                  <p className="text-xs text-foreground">
                    New version <span className="font-mono font-semibold">{updateInfo.version}</span> is available.
                  </p>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={handleDownloadAndInstall}
                  >
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Download & Install
                  </Button>
                </div>
              )}

              {updateStatus === "downloading" && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
                    <span className="text-xs text-foreground">
                      Downloading... {downloadProgress}%
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {updateStatus === "ready" && (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs text-green-500">
                    <CheckCircle className="h-3.5 w-3.5" />
                    Update installed! Restart to apply.
                  </p>
                  <Button size="sm" className="w-full" onClick={handleRelaunch}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Restart Now
                  </Button>
                </div>
              )}

              {updateStatus === "error" && (
                <div className="space-y-2">
                  <p className="text-xs text-destructive">
                    Update check failed: {updateError}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={handleCheckUpdate}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Try Again
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Max History Size */}
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <h3 className="text-sm font-medium text-foreground">
              Max History Size / 最大历史记录数
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Currently {historyCount} entries. Older entries are trimmed automatically.
            </p>
            <div className="mt-3 flex gap-1.5">
              {HISTORY_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setMaxHistorySize(size)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    maxHistorySize === size
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent"
                  )}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          {/* Default Headers per Protocol */}
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <h3 className="text-sm font-medium text-foreground">
              Default Headers / 默认请求头
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Auto-populate headers when creating new tabs.
            </p>
            <div className="mt-3 flex gap-1 mb-3">
              {PROTOCOL_TABS.map((pt) => {
                const Icon = pt.icon;
                return (
                  <button
                    key={pt.id}
                    type="button"
                    onClick={() => setHeaderProtocol(pt.id)}
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                      headerProtocol === pt.id
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-accent"
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {pt.label}
                  </button>
                );
              })}
            </div>
            <div className="space-y-2">
              {currentHeaders.map((h, i) => (
                <div key={i} className="flex gap-1.5">
                  <Input
                    value={h.key}
                    onChange={(e) => updateHeader(i, { key: e.target.value })}
                    placeholder="Key"
                    className="h-7 flex-1 font-mono text-xs"
                  />
                  <Input
                    value={h.value}
                    onChange={(e) => updateHeader(i, { value: e.target.value })}
                    placeholder="Value"
                    className="h-7 flex-1 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => removeHeader(i)}
                    className="h-7 w-7 shrink-0 rounded flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-full text-xs"
                onClick={addHeader}
              >
                <Plus className="mr-1 h-3 w-3" />
                Add Header
              </Button>
            </div>
          </div>

          {/* Export / Import */}
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <h3 className="text-sm font-medium text-foreground">
              Export / Import Config
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Transfer environments, saved requests, history, and settings.
            </p>
            {exportMode === "idle" && (
              <div className="mt-3 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => setExportMode("export")}
                >
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Export
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    setExportMode("import");
                    setImportText("");
                    setImportStatus("idle");
                  }}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Import
                </Button>
              </div>
            )}
            {exportMode === "export" && (
              <div className="mt-3 space-y-2">
                <textarea
                  ref={exportRef}
                  readOnly
                  value={buildExportData()}
                  className="w-full h-40 rounded-md border border-border bg-background p-2 font-mono text-[10px] text-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setExportMode("idle")}
                  >
                    Back
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={handleCopyExport}
                  >
                    {copied ? (
                      <>
                        <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1.5 h-3.5 w-3.5" />
                        Copy All
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
            {exportMode === "import" && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="Paste exported JSON here..."
                  className="w-full h-40 rounded-md border border-border bg-background p-2 font-mono text-[10px] text-foreground resize-none placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setExportMode("idle")}
                  >
                    Back
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={!importText.trim()}
                    onClick={handleImport}
                  >
                    {importStatus === "success" ? (
                      <>
                        <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                        Imported!
                      </>
                    ) : importStatus === "error" ? (
                      <>
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Invalid JSON
                      </>
                    ) : (
                      <>
                        <ClipboardPaste className="mr-1.5 h-3.5 w-3.5" />
                        Apply Import
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Manage Environments */}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              onClose();
              onOpenEnvManager();
            }}
          >
            Manage Environments / 管理环境
          </Button>

          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <BookOpenText className="h-3.5 w-3.5" />
              Guide Website / 文档站
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Open the Penguin website for overview, tutorial, and full docs.
            </p>
            <Button
              variant="outline"
              className="mt-3 w-full"
              onClick={() => {
                void openPenguinSite();
              }}
            >
              Open Penguin Website
            </Button>
          </div>

          {/* Clear Cache */}
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <h3 className="text-sm font-medium text-foreground">
              Clear Cache / 清除缓存
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Remove all installed packages. Environments and settings are preserved.
            </p>
            <Button
              variant="destructive"
              size="sm"
              className="mt-3 w-full"
              disabled={clearing}
              onClick={handleClearCache}
            >
              {clearing ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Clearing...
                </>
              ) : cleared ? (
                <>
                  <CheckCircle className="mr-1.5 h-3.5 w-3.5" />
                  Cache Cleared!
                </>
              ) : (
                <>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Clear All Packages
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
