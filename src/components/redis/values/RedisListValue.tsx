import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, type ReactElement } from "react";
import type { ListPage } from "@/lib/redis-types";

interface Props { keyName: string; }

export function RedisListValue({ keyName }: Props): ReactElement {
  const [data, setData] = useState<ListPage | null>(null);
  const [start, setStart] = useState(0);
  const PAGE = 100;

  useEffect(() => {
    void invoke<ListPage>("redis_list_range", { key: keyName, start, stop: start + PAGE - 1 })
      .then(setData)
      .catch(() => {});
  }, [keyName, start]);

  if (data === null) return <div className="p-4 text-xs text-muted-foreground">Loading…</div>;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground">
        {data.total} items (read-only · write coming in Phase B)
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border text-left text-[10px] text-muted-foreground">
              <th className="w-12 px-3 py-1.5 font-medium">#</th>
              <th className="px-3 py-1.5 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, i) => (
              <tr key={start + i} className="border-b border-border/40 hover:bg-muted/20">
                <td className="px-3 py-1 text-muted-foreground">{start + i}</td>
                <td className="px-3 py-1 font-mono">{item}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex shrink-0 items-center justify-between border-t border-border/60 px-3 py-1.5 text-[11px]">
        <button
          type="button"
          disabled={start === 0}
          onClick={() => setStart(Math.max(0, start - PAGE))}
          className="text-primary disabled:opacity-40"
        >
          ← Prev
        </button>
        <span className="text-muted-foreground">{start}–{start + data.items.length - 1}</span>
        <button
          type="button"
          disabled={start + PAGE >= data.total}
          onClick={() => setStart(start + PAGE)}
          className="text-primary disabled:opacity-40"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
