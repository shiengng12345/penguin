import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, Unlock, KeyRound, ShieldCheck, X } from "lucide-react";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";
import { useAppStore } from "@/lib/store";
import { clearTokenInMemory, validateAndSetToken } from "@/lib/dev-mode-store";
import { deletePersistedValue } from "@/lib/app-persistence";
import { APP_VALUE_KEYS } from "@/lib/persistence-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TOKEN_ERROR_CLEAR_MS = 5000;

// Standalone, redesigned Developer Mode form. Reached only via the hidden
// Cmd+A+D hold gesture (see App.tsx) — never shown in Settings — so casual
// users can't discover it. Owns the same validate / change / turn-off flow
// as the old settings card, in a focused centered modal.
export function DeveloperModeModal({ onClose }: { onClose: () => void }) {
  const { hasValidToken, isSuperAdmin } = useDeveloperMode();
  const setDevModeEnabled = useAppStore((s) => s.setDevModeEnabled);

  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Esc closes; clean up the error timer on unmount.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (errTimerRef.current) clearTimeout(errTimerRef.current);
    };
  }, [onClose]);

  const validate = useCallback(async () => {
    if (tokenInput.length === 0) {
      setError("请输入 token / Enter a token");
      return;
    }
    const result = await validateAndSetToken({ input: tokenInput });
    if (result.matched) {
      setDevModeEnabled(true);
      setTokenInput("");
      setError(null);
      return;
    }
    setError("Token 不正确 / Incorrect token");
    if (errTimerRef.current) clearTimeout(errTimerRef.current);
    errTimerRef.current = setTimeout(() => setError(null), TOKEN_ERROR_CLEAR_MS);
  }, [tokenInput, setDevModeEnabled]);

  const turnOff = useCallback(() => {
    clearTokenInMemory();
    deletePersistedValue(APP_VALUE_KEYS.devModeToken);
    setDevModeEnabled(false);
    setTokenInput("");
    setError(null);
  }, [setDevModeEnabled]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Developer Mode"
        className="relative z-[61] w-full max-w-sm rounded-2xl border border-border bg-popover p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center text-center">
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full transition-colors",
              hasValidToken ? "bg-emerald-500/15 text-emerald-500" : "bg-primary/15 text-primary",
            )}
          >
            {hasValidToken ? <Unlock className="h-6 w-6" /> : <Lock className="h-6 w-6" />}
          </div>
          <h2 className="mt-3 text-base font-semibold text-foreground">Developer Mode</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            开发者模式 · 解锁 Vault 与内部工具
          </p>
        </div>

        {hasValidToken ? (
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-500">
              <ShieldCheck className="h-4 w-4" />
              已解锁{isSuperAdmin ? " · Super Admin" : " · Admin"}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={turnOff}>
                换 token
              </Button>
              <Button className="flex-1" onClick={onClose}>
                完成 / Done
              </Button>
            </div>
            <button
              type="button"
              onClick={turnOff}
              className="block w-full text-center text-[11px] text-destructive transition-colors hover:underline"
            >
              关闭开发者模式 / Turn off
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                value={tokenInput}
                onChange={(e) => {
                  setTokenInput(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void validate();
                }}
                placeholder="输入 token / Enter token"
                className={cn("pl-9", error && "border-destructive ring-1 ring-destructive/40")}
              />
            </div>
            {error && <p className="text-center text-xs text-destructive">{error}</p>}
            <Button className="w-full" onClick={validate}>
              解锁 / Unlock
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
