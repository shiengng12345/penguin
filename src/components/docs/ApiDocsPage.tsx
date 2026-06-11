import { useMemo, useState } from "react";
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
  type DocMethod,
  type EndpointField,
  type KnowledgeBase,
} from "./docs-lark";
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
  Globe,
  KeyRound,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Tag,
  Trash2,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

// The user's team doc — pre-filled when no URL has been configured yet.
const DEFAULT_DOCS_LARK_URL =
  "https://casinoplus.sg.larksuite.com/docx/R8EwdtG1Io9S5MxTIuVlSIuZgVg";

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

// --- Field tables (view + edit) -------------------------------------------

function FieldTableView({ fields, withRequired }: { fields: EndpointField[]; withRequired: boolean }) {
  if (fields.length === 0) {
    return <p className="text-[11px] text-muted-foreground">(none / 无)</p>;
  }
  const cols = withRequired
    ? "grid-cols-[1fr_0.7fr_0.5fr_1.6fr_1fr]"
    : "grid-cols-[1fr_0.7fr_1.8fr_1.2fr]";
  return (
    <div className="overflow-x-auto">
      <div className={cn("grid gap-x-3 border-b border-border/60 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground", cols)}>
        <span>{withRequired ? "Parameter" : "Field"}</span>
        <span>Type</span>
        {withRequired && <span>Required</span>}
        <span>Description</span>
        <span>Example</span>
      </div>
      {fields.map((f, i) => (
        <div key={i} className={cn("grid items-center gap-x-3 border-b border-border/30 py-1.5 text-[11px]", cols)}>
          <span className="truncate font-mono text-foreground">{f.name}</span>
          <span className="truncate font-mono text-sky-600 dark:text-sky-400">{f.type}</span>
          {withRequired && <span className="text-muted-foreground">{f.required ? "Yes" : "No"}</span>}
          <span className="text-muted-foreground">{f.description ?? ""}</span>
          {f.example ? (
            <button
              type="button"
              className="truncate text-left font-mono text-foreground/80 hover:text-foreground"
              title={`Click to copy: ${f.example}`}
              onClick={() => navigator.clipboard.writeText(f.example!)}
            >
              {f.example}
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
    </div>
  );
}

function FieldTableEditor({
  fields,
  withRequired,
  onChange,
}: {
  fields: EndpointField[];
  withRequired: boolean;
  onChange: (next: EndpointField[]) => void;
}) {
  const update = (i: number, patch: Partial<EndpointField>) =>
    onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-1.5">
      {fields.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={f.name}
            onChange={(e) => update(i, { name: e.target.value })}
            placeholder="name"
            className="h-6 w-28 font-mono text-[10px]"
          />
          <Input
            value={f.type}
            onChange={(e) => update(i, { type: e.target.value })}
            placeholder="type"
            className="h-6 w-20 font-mono text-[10px]"
          />
          {withRequired && (
            <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
              <input
                type="checkbox"
                checked={!!f.required}
                onChange={(e) => update(i, { required: e.target.checked })}
              />
              req
            </label>
          )}
          <Input
            value={f.description ?? ""}
            onChange={(e) => update(i, { description: e.target.value })}
            placeholder="description"
            className="h-6 flex-1 text-[10px]"
          />
          <Input
            value={f.example ?? ""}
            onChange={(e) => update(i, { example: e.target.value })}
            placeholder="example"
            className="h-6 w-32 font-mono text-[10px]"
          />
          <button
            type="button"
            onClick={() => onChange(fields.filter((_, j) => j !== i))}
            className="shrink-0 text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        className="h-6 text-[10px]"
        onClick={() => onChange([...fields, { name: "", type: "string" }])}
      >
        <Plus className="mr-1 h-3 w-3" />
        Add field
      </Button>
    </div>
  );
}

// --- Right-rail detail row --------------------------------------------------

function DetailRow({ icon: Icon, label, children }: { icon: typeof Tag; label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Icon className="h-2.5 w-2.5" />
        {label}
      </p>
      <div className="mt-0.5 text-[11px] text-foreground">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ApiDocsPageProps {
  onClose: () => void;
}

export function ApiDocsPage({ onClose }: ApiDocsPageProps) {
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

  const [larkPanelOpen, setLarkPanelOpen] = useState(false);
  const [larkUrl, setLarkUrl] = useState<string>(() => loadDocsLarkUrl() ?? DEFAULT_DOCS_LARK_URL);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() => loadDocsLastSyncedAt());
  const [syncState, setSyncState] = useState<"idle" | "working" | "error">("idle");
  const [syncMessage, setSyncMessage] = useState("");

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

  const related = useMemo(() => {
    if (!collection || !endpoint) return [];
    return collection.endpoints
      .filter((e) => e.id !== endpoint.id && (e.section ?? "General") === (endpoint.section ?? "General"))
      .slice(0, 5);
  }, [collection, endpoint]);

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
    setKb(deleteCollection(collection.id));
    setSelectedCollectionId(null);
    setSelectedEndpointId(null);
    setEditing(false);
  };

  const handleNewEndpoint = () => {
    if (!collection) return;
    const ep = emptyEndpoint();
    setKb(upsertEndpoint(collection.id, ep));
    setSelectedEndpointId(ep.id);
    setDraft(ep);
    setEditing(true);
  };

  const startEdit = () => {
    if (!endpoint) return;
    setDraft(JSON.parse(JSON.stringify(endpoint)) as DocEndpoint);
    setEditing(true);
  };

  const saveEdit = () => {
    if (!collection || !draft) return;
    setKb(upsertEndpoint(collection.id, draft));
    setSelectedEndpointId(draft.id);
    setEditing(false);
  };

  const handleDeleteEndpoint = () => {
    if (!collection || !endpoint) return;
    setKb(deleteEndpoint(collection.id, endpoint.id));
    setSelectedEndpointId(null);
    setEditing(false);
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
      setSyncState("idle");
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
                  <button
                    type="button"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    title="Delete collection / 删除集合"
                    onClick={handleDeleteCollection}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
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
                          <span className={cn("truncate font-mono text-[11px] font-medium", isActive ? "text-primary" : "text-foreground")}>
                            {ep.path}
                          </span>
                        </span>
                        {ep.summary && (
                          <span className="mt-0.5 block truncate pl-0.5 text-[10px] text-muted-foreground">
                            {ep.summary}
                          </span>
                        )}
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
                  {endpoint.section && (
                    <>
                      <ChevronRight className="h-3 w-3 shrink-0" />
                      <span className="truncate">{endpoint.section}</span>
                    </>
                  )}
                  <ChevronRight className="h-3 w-3 shrink-0" />
                  <span className="truncate font-mono text-foreground">{endpoint.path}</span>
                </nav>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                  {editing ? (
                    <>
                      <Button size="sm" className="h-7 text-xs" onClick={saveEdit}>
                        Save / 保存
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={handleDeleteEndpoint}
                      >
                        <Trash2 className="mr-1 h-3 w-3" />
                        Delete
                      </Button>
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
                  <div className="flex items-center gap-2">
                    <Select
                      value={draft.method}
                      onChange={(e) => updateDraft({ method: e.target.value as DocMethod })}
                      options={METHOD_OPTIONS}
                      className="h-8 w-28 font-mono text-xs"
                    />
                    <Input
                      value={draft.path}
                      onChange={(e) => updateDraft({ path: e.target.value })}
                      placeholder="/cpf/check or pkg.Service.Method"
                      className="h-8 flex-1 font-mono text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      value={draft.summary ?? ""}
                      onChange={(e) => updateDraft({ summary: e.target.value })}
                      placeholder="Summary — one line / 一句话说明"
                      className="h-7 text-xs"
                    />
                    <Input
                      value={draft.section ?? ""}
                      onChange={(e) => updateDraft({ section: e.target.value })}
                      placeholder="Section — list group / 分组(如 CPF & Document Check)"
                      className="h-7 text-xs"
                    />
                    <Input
                      value={draft.service ?? ""}
                      onChange={(e) => updateDraft({ service: e.target.value })}
                      placeholder="Service"
                      className="h-7 text-xs"
                    />
                    <Input
                      value={draft.baseUrl ?? ""}
                      onChange={(e) => updateDraft({ baseUrl: e.target.value })}
                      placeholder="Base URL"
                      className="h-7 font-mono text-xs"
                    />
                    <Input
                      value={draft.rateLimit ?? ""}
                      onChange={(e) => updateDraft({ rateLimit: e.target.value })}
                      placeholder="Rate limit (e.g. 100 req/min)"
                      className="h-7 text-xs"
                    />
                    <Input
                      value={draft.category ?? ""}
                      onChange={(e) => updateDraft({ category: e.target.value })}
                      placeholder="Category (e.g. KYC & Compliance)"
                      className="h-7 text-xs"
                    />
                    <Input
                      value={draft.authentication ?? ""}
                      onChange={(e) => updateDraft({ authentication: e.target.value })}
                      placeholder="Authentication (e.g. Bearer Token)"
                      className="h-7 text-xs"
                    />
                    <Input
                      value={draft.environment ?? ""}
                      onChange={(e) => updateDraft({ environment: e.target.value })}
                      placeholder="Environment (e.g. UAT & Production)"
                      className="h-7 text-xs"
                    />
                    <Input
                      value={draft.owner ?? ""}
                      onChange={(e) => updateDraft({ owner: e.target.value })}
                      placeholder="Owner (e.g. Platform Team)"
                      className="h-7 text-xs"
                    />
                    <Input
                      value={draft.tags.join(", ")}
                      onChange={(e) =>
                        updateDraft({
                          tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean),
                        })
                      }
                      placeholder="Tags, comma separated"
                      className="h-7 text-xs"
                    />
                  </div>
                  <Card title="Overview">
                    <textarea
                      value={draft.overview ?? ""}
                      onChange={(e) => updateDraft({ overview: e.target.value })}
                      placeholder="What this endpoint does / 端点说明"
                      rows={3}
                      className="w-full rounded border border-border bg-background p-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/60"
                    />
                  </Card>
                  <Card title="Request">
                    <FieldTableEditor
                      fields={draft.requestFields}
                      withRequired
                      onChange={(requestFields) => updateDraft({ requestFields })}
                    />
                    <textarea
                      value={draft.requestExample ?? ""}
                      onChange={(e) => updateDraft({ requestExample: e.target.value })}
                      placeholder="Request example (optional) / 请求示例"
                      rows={3}
                      spellCheck={false}
                      className="mt-2 w-full rounded border border-border bg-background p-2 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/60"
                    />
                  </Card>
                  <Card title="Response">
                    <FieldTableEditor
                      fields={draft.responseFields}
                      withRequired={false}
                      onChange={(responseFields) => updateDraft({ responseFields })}
                    />
                    <textarea
                      value={draft.responseExample ?? ""}
                      onChange={(e) => updateDraft({ responseExample: e.target.value })}
                      placeholder="Response example (optional) / 响应示例"
                      rows={3}
                      spellCheck={false}
                      className="mt-2 w-full rounded border border-border bg-background p-2 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/60"
                    />
                  </Card>
                  <Card title="Notes">
                    <textarea
                      value={draft.notes ?? ""}
                      onChange={(e) => updateDraft({ notes: e.target.value })}
                      placeholder={"One note per line / 一行一条\nRequires a valid Bearer Token.\nCPF must contain only 11 digits."}
                      rows={4}
                      className="w-full rounded border border-border bg-background p-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/60"
                    />
                  </Card>
                </div>
              ) : (
                /* ---------------- VIEW MODE ---------------- */
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <MethodBadge method={endpoint.method} large />
                      <h1 className="min-w-0 truncate font-mono text-xl font-semibold text-foreground">
                        {endpoint.path}
                      </h1>
                      <CopyButton text={endpoint.path} />
                    </div>
                    {endpoint.summary && (
                      <p className="mt-1 text-xs text-muted-foreground">{endpoint.summary}</p>
                    )}
                  </div>

                  {(endpoint.service || endpoint.baseUrl || endpoint.rateLimit) && (
                    <div className="flex flex-wrap divide-x divide-border rounded-lg border border-border bg-card/50">
                      {endpoint.service && (
                        <div className="flex items-center gap-2 px-4 py-2.5">
                          <Server className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>
                            <span className="block text-[10px] text-muted-foreground">Service</span>
                            <span className="block text-[11px] text-foreground">{endpoint.service}</span>
                          </span>
                        </div>
                      )}
                      {endpoint.baseUrl && (
                        <div className="flex min-w-0 items-center gap-2 px-4 py-2.5">
                          <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="min-w-0">
                            <span className="block text-[10px] text-muted-foreground">Base URL</span>
                            <span className="flex items-center gap-1.5">
                              <span className="block max-w-72 truncate font-mono text-[11px] text-foreground">
                                {endpoint.baseUrl}
                              </span>
                              <CopyButton text={endpoint.baseUrl} />
                            </span>
                          </span>
                        </div>
                      )}
                      {endpoint.rateLimit && (
                        <div className="flex items-center gap-2 px-4 py-2.5">
                          <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>
                            <span className="block text-[10px] text-muted-foreground">Rate Limit</span>
                            <span className="block text-[11px] text-foreground">{endpoint.rateLimit}</span>
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {endpoint.overview && (
                    <Card title="Overview">
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                        {endpoint.overview}
                      </p>
                    </Card>
                  )}

                  <Card title="Request" action={endpoint.requestExample ? <CopyButton text={endpoint.requestExample} label="Copy example" /> : undefined}>
                    <FieldTableView fields={endpoint.requestFields} withRequired />
                    {endpoint.requestExample && (
                      <pre className="mt-3 max-h-48 overflow-auto rounded border border-border/60 bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-foreground/90">
                        {endpoint.requestExample}
                      </pre>
                    )}
                  </Card>

                  <Card title="Response" action={endpoint.responseExample ? <CopyButton text={endpoint.responseExample} label="Copy example" /> : undefined}>
                    <FieldTableView fields={endpoint.responseFields} withRequired={false} />
                    {endpoint.responseExample && (
                      <pre className="mt-3 max-h-48 overflow-auto rounded border border-border/60 bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-foreground/90">
                        {endpoint.responseExample}
                      </pre>
                    )}
                  </Card>

                  {endpoint.notes && (
                    <Card title="Notes">
                      <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed text-foreground/90">
                        {endpoint.notes.split("\n").filter((n) => n.trim()).map((note, i) => (
                          <li key={i}>{note.trim()}</li>
                        ))}
                      </ul>
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

        {/* Column 4: details + related */}
        {endpoint && !editing && (
          <div className="hidden w-60 shrink-0 space-y-3 overflow-y-auto border-l border-border bg-card/30 p-3 xl:block">
            <div className="rounded-lg border border-border bg-card/50 p-3">
              <p className="mb-2.5 text-xs font-semibold text-foreground">Details</p>
              <div className="space-y-2.5">
                {endpoint.category && (
                  <DetailRow icon={Tag} label="Category">
                    <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px]">
                      {endpoint.category}
                    </span>
                  </DetailRow>
                )}
                {endpoint.authentication && (
                  <DetailRow icon={KeyRound} label="Authentication">{endpoint.authentication}</DetailRow>
                )}
                {endpoint.environment && (
                  <DetailRow icon={Globe} label="Environment">{endpoint.environment}</DetailRow>
                )}
                <DetailRow icon={RefreshCw} label="Last Updated">
                  {new Date(endpoint.updatedAt).toISOString().slice(0, 10)}
                </DetailRow>
                {endpoint.owner && <DetailRow icon={User} label="Owner">{endpoint.owner}</DetailRow>}
                {endpoint.tags.length > 0 && (
                  <DetailRow icon={Tag} label="Tags">
                    <span className="flex flex-wrap gap-1">
                      {endpoint.tags.map((tag) => (
                        <span key={tag} className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                          {tag}
                        </span>
                      ))}
                    </span>
                  </DetailRow>
                )}
              </div>
            </div>

            {related.length > 0 && (
              <div className="rounded-lg border border-border bg-card/50 p-3">
                <p className="mb-2 text-xs font-semibold text-foreground">Related Endpoints</p>
                {related.map((ep) => (
                  <button
                    key={ep.id}
                    type="button"
                    onClick={() => setSelectedEndpointId(ep.id)}
                    className="mb-1 block w-full rounded px-1.5 py-1 text-left hover:bg-accent/50"
                  >
                    <span className="flex items-center gap-1.5">
                      <MethodBadge method={ep.method} />
                      <span className="truncate font-mono text-[11px] text-foreground">{ep.path}</span>
                    </span>
                    {ep.summary && (
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{ep.summary}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
