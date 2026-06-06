import { useCallback, useEffect, useRef, useState } from "react";
import { Wrench } from "lucide-react";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";
import { useAppStore } from "@/lib/store";
import { clearTokenInMemory, validateAndSetToken } from "@/lib/dev-mode-store";
import { deletePersistedValue } from "@/lib/app-persistence";
import { APP_VALUE_KEYS } from "@/lib/persistence-keys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const TOKEN_ERROR_CLEAR_MS = 5000;
const TOKEN_ERROR_MESSAGE = "Token 不正确";
const TOKEN_VERIFIED_MESSAGE = "✓ Token verified";
const STATUS_OFF = "Dev Mode 状态：已关闭（输入 token 解锁）";
const STATUS_ON_VALID = "Dev Mode 状态：已开启 ✓";

// Settings block that owns the Dev Mode state.
// On/Off is NOT user-toggleable — it is purely a status badge derived from
// token validation. Token field is always visible until validation succeeds;
// once verified, the field collapses into a "Change token" affordance.
export function DeveloperModeSection() {
  const { hasValidToken } = useDeveloperMode();
  const setDevModeEnabled = useAppStore((state) => state.setDevModeEnabled);

  const [tokenInput, setTokenInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [verifiedFlash, setVerifiedFlash] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel any pending error-clear timer on unmount so we don't setState
  // after the component is gone.
  useEffect(() => {
    return () => {
      const pendingTimer = errorTimerRef.current;
      if (pendingTimer) clearTimeout(pendingTimer);
    };
  }, []);

  // Force re-entry — wipes in-memory + disk token + flips Dev Mode back off so
  // the input form reappears for a fresh token attempt.
  const handleChangeToken = useCallback((): void => {
    clearTokenInMemory();
    deletePersistedValue(APP_VALUE_KEYS.devModeToken);
    setDevModeEnabled(false);
    setTokenInput("");
    setErrorMessage(null);
    setVerifiedFlash(false);
  }, [setDevModeEnabled]);

  // Validate handler — sends only the password input through the validator.
  // On match, we flip Dev Mode ON ourselves (replaces the old manual toggle)
  // so the rest of the app lights up Vault + Home affordances.
  const handleValidate = useCallback(async () => {
    const isInputEmpty = tokenInput.length === 0;
    if (isInputEmpty) {
      setErrorMessage(TOKEN_ERROR_MESSAGE);
      return;
    }
    const result = await validateAndSetToken({ input: tokenInput });
    if (result.matched) {
      setDevModeEnabled(true);
      setTokenInput("");
      setErrorMessage(null);
      setVerifiedFlash(true);
      return;
    }
    setErrorMessage(TOKEN_ERROR_MESSAGE);
    const existingTimer = errorTimerRef.current;
    if (existingTimer) clearTimeout(existingTimer);
    errorTimerRef.current = setTimeout(() => setErrorMessage(null), TOKEN_ERROR_CLEAR_MS);
  }, [tokenInput, setDevModeEnabled]);

  const handleEnterKey = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const isEnter = event.key === "Enter";
    if (isEnter) void handleValidate();
  };

  const statusText = hasValidToken ? STATUS_ON_VALID : STATUS_OFF;
  const badgeLabel = hasValidToken ? "On / 开" : "Off / 关";

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4 md:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-foreground flex items-center gap-1.5">
            <Wrench className="h-3.5 w-3.5" />
            Developer Mode / 开发者模式
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Unlock Vault and other internal tools. 解锁保险柜与内部工具。
          </p>
        </div>
        <span
          className={cn(
            "select-none rounded-md px-3 py-1 text-xs font-medium",
            hasValidToken
              ? "bg-primary text-primary-foreground"
              : "border border-border bg-muted/40 text-muted-foreground",
          )}
          aria-live="polite"
          title="Status derives from token validation — not user-toggleable"
        >
          {badgeLabel}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className={cn("text-xs", hasValidToken ? "text-emerald-500" : "text-muted-foreground")}>
          {statusText}
        </p>
        {hasValidToken && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleChangeToken}
              className="text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              title="Clear token and enter a different one"
            >
              Change token / 换 token
            </button>
            <button
              type="button"
              onClick={handleChangeToken}
              className="rounded-md border border-destructive/30 px-2 py-0.5 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/10"
              title="Clear token, lock Vault + Home"
            >
              Turn off / 关闭
            </button>
          </div>
        )}
      </div>

      {!hasValidToken && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs text-muted-foreground">
            Token / 令牌
          </label>
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={handleEnterKey}
              placeholder="Enter dev mode token"
              className="flex-1"
            />
            <Button variant="default" size="sm" onClick={handleValidate}>
              Validate / 验证
            </Button>
          </div>
          {errorMessage && (
            <p className="text-xs text-destructive">{errorMessage}</p>
          )}
        </div>
      )}

      {verifiedFlash && hasValidToken && (
        <p className="mt-2 text-xs text-emerald-500">{TOKEN_VERIFIED_MESSAGE}</p>
      )}
    </div>
  );
}
