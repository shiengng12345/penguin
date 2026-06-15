// Sprint 10 Phase 10C — REST request history modal.
//
// Triggered by ⌘+H when REST module is active. Shows the last N sends with
// method / URL / status / elapsed. Click an entry to load it into a new
// tab. Backed by the app_kv-stored list in rest-history.ts.

import { useEffect, useRef, useState } from "react";
import { Clock, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  clearHistory,
  deleteHistoryEntry,
  loadHistory,
  type RestHistoryEntry,
} from "./rest-history";

export interface RestHistoryPanelProps {
  open: boolean;
  onClose: () => void;
  onReplay: (entry: RestHistoryEntry) => void;
}

export function RestHistoryPanel({ open, onClose, onReplay }: RestHistoryPanelProps) {
  const [entries, setEntries] = useState<RestHistoryEntry[]>([]);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  // Stash the element that had focus before this panel opened so we can
  // return focus there on close. Without this, Escape lands focus on
  // document.body and subsequent keyboard shortcuts (⌘Z / ⌘N / etc.) don't
  // reach the REST workspace inputs.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Reload from storage on every open — history is written by the editor's
  // send path, which runs outside this component.
  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
      setEntries(loadHistory());
      setShowClearConfirm(false);
    } else {
      // Return focus once on close. Wait for the dialog DOM to fully unmount
      // (microtask) so the focus call doesn't fight React's removal of the
      // currently-focused close button.
      const target = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (target && typeof target.focus === "function") {
        window.setTimeout(() => {
          try {
            target.focus();
          } catch {
            // Element may have unmounted between open and close — ignore.
          }
        }, 0);
      }
    }
  }, [open]);

  // Capture-phase Esc so the page-level Esc (close REST module) doesn't fire.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  if (!open) return null;

  const handleClearAll = () => {
    clearHistory();
    setEntries([]);
    setShowClearConfirm(false);
  };

  const handleDelete = (id: string) => {
    const next = deleteHistoryEntry(id);
    setEntries(next);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-labelledby="rest-history-title"
        className="relative z-50 flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-popover shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 id="rest-history-title" className="flex items-center gap-2 text-sm font-semibold">
            <Clock className="h-4 w-4 text-muted-foreground" />
            REST Request History
            {entries.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
                {entries.length}
              </span>
            )}
          </h2>
          <div className="flex items-center gap-1">
            {entries.length > 0 && !showClearConfirm && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-[11px] text-muted-foreground hover:text-destructive"
                onClick={() => setShowClearConfirm(true)}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                Clear all
              </Button>
            )}
            {showClearConfirm && (
              <>
                <span className="text-[11px] text-muted-foreground">Sure?</span>
                <Button size="sm" variant="destructive" className="h-7 text-[11px]" onClick={handleClearAll}>
                  Yes, clear
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setShowClearConfirm(false)}>
                  Cancel
                </Button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0 flex-col overflow-y-auto">
          {entries.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
              No requests yet. Send a request and it&apos;ll appear here for replay.
            </div>
          ) : (
            entries.map((entry) => <HistoryRow key={entry.id} entry={entry} onReplay={onReplay} onDelete={handleDelete} onClose={onClose} />)
          )}
        </div>
      </div>
    </div>
  );
}

function HistoryRow({
  entry,
  onReplay,
  onDelete,
  onClose,
}: {
  entry: RestHistoryEntry;
  onReplay: (entry: RestHistoryEntry) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const isError = entry.status === 0 || entry.status >= 400;
  return (
    <div
      className="group flex cursor-pointer items-center gap-2 border-b border-border/40 px-3 py-2 hover:bg-accent/50"
      onClick={() => {
        onReplay(entry);
        onClose();
      }}
    >
      <span className={cn("rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold shrink-0 w-14 text-center", methodColor(entry.snapshot.method))}>
        {entry.snapshot.method}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-xs">{entry.snapshot.url || "(no URL)"}</p>
        <p className="truncate text-[10px] text-muted-foreground">
          {entry.requestName} · {formatRelative(entry.timestamp)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[10px]">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-mono",
            isError
              ? "bg-red-500/10 text-red-600 dark:text-red-400"
              : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
          )}
        >
          {entry.status === 0 ? "—" : entry.status}
        </span>
        <span className="text-muted-foreground">{entry.elapsedMs}ms</span>
        <button
          type="button"
          className="opacity-0 transition-opacity group-hover:opacity-100 text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(entry.id);
          }}
          aria-label="Delete entry"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function methodColor(method: string): string {
  switch (method) {
    case "GET":
      return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
    case "POST":
      return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
    case "PUT":
      return "bg-blue-500/15 text-blue-600 dark:text-blue-400";
    case "PATCH":
      return "bg-violet-500/15 text-violet-600 dark:text-violet-400";
    case "DELETE":
      return "bg-red-500/15 text-red-600 dark:text-red-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function formatRelative(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
