import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  createCollection,
  deleteCollection,
  deleteEndpoint,
  emptyEndpoint,
  loadDocsLarkUrl,
  loadDocsLastSyncedAt,
  loadKnowledgeBase,
  pushDocsToLark,
  renameCollection,
  saveDocsLarkUrl,
  syncDocsFromLark,
  upsertEndpoint,
  DOC_METHODS,
  type DocCollection,
  type DocEndpoint,
  type DocHeader,
  type DocMethod,
  type KnowledgeBase,
} from "./docs-lark";

// JsonEditor is CodeMirror-based (~400KB). Lazy-load so the rest of the KB
// shell renders fast and the editor only mounts when the user starts editing.
const LazyJsonEditor = lazy(() =>
  import("@/components/ui/json-editor").then((m) => ({ default: m.JsonEditor })),
);
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  Folder,
  FolderOpen,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";
import { VaultConfirmModal } from "@/components/vault/VaultConfirmModal";
import { parseCurl, splitUrlForKb } from "@/lib/curl-parser";

const METHOD_COLORS: Record<DocMethod, string> = {
  GET: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  POST: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  PUT: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  PATCH: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  DELETE: "bg-red-500/15 text-red-600 dark:text-red-400",
  GRPC: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  "GRPC-WEB": "bg-green-500/15 text-green-600 dark:text-green-400",
  SDK: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
};

const METHOD_OPTIONS = DOC_METHODS.map((m) => ({ value: m, label: m }));

function MethodBadge({ method, large = false }: { method: DocMethod; large?: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded font-bold",
        large ? "px-2 py-0.5 text-xs" : "px-1.5 py-px text-[9px]",
        METHOD_COLORS[method],
      )}
    >
      {method}
    </span>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
      title="Copy / 复制"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-emerald-500" />
          <span className="text-emerald-500">Copied</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          {label}
        </>
      )}
    </button>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-2">
        <span className="text-xs font-semibold text-foreground">{title}</span>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// Field tables removed in Sprint 8.2 — replaced by HeadersTableEditor +
// JsonEditor for Request/Response Body. Legacy endpoints' requestFields /
// responseFields data is still preserved (data shape unchanged) but no
// longer displayed; parseEndpoint migrates requestExample → requestBody so
// the user-facing JSON examples still surface in the new layout.

// --- Numbered section + headers table (Sprint 8.2 editor) ----------------

function Section({
  number,
  label,
  required,
  optional,
  children,
}: {
  number: number;
  label: string;
  required?: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-medium text-foreground">
        {number}. {label}
        {required && <span className="ml-1 text-red-500">*</span>}
        {optional && <span className="ml-1 text-[11px] font-normal text-muted-foreground">(optional)</span>}
      </label>
      {children}
    </div>
  );
}

function HeadersTableEditor({
  headers,
  onChange,
}: {
  headers: DocHeader[];
  onChange: (h: DocHeader[]) => void;
}) {
  const addRow = () => onChange([...headers, { key: "", value: "" }]);
  const updateRow = (i: number, patch: Partial<DocHeader>) =>
    onChange(headers.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const deleteRow = (i: number) => onChange(headers.filter((_, j) => j !== i));
  return (
    <div className="rounded border border-border">
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 border-b border-border/60 bg-muted/30 px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Key</span>
        <span>Value</span>
        <span>Description (optional)</span>
        <span className="w-5" />
      </div>
      {headers.length === 0 ? (
        <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
          No headers yet — click Add Header below.
        </p>
      ) : (
        headers.map((h, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2 border-b border-border/40 px-2 py-1.5 last:border-b-0"
          >
            <Input
              value={h.key}
              onChange={(e) => updateRow(i, { key: e.target.value })}
              placeholder="Authorization"
              className="h-7 text-xs"
            />
            <Input
              value={h.value}
              onChange={(e) => updateRow(i, { value: e.target.value })}
              placeholder="Bearer Token"
              className="h-7 text-xs"
            />
            <Input
              value={h.description ?? ""}
              onChange={(e) => updateRow(i, { description: e.target.value })}
              placeholder="SIGAP access token"
              className="h-7 text-xs"
            />
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => deleteRow(i)}
              aria-label={`Delete header row ${i + 1}`}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))
      )}
      <div className="border-t border-border/60 px-2 py-1.5">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addRow}>
          <Plus className="mr-1 h-3 w-3" />
          Add Header
        </Button>
      </div>
    </div>
  );
}

const JSON_EDITOR_FALLBACK = (
  <div className="rounded border border-border bg-background p-3 text-[11px] text-muted-foreground">
    Loading editor...
  </div>
);

// DetailRow removed in Sprint 8.2 — right-rail Details panel dropped from
// the redesign (no Category / Authentication / Environment / Owner / Tags
// chips). Data fields preserved on DocEndpoint for backward compat.

// ---------------------------------------------------------------------------

interface ApiDocsPageProps {
  onClose: () => void;
}

export function ApiDocsPage({ onClose }: ApiDocsPageProps) {
  const isSuperAdmin = useAppStore((s) => s.isSuperAdmin);
  const [kb, setKb] = useState<KnowledgeBase>(() => loadKnowledgeBase());
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [selectedEndpointId, setSelectedEndpointId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const [creatingCollection, setCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const [renamingCollection, setRenamingCollection] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DocEndpoint | null>(null);
  // Tracks an endpoint that was just created via "New Endpoint" but never
  // saved — Cancel removes the stub instead of leaving it in the collection.
  const [creatingNewEndpointId, setCreatingNewEndpointId] = useState<string | null>(null);
  // Curl-paste autofill (Sprint 8.1) — collapsed panel above the editor that
  // parses a pasted curl command into the draft fields.
  const [curlPasteOpen, setCurlPasteOpen] = useState(false);
  const [curlPasteText, setCurlPasteText] = useState("");
  const [curlPasteError, setCurlPasteError] = useState<string | null>(null);
  // Tags is the only array field edited as a single string — keep a local
  // string buffer so the user can type trailing spaces/commas without the
  // split/trim/join roundtrip eating characters mid-keystroke.
  const [tagsInput, setTagsInput] = useState("");
  useEffect(() => {
    if (draft) setTagsInput(draft.tags.join(", "));
  }, [draft?.id]);
  // Destructive action confirm — open when user clicks Delete on a collection
  // or endpoint, cleared by Cancel or by performConfirmedDelete.
  const [confirmDelete, setConfirmDelete] = useState<
    | { kind: "collection"; collectionId: string; name: string; endpointCount: number }
    | { kind: "endpoint"; collectionId: string; endpointId: string; method: string; path: string }
    | null
  >(null);
  // Escape closes the page from the view state. Inline editors (create /
  // rename collection, edit endpoint) own their own Escape via input handlers;
  // confirm-delete modal owns its own Cancel. Mirrors VaultPage's pattern.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isEscape = e.key === "Escape";
      if (!isEscape) return;
      const inInlineEditor = creatingCollection || renamingCollection || editing;
      const inModal = confirmDelete !== null;
      if (inInlineEditor || inModal) return;
      onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [creatingCollection, renamingCollection, editing, confirmDelete, onClose]);

  const [larkPanelOpen, setLarkPanelOpen] = useState(false);
  const [larkUrl, setLarkUrl] = useState<string>(() => loadDocsLarkUrl() ?? "");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() => loadDocsLastSyncedAt());
  const [syncState, setSyncState] = useState<"idle" | "working" | "success" | "error">("idle");
  const [syncMessage, setSyncMessage] = useState("");
  // Auto-clear sync feedback so the green/red banner doesn't linger forever
  // after the action completed (M15 fix). Success clears faster than error
  // because the user typically wants to keep reading the error message.
  useEffect(() => {
    const isTerminal = syncState === "success" || syncState === "error";
    if (!isTerminal) return;
    const timeoutMs = syncState === "success" ? 3000 : 5000;
    const t = setTimeout(() => {
      setSyncState("idle");
      setSyncMessage("");
    }, timeoutMs);
    return () => clearTimeout(t);
  }, [syncState]);

  const collection: DocCollection | null =
    kb.collections.find((c) => c.id === selectedCollectionId) ?? kb.collections[0] ?? null;

  const filteredEndpoints = useMemo(() => {
    if (!collection) return [];
    const q = query.trim().toLowerCase();
    if (!q) return collection.endpoints;
    return collection.endpoints.filter(
      (e) =>
        e.path.toLowerCase().includes(q) ||
        (e.summary ?? "").toLowerCase().includes(q) ||
        (e.section ?? "").toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [collection, query]);

  // Group endpoints by section for the list column, preserving insert order.
  const sections = useMemo(() => {
    const map = new Map<string, DocEndpoint[]>();
    for (const ep of filteredEndpoints) {
      const key = ep.section?.trim() || "General";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ep);
    }
    return map;
  }, [filteredEndpoints]);

  const endpoint: DocEndpoint | null =
    collection?.endpoints.find((e) => e.id === selectedEndpointId) ??
    filteredEndpoints[0] ??
    null;

  // --- handlers ---

  const selectCollection = (id: string) => {
    setSelectedCollectionId(id);
    setSelectedEndpointId(null);
    setEditing(false);
    setRenamingCollection(false);
  };

  const handleCreateCollection = () => {
    const name = newCollectionName.trim();
    if (!name) return;
    const next = createCollection(name);
    setKb(next);
    setNewCollectionName("");
    setCreatingCollection(false);
    const created = next.collections[next.collections.length - 1];
    if (created) selectCollection(created.id);
  };

  const handleRenameCollection = () => {
    if (!collection || !renameDraft.trim()) return;
    setKb(renameCollection(collection.id, renameDraft));
    setRenamingCollection(false);
  };

  const handleDeleteCollection = () => {
    if (!collection) return;
    setConfirmDelete({
      kind: "collection",
      collectionId: collection.id,
      name: collection.name,
      endpointCount: collection.endpoints.length,
    });
  };

  // Make sure request/response body are valid JSON (default to `{}`) so the
  // CodeMirror JSON editor doesn't flag an empty body as a lint error when
  // editing endpoints that were created or last saved with an empty string.
  const withBodyDefaults = (ep: DocEndpoint): DocEndpoint => ({
    ...ep,
    requestBody: ep.requestBody?.trim() ? ep.requestBody : "{}",
    responseBody: ep.responseBody?.trim() ? ep.responseBody : "{}",
  });

  const handleNewEndpoint = () => {
    if (!collection) return;
    const ep = withBodyDefaults(emptyEndpoint());
    // Persist the stub so the right-panel detail view can render against it.
    // creatingNewEndpointId tracks the stub so Cancel can remove it cleanly
    // (Sprint 8 M5/M14 fix path).
    setKb(upsertEndpoint(collection.id, ep));
    setSelectedEndpointId(ep.id);
    setDraft(ep);
    setEditing(true);
    setCreatingNewEndpointId(ep.id);
  };

  const startEdit = () => {
    if (!endpoint) return;
    setDraft(withBodyDefaults(JSON.parse(JSON.stringify(endpoint)) as DocEndpoint));
    setEditing(true);
  };

  const saveEdit = () => {
    if (!collection || !draft) return;
    // Reject empty path — UI also disables the Save button in this state, but
    // defensive guard ensures the editor cannot persist an unaddressable row.
    if (!draft.path.trim()) return;
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    // Strip rows where the user added an empty field but didn't fill the name —
    // an empty row in the table table is editor noise, not data.
    const requestFields = draft.requestFields.filter((f) => f.name.trim());
    const responseFields = draft.responseFields.filter((f) => f.name.trim());
    const finalDraft = { ...draft, tags, requestFields, responseFields };
    setKb(upsertEndpoint(collection.id, finalDraft));
    setSelectedEndpointId(finalDraft.id);
    setEditing(false);
    // Save committed the row — clear the new-stub tracker.
    setCreatingNewEndpointId(null);
  };

  const cancelEdit = () => {
    // If we were editing a freshly-created stub the user never saved, drop
    // the stub so the collection list stays clean.
    if (creatingNewEndpointId && collection) {
      setKb(deleteEndpoint(collection.id, creatingNewEndpointId));
      setSelectedEndpointId(null);
      setCreatingNewEndpointId(null);
    }
    setEditing(false);
  };

  const handleDeleteEndpoint = () => {
    if (!collection || !endpoint) return;
    setConfirmDelete({
      kind: "endpoint",
      collectionId: collection.id,
      endpointId: endpoint.id,
      method: endpoint.method,
      path: endpoint.path,
    });
  };

  const performConfirmedDelete = () => {
    if (!confirmDelete) return;
    if (confirmDelete.kind === "collection") {
      setKb(deleteCollection(confirmDelete.collectionId));
      setSelectedCollectionId(null);
    } else {
      setKb(deleteEndpoint(confirmDelete.collectionId, confirmDelete.endpointId));
    }
    setSelectedEndpointId(null);
    setEditing(false);
    setConfirmDelete(null);
  };

  const handleLark = async (action: "pull" | "push") => {
    const saved = saveDocsLarkUrl(larkUrl);
    if (!saved.success) {
      setSyncState("error");
      setSyncMessage(saved.reason ?? "Invalid URL");
      return;
    }
    setSyncState("working");
    setSyncMessage("");
    const result = action === "pull" ? await syncDocsFromLark() : await pushDocsToLark();
    if (result.success) {
      if (action === "pull") setKb(loadKnowledgeBase());
      setLastSyncedAt(loadDocsLastSyncedAt());
      setSyncState("success");
      setSyncMessage(
        action === "pull"
          ? `✓ Pulled ${result.endpointCount} endpoints from Lark`
          : `✓ Pushed ${result.endpointCount} endpoints to Lark`,
      );
    } else {
      setSyncState("error");
      setSyncMessage(result.reason ?? "Failed");
    }
  };

  const updateDraft = (patch: Partial<DocEndpoint>) =>
    setDraft((d) => (d ? { ...d, ...patch } : d));

  // Parse a pasted curl command and overwrite the matching draft fields.
  // Sprint 8.2: fills method / path / requestBody and the new structured
  // headers table. baseUrl is preserved in the legacy field for round-trip
  // with existing Lark docs; the new UI doesn't display it.
  const applyCurlToDraft = () => {
    const parsed = parseCurl(curlPasteText);
    if (!parsed) {
      setCurlPasteError("Not a valid curl command — make sure it starts with `curl` and includes a URL");
      return;
    }
    const { baseUrl, path } = splitUrlForKb(parsed.url);
    const method = (DOC_METHODS as readonly string[]).includes(parsed.method)
      ? (parsed.method as DocMethod)
      : "GET";
    const headers: DocHeader[] = Object.entries(parsed.headers).map(([key, value]) => ({ key, value }));
    const patch: Partial<DocEndpoint> = {
      method,
      path,
      baseUrl,
      requestBody: parsed.body || undefined,
      headers: headers.length > 0 ? headers : undefined,
    };
    // Auto-derive a starter title from method+path if the user hasn't already
    // typed one — saves a manual edit for the most common case.
    if (!draft?.title?.trim()) {
      patch.title = `${method} ${path}`;
    }
    updateDraft(patch);
    setCurlPasteText("");
    setCurlPasteError(null);
    setCurlPasteOpen(false);
  };

  const totalEndpoints = kb.collections.reduce((sum, c) => sum + c.endpoints.length, 0);

  // --- render ---

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-background">
      {/* Module header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-2">
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Knowledge Base</span>
        <span className="text-[11px] text-muted-foreground">
          APIs, Credentials, and Internal Docs · {totalEndpoints} endpoints
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setLarkPanelOpen((v) => !v)}>
            <RefreshCw className={cn("mr-1 h-3 w-3", syncState === "working" && "animate-spin")} />
            Lark Sync
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            Home
          </Button>
        </div>
      </div>

      {larkPanelOpen && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/20 px-4 py-2">
          <Input
            value={larkUrl}
            onChange={(e) => setLarkUrl(e.target.value)}
            placeholder="https://xxx.larksuite.com/docx/..."
            className="h-7 max-w-md flex-1 font-mono text-xs"
          />
          <Button size="sm" className="h-7 text-xs" onClick={() => handleLark("pull")} disabled={syncState === "working" || !larkUrl.trim()}>
            Pull / 拉取
          </Button>
          {isSuperAdmin && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => handleLark("push")}
              disabled={syncState === "working" || !larkUrl.trim()}
              title="Overwrites the Lark doc with the local knowledge base / 用本地数据覆盖 Lark 文档"
            >
              Push / 推送
            </Button>
          )}
          {syncMessage && (
            <span className={cn("text-[11px]", syncState === "error" ? "text-red-500" : "text-emerald-500")}>
              {syncMessage}
            </span>
          )}
          {lastSyncedAt && !syncMessage && (
            <span className="text-[11px] text-muted-foreground">
              Last synced {new Date(lastSyncedAt).toLocaleString()}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Column 1: collections */}
        <div className="flex w-56 shrink-0 flex-col border-r border-border bg-card/50">
          <div className="p-2.5">
            {creatingCollection ? (
              <div className="flex items-center gap-1">
                <Input
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateCollection();
                    if (e.key === "Escape") setCreatingCollection(false);
                  }}
                  placeholder="Collection name"
                  autoFocus
                  className="h-7 flex-1 text-xs"
                />
                <Button size="sm" className="h-7 px-2 text-xs" onClick={handleCreateCollection}>
                  OK
                </Button>
              </div>
            ) : (
              <Button size="sm" className="h-8 w-full text-xs" onClick={() => setCreatingCollection(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                New Collection
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-1.5 pb-2">
            {kb.collections.map((c) => {
              const isActive = collection?.id === c.id;
              const FolderIcon = isActive ? FolderOpen : Folder;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCollection(c.id)}
                  className={cn(
                    "mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                    isActive ? "bg-primary/10" : "hover:bg-accent/50",
                  )}
                >
                  <FolderIcon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                  <span className="min-w-0">
                    <span className={cn("block truncate text-xs font-medium", isActive ? "text-primary" : "text-foreground")}>
                      {c.name}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      {c.endpoints.length} endpoints
                    </span>
                  </span>
                </button>
              );
            })}
            {kb.collections.length === 0 && (
              <p className="px-2.5 py-6 text-center text-[11px] text-muted-foreground">
                Create a collection to start documenting / 新建集合开始记录
              </p>
            )}
          </div>
        </div>

        {/* Column 2: endpoints in collection */}
        {collection && (
          <div className="flex w-64 shrink-0 flex-col border-r border-border">
            <div className="border-b border-border p-3">
              {renamingCollection ? (
                <div className="flex items-center gap-1">
                  <Input
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameCollection();
                      if (e.key === "Escape") setRenamingCollection(false);
                    }}
                    autoFocus
                    className="h-6 flex-1 text-xs"
                  />
                  <Button size="sm" className="h-6 px-2 text-[10px]" onClick={handleRenameCollection}>
                    OK
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <h2 className="min-w-0 truncate text-sm font-semibold text-foreground">{collection.name}</h2>
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title="Rename / 重命名"
                    onClick={() => {
                      setRenameDraft(collection.name);
                      setRenamingCollection(true);
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  {isSuperAdmin && (
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      title="Delete collection / 删除集合"
                      aria-label="Delete collection"
                      onClick={handleDeleteCollection}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
              <p className="mt-0.5 text-[10px] text-muted-foreground">{collection.endpoints.length} endpoints</p>
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search endpoints..."
                className="mt-2 h-7 text-xs"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              {Array.from(sections.entries()).map(([section, endpoints]) => (
                <div key={section} className="mb-2">
                  <p className="px-2 py-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {section}
                  </p>
                  {endpoints.map((ep) => {
                    const isActive = endpoint?.id === ep.id;
                    return (
                      <button
                        key={ep.id}
                        type="button"
                        onClick={() => {
                          setSelectedEndpointId(ep.id);
                          setEditing(false);
                        }}
                        className={cn(
                          "mb-0.5 block w-full rounded-md px-2 py-1.5 text-left transition-colors",
                          isActive ? "bg-primary/10" : "hover:bg-accent/50",
                        )}
                      >
                        <span className="flex items-center gap-1.5">
                          <MethodBadge method={ep.method} />
                          <span className={cn("truncate text-[11px] font-medium", isActive ? "text-primary" : "text-foreground")}>
                            {ep.title?.trim() || ep.path}
                          </span>
                        </span>
                        <span className="mt-0.5 block truncate pl-0.5 font-mono text-[10px] text-muted-foreground">
                          {ep.path}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
              {filteredEndpoints.length === 0 && (
                <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                  {collection.endpoints.length === 0 ? "No endpoints yet / 还没有端点" : "No matches / 没有匹配"}
                </p>
              )}
            </div>
            <div className="border-t border-border p-2">
              <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={handleNewEndpoint}>
                <Plus className="mr-1 h-3 w-3" />
                New Endpoint
              </Button>
            </div>
          </div>
        )}

        {/* Column 3: endpoint detail */}
        <div className="flex-1 overflow-y-auto">
          {endpoint && collection ? (
            <div className="p-5">
              {/* Breadcrumb + actions */}
              <div className="mb-4 flex items-center gap-2">
                <nav className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                  <span className="truncate">{collection.name}</span>
                  <ChevronRight className="h-3 w-3 shrink-0" />
                  <span className="truncate text-foreground">
                    {endpoint.title?.trim() || endpoint.path}
                  </span>
                </nav>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  {editing ? (
                    <>
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={saveEdit}
                        disabled={!draft?.path.trim()}
                        title={!draft?.path.trim() ? "Path is required" : undefined}
                      >
                        Save / 保存
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelEdit}>
                        Cancel
                      </Button>
                      {isSuperAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs text-destructive hover:text-destructive"
                          onClick={handleDeleteEndpoint}
                        >
                          <Trash2 className="mr-1 h-3 w-3" />
                          Delete
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button size="sm" className="h-7 text-xs" onClick={startEdit}>
                      <Pencil className="mr-1 h-3 w-3" />
                      Edit
                    </Button>
                  )}
                </div>
              </div>

              {editing && draft ? (
                /* ---------------- EDIT MODE ---------------- */
                <div className="space-y-4">
                  {/* Curl paste autofill — collapsed by default, expands to a
                      textarea that parses + fills method/path/baseUrl/body/auth. */}
                  <div className="rounded-md border border-dashed border-border bg-card/30">
                    {curlPasteOpen ? (
                      <div className="space-y-2 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-foreground">
                            Paste curl to autofill / 粘贴 curl 自动填
                          </span>
                          <button
                            type="button"
                            className="text-[11px] text-muted-foreground hover:text-foreground"
                            onClick={() => {
                              setCurlPasteOpen(false);
                              setCurlPasteText("");
                              setCurlPasteError(null);
                            }}
                          >
                            ✕
                          </button>
                        </div>
                        <textarea
                          value={curlPasteText}
                          onChange={(e) => {
                            setCurlPasteText(e.target.value);
                            if (curlPasteError) setCurlPasteError(null);
                          }}
                          placeholder={"curl 'https://api.example.com/users' \\\n  -H 'Authorization: Bearer xxx' \\\n  -d '{\"name\":\"Alice\"}'"}
                          rows={5}
                          className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground"
                        />
                        {curlPasteError && (
                          <p className="text-[11px] text-red-500">{curlPasteError}</p>
                        )}
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            onClick={applyCurlToDraft}
                            disabled={!curlPasteText.trim()}
                          >
                            Apply / 应用
                          </Button>
                          <span className="text-[10px] text-muted-foreground">
                            Fills method, path, base URL, request body, auth — keeps your other fields untouched.
                          </span>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setCurlPasteOpen(true)}
                      >
                        <Plus className="h-3 w-3" />
                        <span>Import from curl / 从 curl 导入（auto-fill method / path / body / auth）</span>
                      </button>
                    )}
                  </div>
                  {/* 1. Title */}
                  <Section number={1} label="Title" required>
                    <Input
                      value={draft.title ?? ""}
                      onChange={(e) => updateDraft({ title: e.target.value })}
                      placeholder="e.g. CPF Check (Impedimento)"
                      className="h-9 text-sm"
                    />
                  </Section>

                  {/* 2. Method + 3. Path */}
                  <div className="grid grid-cols-[160px_1fr] gap-3">
                    <Section number={2} label="Method" required>
                      <Select
                        value={draft.method}
                        onChange={(e) => updateDraft({ method: e.target.value as DocMethod })}
                        options={METHOD_OPTIONS}
                        className="h-9 w-full font-mono text-sm"
                      />
                    </Section>
                    <Section number={3} label="Path" required>
                      <Input
                        value={draft.path}
                        onChange={(e) => updateDraft({ path: e.target.value })}
                        placeholder="/impedimento/v2/condicao/{cpf}"
                        className="h-9 font-mono text-sm"
                      />
                    </Section>
                  </div>

                  {/* 4. Description */}
                  <Section number={4} label="Description">
                    <textarea
                      value={draft.description ?? ""}
                      onChange={(e) => updateDraft({ description: e.target.value })}
                      placeholder="Check if CPF is impeded or restricted in SIGAP."
                      rows={5}
                      className="w-full rounded border border-border bg-background p-2 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/60"
                    />
                  </Section>

                  {/* 5. Headers */}
                  <Section number={5} label="Headers">
                    <HeadersTableEditor
                      headers={draft.headers ?? []}
                      onChange={(headers) => updateDraft({ headers })}
                    />
                  </Section>

                  {/* 6. Request Body */}
                  <Section number={6} label="Request Body" optional>
                    <Suspense fallback={JSON_EDITOR_FALLBACK}>
                      <LazyJsonEditor
                        value={draft.requestBody ?? ""}
                        onChange={(v) => updateDraft({ requestBody: v })}
                        placeholder='{"cpf": "53477771842"}'
                      />
                    </Suspense>
                  </Section>

                  {/* 7. Response Body */}
                  <Section number={7} label="Response Body">
                    <Suspense fallback={JSON_EDITOR_FALLBACK}>
                      <LazyJsonEditor
                        value={draft.responseBody ?? ""}
                        onChange={(v) => updateDraft({ responseBody: v })}
                        placeholder='{"resultado": "NAO_IMPEDIDO"}'
                      />
                    </Suspense>
                  </Section>
                </div>
              ) : (
                /* ---------------- VIEW MODE (Sprint 8.2) ---------------- */
                <div className="space-y-5">
                  {/* Title + description */}
                  <div>
                    <h1 className="text-xl font-semibold text-foreground">
                      {endpoint.title || `${endpoint.method} ${endpoint.path}`}
                    </h1>
                    {endpoint.description && (
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {endpoint.description}
                      </p>
                    )}
                  </div>

                  {/* Method + path */}
                  <div className="flex items-center gap-2.5 rounded border border-border bg-card/50 px-3 py-2">
                    <MethodBadge method={endpoint.method} large />
                    <span className="min-w-0 flex-1 truncate font-mono text-sm text-foreground">
                      {endpoint.path}
                    </span>
                    <CopyButton text={endpoint.path} />
                  </div>

                  {/* Headers (read-only) */}
                  {endpoint.headers && endpoint.headers.length > 0 && (
                    <Card title="Headers">
                      <div>
                        <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 border-b border-border/60 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          <span>Key</span>
                          <span>Value</span>
                          <span>Description</span>
                        </div>
                        {endpoint.headers.map((h, i) => (
                          <div
                            key={i}
                            className="grid grid-cols-[1fr_1fr_1fr] items-center gap-2 border-b border-border/30 py-1.5 text-[11px] last:border-b-0"
                          >
                            <span className="font-mono text-foreground">{h.key}</span>
                            <span className="break-all font-mono text-foreground">{h.value}</span>
                            <span className="text-muted-foreground">{h.description ?? ""}</span>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}

                  {/* Request body */}
                  {endpoint.requestBody && (
                    <Card
                      title="Request Body"
                      action={<CopyButton text={endpoint.requestBody} label="Copy" />}
                    >
                      <pre className="max-h-72 overflow-auto rounded border border-border/60 bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-foreground/90">
                        {endpoint.requestBody}
                      </pre>
                    </Card>
                  )}

                  {/* Response body */}
                  {endpoint.responseBody && (
                    <Card
                      title="Response Body"
                      action={<CopyButton text={endpoint.responseBody} label="Copy" />}
                    >
                      <pre className="max-h-72 overflow-auto rounded border border-border/60 bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-foreground/90">
                        {endpoint.responseBody}
                      </pre>
                    </Card>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <BookOpen className="h-8 w-8 opacity-30" />
              <p className="text-sm">
                {kb.collections.length === 0
                  ? "Create a collection, then add endpoints"
                  : "Select or create an endpoint"}
              </p>
              <p className="text-xs">新建集合后添加端点文档</p>
            </div>
          )}
        </div>

        {/* Sprint 8.2: right-rail Details + Related dropped — detail panel
            is full-width now (Title/Method+Path/Description/Headers/Body). */}
      </div>
      <VaultConfirmModal
        open={confirmDelete !== null}
        title={confirmDelete?.kind === "collection" ? "Delete Collection?" : "Delete Endpoint?"}
        message={
          confirmDelete?.kind === "collection"
            ? `Delete "${confirmDelete.name}" and all ${confirmDelete.endpointCount} endpoint${confirmDelete.endpointCount === 1 ? "" : "s"}? This cannot be undone.`
            : confirmDelete?.kind === "endpoint"
            ? `Delete "${confirmDelete.method} ${confirmDelete.path}"? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={performConfirmedDelete}
      />
    </div>
  );
}
