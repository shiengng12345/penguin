// Sprint 10 Phase 10D — Cookies tab UI.
//
// Lists the collection's cookies (auto-saved by Rust from Set-Cookie response
// headers since 10D) AND lets the user add / edit / delete entries manually.
// Read + write share the same SQLite-backed cookie_store on the Rust side,
// so user-typed and server-set cookies live in one consistent bucket.

import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  clearCookies,
  deleteCookie,
  getCookies,
  saveCookie,
} from "./rest-keychain";
import type { RestCookie, RestRequestRecord } from "./rest-types";

export interface RestCookiesPanelProps {
  request: RestRequestRecord;
}

// Draft state used by the inline + Add row. expiryRaw is kept as the raw
// text the user typed so they can still see / edit it without it being
// pre-parsed; on commit we parse it into an absolute millis-since-epoch.
interface CookieDraft {
  domain: string;
  name: string;
  value: string;
  path: string;
  expiryRaw: string;
}

const EMPTY_DRAFT: CookieDraft = {
  domain: "",
  name: "",
  value: "",
  path: "",
  expiryRaw: "",
};

export function RestCookiesPanel({ request }: RestCookiesPanelProps) {
  const [cookies, setCookies] = useState<RestCookie[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingDraft, setAddingDraft] = useState<CookieDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    if (!request.collectionId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await getCookies({ collectionId: request.collectionId });
      setCookies(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [request.collectionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleClear = async () => {
    if (!request.collectionId) return;
    try {
      await clearCookies({ collectionId: request.collectionId });
      setCookies([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveDraft = async () => {
    if (!addingDraft || !request.collectionId) return;
    const domain = addingDraft.domain.trim();
    const name = addingDraft.name.trim();
    if (!domain || !name) {
      setError("Domain and Name are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const cookie: RestCookie = {
        domain,
        name,
        value: addingDraft.value,
        path: addingDraft.path.trim() || undefined,
        expiresAt: parseExpiry(addingDraft.expiryRaw),
      };
      await saveCookie({ collectionId: request.collectionId, cookie });
      setAddingDraft(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: RestCookie) => {
    if (!request.collectionId) return;
    try {
      await deleteCookie({
        collectionId: request.collectionId,
        domain: c.domain,
        name: c.name,
      });
      setCookies((prev) => prev.filter((x) => !(x.domain === c.domain && x.name === c.name)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex w-full flex-col p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Cookies stored for this collection
        </span>
        <div className="flex items-center gap-1">
          {!addingDraft && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px]"
              onClick={() => setAddingDraft({ ...EMPTY_DRAFT })}
            >
              <Plus className="mr-1 h-3 w-3" />
              Add
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-[11px]"
            onClick={() => void refresh()}
            disabled={loading}
          >
            <RefreshCw className={`mr-1 h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {cookies.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px] text-muted-foreground hover:text-destructive"
              onClick={() => void handleClear()}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Clear all
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="rounded border border-border/60">
        <div className="grid grid-cols-[1fr_1.5fr_1.5fr_1fr_1fr_28px] gap-2 border-b border-border/60 bg-muted/30 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Domain</span>
          <span>Name</span>
          <span>Value</span>
          <span>Path</span>
          <span>Expires</span>
          <span />
        </div>

        {/* Inline + Add row — shown when user clicks Add */}
        {addingDraft && (
          <div className="grid grid-cols-[1fr_1.5fr_1.5fr_1fr_1fr_28px] items-center gap-2 border-b border-border/60 bg-accent/30 px-2 py-1">
            <Input
              autoFocus
              value={addingDraft.domain}
              onChange={(e) => setAddingDraft({ ...addingDraft, domain: e.target.value })}
              placeholder="api.example.com"
              className="h-7 font-mono text-[11px]"
            />
            <Input
              value={addingDraft.name}
              onChange={(e) => setAddingDraft({ ...addingDraft, name: e.target.value })}
              placeholder="session"
              className="h-7 font-mono text-[11px]"
            />
            <Input
              value={addingDraft.value}
              onChange={(e) => setAddingDraft({ ...addingDraft, value: e.target.value })}
              placeholder="abc123…"
              className="h-7 font-mono text-[11px]"
            />
            <Input
              value={addingDraft.path}
              onChange={(e) => setAddingDraft({ ...addingDraft, path: e.target.value })}
              placeholder="/"
              className="h-7 font-mono text-[11px]"
            />
            <Input
              value={addingDraft.expiryRaw}
              onChange={(e) => setAddingDraft({ ...addingDraft, expiryRaw: e.target.value })}
              placeholder="never | 1d | 2026-12-31"
              className="h-7 font-mono text-[11px]"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSaveDraft();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setAddingDraft(null);
                }
              }}
            />
            <div className="flex items-center justify-end gap-0.5">
              <button
                type="button"
                onClick={() => void handleSaveDraft()}
                disabled={saving || !addingDraft.domain.trim() || !addingDraft.name.trim()}
                className="rounded p-1 text-emerald-600 hover:bg-accent disabled:opacity-40"
                title="Save"
                aria-label="Save cookie"
              >
                <Plus className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => setAddingDraft(null)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
                title="Cancel"
                aria-label="Cancel"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {cookies.length === 0 && !addingDraft ? (
          <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
            No cookies yet — click + Add or send a request that returns Set-Cookie headers.
          </p>
        ) : (
          cookies.map((c, i) => (
            <div
              key={`${c.domain}-${c.name}-${i}`}
              className="group grid grid-cols-[1fr_1.5fr_1.5fr_1fr_1fr_28px] items-center gap-2 border-b border-border/40 px-2 py-1 text-[11px] last:border-b-0"
            >
              <span className="truncate font-mono text-muted-foreground" title={c.domain}>
                {c.domain}
              </span>
              <span className="truncate font-mono" title={c.name}>
                {c.name}
              </span>
              <span className="truncate font-mono" title={c.value}>
                {c.value}
              </span>
              <span className="truncate font-mono text-muted-foreground" title={c.path ?? "(any)"}>
                {c.path ?? "(any)"}
              </span>
              <span className="truncate font-mono text-muted-foreground">
                {formatExpiry(c.expiresAt)}
              </span>
              <button
                type="button"
                onClick={() => void handleDelete(c)}
                aria-label={`Delete cookie ${c.name}`}
                className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                title="Delete cookie"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))
        )}
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">
        Tip — Expires accepts <code>never</code>, relative offsets like <code>1h</code> / <code>30m</code> /{" "}
        <code>7d</code>, ISO-8601 like <code>2026-12-31T23:59</code>, or leave empty for a session cookie.
      </p>
    </div>
  );
}

// Parse the user's Expires text into a millis-since-epoch timestamp, or
// undefined for "session cookie" (no fixed expiry). Accepts:
//   ""        | "never" | "session"       → undefined (session cookie)
//   "30m" | "2h" | "7d" | "365d"          → now + delta
//   "2026-12-31"                          → Date.parse → millis
//   "2026-12-31T23:59:59Z"                → Date.parse → millis
//   any other unparseable text            → undefined (session cookie)
function parseExpiry(input: string): number | undefined {
  const text = input.trim().toLowerCase();
  if (!text || text === "never" || text === "session") return undefined;
  const rel = text.match(/^(\d+)([smhd])$/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unit = rel[2];
    const ms = unit === "s" ? n * 1000 : unit === "m" ? n * 60_000 : unit === "h" ? n * 3_600_000 : n * 86_400_000;
    return Date.now() + ms;
  }
  const t = Date.parse(input);
  if (!Number.isNaN(t)) return t;
  return undefined;
}

function formatExpiry(expiresAt: number | undefined): string {
  if (!expiresAt) return "session";
  const diffMs = expiresAt - Date.now();
  if (diffMs < 0) return "expired";
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days >= 1) return `in ${days}d`;
  const hours = Math.floor(diffMs / (60 * 60 * 1000));
  if (hours >= 1) return `in ${hours}h`;
  const mins = Math.floor(diffMs / (60 * 1000));
  return `in ${mins}m`;
}
