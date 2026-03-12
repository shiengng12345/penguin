import { useState, useEffect, useRef } from "react";
import { useAppStore, type ProtocolTab, type HistoryEntry } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { History, Trash2, Globe, Server, Box } from "lucide-react";
import { cn } from "@/lib/utils";

const PROTOCOL_BADGES: Record<
  ProtocolTab,
  { label: string; icon: typeof Globe; className: string }
> = {
  "grpc-web": {
    label: "gRPC-Web",
    icon: Globe,
    className: "bg-green-500/20 text-green-600 dark:text-green-400",
  },
  grpc: {
    label: "gRPC",
    icon: Server,
    className: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
  },
  sdk: {
    label: "SDK",
    icon: Box,
    className: "bg-purple-500/20 text-purple-600 dark:text-purple-400",
  },
};

interface HistoryPanelProps {
  open: boolean;
  onClose: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  if (isToday) return time;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear();

  if (isYesterday) return `Yesterday ${time}`;

  return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
}

function getMethodShortName(fullName: string): string {
  const parts = fullName.split(".");
  return parts[parts.length - 1];
}

function getServiceShortName(fullName: string): string {
  const parts = fullName.split(".");
  return parts[parts.length - 1];
}

export function HistoryPanel({ open, onClose }: HistoryPanelProps) {
  const { history, clearHistory, updateActiveTab } = useAppStore();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query.trim()
    ? history.filter((h) => {
        const q = query.toLowerCase();
        return (
          h.methodFullName.toLowerCase().includes(q) ||
          h.serviceName.toLowerCase().includes(q) ||
          h.packageName.toLowerCase().includes(q) ||
          h.url.toLowerCase().includes(q)
        );
      })
    : history;

  const selectEntry = (entry: HistoryEntry) => {
    updateActiveTab({
      protocolTab: entry.protocol,
      targetUrl: entry.url,
      metadata: entry.metadata.length > 0
        ? entry.metadata
        : [
            { key: "Authorization", value: "Bearer ", enabled: true },
            { key: "eId", value: "", enabled: true },
          ],
      requestBody: entry.requestBody,
      selectedPackage: entry.packageName || null,
      selectedService: entry.serviceName || null,
    });
    if (entry.packageName && entry.serviceName) {
      document.dispatchEvent(
        new CustomEvent("pengvi:focus-method", {
          detail: {
            packageName: entry.packageName,
            serviceName: entry.serviceName,
          },
        })
      );
    }
    onClose();
  };

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setExpanded(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && filtered[selectedIndex]) {
        e.preventDefault();
        selectEntry(filtered[selectedIndex]);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, filtered, selectedIndex]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        className="relative z-50 w-full max-w-2xl rounded-lg border border-border bg-popover shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border p-2">
          <History className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search history... / 搜索历史记录"
            className="border-0 bg-transparent focus-visible:ring-0"
          />
          {history.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 text-xs text-destructive hover:text-destructive"
              onClick={() => {
                clearHistory();
                setQuery("");
              }}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Clear
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-[10px] text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
          </span>
          <span className="text-[10px] text-muted-foreground">
            Enter to restore / ↑↓ navigate / Esc close
          </span>
        </div>

        <div ref={listRef} className="max-h-96 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {history.length === 0
                ? "No history yet — send a request first"
                : "No matching results"}
            </div>
          ) : (
            filtered.map((entry, i) => {
              const badge = PROTOCOL_BADGES[entry.protocol];
              const Icon = badge.icon;
              const isExpanded = expanded === entry.id;
              return (
                <div key={entry.id}>
                  <button
                    type="button"
                    onClick={() => selectEntry(entry)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setExpanded(isExpanded ? null : entry.id);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
                      i === selectedIndex ? "bg-accent" : "hover:bg-accent/50"
                    )}
                  >
                    <span
                      className={cn(
                        "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0",
                        badge.className
                      )}
                    >
                      <Icon className="h-2.5 w-2.5" />
                      {badge.label}
                    </span>
                    <span className="truncate font-mono text-xs font-medium text-foreground">
                      {getMethodShortName(entry.methodFullName)}
                    </span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {getServiceShortName(entry.serviceName)}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                      {formatTime(entry.timestamp)}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpanded(isExpanded ? null : entry.id);
                      }}
                      className="shrink-0 h-5 w-5 rounded flex items-center justify-center hover:bg-muted text-muted-foreground text-[10px]"
                      title="Preview details"
                    >
                      {isExpanded ? "▲" : "▼"}
                    </button>
                  </button>
                  {isExpanded && (
                    <div className="mx-2 mb-1 rounded border border-border bg-muted/30 p-2 text-xs">
                      <div className="mb-1">
                        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                          Headers
                        </span>
                        {entry.metadata.length > 0 ? (
                          <div className="mt-0.5 font-mono text-[11px]">
                            {entry.metadata.map((m, j) => (
                              <div key={j} className="truncate">
                                <span className="text-muted-foreground">{m.key}:</span>{" "}
                                {m.value}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-muted-foreground/60 mt-0.5">
                            (none)
                          </div>
                        )}
                      </div>
                      <div>
                        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                          Body
                        </span>
                        <pre className="mt-0.5 max-h-24 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-foreground/80">
                          {(() => {
                            try {
                              return JSON.stringify(
                                JSON.parse(entry.requestBody),
                                null,
                                2
                              );
                            } catch {
                              return entry.requestBody;
                            }
                          })()}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
