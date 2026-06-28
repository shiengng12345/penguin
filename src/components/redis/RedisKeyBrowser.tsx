import { invoke } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  List,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactElement,
} from "react";
import { Input } from "@/components/ui/input";
import {
  formatBytes,
  formatTtl,
  REDIS_TYPE_BADGE,
  REDIS_TYPE_FILTERS,
  REDIS_TYPE_SHORT,
} from "@/lib/redis-format";
import { cn } from "@/lib/utils";
import type { EnrichedKey, EnrichedScanPage, RedisKeyType } from "@/lib/redis-types";

interface Props {
  onSelectKey: (key: string, type: RedisKeyType) => void;
}

type ViewMode = "tree" | "list";
type TypeFilter = RedisKeyType | "all";

interface NamespaceFolder {
  prefix: string;
  keys: EnrichedKey[];
  count: number;
  folderCount: number;
  namespacePercent: number;
}

type DisplayItem =
  | { kind: "folder"; folder: NamespaceFolder }
  | { kind: "key"; row: EnrichedKey; folderPrefix: string | null };

const PAGE_SIZE = 200;

function normalizeType(value: string): RedisKeyType {
  if (
    value === "string" ||
    value === "hash" ||
    value === "list" ||
    value === "set" ||
    value === "zset" ||
    value === "stream"
  ) {
    return value;
  }
  return "none";
}

function shortKeyName(key: string, folderPrefix: string | null): string {
  if (folderPrefix === null) return key;
  const prefix = `${folderPrefix}:`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

function mergeRows(prev: EnrichedKey[], nextRows: EnrichedKey[], reset: boolean): EnrichedKey[] {
  if (reset) return nextRows;
  const seen = new Set(prev.map((row) => row.key));
  const merged = [...prev];
  for (const row of nextRows) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    merged.push(row);
  }
  return merged;
}

function buildNamespaceFolders(rows: EnrichedKey[]): NamespaceFolder[] {
  const total = Math.max(rows.length, 1);
  const grouped = new Map<string, EnrichedKey[]>();

  for (const row of rows) {
    const colon = row.key.indexOf(":");
    if (colon <= 0) continue;
    const prefix = row.key.slice(0, colon);
    const bucket = grouped.get(prefix) ?? [];
    bucket.push(row);
    grouped.set(prefix, bucket);
  }

  return [...grouped.entries()]
    .map(([prefix, keys]) => {
      const nestedFolders = new Set<string>();
      for (const row of keys) {
        const rest = row.key.slice(prefix.length + 1);
        const nextColon = rest.indexOf(":");
        if (nextColon > 0) nestedFolders.add(rest.slice(0, nextColon));
      }
      return {
        prefix,
        keys,
        count: keys.length,
        folderCount: nestedFolders.size,
        namespacePercent: Math.round((keys.length / total) * 100),
      };
    })
    .sort((a, b) => a.prefix.localeCompare(b.prefix));
}

export function RedisKeyBrowser({ onSelectKey }: Props): ReactElement {
  const [keys, setKeys] = useState<EnrichedKey[]>([]);
  const [pattern, setPattern] = useState("*");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  const [loading, setLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [done, setDone] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const listRef = useRef<HTMLDivElement | null>(null);

  const loadPage = useCallback(
    async (pat: string, filter: TypeFilter, nextCursor: number, reset: boolean) => {
      setLoading(true);
      setScanError(null);
      try {
        const page = await invoke<EnrichedScanPage>("redis_scan_enriched", {
          pattern: pat,
          cursor: nextCursor,
          count: PAGE_SIZE,
          typeFilter: filter === "all" ? null : filter,
        });
        setKeys((prev) => mergeRows(prev, page.keys, reset));
        setCursor(page.next_cursor);
        setDone(page.done);
      } catch (e) {
        setScanError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const refresh = useCallback(() => {
    setKeys([]);
    setCursor(0);
    setDone(false);
    void loadPage(pattern, typeFilter, 0, true);
  }, [pattern, typeFilter, loadPage]);

  useEffect(() => {
    void loadPage(pattern, typeFilter, 0, true);
    // Pattern is intentionally applied by Enter/refresh, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, loadPage]);

  const folders = useMemo(() => buildNamespaceFolders(keys), [keys]);

  const displayItems = useMemo<DisplayItem[]>(() => {
    if (viewMode === "list") {
      return keys.map((row) => ({ kind: "key", row, folderPrefix: null }));
    }

    const groupedKeys = new Set<string>();
    const items: DisplayItem[] = [];

    for (const folder of folders) {
      items.push({ kind: "folder", folder });
      if (!collapsed.has(folder.prefix)) {
        for (const row of folder.keys) {
          groupedKeys.add(row.key);
          items.push({ kind: "key", row, folderPrefix: folder.prefix });
        }
      } else {
        for (const row of folder.keys) groupedKeys.add(row.key);
      }
    }

    for (const row of keys) {
      if (!groupedKeys.has(row.key)) {
        items.push({ kind: "key", row, folderPrefix: null });
      }
    }

    return items;
  }, [collapsed, folders, keys, viewMode]);

  const virtualizer = useVirtualizer({
    count: displayItems.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  const handleDelete = useCallback(
    async (key: string, e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      await invoke("redis_del_keys", { keys: [key] }).catch(() => {});
      setKeys((prev) => prev.filter((row) => row.key !== key));
      if (selected === key) setSelected(null);
    },
    [selected],
  );

  const handleSelect = useCallback(
    (row: EnrichedKey) => {
      const keyType = normalizeType(row.key_type);
      setSelected(row.key);
      onSelectKey(row.key, keyType);
    },
    [onSelectKey],
  );

  return (
    <div className="flex h-full flex-col border-r border-border/60">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") refresh();
          }}
          placeholder="Pattern (e.g. user:*)"
          className="h-7 min-w-0 border-0 bg-transparent px-1 text-xs focus-visible:ring-0"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="h-7 w-[92px] shrink-0 rounded border border-border bg-background px-1 text-[11px] text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          title="Filter by Redis type"
        >
          {REDIS_TYPE_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div className="flex shrink-0 rounded border border-border">
          <button
            type="button"
            onClick={() => setViewMode("tree")}
            className={cn(
              "flex h-7 w-7 items-center justify-center border-r border-border text-muted-foreground hover:text-foreground",
              viewMode === "tree" && "bg-muted text-foreground",
            )}
            title="Tree view"
          >
            <Folder className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={cn(
              "flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground",
              viewMode === "list" && "bg-muted text-foreground",
            )}
            title="List view"
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          title="Refresh keys"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      <div className="grid shrink-0 grid-cols-[72px_minmax(0,1fr)_64px_64px_28px] border-b border-border/60 px-2 py-1 text-[10px] font-medium uppercase text-muted-foreground">
        <span>Type</span>
        <span>Key</span>
        <span className="text-right">TTL</span>
        <span className="text-right">Size</span>
        <span />
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/40 px-3 py-1 text-[10px] text-muted-foreground">
        <span>
          {keys.length.toLocaleString()} keys{done ? "" : "+"}
          {viewMode === "tree" ? ` · ${folders.length.toLocaleString()} folders` : ""}
        </span>
        <div className="flex items-center gap-2">
          {scanError !== null ? (
            <span className="max-w-[160px] truncate text-destructive" title={scanError}>
              Scan failed
            </span>
          ) : null}
          {!done && !loading ? (
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => loadPage(pattern, typeFilter, cursor, false)}
            >
              Load more
            </button>
          ) : null}
        </div>
      </div>

      <div ref={listRef} className="flex-1 overflow-y-auto">
        {displayItems.length === 0 && !loading ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
            No keys match this pattern and type filter.
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vItem) => {
              const item = displayItems[vItem.index];
              if (item === undefined) return null;

              if (item.kind === "folder") {
                const { folder } = item;
                const isOpen = !collapsed.has(folder.prefix);
                return (
                  <button
                    key={`folder-${folder.prefix}`}
                    type="button"
                    style={{
                      position: "absolute",
                      top: vItem.start,
                      height: vItem.size,
                      width: "100%",
                    }}
                    className="grid grid-cols-[72px_minmax(0,1fr)_64px_64px_28px] items-center px-2 py-1 text-left text-[11px] font-semibold text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    onClick={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(folder.prefix)) next.delete(folder.prefix);
                        else next.add(folder.prefix);
                        return next;
                      })
                    }
                  >
                    <span className="flex items-center gap-1.5">
                      {isOpen ? (
                        <ChevronDown className="h-3 w-3 shrink-0" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0" />
                      )}
                      <Folder className="h-3 w-3 shrink-0" />
                    </span>
                    <span className="truncate" title={`${folder.prefix}:`}>
                      {folder.prefix}:
                    </span>
                    <span className="text-right font-mono text-[10px]">
                      {folder.count.toLocaleString()}
                    </span>
                    <span className="text-right font-mono text-[10px]">
                      {folder.namespacePercent}%
                    </span>
                    <span
                      className="text-right font-mono text-[10px]"
                      title={`${folder.folderCount} nested folders`}
                    >
                      {folder.folderCount > 0 ? folder.folderCount : ""}
                    </span>
                  </button>
                );
              }

              const row = item.row;
              const keyType = normalizeType(row.key_type);
              const isSelected = selected === row.key;
              const name = shortKeyName(row.key, item.folderPrefix);

              return (
                <div
                  key={row.key}
                  style={{
                    position: "absolute",
                    top: vItem.start,
                    height: vItem.size,
                    width: "100%",
                  }}
                  className={cn(
                    "group grid cursor-pointer grid-cols-[72px_minmax(0,1fr)_64px_64px_28px] items-center px-2 py-1 text-xs transition-colors",
                    isSelected
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                  onClick={() => handleSelect(row)}
                >
                  <span
                    className={cn(
                      "w-fit rounded px-1.5 py-0.5 text-[9px] font-bold",
                      REDIS_TYPE_BADGE[keyType],
                    )}
                  >
                    {REDIS_TYPE_SHORT[keyType] ?? "?"}
                  </span>
                  <span className="min-w-0 truncate font-mono" title={row.key}>
                    {name}
                  </span>
                  <span className="text-right font-mono text-[10px]">
                    {formatTtl(row.ttl)}
                  </span>
                  <span className="text-right font-mono text-[10px]">
                    {formatBytes(row.size_bytes)}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => handleDelete(row.key, e)}
                    className="hidden h-6 w-6 items-center justify-center justify-self-end rounded text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive group-hover:flex"
                    title="Delete key"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
