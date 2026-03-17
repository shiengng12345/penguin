import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Eye,
  CheckCircle2,
  ChevronDown,
  Info,
  Loader2,
  Pencil,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import {
  addRedisConnection,
  connectRedisConnection,
  deleteRedisConnection,
  disconnectRedisConnection,
  listRedisConnections,
  testRedisConnection,
  updateRedisConnection,
  type RedisConnType,
  type RedisConnectionDraft,
  type RedisConnectionRecord,
} from "@/lib/redis";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RedisBrowser, type RedisBrowserHandle } from "@/components/redis/RedisBrowser";
import type { ShortcutSection } from "@/components/shortcuts/ShortcutCheatSheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type NoticeTone = "info" | "success" | "error";
type DialogMode = "create" | "edit";

interface NoticeState {
  tone: NoticeTone;
  message: string;
}

interface RedisTagGroup {
  key: string;
  label: string;
  connections: RedisConnectionRecord[];
}

interface RedisConnectionDialogProps {
  open: boolean;
  mode: DialogMode;
  draft: RedisConnectionDraft;
  existingTags: string[];
  testing: boolean;
  saving: boolean;
  saveIntent: "save" | "connect";
  testFeedback: NoticeState | null;
  onChange: (draft: RedisConnectionDraft) => void;
  onClose: () => void;
  onTest: () => void;
  onSave: (options?: { connectAfterSave?: boolean }) => void;
}

interface RedisImportCandidate {
  id: string;
  draft: RedisConnectionDraft;
}

interface RedisImportCandidateGroup {
  key: string;
  label: string;
  candidates: RedisImportCandidate[];
}

const UNGROUPED_TAG = "__ungrouped__";

const CONNECTION_TYPE_OPTIONS = [
  { value: "standalone", label: "Standalone" },
  { value: "cluster", label: "Cluster" },
  { value: "sentinel", label: "Sentinel" },
];

const TAG_SWATCHES = [
  "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300",
  "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
  "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300",
];

const TAG_SECTION_BORDER_SWATCHES = [
  "border-violet-500/35",
  "border-sky-500/35",
  "border-emerald-500/35",
  "border-amber-500/35",
  "border-rose-500/35",
  "border-cyan-500/35",
];

const TAG_SECTION_SURFACE_SWATCHES = [
  "bg-violet-500/[0.04]",
  "bg-sky-500/[0.04]",
  "bg-emerald-500/[0.04]",
  "bg-amber-500/[0.04]",
  "bg-rose-500/[0.04]",
  "bg-cyan-500/[0.04]",
];

const TAG_SECTION_HEADER_SWATCHES = [
  "bg-violet-500/[0.08]",
  "bg-sky-500/[0.08]",
  "bg-emerald-500/[0.08]",
  "bg-amber-500/[0.08]",
  "bg-rose-500/[0.08]",
  "bg-cyan-500/[0.08]",
];

const ShortcutCheatSheet = lazy(() =>
  import("@/components/shortcuts/ShortcutCheatSheet").then((module) => ({
    default: module.ShortcutCheatSheet,
  })),
);

const REDIS_SHORTCUTS: ShortcutSection[] = [
  {
    category: "Redis",
    items: [
      { keys: "⌘ + F", description: "Open Redis key search" },
      { keys: "⌘ + Shift + N", description: "Create Redis connection" },
      { keys: "⌘ + Shift + X", description: "Disconnect all Redis connections" },
      { keys: "⌘ + /", description: "Redis shortcuts" },
    ],
  },
  {
    category: "Views",
    items: [
      { keys: "⌘ + 1", description: "Switch to Browser" },
      { keys: "⌘ + 2", description: "Switch to CLI" },
      { keys: "⌘ + R", description: "Re-scan current Redis" },
    ],
  },
];

const REDIS_CONNECTION_VIEW_STORAGE_KEY = "pengvi.redis.connection-view-mode";

function getInitialRedisConnectionView(): "table" | "cards" {
  if (typeof window === "undefined") {
    return "table";
  }

  try {
    const stored = window.localStorage.getItem(REDIS_CONNECTION_VIEW_STORAGE_KEY);
    return stored === "cards" ? "cards" : "table";
  } catch {
    return "table";
  }
}

function createEmptyDraft(): RedisConnectionDraft {
  return {
    name: "",
    connType: "standalone",
    host: "127.0.0.1",
    port: 6379,
    username: "",
    password: "",
    db: 0,
    tls: {
      enabled: false,
      caCertPath: null,
      clientCertPath: null,
      clientKeyPath: null,
    },
    ssh: null,
    tag: "",
  };
}

function recordToDraft(record: RedisConnectionRecord): RedisConnectionDraft {
  return {
    name: record.name,
    connType: record.connType,
    host: record.host,
    port: record.port,
    username: record.username ?? "",
    password: record.password ?? "",
    db: record.db,
    tls: record.tls,
    ssh: record.ssh ?? null,
    tag: record.tag ?? "",
  };
}

function normalizeDraft(draft: RedisConnectionDraft): RedisConnectionDraft {
  return {
    ...draft,
    name: draft.name.trim(),
    host: draft.host.trim(),
    username: draft.username?.trim() || "",
    password: draft.password || "",
    tag: draft.tag?.trim() || "",
  };
}

function formatTimestamp(value?: number | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function getTagSwatchIndex(tag: string) {
  return [...tag].reduce((total, char) => total + char.charCodeAt(0), 0) % TAG_SWATCHES.length;
}

function getTagColorClasses(tag: string) {
  return TAG_SWATCHES[getTagSwatchIndex(tag)];
}

function getTagSectionBorderClasses(tag: string) {
  return TAG_SECTION_BORDER_SWATCHES[getTagSwatchIndex(tag)];
}

function getTagSectionSurfaceClasses(tag: string) {
  return TAG_SECTION_SURFACE_SWATCHES[getTagSwatchIndex(tag)];
}

function getTagSectionHeaderClasses(tag: string) {
  return TAG_SECTION_HEADER_SWATCHES[getTagSwatchIndex(tag)];
}

function groupConnectionsByTag(connections: RedisConnectionRecord[]) {
  const grouped = new Map<string, RedisConnectionRecord[]>();

  for (const connection of connections) {
    const key = connection.tag?.trim() || UNGROUPED_TAG;
    const items = grouped.get(key);
    if (items) {
      items.push(connection);
    } else {
      grouped.set(key, [connection]);
    }
  }

  const regularGroups = Array.from(grouped.entries())
    .filter(([key]) => key !== UNGROUPED_TAG)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, items]) => ({
      key,
      label: key,
      connections: items.sort((left, right) => left.name.localeCompare(right.name)),
    }));

  const ungrouped = grouped.get(UNGROUPED_TAG);
  if (ungrouped?.length) {
    regularGroups.push({
      key: UNGROUPED_TAG,
      label: "Ungrouped",
      connections: ungrouped.sort((left, right) => left.name.localeCompare(right.name)),
    });
  }

  return regularGroups;
}

function groupImportCandidatesByTag(candidates: RedisImportCandidate[]) {
  const grouped = new Map<string, RedisImportCandidate[]>();

  for (const candidate of candidates) {
    const key = candidate.draft.tag?.trim() || UNGROUPED_TAG;
    const items = grouped.get(key);
    if (items) {
      items.push(candidate);
    } else {
      grouped.set(key, [candidate]);
    }
  }

  const regularGroups = Array.from(grouped.entries())
    .filter(([key]) => key !== UNGROUPED_TAG)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, items]) => ({
      key,
      label: key,
      candidates: items.sort((left, right) => left.draft.name.localeCompare(right.draft.name)),
    }));

  const ungrouped = grouped.get(UNGROUPED_TAG);
  if (ungrouped?.length) {
    regularGroups.push({
      key: UNGROUPED_TAG,
      label: "Ungrouped",
      candidates: ungrouped.sort((left, right) => left.draft.name.localeCompare(right.draft.name)),
    });
  }

  return regularGroups satisfies RedisImportCandidateGroup[];
}

function noticeClasses(tone: NoticeTone) {
  if (tone === "success") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (tone === "error") {
    return "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  }
  return "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300";
}

function noticeToastClasses(tone: NoticeTone) {
  if (tone === "success") {
    return "border-emerald-500/35 bg-background/95 text-foreground shadow-emerald-500/10 dark:bg-card/95";
  }
  if (tone === "error") {
    return "border-rose-500/35 bg-background/95 text-foreground shadow-rose-500/10 dark:bg-card/95";
  }
  return "border-sky-500/35 bg-background/95 text-foreground shadow-sky-500/10 dark:bg-card/95";
}

function noticeAccentClasses(tone: NoticeTone) {
  if (tone === "success") {
    return "text-emerald-600 dark:text-emerald-300";
  }
  if (tone === "error") {
    return "text-rose-600 dark:text-rose-300";
  }
  return "text-sky-600 dark:text-sky-300";
}

function noticeIcon(tone: NoticeTone) {
  if (tone === "success") {
    return CheckCircle2;
  }
  if (tone === "error") {
    return XCircle;
  }
  return Info;
}

function rowClasses(connection: RedisConnectionRecord) {
  return connection.connected
    ? "bg-emerald-500/6 hover:bg-emerald-500/10"
    : "hover:bg-muted/40";
}

function normalizeNullableString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRedisImportHostSignature(draft: RedisConnectionDraft) {
  return normalizeDraft(draft).host.toLowerCase();
}

function parseImportedRedisDraft(value: unknown): RedisConnectionDraft | null {
  if (!isRecord(value)) {
    return null;
  }

  const name = normalizeNullableString(value.name);
  const host = normalizeNullableString(value.host);
  if (!name || !host) {
    return null;
  }

  const connType =
    value.connType === "cluster" || value.connType === "sentinel" ? value.connType : "standalone";
  const tlsSource = isRecord(value.tls) ? value.tls : {};
  const sshSource = isRecord(value.ssh) ? value.ssh : null;
  const sshAuthSource = sshSource && isRecord(sshSource.auth) ? sshSource.auth : null;
  const sshAuthType =
    sshAuthSource?.type === "Password"
      ? "Password"
      : sshAuthSource?.type === "KeyFile"
        ? "KeyFile"
        : null;

  const ssh =
    sshSource &&
    sshAuthSource &&
    normalizeNullableString(sshSource.host) &&
    normalizeNullableString(sshSource.username) &&
    sshAuthType &&
    normalizeNullableString(sshAuthSource.value)
      ? {
          host: normalizeNullableString(sshSource.host)!,
          port: Math.max(1, normalizeNumber(sshSource.port, 22)),
          username: normalizeNullableString(sshSource.username)!,
          auth:
            sshAuthType === "Password"
              ? {
                  type: "Password" as const,
                  value: normalizeNullableString(sshAuthSource.value)!,
                }
              : {
                  type: "KeyFile" as const,
                  value: normalizeNullableString(sshAuthSource.value)!,
                },
        }
      : null;

  return normalizeDraft({
    name,
    connType,
    host,
    port: Math.max(1, normalizeNumber(value.port, 6379)),
    username: normalizeNullableString(value.username) ?? "",
    password: typeof value.password === "string" ? value.password : "",
    db: Math.max(0, normalizeNumber(value.db, 0)),
    tls: {
      enabled: Boolean(tlsSource.enabled),
      caCertPath: normalizeNullableString(tlsSource.caCertPath),
      clientCertPath: normalizeNullableString(tlsSource.clientCertPath),
      clientKeyPath: normalizeNullableString(tlsSource.clientKeyPath),
    },
    ssh,
    tag: normalizeNullableString(value.tag) ?? "",
  });
}

function parseImportCandidates(
  rawText: string,
  existingHostSignatures: Set<string>,
): { candidates: RedisImportCandidate[]; duplicates: number; invalid: number } {
  const parsed = JSON.parse(rawText) as unknown;
  const items = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.connections)
      ? parsed.connections
      : null;

  if (!items) {
    throw new Error("Import JSON must be an array of Redis connections.");
  }

  const seen = new Set<string>();
  const candidates: RedisImportCandidate[] = [];
  let duplicates = 0;
  let invalid = 0;

  for (const item of items) {
    const draft = parseImportedRedisDraft(item);
    if (!draft) {
      invalid += 1;
      continue;
    }

    const hostSignature = getRedisImportHostSignature(draft);
    if (existingHostSignatures.has(hostSignature) || seen.has(hostSignature)) {
      duplicates += 1;
      continue;
    }

    seen.add(hostSignature);
    candidates.push({
      id: `import-${candidates.length}-${hostSignature}`,
      draft,
    });
  }

  return { candidates, duplicates, invalid };
}

function RedisConnectionDialog({
  open,
  mode,
  draft,
  existingTags,
  testing,
  saving,
  saveIntent,
  testFeedback,
  onChange,
  onClose,
  onTest,
  onSave,
}: RedisConnectionDialogProps) {
  const knownTags = useMemo(
    () => existingTags.filter((tag) => tag.trim().length > 0),
    [existingTags],
  );
  const [tagSelection, setTagSelection] = useState<string>("");
  const [customTag, setCustomTag] = useState("");

  useEffect(() => {
    if (draft.tag && !knownTags.includes(draft.tag)) {
      setTagSelection("__custom__");
      setCustomTag(draft.tag);
      return;
    }

    setTagSelection(draft.tag || "");
    setCustomTag("");
  }, [draft.tag, knownTags]);

  const tagOptions = useMemo(
    () => [
      { value: "", label: "No Tag" },
      ...knownTags.map((tag) => ({ value: tag, label: tag })),
      { value: "__custom__", label: "Create New Tag" },
    ],
    [knownTags],
  );

  const updateDraft = <K extends keyof RedisConnectionDraft>(
    key: K,
    value: RedisConnectionDraft[K],
  ) => {
    onChange({
      ...draft,
      [key]: value,
    });
  };

  const handleTagSelection = (value: string) => {
    setTagSelection(value);
    if (value === "__custom__") {
      const seededValue =
        draft.tag && !knownTags.includes(draft.tag) ? draft.tag : "";
      setCustomTag(seededValue);
      return;
    }

    setCustomTag("");
    updateDraft("tag", value);
  };

  const isCreateMode = mode === "create";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl rounded-3xl border border-border bg-card p-0 shadow-2xl" onClose={onClose}>
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle>
            {isCreateMode ? "Create Redis Connection" : "Edit Redis Connection"}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Follow Raven’s connection-first workflow. Save profile first, then connect from the table.
          </p>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Name</span>
              <Input
                value={draft.name}
                onChange={(event) => updateDraft("name", event.target.value)}
                placeholder="REDIS LOCAL"
                className="h-10 rounded-xl"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Type</span>
              <Select
                value={draft.connType}
                onChange={(event) =>
                  updateDraft("connType", event.target.value as RedisConnType)
                }
                options={CONNECTION_TYPE_OPTIONS}
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Host</span>
              <Input
                value={draft.host}
                onChange={(event) => updateDraft("host", event.target.value)}
                placeholder="127.0.0.1"
                className="h-10 rounded-xl"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Port</span>
              <Input
                type="number"
                value={draft.port}
                onChange={(event) =>
                  updateDraft("port", Number(event.target.value) || 0)
                }
                placeholder="6379"
                className="h-10 rounded-xl"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Username</span>
              <Input
                value={draft.username ?? ""}
                onChange={(event) => updateDraft("username", event.target.value)}
                placeholder="Optional"
                className="h-10 rounded-xl"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Password</span>
              <Input
                type="password"
                value={draft.password ?? ""}
                onChange={(event) => updateDraft("password", event.target.value)}
                placeholder="Optional"
                className="h-10 rounded-xl"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Database</span>
              <Input
                type="number"
                min={0}
                max={15}
                value={draft.db}
                onChange={(event) =>
                  updateDraft("db", Math.max(0, Number(event.target.value) || 0))
                }
                placeholder="0"
                className="h-10 rounded-xl"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Tag</span>
              <Select
                value={tagSelection}
                onChange={(event) => handleTagSelection(event.target.value)}
                options={tagOptions}
              />
            </label>

            <label className="space-y-2 md:col-span-2">
              <span className="text-sm font-medium text-foreground">TLS</span>
              <button
                type="button"
                onClick={() =>
                  updateDraft("tls", {
                    ...draft.tls,
                    enabled: !draft.tls.enabled,
                  })
                }
                className={cn(
                  "flex h-10 w-full items-center justify-between rounded-xl border px-4 text-sm transition-colors",
                  draft.tls.enabled
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                    : "border-input bg-transparent text-muted-foreground",
                )}
              >
                <span>{draft.tls.enabled ? "Enabled" : "Disabled"}</span>
                {draft.tls.enabled ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
              </button>
            </label>
          </div>

          {tagSelection === "__custom__" && (
            <label className="mt-4 block space-y-2">
              <span className="text-sm font-medium text-foreground">New Tag</span>
              <Input
                value={customTag}
                onChange={(event) => {
                  const value = event.target.value;
                  setCustomTag(value);
                  updateDraft("tag", value);
                }}
                placeholder="dev / staging / prod"
                className="h-10 rounded-xl"
              />
            </label>
          )}

          {testFeedback && (
            <div className={cn("mt-4 rounded-2xl border px-4 py-3 text-sm", noticeClasses(testFeedback.tone))}>
              {testFeedback.message}
            </div>
          )}

          <div className="mt-5 rounded-2xl border border-border bg-muted/20 px-4 py-3 text-xs leading-6 text-muted-foreground">
            SSH fields from Raven are kept in the backend model, but SSH tunnelling is not wired into Penguin yet.
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={onTest} disabled={testing || saving}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {testing ? "Testing..." : "Test"}
            </Button>
            <Button onClick={() => onSave()} disabled={saving || testing}>
              {saving && saveIntent === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {saving && saveIntent === "save"
                ? isCreateMode
                  ? "Creating..."
                  : "Saving..."
                : isCreateMode
                  ? "Create"
                  : "Save"}
            </Button>
            {isCreateMode && (
              <Button
                variant="outline"
                onClick={() => onSave({ connectAfterSave: true })}
                disabled={saving || testing}
              >
                {saving && saveIntent === "connect" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plug className="h-4 w-4" />
                )}
                {saving && saveIntent === "connect" ? "Creating & Connecting..." : "Create & Connect"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RedisWorkspace() {
  const [connections, setConnections] = useState<RedisConnectionRecord[]>([]);
  const [browserConnectionId, setBrowserConnectionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"table" | "cards">(() => getInitialRedisConnectionView());
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>("create");
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RedisConnectionDraft>(createEmptyDraft());
  const [dialogTesting, setDialogTesting] = useState(false);
  const [dialogSaving, setDialogSaving] = useState(false);
  const [dialogSaveIntent, setDialogSaveIntent] = useState<"save" | "connect">("save");
  const [dialogTestFeedback, setDialogTestFeedback] = useState<NoticeState | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportCopied, setExportCopied] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importCandidates, setImportCandidates] = useState<RedisImportCandidate[]>([]);
  const [selectedImportIds, setSelectedImportIds] = useState<string[]>([]);
  const [importEditingCandidateId, setImportEditingCandidateId] = useState<string | null>(null);
  const [importEditDraft, setImportEditDraft] = useState<RedisConnectionDraft>(createEmptyDraft());
  const [importEditTesting, setImportEditTesting] = useState(false);
  const [importEditFeedback, setImportEditFeedback] = useState<NoticeState | null>(null);
  const [importFeedback, setImportFeedback] = useState<NoticeState | null>(null);
  const [importDuplicates, setImportDuplicates] = useState(0);
  const [importInvalid, setImportInvalid] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importTestingIds, setImportTestingIds] = useState<string[]>([]);
  const [importTestResults, setImportTestResults] = useState<Record<string, NoticeState>>({});
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const browserRef = useRef<RedisBrowserHandle | null>(null);
  const connectionSearchRef = useRef<HTMLInputElement>(null);
  const importTestRunIdRef = useRef(0);

  const loadConnections = useCallback(async () => {
    try {
      const items = await listRedisConnections();
      setConnections(items);
      return items;
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    if (!browserConnectionId) {
      return;
    }

    const browserConnection = connections.find((connection) => connection.id === browserConnectionId);
    if (!browserConnection || !browserConnection.connected) {
      setBrowserConnectionId(null);
    }
  }, [browserConnectionId, connections]);

  useEffect(() => {
    if (browserConnectionId) {
      return;
    }

    const firstConnected = connections.find((connection) => connection.connected);
    if (firstConnected) {
      setBrowserConnectionId(firstConnected.id);
    }
  }, [browserConnectionId, connections]);

  useEffect(() => {
    try {
      window.localStorage.setItem(REDIS_CONNECTION_VIEW_STORAGE_KEY, viewMode);
    } catch {
      return;
    }
  }, [viewMode]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setNotice((current) => (current === notice ? null : current));
    }, notice.tone === "error" ? 5000 : 3000);

    return () => window.clearTimeout(timeout);
  }, [notice]);

  const availableTags = useMemo(
    () =>
      Array.from(
        new Set(
          connections
            .map((connection) => connection.tag?.trim() || "")
            .filter((tag) => tag.length > 0),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [connections],
  );

  const tagFilterOptions = useMemo(
    () => [
      { value: "all", label: "All Tags" },
      ...availableTags.map((tag) => ({ value: tag, label: tag })),
      { value: UNGROUPED_TAG, label: "Ungrouped" },
    ],
    [availableTags],
  );

  const filteredConnections = useMemo(() => {
    const query = search.trim().toLowerCase();

    return connections.filter((connection) => {
      const tagKey = connection.tag?.trim() || UNGROUPED_TAG;
      if (tagFilter !== "all" && tagKey !== tagFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = [
        connection.name,
        connection.host,
        connection.port,
        connection.connType,
        connection.tag ?? "",
        connection.connected ? "connected online" : "offline disconnected",
      ]
        .join(" ")
        .toLowerCase();

      return haystack.includes(query);
    });
  }, [connections, search, tagFilter]);

  const groupedConnections = useMemo<RedisTagGroup[]>(
    () => groupConnectionsByTag(filteredConnections),
    [filteredConnections],
  );
  const existingImportSignatures = useMemo(
    () => new Set(connections.map((connection) => getRedisImportHostSignature(recordToDraft(connection)))),
    [connections],
  );
  const exportJson = useMemo(
    () => JSON.stringify(connections.map((connection) => recordToDraft(connection)), null, 2),
    [connections],
  );
  const importCandidatesByStatus = useMemo(
    () => ({
      success: importCandidates.filter((candidate) => importTestResults[candidate.id]?.tone === "success"),
      failed: importCandidates.filter((candidate) => importTestResults[candidate.id]?.tone === "error"),
      untested: importCandidates.filter((candidate) => !importTestResults[candidate.id]),
    }),
    [importCandidates, importTestResults],
  );
  const importStatusSections = useMemo(
    () => [
      {
        key: "success",
        title: "Can Connect",
        description: "Passed connection test.",
        candidates: importCandidatesByStatus.success,
        borderClassName: "border-emerald-500/30",
        titleClassName: "text-emerald-600 dark:text-emerald-300",
        countClassName: "text-emerald-600/80 dark:text-emerald-300/80",
        rowClassName: "bg-emerald-500/[0.06]",
      },
      {
        key: "failed",
        title: "Failed",
        description: "Fix or remove these before importing.",
        candidates: importCandidatesByStatus.failed,
        borderClassName: "border-rose-500/30",
        titleClassName: "text-rose-600 dark:text-rose-300",
        countClassName: "text-rose-600/80 dark:text-rose-300/80",
        rowClassName: "bg-rose-500/[0.05]",
      },
      {
        key: "untested",
        title: "Not Tested",
        description: "New connections that have not been tested yet.",
        candidates: importCandidatesByStatus.untested,
        borderClassName: "border-border",
        titleClassName: "text-foreground",
        countClassName: "text-muted-foreground",
        rowClassName: "bg-background/70",
      },
    ],
    [importCandidatesByStatus],
  );
  const allImportCandidatesSelected =
    importCandidates.length > 0 && selectedImportIds.length === importCandidates.length;

  const openCreateDialog = useCallback(() => {
    setDialogMode("create");
    setEditingConnectionId(null);
    setDraft(createEmptyDraft());
    setDialogTestFeedback(null);
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((connection: RedisConnectionRecord) => {
    setDialogMode("edit");
    setEditingConnectionId(connection.id);
    setDraft(recordToDraft(connection));
    setDialogTestFeedback(null);
    setDialogOpen(true);
  }, []);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    setDialogTestFeedback(null);
    setDialogTesting(false);
    setDialogSaving(false);
    setDialogSaveIntent("save");
  }, []);

  const openExportDialog = useCallback(() => {
    setExportCopied(false);
    setExportOpen(true);
  }, []);

  const openImportDialog = useCallback(() => {
    importTestRunIdRef.current += 1;
    setImportText("");
    setImportCandidates([]);
    setSelectedImportIds([]);
    setImportEditingCandidateId(null);
    setImportEditDraft(createEmptyDraft());
    setImportEditTesting(false);
    setImportEditFeedback(null);
    setImportFeedback(null);
    setImportDuplicates(0);
    setImportInvalid(0);
    setImporting(false);
    setImportTestingIds([]);
    setImportTestResults({});
    setImportOpen(true);
  }, []);

  const openImportEditDialog = useCallback((candidate: RedisImportCandidate) => {
    setImportEditingCandidateId(candidate.id);
    setImportEditDraft(candidate.draft);
    setImportEditTesting(false);
    setImportEditFeedback(null);
  }, []);

  const closeImportEditDialog = useCallback(() => {
    setImportEditingCandidateId(null);
    setImportEditDraft(createEmptyDraft());
    setImportEditTesting(false);
    setImportEditFeedback(null);
  }, []);

  const handleSaveImportEditDialog = useCallback(() => {
    if (!importEditingCandidateId) {
      return;
    }

    setImportCandidates((current) =>
      current.map((candidate) =>
        candidate.id === importEditingCandidateId
          ? {
              ...candidate,
              draft: normalizeDraft(importEditDraft),
            }
          : candidate,
      ),
    );
    setImportTestResults((current) => {
      const next = { ...current };
      delete next[importEditingCandidateId];
      return next;
    });
    setImportFeedback(null);
    closeImportEditDialog();
  }, [closeImportEditDialog, importEditDraft, importEditingCandidateId]);

  const handleTestImportEditDialog = useCallback(async () => {
    setImportEditTesting(true);
    setImportEditFeedback(null);

    try {
      await testRedisConnection(normalizeDraft(importEditDraft));
      setImportEditFeedback({
        tone: "success",
        message: "Can connect to Redis.",
      });
    } catch (error) {
      setImportEditFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setImportEditTesting(false);
    }
  }, [importEditDraft]);

  const removeImportCandidate = useCallback((id: string) => {
    setImportCandidates((current) => current.filter((candidate) => candidate.id !== id));
    setSelectedImportIds((current) => current.filter((candidateId) => candidateId !== id));
    setImportTestingIds((current) => current.filter((candidateId) => candidateId !== id));
    setImportTestResults((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setImportFeedback(null);
  }, []);

  const testImportCandidateDraft = useCallback(async (candidate: RedisImportCandidate) => {
    try {
      await testRedisConnection(normalizeDraft(candidate.draft));
      return {
        tone: "success",
        message: "Can connect to Redis.",
      } satisfies NoticeState;
    } catch (error) {
      return {
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      } satisfies NoticeState;
    }
  }, []);

  const runImportCandidateTests = useCallback(
    async (candidates: RedisImportCandidate[], options?: { updateFeedback?: boolean }) => {
      const runId = importTestRunIdRef.current + 1;
      importTestRunIdRef.current = runId;

      if (candidates.length === 0) {
        setImportTestingIds([]);
        setImportTestResults({});
        return;
      }

      setImportTestingIds(candidates.map((candidate) => candidate.id));
      setImportTestResults({});
      if (options?.updateFeedback) {
        setImportFeedback({
          tone: "info",
          message: `Testing ${candidates.length} new Redis connection${candidates.length !== 1 ? "s" : ""}...`,
        });
      }

      let successCount = 0;
      let failureCount = 0;

      for (const candidate of candidates) {
        const result = await testImportCandidateDraft(candidate);
        if (importTestRunIdRef.current !== runId) {
          return;
        }

        if (result.tone === "success") {
          successCount += 1;
        } else {
          failureCount += 1;
        }

        setImportTestResults((current) => ({
          ...current,
          [candidate.id]: result,
        }));
        setImportTestingIds((current) => current.filter((id) => id !== candidate.id));
      }

      if (options?.updateFeedback && importTestRunIdRef.current === runId) {
        setImportFeedback({
          tone: failureCount > 0 ? "info" : "success",
          message:
            failureCount > 0
              ? `${successCount} can connect, ${failureCount} failed.`
              : `All ${successCount} Redis connections can connect.`,
        });
      }
    },
    [testImportCandidateDraft],
  );

  const handleRefresh = useCallback(async () => {
    setBusyAction("refresh");
    await loadConnections();
    setBusyAction(null);
  }, [loadConnections]);

  const handleCopyExport = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportJson);
      setExportCopied(true);
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [exportJson]);

  const handleDialogTest = useCallback(async () => {
    setDialogTesting(true);
    setDialogTestFeedback(null);
    try {
      await testRedisConnection(normalizeDraft(draft));
      setDialogTestFeedback({
        tone: "success",
        message: "Can connect to Redis.",
      });
    } catch (error) {
      setDialogTestFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDialogTesting(false);
    }
  }, [draft]);

  const handleDialogSave = useCallback(
    async (options?: { connectAfterSave?: boolean }) => {
      setDialogSaving(true);
      setDialogSaveIntent(options?.connectAfterSave ? "connect" : "save");
      setDialogTestFeedback(null);

      try {
        const normalized = normalizeDraft(draft);
        const saved = dialogMode === "edit" && editingConnectionId
          ? await updateRedisConnection(editingConnectionId, normalized)
          : await addRedisConnection(normalized);

        let successMessage =
          dialogMode === "edit"
            ? `Updated ${saved.name}.`
            : `Created ${saved.name}.`;

        if (options?.connectAfterSave) {
          const response = await connectRedisConnection(saved.id);
          const versionSuffix = response.serverInfo.redisVersion
            ? ` Redis ${response.serverInfo.redisVersion}`
            : "";
          successMessage = `${successMessage} ${response.message}${versionSuffix}`;
        }

        setNotice({
          tone: "success",
          message: successMessage,
        });
        await loadConnections();
        if (options?.connectAfterSave) {
          setBrowserConnectionId(saved.id);
        }
        closeDialog();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setDialogTestFeedback({
          tone: "error",
          message,
        });
      } finally {
        setDialogSaving(false);
        setDialogSaveIntent("save");
      }
    },
    [closeDialog, dialogMode, draft, editingConnectionId, loadConnections],
  );

  const handleConnectToggle = useCallback(
    async (connection: RedisConnectionRecord) => {
      setBusyAction(connection.id);
      try {
        if (connection.connected) {
          await disconnectRedisConnection(connection.id);
          setNotice({
            tone: "info",
            message: `Disconnected ${connection.name}.`,
          });
        } else {
          const response = await connectRedisConnection(connection.id);
          const versionSuffix = response.serverInfo.redisVersion
            ? ` Redis ${response.serverInfo.redisVersion}`
            : "";
          setNotice({
            tone: "success",
            message: `${response.message}${versionSuffix}`,
          });
        }
        const refreshedConnections = await loadConnections();
        if (!connection.connected) {
          setBrowserConnectionId(connection.id);
        } else if (browserConnectionId === connection.id) {
          const nextConnected = refreshedConnections.find((item) => item.connected);
          setBrowserConnectionId(nextConnected?.id ?? null);
        }
      } catch (error) {
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusyAction(null);
      }
    },
    [browserConnectionId, loadConnections],
  );

  const handleOpenConnection = useCallback(
    async (connection: RedisConnectionRecord) => {
      if (connection.connected) {
        setBrowserConnectionId(connection.id);
        return;
      }

      setBusyAction(connection.id);
      try {
        const response = await connectRedisConnection(connection.id);
        const versionSuffix = response.serverInfo.redisVersion
          ? ` Redis ${response.serverInfo.redisVersion}`
          : "";
        setNotice({
          tone: "success",
          message: `${response.message}${versionSuffix}`,
        });
        await loadConnections();
        setBrowserConnectionId(connection.id);
      } catch (error) {
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusyAction(null);
      }
    },
    [loadConnections],
  );

  const handleDisconnectAll = useCallback(async () => {
    const activeConnections = connections.filter((connection) => connection.connected);
    if (activeConnections.length === 0) {
      setNotice({
        tone: "info",
        message: "No connected Redis instances to disconnect.",
      });
      return;
    }

    setBusyAction("disconnect-all");
    const failed: string[] = [];

    for (const connection of activeConnections) {
      try {
        await disconnectRedisConnection(connection.id);
      } catch (error) {
        failed.push(
          `${connection.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const refreshedConnections = await loadConnections();
    const nextConnected = refreshedConnections.find((connection) => connection.connected);

    if (failed.length === 0) {
      setNotice({
        tone: "info",
        message: `Disconnected ${activeConnections.length} Redis connection${activeConnections.length !== 1 ? "s" : ""}.`,
      });
      setBrowserConnectionId(nextConnected?.id ?? null);
    } else {
      setNotice({
        tone: "error",
        message: `Some connections failed to disconnect: ${failed.join(" | ")}`,
      });
      setBrowserConnectionId(nextConnected?.id ?? null);
    }

    setBusyAction(null);
  }, [connections, loadConnections]);

  const handleImportTextChange = useCallback(
    (value: string) => {
      setImportText(value);

      if (value.trim().length === 0) {
        importTestRunIdRef.current += 1;
        setImportCandidates([]);
        setSelectedImportIds([]);
        setImportEditingCandidateId(null);
        setImportEditDraft(createEmptyDraft());
        setImportEditTesting(false);
        setImportEditFeedback(null);
        setImportFeedback(null);
        setImportDuplicates(0);
        setImportInvalid(0);
        setImportTestingIds([]);
        setImportTestResults({});
        return;
      }

      try {
        const { candidates, duplicates, invalid } = parseImportCandidates(value, existingImportSignatures);
        setImportCandidates(candidates);
        setSelectedImportIds(candidates.map((candidate) => candidate.id));
        setImportEditingCandidateId(null);
        setImportEditDraft(createEmptyDraft());
        setImportEditTesting(false);
        setImportEditFeedback(null);
        setImportDuplicates(duplicates);
        setImportInvalid(invalid);
        setImportTestingIds([]);
        setImportTestResults({});
        setImportFeedback({
          tone: candidates.length > 0 ? "info" : "success",
          message:
            candidates.length > 0
              ? `${candidates.length} new connection${candidates.length !== 1 ? "s" : ""} detected. Auto testing now...`
              : "No new Redis connections found in this JSON.",
        });
        if (candidates.length > 0) {
          void runImportCandidateTests(candidates, { updateFeedback: true });
        }
      } catch (error) {
        importTestRunIdRef.current += 1;
        setImportCandidates([]);
        setSelectedImportIds([]);
        setImportEditingCandidateId(null);
        setImportEditDraft(createEmptyDraft());
        setImportEditTesting(false);
        setImportEditFeedback(null);
        setImportDuplicates(0);
        setImportInvalid(0);
        setImportTestingIds([]);
        setImportTestResults({});
        setImportFeedback({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [existingImportSignatures, runImportCandidateTests],
  );

  const handleImportSelected = useCallback(async () => {
    const selectedCandidates = importCandidates.filter((candidate) =>
      selectedImportIds.includes(candidate.id),
    );

    if (selectedCandidates.length === 0) {
      setImportFeedback({
        tone: "info",
        message: "Select at least one new Redis connection to import.",
      });
      return;
    }

    const seenHosts = new Set(existingImportSignatures);
    const validCandidates: RedisImportCandidate[] = [];
    const blocked: string[] = [];

    for (const candidate of selectedCandidates) {
      const normalized = normalizeDraft(candidate.draft);
      if (!normalized.name || !normalized.host) {
        blocked.push(`${candidate.draft.name || "Unnamed"}: name and host are required.`);
        continue;
      }

      const hostSignature = getRedisImportHostSignature(normalized);
      if (seenHosts.has(hostSignature)) {
        blocked.push(`${normalized.host}: host already exists.`);
        continue;
      }

      seenHosts.add(hostSignature);
      validCandidates.push({
        ...candidate,
        draft: normalized,
      });
    }

    if (validCandidates.length === 0) {
      setImportFeedback({
        tone: "error",
        message: blocked[0] ?? "No valid Redis connections ready to import.",
      });
      return;
    }

    setImporting(true);
    const failed: string[] = [];
    const importedIds: string[] = [];

    for (const candidate of validCandidates) {
      try {
        await addRedisConnection(candidate.draft);
        importedIds.push(candidate.id);
      } catch (error) {
        failed.push(
          `${candidate.draft.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    await loadConnections();
    setImporting(false);

    if (importedIds.length > 0) {
      setImportCandidates((current) => current.filter((candidate) => !importedIds.includes(candidate.id)));
      setSelectedImportIds((current) => current.filter((id) => !importedIds.includes(id)));
      setImportTestingIds((current) => current.filter((id) => !importedIds.includes(id)));
      setImportTestResults((current) => {
        const next = { ...current };
        for (const id of importedIds) {
          delete next[id];
        }
        return next;
      });
    }

    if (failed.length === 0 && blocked.length === 0) {
      setNotice({
        tone: "success",
        message: `Imported ${validCandidates.length} Redis connection${validCandidates.length !== 1 ? "s" : ""}.`,
      });
      if (importCandidates.length === validCandidates.length) {
        setImportOpen(false);
      }
      return;
    }

    setImportFeedback({
      tone: failed.length > 0 ? "error" : "info",
      message: [
        importedIds.length > 0
          ? `Imported ${importedIds.length} connection${importedIds.length !== 1 ? "s" : ""}.`
          : null,
        blocked.length > 0 ? `Skipped: ${blocked.join(" | ")}` : null,
        failed.length > 0 ? `Failed: ${failed.join(" | ")}` : null,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }, [existingImportSignatures, importCandidates, loadConnections, selectedImportIds]);

  const handleTestImportCandidate = useCallback(async (candidate: RedisImportCandidate) => {
    setImportTestingIds((current) => (current.includes(candidate.id) ? current : [...current, candidate.id]));

    const result = await testImportCandidateDraft(candidate);
    setImportTestResults((current) => ({
      ...current,
      [candidate.id]: result,
    }));
    setImportTestingIds((current) => current.filter((id) => id !== candidate.id));
  }, [testImportCandidateDraft]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "/" && !event.shiftKey) {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
        return;
      }

      if (key === "n" && event.shiftKey) {
        event.preventDefault();
        openCreateDialog();
        return;
      }

      if (key === "x" && event.shiftKey) {
        event.preventDefault();
        void handleDisconnectAll();
        return;
      }

      if (key === "f") {
        event.preventDefault();
        if (browserConnectionId) {
          browserRef.current?.focusPattern();
        } else {
          connectionSearchRef.current?.focus();
          connectionSearchRef.current?.select();
        }
        return;
      }

      if (!browserConnectionId) {
        return;
      }

      switch (key) {
        case "1":
          event.preventDefault();
          browserRef.current?.openBrowser();
          break;
        case "2":
          event.preventDefault();
          browserRef.current?.openCli();
          break;
        case "r":
          event.preventDefault();
          browserRef.current?.rescan();
          break;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [browserConnectionId, handleDisconnectAll, openCreateDialog]);

  const handleDelete = useCallback(
    async (connection: RedisConnectionRecord) => {
      setBusyAction(`delete-${connection.id}`);
      try {
        await deleteRedisConnection(connection.id);
        setNotice({
          tone: "info",
          message: `Deleted ${connection.name}.`,
        });
        await loadConnections();
      } catch (error) {
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusyAction(null);
      }
    },
    [loadConnections],
  );

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  };

  const browserConnection =
    browserConnectionId
      ? connections.find((connection) => connection.id === browserConnectionId) ?? null
      : null;
  const browserConnectionGroups = useMemo(
    () => groupConnectionsByTag(connections),
    [connections],
  );

  return (
    <>
      {notice ? (
        <div className="pointer-events-none fixed right-4 top-20 z-40 flex max-w-[420px] animate-in fade-in slide-in-from-top-4 duration-300">
          <div
            className={cn(
              "pointer-events-auto flex w-full items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl ring-1 ring-black/5 backdrop-blur-md dark:ring-white/10",
              noticeToastClasses(notice.tone),
            )}
          >
            {(() => {
              const Icon = noticeIcon(notice.tone);
              return <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", noticeAccentClasses(notice.tone))} />;
            })()}
            <p className="min-w-0 flex-1 text-sm font-medium leading-6">{notice.message}</p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              aria-label="Dismiss notice"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      {browserConnection ? (
        <RedisBrowser
          ref={browserRef}
          connection={browserConnection}
          connectionGroups={browserConnectionGroups}
          busyAction={busyAction}
          onOpenConnection={(connection) => void handleOpenConnection(connection)}
          onToggleConnection={(connection) => void handleConnectToggle(connection)}
          onDisconnectAll={() => void handleDisconnectAll()}
          onCreateConnection={openCreateDialog}
        />
      ) : (
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background p-4">
        <div className="rounded-3xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h1 className="text-lg font-semibold text-foreground">Redis Connections</h1>
              <p className="text-sm text-muted-foreground">
                Raven-style connection manager. Grouped by tag, with table or card view plus import/export.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-xl border border-border bg-background/70 p-1">
                <Button
                  variant={viewMode === "table" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8"
                  onClick={() => setViewMode("table")}
                >
                  Table
                </Button>
                <Button
                  variant={viewMode === "cards" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-8"
                  onClick={() => setViewMode("cards")}
                >
                  Cards
                </Button>
              </div>
              <Button variant="outline" size="sm" onClick={openImportDialog}>
                Import JSON
              </Button>
              <Button variant="outline" size="sm" onClick={openExportDialog}>
                Export JSON
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleRefresh()}
                disabled={busyAction === "refresh"}
              >
                <RefreshCw className={cn("h-4 w-4", busyAction === "refresh" && "animate-spin")} />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleDisconnectAll()}
                disabled={busyAction === "disconnect-all" || !connections.some((connection) => connection.connected)}
              >
                {busyAction === "disconnect-all" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Disconnect All
              </Button>
              <Button size="sm" onClick={openCreateDialog}>
                <Plus className="h-4 w-4" />
                Create Redis
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={connectionSearchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search connections"
                className="pl-10"
              />
            </div>

            <div className="w-[200px]">
              <Select
                value={tagFilter}
                onChange={(event) => setTagFilter(event.target.value)}
                options={tagFilterOptions}
              />
            </div>
          </div>

          <div className="max-h-[calc(100vh-220px)] overflow-y-auto px-5 pb-5">
            {loading ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                Loading Redis connections…
              </div>
            ) : groupedConnections.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-sm font-medium text-foreground">No Redis connections found</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Create a connection profile first, then connect from the table.
                </p>
                <Button className="mt-4" onClick={openCreateDialog}>
                  <Plus className="h-4 w-4" />
                  Create Redis
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {groupedConnections.map((group) => {
                  const isCollapsed = !!collapsedGroups[group.key];
                  const isUngrouped = group.key === UNGROUPED_TAG;

                  return (
                    <section
                      key={group.key}
                      className={cn(
                        "overflow-hidden rounded-2xl border",
                        isUngrouped ? "border-border" : getTagSectionBorderClasses(group.label),
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.key)}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition",
                          isUngrouped
                            ? "bg-muted/30 hover:bg-muted/40"
                            : cn(getTagSectionHeaderClasses(group.label), "hover:brightness-[0.97]"),
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <ChevronDown
                            className={cn(
                              "h-4 w-4 text-muted-foreground transition-transform",
                              isCollapsed && "-rotate-90",
                            )}
                          />
                          {isUngrouped ? (
                            <span className="text-sm font-medium text-muted-foreground">
                              {group.label}
                            </span>
                          ) : (
                            <Badge
                              variant="outline"
                              className={cn("px-2 py-0.5 uppercase", getTagColorClasses(group.label))}
                            >
                              {group.label}
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {group.connections.length} connection{group.connections.length !== 1 ? "s" : ""}
                        </span>
                      </button>

                      {!isCollapsed && (
                        viewMode === "table" ? (
                          <div
                            className={cn(
                              "overflow-x-auto",
                              !isUngrouped && getTagSectionSurfaceClasses(group.label),
                            )}
                          >
                            <table className="min-w-full table-fixed text-sm">
                              <colgroup>
                                <col className="w-[44px]" />
                                <col className="w-[180px]" />
                                <col />
                                <col className="w-[86px]" />
                                <col className="w-[70px]" />
                                <col className="w-[110px]" />
                                <col className="w-[170px]" />
                                <col className="w-[220px]" />
                              </colgroup>
                              <thead
                                className={cn(
                                  isUngrouped
                                    ? "bg-background/95"
                                    : getTagSectionHeaderClasses(group.label),
                                )}
                              >
                                <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                  <th className="px-3 py-2.5 font-medium" />
                                  <th className="px-3 py-2.5 font-medium">Name</th>
                                  <th className="px-3 py-2.5 font-medium">Host</th>
                                  <th className="px-3 py-2.5 font-medium">Port</th>
                                  <th className="px-3 py-2.5 font-medium">DB</th>
                                  <th className="px-3 py-2.5 font-medium">Mode</th>
                                  <th className="px-3 py-2.5 font-medium">Last Used</th>
                                  <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.connections.map((connection) => {
                                  const isBusy = busyAction === connection.id;
                                  const isDeleting = busyAction === `delete-${connection.id}`;

                                  return (
                                    <tr
                                      key={connection.id}
                                      className={cn("border-t border-border/70 transition-colors", rowClasses(connection))}
                                    >
                                      <td className="px-3 py-2">
                                        <div
                                          className={cn(
                                            "mx-auto h-2 w-2 rounded-full",
                                            connection.connected
                                              ? "bg-emerald-500"
                                              : "bg-muted-foreground/30",
                                          )}
                                        />
                                      </td>
                                      <td className="px-3 py-2">
                                        <p className="truncate text-sm font-medium leading-5 text-foreground">
                                          {connection.name}
                                        </p>
                                      </td>
                                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                                        <span className="block truncate" title={connection.host}>
                                          {connection.host}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                                        {connection.port}
                                      </td>
                                      <td className="px-3 py-2 text-xs text-muted-foreground">
                                        {connection.db}
                                      </td>
                                      <td className="px-3 py-2 text-xs capitalize text-muted-foreground">
                                        {connection.connType}
                                      </td>
                                      <td className="px-3 py-2 text-xs text-muted-foreground">
                                        {formatTimestamp(connection.lastConnectedAt)}
                                      </td>
                                      <td className="px-3 py-2">
                                        <div className="flex items-center justify-end gap-1">
                                          <Button
                                            size="sm"
                                            variant={connection.connected ? "outline" : "default"}
                                            className={cn(
                                              "h-7 text-[11px]",
                                              connection.connected && "text-amber-600 hover:text-amber-600",
                                            )}
                                            onClick={() => void handleConnectToggle(connection)}
                                            disabled={isBusy || isDeleting}
                                          >
                                            {isBusy ? (
                                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : connection.connected ? (
                                              <PlugZap className="h-3.5 w-3.5" />
                                            ) : (
                                              <Plug className="h-3.5 w-3.5" />
                                            )}
                                            {connection.connected ? "Disconnect" : "Connect"}
                                          </Button>
                                          {connection.connected && (
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-7 w-7"
                                              onClick={() => setBrowserConnectionId(connection.id)}
                                              disabled={isBusy || isDeleting}
                                              title="Open browser"
                                            >
                                              <Eye className="h-3.5 w-3.5" />
                                            </Button>
                                          )}
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            onClick={() => openEditDialog(connection)}
                                            disabled={isBusy || isDeleting}
                                            title="Edit connection"
                                          >
                                            <Pencil className="h-3.5 w-3.5" />
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7 text-rose-600 hover:text-rose-600"
                                            onClick={() => void handleDelete(connection)}
                                            disabled={isBusy || isDeleting}
                                            title="Delete connection"
                                          >
                                            {isDeleting ? (
                                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            ) : (
                                              <Trash2 className="h-3.5 w-3.5" />
                                            )}
                                          </Button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5 p-3">
                            {group.connections.map((connection) => {
                              const isBusy = busyAction === connection.id;
                              const isDeleting = busyAction === `delete-${connection.id}`;
                              const lastUsedLabel = connection.lastConnectedAt
                                ? formatTimestamp(connection.lastConnectedAt)
                                : "Never used";

                              return (
                                <div
                                  key={connection.id}
                                  className={cn(
                                    "rounded-xl border border-border bg-background/80 px-3 py-2.5 shadow-sm transition",
                                    connection.connected && "border-emerald-500/25 bg-emerald-500/5",
                                  )}
                                  title={`${connection.connected ? "Connected" : "Saved profile"} · ${lastUsedLabel}`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={cn(
                                        "h-2 w-2 shrink-0 rounded-full",
                                        connection.connected ? "bg-emerald-500" : "bg-muted-foreground/30",
                                      )}
                                    />
                                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                                      {connection.name}
                                    </p>
                                    <div className="flex shrink-0 items-center gap-1">
                                      {connection.connected ? (
                                        <Button
                                          variant="outline"
                                          size="icon"
                                          className="h-6 w-6"
                                          onClick={() => setBrowserConnectionId(connection.id)}
                                          disabled={isBusy || isDeleting}
                                          title="Open browser"
                                        >
                                          <Eye className="h-3.5 w-3.5" />
                                        </Button>
                                      ) : null}
                                      <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-6 w-6"
                                        onClick={() => openEditDialog(connection)}
                                        disabled={isBusy || isDeleting}
                                        title="Edit connection"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        variant="outline"
                                        size="icon"
                                        className="h-6 w-6 text-rose-600 hover:text-rose-600"
                                        onClick={() => void handleDelete(connection)}
                                        disabled={isBusy || isDeleting}
                                        title="Delete connection"
                                      >
                                        {isDeleting ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <Trash2 className="h-3.5 w-3.5" />
                                        )}
                                      </Button>
                                    </div>
                                  </div>

                                  <div className="mt-2 flex items-center justify-between gap-2">
                                    <p className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                                      db{connection.db} · {connection.connType}
                                    </p>
                                    <Button
                                      size="sm"
                                      variant={connection.connected ? "outline" : "default"}
                                      className={cn(
                                        "h-6 shrink-0 px-2 text-[10px]",
                                        connection.connected && "text-amber-600 hover:text-amber-600",
                                      )}
                                      onClick={() => void handleConnectToggle(connection)}
                                      disabled={isBusy || isDeleting}
                                    >
                                      {isBusy ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : connection.connected ? (
                                        <PlugZap className="h-3.5 w-3.5" />
                                      ) : (
                                        <Plug className="h-3.5 w-3.5" />
                                      )}
                                      {connection.connected ? "Disconnect" : "Connect"}
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      <RedisConnectionDialog
        open={dialogOpen}
        mode={dialogMode}
        draft={draft}
        existingTags={availableTags}
        testing={dialogTesting}
        saving={dialogSaving}
        saveIntent={dialogSaveIntent}
        testFeedback={dialogTestFeedback}
        onChange={setDraft}
        onClose={closeDialog}
        onTest={() => void handleDialogTest()}
        onSave={(options) => void handleDialogSave(options)}
      />

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent
          className="max-w-3xl rounded-3xl border border-border bg-card p-0 shadow-2xl"
          onClose={() => setExportOpen(false)}
        >
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>Export Redis Connections</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Copy this JSON and import it into another workspace when needed.
            </p>
          </DialogHeader>
          <div className="px-6 py-5">
            <textarea
              value={exportJson}
              readOnly
              className="h-[360px] w-full rounded-2xl border border-border bg-muted/20 p-4 font-mono text-xs text-foreground outline-none"
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
            <p className="text-sm text-muted-foreground">
              {connections.length} connection{connections.length !== 1 ? "s" : ""} ready to copy
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setExportOpen(false)}>
                Close
              </Button>
              <Button onClick={() => void handleCopyExport()}>
                {exportCopied ? "Copied" : "Copy JSON"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) {
            importTestRunIdRef.current += 1;
            closeImportEditDialog();
          }
        }}
      >
        <DialogContent
          className="max-w-4xl rounded-3xl border border-border bg-card p-0 shadow-2xl"
          onClose={() => {
            importTestRunIdRef.current += 1;
            closeImportEditDialog();
            setImportOpen(false);
          }}
        >
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>Import Redis Connections</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Paste JSON and Penguin will auto-test new connections before you import them.
            </p>
          </DialogHeader>

          <div className="max-h-[75vh] overflow-y-auto px-6 py-5">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">Import JSON</span>
              <textarea
                value={importText}
                onChange={(event) => handleImportTextChange(event.target.value)}
                placeholder="Paste exported Redis connection JSON here"
                className="h-44 w-full rounded-2xl border border-border bg-muted/20 p-4 font-mono text-xs text-foreground outline-none"
              />
            </label>

            {importFeedback ? (
              <div className={cn("mt-4 rounded-2xl border px-4 py-3 text-sm", noticeClasses(importFeedback.tone))}>
                {importFeedback.message}
              </div>
            ) : null}

            {(importDuplicates > 0 || importInvalid > 0) && (
              <div className="mt-4 flex flex-wrap gap-2">
                {importDuplicates > 0 ? (
                  <Badge variant="outline" className="px-2 py-1">
                    Skipped existing / duplicate: {importDuplicates}
                  </Badge>
                ) : null}
                {importInvalid > 0 ? (
                  <Badge variant="outline" className="px-2 py-1">
                    Invalid entries: {importInvalid}
                  </Badge>
                ) : null}
              </div>
            )}

            {importCandidates.length > 0 ? (
              <div className="mt-5 rounded-2xl border border-border">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">New Connections</p>
                    <p className="text-xs text-muted-foreground">
                      Auto-tested after paste. Edit only when needed.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setSelectedImportIds((current) =>
                        current.length === importCandidates.length
                          ? []
                          : importCandidates.map((candidate) => candidate.id),
                      )
                    }
                  >
                    {allImportCandidatesSelected ? "Deselect All" : "Select All"}
                  </Button>
                </div>

                <div className="space-y-4 p-4">
                  {importStatusSections
                    .filter((section) => section.candidates.length > 0)
                    .map((section) => (
                      <section key={section.key} className={cn("space-y-3 rounded-2xl border p-4", section.borderClassName)}>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className={cn("text-sm font-semibold", section.titleClassName)}>{section.title}</p>
                            <p className="text-xs text-muted-foreground">{section.description}</p>
                          </div>
                          <span className={cn("text-xs", section.countClassName)}>
                            {section.candidates.length} connection{section.candidates.length !== 1 ? "s" : ""}
                          </span>
                        </div>

                        <div className="space-y-4">
                          {groupImportCandidatesByTag(section.candidates).map((group) => (
                            <div key={`${section.key}-${group.key}`} className="space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                {group.key === UNGROUPED_TAG ? (
                                  <span className="text-sm font-medium text-muted-foreground">{group.label}</span>
                                ) : (
                                  <Badge
                                    variant="outline"
                                    className={cn("px-2 py-0.5 uppercase", getTagColorClasses(group.label))}
                                  >
                                    {group.label}
                                  </Badge>
                                )}
                                <span className="text-xs text-muted-foreground">
                                  {group.candidates.length} item{group.candidates.length !== 1 ? "s" : ""}
                                </span>
                              </div>

                              <div className="overflow-hidden rounded-2xl border border-border/70">
                                <table className="min-w-full table-fixed text-sm">
                                  <colgroup>
                                    <col className="w-[42px]" />
                                    <col />
                                    <col className="w-[108px]" />
                                    <col className="w-[42px]" />
                                    <col className="w-[42px]" />
                                  </colgroup>
                                  <thead className="bg-background/70">
                                    <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                      <th className="px-3 py-2.5 font-medium" />
                                      <th className="px-3 py-2.5 font-medium">Redis</th>
                                      <th className="px-3 py-2.5 font-medium text-right">Test</th>
                                      <th className="px-3 py-2.5 font-medium" />
                                      <th className="px-3 py-2.5 font-medium" />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {group.candidates.map((candidate) => {
                                      const isTesting = importTestingIds.includes(candidate.id);

                                      return (
                                        <tr
                                          key={candidate.id}
                                          className={cn("border-t border-border/70", section.rowClassName)}
                                        >
                                          <td className="px-3 py-2">
                                            <input
                                              type="checkbox"
                                              checked={selectedImportIds.includes(candidate.id)}
                                              onChange={(event) => {
                                                setSelectedImportIds((current) =>
                                                  event.target.checked
                                                    ? [...current, candidate.id]
                                                    : current.filter((item) => item !== candidate.id),
                                                );
                                              }}
                                              className="h-4 w-4 rounded border-border"
                                            />
                                          </td>
                                          <td
                                            className="px-3 py-2 text-sm font-medium text-foreground"
                                            title={`${candidate.draft.name} · ${candidate.draft.host}:${candidate.draft.port}`}
                                          >
                                            <span className="block truncate">{candidate.draft.name}</span>
                                          </td>
                                          <td className="px-3 py-2">
                                            <div className="flex justify-end">
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 px-2 text-[11px]"
                                                onClick={() => void handleTestImportCandidate(candidate)}
                                                disabled={importing || isTesting}
                                              >
                                                {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                                                {isTesting ? "Testing..." : "Test"}
                                              </Button>
                                            </div>
                                          </td>
                                          <td className="px-3 py-2">
                                            <div className="flex justify-end">
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7"
                                                onClick={() => openImportEditDialog(candidate)}
                                                disabled={importing || isTesting}
                                                title="Edit connection"
                                              >
                                                <Pencil className="h-4 w-4" />
                                              </Button>
                                            </div>
                                          </td>
                                          <td className="px-3 py-2">
                                            <div className="flex justify-end">
                                              <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-7 w-7 text-muted-foreground hover:text-rose-500"
                                                onClick={() => removeImportCandidate(candidate.id)}
                                                disabled={importing}
                                                title="Remove from import"
                                              >
                                                <Trash2 className="h-4 w-4" />
                                              </Button>
                                            </div>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4">
            <p className="text-sm text-muted-foreground">{selectedImportIds.length} selected</p>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleImportSelected()}
                disabled={importing || selectedImportIds.length === 0}
              >
                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {importing ? "Importing..." : "Add Selected"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <RedisConnectionDialog
        open={importEditingCandidateId !== null}
        mode="edit"
        draft={importEditDraft}
        existingTags={availableTags}
        testing={importEditTesting}
        saving={false}
        saveIntent="save"
        testFeedback={importEditFeedback}
        onChange={setImportEditDraft}
        onClose={closeImportEditDialog}
        onTest={() => void handleTestImportEditDialog()}
        onSave={() => handleSaveImportEditDialog()}
      />

      {shortcutsOpen ? (
        <Suspense fallback={null}>
          <ShortcutCheatSheet
            open={shortcutsOpen}
            onClose={() => setShortcutsOpen(false)}
            title="Redis Shortcuts"
            shortcuts={REDIS_SHORTCUTS}
          />
        </Suspense>
      ) : null}
    </>
  );
}
