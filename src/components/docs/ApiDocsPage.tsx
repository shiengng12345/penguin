import { useMemo, useState } from "react";
import {
  deleteMethodAnnotation,
  loadDocsAnnotations,
  loadDocsLarkUrl,
  loadDocsLastSyncedAt,
  pushDocsToLark,
  saveDocsLarkUrl,
  syncDocsFromLark,
  upsertMethodAnnotation,
  DOCS_PROTOCOLS,
  type DocsAnnotations,
  type DocsProtocol,
  type MethodAnnotation,
} from "./docs-lark";
import { Select } from "@/components/ui/select";
import {
  useAppStore,
  type InstalledPackage,
  type ProtoMethod,
  type ProtoService,
  type FieldInfo,
  type VisibleProtocolTab,
} from "@/lib/store";
import { generateDefaultJson } from "@penguin/core";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BookOpen, Globe, Server, Box, Play, ArrowLeft, Package, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const PROTOCOL_META: Record<DocsProtocol, { label: string; icon: typeof Globe; className: string }> = {
  "grpc-web": { label: "gRPC-Web", icon: Globe, className: "bg-green-500/15 text-green-600 dark:text-green-400" },
  grpc: { label: "gRPC", icon: Server, className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  sdk: { label: "JS-SDK", icon: Box, className: "bg-purple-500/15 text-purple-600 dark:text-purple-400" },
  rest: { label: "REST", icon: Globe, className: "bg-cyan-500/15 text-cyan-600 dark:text-cyan-400" },
};

const CUSTOM_PROTOCOL_OPTIONS = DOCS_PROTOCOLS.map((p) => ({
  value: p,
  label: PROTOCOL_META[p].label,
}));

interface DocMethodRef {
  protocol: VisibleProtocolTab;
  packageName: string;
  packageVersion: string;
  service: ProtoService;
  method: ProtoMethod;
}

interface ApiDocsPageProps {
  onClose: () => void;
  // Hands off to the API Client module; the caller switches the view, then we
  // patch the active tab with the chosen method (CommandSearch pattern).
  onOpenApiClient: () => void;
}

// Recursive field table rows. Depth-capped: schemas can nest arbitrarily and
// self-referencing messages are cycle-guarded by the parser but still deep.
const MAX_FIELD_DEPTH = 4;

function FieldRows({ fields, depth = 0 }: { fields: FieldInfo[]; depth?: number }) {
  if (depth > MAX_FIELD_DEPTH) return null;
  return (
    <>
      {fields.map((field, i) => (
        <FieldRow key={`${depth}-${i}-${field.name}`} field={field} depth={depth} />
      ))}
    </>
  );
}

function FieldRow({ field, depth }: { field: FieldInfo; depth: number }) {
  const hasChildren = !!field.fields && field.fields.length > 0 && depth < MAX_FIELD_DEPTH;
  return (
    <>
      <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] items-center gap-2 border-b border-border/40 px-2 py-1">
        <span
          className="truncate font-mono text-[11px] text-foreground"
          style={{ paddingLeft: depth * 14 }}
        >
          {field.name}
        </span>
        <span className="truncate font-mono text-[11px] text-sky-600 dark:text-sky-400">{field.type}</span>
        <span className="flex gap-1">
          {field.repeated && (
            <span className="rounded bg-violet-500/15 px-1 py-px text-[9px] font-medium text-violet-600 dark:text-violet-400">
              repeated
            </span>
          )}
          {field.optional && (
            <span className="rounded bg-muted px-1 py-px text-[9px] font-medium text-muted-foreground">
              optional
            </span>
          )}
          {field.enumValues && field.enumValues.length > 0 && (
            <span
              className="rounded bg-amber-500/15 px-1 py-px text-[9px] font-medium text-amber-600 dark:text-amber-400"
              title={field.enumValues.join(", ")}
            >
              enum ({field.enumValues.length})
            </span>
          )}
        </span>
      </div>
      {hasChildren && <FieldRows fields={field.fields!} depth={depth + 1} />}
    </>
  );
}

// Display + inline edit for one method's team documentation. Used both for
// real (schema-backed) methods and custom entries created in-app.
function AnnotationEditor({
  fullName,
  annotation,
  isCustom,
  onChange,
  onDeleted,
}: {
  fullName: string;
  annotation: MethodAnnotation | undefined;
  isCustom: boolean;
  onChange: (next: DocsAnnotations) => void;
  onDeleted?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftDescription, setDraftDescription] = useState("");
  const [draftNotes, setDraftNotes] = useState("");

  const startEdit = () => {
    setDraftDescription(annotation?.description ?? "");
    setDraftNotes(annotation?.notes ?? "");
    setEditing(true);
  };

  const save = () => {
    onChange(
      upsertMethodAnnotation(fullName, {
        description: draftDescription,
        notes: draftNotes,
        custom: isCustom || annotation?.custom,
        // Preserve the protocol tag across edits.
        protocol: annotation?.protocol,
      }),
    );
    setEditing(false);
  };

  const remove = () => {
    onChange(deleteMethodAnnotation(fullName));
    setEditing(false);
    onDeleted?.();
  };

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Documentation / 团队文档
        </span>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {annotation?.description || annotation?.notes ? "Edit / 编辑" : "+ Add / 添加"}
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2 p-3">
          <textarea
            value={draftDescription}
            onChange={(e) => setDraftDescription(e.target.value)}
            placeholder="Description — what this API does / 接口用途说明"
            rows={3}
            className="w-full rounded border border-border bg-background p-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/60"
          />
          <textarea
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            placeholder="Notes — gotchas, required headers, env caveats / 注意事项"
            rows={2}
            className="w-full rounded border border-border bg-background p-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/60"
          />
          <div className="flex items-center gap-1.5">
            <Button size="sm" className="h-6 text-[11px]" onClick={save}>
              Save / 保存
            </Button>
            <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {(annotation?.description || annotation?.notes || isCustom) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px] text-destructive hover:text-destructive"
                onClick={remove}
              >
                Delete / 删除
              </Button>
            )}
          </div>
        </div>
      ) : annotation?.description || annotation?.notes ? (
        <div className="space-y-2 p-3">
          {annotation.description && (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
              {annotation.description}
            </p>
          )}
          {annotation.notes && (
            <p className="whitespace-pre-wrap rounded border-l-2 border-amber-400/60 bg-amber-500/5 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
              {annotation.notes}
            </p>
          )}
        </div>
      ) : (
        <p className="px-3 py-2 text-[11px] text-muted-foreground">
          No documentation yet — click Add to write it, or sync from Lark. / 还没有文档,点击添加或从 Lark 同步。
        </p>
      )}
    </div>
  );
}

function FieldTable({ title, typeName, fields }: { title: string; typeName: string; fields: FieldInfo[] }) {
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{typeName}</span>
      </div>
      {fields.length > 0 ? (
        <div className="max-h-72 overflow-y-auto">
          <FieldRows fields={fields} />
        </div>
      ) : (
        <p className="px-3 py-2 text-[11px] text-muted-foreground">(empty / 无字段)</p>
      )}
    </div>
  );
}

export function ApiDocsPage({ onClose, onOpenApiClient }: ApiDocsPageProps) {
  const grpcWebPackages = useAppStore((s) => s.grpcWebPackages);
  const grpcPackages = useAppStore((s) => s.grpcPackages);
  const sdkPackages = useAppStore((s) => s.sdkPackages);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DocMethodRef | null>(null);
  // A custom (in-app authored) doc entry; mutually exclusive with `selected`.
  const [selectedCustom, setSelectedCustom] = useState<string | null>(null);
  const [newCustomName, setNewCustomName] = useState("");
  // REST is the default: it's the one protocol with no package schema, so
  // custom entries are its primary documentation path.
  const [newCustomProtocol, setNewCustomProtocol] = useState<DocsProtocol>("rest");

  // Team annotations synced from a Lark doc (same lark-cli pipeline as Vault).
  const [annotations, setAnnotations] = useState<DocsAnnotations>(() => loadDocsAnnotations());
  const [larkUrl, setLarkUrl] = useState<string>(() => loadDocsLarkUrl() ?? "");
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(() => loadDocsLastSyncedAt());
  const [larkPanelOpen, setLarkPanelOpen] = useState(false);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "error">("idle");
  const [syncMessage, setSyncMessage] = useState("");

  const handleSyncLark = async () => {
    const saved = saveDocsLarkUrl(larkUrl);
    if (!saved.success) {
      setSyncState("error");
      setSyncMessage(saved.reason ?? "Invalid URL");
      return;
    }
    setSyncState("syncing");
    setSyncMessage("");
    const result = await syncDocsFromLark();
    if (result.success) {
      setAnnotations(loadDocsAnnotations());
      setLastSyncedAt(loadDocsLastSyncedAt());
      setSyncState("idle");
      setSyncMessage(`✓ ${result.methodCount} method annotations synced`);
    } else {
      setSyncState("error");
      setSyncMessage(result.reason ?? "Sync failed");
    }
  };

  const handlePushLark = async () => {
    const saved = saveDocsLarkUrl(larkUrl);
    if (!saved.success) {
      setSyncState("error");
      setSyncMessage(saved.reason ?? "Invalid URL");
      return;
    }
    setSyncState("syncing");
    setSyncMessage("");
    const result = await pushDocsToLark();
    if (result.success) {
      setLastSyncedAt(loadDocsLastSyncedAt());
      setSyncState("idle");
      setSyncMessage(`✓ Pushed ${result.methodCount} entries to Lark`);
    } else {
      setSyncState("error");
      setSyncMessage(result.reason ?? "Push failed");
    }
  };

  const createCustomDoc = () => {
    const name = newCustomName.trim();
    if (!name) return;
    setAnnotations(upsertMethodAnnotation(name, { custom: true, protocol: newCustomProtocol }));
    setNewCustomName("");
    setSelected(null);
    setSelectedCustom(name);
  };

  const allMethods = useMemo(() => {
    const collect = (pkgs: InstalledPackage[], protocol: VisibleProtocolTab): DocMethodRef[] =>
      pkgs.flatMap((pkg) =>
        pkg.services.flatMap((service) =>
          service.methods.map((method) => ({
            protocol,
            packageName: pkg.name,
            packageVersion: pkg.version,
            service,
            method,
          })),
        ),
      );
    return [
      ...collect(grpcWebPackages, "grpc-web"),
      ...collect(grpcPackages, "grpc"),
      ...collect(sdkPackages, "sdk"),
    ];
  }, [grpcWebPackages, grpcPackages, sdkPackages]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allMethods;
    return allMethods.filter(
      (r) =>
        r.method.fullName.toLowerCase().includes(q) ||
        r.service.fullName.toLowerCase().includes(q) ||
        r.packageName.toLowerCase().includes(q),
    );
  }, [allMethods, query]);

  // Group for the left rail: package → service → methods.
  const grouped = useMemo(() => {
    const byPackage = new Map<string, { protocol: VisibleProtocolTab; version: string; services: Map<string, DocMethodRef[]> }>();
    for (const ref of filtered) {
      const pkgKey = `${ref.protocol}:${ref.packageName}`;
      if (!byPackage.has(pkgKey)) {
        byPackage.set(pkgKey, { protocol: ref.protocol, version: ref.packageVersion, services: new Map() });
      }
      const pkg = byPackage.get(pkgKey)!;
      if (!pkg.services.has(ref.service.fullName)) pkg.services.set(ref.service.fullName, []);
      pkg.services.get(ref.service.fullName)!.push(ref);
    }
    return byPackage;
  }, [filtered]);

  const active = selectedCustom ? null : selected ?? filtered[0] ?? null;

  // Custom group: entries authored in-app plus annotations whose method no
  // longer matches an installed package (still editable instead of invisible).
  const knownFullNames = useMemo(
    () => new Set(allMethods.map((r) => r.method.fullName)),
    [allMethods],
  );
  const customEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.entries(annotations.methods)
      .filter(([fullName, a]) => a.custom || !knownFullNames.has(fullName))
      .filter(([fullName]) => !q || fullName.toLowerCase().includes(q))
      .sort(([a], [b]) => a.localeCompare(b));
  }, [annotations, knownFullNames, query]);

  const sampleRequest = useMemo(() => {
    if (!active || !active.method.requestFields?.length) return "{}";
    return JSON.stringify(generateDefaultJson(active.method.requestFields), null, 2);
  }, [active]);

  // Open this method in the API Client (mirrors CommandSearch.selectResult).
  // View switches first so the Sidebar is mounted to receive focus-method.
  const tryMethod = (ref: DocMethodRef) => {
    onOpenApiClient();
    setTimeout(() => {
      const store = useAppStore.getState();
      const tab = store.tabs.find((t) => t.id === store.activeTabId);
      const patch = {
        protocolTab: ref.protocol,
        selectedPackage: ref.packageName,
        selectedService: ref.service.fullName,
        selectedMethod: ref.method,
        requestBody:
          ref.method.requestFields && ref.method.requestFields.length > 0
            ? JSON.stringify(generateDefaultJson(ref.method.requestFields), null, 2)
            : "{}",
      };
      if (tab && !tab.selectedMethod) {
        store.updateActiveTab(patch);
      } else {
        store.addTab();
        setTimeout(() => useAppStore.getState().updateActiveTab(patch), 0);
      }
      document.dispatchEvent(
        new CustomEvent("penguin:focus-method", {
          detail: { packageName: ref.packageName, serviceName: ref.service.fullName },
        }),
      );
    }, 0);
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-4 py-2">
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">API Docs / API 文档</span>
        <span className="text-[11px] text-muted-foreground">
          {allMethods.length} methods · generated from installed packages
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setLarkPanelOpen((v) => !v)}
          >
            <RefreshCw className={cn("mr-1 h-3 w-3", syncState === "syncing" && "animate-spin")} />
            Lark Docs
            {Object.keys(annotations.methods).length > 0 && (
              <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-[9px] text-primary">
                {Object.keys(annotations.methods).length}
              </span>
            )}
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
            placeholder="https://xxx.larksuite.com/docx/... — doc with a ```json methods block"
            className="h-7 max-w-md flex-1 text-xs font-mono"
          />
          <Button size="sm" className="h-7 text-xs" onClick={handleSyncLark} disabled={syncState === "syncing" || !larkUrl.trim()}>
            {syncState === "syncing" ? "Working..." : "Pull / 拉取"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={handlePushLark}
            disabled={syncState === "syncing" || !larkUrl.trim()}
            title="Overwrites the Lark doc with local docs / 用本地文档覆盖 Lark 文档"
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
        {/* Left rail: searchable package → service → method tree */}
        <div className="flex w-72 shrink-0 flex-col border-r border-border bg-card/50">
          <div className="border-b border-border p-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search methods... / 搜索方法"
              className="h-8 text-xs"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-1.5">
            {grouped.size === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                <Package className="h-6 w-6 opacity-40" />
                <p className="px-4 text-xs">
                  {allMethods.length === 0
                    ? "No packages installed — install one in the API Client (Cmd+S) / 还没有安装包"
                    : "No matching methods / 没有匹配的方法"}
                </p>
              </div>
            )}
            {Array.from(grouped.entries()).map(([pkgKey, pkg]) => {
              const meta = PROTOCOL_META[pkg.protocol];
              const MetaIcon = meta.icon;
              const packageName = pkgKey.slice(pkg.protocol.length + 1);
              return (
                <div key={pkgKey} className="mb-2">
                  <div className="flex items-center gap-1.5 px-1.5 py-1">
                    <span className={cn("flex items-center gap-1 rounded px-1 py-0.5 text-[9px] font-medium", meta.className)}>
                      <MetaIcon className="h-2.5 w-2.5" />
                      {meta.label}
                    </span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground" title={packageName}>
                      {packageName}
                    </span>
                  </div>
                  {Array.from(pkg.services.entries()).map(([serviceFullName, refs]) => (
                    <div key={serviceFullName} className="mb-1">
                      <p className="truncate px-1.5 py-0.5 text-[10px] font-semibold text-foreground/80" title={serviceFullName}>
                        {refs[0].service.name}
                      </p>
                      {refs.map((ref) => {
                        const isActive =
                          active?.method.fullName === ref.method.fullName && active?.protocol === ref.protocol;
                        const hasDoc = !!annotations.methods[ref.method.fullName];
                        return (
                          <button
                            key={`${ref.protocol}:${ref.method.fullName}`}
                            type="button"
                            onClick={() => {
                              setSelectedCustom(null);
                              setSelected(ref);
                            }}
                            className={cn(
                              "flex w-full items-center gap-1 truncate rounded px-2 py-1 text-left font-mono text-[11px] transition-colors",
                              isActive
                                ? "bg-primary/10 text-primary"
                                : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                            )}
                          >
                            <span className="truncate">{ref.method.name}</span>
                            {hasDoc && (
                              <span className="h-1 w-1 shrink-0 rounded-full bg-emerald-500" title="Documented / 已有文档" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Custom docs: authored in-app, incl. interfaces not yet shipped in a package */}
            <div className="mt-3 border-t border-border/60 pt-2">
              <p className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Custom Docs / 自定义文档
              </p>
              {customEntries.map(([fullName, annotation]) => {
                const isActive = selectedCustom === fullName;
                const meta = annotation.protocol ? PROTOCOL_META[annotation.protocol] : null;
                return (
                  <button
                    key={fullName}
                    type="button"
                    onClick={() => {
                      setSelected(null);
                      setSelectedCustom(fullName);
                    }}
                    className={cn(
                      "flex w-full items-center gap-1.5 truncate rounded px-2 py-1 text-left font-mono text-[11px] transition-colors",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                    )}
                    title={fullName}
                  >
                    {meta && (
                      <span className={cn("shrink-0 rounded px-1 py-px text-[9px] font-medium", meta.className)}>
                        {meta.label}
                      </span>
                    )}
                    <span className="truncate">{fullName}</span>
                  </button>
                );
              })}
              <div className="mt-1 space-y-1 px-1">
                <div className="flex items-center gap-1">
                  <Select
                    value={newCustomProtocol}
                    onChange={(e) => setNewCustomProtocol(e.target.value as DocsProtocol)}
                    options={CUSTOM_PROTOCOL_OPTIONS}
                    className="h-6 w-24 shrink-0 text-[10px]"
                  />
                  <Input
                    value={newCustomName}
                    onChange={(e) => setNewCustomName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") createCustomDoc();
                    }}
                    placeholder={newCustomProtocol === "rest" ? "GET /v1/users" : "pkg.Service.NewMethod"}
                    className="h-6 flex-1 font-mono text-[10px]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    onClick={createCustomDoc}
                    disabled={!newCustomName.trim()}
                  >
                    + New
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content: selected method documentation */}
        <div className="flex-1 overflow-y-auto p-5">
          {selectedCustom ? (
            <div className="mx-auto max-w-3xl space-y-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-mono text-base font-semibold text-foreground">{selectedCustom}</h2>
                  {annotations.methods[selectedCustom]?.protocol && (
                    <span
                      className={cn(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                        PROTOCOL_META[annotations.methods[selectedCustom]!.protocol!].className,
                      )}
                    >
                      {PROTOCOL_META[annotations.methods[selectedCustom]!.protocol!].label}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Custom doc — no installed package schema / 自定义文档(无包 schema)
                </p>
              </div>
              <AnnotationEditor
                fullName={selectedCustom}
                annotation={annotations.methods[selectedCustom]}
                isCustom
                onChange={setAnnotations}
                onDeleted={() => setSelectedCustom(null)}
              />
            </div>
          ) : active ? (
            <div className="mx-auto max-w-3xl space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-mono text-base font-semibold text-foreground">
                    {active.method.name}
                  </h2>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {active.method.fullName}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {active.packageName} v{active.packageVersion} · {PROTOCOL_META[active.protocol].label}
                  </p>
                </div>
                <Button size="sm" className="shrink-0" onClick={() => tryMethod(active)}>
                  <Play className="mr-1.5 h-3.5 w-3.5" />
                  Try it / 试调
                </Button>
              </div>

              <AnnotationEditor
                fullName={active.method.fullName}
                annotation={annotations.methods[active.method.fullName]}
                isCustom={false}
                onChange={setAnnotations}
              />

              <FieldTable
                title="Request / 请求"
                typeName={active.method.requestType}
                fields={active.method.requestFields ?? []}
              />
              <FieldTable
                title="Response / 响应"
                typeName={active.method.responseType}
                fields={active.method.responseFields ?? []}
              />

              <div className="rounded-md border border-border overflow-hidden">
                <div className="border-b border-border bg-muted/30 px-3 py-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Sample request body / 示例请求体
                  </span>
                </div>
                <pre className="max-h-64 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
                  {sampleRequest}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
              <BookOpen className="h-8 w-8 opacity-30" />
              <p className="text-sm">Select a method to view its documentation</p>
              <p className="text-xs">从左侧选择一个方法查看文档</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
