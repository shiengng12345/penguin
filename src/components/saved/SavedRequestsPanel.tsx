import { useState, useEffect, useRef } from "react";
import {
  useAppStore,
  type ProtocolTab,
  type SavedRequest,
} from "@/lib/store";
import { Input } from "@/components/ui/input";
import {
  Bookmark,
  Trash2,
  Globe,
  Server,
  Box,
  Pencil,
  Check,
  X,
} from "lucide-react";
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

interface SavedRequestsPanelProps {
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

  return `${d.getMonth() +1}/${d.getDate()} ${time}`;
}

function getMethodShortName(fullName: string): string {
  const parts = fullName.split(".");
  return parts[parts.length - 1];
}

export function SavedRequestsPanel({
  open,
  onClose,
}: SavedRequestsPanelProps) {
  const {
    savedRequests,
    deleteSavedRequest,
    renameSavedRequest,
    addTab,
  } = useAppStore();

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? savedRequests.filter((r) => {
        const q = query.toLowerCase();
        return (
          r.name.toLowerCase().includes(q) ||
          r.methodFullName.toLowerCase().includes(q) ||
          r.serviceName.toLowerCase().includes(q) ||
          r.packageName.toLowerCase().includes(q) ||
          r.url.toLowerCase().includes(q)
        );
      })
    : savedRequests;

  const restoreEntry = (entry: SavedRequest) => {
    addTab();
    const patch = {
      protocolTab: entry.protocol,
      targetUrl: entry.url,
      metadata:
        entry.metadata.length > 0
          ? entry.metadata
          : [
              { key: "Authorization", value: "Bearer ", enabled: true },
              { key: "eId", value: "", enabled: true },
            ],
      requestBody: entry.requestBody,
      selectedPackage: entry.packageName || null,
      selectedService: entry.serviceName || null,
      selectedMethod: entry.selectedMethod ?? null,
      response: entry.response,
      origin: "saved" as const,
    };
    setTimeout(() => {
      useAppStore.getState().updateActiveTab(patch);
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
    }, 0);
    onClose();
  };

  const startRename = (entry: SavedRequest, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(entry.id);
    setEditName(entry.name);
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const commitRename = () => {
    if (editingId && editName.trim()) {
      renameSavedRequest(editingId, editName.trim());
    }
    setEditingId(null);
  };

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setExpanded(null);
      setEditingId(null);
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
      if (editingId) {
        if (e.key === "Enter") {
          e.preventDefault();
          commitRename();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setEditingId(null);
        }
        return;
      }
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i +1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && filtered[selectedIndex]) {
        e.preventDefault();
        restoreEntry(filtered[selectedIndex]);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, filtered, selectedIndex, editingId, editName]);

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
          <Bookmark className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search saved requests..."
            className="border-0 bg-transparent focus-visible:ring-0"
          />
        </div>

        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-[10px] text-muted-foreground">
            {filtered.length} saved{" "}
            {filtered.length === 1 ? "request" : "requests"}
          </span>
          <span className="text-[10px] text-muted-foreground">
            Enter to restore / ↑↓ navigate / Esc close
          </span>
        </div>

        <div ref={listRef} className="max-h-96 overflow-y-auto p-1">
          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              {savedRequests.length === 0
                ? "No saved requests yet — use the Save button after sending a request"
                : "No matching results"}
            </div>
          ) : (
            filtered.map((entry, i) => {
              const badge = PROTOCOL_BADGES[entry.protocol];
              const Icon = badge.icon;
              const isExpanded = expanded === entry.id;
              const isEditing = editingId === entry.id;
              return (
                <div key={entry.id}>
                  <div
                    onClick={() => !isEditing && restoreEntry(entry)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors cursor-pointer group",
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

                    {isEditing ? (
                      <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                        <input
                          ref={editInputRef}
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="flex-1 min-w-0 bg-background border border-border rounded px-1.5 py-0.5 font-mono text-xs focus:outline-none focus:border-primary"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitRename();
                            }
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setEditingId(null);
                            }
                          }}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            commitRename();
                          }}
                          className="h-5 w-5 rounded flex items-center justify-center hover:bg-muted text-success"
                        >
                          <Check className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingId(null);
                          }}
                          className="h-5 w-5 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="truncate font-mono text-xs font-medium text-foreground">
                          {entry.name}
                        </span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {getMethodShortName(entry.methodFullName)}
                        </span>
                        {entry.response && (
                          <span
                            className={cn(
                              "shrink-0 text-[9px] font-mono px-1 py-0.5 rounded",
                              entry.response.status === "OK" || entry.response.status === "SUCCESS"
                                ? "bg-green-500/15 text-green-500"
                                : "bg-red-500/15 text-red-500"
                            )}
                          >
                            {entry.response.statusCode > 0
                              ? entry.response.statusCode
                              : entry.response.status}
                          </span>
                        )}
                      </>
                    )}

                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/60">
                      {formatTime(entry.savedAt)}
                    </span>

                    {!isEditing && (
                      <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => startRename(entry, e)}
                          className="h-5 w-5 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"
                          title="Rename"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSavedRequest(entry.id);
                          }}
                          className="h-5 w-5 rounded flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                          title="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpanded(isExpanded ? null : entry.id);
                          }}
                          className="h-5 w-5 rounded flex items-center justify-center hover:bg-muted text-muted-foreground text-[10px]"
                          title="Preview"
                        >
                          {isExpanded ? "▲" : "▼"}
                        </button>
                      </div>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="mx-2 mb-1 rounded border border-border bg-muted/30 p-2 text-xs space-y-2">
                      <div>
                        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                          Request Headers
                        </span>
                        {entry.metadata.length > 0 ? (
                          <div className="mt-0.5 font-mono text-[11px]">
                            {entry.metadata.map((m, j) => (
                              <div key={j} className="truncate">
                                <span className="text-muted-foreground">
                                  {m.key}:
                                </span>{" "}
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
                          Request Body
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
                      {entry.response && (
                        <div>
                          <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                            Response{" "}
                            <span
                              className={cn(
                                "font-mono",
                                entry.response.status === "OK"
                                  ? "text-green-500"
                                  : "text-red-500"
                              )}
                            >
                              ({entry.response.status}{" "}
                              {entry.response.statusCode > 0 &&
                                entry.response.statusCode}
                              ) — {entry.response.duration}ms
                            </span>
                          </span>
                          {Object.keys(entry.response.headers).length > 0 && (
                            <div className="mt-0.5 font-mono text-[11px]">
                              {Object.entries(entry.response.headers).map(
                                ([k, v]) => (
                                  <div key={k} className="truncate">
                                    <span className="text-muted-foreground">
                                      {k}:
                                    </span>{" "}
                                    {v}
                                  </div>
                                )
                              )}
                            </div>
                          )}
                          <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-foreground/80">
                            {(() => {
                              const body =
                                entry.response.body || entry.response.error;
                              if (!body) return "(empty)";
                              try {
                                return JSON.stringify(
                                  JSON.parse(body),
                                  null,
                                  2
                                );
                              } catch {
                                return body;
                              }
                            })()}
                          </pre>
                        </div>
                      )}
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
