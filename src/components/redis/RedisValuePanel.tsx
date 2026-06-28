import { invoke } from "@tauri-apps/api/core";
import { Clock } from "lucide-react";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Input } from "@/components/ui/input";
import type { RedisKeyType } from "@/lib/redis-types";
import { RedisStringValue } from "./values/RedisStringValue";
import { RedisHashValue } from "./values/RedisHashValue";
import { RedisListValue } from "./values/RedisListValue";
import { RedisSetValue } from "./values/RedisSetValue";
import { RedisZSetValue } from "./values/RedisZSetValue";

interface Props {
  keyName: string;
  keyType: RedisKeyType;
}

const TYPE_BADGE: Record<RedisKeyType, string> = {
  string: "bg-emerald-500/20 text-emerald-400",
  hash:   "bg-sky-500/20 text-sky-400",
  list:   "bg-amber-500/20 text-amber-400",
  set:    "bg-violet-500/20 text-violet-400",
  zset:   "bg-rose-500/20 text-rose-400",
  stream: "bg-orange-500/20 text-orange-400",
  none:   "bg-muted text-muted-foreground",
};

export function RedisValuePanel({ keyName, keyType }: Props): ReactElement {
  const [ttl, setTtl] = useState<number | null>(null);
  const [ttlInput, setTtlInput] = useState("");
  const [editingTtl, setEditingTtl] = useState(false);

  const loadTtl = useCallback(async () => {
    const t = await invoke<number>("redis_key_ttl", { key: keyName }).catch(() => -1);
    setTtl(t);
    setTtlInput(t > 0 ? String(t) : "");
  }, [keyName]);

  useEffect(() => { void loadTtl(); }, [loadTtl]);

  const saveTtl = useCallback(async () => {
    const secs = parseInt(ttlInput, 10);
    await invoke("redis_expire_key", { key: keyName, ttlSecs: isNaN(secs) ? 0 : secs }).catch(() => {});
    setEditingTtl(false);
    await loadTtl();
  }, [keyName, ttlInput, loadTtl]);

  const ttlDisplay = ttl === null ? "…" : ttl === -1 ? "no expiry" : ttl === -2 ? "expired" : `${ttl}s`;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Key header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${TYPE_BADGE[keyType] ?? TYPE_BADGE.none}`}>
          {keyType}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={keyName}>
          {keyName}
        </span>
        {/* TTL */}
        <div className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {editingTtl ? (
            <Input
              value={ttlInput}
              onChange={(e) => setTtlInput(e.target.value)}
              onBlur={saveTtl}
              onKeyDown={(e) => { if (e.key === "Enter") void saveTtl(); if (e.key === "Escape") setEditingTtl(false); }}
              className="h-5 w-16 border-0 bg-muted px-1 text-[11px]"
              autoFocus
              placeholder="secs (0=∞)"
            />
          ) : (
            <button
              type="button"
              className="hover:text-foreground"
              onClick={() => setEditingTtl(true)}
              title="Click to edit TTL (0 = persist)"
            >
              {ttlDisplay}
            </button>
          )}
        </div>
      </div>

      {/* Type-specific viewer */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {keyType === "string" && <RedisStringValue keyName={keyName} />}
        {keyType === "hash"   && <RedisHashValue   keyName={keyName} />}
        {keyType === "list"   && <RedisListValue   keyName={keyName} />}
        {keyType === "set"    && <RedisSetValue    keyName={keyName} />}
        {keyType === "zset"   && <RedisZSetValue   keyName={keyName} />}
        {(keyType === "stream" || keyType === "none") && (
          <div className="p-4 text-xs text-muted-foreground">
            Type &ldquo;{keyType}&rdquo; is not yet supported.
          </div>
        )}
      </div>
    </div>
  );
}
