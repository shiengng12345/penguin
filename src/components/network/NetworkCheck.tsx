import { useEffect, useState, useCallback } from "react";
import { Wifi, WifiOff, Zap, X, Loader2, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NetworkCheckProps {
  open: boolean;
  onClose: () => void;
}

interface SpeedResult {
  latency: number;
  downloadSpeed: number | null;
  status: "idle" | "testing" | "done" | "error";
  error?: string;
}

function fetchWithTimeout(url: string, opts: RequestInit, ms = 5000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function checkOnline(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    const resp = await fetchWithTimeout(
      "https://www.google.com/generate_204",
      { method: "HEAD", mode: "no-cors", cache: "no-store" },
      5000
    );
    return resp.type === "opaque" || resp.ok;
  } catch {
    return false;
  }
}

async function measureLatency(url: string): Promise<number> {
  const start = performance.now();
  await fetchWithTimeout(url, { method: "HEAD", mode: "no-cors", cache: "no-store" }, 5000);
  return Math.round(performance.now() - start);
}

async function measureDownload(): Promise<number | null> {
  try {
    const url = "https://www.google.com/images/phd/px.gif";
    const start = performance.now();
    const resp = await fetchWithTimeout(url +"?t=" +Date.now(), { cache: "no-store" }, 10000);
    const blob = await resp.blob();
    const elapsed = (performance.now() - start) / 1000;
    const bytes = blob.size;
    if (elapsed < 0.001) return null;
    const mbps = (bytes * 8) / elapsed / 1_000_000;
    return Math.round(mbps * 100) / 100;
  } catch {
    return null;
  }
}

function OfflineAlert({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 shadow-lg backdrop-blur-sm animate-in slide-in-from-bottom-4">
      <WifiOff className="h-5 w-5 text-destructive shrink-0" />
      <div>
        <p className="text-sm font-medium text-destructive">No internet connection</p>
        <p className="text-xs text-muted-foreground">Check your WiFi and try again</p>
      </div>
      <button onClick={onDismiss} className="ml-2 rounded p-1 hover:bg-accent">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function useNetworkGuard() {
  const [showOffline, setShowOffline] = useState(false);

  const guardSend = useCallback((): boolean => {
    if (!navigator.onLine) {
      setShowOffline(true);
      setTimeout(() => setShowOffline(false), 5000);
      return false;
    }
    return true;
  }, []);

  const offlineAlert = showOffline ? (
    <OfflineAlert onDismiss={() => setShowOffline(false)} />
  ) : null;

  return { guardSend, offlineAlert };
}

export function NetworkCheck({ open, onClose }: NetworkCheckProps) {
  const [online, setOnline] = useState(true);
  const [speed, setSpeed] = useState<SpeedResult>({
    latency: 0,
    downloadSpeed: null,
    status: "idle",
  });

  useEffect(() => {
    if (!open) return;
    checkOnline().then(setOnline);
    setSpeed({ latency: 0, downloadSpeed: null, status: "idle" });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const runSpeedTest = useCallback(async () => {
    const isOnline = await checkOnline();
    if (!isOnline) {
      setOnline(false);
      setSpeed({ latency: 0, downloadSpeed: null, status: "error", error: "No internet connection / 无网络连接" });
      return;
    }
    setSpeed({ latency: 0, downloadSpeed: null, status: "testing" });
    try {
      const latencies: number[] = [];
      for (let i = 0; i < 3; i++) {
        latencies.push(await measureLatency("https://www.google.com/generate_204"));
      }
      const avgLatency = Math.round(latencies.reduce((a, b) => a +b, 0) / latencies.length);

      const dl = await measureDownload();
      setSpeed({ latency: avgLatency, downloadSpeed: dl, status: "done" });
    } catch (err) {
      const msg = err instanceof Error && err.name === "AbortError"
        ? "Request timed out — connection too slow / 请求超时"
        : err instanceof Error ? err.message : "Speed test failed";
      setSpeed({ latency: 0, downloadSpeed: null, status: "error", error: msg });
    }
  }, []);

  if (!open) return null;

  const latencyColor =
    speed.latency < 100 ? "text-success" : speed.latency < 300 ? "text-amber-500" : "text-destructive";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        className="relative z-50 w-full max-w-sm rounded-lg border border-border bg-popover shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Network Check
          </h2>
          <button onClick={onClose} className="rounded p-1.5 text-muted-foreground hover:bg-accent transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3 rounded-md border border-border bg-muted/30 p-3">
            {online ? (
              <Wifi className="h-5 w-5 text-success" />
            ) : (
              <WifiOff className="h-5 w-5 text-destructive" />
            )}
            <div>
              <p className={cn("text-sm font-medium", online ? "text-success" : "text-destructive")}>
                {online ? "Connected" : "Offline"}
              </p>
              <p className="text-xs text-muted-foreground">
                {online ? "Internet connection available" : "No internet — check your WiFi"}
              </p>
            </div>
          </div>

          {speed.status === "done" && (
            <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Latency</span>
                <span className={cn("font-mono font-medium", latencyColor)}>{speed.latency}ms</span>
              </div>
              {speed.downloadSpeed !== null && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Download</span>
                  <span className="font-mono font-medium text-foreground">{speed.downloadSpeed} Mbps</span>
                </div>
              )}
            </div>
          )}

          {speed.status === "error" && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {speed.error}
            </div>
          )}

          <Button
            onClick={runSpeedTest}
            disabled={!online || speed.status === "testing"}
            className="w-full h-8"
            size="sm"
          >
            {speed.status === "testing" ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Testing...
              </>
            ) : (
              <>
                <Zap className="mr-1.5 h-3.5 w-3.5" />
                {speed.status === "done" ? "Run Again" : "Run Speed Test"}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
