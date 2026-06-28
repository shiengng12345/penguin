import { invoke } from "@tauri-apps/api/core";
import { Minus, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";

// ---------------------------------------------------------------------------
// Slow Log tab (Phase 4) — SLOWLOG GET with limit + filter (Tiny RDM layout).
// ---------------------------------------------------------------------------

interface SlowLogEntry {
  id: number;
  timestamp: number;
  duration_us: number;
  command: string;
  client: string;
}

export function RedisSlowLogTab({ connectionId }: { connectionId: string }): ReactElement {
  const [entries, setEntries] = useState<SlowLogEntry[]>([]);
  const [limit, setLimit] = useState(20);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    const result = await invoke<SlowLogEntry[]>("reg_slowlog", {
      id: connectionId,
      count: limit,
    }).catch(() => []);
    setEntries(result);
  }, [connectionId, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === "") {
      return entries;
    }
    return entries.filter(
      (entry) =>
        entry.command.toLowerCase().includes(needle) || entry.client.toLowerCase().includes(needle),
    );
  }, [entries, filter]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-end gap-4 border-b border-border/60 px-4 py-3">
        <label className="space-y-1">
          <span className="block text-[11px] text-muted-foreground">Limit</span>
          <div className="flex items-center">
            <input
              value={String(limit)}
              onChange={(event) => setLimit(Math.max(1, Number(event.target.value) || 1))}
              className="h-7 w-20 rounded-l border border-border bg-background px-2 text-xs"
            />
            <button
              type="button"
              onClick={() => setLimit((value) => Math.max(1, value - 10))}
              className="flex h-7 w-7 items-center justify-center border-y border-border hover:bg-muted"
            >
              <Minus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setLimit((value) => value + 10)}
              className="flex h-7 w-7 items-center justify-center rounded-r border border-border hover:bg-muted"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
        </label>
        <label className="flex-1 space-y-1">
          <span className="block text-[11px] text-muted-foreground">Filter</span>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            className="h-7 w-full rounded border border-border bg-background px-2 text-xs"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground hover:bg-muted"
          title="刷新"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card text-left text-muted-foreground">
            <tr className="border-b border-border/60">
              <th className="px-4 py-2 font-medium">Time</th>
              <th className="px-4 py-2 font-medium">Client</th>
              <th className="px-4 py-2 font-medium">Command</th>
              <th className="px-4 py-2 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr key={entry.id} className="border-b border-border/40 align-top hover:bg-muted/50">
                <td className="whitespace-nowrap px-4 py-2 font-mono text-muted-foreground">
                  {new Date(entry.timestamp * 1000).toLocaleString()}
                </td>
                <td className="whitespace-nowrap px-4 py-2 font-mono">{entry.client}</td>
                <td className="px-4 py-2 font-mono break-all">{entry.command}</td>
                <td className="whitespace-nowrap px-4 py-2 text-right font-mono text-amber-400">
                  {(entry.duration_us / 1000).toFixed(0)} ms
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-xs text-muted-foreground">没有慢查询记录</div>
        ) : null}
      </div>
    </div>
  );
}
