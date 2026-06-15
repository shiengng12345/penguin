// Standalone Tauri window entry for the Authenticator popover. Lives
// under `index.html#popover=auth`; main.tsx routes the bundle here
// instead of the full App when the hash matches.
//
// The window is borderless + transparent + always-on-top, so the
// rounded-corner panel below floats above EVERYTHING in the main
// window — including the native WKWebView child the Browser module
// embeds (Chrome's extension popups work the same way).

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Pencil, Settings, X } from "lucide-react";
import {
  AuthenticatorContent,
  type TotpSnapshotEntry,
} from "./AuthenticatorContent";

interface AuthPopoverSnapshot {
  entries: TotpSnapshotEntry[];
  activeWebviewLabel: string | null;
}

// Shape persisted under app_kv "penguin-auth-standalone". Kept inline
// here (not in store-types) because only the popover writes to it.
interface StandaloneEntry {
  id: string;
  title: string;
  account: string;
  secret: string;
  createdAt: number;
}

// Parse an otpauth:// URI as defined by RFC 6238 + Google Authenticator
// keyuri spec. Returns null on malformed input. Example URI:
//   otpauth://totp/Aliyun:shieng@123?secret=JBSWY3DPEHPK3PXP&issuer=Aliyun
function parseOtpauthUri(uri: string): {
  title: string;
  account: string;
  secret: string;
} | null {
  const trimmed = uri.trim();
  if (!trimmed.toLowerCase().startsWith("otpauth://totp/")) return null;
  try {
    const url = new URL(trimmed);
    const secret = url.searchParams.get("secret");
    if (secret === null || secret.length === 0) return null;
    const issuer = url.searchParams.get("issuer") ?? "";
    // pathname = "/issuer:account" — decode + split
    const rawLabel = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const colonIdx = rawLabel.indexOf(":");
    const labelIssuer = colonIdx === -1 ? "" : rawLabel.slice(0, colonIdx);
    const account = colonIdx === -1 ? rawLabel : rawLabel.slice(colonIdx + 1);
    const title = issuer.length > 0 ? issuer : labelIssuer.length > 0 ? labelIssuer : "TOTP";
    return { title, account, secret };
  } catch {
    return null;
  }
}

export function AuthPopoverApp() {
  const [snapshot, setSnapshot] = useState<AuthPopoverSnapshot | null>(null);
  const [standalone, setStandalone] = useState<StandaloneEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<boolean>(false);
  // Inline form state (only meaningful while editing=true).
  const [draftTitle, setDraftTitle] = useState("");
  const [draftAccount, setDraftAccount] = useState("");
  const [draftSecret, setDraftSecret] = useState("");
  const [draftUri, setDraftUri] = useState("");
  const [formMode, setFormMode] = useState<"manual" | "uri">("manual");
  const [formError, setFormError] = useState<string | null>(null);

  // Pull the snapshot the main window stashed in Rust state + the
  // popover-local standalone list from app_kv. Both happen in parallel.
  useEffect(() => {
    let cancelled = false;
    invoke<AuthPopoverSnapshot | null>("auth_popover_get_snapshot")
      .then((data) => {
        if (cancelled) return;
        if (data === null) {
          setLoadError("No snapshot — open the Authenticator from the Browser module.");
        } else {
          setSnapshot(data);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      });
    invoke<StandaloneEntry[] | null>("auth_load_standalone")
      .then((list) => {
        if (cancelled) return;
        if (Array.isArray(list)) setStandalone(list);
      })
      .catch(() => {
        /* standalone load is best-effort — empty list is fine */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist whenever standalone changes. Skip the first effect run
  // (we just loaded; writing back is redundant) by tracking the
  // "loaded" gate.
  const [standaloneLoaded, setStandaloneLoaded] = useState(false);
  useEffect(() => {
    if (!standaloneLoaded) {
      setStandaloneLoaded(true);
      return;
    }
    void invoke("auth_save_standalone", { entries: standalone }).catch(() => {
      /* best-effort */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standalone]);

  // Combined entries — snapshot (Vault + Aliyun) + popover-local
  // standalone. Standalone entries are tagged so the card UI can show
  // a delete X on them in edit mode.
  const combinedEntries = useMemo<TotpSnapshotEntry[]>(() => {
    const baseEntries = snapshot?.entries ?? [];
    const standaloneEntries: TotpSnapshotEntry[] = standalone.map((s) => ({
      id: `standalone-${s.id}`,
      source: "standalone",
      title: s.title,
      account: s.account,
      secret: s.secret,
      matchesActiveScope: false,
    }));
    return [...baseEntries, ...standaloneEntries];
  }, [snapshot, standalone]);

  const handleAddManual = useCallback(() => {
    const title = draftTitle.trim();
    const account = draftAccount.trim();
    const secret = draftSecret.replace(/\s+/g, "");
    if (title.length === 0 || secret.length === 0) {
      setFormError("Title + secret are required.");
      return;
    }
    setFormError(null);
    setStandalone((prev) => [
      ...prev,
      {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        account,
        secret,
        createdAt: Date.now(),
      },
    ]);
    setDraftTitle("");
    setDraftAccount("");
    setDraftSecret("");
  }, [draftTitle, draftAccount, draftSecret]);

  const handleAddFromUri = useCallback(() => {
    const parsed = parseOtpauthUri(draftUri);
    if (parsed === null) {
      setFormError("Couldn't parse — paste a full otpauth://totp/… URI.");
      return;
    }
    setFormError(null);
    setStandalone((prev) => [
      ...prev,
      {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        title: parsed.title,
        account: parsed.account,
        secret: parsed.secret,
        createdAt: Date.now(),
      },
    ]);
    setDraftUri("");
  }, [draftUri]);

  const handleDeleteStandalone = useCallback((entryId: string) => {
    // entryId comes in as "standalone-<localId>". Strip the prefix.
    const localId = entryId.replace(/^standalone-/, "");
    setStandalone((prev) => prev.filter((s) => s.id !== localId));
  }, []);

  // QR scan currently disabled — see button hiding note in the header.
  // Keeping scanError state out, since there's no scan path to surface
  // errors from. parseOtpauthUri is still used by the otpauth URI form.

  // Esc closes the window via the Rust command (Tauri auto-fires blur
  // on close anyway, but Esc gives a keyboard escape hatch that works
  // even before focus has been blurred).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        void invoke("auth_popover_close");
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const handleClose = () => {
    void invoke("auth_popover_close");
  };

  return (
    <div
      // The window is transparent (macOSPrivateApi); this wrapper
      // paints the actual chrome — rounded corners, drop shadow, full
      // height of the OS window.
      className="flex h-screen w-screen flex-col overflow-hidden rounded-lg border border-border bg-popover text-foreground shadow-2xl"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
        {/* Left: settings — no functionality yet but stays clickable
            with a brief about message. Keeps visual parity with the
            reference Authenticator extension. */}
        <button
          type="button"
          onClick={() => alert("Authenticator — Penguin. TOTP via Vault, Aliyun tab, or add directly via the pencil button.")}
          title="About Authenticator"
          aria-label="About"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center text-sm font-semibold text-foreground">
          Authenticator
        </div>
        <div className="flex items-center gap-1">
          {/* QR scan button intentionally hidden — the macOS screencapture
              + hide-popover dance is unreliable enough that we'd rather
              ship manual / otpauth-URI entry only. Re-enable by adding a
              QrCode button here that calls handleScanQr. */}
          <button
            type="button"
            onClick={() => {
              setEditing((v) => !v);
              setFormMode("manual");
              setFormError(null);
            }}
            title={editing ? "Done editing" : "Edit entries"}
            aria-label="Toggle edit mode"
            className={
              editing
                ? "flex h-6 w-6 items-center justify-center rounded bg-primary/15 text-foreground"
                : "flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            }
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close authenticator"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>
      {/* Inline add form — only visible in edit mode. Two modes
          (manual / otpauth URI) toggled via the segmented control. */}
      {editing ? (
        <div className="shrink-0 border-b border-border/60 bg-muted/10 px-3 py-2.5">
          <div className="mb-2 flex gap-1">
            <button
              type="button"
              onClick={() => {
                setFormMode("manual");
                setFormError(null);
              }}
              className={
                formMode === "manual"
                  ? "flex-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-foreground"
                  : "flex-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
              }
            >
              Manual entry
            </button>
            <button
              type="button"
              onClick={() => {
                setFormMode("uri");
                setFormError(null);
              }}
              className={
                formMode === "uri"
                  ? "flex-1 rounded border border-primary/40 bg-primary/10 px-2 py-1 text-[11px] font-medium text-foreground"
                  : "flex-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
              }
            >
              From otpauth:// URI
            </button>
          </div>
          {formMode === "manual" ? (
            <div className="flex flex-col gap-1.5">
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Title (e.g. Aliyun, GitHub)"
                className="h-7 rounded border border-border bg-background px-2 text-xs"
                autoFocus
              />
              <input
                type="text"
                value={draftAccount}
                onChange={(e) => setDraftAccount(e.target.value)}
                placeholder="Account (optional, e.g. user@example.com)"
                className="h-7 rounded border border-border bg-background px-2 text-xs"
                autoComplete="off"
              />
              <input
                type="text"
                value={draftSecret}
                onChange={(e) => setDraftSecret(e.target.value)}
                placeholder="Base32 secret (e.g. JBSWY3DPEHPK3PXP)"
                className="h-7 rounded border border-border bg-background px-2 text-[11px] font-mono"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={handleAddManual}
                className="rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-primary/20"
              >
                Add entry
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <textarea
                value={draftUri}
                onChange={(e) => setDraftUri(e.target.value)}
                placeholder="otpauth://totp/Issuer:account?secret=…"
                rows={2}
                className="rounded border border-border bg-background px-2 py-1 text-[11px] font-mono"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={handleAddFromUri}
                className="rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-primary/20"
              >
                Parse + add
              </button>
            </div>
          )}
          {formError !== null ? (
            <p className="mt-1 text-[10px] text-red-500">{formError}</p>
          ) : null}
        </div>
      ) : null}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loadError !== null ? (
          <p className="px-4 py-8 text-center text-xs text-red-400">{loadError}</p>
        ) : snapshot === null ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">Loading…</p>
        ) : (
          <AuthenticatorContent
            entries={combinedEntries}
            activeWebviewLabel={snapshot.activeWebviewLabel}
            editing={editing}
            onDeleteEntry={handleDeleteStandalone}
          />
        )}
      </div>
    </div>
  );
}
