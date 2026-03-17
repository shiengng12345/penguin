import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock3,
  KeyRound,
  List,
  Loader2,
  Pencil,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  Save,
  Search,
  TerminalSquare,
  Trash2,
  TreePine,
  X,
} from "lucide-react";
import {
  deleteRedisKeys,
  getRedisDbSize,
  getRedisKeyInfo,
  getRedisKeyValue,
  renameRedisKey,
  scanRedisKeys,
  selectRedisDb,
  setRedisKeyTtl,
  setRedisKeyValue,
  type RedisConnectionRecord,
  type RedisHashField,
  type RedisKeyInfo,
  type RedisKeyValue,
  type RedisZSetMember,
} from "@/lib/redis";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RedisCliPanel } from "@/components/redis/RedisCliPanel";
import { RedisKeyTree } from "@/components/redis/RedisKeyTree";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

interface RedisBrowserConnectionGroup {
  key: string;
  label: string;
  connections: RedisConnectionRecord[];
}

interface RedisBrowserProps {
  connection: RedisConnectionRecord;
  connectionGroups: RedisBrowserConnectionGroup[];
  busyAction: string | null;
  onOpenConnection: (connection: RedisConnectionRecord) => void;
  onToggleConnection: (connection: RedisConnectionRecord) => void;
  onDisconnectAll: () => void;
  onCreateConnection: () => void;
}

export interface RedisBrowserHandle {
  focusPattern: () => void;
  openBrowser: () => void;
  openCli: () => void;
  rescan: () => void;
}

interface BrowserNotice {
  tone: "success" | "error" | "info";
  message: string;
}

interface KeyActionBarProps {
  info: RedisKeyInfo;
  saving: boolean;
  writeEnabled: boolean;
  renaming: boolean;
  ttlEditing: boolean;
  renameValue: string;
  ttlValue: string;
  onRenameStart: () => void;
  onRenameChange: (value: string) => void;
  onRenameSave: () => void;
  onRenameCancel: () => void;
  onRefresh: () => void;
  onDelete: () => void;
  onTtlStart: () => void;
  onTtlChange: (value: string) => void;
  onTtlSave: () => void;
  onTtlCancel: () => void;
}

interface StringEditorProps {
  value: string;
  disabled: boolean;
  onSave: (nextValue: RedisKeyValue) => void;
}

interface HashEditorProps {
  value: RedisHashField[];
  disabled: boolean;
  onSave: (nextValue: RedisKeyValue) => void;
}

interface ListEditorProps {
  value: string[];
  disabled: boolean;
  onSave: (nextValue: RedisKeyValue) => void;
  actionLabel: string;
}

interface ZSetEditorProps {
  value: RedisZSetMember[];
  disabled: boolean;
  onSave: (nextValue: RedisKeyValue) => void;
}

interface AddKeyDialogProps {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onCreate: (payload: {
    key: string;
    ttl?: number;
    value: RedisKeyValue;
  }) => void;
}

type SupportedRedisType = Exclude<RedisKeyValue["type"], "none">;
type BrowserSurface = "browser" | "cli";
type KeyViewMode = "list" | "tree";
type RedisWriteMode = "view" | "edit";
type RedisSearchHistoryStore = Record<string, string[]>;

const VIEW_MODE_MESSAGE = "Redis is in view mode. Switch to Edit Mode to make changes.";
const REDIS_SEARCH_HISTORY_STORAGE_KEY = "pengvi.redis.search-history";
const REDIS_SEARCH_HISTORY_LIMIT = 8;
const COMPACT_COUNT_FORMATTER = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function normalizeSearchHistory(values: unknown) {
  if (!Array.isArray(values)) {
    return [] as string[];
  }

  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value, index, items) => value.length > 0 && items.indexOf(value) === index)
    .slice(0, REDIS_SEARCH_HISTORY_LIMIT);
}

function getStoredRedisSearchHistory(connectionId: string) {
  if (typeof window === "undefined") {
    return [] as string[];
  }

  try {
    const stored = window.localStorage.getItem(REDIS_SEARCH_HISTORY_STORAGE_KEY);
    if (!stored) {
      return [] as string[];
    }

    const parsed = JSON.parse(stored) as unknown;
    if (Array.isArray(parsed)) {
      return normalizeSearchHistory(parsed);
    }

    if (!parsed || typeof parsed !== "object") {
      return [] as string[];
    }

    const historyStore = parsed as RedisSearchHistoryStore;
    return normalizeSearchHistory(historyStore[connectionId]);
  } catch {
    return [] as string[];
  }
}

function formatCompactCount(value: number) {
  if (value < 1000) {
    return value.toLocaleString("en");
  }

  return COMPACT_COUNT_FORMATTER.format(value);
}

function getFuzzySearchScore(candidate: string, query: string) {
  const normalizedCandidate = candidate.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return 0;
  }

  if (normalizedCandidate.includes(normalizedQuery)) {
    return 1000 - normalizedCandidate.indexOf(normalizedQuery) - (normalizedCandidate.length - normalizedQuery.length);
  }

  let score = 0;
  let nextIndex = 0;
  let previousIndex = -1;

  for (const character of normalizedQuery) {
    const matchedIndex = normalizedCandidate.indexOf(character, nextIndex);
    if (matchedIndex === -1) {
      return null;
    }

    score += 8;

    if (matchedIndex === previousIndex + 1) {
      score += 6;
    }

    if (
      matchedIndex === 0 ||
      [":", ".", "-", "_", "/"].includes(normalizedCandidate[matchedIndex - 1] ?? "")
    ) {
      score += 4;
    }

    previousIndex = matchedIndex;
    nextIndex = matchedIndex + 1;
  }

  return score - (normalizedCandidate.length - normalizedQuery.length);
}

const TYPE_BADGE_CLASSES: Record<string, string> = {
  string: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  hash: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300",
  list: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  set: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  zset: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
};

const ADD_KEY_TYPES: Array<{
  value: SupportedRedisType;
  label: string;
  description: string;
}> = [
  { value: "string", label: "String", description: "Raw text or JSON payload" },
  { value: "hash", label: "Hash", description: "Field / value pairs" },
  { value: "list", label: "List", description: "Ordered items" },
  { value: "set", label: "Set", description: "Unique members" },
  { value: "zset", label: "ZSet", description: "Member + score" },
];

const KEY_TYPE_OPTIONS = ["string", "hash", "list", "set", "zset"] as const;
const TAG_SWATCHES = [
  "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300",
  "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
  "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300",
];

function getTagColorClasses(tag: string) {
  const hash = [...tag].reduce((total, char) => total + char.charCodeAt(0), 0);
  return TAG_SWATCHES[hash % TAG_SWATCHES.length];
}

function formatTtl(ttl: number) {
  if (ttl === -1) return "No expiry";
  if (ttl < 0) return "Expired";
  if (ttl < 60) return `${ttl}s`;
  if (ttl < 3600) return `${Math.floor(ttl / 60)}m ${ttl % 60}s`;
  const hours = Math.floor(ttl / 3600);
  const minutes = Math.floor((ttl % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function noticeClasses(tone: BrowserNotice["tone"]) {
  if (tone === "success") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (tone === "error") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  }
  return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
}

function KeyActionBar({
  info,
  saving,
  writeEnabled,
  renaming,
  ttlEditing,
  renameValue,
  ttlValue,
  onRenameStart,
  onRenameChange,
  onRenameSave,
  onRenameCancel,
  onRefresh,
  onDelete,
  onTtlStart,
  onTtlChange,
  onTtlSave,
  onTtlCancel,
}: KeyActionBarProps) {
  return (
    <div className="space-y-3 border-b border-border bg-muted/20 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        {renaming ? (
          <>
            <Input
              value={renameValue}
              onChange={(event) => onRenameChange(event.target.value)}
              className="h-8 max-w-md font-mono text-xs"
              autoFocus
              disabled={!writeEnabled}
            />
            <Button size="sm" onClick={onRenameSave} disabled={saving || !writeEnabled}>
              <Save className="h-4 w-4" />
              Save
            </Button>
            <Button variant="outline" size="sm" onClick={onRenameCancel} disabled={saving}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <h2 className="max-w-full truncate font-mono text-sm font-semibold text-foreground">
              {info.key}
            </h2>
            <Badge
              variant="outline"
              className={cn("px-2 py-0.5 text-[10px] uppercase", TYPE_BADGE_CLASSES[info.keyType] ?? "")}
            >
              {info.keyType}
            </Badge>
            <Badge variant="outline" className="px-2 py-0.5 text-[10px]">
              TTL: {formatTtl(info.ttl)}
            </Badge>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={saving}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          {!renaming && (
            <Button variant="outline" size="sm" onClick={onRenameStart} disabled={saving}>
              <Pencil className="h-4 w-4" />
              Rename
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onDelete}
            disabled={saving}
            className="text-rose-600 hover:text-rose-600"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Clock3 className="h-4 w-4 text-muted-foreground" />
          {ttlEditing ? (
            <>
              <Input
                value={ttlValue}
                onChange={(event) => onTtlChange(event.target.value)}
                className="h-8 w-32 text-xs"
                placeholder="-1 remove expiry"
                autoFocus
                disabled={!writeEnabled}
              />
              <Button size="sm" onClick={onTtlSave} disabled={saving || !writeEnabled}>
                Apply TTL
              </Button>
              <Button variant="outline" size="sm" onClick={onTtlCancel} disabled={saving}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={onTtlStart} disabled={saving}>
              Set TTL
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function ConnectionSidebar({
  activeConnectionId,
  connectionGroups,
  busyAction,
  onOpenConnection,
  onToggleConnection,
  onDisconnectAll,
  onCreateConnection,
}: {
  activeConnectionId: string;
  connectionGroups: RedisBrowserConnectionGroup[];
  busyAction: string | null;
  onOpenConnection: (connection: RedisConnectionRecord) => void;
  onToggleConnection: (connection: RedisConnectionRecord) => void;
  onDisconnectAll: () => void;
  onCreateConnection: () => void;
}) {
  const [visibility, setVisibility] = useState<"all" | "connected">("all");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const connectedCount = useMemo(
    () =>
      connectionGroups.reduce(
        (count, group) => count + group.connections.filter((connection) => connection.connected).length,
        0,
      ),
    [connectionGroups],
  );
  const totalCount = useMemo(
    () => connectionGroups.reduce((count, group) => count + group.connections.length, 0),
    [connectionGroups],
  );
  const visibleGroups = useMemo(
    () =>
      connectionGroups
        .map((group) => ({
          ...group,
          connections:
            visibility === "connected"
              ? group.connections.filter((connection) => connection.connected)
              : group.connections,
        }))
        .filter((group) => group.connections.length > 0),
    [connectionGroups, visibility],
  );

  useEffect(() => {
    setCollapsedGroups((current) => {
      const next = { ...current };

      for (const group of visibleGroups) {
        if (!(group.key in next)) {
          next[group.key] = false;
        }
      }

      return next;
    });
  }, [visibleGroups]);

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  };

  const collapseAllGroups = () => {
    setCollapsedGroups((current) => {
      const next = { ...current };
      for (const group of visibleGroups) {
        next[group.key] = true;
      }
      return next;
    });
  };

  const expandAllGroups = () => {
    setCollapsedGroups((current) => {
      const next = { ...current };
      for (const group of visibleGroups) {
        next[group.key] = false;
      }
      return next;
    });
  };

  const allCollapsed =
    visibleGroups.length > 0 && visibleGroups.every((group) => collapsedGroups[group.key]);
  const allExpanded =
    visibleGroups.length > 0 && visibleGroups.every((group) => !collapsedGroups[group.key]);

  return (
    <div className="flex w-[248px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="border-b border-border px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-foreground">
              Connections
            </p>
            <p className="text-[11px] text-muted-foreground">
              {connectedCount} connected · {totalCount} total
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={onCreateConnection}
            className="h-8 min-w-0 justify-center gap-1.5 px-2 text-[11px]"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">New</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onDisconnectAll}
            disabled={connectedCount === 0 || busyAction === "disconnect-all"}
            className="h-8 min-w-0 justify-center gap-1.5 px-2 text-[11px]"
            title="Disconnect all Redis connections"
          >
            {busyAction === "disconnect-all" ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : (
              <PlugZap className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">Disconnect</span>
          </Button>
        </div>

        <div className="mt-3 flex rounded-xl border border-border bg-background/70 p-1">
          <Button
            variant={visibility === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 flex-1 text-[11px]"
            onClick={() => setVisibility("all")}
          >
            All
          </Button>
          <Button
            variant={visibility === "connected" ? "secondary" : "ghost"}
            size="sm"
            className="h-7 flex-1 text-[11px]"
            onClick={() => setVisibility("connected")}
          >
            Connected
          </Button>
        </div>

        <div className="mt-2 flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 flex-1 text-[11px]"
            onClick={expandAllGroups}
            disabled={visibleGroups.length === 0 || allExpanded}
          >
            Open all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 flex-1 text-[11px]"
            onClick={collapseAllGroups}
            disabled={visibleGroups.length === 0 || allCollapsed}
          >
            Collapse all
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <div className="space-y-3">
          {visibleGroups.map((group) => {
            const isCollapsed = !!collapsedGroups[group.key];

            return (
              <section key={group.key} className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-muted/30"
                >
                  <div className="flex items-center gap-1.5">
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    {group.key === "__ungrouped__" ? (
                      <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        {group.label}
                      </span>
                    ) : (
                      <Badge
                        variant="outline"
                        className={cn("px-1.5 py-0 text-[10px] uppercase", getTagColorClasses(group.label))}
                      >
                        {group.label}
                      </Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {group.connections.length}
                  </span>
                </button>

                {!isCollapsed ? (
                  <div className="space-y-1">
                    {group.connections.map((item) => {
                  const isBusy = busyAction === item.id;
                  const isActive = item.id === activeConnectionId;

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        "flex items-center gap-1.5 rounded-xl border px-2 py-1.5 transition",
                        isActive
                          ? "border-primary/40 bg-primary/10 shadow-sm ring-1 ring-primary/15"
                          : "border-border bg-background/60 hover:bg-muted/30",
                      )}
                    >
                      <span
                        className={cn(
                          "h-6 w-1 shrink-0 rounded-full",
                          isActive ? "bg-primary" : "bg-transparent",
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => onOpenConnection(item)}
                        disabled={busyAction === "disconnect-all" || isBusy}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "h-2 w-2 shrink-0 rounded-full",
                              item.connected ? "bg-emerald-500" : "bg-muted-foreground/30",
                            )}
                          />
                          <span className="truncate text-xs font-medium text-foreground">
                            {item.name}
                          </span>
                        </div>
                      </button>

                      <Button
                        variant={item.connected ? "ghost" : "outline"}
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => onToggleConnection(item)}
                        disabled={busyAction === "disconnect-all" || isBusy}
                        title={item.connected ? "Disconnect" : "Connect"}
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : item.connected ? (
                          <PlugZap className="h-3.5 w-3.5 text-amber-600" />
                        ) : (
                          <Plug className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}

          {visibleGroups.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
              No connections in this view.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StringEditor({ value, disabled, onSave }: StringEditorProps) {
  const [text, setText] = useState(value);

  useEffect(() => {
    setText(value);
  }, [value]);

  return (
    <div className="flex h-full flex-col gap-3">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={disabled}
        className="min-h-[320px] w-full flex-1 resize-none rounded-2xl border border-input bg-background/70 p-4 font-mono text-xs leading-6 text-foreground outline-none transition focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
      />
      <div className="flex justify-end">
        <Button onClick={() => onSave({ type: "string", data: text })} disabled={disabled}>
          <Save className="h-4 w-4" />
          Save Value
        </Button>
      </div>
    </div>
  );
}

function HashEditor({ value, disabled, onSave }: HashEditorProps) {
  const [items, setItems] = useState<RedisHashField[]>(value);

  useEffect(() => {
    setItems(value);
  }, [value]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="space-y-2 rounded-2xl border border-border bg-background/50 p-4">
        <div className="grid grid-cols-[1fr_1fr_40px] gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          <span>Field</span>
          <span>Value</span>
          <span />
        </div>
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-[1fr_1fr_40px] gap-2">
            <Input
              value={item.field}
              disabled={disabled}
              onChange={(event) =>
                setItems((current) =>
                  current.map((entry, currentIndex) =>
                    currentIndex === index ? { ...entry, field: event.target.value } : entry,
                  ),
                )
              }
              className="h-9 font-mono text-xs"
            />
            <Input
              value={item.value}
              disabled={disabled}
              onChange={(event) =>
                setItems((current) =>
                  current.map((entry, currentIndex) =>
                    currentIndex === index ? { ...entry, value: event.target.value } : entry,
                  ),
                )
              }
              className="h-9 font-mono text-xs"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                setItems((current) => current.filter((_, currentIndex) => currentIndex !== index))
              }
              className="h-9 w-9 text-rose-600 hover:text-rose-600"
              disabled={disabled}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setItems((current) => [...current, { field: "", value: "" }])}
          disabled={disabled}
        >
          <Plus className="h-4 w-4" />
          Add Field
        </Button>
        <Button
          onClick={() =>
            onSave({
              type: "hash",
              data: items.filter((item) => item.field.trim().length > 0),
            })
          }
          disabled={disabled}
        >
          <Save className="h-4 w-4" />
          Save Hash
        </Button>
      </div>
    </div>
  );
}

function ListEditor({ value, disabled, onSave, actionLabel }: ListEditorProps) {
  const [items, setItems] = useState<string[]>(value);

  useEffect(() => {
    setItems(value);
  }, [value]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="space-y-2 rounded-2xl border border-border bg-background/50 p-4">
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-[40px_1fr_40px] gap-2">
            <div className="flex h-9 items-center justify-center rounded-xl border border-border text-xs text-muted-foreground">
              {index}
            </div>
            <Input
              value={item}
              disabled={disabled}
              onChange={(event) =>
                setItems((current) =>
                  current.map((entry, currentIndex) => (currentIndex === index ? event.target.value : entry)),
                )
              }
              className="h-9 font-mono text-xs"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                setItems((current) => current.filter((_, currentIndex) => currentIndex !== index))
              }
              className="h-9 w-9 text-rose-600 hover:text-rose-600"
              disabled={disabled}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setItems((current) => [...current, ""])} disabled={disabled}>
          <Plus className="h-4 w-4" />
          {actionLabel}
        </Button>
        <Button
          onClick={() =>
            onSave({
              type: actionLabel === "Add Member" ? "set" : "list",
              data: items.filter((item) => item.trim().length > 0),
            })
          }
          disabled={disabled}
        >
          <Save className="h-4 w-4" />
          Save
        </Button>
      </div>
    </div>
  );
}

function ZSetEditor({ value, disabled, onSave }: ZSetEditorProps) {
  const [items, setItems] = useState<RedisZSetMember[]>(value);

  useEffect(() => {
    setItems(value);
  }, [value]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="space-y-2 rounded-2xl border border-border bg-background/50 p-4">
        <div className="grid grid-cols-[1fr_120px_40px] gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          <span>Member</span>
          <span>Score</span>
          <span />
        </div>
        {items.map((item, index) => (
          <div key={index} className="grid grid-cols-[1fr_120px_40px] gap-2">
            <Input
              value={item.member}
              disabled={disabled}
              onChange={(event) =>
                setItems((current) =>
                  current.map((entry, currentIndex) =>
                    currentIndex === index ? { ...entry, member: event.target.value } : entry,
                  ),
                )
              }
              className="h-9 font-mono text-xs"
            />
            <Input
              type="number"
              value={item.score}
              disabled={disabled}
              onChange={(event) =>
                setItems((current) =>
                  current.map((entry, currentIndex) =>
                    currentIndex === index
                      ? { ...entry, score: Number(event.target.value) || 0 }
                      : entry,
                  ),
                )
              }
              className="h-9 font-mono text-xs"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                setItems((current) => current.filter((_, currentIndex) => currentIndex !== index))
              }
              className="h-9 w-9 text-rose-600 hover:text-rose-600"
              disabled={disabled}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex justify-between">
        <Button
          variant="outline"
          onClick={() => setItems((current) => [...current, { member: "", score: 0 }])}
          disabled={disabled}
        >
          <Plus className="h-4 w-4" />
          Add Member
        </Button>
        <Button
          onClick={() =>
            onSave({
              type: "zset",
              data: items.filter((item) => item.member.trim().length > 0),
            })
          }
          disabled={disabled}
        >
          <Save className="h-4 w-4" />
          Save ZSet
        </Button>
      </div>
    </div>
  );
}

function ValueEditor({
  value,
  saving,
  onSave,
}: {
  value: RedisKeyValue;
  saving: boolean;
  onSave: (nextValue: RedisKeyValue) => void;
}) {
  if (value.type === "string") {
    return <StringEditor value={value.data} disabled={saving} onSave={onSave} />;
  }
  if (value.type === "hash") {
    return <HashEditor value={value.data} disabled={saving} onSave={onSave} />;
  }
  if (value.type === "list") {
    return (
      <ListEditor
        value={value.data}
        disabled={saving}
        onSave={onSave}
        actionLabel="Push Item"
      />
    );
  }
  if (value.type === "set") {
    return (
      <ListEditor
        value={value.data}
        disabled={saving}
        onSave={onSave}
        actionLabel="Add Member"
      />
    );
  }
  if (value.type === "zset") {
    return <ZSetEditor value={value.data} disabled={saving} onSave={onSave} />;
  }
  return (
    <div className="rounded-2xl border border-border bg-background/70 p-6 text-sm text-muted-foreground">
      This key has no editable payload.
    </div>
  );
}

function AddKeyDialog({ open, busy, onClose, onCreate }: AddKeyDialogProps) {
  const [keyName, setKeyName] = useState("");
  const [keyType, setKeyType] = useState<SupportedRedisType>("string");
  const [ttl, setTtl] = useState("");
  const [stringValue, setStringValue] = useState("");
  const [hashFields, setHashFields] = useState<RedisHashField[]>([{ field: "", value: "" }]);
  const [listItems, setListItems] = useState<string[]>([""]);
  const [setMembers, setSetMembers] = useState<string[]>([""]);
  const [zsetMembers, setZsetMembers] = useState<RedisZSetMember[]>([{ member: "", score: 0 }]);

  useEffect(() => {
    if (open) {
      return;
    }
    setKeyName("");
    setKeyType("string");
    setTtl("");
    setStringValue("");
    setHashFields([{ field: "", value: "" }]);
    setListItems([""]);
    setSetMembers([""]);
    setZsetMembers([{ member: "", score: 0 }]);
  }, [open]);

  const createPayload = () => {
    switch (keyType) {
      case "string":
        return { type: "string" as const, data: stringValue };
      case "hash":
        return {
          type: "hash" as const,
          data: hashFields.filter((item) => item.field.trim().length > 0),
        };
      case "list":
        return {
          type: "list" as const,
          data: listItems.filter((item) => item.trim().length > 0),
        };
      case "set":
        return {
          type: "set" as const,
          data: setMembers.filter((item) => item.trim().length > 0),
        };
      case "zset":
        return {
          type: "zset" as const,
          data: zsetMembers.filter((item) => item.member.trim().length > 0),
        };
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl rounded-3xl border border-border bg-card p-0 shadow-2xl" onClose={onClose}>
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>Add Key</DialogTitle>
          <p className="text-sm text-muted-foreground">
            This follows Raven’s add-key flow: choose the type first, then fill the value editor.
          </p>
        </DialogHeader>

        <div className="max-h-[75vh] overflow-y-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-[1fr_140px]">
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Key Name</span>
              <Input
                value={keyName}
                onChange={(event) => setKeyName(event.target.value)}
                placeholder="user:1001:profile"
                className="h-10 rounded-xl font-mono text-xs"
              />
            </label>
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">TTL (sec)</span>
              <Input
                type="number"
                value={ttl}
                onChange={(event) => setTtl(event.target.value)}
                placeholder="Optional"
                className="h-10 rounded-xl"
              />
            </label>
          </div>

          <div className="mt-5 grid gap-2 md:grid-cols-5">
            {ADD_KEY_TYPES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setKeyType(option.value)}
                className={cn(
                  "rounded-2xl border px-3 py-3 text-left transition",
                  keyType === option.value
                    ? cn("border-primary/40 bg-primary/10", TYPE_BADGE_CLASSES[option.value])
                    : "border-border bg-background/60 hover:bg-muted/40",
                )}
              >
                <p className="text-sm font-semibold">{option.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{option.description}</p>
              </button>
            ))}
          </div>

          <div className="mt-5 rounded-2xl border border-border bg-background/50 p-4">
            {keyType === "string" && (
              <textarea
                value={stringValue}
                onChange={(event) => setStringValue(event.target.value)}
                className="min-h-[220px] w-full resize-none rounded-2xl border border-input bg-background p-4 font-mono text-xs leading-6 text-foreground outline-none transition focus:border-primary/40 focus:ring-1 focus:ring-primary/20"
                placeholder='{"name":"Penguin"}'
              />
            )}

            {keyType === "hash" && (
              <div className="space-y-2">
                {hashFields.map((item, index) => (
                  <div key={index} className="grid grid-cols-[1fr_1fr_40px] gap-2">
                    <Input
                      value={item.field}
                      onChange={(event) =>
                        setHashFields((current) =>
                          current.map((entry, currentIndex) =>
                            currentIndex === index ? { ...entry, field: event.target.value } : entry,
                          ),
                        )
                      }
                      className="h-9 font-mono text-xs"
                      placeholder="field"
                    />
                    <Input
                      value={item.value}
                      onChange={(event) =>
                        setHashFields((current) =>
                          current.map((entry, currentIndex) =>
                            currentIndex === index ? { ...entry, value: event.target.value } : entry,
                          ),
                        )
                      }
                      className="h-9 font-mono text-xs"
                      placeholder="value"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setHashFields((current) => current.filter((_, currentIndex) => currentIndex !== index))
                      }
                      className="h-9 w-9 text-rose-600 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  onClick={() => setHashFields((current) => [...current, { field: "", value: "" }])}
                >
                  <Plus className="h-4 w-4" />
                  Add Field
                </Button>
              </div>
            )}

            {(keyType === "list" || keyType === "set") && (
              <div className="space-y-2">
                {(keyType === "list" ? listItems : setMembers).map((item, index) => (
                  <div key={index} className="grid grid-cols-[1fr_40px] gap-2">
                    <Input
                      value={item}
                      onChange={(event) => {
                        const setter = keyType === "list" ? setListItems : setSetMembers;
                        setter((current) =>
                          current.map((entry, currentIndex) =>
                            currentIndex === index ? event.target.value : entry,
                          ),
                        );
                      }}
                      className="h-9 font-mono text-xs"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const setter = keyType === "list" ? setListItems : setSetMembers;
                        setter((current) => current.filter((_, currentIndex) => currentIndex !== index));
                      }}
                      className="h-9 w-9 text-rose-600 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  onClick={() => {
                    if (keyType === "list") {
                      setListItems((current) => [...current, ""]);
                    } else {
                      setSetMembers((current) => [...current, ""]);
                    }
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Add Item
                </Button>
              </div>
            )}

            {keyType === "zset" && (
              <div className="space-y-2">
                {zsetMembers.map((item, index) => (
                  <div key={index} className="grid grid-cols-[1fr_120px_40px] gap-2">
                    <Input
                      value={item.member}
                      onChange={(event) =>
                        setZsetMembers((current) =>
                          current.map((entry, currentIndex) =>
                            currentIndex === index ? { ...entry, member: event.target.value } : entry,
                          ),
                        )
                      }
                      className="h-9 font-mono text-xs"
                      placeholder="member"
                    />
                    <Input
                      type="number"
                      value={item.score}
                      onChange={(event) =>
                        setZsetMembers((current) =>
                          current.map((entry, currentIndex) =>
                            currentIndex === index
                              ? { ...entry, score: Number(event.target.value) || 0 }
                              : entry,
                          ),
                        )
                      }
                      className="h-9 font-mono text-xs"
                      placeholder="0"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setZsetMembers((current) =>
                          current.filter((_, currentIndex) => currentIndex !== index),
                        )
                      }
                      className="h-9 w-9 text-rose-600 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  onClick={() => setZsetMembers((current) => [...current, { member: "", score: 0 }])}
                >
                  <Plus className="h-4 w-4" />
                  Add Member
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onCreate({
                key: keyName.trim(),
                ttl: ttl.trim().length > 0 ? Number(ttl) : undefined,
                value: createPayload(),
              })
            }
            disabled={busy || !keyName.trim()}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create Key
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const RedisBrowser = forwardRef<RedisBrowserHandle, RedisBrowserProps>(function RedisBrowser({
  connection,
  connectionGroups,
  busyAction,
  onOpenConnection,
  onToggleConnection,
  onDisconnectAll,
  onCreateConnection,
}, ref) {
  const [activeSurface, setActiveSurface] = useState<BrowserSurface>("browser");
  const [keyViewMode, setKeyViewMode] = useState<KeyViewMode>("list");
  const [writeMode, setWriteMode] = useState<RedisWriteMode>("view");
  const [patternInput, setPatternInput] = useState("");
  const [appliedPattern, setAppliedPattern] = useState("");
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  const [currentDb, setCurrentDb] = useState(connection.db);
  const [keys, setKeys] = useState<RedisKeyInfo[]>([]);
  const [totalKeys, setTotalKeys] = useState<number | null>(null);
  const [cursor, setCursor] = useState("0");
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedKeyInfo, setSelectedKeyInfo] = useState<RedisKeyInfo | null>(null);
  const [selectedKeyValue, setSelectedKeyValue] = useState<RedisKeyValue | null>(null);
  const [savingValue, setSavingValue] = useState(false);
  const [loadingValue, setLoadingValue] = useState(false);
  const [notice, setNotice] = useState<BrowserNotice | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [ttlValue, setTtlValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [ttlEditing, setTtlEditing] = useState(false);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [writeModeDialogOpen, setWriteModeDialogOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>(() =>
    getStoredRedisSearchHistory(connection.id),
  );
  const [searchSuggestionsOpen, setSearchSuggestionsOpen] = useState(false);
  const [highlightedSuggestionIndex, setHighlightedSuggestionIndex] = useState(-1);
  const patternInputRef = useRef<HTMLInputElement>(null);
  const searchBlurTimeoutRef = useRef<number | null>(null);
  const pendingPatternFocusRef = useRef(false);

  const loadKeys = useCallback(
    async ({ reset, nextCursor }: { reset: boolean; nextCursor?: string }) => {
      setLoadingKeys(true);
      setNotice(null);

      try {
        if (reset) {
          await selectRedisDb(connection.id, currentDb);
          const total = await getRedisDbSize(connection.id);
          setTotalKeys(total);
        }

        const result = await scanRedisKeys(
          connection.id,
          appliedPattern.trim() || "*",
          reset ? "0" : nextCursor ?? "0",
          200,
        );

        setKeys((current) => {
          if (reset) {
            return result.keys;
          }

          const byKey = new Map(current.map((item) => [item.key, item]));
          for (const item of result.keys) {
            byKey.set(item.key, item);
          }
          return Array.from(byKey.values());
        });
        setCursor(result.cursor);

        if (reset && selectedKey) {
          const exists = result.keys.some((item) => item.key === selectedKey);
          if (!exists) {
            setSelectedKey(null);
            setSelectedKeyInfo(null);
            setSelectedKeyValue(null);
          }
        }
      } catch (error) {
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setLoadingKeys(false);
      }
    },
    [appliedPattern, connection.id, currentDb, selectedKey],
  );

  const loadSelectedKey = useCallback(
    async (key: string) => {
      setSelectedKey(key);
      setLoadingValue(true);
      setNotice(null);

      try {
        const [keyInfo, keyValue] = await Promise.all([
          getRedisKeyInfo(connection.id, key),
          getRedisKeyValue(connection.id, key),
        ]);
        setSelectedKeyInfo(keyInfo);
        setSelectedKeyValue(keyValue);
        setRenameValue(key);
        setTtlValue(keyInfo.ttl === -1 ? "-1" : String(keyInfo.ttl));
        setRenaming(false);
        setTtlEditing(false);
      } catch (error) {
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setLoadingValue(false);
      }
    },
    [connection.id],
  );

  const refreshSelectedKey = useCallback(async () => {
    if (!selectedKey) {
      return;
    }
    await loadSelectedKey(selectedKey);
    await loadKeys({ reset: true });
  }, [loadKeys, loadSelectedKey, selectedKey]);

  const refreshBrowserData = useCallback(async () => {
    await loadKeys({ reset: true });
    if (selectedKey) {
      await loadSelectedKey(selectedKey);
    }
  }, [loadKeys, loadSelectedKey, selectedKey]);

  const handleCliDbSelected = useCallback((db: number) => {
    setCurrentDb(db);
    setCursor("0");
    setKeys([]);
    setTotalKeys(null);
    setSelectedKey(null);
    setSelectedKeyInfo(null);
    setSelectedKeyValue(null);
    setNotice({
      tone: "info",
      message: `Switched CLI session to db${db}.`,
    });
  }, []);

  useEffect(() => {
    setActiveSurface("browser");
    setKeyViewMode("list");
    setCurrentDb(connection.db);
    setPatternInput("");
    setAppliedPattern("");
    setTypeFilters(new Set());
    setKeys([]);
    setTotalKeys(null);
    setCursor("0");
    setSelectedKey(null);
    setSelectedKeyInfo(null);
    setSelectedKeyValue(null);
    setNotice(null);
    setSearchSuggestionsOpen(false);
    setHighlightedSuggestionIndex(-1);
    setSearchHistory(getStoredRedisSearchHistory(connection.id));
    setWriteModeDialogOpen(false);
  }, [connection.db, connection.id]);

  useEffect(() => {
    if (writeMode === "edit") {
      setWriteModeDialogOpen(false);
      return;
    }

    setRenaming(false);
    setTtlEditing(false);
    setAddDialogOpen(false);
  }, [writeMode]);

  useEffect(() => {
    try {
      const nextStore: RedisSearchHistoryStore = {};
      const stored = window.localStorage.getItem(REDIS_SEARCH_HISTORY_STORAGE_KEY);

      if (stored) {
        const parsed = JSON.parse(stored) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          Object.entries(parsed as RedisSearchHistoryStore).forEach(([key, value]) => {
            const normalized = normalizeSearchHistory(value);
            if (normalized.length > 0) {
              nextStore[key] = normalized;
            }
          });
        }
      }

      if (searchHistory.length > 0) {
        nextStore[connection.id] = searchHistory.slice(0, REDIS_SEARCH_HISTORY_LIMIT);
      } else {
        delete nextStore[connection.id];
      }

      window.localStorage.setItem(
        REDIS_SEARCH_HISTORY_STORAGE_KEY,
        JSON.stringify(nextStore),
      );
    } catch {
      return;
    }
  }, [connection.id, searchHistory]);

  const guardEditMode = useCallback(() => {
    if (writeMode === "edit") {
      return true;
    }

    setWriteModeDialogOpen(true);
    return false;
  }, [writeMode]);

  useEffect(() => {
    void loadKeys({ reset: true });
  }, [loadKeys]);

  const filteredKeys = useMemo(() => {
    return keys.filter((item) => {
      const matchesType = typeFilters.size === 0 || typeFilters.has(item.keyType);
      return matchesType;
    });
  }, [keys, typeFilters]);

  const searchSuggestions = useMemo(() => {
    const query = patternInput.trim().toLowerCase();
    if (!query) {
      return searchHistory;
    }

    return searchHistory
      .map((item) => ({
        item,
        score: getFuzzySearchScore(item, query),
      }))
      .filter((item): item is { item: string; score: number } => item.score !== null)
      .sort((left, right) => right.score - left.score || left.item.localeCompare(right.item))
      .map((item) => item.item);
  }, [patternInput, searchHistory]);

  useEffect(() => {
    if (!searchSuggestionsOpen || searchSuggestions.length === 0) {
      setHighlightedSuggestionIndex(-1);
      return;
    }

    setHighlightedSuggestionIndex((current) =>
      current >= 0 && current < searchSuggestions.length ? current : 0,
    );
  }, [searchSuggestions, searchSuggestionsOpen]);

  const dbOptions = useMemo(
    () =>
      Array.from({ length: 16 }, (_, index) => ({
        value: String(index),
        label: `db${index}`,
      })),
    [],
  );

  const handleScan = () => {
    if (patternInput === appliedPattern) {
      void loadKeys({ reset: true });
      return;
    }
    setAppliedPattern(patternInput);
  };

  const rememberSearchPattern = useCallback((pattern: string) => {
    const normalized = pattern.trim();
    if (!normalized) {
      return;
    }

    setSearchHistory((current) => [
      normalized,
      ...current.filter((item) => item !== normalized),
    ].slice(0, REDIS_SEARCH_HISTORY_LIMIT));
  }, []);

  const removeSearchHistoryItem = useCallback((pattern: string) => {
    setSearchHistory((current) => current.filter((item) => item !== pattern));
  }, []);

  const clearSearchHistory = useCallback(() => {
    setSearchHistory([]);
    setSearchSuggestionsOpen(false);
    setHighlightedSuggestionIndex(-1);
  }, []);

  const applySearchSuggestion = useCallback((suggestion: string, submit = false) => {
    setPatternInput(suggestion);
    if (submit) {
      rememberSearchPattern(suggestion);
      setAppliedPattern(suggestion);
      setSearchSuggestionsOpen(false);
      return;
    }

    requestAnimationFrame(() => {
      patternInputRef.current?.focus();
      patternInputRef.current?.setSelectionRange(suggestion.length, suggestion.length);
    });
  }, [rememberSearchPattern]);

  const focusPatternInput = useCallback((select = true) => {
    pendingPatternFocusRef.current = true;
    setActiveSurface("browser");
    requestAnimationFrame(() => {
      if (!pendingPatternFocusRef.current) {
        return;
      }

      patternInputRef.current?.focus();
      if (select) {
        patternInputRef.current?.select();
      }
      setSearchSuggestionsOpen(true);
      pendingPatternFocusRef.current = false;
    });
  }, []);

  const submitSearchDialog = useCallback(() => {
    rememberSearchPattern(patternInput);
    handleScan();
    setSearchSuggestionsOpen(false);
    setHighlightedSuggestionIndex(-1);
  }, [handleScan, patternInput, rememberSearchPattern]);

  useEffect(() => {
    if (activeSurface !== "browser" || !pendingPatternFocusRef.current) {
      return;
    }

    requestAnimationFrame(() => {
      if (!pendingPatternFocusRef.current) {
        return;
      }

      patternInputRef.current?.focus();
      patternInputRef.current?.select();
      setSearchSuggestionsOpen(true);
      pendingPatternFocusRef.current = false;
    });
  }, [activeSurface]);

  useEffect(() => {
    return () => {
      if (searchBlurTimeoutRef.current !== null) {
        window.clearTimeout(searchBlurTimeoutRef.current);
      }
    };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focusPattern() {
        focusPatternInput();
      },
      openBrowser() {
        setActiveSurface("browser");
      },
      openCli() {
        setActiveSurface("cli");
      },
      rescan() {
        setActiveSurface("browser");
        requestAnimationFrame(() => {
          if (patternInputRef.current) {
            handleScan();
          } else {
            void loadKeys({ reset: true });
          }
        });
      },
    }),
    [focusPatternInput, handleScan, loadKeys],
  );

  const toggleTypeFilter = (type: (typeof KEY_TYPE_OPTIONS)[number]) => {
    setTypeFilters((current) => {
      const next = new Set(current);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  const handleClearBrowserFilters = () => {
    setTypeFilters(new Set());

    if (patternInput === "" && appliedPattern === "") {
      void loadKeys({ reset: true });
      return;
    }

    setPatternInput("");
    setAppliedPattern("");
  };

  const hasActiveBrowserFilters = appliedPattern.trim().length > 0 || typeFilters.size > 0;

  const handleSaveValue = async (nextValue: RedisKeyValue) => {
    if (!guardEditMode()) {
      return;
    }
    if (!selectedKey || !selectedKeyInfo) {
      return;
    }

    setSavingValue(true);
    try {
      await setRedisKeyValue(
        connection.id,
        selectedKey,
        nextValue,
        selectedKeyInfo.ttl,
      );
      setNotice({
        tone: "success",
        message: `Saved value for ${selectedKey}.`,
      });
      await refreshSelectedKey();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSavingValue(false);
    }
  };

  const handleDeleteKey = async () => {
    if (!guardEditMode()) {
      return;
    }
    if (!selectedKey || !window.confirm(`Delete key "${selectedKey}"?`)) {
      return;
    }

    setSavingValue(true);
    try {
      await deleteRedisKeys(connection.id, [selectedKey]);
      setNotice({
        tone: "success",
        message: `Deleted ${selectedKey}.`,
      });
      setSelectedKey(null);
      setSelectedKeyInfo(null);
      setSelectedKeyValue(null);
      await loadKeys({ reset: true });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSavingValue(false);
    }
  };

  const handleRenameKey = async () => {
    if (!guardEditMode()) {
      return;
    }
    if (!selectedKey || !renameValue.trim()) {
      return;
    }

    setSavingValue(true);
    try {
      await renameRedisKey(connection.id, selectedKey, renameValue.trim());
      setNotice({
        tone: "success",
        message: `Renamed ${selectedKey} to ${renameValue.trim()}.`,
      });
      const nextKey = renameValue.trim();
      setSelectedKey(nextKey);
      setRenaming(false);
      await loadKeys({ reset: true });
      await loadSelectedKey(nextKey);
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSavingValue(false);
    }
  };

  const handleSetTtl = async () => {
    if (!guardEditMode()) {
      return;
    }
    if (!selectedKey || !ttlValue.trim()) {
      return;
    }

    setSavingValue(true);
    try {
      await setRedisKeyTtl(connection.id, selectedKey, Number(ttlValue));
      setNotice({
        tone: "success",
        message: `Updated TTL for ${selectedKey}.`,
      });
      setTtlEditing(false);
      await refreshSelectedKey();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSavingValue(false);
    }
  };

  const handleCreateKey = async (payload: {
    key: string;
    ttl?: number;
    value: RedisKeyValue;
  }) => {
    if (!guardEditMode()) {
      return;
    }
    if (!payload.key) {
      return;
    }

    setSavingValue(true);
    try {
      await setRedisKeyValue(
        connection.id,
        payload.key,
        payload.value,
        payload.ttl,
      );
      setAddDialogOpen(false);
      setNotice({
        tone: "success",
        message: `Created key ${payload.key}.`,
      });
      await loadKeys({ reset: true });
      await loadSelectedKey(payload.key);
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSavingValue(false);
    }
  };

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background p-4">
        <div className="rounded-3xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h1 className="text-lg font-semibold text-foreground">Redis Browser</h1>
              <p className="text-sm text-muted-foreground">
                {connection.name} · {connection.host}:{connection.port}
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              <Badge variant="outline" className="px-2 py-1 uppercase">
                {connection.connType}
              </Badge>
              <Badge variant="outline" className="px-2 py-1">
                {connection.connected ? "Connected" : "Disconnected"}
              </Badge>
              <div className="flex items-center rounded-xl border border-border bg-background/70 p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8",
                    writeMode === "view" &&
                      "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300",
                  )}
                  onClick={() => setWriteMode("view")}
                >
                  View Mode
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8",
                    writeMode === "edit" &&
                      "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300",
                  )}
                  onClick={() => setWriteMode("edit")}
                >
                  Edit Mode
                </Button>
              </div>
              <div className="flex items-center rounded-xl border border-border bg-background/70 p-1">
                <Button
                  variant={activeSurface === "browser" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8"
                  onClick={() => setActiveSurface("browser")}
                >
                  <KeyRound className="h-4 w-4" />
                  Browser
                </Button>
                <Button
                  variant={activeSurface === "cli" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8"
                  onClick={() => setActiveSurface("cli")}
                >
                  <TerminalSquare className="h-4 w-4" />
                  CLI
                </Button>
              </div>
            </div>
          </div>

          {activeSurface === "browser" ? (
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
              <div className="relative min-w-[260px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={patternInputRef}
                  value={patternInput}
                  onChange={(event) => {
                    setPatternInput(event.target.value);
                    setSearchSuggestionsOpen(true);
                    setHighlightedSuggestionIndex(-1);
                  }}
                  onFocus={() => {
                    if (searchBlurTimeoutRef.current !== null) {
                      window.clearTimeout(searchBlurTimeoutRef.current);
                      searchBlurTimeoutRef.current = null;
                    }
                    setSearchSuggestionsOpen(true);
                  }}
                  onBlur={() => {
                    searchBlurTimeoutRef.current = window.setTimeout(() => {
                      setSearchSuggestionsOpen(false);
                    }, 120);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" && searchSuggestions.length > 0) {
                      event.preventDefault();
                      setSearchSuggestionsOpen(true);
                      setHighlightedSuggestionIndex((current) =>
                        current < searchSuggestions.length - 1 ? current + 1 : 0,
                      );
                      return;
                    }
                    if (event.key === "ArrowUp" && searchSuggestions.length > 0) {
                      event.preventDefault();
                      setSearchSuggestionsOpen(true);
                      setHighlightedSuggestionIndex((current) =>
                        current > 0 ? current - 1 : searchSuggestions.length - 1,
                      );
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (
                        searchSuggestionsOpen &&
                        highlightedSuggestionIndex >= 0 &&
                        highlightedSuggestionIndex < searchSuggestions.length
                      ) {
                        applySearchSuggestion(searchSuggestions[highlightedSuggestionIndex], true);
                        return;
                      }
                      submitSearchDialog();
                      return;
                    }
                    if (event.key === "Escape") {
                      setSearchSuggestionsOpen(false);
                      setHighlightedSuggestionIndex(-1);
                    }
                  }}
                  placeholder="Search all keys"
                  className="h-10 pr-20 pl-10"
                />
                <div className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
                  {patternInput !== appliedPattern ? (
                    <span className="text-[11px] text-amber-600 dark:text-amber-300">Draft</span>
                  ) : null}
                  <span className="rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-muted-foreground">
                    ⌘ F
                  </span>
                </div>
                {searchSuggestionsOpen && searchSuggestions.length > 0 ? (
                  <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 rounded-2xl border border-border bg-popover p-2 shadow-xl animate-in fade-in-0 zoom-in-95">
                    <div className="mb-2 flex items-center justify-between gap-3 px-2">
                      <div className="min-w-0">
                        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          {patternInput.trim() ? "Suggestions" : "Recent Searches"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {searchSuggestions.length} item{searchSuggestions.length !== 1 ? "s" : ""} · {connection.name}
                        </p>
                      </div>
                      {searchHistory.length > 0 ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => clearSearchHistory()}
                        >
                          Clear all
                        </Button>
                      ) : null}
                    </div>
                    <div className="flex max-h-48 flex-col overflow-y-auto">
                      {searchSuggestions.map((suggestion, index) => (
                        <div
                          key={suggestion}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-xl px-3 py-2 transition hover:bg-muted/30",
                            highlightedSuggestionIndex === index && "bg-muted/40",
                          )}
                        >
                          <button
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              applySearchSuggestion(suggestion, true);
                            }}
                            className="min-w-0 flex-1 text-left"
                          >
                            <span className="block truncate font-mono text-sm text-foreground">{suggestion}</span>
                          </button>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                removeSearchHistoryItem(suggestion);
                              }}
                              className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                              aria-label={`Remove ${suggestion} from history`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-background/70 p-1">
                {KEY_TYPE_OPTIONS.map((type) => (
                  <Button
                    key={type}
                    variant={typeFilters.has(type) ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(
                      "h-8 px-2 text-[11px] uppercase",
                      typeFilters.has(type) && TYPE_BADGE_CLASSES[type],
                    )}
                    onClick={() => toggleTypeFilter(type)}
                  >
                    {type}
                  </Button>
                ))}
                {hasActiveBrowserFilters ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-[11px] text-muted-foreground"
                    onClick={handleClearBrowserFilters}
                  >
                    <X className="h-3.5 w-3.5" />
                    Clear
                  </Button>
                ) : null}
              </div>

              <div className="w-[110px]">
                <Select
                  value={String(currentDb)}
                  onChange={(event) => {
                    const nextDb = Number(event.target.value);
                    setCurrentDb(nextDb);
                    setCursor("0");
                    setKeys([]);
                    setTotalKeys(null);
                    setSelectedKey(null);
                    setSelectedKeyInfo(null);
                    setSelectedKeyValue(null);
                  }}
                  options={dbOptions}
                />
              </div>

              <div className="flex items-center rounded-xl border border-border bg-background/70 p-1">
                <Button
                  variant={keyViewMode === "list" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8"
                  onClick={() => setKeyViewMode("list")}
                >
                  <List className="h-4 w-4" />
                  List
                </Button>
                <Button
                  variant={keyViewMode === "tree" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8"
                  onClick={() => setKeyViewMode("tree")}
                >
                  <TreePine className="h-4 w-4" />
                  Tree
                </Button>
              </div>

              <Button variant="outline" size="sm" onClick={handleScan} disabled={loadingKeys}>
                <RefreshCw className={cn("h-4 w-4", loadingKeys && "animate-spin")} />
                Scan
              </Button>

              <Button
                size="sm"
                onClick={() => {
                  if (!guardEditMode()) {
                    return;
                  }
                  setAddDialogOpen(true);
                }}
                disabled={savingValue}
              >
                <Plus className="h-4 w-4" />
                Add Key
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4 text-sm text-muted-foreground">
              <Badge variant="outline" className="px-2 py-1">
                db{currentDb}
              </Badge>
              <Badge variant="outline" className="px-2 py-1">
                {writeMode === "edit" ? "Edit Mode" : "View Mode"}
              </Badge>
              <span>
                Raven-style CLI with command history, suggestions, and live output for this connection.
              </span>
            </div>
          )}

          {notice && (
            <div className="px-5 pt-4">
              <div className={cn("rounded-2xl border px-4 py-3 text-sm", noticeClasses(notice.tone))}>
                {notice.message}
              </div>
            </div>
          )}

          {activeSurface === "browser" ? (
            <div className="flex h-[calc(100vh-250px)] min-h-[520px] overflow-hidden gap-4 px-4 py-4">
              <ConnectionSidebar
                activeConnectionId={connection.id}
                connectionGroups={connectionGroups}
                busyAction={busyAction}
                onOpenConnection={onOpenConnection}
                onToggleConnection={onToggleConnection}
                onDisconnectAll={onDisconnectAll}
                onCreateConnection={onCreateConnection}
              />
              <div className="flex w-[328px] shrink-0 flex-col overflow-hidden rounded-2xl border border-border">
                <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-3">
                  <span>{keyViewMode === "tree" ? "Key Tree" : "Keys"}</span>
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    {filteredKeys.length !== keys.length ? (
                      <span
                        className="rounded-md border border-border bg-background/70 px-2 py-0.5"
                        title={`${filteredKeys.length.toLocaleString("en")} shown`}
                      >
                        {formatCompactCount(filteredKeys.length)} shown
                      </span>
                    ) : null}
                    <span
                      className="rounded-md border border-border bg-background/70 px-2 py-0.5"
                      title={`${keys.length.toLocaleString("en")} loaded`}
                    >
                      {formatCompactCount(keys.length)} loaded
                    </span>
                    {typeof totalKeys === "number" ? (
                      <span
                        className="rounded-md border border-border bg-background/70 px-2 py-0.5"
                        title={`${totalKeys.toLocaleString("en")} total`}
                      >
                        {formatCompactCount(totalKeys)} total
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {keyViewMode === "tree" ? (
                    <RedisKeyTree
                      keys={filteredKeys}
                      selectedKey={selectedKey}
                      onSelect={(key) => void loadSelectedKey(key)}
                    />
                  ) : (
                    <>
                      {filteredKeys.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => void loadSelectedKey(item.key)}
                          className={cn(
                            "flex w-full flex-col items-start gap-2 border-b border-border/70 px-4 py-3 text-left transition hover:bg-muted/30",
                            selectedKey === item.key && "bg-primary/8",
                          )}
                        >
                          <div className="flex w-full items-start justify-between gap-2">
                            <span className="line-clamp-2 font-mono text-xs text-foreground">
                              {item.key}
                            </span>
                            <Badge
                              variant="outline"
                              className={cn(
                                "shrink-0 px-2 py-0.5 text-[10px] uppercase",
                                TYPE_BADGE_CLASSES[item.keyType] ?? "",
                              )}
                            >
                              {item.keyType}
                            </Badge>
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            TTL: {formatTtl(item.ttl)}
                          </span>
                        </button>
                      ))}

                      {!loadingKeys && filteredKeys.length === 0 && (
                        <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                          No keys found for this scan.
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="border-t border-border px-4 py-3">
                  {cursor !== "0" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => void loadKeys({ reset: false, nextCursor: cursor })}
                      disabled={loadingKeys}
                    >
                      {loadingKeys ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Load More
                    </Button>
                  ) : (
                    <p className="text-center text-xs text-muted-foreground">End of scan</p>
                  )}
                </div>
              </div>

              <div className="min-w-0 flex-1 pl-5">
                {!selectedKey || !selectedKeyInfo ? (
                  <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-background/40">
                    <div className="text-center">
                      <KeyRound className="mx-auto h-8 w-8 text-muted-foreground/50" />
                      <p className="mt-3 text-sm font-medium text-foreground">Select a key</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Same Raven flow: left side browse keys, right side inspect and edit.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border">
                    <KeyActionBar
                      info={selectedKeyInfo}
                      saving={savingValue || loadingValue}
                      writeEnabled={writeMode === "edit"}
                      renaming={renaming}
                      ttlEditing={ttlEditing}
                      renameValue={renameValue}
                      ttlValue={ttlValue}
                      onRenameStart={() => {
                        if (!guardEditMode()) {
                          return;
                        }
                        setRenameValue(selectedKeyInfo.key);
                        setRenaming(true);
                      }}
                      onRenameChange={setRenameValue}
                      onRenameSave={() => void handleRenameKey()}
                      onRenameCancel={() => setRenaming(false)}
                      onRefresh={() => void refreshSelectedKey()}
                      onDelete={() => void handleDeleteKey()}
                      onTtlStart={() => {
                        if (!guardEditMode()) {
                          return;
                        }
                        setTtlValue(selectedKeyInfo.ttl === -1 ? "-1" : String(selectedKeyInfo.ttl));
                        setTtlEditing(true);
                      }}
                      onTtlChange={setTtlValue}
                      onTtlSave={() => void handleSetTtl()}
                      onTtlCancel={() => setTtlEditing(false)}
                    />

                    <div className="min-h-0 flex-1 overflow-auto p-5">
                      {loadingValue ? (
                        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Loading key value…
                        </div>
                      ) : selectedKeyValue ? (
                        <ValueEditor
                          key={`${selectedKey}-${selectedKeyValue.type}`}
                          value={selectedKeyValue}
                          saving={savingValue || writeMode !== "edit"}
                          onSave={(nextValue) => void handleSaveValue(nextValue)}
                        />
                      ) : (
                        <div className="rounded-2xl border border-border bg-background/70 p-6 text-sm text-muted-foreground">
                          No value loaded.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-[calc(100vh-250px)] min-h-[520px] overflow-hidden gap-4 px-4 py-4">
              <ConnectionSidebar
                activeConnectionId={connection.id}
                connectionGroups={connectionGroups}
                busyAction={busyAction}
                onOpenConnection={onOpenConnection}
                onToggleConnection={onToggleConnection}
                onDisconnectAll={onDisconnectAll}
                onCreateConnection={onCreateConnection}
              />
              <div className="min-w-0 flex-1">
                <RedisCliPanel
                  connectionId={connection.id}
                  currentDb={currentDb}
                  writeEnabled={writeMode === "edit"}
                  onWriteBlocked={() => setWriteModeDialogOpen(true)}
                  onDbSelected={handleCliDbSelected}
                  onDataChanged={refreshBrowserData}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <AddKeyDialog
        open={addDialogOpen}
        busy={savingValue}
        onClose={() => setAddDialogOpen(false)}
        onCreate={(payload) => void handleCreateKey(payload)}
      />

      <Dialog open={writeModeDialogOpen} onOpenChange={setWriteModeDialogOpen}>
        <DialogContent className="sm:max-w-md" onClose={() => setWriteModeDialogOpen(false)}>
          <DialogHeader>
            <DialogTitle>View Mode</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{VIEW_MODE_MESSAGE}</p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="outline" onClick={() => setWriteModeDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setWriteMode("edit");
                  setWriteModeDialogOpen(false);
                }}
              >
                Switch to Edit Mode
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

    </>
  );
});

RedisBrowser.displayName = "RedisBrowser";
