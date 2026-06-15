// Sprint 10 Phase 10B — Authorization tab for the REST request editor.
//
// Four modes (matches RestAuth in rest-types.ts):
//   • No Auth — placeholder, no inputs
//   • Bearer Token — single token field; we store "Bearer <token>" as the
//     secret so the keychain blob is the literal Authorization header value
//   • Basic Auth — username (plaintext, kept in request.auth) + password
//     (secret). We compute "Basic <base64(user:pass)>" at save time so the
//     keychain stores the ready-to-inject header value
//   • API Key — name + value + in (header / query). Stored as the raw value
//     and injected at `headers.<name>` or `query.<name>`
//
// Secret handling rule (DEC #195): plaintext NEVER traverses IPC after the
// initial save. The FE only retains a SecretHandle (id + masked string). The
// keychain's plaintext is resolved by Rust just before the HTTP call goes
// out via the SecretRef path notation.

import { useEffect, useRef, useState } from "react";
import { Copy, Key, Lock, ShieldAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { RestAuth, RestRequestRecord, SecretHandle } from "./rest-types";
import { authSecretKey, resolveSecretPlain, saveSecret } from "./rest-keychain";
import { writeClipboard } from "@/lib/clipboard";

type AuthMode = RestAuth["kind"];

const MODE_OPTIONS: { value: AuthMode; label: string }[] = [
  { value: "none", label: "No Auth" },
  { value: "bearer", label: "Bearer Token" },
  { value: "basic", label: "Basic Auth" },
  { value: "api-key", label: "API Key" },
];

// Short per-mode description shown below the TYPE selector so the user
// can confirm at a glance what each auth mode does. Helps first-timers
// pick the right mode without leaving the editor.
const MODE_DESCRIPTIONS: Record<AuthMode, string> = {
  none: "This request doesn't send authentication credentials.",
  bearer: "Sends an `Authorization: Bearer <token>` header on every request.",
  basic: "Sends an `Authorization: Basic <base64(user:pass)>` header.",
  "api-key": "Sends a custom header or query parameter carrying the API key.",
};

export interface RestAuthorizationPanelProps {
  request: RestRequestRecord;
  onChange: (next: RestRequestRecord) => void;
}

export function RestAuthorizationPanel({ request, onChange }: RestAuthorizationPanelProps) {
  const auth: RestAuth = request.auth ?? { kind: "none" };

  const setAuth = (next: RestAuth) => onChange({ ...request, auth: next });

  const handleMode = (mode: AuthMode) => {
    if (auth.kind === mode) return;
    if (mode === "none") setAuth({ kind: "none" });
    else if (mode === "bearer") setAuth({ kind: "bearer" });
    else if (mode === "basic") setAuth({ kind: "basic", username: "" });
    else if (mode === "api-key") setAuth({ kind: "api-key", in: "header", name: "" });
  };

  return (
    <div className="flex w-full flex-col gap-3 p-3">
      {/* Type picker + short description: the picker on the left so it
          stays prominent, description on the right grows to fill so
          the user can read the explanation without losing eye contact
          with the dropdown. */}
      <div className="flex items-start gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Type
          </label>
          <Select
            value={auth.kind}
            onChange={(e) => handleMode(e.target.value as AuthMode)}
            options={MODE_OPTIONS}
            className="h-7 w-40 text-xs"
          />
        </div>
        <p className="flex-1 pt-5 text-[11px] leading-relaxed text-muted-foreground">
          {MODE_DESCRIPTIONS[auth.kind]}
        </p>
      </div>

      {auth.kind === "bearer" && (
        <BearerForm
          request={request}
          handleId={auth.tokenHandleId}
          onSaved={(handle) => setAuth({ kind: "bearer", tokenHandleId: handle.id })}
        />
      )}

      {auth.kind === "basic" && (
        <BasicForm
          request={request}
          username={auth.username}
          handleId={auth.passwordHandleId}
          onUsernameChange={(u) =>
            setAuth({ kind: "basic", username: u, passwordHandleId: auth.passwordHandleId })
          }
          onSaved={(handle, username) =>
            setAuth({ kind: "basic", username, passwordHandleId: handle.id })
          }
        />
      )}

      {auth.kind === "api-key" && (
        <ApiKeyForm
          request={request}
          name={auth.name}
          location={auth.in}
          handleId={auth.valueHandleId}
          onNameChange={(name) =>
            setAuth({ kind: "api-key", in: auth.in, name, valueHandleId: auth.valueHandleId })
          }
          onLocationChange={(loc) =>
            setAuth({ kind: "api-key", in: loc, name: auth.name, valueHandleId: auth.valueHandleId })
          }
          onSaved={(handle) =>
            setAuth({ kind: "api-key", in: auth.in, name: auth.name, valueHandleId: handle.id })
          }
        />
      )}

      {/* Bottom security tip — shown for any mode that involves a
          secret. Visual reminder, not a gate; users can keep going. */}
      {auth.kind !== "none" && (
        <div className="mt-1 flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Keep this credential private. Don't paste this request into
            public chats / git commits — share the curl from
            <span className="mx-1 rounded bg-amber-500/15 px-1 py-0.5 font-mono">
              Copy curl
            </span>
            only with people who already have access.
          </span>
        </div>
      )}
    </div>
  );
}

// ---- Mode-specific forms ----

function BearerForm({
  request,
  handleId,
  onSaved,
}: {
  request: RestRequestRecord;
  handleId?: string;
  onSaved: (handle: SecretHandle) => void;
}) {
  return (
    <SecretFieldRow
      label="Token"
      placeholder="Paste your bearer token"
      icon={<Key className="h-3 w-3" />}
      request={request}
      slot="bearer"
      handleId={handleId}
      // We prefix "Bearer " for the on-disk + on-wire form. The user
      // edits the bare token; stripDisplayPrefix removes the prefix
      // when we read it back from the keychain.
      buildPlaintext={(input) => `Bearer ${input}`}
      stripDisplayPrefix={(stored) => stored.replace(/^Bearer\s+/i, "")}
      onSaved={onSaved}
      hint="Stored in your OS keychain. Injected as `Authorization: Bearer …` at send time."
    />
  );
}

function BasicForm({
  request,
  username,
  handleId,
  onUsernameChange,
  onSaved,
}: {
  request: RestRequestRecord;
  username: string;
  handleId?: string;
  onUsernameChange: (value: string) => void;
  onSaved: (handle: SecretHandle, username: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Username
        </label>
        <Input
          value={username}
          onChange={(e) => onUsernameChange(e.target.value)}
          placeholder="username"
          className="h-7 text-xs"
        />
      </div>
      <SecretFieldRow
        label="Password"
        placeholder="Password"
        icon={<Lock className="h-3 w-3" />}
        request={request}
        slot="basic"
        handleId={handleId}
        // Encode as "Basic <base64(user:pass)>" on save. On read, decode
        // back to the user's plaintext password so the inline editor
        // shows what they originally typed. If username changes after
        // save the cached encoding goes stale — re-typing the password
        // re-encodes with the current username.
        buildPlaintext={(input) => `Basic ${b64(`${username}:${input}`)}`}
        stripDisplayPrefix={(stored) => {
          const m = stored.match(/^Basic\s+(.+)$/i);
          if (!m) return stored;
          try {
            const decoded = atob(m[1]);
            const idx = decoded.indexOf(":");
            return idx >= 0 ? decoded.slice(idx + 1) : decoded;
          } catch {
            return "";
          }
        }}
        onSaved={(handle) => onSaved(handle, username)}
        hint="If you change username, edit the password again to re-encode."
      />
    </div>
  );
}

function ApiKeyForm({
  request,
  name,
  location,
  handleId,
  onNameChange,
  onLocationChange,
  onSaved,
}: {
  request: RestRequestRecord;
  name: string;
  location: "header" | "query";
  handleId?: string;
  onNameChange: (value: string) => void;
  onLocationChange: (loc: "header" | "query") => void;
  onSaved: (handle: SecretHandle) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="flex-1 space-y-1">
          <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Key name
          </label>
          <Input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="x-api-key"
            className="h-7 text-xs"
          />
          {/* Friendly hint — mirrors the "建议使用有意义的名称" guidance.
              Lists the most common conventions so the user doesn't
              have to guess what the server expects. */}
          <p className="text-[10px] text-muted-foreground">
            Use a meaningful name. Common: <code className="font-mono">x-api-key</code>,
            {" "}<code className="font-mono">api_key</code>, <code className="font-mono">apikey</code>.
          </p>
        </div>
        <div className="w-32 space-y-1">
          <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Add to
          </label>
          <Select
            value={location}
            onChange={(e) => onLocationChange(e.target.value as "header" | "query")}
            options={[
              { value: "header", label: "Header" },
              { value: "query", label: "Query Params" },
            ]}
            className="h-7 text-xs"
          />
        </div>
      </div>
      <SecretFieldRow
        label="Value"
        placeholder="API key value"
        icon={<Key className="h-3 w-3" />}
        request={request}
        slot="api-key"
        handleId={handleId}
        buildPlaintext={(input) => input}
        onSaved={onSaved}
        hint={`Injected at \`${location === "query" ? "query" : "headers"}.${name || "<key>"}\` at send time.`}
      />
    </div>
  );
}

// ---- Reusable secret-field row ----

function SecretFieldRow({
  label,
  placeholder,
  icon,
  request,
  slot,
  handleId,
  buildPlaintext,
  stripDisplayPrefix,
  onSaved,
  hint,
}: {
  label: string;
  placeholder: string;
  icon: React.ReactNode;
  request: RestRequestRecord;
  slot: "bearer" | "basic" | "api-key";
  handleId?: string;
  // Final string that gets stored in the keychain (e.g. "Bearer abc" — we
  // do the prefix here so Rust can splat the value into the header path).
  buildPlaintext: (input: string) => string;
  // Inverse of buildPlaintext for the displayed value — we don't want the
  // user to see / re-type the "Bearer " prefix that we add internally.
  // Returns the part the user sees in the Input.
  stripDisplayPrefix?: (stored: string) => string;
  onSaved: (handle: SecretHandle) => void;
  hint?: string;
}) {
  // Plaintext shown directly to the user — they typed it themselves, we
  // return it to them for inline editing (per user request: "display 不
  // 需要 encrypted的 / 也不需要那个 change"). The Change button + masking
  // pattern is gone; this is just an Input bound to the in-keychain value.
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Debounce save: typing fast shouldn't fire one IPC call per keystroke.
  const saveTimerRef = useRef<number | null>(null);
  // Skip the next "resolve plaintext on handleId change" effect when the
  // handleId changed because WE just saved (otherwise we'd immediately
  // re-fetch the value we just wrote and visually flicker).
  const skipNextResolveRef = useRef(false);

  // Pull plaintext from the keychain on mount / handle change.
  useEffect(() => {
    if (!handleId) {
      setValue("");
      return;
    }
    if (skipNextResolveRef.current) {
      skipNextResolveRef.current = false;
      return;
    }
    let cancelled = false;
    void resolveSecretPlain({ id: handleId })
      .then((s) => {
        if (cancelled) return;
        const display = stripDisplayPrefix
          ? stripDisplayPrefix(s.plaintext)
          : s.plaintext;
        setValue(display);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [handleId, stripDisplayPrefix]);

  const persist = async (next: string) => {
    if (!next.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const handle = await saveSecret({
        collectionId: request.collectionId,
        key: authSecretKey(request, slot),
        plaintext: buildPlaintext(next),
      });
      // Tell the resolve effect to ignore the upcoming handleId change
      // — we already hold the canonical plaintext in the Input.
      skipNextResolveRef.current = true;
      onSaved(handle);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (next: string) => {
    setValue(next);
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    // 500ms idle = save. Long enough that fast typing batches, short
    // enough that the user feels "it just saves" without explicit
    // confirmation. The blur handler below also force-saves immediately.
    saveTimerRef.current = window.setTimeout(() => {
      void persist(next);
    }, 500);
  };

  const handleBlur = () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void persist(value);
  };

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    },
    [],
  );

  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!value) return;
    try {
      await writeClipboard(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Silent — user can re-type / select-all + Cmd-C as a fallback.
    }
  };

  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <Input
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onBlur={handleBlur}
          placeholder={placeholder}
          className="h-7 flex-1 font-mono text-xs"
          spellCheck={false}
        />
        {/* Copy-to-clipboard affordance for the inlined plaintext.
            Hidden when the input is empty so the row doesn't show a
            useless button on a fresh credential. */}
        {value && (
          <button
            type="button"
            onClick={() => void handleCopy()}
            aria-label={`Copy ${label.toLowerCase()}`}
            title={`Copy ${label.toLowerCase()}`}
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              copied && "text-emerald-500",
            )}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
        {saving && (
          <span className="text-[10px] text-muted-foreground" aria-label="Saving…">
            saving…
          </span>
        )}
      </div>
      {hint && <p className={cn("text-[10px] text-muted-foreground")}>{hint}</p>}
      {error && <p className="text-[10px] text-red-500">{error}</p>}
    </div>
  );
}

// btoa is always available in the Tauri webview (WKWebView / WebView2 / WebKit2GTK).
// We URI-encode first so non-ASCII characters in username/password survive
// the round-trip; the server-side base64-decoded value will be UTF-8 bytes.
function b64(s: string): string {
  return btoa(
    encodeURIComponent(s).replace(/%([0-9A-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    ),
  );
}
