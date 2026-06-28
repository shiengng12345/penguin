import type { ReactElement } from "react";
import { REDIS_VALUE_KIND_LABEL, type RedisValueKind } from "@/lib/redis-value-inspector";
import { cn } from "@/lib/utils";

const KIND_CLASS: Record<RedisValueKind, string> = {
  "json-object": "bg-sky-500/20 text-sky-400",
  "json-array": "bg-cyan-500/20 text-cyan-400",
  boolean: "bg-violet-500/20 text-violet-400",
  number: "bg-amber-500/20 text-amber-400",
  date: "bg-emerald-500/20 text-emerald-400",
  null: "bg-muted text-muted-foreground",
  string: "bg-zinc-500/20 text-zinc-300",
};

interface RedisValueTypeBadgeProps {
  kind: RedisValueKind;
}

export function RedisValueTypeBadge({ kind }: RedisValueTypeBadgeProps): ReactElement {
  return (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold", KIND_CLASS[kind])}>
      {REDIS_VALUE_KIND_LABEL[kind]}
    </span>
  );
}
