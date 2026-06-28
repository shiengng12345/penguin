import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState, type ReactElement } from "react";
import type { RedisStats } from "@/lib/redis-types";

interface RedisStatsPanelProps {
  stats?: RedisStats | null;
}

export function RedisStatsPanel({ stats: externalStats }: RedisStatsPanelProps): ReactElement {
  const [localStats, setLocalStats] = useState<RedisStats | null>(null);

  useEffect(() => {
    if (externalStats !== undefined) return;

    // Fetch once immediately on mount.
    void invoke<RedisStats>("redis_info").then(setLocalStats).catch(() => {});

    // Start background push (5s interval from Rust).
    void invoke("redis_stats_start").catch(() => {});

    // Listen for pushed updates.
    const unlisten = listen<RedisStats>("redis-stats-update", (e) => {
      setLocalStats(e.payload);
    });

    return () => {
      void invoke("redis_stats_stop").catch(() => {});
      void unlisten.then((fn) => fn());
    };
  }, [externalStats]);

  const stats = externalStats !== undefined ? externalStats : localStats;

  if (stats === null) {
    return <div className="p-4 text-xs text-muted-foreground">Loading stats…</div>;
  }

  const uptimeHours = Math.floor(stats.uptime_in_seconds / 3600);
  const uptimeMins = Math.floor((stats.uptime_in_seconds % 3600) / 60);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {/* Server info */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Server</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">Version</span>
          <span className="font-mono">{stats.redis_version}</span>
          <span className="text-muted-foreground">Uptime</span>
          <span className="font-mono">{uptimeHours}h {uptimeMins}m</span>
          <span className="text-muted-foreground">Ops/sec</span>
          <span className="font-mono">{stats.instantaneous_ops_per_sec}</span>
          <span className="text-muted-foreground">Total cmds</span>
          <span className="font-mono">{stats.total_commands_processed.toLocaleString()}</span>
        </div>
      </div>

      {/* Memory */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Memory</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">Used</span>
          <span className="font-mono text-emerald-400">{stats.used_memory_human}</span>
          <span className="text-muted-foreground">Peak</span>
          <span className="font-mono">{stats.used_memory_peak_human}</span>
          <span className="text-muted-foreground">RSS</span>
          <span className="font-mono">{stats.used_memory_rss_human}</span>
        </div>
      </div>

      {/* Clients */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Clients</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">Connected</span>
          <span className="font-mono text-sky-400">{stats.connected_clients}</span>
          <span className="text-muted-foreground">Blocked</span>
          <span className="font-mono text-amber-400">{stats.blocked_clients}</span>
        </div>
      </div>

      {/* Keyspace */}
      {stats.keyspace.length > 0 ? (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Keyspace</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[10px] text-muted-foreground">
                <th className="pb-1 font-medium">DB</th>
                <th className="pb-1 font-medium text-right">Keys</th>
                <th className="pb-1 font-medium text-right">Expires</th>
              </tr>
            </thead>
            <tbody>
              {stats.keyspace.map((ks) => (
                <tr key={ks.db} className="border-b border-border/30">
                  <td className="py-1 font-mono text-muted-foreground">{ks.db}</td>
                  <td className="py-1 text-right font-mono">{ks.keys.toLocaleString()}</td>
                  <td className="py-1 text-right font-mono text-amber-400">{ks.expires.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="text-center text-[10px] text-muted-foreground/50">Auto-refreshes every 5s</p>
    </div>
  );
}
