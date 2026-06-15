// Sprint 10 Phase 10A.7 — Postman-style request editor with tab strip.
//
// Tabs: Params / Authorization / Headers / Body / Scripts / Settings / Cookies
// Scripts + Settings + Cookies are placeholders in 10A (defer Phase 11+).

import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, Copy, Save, Send, Square, Trash2 } from "lucide-react";

// Static import — CodeMirror's JSON editor used to be lazy with a
// Suspense fallback, but the dev-mode chunk granularity (30+ small
// modules under @codemirror/*) made the initial render visibly flash
// a plain <pre> before the editor swapped in, even with aggressive
// prefetching. Users flagged the flicker. The compile-time cost is
// acceptable because (a) REST is statically imported by App.tsx so
// users already pay for the REST module on every cold start, (b) the
// editor is shared with gRPC client + Docs KB so it's amortized, and
// (c) Vite's manualChunks already isolates CodeMirror into a single
// vendor-codemirror chunk that browsers cache aggressively.
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  REST_FOCUS_URL_EVENT,
  REST_SAVE_REQUEST_EVENT,
  REST_SEND_REQUEST_EVENT,
} from "@/lib/rest-events";
import { authToSecretRefs } from "./rest-keychain";
import { RestAuthorizationPanel } from "./RestAuthorizationPanel";
import { RestCookiesPanel } from "./RestCookiesPanel";
import { buildCurl } from "./rest-curl-builder";
import { applyCurlToRequest } from "./rest-curl-apply";
import { appendHistory } from "./rest-history";
import { parseJsonBody } from "@/lib/jsonpath-mini";
import { useAppStore } from "@/lib/store";
import type { RestResponseSlot } from "@/lib/store-types";
import { JsonEditor } from "@/components/ui/json-editor";
import type { RestMethod, RestRequestRecord, RestResponse } from "./rest-types";
import { writeClipboard } from "@/lib/clipboard";

const METHOD_OPTIONS: { value: RestMethod; label: string }[] = [
  { value: "GET", label: "GET" },
  { value: "POST", label: "POST" },
  { value: "PUT", label: "PUT" },
  { value: "PATCH", label: "PATCH" },
  { value: "DELETE", label: "DELETE" },
  { value: "HEAD", label: "HEAD" },
  { value: "OPTIONS", label: "OPTIONS" },
];

export interface RestRequestEditorProps {
  request: RestRequestRecord;
  onChange: (next: RestRequestRecord) => void;
}

// Postman-style tab layout (post-sections refactor per user direction).
// Tab strip selects which editor pane to show; only one is mounted at a
// time, matching Postman / Insomnia conventions and avoiding the visual
// noise of stacked-collapsible sections.
type RequestTab =
  | "params"
  | "auth"
  | "headers"
  | "body"
  | "cookies";

// Identity-stable fallback for new / freshly-mounted requests. Keeping
// it module-level (not recreated per render) lets the Zustand selector
// short-circuit when no slot exists yet — same identity = no re-render.
const DEFAULT_REST_SLOT: RestResponseSlot = {
  response: null,
  sendError: null,
  sending: false,
  sendVersion: 0,
  subTab: "body",
  showFullBody: false,
};

// Scripts + Settings tabs were Phase-11 placeholders; removed at user
// request ("这两个 tab 不需要") since neither has real functionality
// yet. If pre-request scripts / per-request settings land later, they
// re-enter here as new entries.
const REQUEST_TABS: { id: RequestTab; label: string }[] = [
  { id: "params", label: "Params" },
  { id: "auth", label: "Authorization" },
  { id: "headers", label: "Headers" },
  { id: "body", label: "Body" },
];

export function RestRequestEditor({ request, onChange }: RestRequestEditorProps) {
  const [activeTab, setActiveTab] = useState<RequestTab>("params");
  // Brief one-line banner after a successful curl paste-import so the
  // user sees that headers/body/auth were filled out invisibly. Cleared
  // by a timeout — no manual dismiss needed.
  const [curlPasteFlash, setCurlPasteFlash] = useState<string | null>(null);

  // Per-request response state lives in a session-only Zustand slice
  // (keyed by request.id). Lifting these out of local useState was the
  // fix for "switching modules wipes the REST response" — RestPage
  // unmounts on module switch, but the store survives. See store.ts
  // `restResponses` slice for the contract.
  const slot = useAppStore(
    (s): RestResponseSlot =>
      s.restResponses[request.id] ?? DEFAULT_REST_SLOT,
  );
  const { response, sendError, sending } = slot;

  // Brief flash so Cmd+S gives user-visible feedback — edits already auto-save
  // through onChange/upsertRequest, so the shortcut is essentially confirming
  // the persisted state.
  const [savedFlash, setSavedFlash] = useState(false);
  const [curlCopiedFlash, setCurlCopiedFlash] = useState(false);
  // Inline error when clipboard.writeText rejects (rare — webview permission
  // denied / no user gesture). Auto-clears after a couple seconds so it
  // doesn't squat in the header forever.
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);

  const patch = (p: Partial<RestRequestRecord>) => onChange({ ...request, ...p });

  // Refs over closures so the document-level event listeners always see the
  // latest request + sending state without re-binding on every keystroke.
  const requestRef = useRef(request);
  const sendingRef = useRef(sending);
  useEffect(() => {
    requestRef.current = request;
    sendingRef.current = sending;
  }, [request, sending]);

  const handleSend = async () => {
    const req = requestRef.current;
    if (sendingRef.current || !req.url.trim()) return;
    const rawUrl = req.url;
    const sanitizedUrl = rawUrl.trim().replace(/[?}\s]+$/g, "");
    // Bump the per-request send version BEFORE invoking. Cancel /
    // restart / module-switch-then-resend all bump the version too;
    // the result setter rejects any write whose captured version is
    // stale. Reading store directly (not via subscription) keeps the
    // promise chain unaffected by component unmount.
    const myVersion = useAppStore.getState().bumpRestSendVersion(req.id);
    useAppStore.getState().setRestResponseResult(req.id, myVersion, null, null);
    useAppStore.getState().setRestSending(req.id, true);
    let resp: RestResponse | null = null;
    let failure = false;
    try {
      // Auth materialization — req.auth lives outside req.headers (so it
      // can be promoted to the OS keychain via handle IDs), but Rust's
      // send loop only iterates req.headers / req.queryParams when
      // injecting secret_refs. Without this step, secret_refs would
      // resolve the right plaintext but find no header to attach it to,
      // and the outgoing request would lack the auth header entirely.
      // Symptom: 401 Unauthorized with the masked value showing
      // correctly in the editor.
      //
      // The placeholder value here is empty — Rust overrides it with
      // the resolved plaintext via the matching secret_ref path. The
      // materialized list is build-only; never written back into the
      // persisted record.
      const sendHeaders: typeof req.headers = [...req.headers];
      const sendQuery: typeof req.queryParams = [...req.queryParams];
      const auth = req.auth;
      if (auth) {
        if (auth.kind === "bearer" && auth.tokenHandleId) {
          sendHeaders.push({ key: "Authorization", value: "", enabled: true });
        } else if (auth.kind === "basic" && auth.passwordHandleId) {
          sendHeaders.push({ key: "Authorization", value: "", enabled: true });
        } else if (
          auth.kind === "api-key" &&
          auth.valueHandleId &&
          auth.name.trim()
        ) {
          const row = { key: auth.name.trim(), value: "", enabled: true };
          if (auth.in === "query") sendQuery.push(row);
          else sendHeaders.push(row);
        }
      }
      resp = await invoke<RestResponse>("rest_send_request", {
        payload: {
          req: {
            method: req.method,
            url: sanitizedUrl,
            headers: sendHeaders,
            queryParams: sendQuery,
            body: req.body,
            timeoutMs: req.timeoutMs,
            followRedirects: req.followRedirects,
          },
          // Auth credentials live in the OS keychain — the FE only holds
          // their handles. Rust resolves + injects at the path notation
          // ("headers.Authorization" / "query.<name>") immediately before
          // the HTTP call so plaintext never traverses IPC. (DEC #195)
          secretRefs: authToSecretRefs(req.auth),
          // Collection scope so Rust auto-persists Set-Cookie headers to
          // the right cookie bucket (Phase 10D — DEC #189 per-collection).
          collectionId: req.collectionId,
        },
      });
      // Store setter is version-guarded — stale results from a
      // canceled / superseded send don't overwrite the current slot.
      useAppStore.getState().setRestResponseResult(req.id, myVersion, resp, null);
    } catch (error) {
      failure = true;
      useAppStore.getState().setRestResponseResult(
        req.id,
        myVersion,
        null,
        error instanceof Error ? error.message : JSON.stringify(error),
      );
    } finally {
      // Append history only if THIS send is still the current one
      // (avoid polluting history with canceled sends that finish late).
      const currentVersion = useAppStore.getState().restResponses[req.id]?.sendVersion ?? 0;
      if (currentVersion === myVersion) {
        // Persist URL sanitization back to the stored request — deferred
        // here so the parent re-render can't race the response setters.
        if (sanitizedUrl !== rawUrl) {
          onChange({ ...req, url: sanitizedUrl });
        }
        appendHistory({
          status: failure ? 0 : resp?.status ?? 0,
          elapsedMs: resp?.elapsedMs ?? 0,
          bodyBytes: resp?.bodyBytes ?? 0,
          requestName: req.name,
          collectionId: req.collectionId,
          snapshot: {
            method: req.method,
            url: req.url,
            headers: req.headers,
            queryParams: req.queryParams,
            body: req.body,
            auth: req.auth,
            followRedirects: req.followRedirects,
            timeoutMs: req.timeoutMs,
          },
        });
      }
    }
  };

  const handleCancel = () => {
    // Bump the version so any in-flight invoke result is ignored when
    // it eventually resolves; flip sending false immediately for UI.
    useAppStore.getState().bumpRestSendVersion(request.id);
    useAppStore.getState().setRestSending(request.id, false);
  };

  const handleCopyCurl = async () => {
    setClipboardError(null);
    try {
      await writeClipboard(await buildCurl(requestRef.current));
      // Only flash on success — silent-success was the pre-fix bug.
      setCurlCopiedFlash(true);
      window.setTimeout(() => setCurlCopiedFlash(false), 1200);
    } catch (e) {
      setClipboardError(
        `Clipboard write failed${e instanceof Error ? `: ${e.message}` : ""}`,
      );
      window.setTimeout(() => setClipboardError(null), 3500);
    }
  };

  // Bind once — Cmd+Enter / Cmd+S / Cmd+L from the global App.tsx dispatcher
  // arrive here as REST_* events.
  useEffect(() => {
    const onSend = () => {
      void handleSend();
    };
    const onSave = () => {
      // Edits auto-save via onChange → upsertRequest. Just acknowledge.
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1200);
    };
    const onFocusUrl = () => {
      const el = urlInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    };
    // Escape aborts an in-flight request (matches gRPC client's Esc-to-cancel).
    // Capture-phase + stopPropagation so RestPage's outer Esc (which closes
    // the whole REST module) only fires when nothing's mid-send.
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && sendingRef.current) {
        e.stopPropagation();
        handleCancel();
      }
    };
    document.addEventListener(REST_SEND_REQUEST_EVENT, onSend);
    document.addEventListener(REST_SAVE_REQUEST_EVENT, onSave);
    document.addEventListener(REST_FOCUS_URL_EVENT, onFocusUrl);
    document.addEventListener("keydown", onEscape, true);
    return () => {
      document.removeEventListener(REST_SEND_REQUEST_EVENT, onSend);
      document.removeEventListener(REST_SAVE_REQUEST_EVENT, onSave);
      document.removeEventListener(REST_FOCUS_URL_EVENT, onFocusUrl);
      document.removeEventListener("keydown", onEscape, true);
    };
  }, []);

  const enabledHeaders = request.headers.filter((h) => h.enabled && h.key.trim()).length;
  const enabledQuery = request.queryParams.filter((q) => q.enabled && q.key.trim()).length;

  return (
    <div className="flex flex-1 min-h-0 min-w-0 flex-col">
      {/* Request name + Save / Copy actions (right-aligned via ml-auto) */}
      {/* Request name + Save / Copy curl row — h-9 to match the
          sidebar's search bar so the first horizontal divider on
          left and right line up. Compact rhythm follows the user's
          direction: keep the left sidebar dense, align the right
          side down to it (not the other way around). */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
        <Input
          value={request.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Request name"
          className="h-7 max-w-md flex-1 border-transparent bg-transparent text-sm shadow-none hover:border-border focus:border-primary"
        />
        {/* Save with Postman-style ▾ chevron — split-button placeholder for
            future "Save As" / "Save and create new" actions.
            ml-auto on the first action button pushes the whole action
            cluster (Save / Copy curl) to the far
            right of the header row, away from the request-name Input
            on the left. Without it the buttons cluster awkwardly in
            the middle of the row. */}
        <Button
          size="sm"
          variant="ghost"
          className={cn("ml-auto h-7 text-xs", savedFlash && "text-emerald-500")}
          onClick={() => {
            setSavedFlash(true);
            window.setTimeout(() => setSavedFlash(false), 1200);
          }}
          title="Save (⌘S)"
        >
          <Save className="mr-1 h-3 w-3" />
          {savedFlash ? "Saved" : "Save"}
          <ChevronDown className="ml-1 h-3 w-3 opacity-60" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={cn("h-7 text-xs", curlCopiedFlash && "text-emerald-500")}
          onClick={() => {
            void handleCopyCurl();
          }}
          title="Copy as curl command"
        >
          <Copy className="mr-1 h-3 w-3" />
          {curlCopiedFlash ? "Copied" : "Copy curl"}
        </Button>
        {clipboardError && (
          <span className="text-[10px] text-red-500" title={clipboardError}>
            ⚠ {clipboardError}
          </span>
        )}
      </div>

      {/* URL bar — gap-2 + min-w-0 on the Input. Without min-w-0 a long URL
          balloons the Input past its flex share and shoves the Send button
          off the right edge of the viewport (user observed this with the
          GitHub octocat URL — Send vanished). */}
      {/* URL bar — h-10 row, just tall enough for the h-8 method +
          URL Input + h-8 Send button. Compact rhythm matching the
          sidebar. */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
        <Select
          value={request.method}
          onChange={(e) => patch({ method: e.target.value as RestMethod })}
          options={METHOD_OPTIONS}
          className="h-8 w-24 shrink-0 font-mono text-xs font-semibold"
        />
        <Input
          ref={urlInputRef}
          value={request.url}
          onChange={(e) => patch({ url: e.target.value })}
          onBlur={() => {
            // Auto-extract query string from URL into the Query Params
            // table when the user finishes editing. Postman-style: URL
            // can be pasted as-is with `?key=val&...` and the params
            // land in the structured table — without disrupting
            // mid-typing (we only fire on blur, not per-keystroke).
            //
            // After extraction the URL is rewritten WITHOUT its query
            // string so the backend's send-time appender doesn't
            // double-emit (it iterates req.queryParams and appends
            // them to req.url via url.query_pairs_mut()).
            //
            // Skip when the URL has no `?` or no extractable pairs —
            // the user might just be typing a plain endpoint.
            const url = request.url;
            const qIndex = url.indexOf("?");
            if (qIndex < 0) return;
            const queryString = url.slice(qIndex + 1);
            if (!queryString.trim()) return;
            const extracted = queryString
              .split("&")
              .filter(Boolean)
              .map((part) => {
                const eq = part.indexOf("=");
                const rawK = eq < 0 ? part : part.slice(0, eq);
                const rawV = eq < 0 ? "" : part.slice(eq + 1);
                // Best-effort decode; malformed %xx falls back to raw.
                let key = rawK;
                let value = rawV;
                try {
                  key = decodeURIComponent(rawK);
                } catch {
                  /* keep rawK */
                }
                try {
                  value = decodeURIComponent(rawV);
                } catch {
                  /* keep rawV */
                }
                return { key, value, enabled: true };
              })
              .filter((row) => row.key);
            if (extracted.length === 0) return;
            // Drop empty existing rows before merging — otherwise the
            // user sees the extracted pairs appear BELOW the blank row
            // they (or a phantom-promote click) already left at the
            // top.
            const nonEmpty = request.queryParams.filter(
              (q) => q.key.trim() || q.value.trim(),
            );
            // Dedupe by key: if the URL re-introduces a key that
            // already exists in the table, UPDATE its value instead of
            // appending a duplicate row (URL is canonical). Map keeps
            // insertion order, so existing rows stay in place and
            // genuinely-new keys get appended at the end.
            const byKey = new Map<string, (typeof nonEmpty)[number]>();
            for (const row of nonEmpty) byKey.set(row.key, row);
            for (const row of extracted) byKey.set(row.key, row);
            patch({
              url: url.slice(0, qIndex),
              queryParams: Array.from(byKey.values()),
            });
          }}
          onKeyDown={(e) => {
            // Enter inside the URL bar = Send, matches Postman.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          onPaste={(e) => {
            // Auto-detect pasted curl command — if the clipboard text
            // starts with "curl ", parse it and populate method /
            // headers / body / auth into the request instead of
            // pasting the raw text into the URL field. Saves the user
            // from opening the Import dialog for the common case.
            //
            // Secret headers (Authorization, X-Api-Key, etc.) are
            // promoted to the OS keychain via saveSecret() — plaintext
            // NEVER lands in app_kv / IPC / history (DEC #195).
            //
            // If the pasted text isn't a curl, we fall through to the
            // normal Input paste behavior (no preventDefault).
            const text = e.clipboardData.getData("text") ?? "";
            if (!text.trim().toLowerCase().startsWith("curl")) return;
            e.preventDefault();
            void (async () => {
              const result = await applyCurlToRequest(text, request.collectionId);
              if (!result) {
                setCurlPasteFlash("Couldn't parse curl — pasted as URL.");
                window.setTimeout(() => setCurlPasteFlash(null), 2500);
                // Fall back: paste raw text into URL field so user
                // doesn't lose what they pasted.
                patch({ url: text });
                return;
              }
              onChange({ ...request, ...result.patch });
              const parts: string[] = ["Imported curl"];
              if (result.parsedHeaderCount > 0) {
                parts.push(`${result.parsedHeaderCount} header${result.parsedHeaderCount === 1 ? "" : "s"}`);
              }
              if (result.hasBody) parts.push("body");
              if (result.promotedAuth) parts.push("auth (saved to keychain)");
              setCurlPasteFlash(parts.join(" · "));
              window.setTimeout(() => setCurlPasteFlash(null), 2500);
            })();
          }}
          placeholder="Enter URL or paste curl"
          className="h-8 min-w-0 flex-1 font-mono text-sm"
        />
        {sending ? (
          <Button
            size="sm"
            variant="destructive"
            className="h-8 shrink-0 px-5 text-xs"
            onClick={handleCancel}
            title="Cancel request (Esc)"
          >
            <Square className="mr-1 h-3 w-3" />
            Cancel
          </Button>
        ) : (
          <Button
            size="sm"
            className="h-8 shrink-0 px-5 text-xs"
            onClick={handleSend}
            disabled={!request.url.trim()}
            title="Send (⌘↩)"
          >
            <Send className="mr-1 h-3 w-3" />
            Send
            <ChevronDown className="ml-1 h-3 w-3 opacity-70" />
          </Button>
        )}
      </div>

      {/* Flash banner — confirms a successful curl paste-import (or its
          failure). Auto-clears after 2.5s; no manual dismiss. Sits
          between URL bar and the sections so it's noticed without
          taking permanent vertical space. */}
      {curlPasteFlash && (
        <div className="shrink-0 border-b border-border bg-emerald-500/10 px-3 py-1 text-[11px] text-emerald-700 dark:text-emerald-300">
          {curlPasteFlash}
        </div>
      )}

      {/* Postman-style two-pane split — request (with tab strip) on the
          left, response on the right. Hardcoded 50/50, NOT user-
          resizable per explicit user direction: the request/response
          sizes don't change. min-w-0 on both panes keeps inner content
          from inflating the row. */}
      <div className="flex flex-1 min-h-0 min-w-0">
        <div className="flex w-1/2 min-h-0 min-w-0 flex-col overflow-hidden border-r border-border">
          {/* Tab strip — Postman style: tabs on the left, Cookies link
              pinned to the right via ml-auto. Count badges show on
              tabs with content (Params/Headers). Slightly more padding
              + medium weight on active makes the active state legible
              against the dark background without shouting. */}
          <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-background px-3">
            {REQUEST_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const count =
                tab.id === "params"
                  ? enabledQuery
                  : tab.id === "headers"
                    ? enabledHeaders
                    : tab.id === "auth"
                      ? (request.auth && request.auth.kind !== "none" ? 1 : 0)
                      : undefined;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "relative flex items-center gap-1.5 -mb-px border-b-2 px-3 py-1.5 text-[11px] transition-colors",
                    isActive
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                  {count !== undefined && count > 0 && (
                    <span
                      className={cn(
                        "rounded px-1 py-0.5 text-[9px] font-medium tabular-nums",
                        isActive
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setActiveTab("cookies")}
              className={cn(
                "ml-auto px-3 py-1.5 text-[11px] transition-colors",
                activeTab === "cookies"
                  ? "font-medium text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Cookies
            </button>
          </div>

          {/* Active tab content — only one tab is mounted at a time.
              min-h-0 + min-w-0 keep the content from inflating the
              column. overflow-hidden lets each tab decide its own
              scroll strategy (KV tables overflow-y in the rows; Body
              editor has its own internal scroll). */}
          <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden">
            {activeTab === "params" && (
              <ParamsTab
                rows={request.queryParams}
                onChange={(rows) => patch({ queryParams: rows })}
              />
            )}
            {activeTab === "auth" && (
              <RestAuthorizationPanel request={request} onChange={onChange} />
            )}
            {activeTab === "headers" && (
              <ParamsTab
                rows={request.headers}
                onChange={(rows) => patch({ headers: rows })}
                keyPlaceholder="Header"
              />
            )}
            {activeTab === "body" && (
              <BodyPanel
                body={request.body}
                onChange={(body) => patch({ body })}
              />
            )}
            {activeTab === "cookies" && (
              <RestCookiesPanel request={request} />
            )}
          </div>
        </div>

        {/* Response pane — fixed 50% width (not draggable). */}
        <div className="flex w-1/2 min-h-0 min-w-0 flex-col overflow-hidden bg-card/10">
          {response ? (
            <ResponsePanel response={response} requestId={request.id} />
          ) : sendError ? (
            <ErrorResponsePanel error={sendError} url={request.url} />
          ) : (
            <ResponseEmptyState sending={sending} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Params / Headers tab wrapper — key/value table + Add row button ----
// Replaces the old collapsible section-header layout with a flat tab
// content area. The + Add button lives at the top-right of the tab
// content (matches Postman's "Bulk Edit" position).
function ParamsTab<T extends { key: string; value: string; enabled: boolean }>({
  rows,
  onChange,
  keyPlaceholder = "Key",
}: {
  rows: T[];
  onChange: (next: T[]) => void;
  keyPlaceholder?: string;
}) {
  const addRow = () => {
    onChange([...rows, { key: "", value: "", enabled: true } as T]);
  };
  const noun = keyPlaceholder === "Header" ? "header" : "query param";
  const label = keyPlaceholder === "Header" ? "Headers" : "Query Params";
  return (
    <div className="flex flex-1 min-h-0 min-w-0 flex-col">
      {/* Top toolbar — title-case section name on the left (mirrors the
          reference Postman layout user requested), + Add action on the
          right. No heavy uppercase / tracking-wider — the tab strip
          already conveys the section name; this is just an inline
          reaffirmation paired with the + Add affordance. */}
      <div className="flex shrink-0 items-center justify-between px-3 pt-2 pb-1">
        <span className="text-[12px] font-medium text-foreground">{label}</span>
        <button
          type="button"
          onClick={addRow}
          className="rounded px-2 py-0.5 text-[11px] text-primary transition-colors hover:bg-accent"
        >
          + Add {noun}
        </button>
      </div>
      <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-auto px-3 pb-3">
        {/* px-3 pb-3 → keep the table off the panel edges so it
            doesn't feel like it's overflowing the column. min-rows=1
            shows a single phantom row when the list is empty so the
            user sees structure; once they type, the phantom is
            promoted into the real array and no extra phantom is
            appended (matches "最少一个" — user direction). */}
        <InlineKvRows
          rows={rows}
          onChange={onChange}
          keyPlaceholder={keyPlaceholder}
          valuePlaceholder="Value"
          minRows={1}
        />
      </div>
    </div>
  );
}

// ---- Inline key/value row editor — Postman-style 3-column table ----
// Layout: [checkbox] [Key] [Value] [Description] [delete]
//
// Renders real rows from `rows` + optional "phantom" rows that fill
// the table when the list is short. Typing into a phantom promotes
// it to a real row via onChange — keeps the persisted record clean
// while giving the table visible structure even when empty.
function InlineKvRows<
  T extends {
    key: string;
    value: string;
    enabled: boolean;
  },
>({
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  minRows = 0,
}: {
  rows: T[];
  onChange: (next: T[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  // When rows.length < minRows, render extra phantom input rows below
  // the real ones so the table has visible structure. Each phantom
  // upgrades to a real row on first keystroke.
  minRows?: number;
}) {
  const update = (i: number, patchRow: Partial<T>) =>
    onChange(rows.map((r, j) => (j === i ? ({ ...r, ...patchRow } as T) : r)));
  const promotePhantom = (field: "key" | "value", value: string) => {
    onChange([
      ...rows,
      { key: "", value: "", enabled: true, [field]: value } as T,
    ]);
  };
  const phantomCount = Math.max(0, minRows - rows.length);

  // Shared grid template — same column widths across header + every
  // row so columns align. Outer rounded border + inner divide-* gives
  // the table its visible cell-line structure (matches Postman).
  // Softer border tone (border/40) so the grid reads as structure,
  // not a cage — keeps the table quiet on the dark background.
  // 4 columns: checkbox | Key (4fr) | Value (6fr) | delete. Per user
  // direction: values are typically longer than keys (tokens, URLs,
  // long header values), so 40/60 split feels balanced. Description
  // column was tried and removed earlier ("把 description 拿掉，没用").
  const gridClass = "grid grid-cols-[32px_4fr_6fr_32px] items-stretch";
  const cellClass = "flex items-center border-r border-border/40 last:border-r-0 px-2";
  // Input styling shared by all data cells (key/value/description).
  // No own border — the cell borders draw the grid; just a focus ring.
  const cellInputClass =
    "h-7 w-full min-w-0 bg-transparent text-xs focus:outline-none focus:ring-1 focus:ring-primary/40 focus:ring-inset rounded-sm px-1";

  return (
    <div className="overflow-hidden rounded-md border border-border/40">
      {/* Column header row — Postman reference matches: muted bg,
          subtle uppercase labels, separator below. */}
      <div
        className={cn(
          gridClass,
          "border-b border-border/40 bg-muted/20 text-[10px] font-medium uppercase tracking-wide text-muted-foreground",
        )}
      >
        <span className={cn(cellClass, "py-1.5")} aria-hidden="true" />
        <span className={cn(cellClass, "py-1.5")}>Key</span>
        <span className={cn(cellClass, "py-1.5")}>Value</span>
        <span className={cn(cellClass, "py-1.5")} aria-hidden="true" />
      </div>

      {/* Body — rows with their own bottom border, except the last.
          Same softer divider tone as the cell borders. */}
      <div className="divide-y divide-border/40">
        {rows.map((r, i) => (
          <div key={i} className={cn(gridClass, "group bg-background")}>
            <div className={cellClass}>
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={(e) =>
                  update(i, { enabled: e.target.checked } as Partial<T>)
                }
                className="mx-auto h-3.5 w-3.5 rounded border-border accent-primary"
                aria-label={`Toggle row ${i + 1}`}
              />
            </div>
            <div className={cellClass}>
              <input
                value={r.key}
                onChange={(e) =>
                  update(i, { key: e.target.value } as Partial<T>)
                }
                placeholder={keyPlaceholder}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className={cn(cellInputClass, "font-mono")}
              />
            </div>
            <div className={cellClass}>
              <input
                value={r.value}
                onChange={(e) =>
                  update(i, { value: e.target.value } as Partial<T>)
                }
                placeholder={valuePlaceholder}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className={cn(cellInputClass, "font-mono")}
              />
            </div>
            <div className={cellClass}>
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                aria-label={`Remove row ${i + 1}`}
                title="Remove row"
                className="mx-auto flex h-6 w-6 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}

        {Array.from({ length: phantomCount }).map((_, i) => (
          <div
            key={`phantom-${i}`}
            className={cn(gridClass, "bg-background opacity-60 focus-within:opacity-100")}
          >
            <div className={cellClass}>
              <input
                type="checkbox"
                checked
                readOnly
                className="mx-auto h-3.5 w-3.5 rounded border-border accent-primary"
                aria-hidden="true"
              />
            </div>
            <div className={cellClass}>
              <input
                value=""
                onChange={(e) => promotePhantom("key", e.target.value)}
                placeholder={keyPlaceholder}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className={cn(cellInputClass, "font-mono")}
              />
            </div>
            <div className={cellClass}>
              <input
                value=""
                onChange={(e) => promotePhantom("value", e.target.value)}
                placeholder={valuePlaceholder}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className={cn(cellInputClass, "font-mono")}
              />
            </div>
            <div className={cellClass} aria-hidden="true" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- Empty-state for the response pane (always visible right side) ----
function ResponseEmptyState({ sending }: { sending: boolean }) {
  if (sending) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
        <p className="text-xs">Sending request…</p>
        <p className="text-[10px]">Press Esc to cancel</p>
      </div>
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-border">
        <Copy className="h-5 w-5 opacity-40" />
      </div>
      <p className="text-sm text-foreground/80">Response will appear here</p>
      <p className="text-[10px]">响应将显示在此处</p>
      <p className="text-[10px]">Fill in the URL and click Send.</p>
    </div>
  );
}

// ---- Panels ----
//
// ParamsPanel + HeadersPanel removed in the section refactor — Query Params
// and Headers are now rendered inline via InlineKvRows in the main editor
// JSX. BodyPanel + KvTable still used for form-urlencoded fields below.

function BodyPanel({
  body,
  onChange,
}: {
  body: RestRequestRecord["body"];
  onChange: (body: RestRequestRecord["body"]) => void;
}) {
  const mode = body?.mode ?? "none";
  return (
    // min-w-0 + min-h-0 are required because CodeMirror's editor div
    // (h-full w-full inside JsonEditor) would otherwise propagate its
    // intrinsic min-content up the flex chain into the split-pane row,
    // re-triggering the content-driven width-drift bug class. min-h-0
    // lets the editor shrink to the parent's height instead of forcing
    // the column open.
    <div className="flex flex-1 min-h-0 min-w-0 flex-col gap-2 p-3">
      {/* Postman-style radio button row for body mode */}
      <div className="flex shrink-0 flex-wrap items-center gap-4 text-[11px]">
        {(
          [
            { value: "none", label: "none" },
            { value: "json", label: "json" },
            { value: "raw", label: "raw" },
            { value: "form-urlencoded", label: "x-www-form-urlencoded" },
            { value: "binary", label: "binary" },
          ] as const
        ).map((m) => {
          const isActive = mode === m.value;
          return (
            <label
              key={m.value}
              className="flex cursor-pointer items-center gap-1.5 select-none"
            >
              <input
                type="radio"
                name="body-mode"
                checked={isActive}
                onChange={() => {
                  if (m.value === "none") onChange({ mode: "none" });
                  else if (m.value === "json")
                    onChange({ mode: "json", content: body?.mode === "json" ? body.content : "{}" });
                  else if (m.value === "raw")
                    onChange({ mode: "raw", content: body?.mode === "raw" ? body.content : "" });
                  else if (m.value === "form-urlencoded")
                    onChange({ mode: "form-urlencoded", fields: body?.mode === "form-urlencoded" ? body.fields : [] });
                  else if (m.value === "binary")
                    onChange({ mode: "binary", content: body?.mode === "binary" ? body.content : "" });
                }}
                className="h-3 w-3 cursor-pointer accent-primary"
              />
              <span className={cn(isActive ? "text-foreground" : "text-muted-foreground")}>
                {m.label}
              </span>
            </label>
          );
        })}
      </div>
      {mode === "none" && (
        <div className="flex flex-1 items-center justify-center text-[11px] text-muted-foreground">
          No body
        </div>
      )}
      {mode === "json" && (
        // CodeMirror JSON editor (syntax highlight + auto-indent +
        // bracket matching + linter + Cmd-Shift-F format). Same widget
        // used in gRPC client + Docs KB for consistency.
        //
        // min-h-[20rem] is load-bearing: BodyPanel sits inside the
        // sections column which is overflow-auto (unbounded height),
        // so flex-1 has no remaining space to claim and the editor
        // would collapse to its content's natural height — for a
        // fresh `{}` body that's a single line, which looks broken.
        // 20rem ≈ 16 lines is a comfortable default editing area.
        // flex-1 still works if a future layout gives this column a
        // bounded height — the editor will then grow past 20rem.
        <div className="flex flex-1 min-h-[20rem] min-w-0 w-full overflow-hidden rounded border border-border bg-background">
          <JsonEditor
            value={body && body.mode === "json" ? body.content : "{}"}
            onChange={(content) => onChange({ mode: "json", content })}
            placeholder='{"key": "value"}'
          />
        </div>
      )}
      {mode === "raw" && (
        // raw mode also uses the CodeMirror editor — same line numbers
        // + highlighting + bracket matching as json mode (per user
        // request: "this part 的 json editor 不见了"). The JSON linter
        // will flag non-JSON content with red squiggles; that's
        // expected behavior — users in raw mode know what they're
        // pasting and the visual editing affordances (line numbers,
        // selection, fold, search) are worth more than a clean lint.
        <div className="flex flex-1 min-h-[20rem] min-w-0 w-full overflow-hidden rounded border border-border bg-background">
          <JsonEditor
            value={body && body.mode === "raw" ? body.content : ""}
            onChange={(content) => onChange({ mode: "raw", content })}
            placeholder=""
          />
        </div>
      )}
      {mode === "form-urlencoded" && body?.mode === "form-urlencoded" && (
        <KvTable
          rows={body.fields}
          onChange={(fields) => onChange({ mode: "form-urlencoded", fields })}
          keyPlaceholder="Field"
          valuePlaceholder="Value"
          label="Form fields"
        />
      )}
      {mode === "binary" && body?.mode === "binary" && (
        <BinaryBodyPicker
          content={body.content}
          onChange={(content) => onChange({ mode: "binary", content })}
        />
      )}
    </div>
  );
}

// 50 MB cap — REST module's response cap is 100 MB, request cap is half that
// because base64 encoding inflates payload size on the wire.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

function BinaryBodyPicker({
  content,
  onChange,
}: {
  content: string;
  onChange: (content: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [fileMeta, setFileMeta] = useState<{ name: string; size: number } | null>(null);
  // Encoding progress 0..100; null when idle. 50MB synchronous base64 used
  // to freeze the main thread 1-3s; chunked async yields after each ~512KB
  // window so the UI stays interactive + shows progress.
  const [progress, setProgress] = useState<number | null>(null);
  // Sequence guard — concurrent file picks (user clicks again mid-encode)
  // ignore the older encode's result so fileMeta + onChange always reflect
  // the latest file.
  const pickVersionRef = useRef(0);

  const handlePick = async (file: File) => {
    setError(null);
    const myVersion = ++pickVersionRef.current;
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB) — max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);
      return;
    }
    setProgress(0);
    setFileMeta({ name: file.name, size: file.size });
    let buf: ArrayBuffer;
    try {
      buf = await file.arrayBuffer();
    } catch (e) {
      if (pickVersionRef.current === myVersion) {
        setError(e instanceof Error ? `Read failed: ${e.message}` : "Read failed");
        setProgress(null);
      }
      return;
    }
    const bytes = new Uint8Array(buf);
    // Chunked base64 with yields between chunks. CHUNK_BYTES picked so each
    // tick stays well under 16ms even on slower CPUs — 64KB → ~8ms typical.
    const CHUNK_BYTES = 0x10000; // 64 KB
    let bin = "";
    for (let i = 0; i < bytes.length; i += CHUNK_BYTES) {
      // Bail out if a newer pick has overtaken — discard stale work.
      if (pickVersionRef.current !== myVersion) return;
      const slice = bytes.subarray(i, Math.min(i + CHUNK_BYTES, bytes.length));
      bin += String.fromCharCode.apply(null, Array.from(slice) as unknown as number[]);
      // Update progress + yield control back to the browser so paint + input
      // events can run. Promise+setTimeout(0) is the most-compatible yield.
      const pct = Math.round((i + slice.length) / bytes.length * 100);
      setProgress(pct);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
    if (pickVersionRef.current !== myVersion) return;
    onChange(btoa(bin));
    setProgress(null);
  };

  return (
    <div className="flex flex-1 flex-col items-start gap-2">
      <label className="flex h-8 cursor-pointer items-center gap-2 rounded border border-input bg-background px-3 text-xs hover:bg-accent">
        <input
          type="file"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handlePick(file);
          }}
        />
        Choose file… <span className="text-[10px] text-muted-foreground">(max {MAX_UPLOAD_BYTES / 1024 / 1024} MB)</span>
      </label>
      {progress !== null && (
        <div className="w-full max-w-xs space-y-1">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Encoding…</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
      {fileMeta && progress === null && (
        <p className="text-[11px] text-muted-foreground">
          {fileMeta.name} · {formatBytes(fileMeta.size)} (base64-encoded for transport)
        </p>
      )}
      {!fileMeta && content && (
        <p className="text-[11px] text-muted-foreground">
          {content.length} chars of base64 loaded
        </p>
      )}
      {error && (
        <p className="text-[11px] text-red-500">{error}</p>
      )}
    </div>
  );
}

function KvTable<T extends { key: string; value: string; enabled: boolean }>({
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  label,
}: {
  rows: T[];
  onChange: (next: T[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  label: string;
}) {
  const update = (i: number, patch: Partial<T>) =>
    onChange(rows.map((r, j) => (j === i ? ({ ...r, ...patch } as T) : r)));
  return (
    <div className="flex w-full flex-col p-3">
      <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="rounded border border-border/60">
        <div className="grid grid-cols-[36px_1fr_1fr_1fr_36px] gap-2 border-b border-border/60 bg-muted/30 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <span />
          <span>Key</span>
          <span>Value</span>
          <span>Description</span>
          <span />
        </div>
        {rows.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">No rows — click Add below.</p>
        ) : (
          rows.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-[36px_1fr_1fr_1fr_36px] items-center gap-2 border-b border-border/40 px-2 py-1 last:border-b-0"
            >
              <input
                type="checkbox"
                className="ml-2"
                checked={r.enabled}
                onChange={(e) => update(i, { enabled: e.target.checked } as Partial<T>)}
              />
              <Input
                value={r.key}
                onChange={(e) => update(i, { key: e.target.value } as Partial<T>)}
                placeholder={keyPlaceholder}
                className="h-7 text-xs"
              />
              <Input
                value={r.value}
                onChange={(e) => update(i, { value: e.target.value } as Partial<T>)}
                placeholder={valuePlaceholder}
                className="h-7 text-xs"
              />
              <Input
                value={(r as unknown as { description?: string }).description ?? ""}
                onChange={(e) =>
                  update(i, { description: e.target.value } as unknown as Partial<T>)
                }
                placeholder="Description"
                className="h-7 text-xs"
              />
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                aria-label={`Delete row ${i + 1}`}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="mt-1.5 h-7 self-start text-xs"
        onClick={() => onChange([...rows, { key: "", value: "", enabled: true } as T])}
      >
        + Add row
      </Button>
    </div>
  );
}

// Display cap — bodies > this are truncated in the <pre> with a Show more
// affordance. Browsers render a single multi-MB text node very slowly (50MB
// = ~300ms layout/paint); chunking via "show first 1MB, expand on demand"
// keeps initial paint at <10ms. JSONPath still queries the full body.
const RESPONSE_DISPLAY_CAP = 1_000_000;
type ResponseSubTab = "body" | "headers" | "cookies" | "tests";

// Postman-style status pill — green for 2xx, amber for 3xx, red for 4xx/5xx.
function statusPillColor(status: number): string {
  if (status === 0) return "bg-muted text-muted-foreground";
  if (status >= 200 && status < 300) return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400";
  if (status >= 300 && status < 400) return "bg-amber-500/15 text-amber-600 dark:text-amber-400";
  return "bg-red-500/15 text-red-600 dark:text-red-400";
}

// Approximate HTTP status text. Saves shipping a full status-code table —
// most users recognize the common ones at a glance.
function statusText(status: number): string {
  if (status === 200) return "OK";
  if (status === 201) return "Created";
  if (status === 204) return "No Content";
  if (status === 301) return "Moved Permanently";
  if (status === 302) return "Found";
  if (status === 304) return "Not Modified";
  if (status === 400) return "Bad Request";
  if (status === 401) return "Unauthorized";
  if (status === 403) return "Forbidden";
  if (status === 404) return "Not Found";
  if (status === 409) return "Conflict";
  if (status === 422) return "Unprocessable";
  if (status === 429) return "Too Many Requests";
  if (status === 500) return "Server Error";
  if (status === 502) return "Bad Gateway";
  if (status === 503) return "Service Unavailable";
  if (status === 504) return "Gateway Timeout";
  return "";
}

// Wrapper class added to every column container inside the split row so
// flex items honor their explicit width and don't burst past the divider.
const PANEL_FLEX_COLUMN = "flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden";

function ResponsePanel({ response, requestId }: { response: RestResponse; requestId: string }) {
  // subTab + showFullBody live on the same per-request Zustand slot
  // as the response itself — that way switching modules and coming
  // back preserves the sub-tab the user was looking at AND whether
  // they had clicked "Show full" past the 1MB cap.
  const subTab = useAppStore(
    (s) => s.restResponses[requestId]?.subTab ?? "body",
  );
  const showFullBody = useAppStore(
    (s) => s.restResponses[requestId]?.showFullBody ?? false,
  );
  const setSubTab = (next: ResponseSubTab) =>
    useAppStore.getState().setRestResponseSubTab(requestId, next);
  const setShowFullBody = (next: boolean) =>
    useAppStore.getState().setRestResponseShowFullBody(requestId, next);

  // Reset sub-tab + show-full on new response — matches Postman default
  // and avoids stale "Show full" from a previous (smaller) response.
  useEffect(() => {
    setSubTab("body");
    setShowFullBody(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response.body, requestId]);

  // PARSE-ONCE cache: 10-50 MB JSON.parse is the expensive step (~30-180ms).
  // Memo by body so re-renders for other reasons reuse the parsed tree.
  const parsedBody = useMemo(() => parseJsonBody(response.body), [response.body]);
  const prettyDisplay = useMemo(() => {
    if (!parsedBody.ok || parsedBody.parsed === undefined) return response.body;
    try {
      return JSON.stringify(parsedBody.parsed, null, 2);
    } catch {
      return response.body;
    }
  }, [parsedBody, response.body]);

  // Display truncation cap honors the pretty-printed length.
  const rawDisplay = prettyDisplay;
  const display = !showFullBody && rawDisplay.length > RESPONSE_DISPLAY_CAP
    ? rawDisplay.slice(0, RESPONSE_DISPLAY_CAP)
    : rawDisplay;
  const isDisplayTruncated = !showFullBody && rawDisplay.length > RESPONSE_DISPLAY_CAP;

  // Copy response body to clipboard — matches Postman's per-response copy.
  const [bodyCopied, setBodyCopied] = useState(false);
  const handleCopyBody = async () => {
    try {
      await writeClipboard(response.body);
      setBodyCopied(true);
      window.setTimeout(() => setBodyCopied(false), 1200);
    } catch {
      // Silent fail — clipboard error surface is in the editor header.
    }
  };
  // Warn at 1 MiB — past this the editor's <pre> path starts feeling
  // sluggish on weaker laptops. The truncation cap (100 MB) is the hard
  // limit; this is just a soft heads-up.
  const isLargeResponse = response.bodyBytes > 1024 * 1024;
  const headerCount = response.headers.length;
  const statusLabel = statusText(response.status);

  return (
    <div className={cn(PANEL_FLEX_COLUMN, "border-t border-border bg-background")}>
      {/* Postman-style status row: green/red pill + ms + bytes + copy icon */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/60 px-3 py-1.5 text-[11px]">
        <span
          className={cn(
            "rounded px-2 py-0.5 font-mono text-[11px] font-semibold",
            statusPillColor(response.status),
          )}
        >
          {response.status > 0 ? `${response.status}${statusLabel ? ` ${statusLabel}` : ""}` : "—"}
        </span>
        <span className="text-muted-foreground">
          <span className="text-foreground">{response.elapsedMs}</span> ms
        </span>
        <span className={cn(
          "text-muted-foreground",
          isLargeResponse && "font-medium text-amber-600 dark:text-amber-400",
        )}>
          <span className={cn(isLargeResponse ? "" : "text-foreground")}>
            {formatBytes(response.bodyBytes)}
          </span>
        </span>
        {response.truncated && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
            truncated
          </span>
        )}
        {isLargeResponse && !response.truncated && (
          <span className="text-[10px] text-amber-500" title="Large responses may slow the editor.">
            ⚠ large
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleCopyBody()}
            className={cn(
              "rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground",
              bodyCopied && "text-emerald-500",
            )}
            title="Copy response body"
            aria-label="Copy response body"
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Postman-style sub-tab strip: Body / Cookies / Headers (N) / Test Results */}
      <div className="flex shrink-0 items-center gap-0 border-b border-border/60 px-2 text-[11px]">
        {(
          [
            { id: "body", label: "Body" },
            { id: "cookies", label: "Cookies" },
            { id: "headers", label: "Headers", badge: headerCount },
            { id: "tests", label: "Test Results" },
          ] as const
        ).map((t) => {
          const isActive = t.id === subTab;
          const isDisabled = t.id === "tests";
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => !isDisabled && setSubTab(t.id as ResponseSubTab)}
              disabled={isDisabled}
              className={cn(
                "flex shrink-0 items-center gap-1 border-b-2 px-3 py-1.5 transition-colors",
                isDisabled && "cursor-not-allowed opacity-40",
                !isDisabled && isActive && "border-primary text-primary",
                !isDisabled && !isActive && "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <span>{t.label}</span>
              {"badge" in t && t.badge !== undefined && t.badge > 0 && (
                <span className="text-[9px] text-muted-foreground">({t.badge})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Sub-tab content — min-w-0 + overflow-hidden are LOAD-BEARING:
          without them, the <pre> below (white-space: pre, no wrapping)
          contributes its widest-line intrinsic min-content up the flex
          chain through the split-pane row. The row inflates past the
          viewport, visually pushing the request side. Old bug class. */}
      <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden p-3">
        {subTab === "body" && (
          <>
            {/* Read-only CodeMirror viewer — same syntax highlighting
                that the request-body editor uses, so keys / strings /
                numbers / booleans are visually distinct. parsedBody.ok
                being true means the body is valid JSON; otherwise fall
                back to plain <pre> for XML / HTML / plaintext. */}
            <div className="flex w-full min-w-0 max-w-full flex-1 min-h-0 overflow-hidden rounded border border-border/60 bg-background">
              {parsedBody.ok ? (
                <JsonEditor value={display} onChange={() => {}} readOnly />
              ) : (
                <pre className="h-full w-full overflow-auto p-2 font-mono text-[11px] leading-relaxed text-foreground/90">
                  {display}
                </pre>
              )}
            </div>
            {isDisplayTruncated && (
              <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>
                  Showing first {(RESPONSE_DISPLAY_CAP / 1024).toFixed(0)} KB of {formatBytes(rawDisplay.length)}
                </span>
                <button
                  type="button"
                  onClick={() => setShowFullBody(true)}
                  className="rounded border border-border px-2 py-0.5 text-foreground hover:bg-accent"
                >
                  Show full
                </button>
              </div>
            )}
          </>
        )}

        {subTab === "headers" && (
          <div className="rounded border border-border/60">
            <div className="grid grid-cols-[1fr_2fr] gap-2 border-b border-border/60 bg-muted/30 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <span>Key</span>
              <span>Value</span>
            </div>
            {response.headers.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                No response headers
              </p>
            ) : (
              response.headers.map((h, i) => (
                <div
                  key={`${h.key}-${i}`}
                  className="grid grid-cols-[1fr_2fr] gap-2 border-b border-border/40 px-2 py-1 text-[11px] last:border-b-0"
                >
                  <span className="truncate font-mono text-muted-foreground" title={h.key}>
                    {h.key}
                  </span>
                  <span className="truncate font-mono" title={h.value}>
                    {h.value}
                  </span>
                </div>
              ))
            )}
          </div>
        )}

        {subTab === "cookies" && (
          <p className="text-[11px] text-muted-foreground">
            Set-Cookie headers from this response are auto-saved to the
            collection&apos;s cookie store. View them under Request →{" "}
            <strong>Cookies</strong> tab.
          </p>
        )}

        {subTab === "tests" && (
          <p className="text-[11px] text-muted-foreground">
            Test Results — Phase 11+ (Scripts tab will provide pre/post-request tests).
          </p>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// Error variant of the right-panel response area. Uses the same visual
// frame as ResponsePanel (status row + content area) so an error doesn't
// look like a floating overlay glued to the top of the right pane — the
// previous render had a free-floating red box at y=0 of the right panel
// which visually overlapped the request tab strip on the left.
function ErrorResponsePanel({ error, url }: { error: string; url: string }) {
  // Same flex-column discipline as ResponsePanel so the panel's contents
  // (status row + message + cause list) stay inside the right panel width.
  // Try to extract a human-readable cause from the JSON-shaped error string.
  // Backend returns { kind: "...", message: "..." } stringified by handleSend.
  let kind = "Error";
  let message = error;
  try {
    const parsed = JSON.parse(error) as { kind?: string; message?: string };
    if (parsed.kind) kind = parsed.kind;
    if (parsed.message) message = parsed.message;
  } catch {
    // Not JSON — keep raw error string as message.
  }
  return (
    <div className={PANEL_FLEX_COLUMN}>
      {/* Status row matches the success ResponsePanel layout so the right
          pane top alignment is consistent regardless of outcome. */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border/60 px-3 py-1.5 text-[11px]">
        <span className="rounded bg-red-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-red-600 dark:text-red-400">
          {kind.toUpperCase()}
        </span>
        <span className="text-muted-foreground">Request failed</span>
      </div>
      <div className="space-y-2 p-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Message
          </p>
          <p className="mt-1 font-mono text-[11px] text-red-600 dark:text-red-400">
            {message}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            URL attempted
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-foreground/80">
            {url || "(empty)"}
          </p>
        </div>
        <div className="rounded border border-border/40 bg-muted/30 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
          <p className="font-medium text-foreground/80">Common causes</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            <li>DNS failure / host unreachable (check the hostname)</li>
            <li>Connection refused (server down or wrong port)</li>
            <li>TLS / certificate error (try <code>http://</code> for testing)</li>
            <li>Trailing artifacts in URL — sanitizer strips <code>?</code> / <code>{"}"}</code> / whitespace before send</li>
            <li>Network / VPN required for internal endpoints</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
