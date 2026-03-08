import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { X, Trash2, Loader2, CheckCircle } from "lucide-react";

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

  const handleClearCache = async () => {
    setClearing(true);
    setCleared(false);
    try {
      await invoke<string>("clear_all_packages");
      localStorage.clear();
      window.location.reload();
    } catch (err) {
      console.error("Failed to clear cache:", err);
      setClearing(false);
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
        className="relative z-50 w-full max-w-sm overflow-hidden rounded-lg border border-border bg-popover shadow-xl flex flex-col"
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

        <div className="p-4 space-y-4">
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-foreground">
                  Clear Cache / 清除缓存
                </h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Remove all installed packages across gRPC, gRPC-Web, and SDK.
                  Environments will be preserved.
                </p>
              </div>
            </div>
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
        </div>
      </div>
    </div>
  );
}
