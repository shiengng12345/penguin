import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, type ReactElement } from "react";
import type { SetPage } from "@/lib/redis-types";

interface Props { keyName: string; }

export function RedisSetValue({ keyName }: Props): ReactElement {
  const [members, setMembers] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setMembers([]);
    setCursor(0);
    setDone(false);
    void invoke<SetPage>("redis_set_members", { key: keyName, cursor: 0, count: 100 })
      .then((p) => {
        setMembers(p.members);
        setCursor(p.next_cursor);
        setDone(p.next_cursor === 0);
      })
      .catch(() => {});
  }, [keyName]);

  const loadMore = () => {
    void invoke<SetPage>("redis_set_members", { key: keyName, cursor, count: 100 })
      .then((p) => {
        setMembers((prev) => [...prev, ...p.members]);
        setCursor(p.next_cursor);
        setDone(p.next_cursor === 0);
      })
      .catch(() => {});
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border/60 px-3 py-1.5 text-[10px] text-muted-foreground">
        {members.length} members shown (read-only · write coming in Phase B)
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => (
            <span key={m} className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
              {m}
            </span>
          ))}
        </div>
        {!done ? (
          <button
            type="button"
            onClick={loadMore}
            className="mt-2 text-xs text-primary hover:underline"
          >
            Load more…
          </button>
        ) : null}
      </div>
    </div>
  );
}
