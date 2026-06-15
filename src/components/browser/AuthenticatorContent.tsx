// Presentational authenticator panel. Receives a pre-resolved snapshot
// of TOTP entries + the active inline webview's label as props — no
// Zustand / Vault store dependency. Used by AuthPopoverApp inside the
// standalone Tauri popover window (the in-app inline variant was
// retired because native WKWebView child views always paint above
// HTML, making an inline overlay impossible to render cleanly).

import { useCallback, useEffect, useState } from "react";
import { Check, Trash2, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { writeClipboard } from "@/lib/clipboard";
import { evalInlineWebview } from "@/lib/inline-webview";
import { logger } from "@/lib/logger";
import { generateTotp, formatTotpCode } from "@/lib/totp";

const LOG_SCOPE = "AuthenticatorContent";

// Wire shape passed FROM BrowserPage → AuthPopoverState (Rust) →
// AuthPopoverApp. Snake-case kept exactly as Rust serialises so the
// invoke layer round-trips it byte-for-byte without renames.
export interface TotpSnapshotEntry {
  id: string;
  // Top-of-card title — the service / app name the user identifies this
  // entry by (e.g. "Aliyun", "Argo Username", "Lark Auth System").
  title: string;
  // Below-code identity line — email / username / context string.
  account: string;
  // RFC 4648 base32 secret used to generate the 6-digit code.
  secret: string;
  // Stable origin tag — drives sort order, edit-permissions, and the
  // small context line. "vault" entries are managed via Vault module;
  // "aliyun" come from Aliyun account TOTPs; "standalone" are added
  // directly inside the Authenticator popover (Phase 2).
  source: "vault" | "aliyun" | "jenkins" | "standalone";
  // Vault-only — kept so the popover can show "This shortcut" header
  // when the active Browser shortcut shares project + env with the
  // entry. Aliyun / standalone entries leave these undefined.
  projectId?: string;
  envId?: string;
  contextLabel?: string;
  envColor?: string | null;
  matchesActiveScope: boolean;
}

export interface AuthenticatorContentProps {
  entries: TotpSnapshotEntry[];
  // null when no shortcut is open in the main window — the Fill button
  // is then disabled (there's nothing to inject into).
  activeWebviewLabel: string | null;
  // Edit mode flag — when true, standalone-source cards show a small
  // trash button. Vault/Aliyun entries can't be deleted from the
  // popover (manage them in their respective tab).
  editing?: boolean;
  onDeleteEntry?: (entryId: string) => void;
}

export function AuthenticatorContent({
  entries,
  activeWebviewLabel,
  editing = false,
  onDeleteEntry,
}: AuthenticatorContentProps) {
  if (entries.length === 0) {
    return (
      <p className="px-4 py-12 text-center text-xs text-muted-foreground/70">
        No TOTP entries yet. Add one via Vault → Authenticator (TOTP)
        template, or add an Aliyun account with a 2FA secret in the
        Browser → Aliyun tab.
      </p>
    );
  }
  const matched = entries.filter((e) => e.matchesActiveScope);
  const others = entries.filter((e) => !e.matchesActiveScope);
  return (
    <div className="flex flex-col gap-2.5 p-3">
      {matched.length > 0 ? (
        <>
          <SectionHeader
            label={`This shortcut · ${matched[0].contextLabel ?? "—"}`}
          />
          {matched.map((e) => (
            <TotpCard
              key={e.id}
              entry={e}
              activeWebviewLabel={activeWebviewLabel}
              editing={editing}
              onDelete={onDeleteEntry}
            />
          ))}
        </>
      ) : null}
      {others.length > 0 ? (
        <>
          {matched.length > 0 ? <SectionHeader label="All accounts" /> : null}
          {others.map((e) => (
            <TotpCard
              key={e.id}
              entry={e}
              activeWebviewLabel={activeWebviewLabel}
              editing={editing}
              onDelete={onDeleteEntry}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
      {label}
    </div>
  );
}

interface TotpCardProps {
  entry: TotpSnapshotEntry;
  activeWebviewLabel: string | null;
  editing: boolean;
  onDelete?: (entryId: string) => void;
}

function TotpCard({ entry, activeWebviewLabel, editing, onDelete }: TotpCardProps) {
  const [code, setCode] = useState<string>("------");
  const [seconds, setSeconds] = useState<number>(30);
  const [fraction, setFraction] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [filled, setFilled] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function refresh() {
      try {
        const result = await generateTotp(entry.secret);
        if (cancelled) return;
        setCode(result.code);
        setSeconds(result.secondsRemaining);
        setFraction(result.fractionRemaining);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setCode("------");
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    void refresh();
    timer = window.setInterval(() => {
      void refresh();
    }, 1000);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearInterval(timer);
    };
  }, [entry.secret]);

  const onCopy = useCallback(async () => {
    try {
      await writeClipboard(code.replace(/\s/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (err) {
      logger.error(LOG_SCOPE, "copy failed", err);
    }
  }, [code]);

  const onFill = useCallback(async () => {
    if (activeWebviewLabel === null) return;
    const safe = JSON.stringify(code.replace(/\s/g, ""));
    const script = `(function(c){
  var selectors=[
    'input[autocomplete="one-time-code"]',
    'input[name="otp"]',
    'input[name="code"]',
    'input[name="token"]',
    'input[name="mfa"]',
    'input[name="2fa"]',
    'input[inputmode="numeric"]',
    'input[type="tel"]',
    'input[type="number"]'
  ];
  function findVisible(){
    for(var si=0;si<selectors.length;si++){
      var nodes=document.querySelectorAll(selectors[si]);
      for(var i=0;i<nodes.length;i++){
        var el=nodes[i];
        if(el.offsetParent===null) continue;
        if(el.disabled||el.readOnly) continue;
        return el;
      }
    }
    return null;
  }
  var input=findVisible();
  if(input===null){console.log('[penguin] otp fill: no visible OTP input');return false;}
  var d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');
  if(d&&d.set){d.set.call(input,c);} else {input.value=c;}
  input.dispatchEvent(new Event('input',{bubbles:true}));
  input.dispatchEvent(new Event('change',{bubbles:true}));
  input.focus();
  console.log('[penguin] otp fill: applied');
  return true;
})(${safe});`;
    try {
      await evalInlineWebview(activeWebviewLabel, script);
      setFilled(true);
      setTimeout(() => setFilled(false), 1200);
    } catch (err) {
      logger.error(LOG_SCOPE, "fill failed", err, { label: activeWebviewLabel });
    }
  }, [code, activeWebviewLabel]);

  // Whole-card click → copy. Fill remains as an icon-only action that
  // sits in the top-right corner (only visible on hover) so the primary
  // gesture matches Authenticator-extension UX: glance at code, click
  // to copy.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        if (error === null) void onCopy();
      }}
      onKeyDown={(e) => {
        if (error === null && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          void onCopy();
        }
      }}
      className={cn(
        "group relative rounded-lg border bg-background/60 p-3 transition-colors",
        copied
          ? "border-emerald-500/40 bg-emerald-500/5"
          : "border-border/60 hover:border-border hover:bg-background/80 cursor-pointer",
      )}
      title={error === null ? "Click to copy code" : `Invalid secret: ${error}`}
    >
      {/* Top row — title + Fill icon (on hover) + Delete (when editing
          standalone). Vault/Aliyun entries can't be deleted here. */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {entry.title}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {editing && entry.source === "standalone" && onDelete !== undefined ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(entry.id);
              }}
              title="Delete this entry"
              aria-label="Delete entry"
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          ) : null}
          {activeWebviewLabel !== null && error === null && !editing ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void onFill();
              }}
              title="Fill into current webview's OTP input"
              aria-label="Fill OTP"
              className="opacity-0 group-hover:opacity-100 flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-opacity"
            >
              {filled ? (
                <Check className="h-3 w-3 text-emerald-500" />
              ) : (
                <Wand2 className="h-3 w-3" />
              )}
            </button>
          ) : null}
        </div>
      </div>

      {/* Code row — large bold + pie countdown on the right */}
      <div className="mt-1 flex items-center justify-between gap-3">
        <div className="font-mono text-[2rem] leading-none font-bold tabular-nums tracking-wide text-foreground">
          {error === null ? formatTotpCode(code) : "—"}
        </div>
        <CountdownPie fraction={fraction} seconds={seconds} />
      </div>

      {/* Account / identity line — bottom */}
      <div className="mt-1.5 truncate text-[11px] text-muted-foreground/80">
        {entry.account}
      </div>

      {/* Copied toast indicator */}
      {copied ? (
        <div className="absolute right-3 top-3 text-[10px] font-medium uppercase tracking-wider text-emerald-500">
          Copied
        </div>
      ) : null}

      {error !== null ? (
        <p className="mt-1 text-[10px] text-red-500">Invalid secret</p>
      ) : null}
    </div>
  );
}

interface CountdownPieProps {
  fraction: number;
  seconds: number;
}

// Filled-wedge countdown (Chrome Authenticator-extension style): a
// circle that visually empties as the TOTP window expires. Green when
// > 5s remain, red when ≤ 5s.
function CountdownPie({ fraction, seconds }: CountdownPieProps) {
  const size = 22;
  const r = size / 2;
  const cx = r;
  const cy = r;
  const color = seconds <= 5 ? "fill-red-500" : "fill-emerald-500";
  // SVG wedge — center, start at 12 o'clock, sweep clockwise.
  // fraction=1 → full circle; fraction=0 → empty.
  const angle = fraction * 2 * Math.PI;
  // 360° wedge can't be drawn as an arc (start == end). Use full
  // circle when fraction is close to 1.
  const wedgePath = (() => {
    if (fraction >= 0.999) {
      return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} Z`;
    }
    if (fraction <= 0.001) return "";
    const endX = cx + r * Math.sin(angle);
    const endY = cy - r * Math.cos(angle);
    const largeArc = angle > Math.PI ? 1 : 0;
    return `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY} Z`;
  })();
  return (
    <div className="relative h-[22px] w-[22px] shrink-0" title={`${seconds}s`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={cx}
          cy={cy}
          r={r - 0.5}
          className="fill-muted-foreground/15"
        />
        {wedgePath.length > 0 ? (
          <path
            d={wedgePath}
            className={cn(color, "transition-[d] duration-[950ms] ease-linear")}
          />
        ) : null}
      </svg>
    </div>
  );
}
