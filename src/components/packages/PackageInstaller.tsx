import { useState, useEffect, useRef } from "react";
import { useAppStore, useActiveTab } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Package, X, Download, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const PACKAGE_REGEX = /^@snsoft\/([\w-]+-(grpc-web|grpc)|js-sdk)@[\w.\-T]+$/;

function detectProtocol(spec: string): "grpc-web" | "grpc" | "sdk" | null {
  const lower = spec.toLowerCase();
  if (lower.includes("js-sdk")) return "sdk";
  if (lower.includes("grpc-web") || lower.includes("grpcweb")) return "grpc-web";
  if (lower.includes("grpc")) return "grpc";
  return null;
}

const PROTOCOL_LABELS: Record<string, string> = {
  "grpc-web": "gRPC-Web",
  grpc: "gRPC",
  sdk: "SDK",
};

interface PackageInstallerProps {
  onInstall: (spec: string) => Promise<boolean>;
  onClose: () => void;
}

const PLACEHOLDERS: Record<string, string> = {
  "grpc-web":
    "e.g. @snsoft/example-grpc-web@1.0.0",
  grpc: "e.g. @snsoft/example-grpc@1.0.0",
  sdk: "e.g. @snsoft/js-sdk@1.0.0",
};

export function PackageInstaller({ onInstall, onClose }: PackageInstallerProps) {
  const tab = useActiveTab();
  const protocolTab = tab?.protocolTab ?? "grpc-web";
  const installLog = useAppStore((s) => s.installLog);
  const clearInstallLog = useAppStore((s) => s.clearInstallLog);
  const [spec, setSpec] = useState("");
  const [isInstalling, setIsInstalling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { clearInstallLog(); }, []);

  useEffect(() => {
    const prefill = useAppStore.getState().installerPrefill;
    if (prefill) {
      setSpec(prefill);
      useAppStore.getState().setInstallerPrefill("");
      return;
    }
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.installerPrefill && state.installerPrefill !== prev.installerPrefill) {
        setSpec(state.installerPrefill);
        useAppStore.getState().setInstallerPrefill("");
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (isInstalling) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((t) => t +1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isInstalling]);

  const detectedProtocol = detectProtocol(spec);
  const isValid = PACKAGE_REGEX.test(spec.trim());

  const lastLog = installLog[installLog.length - 1] ?? "";
  const installDone =
    lastLog === "Installation complete!" ||
    lastLog === "Package removed!" ||
    lastLog.startsWith("Installation failed") ||
    lastLog.startsWith("Removal failed") ||
    lastLog.startsWith("Error:");

  const handleInstall = async () => {
    const trimmed = spec.trim();
    if (!trimmed || !isValid) return;

    setIsInstalling(true);

    try {
      const ok = await onInstall(trimmed);
      if (ok) {
        setSpec("");
      }
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        className="relative z-50 w-full max-w-lg rounded-lg border border-border bg-popover p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">
              Install Package / 安装包
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Package spec / 包规格
            </label>
            <div className="flex gap-2">
              <Input
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (installDone) { onClose(); return; }
                    if (isValid && !isInstalling) handleInstall();
                  }
                }}
                placeholder={PLACEHOLDERS[protocolTab] ?? PLACEHOLDERS["grpc-web"]}
                className="font-mono text-sm"
                disabled={isInstalling}
                autoFocus
              />
              {detectedProtocol && (
                <span
                  className={cn(
                    "flex shrink-0 items-center self-center rounded px-2 py-0.5 text-[10px] font-medium",
                    detectedProtocol === "grpc-web" && "bg-green-500/20 text-green-600 dark:text-green-400",
                    detectedProtocol === "grpc" && "bg-blue-500/20 text-blue-600 dark:text-blue-400",
                    detectedProtocol === "sdk" && "bg-purple-500/20 text-purple-600 dark:text-purple-400"
                  )}
                >
                  {PROTOCOL_LABELS[detectedProtocol] ?? detectedProtocol}
                </span>
              )}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Format: @snsoft/example-grpc-web@1.0.0 or @snsoft/js-sdk@1.0.0
            </p>
          </div>

          {(installLog.length > 0 || isInstalling) && (() => {
            const last = installLog[installLog.length - 1] ?? "";
            const isSuccess = last === "Installation complete!" || last === "Package removed!";
            const isFailed = last.startsWith("Installation failed") || last.startsWith("Removal failed") || last.startsWith("Error:");
            const isDone = isSuccess || isFailed;
            const logLines = isDone ? installLog.slice(0, -1) : installLog;

            const formatTime = (s: number) => {
              const m = Math.floor(s / 60);
              const sec = s % 60;
              return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
            };

            return (
              <div className="space-y-2">
                {logLines.length > 0 && (
                  <div className="rounded-md border border-border bg-muted/50 p-2 max-h-24 overflow-y-auto">
                    <div className="space-y-0.5 font-mono text-[10px] text-muted-foreground">
                      {logLines.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  </div>
                )}
                {isInstalling && !isDone && (
                  <div className="flex items-center gap-2.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2.5">
                    <Loader2 className="h-5 w-5 shrink-0 text-blue-500 animate-spin" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                        Downloading dependencies...
                      </p>
                      <p className="text-[10px] text-blue-600/70 dark:text-blue-400/70">
                        This may take a while for large packages / 大型包可能需要较长时间
                      </p>
                    </div>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-blue-600 dark:text-blue-400">
                      {formatTime(elapsed)}
                    </span>
                  </div>
                )}
                {isSuccess && (
                  <div className="flex items-center gap-2.5 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-green-600 dark:text-green-400">
                        {last === "Package removed!" ? "Removed successfully!" : "Installed successfully!"}
                      </p>
                      <p className="text-[10px] text-green-600/70 dark:text-green-400/70">
                        {last === "Package removed!"
                          ? "Package has been removed / 包已成功移除"
                          : `Package is ready to use (${formatTime(elapsed)}) / 安装成功`}
                      </p>
                    </div>
                    <kbd className="shrink-0 rounded border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 text-[9px] font-mono text-green-600 dark:text-green-400">
                      Enter ↵
                    </kbd>
                  </div>
                )}
                {isFailed && (
                  <div className="flex items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <XCircle className="h-5 w-5 shrink-0 text-red-500" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-red-600 dark:text-red-400">
                        Installation failed
                      </p>
                      <p className="text-[10px] text-red-600/70 dark:text-red-400/70">
                        {last}
                      </p>
                    </div>
                    <kbd className="shrink-0 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-mono text-red-600 dark:text-red-400">
                      Enter ↵
                    </kbd>
                  </div>
                )}
              </div>
            );
          })()}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={isInstalling}>
              Cancel / 取消
            </Button>
            <Button
              onClick={handleInstall}
              disabled={!spec.trim() || !isValid || isInstalling}
              className={cn(
                isValid && !isInstalling &&
                  "animate-pulse shadow-[0_0_14px_2px_oklch(0.7_0.15_250/0.5)]"
              )}
            >
              <Download className="mr-1.5 h-4 w-4" />
              {isInstalling ? "Installing... / 安装中..." : "Install / 安装"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
