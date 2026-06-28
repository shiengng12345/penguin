import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Activity, Key, Plus, Unplug, X } from "lucide-react";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { RedisKeyType, RedisStats } from "@/lib/redis-types";
import { RedisSidebar } from "./RedisSidebar";
import { RedisConnectionPanel } from "./RedisConnectionPanel";
import { RedisKeyBrowser } from "./RedisKeyBrowser";
import { RedisValuePanel } from "./RedisValuePanel";
import { RedisStatsPanel } from "./RedisStatsPanel";

type RedisPanelTab = "keys" | "stats";
type SidebarTab = "vault" | "manual";

export interface RedisPageProps {
  onClose: () => void;
}

interface RedisHeaderStatProps {
  label: string;
  value: string;
}

function RedisHeaderStat({ label, value }: RedisHeaderStatProps): ReactElement {
  return (
    <span className="flex items-baseline gap-1 whitespace-nowrap text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </span>
  );
}

export function RedisPage({ onClose }: RedisPageProps): ReactElement {
  const [connected, setConnected] = useState(false);
  const [activeVaultKey, setActiveVaultKey] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<RedisPanelTab>("keys");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("vault");
  const [selectedKey, setSelectedKey] = useState<{ key: string; type: RedisKeyType } | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [stats, setStats] = useState<RedisStats | null>(null);
  const [dbSize, setDbSize] = useState<number | null>(null);

  const handleConnected = useCallback((vaultKey?: string) => {
    setConnected(true);
    setConnectError(null);
    setActiveVaultKey(vaultKey ?? null);
  }, []);

  useEffect(() => {
    if (!connected) {
      setStats(null);
      setDbSize(null);
      return;
    }

    let cancelled = false;

    const refreshSnapshot = async () => {
      const [nextStats, nextDbSize] = await Promise.all([
        invoke<RedisStats>("redis_info").catch(() => null),
        invoke<number>("redis_dbsize").catch(() => null),
      ]);
      if (cancelled) return;
      setStats(nextStats);
      setDbSize(nextDbSize);
    };

    void refreshSnapshot();
    void invoke("redis_stats_start").catch(() => {});

    const unlisten = listen<RedisStats>("redis-stats-update", (event) => {
      setStats(event.payload);
    });
    const keyCountTimer = window.setInterval(() => {
      void invoke<number>("redis_dbsize").then(setDbSize).catch(() => {});
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(keyCountTimer);
      void unlisten.then((fn) => fn());
      void invoke("redis_stats_stop").catch(() => {});
    };
  }, [connected]);

  const handleDisconnect = useCallback(async () => {
    await invoke("redis_disconnect").catch(() => {});
    await invoke("redis_stats_stop").catch(() => {});
    setConnected(false);
    setActiveVaultKey(null);
    setSelectedKey(null);
  }, []);

  return (
    <section className="flex h-full flex-col bg-background">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex shrink-0 items-center gap-2">
            <div
              className={cn(
                "h-2 w-2 rounded-full",
                connected ? "bg-emerald-500" : "bg-muted-foreground/30",
              )}
            />
            <span className="text-sm font-semibold text-foreground">Redis</span>
            {connected ? (
              <span className="text-xs text-emerald-400">Connected</span>
            ) : (
              <span className="text-xs text-muted-foreground">Disconnected</span>
            )}
          </div>
          {connected ? (
            <div className="hidden min-w-0 items-center gap-3 overflow-hidden md:flex">
              <RedisHeaderStat label="Memory" value={stats?.used_memory_human ?? "—"} />
              <RedisHeaderStat label="Keys" value={dbSize?.toLocaleString() ?? "—"} />
              <RedisHeaderStat
                label="Ops/sec"
                value={stats?.instantaneous_ops_per_sec.toLocaleString() ?? "—"}
              />
              <RedisHeaderStat
                label="Clients"
                value={stats?.connected_clients.toLocaleString() ?? "—"}
              />
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {connected ? (
            <>
              <button
                type="button"
                onClick={() => setPanelTab("keys")}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors",
                  panelTab === "keys"
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Key className="h-3 w-3" />
                Keys
              </button>
              <button
                type="button"
                onClick={() => setPanelTab("stats")}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors",
                  panelTab === "stats"
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Activity className="h-3 w-3" />
                Stats
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-destructive"
                title="Disconnect"
              >
                <Unplug className="h-3 w-3" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="ml-2 flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            title="Close Redis"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left sidebar — always visible */}
        <aside className="flex w-52 shrink-0 flex-col border-r border-border/60 bg-muted/20">
          {/* Sidebar tab switcher: Vault vs Manual */}
          <div className="flex shrink-0 border-b border-border/60">
            <button
              type="button"
              onClick={() => setSidebarTab("vault")}
              className={cn(
                "flex-1 py-1.5 text-[11px] font-medium transition-colors",
                sidebarTab === "vault"
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Vault
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab("manual")}
              className={cn(
                "flex items-center justify-center gap-1 flex-1 py-1.5 text-[11px] font-medium transition-colors",
                sidebarTab === "manual"
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Plus className="h-3 w-3" />
              Manual
            </button>
          </div>

          {/* Error banner */}
          {connectError !== null ? (
            <div className="shrink-0 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {connectError}
              <button
                type="button"
                className="ml-1 underline"
                onClick={() => setConnectError(null)}
              >
                dismiss
              </button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-hidden">
            {sidebarTab === "vault" ? (
              <RedisSidebar
                activeKey={activeVaultKey}
                onConnected={(key) => handleConnected(key)}
                onError={setConnectError}
              />
            ) : (
              <RedisConnectionPanel onConnected={() => handleConnected()} />
            )}
          </div>
        </aside>

        {/* Right panel */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {!connected ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
              <p>Select a Redis connection from the sidebar.</p>
              <p className="text-[11px] text-muted-foreground/60">
                Vault tab shows credentials from your projects.<br />
                Manual tab lets you add a custom connection.
              </p>
            </div>
          ) : panelTab === "stats" ? (
            <RedisStatsPanel stats={stats} />
          ) : (
            <div className="flex h-full">
              <div className="w-[420px] shrink-0 overflow-hidden border-r border-border/60">
                <RedisKeyBrowser
                  onSelectKey={(key, type) => setSelectedKey({ key, type })}
                />
              </div>
              <div className="min-w-0 flex-1 overflow-hidden">
                {selectedKey !== null ? (
                  <RedisValuePanel
                    keyName={selectedKey.key}
                    keyType={selectedKey.type}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Select a key to view its value
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
