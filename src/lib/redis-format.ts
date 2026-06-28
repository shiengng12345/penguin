// Display helpers for the Redis browser — mirror Redis Insight's
// human-readable byte sizes and TTL rendering.

export function formatBytes(n: number): string {
  if (n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

export function formatTtl(secs: number): string {
  if (secs === -1) return "No limit";
  if (secs === -2) return "expired";
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

// Type badge color classes (background + text), keyed by Redis type.
export const REDIS_TYPE_BADGE: Record<string, string> = {
  string: "bg-emerald-500/20 text-emerald-400",
  hash: "bg-sky-500/20 text-sky-400",
  list: "bg-amber-500/20 text-amber-400",
  set: "bg-violet-500/20 text-violet-400",
  zset: "bg-rose-500/20 text-rose-400",
  stream: "bg-orange-500/20 text-orange-400",
  none: "bg-muted text-muted-foreground",
};

export const REDIS_TYPE_SHORT: Record<string, string> = {
  string: "STR",
  hash: "HASH",
  list: "LIST",
  set: "SET",
  zset: "ZSET",
  stream: "STRM",
  none: "?",
};

// Key-type filter dropdown options (value matches Redis SCAN TYPE arg).
export const REDIS_TYPE_FILTERS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All Key Types" },
  { value: "string", label: "String" },
  { value: "hash", label: "Hash" },
  { value: "list", label: "List" },
  { value: "set", label: "Set" },
  { value: "zset", label: "Sorted Set" },
  { value: "stream", label: "Stream" },
];
