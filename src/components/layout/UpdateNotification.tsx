import { ArrowDownToLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface UpdateNotificationProps {
  open: boolean;
  updateVersion: string | null;
  isWorking: boolean;
  downloadProgress: number;
  onLater: () => void;
  onUpdate: () => void;
}

export function UpdateNotification({
  open,
  updateVersion,
  isWorking,
  downloadProgress,
  onLater,
  onUpdate,
}: UpdateNotificationProps) {
  if (!open || !updateVersion) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 top-14 z-50 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-primary/40 bg-popover shadow-2xl shadow-black/30"
    >
      <div className="flex items-start gap-3 p-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/15 text-primary">
          <ArrowDownToLine className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                Penguin update available
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {isWorking
                  ? `Downloading... ${downloadProgress}%`
                  : `v${updateVersion} is ready to install`}
              </p>
            </div>
            <button
              type="button"
              onClick={onLater}
              disabled={isWorking}
              className="-mr-1 -mt-1 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Dismiss update notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={onLater}
              disabled={isWorking}
            >
              Later
            </Button>
            <Button size="sm" className="h-7 px-3" onClick={onUpdate} disabled={isWorking}>
              {isWorking ? "Installing..." : "Update"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
