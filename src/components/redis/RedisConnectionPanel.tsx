import { invoke } from "@tauri-apps/api/core";
import { KeyRound, Trash2, Zap } from "lucide-react";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConnectResult, SavedConnection } from "@/lib/redis-types";

interface Props {
  onConnected: () => void;
}

export function RedisConnectionPanel({ onConnected }: Props): ReactElement {
  const [saved, setSaved] = useState<SavedConnection[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [label, setLabel] = useState("My Redis");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("6379");
  const [db, setDb] = useState("0");
  const [password, setPassword] = useState("");

  const loadSaved = useCallback(async () => {
    try {
      const list = await invoke<SavedConnection[]>("redis_list_connections");
      setSaved(list);
    } catch {
      setSaved([]);
    }
  }, []);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  const handleConnect = useCallback(
    async (h: string, p: number, d: number, pw: string) => {
      setConnecting(true);
      setError(null);
      try {
        const result = await invoke<ConnectResult>("redis_connect", {
          host: h,
          port: p,
          password: pw,
          db: d,
        });
        if (result.ok) {
          onConnected();
        } else {
          setError(result.error ?? "Connection failed");
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setConnecting(false);
      }
    },
    [onConnected],
  );

  const handleConnectSaved = useCallback(
    async (id: string) => {
      setConnecting(true);
      setError(null);
      try {
        const result = await invoke<ConnectResult>("redis_connect_saved", { id });
        if (result.ok) {
          onConnected();
        } else {
          setError(result.error ?? "Connection failed");
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setConnecting(false);
      }
    },
    [onConnected],
  );

  const handleSaveAndConnect = useCallback(async () => {
    const p = parseInt(port, 10) || 6379;
    const d = parseInt(db, 10) || 0;
    try {
      await invoke("redis_save_connection", {
        label,
        host,
        port: p,
        db: d,
        password,
      });
      await loadSaved();
    } catch {
      // save failed — still try to connect
    }
    await handleConnect(host, p, d, password);
  }, [label, host, port, db, password, handleConnect, loadSaved]);

  const handleDelete = useCallback(
    async (id: string) => {
      await invoke("redis_delete_connection", { id }).catch(() => {});
      await loadSaved();
    },
    [loadSaved],
  );

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="text-sm font-semibold text-foreground">Connect to Redis</div>

      {/* New connection form */}
      <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <label className="mb-1 block text-[11px] text-muted-foreground">Label</label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-7 text-xs" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">Host</label>
            <Input value={host} onChange={(e) => setHost(e.target.value)} className="h-7 text-xs" placeholder="127.0.0.1" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">Port</label>
            <Input value={port} onChange={(e) => setPort(e.target.value)} className="h-7 text-xs" placeholder="6379" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">DB</label>
            <Input value={db} onChange={(e) => setDb(e.target.value)} className="h-7 text-xs" placeholder="0" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">Password</label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-7 text-xs" placeholder="(optional)" />
          </div>
        </div>
        {error !== null ? (
          <p className="text-[11px] text-destructive">{error}</p>
        ) : null}
        <Button
          size="sm"
          className="w-full gap-1.5"
          disabled={connecting || host.length === 0}
          onClick={handleSaveAndConnect}
        >
          <Zap className="h-3.5 w-3.5" />
          {connecting ? "Connecting…" : "Connect & Save"}
        </Button>
      </div>

      {/* Saved connections */}
      {saved.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Saved</div>
          {saved.map((c) => (
            <div
              key={c.id}
              className="group flex items-center gap-2 rounded border border-border bg-card px-3 py-2 text-xs"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left hover:text-primary"
                onClick={() => handleConnectSaved(c.id)}
              >
                <div className="truncate font-medium">{c.label}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {c.host}:{c.port} / db{c.db}
                </div>
              </button>
              {c.has_password ? (
                <KeyRound
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
                  aria-label="Saved password"
                />
              ) : null}
              <button
                type="button"
                onClick={() => handleDelete(c.id)}
                className="shrink-0 text-muted-foreground/50 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
