import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Database,
  Folder,
  FolderOpen,
  Loader2,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Save,
  Search,
  Table2,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import {
  addMongoConnection,
  connectMongoConnection,
  countMongoDocuments,
  deleteMongoDocuments,
  deleteMongoConnection,
  disconnectMongoConnection,
  findMongoDocuments,
  getMongoDocument,
  insertMongoDocument,
  listMongoCollections,
  listMongoConnections,
  listMongoDatabases,
  testMongoConnection,
  updateMongoDocument,
  updateMongoConnection,
  type MongoCollectionInfo,
  type MongoConnectionDraft,
  type MongoConnectionRecord,
  type MongoDatabaseInfo,
  type MongoFindOptions,
} from "@/lib/mongo";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type NoticeTone = "info" | "success" | "error";
type DialogMode = "create" | "edit";
type DocumentViewMode = "cards" | "table" | "json";
type MongoWriteMode = "view" | "edit";
type DocumentDialogMode = "create" | "edit";
type MongoPathSegment = string | number;
type MongoPath = MongoPathSegment[];
type MongoInlineEditMode = "key" | "value";
type MongoInlineValueType = "string" | "number" | "boolean" | "object" | "array" | "null" | "objectId" | "date";
type MongoSortDirection = 1 | -1;

interface NoticeState {
  tone: NoticeTone;
  message: string;
}

interface MongoDatabaseNode {
  info: MongoDatabaseInfo;
  expanded: boolean;
  loadingCollections: boolean;
  collectionsLoaded: boolean;
  collections: MongoCollectionInfo[];
}

interface MongoPendingCollectionSelection {
  connectionId: string;
  database: string;
  collection: string;
}

interface MongoCollectionTab {
  key: string;
  label: string;
  database: string;
  collection: string;
}

interface MongoInlineEditState {
  path: MongoPath;
  mode: MongoInlineEditMode;
  draft: string;
  valueType?: MongoInlineValueType;
}

interface MongoSortFieldSelection {
  field: string;
  direction: MongoSortDirection;
}

interface MongoConnectionDialogProps {
  open: boolean;
  mode: DialogMode;
  draft: MongoConnectionDraft;
  existingTags: string[];
  testing: boolean;
  saving: boolean;
  saveIntent: "save" | "connect";
  testFeedback: NoticeState | null;
  onChange: (draft: MongoConnectionDraft) => void;
  onClose: () => void;
  onTest: () => void;
  onSave: (options?: { connectAfterSave?: boolean }) => void;
}

interface MongoDocumentDialogProps {
  open: boolean;
  mode: DocumentDialogMode;
  busy: boolean;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}

const UNGROUPED_TAG = "__ungrouped__";
const VIEW_MODE_MESSAGE = "MongoDB is in view mode. Switch to Edit Mode to make changes.";
const DEFAULT_MONGO_LIMIT = "20";
const MONGO_TREE_COLUMN_WIDTH = "136px";
const MONGO_NESTED_COLUMN_WIDTH = "132px";
const MONGO_INLINE_VALUE_TYPE_OPTIONS: Array<{ value: MongoInlineValueType; label: string }> = [
  { value: "string", label: "String" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "object", label: "Object" },
  { value: "array", label: "Array" },
  { value: "null", label: "Null" },
  { value: "objectId", label: "ObjectId" },
  { value: "date", label: "Date" },
];
const TAG_SWATCHES = [
  "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300",
  "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
  "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-300",
];

const TAG_SECTION_BORDER_SWATCHES = [
  "border-emerald-500/35",
  "border-sky-500/35",
  "border-violet-500/35",
  "border-amber-500/35",
  "border-rose-500/35",
  "border-cyan-500/35",
];

const TAG_SECTION_SURFACE_SWATCHES = [
  "bg-emerald-500/[0.04]",
  "bg-sky-500/[0.04]",
  "bg-violet-500/[0.04]",
  "bg-amber-500/[0.04]",
  "bg-rose-500/[0.04]",
  "bg-cyan-500/[0.04]",
];

const TAG_SECTION_HEADER_SWATCHES = [
  "bg-emerald-500/[0.08]",
  "bg-sky-500/[0.08]",
  "bg-violet-500/[0.08]",
  "bg-amber-500/[0.08]",
  "bg-rose-500/[0.08]",
  "bg-cyan-500/[0.08]",
];

function getTagSwatchIndex(tag: string) {
  return [...tag].reduce((total, item) => total + item.charCodeAt(0), 0) % TAG_SWATCHES.length;
}

function getTagClasses(tag: string) {
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

const DATABASE_SWATCHES = [
  {
    accent: "text-emerald-600 dark:text-emerald-300",
    surfaceActive: "bg-emerald-500/10",
    rowActiveBorder: "border-emerald-500/35",
    dot: "bg-emerald-500",
    rail: "border-emerald-500/30",
  },
  {
    accent: "text-sky-600 dark:text-sky-300",
    surfaceActive: "bg-sky-500/10",
    rowActiveBorder: "border-sky-500/35",
    dot: "bg-sky-500",
    rail: "border-sky-500/30",
  },
  {
    accent: "text-violet-600 dark:text-violet-300",
    surfaceActive: "bg-violet-500/10",
    rowActiveBorder: "border-violet-500/35",
    dot: "bg-violet-500",
    rail: "border-violet-500/30",
  },
  {
    accent: "text-amber-600 dark:text-amber-300",
    surfaceActive: "bg-amber-500/10",
    rowActiveBorder: "border-amber-500/35",
    dot: "bg-amber-500",
    rail: "border-amber-500/30",
  },
  {
    accent: "text-rose-600 dark:text-rose-300",
    surfaceActive: "bg-rose-500/10",
    rowActiveBorder: "border-rose-500/35",
    dot: "bg-rose-500",
    rail: "border-rose-500/30",
  },
  {
    accent: "text-cyan-600 dark:text-cyan-300",
    surfaceActive: "bg-cyan-500/10",
    rowActiveBorder: "border-cyan-500/35",
    dot: "bg-cyan-500",
    rail: "border-cyan-500/30",
  },
];

const DEFAULT_MONGO_TREE_CLASSES = DATABASE_SWATCHES[0];

function getMongoTreeClasses(index: number) {
  return DATABASE_SWATCHES[index % DATABASE_SWATCHES.length];
}

function noticeClasses(tone: NoticeTone) {
  if (tone === "success") {
    return "border-emerald-500/30 bg-card text-foreground shadow-emerald-500/10";
  }
  if (tone === "error") {
    return "border-rose-500/30 bg-card text-foreground shadow-rose-500/10";
  }
  return "border-sky-500/30 bg-card text-foreground shadow-sky-500/10";
}

function createEmptyDraft(): MongoConnectionDraft {
  return {
    name: "",
    uri: "mongodb://localhost:27017",
    tag: "",
  };
}

function recordToDraft(record: MongoConnectionRecord): MongoConnectionDraft {
  return {
    name: record.name,
    uri: record.uri,
    tag: record.tag ?? "",
  };
}

function normalizeDraft(draft: MongoConnectionDraft): MongoConnectionDraft {
  return {
    name: draft.name.trim(),
    uri: draft.uri.trim(),
    tag: draft.tag?.trim() || "",
  };
}

function parseMongoHost(uri: string) {
  try {
    const stripped = uri.replace(/^mongodb(\+srv)?:\/\//, "");
    const withoutAuth = stripped.includes("@") ? stripped.split("@")[1] : stripped;
    return withoutAuth.split("/")[0].split("?")[0];
  } catch {
    return uri;
  }
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

function groupConnectionsByTag(connections: MongoConnectionRecord[]) {
  const groups = new Map<string, MongoConnectionRecord[]>();

  connections.forEach((connection) => {
    const key = connection.tag?.trim() || UNGROUPED_TAG;
    const existing = groups.get(key) ?? [];
    existing.push(connection);
    groups.set(key, existing);
  });

  return Array.from(groups.entries())
    .map(([key, items]) => ({
      key,
      label: key === UNGROUPED_TAG ? "Ungrouped" : key,
      connections: items.sort((left, right) => left.name.localeCompare(right.name)),
    }))
    .sort((left, right) => {
      if (left.key === UNGROUPED_TAG) return 1;
      if (right.key === UNGROUPED_TAG) return -1;
      return left.label.localeCompare(right.label);
    });
}

function compactMongoValue(value: unknown) {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.length}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("$oid" in record && typeof record.$oid === "string") {
      return record.$oid;
    }
    if ("$date" in record) {
      const raw = record.$date;
      if (typeof raw === "string") {
        return raw;
      }
      if (raw && typeof raw === "object" && "$numberLong" in raw) {
        return new Date(Number((raw as { $numberLong: string }).$numberLong)).toISOString();
      }
    }

    const keys = Object.keys(record);
    return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""}}`;
  }
  return String(value);
}

function orderMongoFieldNames(values: Iterable<string>) {
  return Array.from(new Set(values)).sort((left, right) => {
    if (left === "_id") return -1;
    if (right === "_id") return 1;
    return left.localeCompare(right);
  });
}

function deriveDocumentColumns(documents: Array<Record<string, unknown>>) {
  const keys = new Set<string>();
  documents.forEach((document) => {
    Object.keys(document).forEach((key) => keys.add(key));
  });

  return orderMongoFieldNames(keys);
}

function buildMongoProjectionInput(selectedFields: string[], manualInput: string) {
  const fieldEntries = selectedFields.map((field) => `${field}: 1`);
  const manual = normalizeMongoQueryText(manualInput).trim();
  return [...fieldEntries, ...(manual ? [manual] : [])].join(", ");
}

function buildMongoSortInput(selectedFields: MongoSortFieldSelection[], manualInput: string) {
  const fieldEntries = selectedFields.map(({ field, direction }) => `${field}: ${direction}`);
  const manual = normalizeMongoQueryText(manualInput).trim();
  return [...fieldEntries, ...(manual ? [manual] : [])].join(", ");
}

function appendMongoManualToken(current: string, token: string) {
  const normalizedCurrent = normalizeMongoQueryText(current).trim().replace(/,\s*$/, "");
  const normalizedToken = normalizeMongoQueryText(token).trim().replace(/,\s*$/, "");

  if (!normalizedToken) {
    return normalizedCurrent;
  }

  if (!normalizedCurrent) {
    return normalizedToken;
  }

  return `${normalizedCurrent}, ${normalizedToken}`;
}

function splitMongoManualTokens(value: string) {
  return normalizeMongoQueryText(value)
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
}

function buildProjectionManualToken(value: string) {
  const normalized = normalizeMongoQueryText(value).trim();
  if (!normalized) {
    return "";
  }

  return normalized.includes(":") ? normalized : `${normalized}: 1`;
}

function buildSortManualToken(value: string) {
  const normalized = normalizeMongoQueryText(value).trim();
  if (!normalized) {
    return "";
  }

  return normalized.includes(":") ? normalized : `${normalized}: 1`;
}

function shouldTreatMongoTokenAsManual(value: string) {
  const normalized = normalizeMongoQueryText(value).trim();
  return normalized.includes(":");
}

function fuzzyMatchMongoLabel(value: string | null | undefined, query: string) {
  if (!value) {
    return false;
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const normalizedValue = value.toLowerCase();
  if (normalizedValue.includes(normalizedQuery)) {
    return true;
  }

  let searchIndex = 0;
  for (const character of normalizedQuery) {
    searchIndex = normalizedValue.indexOf(character, searchIndex);
    if (searchIndex === -1) {
      return false;
    }
    searchIndex += 1;
  }

  return true;
}

function getMongoDocumentId(document: Record<string, unknown> | null) {
  if (!document || !("_id" in document)) {
    return null;
  }

  return document._id;
}

function getMongoDocumentIdLabel(document: Record<string, unknown> | null) {
  const id = getMongoDocumentId(document);
  if (id == null) {
    return "Unknown _id";
  }

  if (typeof id === "string" || typeof id === "number" || typeof id === "boolean") {
    return String(id);
  }

  if (typeof id === "object" && id && "$oid" in (id as Record<string, unknown>)) {
    const raw = (id as { $oid?: unknown }).$oid;
    if (typeof raw === "string") {
      return raw;
    }
  }

  try {
    return JSON.stringify(id);
  } catch {
    return "Unknown _id";
  }
}

function serializeMongoDocumentId(documentId: unknown) {
  if (documentId == null) return null;
  if (typeof documentId === "string" || typeof documentId === "number" || typeof documentId === "boolean") {
    return String(documentId);
  }

  try {
    return JSON.stringify(documentId);
  } catch {
    return null;
  }
}

function getMongoDocumentCacheKey(document: Record<string, unknown> | null) {
  return serializeMongoDocumentId(getMongoDocumentId(document));
}

function cloneMongoDocument<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isMongoPathEqual(left: MongoPath, right: MongoPath) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((segment, index) => segment === right[index]);
}

function getMongoValueAtPath(root: unknown, path: MongoPath): unknown {
  return path.reduce<unknown>((current, segment) => {
    if (current == null) {
      return undefined;
    }

    if (Array.isArray(current)) {
      return current[Number(segment)];
    }

    if (typeof current === "object") {
      return (current as Record<string, unknown>)[String(segment)];
    }

    return undefined;
  }, root);
}

function updateMongoValueAtPath(root: unknown, path: MongoPath, updater: (value: unknown) => unknown): unknown {
  if (path.length === 0) {
    return updater(root);
  }

  const [head, ...tail] = path;

  if (Array.isArray(root)) {
    const index = Number(head);
    const next = [...root];
    next[index] = updateMongoValueAtPath(next[index], tail, updater);
    return next;
  }

  const record = { ...(root as Record<string, unknown>) };
  const key = String(head);
  record[key] = updateMongoValueAtPath(record[key], tail, updater);
  return record;
}

function renameMongoRecordKey(record: Record<string, unknown>, currentKey: string, nextKey: string) {
  if (currentKey === nextKey) {
    return { ...record };
  }

  if (Object.prototype.hasOwnProperty.call(record, nextKey)) {
    throw new Error(`Field "${nextKey}" already exists.`);
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => (key === currentKey ? [nextKey, value] : [key, value])),
  );
}

function setMongoValueAtPath(root: Record<string, unknown>, path: MongoPath, nextValue: unknown) {
  return updateMongoValueAtPath(root, path, () => nextValue) as Record<string, unknown>;
}

function renameMongoPathKey(root: Record<string, unknown>, path: MongoPath, nextKey: string) {
  const trimmedKey = nextKey.trim();
  if (!trimmedKey) {
    throw new Error("Field name is required.");
  }

  const currentKey = path[path.length - 1];
  if (typeof currentKey !== "string") {
    throw new Error("Array indexes cannot be renamed.");
  }

  if (currentKey === "_id") {
    throw new Error("_id cannot be renamed.");
  }

  const parentPath = path.slice(0, -1);
  const nextRoot = updateMongoValueAtPath(root, parentPath, (parent) => {
    if (!parent || Array.isArray(parent) || typeof parent !== "object") {
      throw new Error("This field cannot be renamed.");
    }

    return renameMongoRecordKey(parent as Record<string, unknown>, currentKey, trimmedKey);
  });

  return nextRoot as Record<string, unknown>;
}

function formatMongoInlineValue(value: unknown) {
  const type = getMongoValueType(value);

  if (type === "string") {
    return String(value ?? "");
  }

  if (type === "number" || type === "boolean") {
    return String(value);
  }

  if (type === "objectId") {
    return String((value as { $oid: string }).$oid ?? "");
  }

  if (type === "date") {
    const raw = (value as { $date: string | { $numberLong: string } }).$date;
    return typeof raw === "string" ? raw : new Date(Number(raw.$numberLong)).toISOString();
  }

  if (value === undefined) {
    return "";
  }

  return JSON.stringify(value);
}

function getMongoInlineValueType(value: unknown): MongoInlineValueType {
  const type = getMongoValueType(value);
  if (
    type === "string" ||
    type === "number" ||
    type === "boolean" ||
    type === "object" ||
    type === "array" ||
    type === "null" ||
    type === "objectId" ||
    type === "date"
  ) {
    return type;
  }

  return "string";
}

function parseMongoInlineValue(draft: string, valueType: MongoInlineValueType) {
  const trimmed = draft.trim();

  if (valueType === "string") {
    return draft;
  }

  if (valueType === "number") {
    const parsed = Number(trimmed);
    if (!trimmed || Number.isNaN(parsed)) {
      throw new Error("Enter a valid number.");
    }
    return parsed;
  }

  if (valueType === "boolean") {
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    throw new Error('Enter "true" or "false".');
  }

  if (valueType === "objectId") {
    if (!trimmed) {
      throw new Error("ObjectId is required.");
    }
    return { $oid: trimmed };
  }

  if (valueType === "date") {
    if (!trimmed) {
      throw new Error("Date is required.");
    }
    return { $date: trimmed };
  }

  if (valueType === "array" || valueType === "object") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (error) {
      throw new Error(error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON.");
    }

    if (valueType === "array" && !Array.isArray(parsed)) {
      throw new Error("Value must be a JSON array.");
    }

    if (valueType === "object" && (!parsed || Array.isArray(parsed) || typeof parsed !== "object")) {
      throw new Error("Value must be a JSON object.");
    }

    return parsed;
  }

  if (valueType === "null") {
    if (trimmed === "null") {
      return null;
    }

    try {
      return JSON.parse(draft);
    } catch (error) {
      throw new Error(error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON.");
    }
  }

  return draft;
}

function getMongoCollectionTabKey(connectionId: string, database: string, collection: string) {
  return `${connectionId}:${database}.${collection}`;
}

function getMongoValueType(value: unknown) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("$oid" in record) return "objectId";
    if ("$date" in record) return "date";
    return "object";
  }
  return typeof value;
}

function formatMongoLeafValue(value: unknown) {
  const type = getMongoValueType(value);
  if (type === "objectId") {
    return String((value as { $oid: string }).$oid);
  }
  if (type === "date") {
    const raw = (value as { $date: string | { $numberLong: string } }).$date;
    const parsed = typeof raw === "string" ? raw : new Date(Number(raw.$numberLong)).toISOString();
    return parsed;
  }
  if (type === "array") {
    return `[${(value as unknown[]).length}]`;
  }
  if (type === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    return `{${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""}}`;
  }
  if (type === "string") {
    return String(value);
  }
  if (type === "number" || type === "boolean") {
    return String(value);
  }
  return type;
}

function normalizeMongoQueryText(value: string) {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/：/g, ":")
    .replace(/，/g, ",")
    .replace(/｛/g, "{")
    .replace(/｝/g, "}");
}

function formatMongoWorkspaceError(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = rawMessage
    .replace(/^Find failed:\s*/i, "")
    .replace(/^Count failed:\s*/i, "")
    .replace(/^Cursor error:\s*/i, "");

  if (/MaxTimeMSExpired|operation exceeded time limit/i.test(message)) {
    return "Query exceeded Max Time MS. Increase Max Time MS or narrow the filter.";
  }

  if (/Invalid JSON:/i.test(message)) {
    return message.replace(/^Invalid JSON:\s*/i, "Invalid query syntax: ");
  }

  if (/Invalid collation:/i.test(message)) {
    return message.replace(/^Invalid collation:\s*/i, "Invalid collation: ");
  }

  if (/Index hint cannot be empty/i.test(message)) {
    return "Index Hint cannot be empty.";
  }

  if (/Expected a JSON object/i.test(message)) {
    return "Query input must be an object.";
  }

  return message
    .replace(/, labels: \{.*$/i, "")
    .replace(/, source: .*$/i, "")
    .replace(/, server response: .*$/i, "")
    .replace(/^Kind:\s*/i, "");
}

function isMongoMaxTimeError(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  return /MaxTimeMSExpired|operation exceeded time limit/i.test(rawMessage);
}

function getMongoTypeColor(type: string) {
  if (type === "string") return "text-emerald-500 dark:text-emerald-300";
  if (type === "number") return "text-sky-500 dark:text-sky-300";
  if (type === "boolean") return "text-amber-500 dark:text-amber-300";
  if (type === "objectId") return "text-violet-500 dark:text-violet-300";
  if (type === "date") return "text-cyan-500 dark:text-cyan-300";
  return "text-muted-foreground";
}

function getMongoStructurePreview(value: unknown) {
  const type = getMongoValueType(value);

  const compactLeaf = (item: unknown) => {
    const itemType = getMongoValueType(item);
    const raw = formatMongoLeafValue(item);

    if (itemType === "string" || itemType === "objectId") {
      return raw.length > 14 ? `${raw.slice(0, 14)}…` : raw;
    }

    if (itemType === "object") return "{…}";
    if (itemType === "array") return "[…]";
    return raw;
  };

  if (type === "array") {
    const items = value as unknown[];
    return items
      .slice(0, 3)
      .map((item) => compactLeaf(item))
      .join(", ")
      .concat(items.length > 3 ? ", …" : "");
  }

  if (type === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries
      .slice(0, 3)
      .map(([key]) => key)
      .join(", ")
      .concat(entries.length > 3 ? ", …" : "");
  }

  return compactLeaf(value);
}

function getMongoPreviewEntries(document: Record<string, unknown>) {
  return Object.entries(document)
    .filter(([field]) => field !== "_id");
}

function formatMongoSummaryValue(value: unknown) {
  const type = getMongoValueType(value);

  if (type === "string") {
    return `"${formatMongoLeafValue(value)}"`;
  }

  if (type === "array") {
    const items = value as unknown[];
    const preview = getMongoStructurePreview(value);
    return `Array [${items.length}]${preview ? ` · ${preview}` : ""}`;
  }

  if (type === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    const preview = getMongoStructurePreview(value);
    return `Object {${keys.length}}${preview ? ` · ${preview}` : ""}`;
  }

  if (type === "objectId") {
    return formatMongoLeafValue(value);
  }

  return formatMongoLeafValue(value);
}

function MongoSummaryRow({
  field,
  value,
}: {
  field: string;
  value: unknown;
}) {
  const type = getMongoValueType(value);
  const typeColor = getMongoTypeColor(type);

  return (
    <div
      className="grid border-b border-border/20 text-[9px] last:border-b-0"
      style={{ gridTemplateColumns: `${MONGO_TREE_COLUMN_WIDTH} minmax(0,1fr)` }}
    >
      <div className="min-w-0 overflow-hidden bg-muted/[0.06] px-2 py-1 font-semibold leading-4 text-sky-500 dark:text-sky-300">
        <span className="block min-w-0 truncate" title={field}>
          {field}
        </span>
      </div>
      <div className="flex min-w-0 items-center px-2 py-1 font-mono leading-4">
        <span className={cn("block min-w-0 break-all", typeColor)} title={formatMongoLeafValue(value)}>
          {formatMongoSummaryValue(value)}
        </span>
      </div>
    </div>
  );
}

function MongoInlineCellEditor({
  value,
  onChange,
  onCommit,
  onCancel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  className?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
      <Input
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onCommit();
          }

          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
        className={cn("h-6 border-border/60 bg-background px-2 font-mono text-[10px]", className)}
      />
    </div>
  );
}

function MongoInlineTypeSelect({
  value,
  disabled,
  onChange,
}: {
  value: MongoInlineValueType;
  disabled?: boolean;
  onChange: (value: MongoInlineValueType) => void;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onChange={(event) => onChange(event.target.value as MongoInlineValueType)}
      className="h-5 w-[92px] rounded border border-border/60 bg-background px-1 text-[9px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
    >
      {MONGO_INLINE_VALUE_TYPE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function MongoValueTypeSlot({
  children,
  valueType,
  disabled,
  onChange,
}: {
  children: ReactNode;
  valueType: MongoInlineValueType;
  disabled?: boolean;
  onChange: (value: MongoInlineValueType) => void;
}) {
  return (
    <div className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_92px] items-start gap-1">
      <div className="min-w-0">{children}</div>
      <div className="flex justify-end">
        <MongoInlineTypeSelect value={valueType} disabled={disabled} onChange={onChange} />
      </div>
    </div>
  );
}

function MongoNestedValueRow({
  field,
  value,
  path,
  depth = 0,
  editable,
  inlineEdit,
  onStartEdit,
  onSelectValueType,
  onEditDraftChange,
  onCommitEdit,
  onCancelEdit,
}: {
  field: string;
  value: unknown;
  path: MongoPath;
  depth?: number;
  editable: boolean;
  inlineEdit: MongoInlineEditState | null;
  onStartEdit: (path: MongoPath, mode: MongoInlineEditMode) => void;
  onSelectValueType: (path: MongoPath, valueType: MongoInlineValueType) => void;
  onEditDraftChange: (value?: string, valueType?: MongoInlineValueType) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
}) {
  const type = getMongoValueType(value);
  const typeColor = getMongoTypeColor(type);
  const [expanded, setExpanded] = useState(false);
  const offset = depth * 12;
  const canEditKey = editable && typeof path[path.length - 1] === "string" && path[path.length - 1] !== "_id";
  const canEditValue = editable && String(path[path.length - 1]) !== "_id";
  const isEditingKey = inlineEdit?.mode === "key" && isMongoPathEqual(inlineEdit.path, path);
  const isEditingValue = inlineEdit?.mode === "value" && isMongoPathEqual(inlineEdit.path, path);
  const currentValueType = isEditingValue ? inlineEdit.valueType ?? getMongoInlineValueType(value) : getMongoInlineValueType(value);

  if (type === "array") {
    const items = value as unknown[];
    const preview = getMongoStructurePreview(value);

    return (
      <div className="border-b border-border/10 last:border-b-0">
        <div
          className="grid w-full text-left text-[9px]"
          style={{ gridTemplateColumns: `${MONGO_NESTED_COLUMN_WIDTH} minmax(0,1fr)` }}
        >
          <div
            className="min-w-0 overflow-hidden bg-muted/[0.05] px-2 py-1"
            onClick={() => setExpanded((current) => !current)}
          >
            <span className="flex min-w-0 items-start gap-1" style={{ paddingLeft: `${8 + offset}px` }}>
              {expanded ? (
                <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              {isEditingKey ? (
                <MongoInlineCellEditor value={inlineEdit.draft} onChange={onEditDraftChange} onCommit={onCommitEdit} onCancel={onCancelEdit} />
              ) : (
                <span
                  className="block min-w-0 break-all font-semibold leading-4 text-sky-500 dark:text-sky-300"
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (canEditKey) {
                      onStartEdit(path, "key");
                    }
                  }}
                >
                  {field}
                </span>
              )}
            </span>
          </div>
          <div className="min-w-0 px-2 py-1" onClick={() => setExpanded((current) => !current)}>
            {isEditingValue ? (
              <MongoValueTypeSlot valueType={currentValueType} onChange={(nextType) => onSelectValueType(path, nextType)}>
                <MongoInlineCellEditor
                  value={inlineEdit.draft}
                  onChange={onEditDraftChange}
                  onCommit={onCommitEdit}
                  onCancel={onCancelEdit}
                  className="min-w-0 w-full"
                />
              </MongoValueTypeSlot>
            ) : (
              <MongoValueTypeSlot
                valueType={currentValueType}
                disabled={!canEditValue}
                onChange={(nextType) => onSelectValueType(path, nextType)}
              >
                <span
                  className={cn("block min-w-0 flex-1 break-all font-mono leading-4", typeColor)}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (canEditValue) {
                      onStartEdit(path, "value");
                    }
                  }}
                >
                  {`Array [${items.length}]${!expanded && preview ? ` · ${preview}` : ""}`}
                </span>
              </MongoValueTypeSlot>
            )}
          </div>
        </div>

        {expanded ? (
          <div className="bg-muted/[0.02]">
            {items.length === 0 ? (
              <div className="px-2 py-1 text-[9px] text-muted-foreground" style={{ paddingLeft: `${23 + offset}px` }}>
                Empty array
              </div>
            ) : (
              items.map((item, index) => (
                <MongoNestedValueRow
                  key={`${field}.${index}`}
                  field={String(index)}
                  value={item}
                  path={[...path, index]}
                  depth={depth + 1}
                  editable={editable}
                  inlineEdit={inlineEdit}
                  onStartEdit={onStartEdit}
                  onSelectValueType={onSelectValueType}
                  onEditDraftChange={onEditDraftChange}
                  onCommitEdit={onCommitEdit}
                  onCancelEdit={onCancelEdit}
                />
              ))
            )}
          </div>
        ) : null}
      </div>
    );
  }

  if (type === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const preview = getMongoStructurePreview(value);

    return (
      <div className="border-b border-border/10 last:border-b-0">
        <div
          className="grid w-full text-left text-[9px]"
          style={{ gridTemplateColumns: `${MONGO_NESTED_COLUMN_WIDTH} minmax(0,1fr)` }}
        >
          <div
            className="min-w-0 overflow-hidden bg-muted/[0.05] px-2 py-1"
            onClick={() => setExpanded((current) => !current)}
          >
            <span className="flex min-w-0 items-start gap-1" style={{ paddingLeft: `${8 + offset}px` }}>
              {expanded ? (
                <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              {isEditingKey ? (
                <MongoInlineCellEditor value={inlineEdit.draft} onChange={onEditDraftChange} onCommit={onCommitEdit} onCancel={onCancelEdit} />
              ) : (
                <span
                  className="block min-w-0 break-all font-semibold leading-4 text-sky-500 dark:text-sky-300"
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (canEditKey) {
                      onStartEdit(path, "key");
                    }
                  }}
                >
                  {field}
                </span>
              )}
            </span>
          </div>
          <div className="min-w-0 px-2 py-1" onClick={() => setExpanded((current) => !current)}>
            {isEditingValue ? (
              <MongoValueTypeSlot valueType={currentValueType} onChange={(nextType) => onSelectValueType(path, nextType)}>
                <MongoInlineCellEditor
                  value={inlineEdit.draft}
                  onChange={onEditDraftChange}
                  onCommit={onCommitEdit}
                  onCancel={onCancelEdit}
                  className="min-w-0 w-full"
                />
              </MongoValueTypeSlot>
            ) : (
              <MongoValueTypeSlot
                valueType={currentValueType}
                disabled={!canEditValue}
                onChange={(nextType) => onSelectValueType(path, nextType)}
              >
                <span
                  className={cn("block min-w-0 flex-1 break-all font-mono leading-4", typeColor)}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (canEditValue) {
                      onStartEdit(path, "value");
                    }
                  }}
                >
                  {`Object {${entries.length}}${!expanded && preview ? ` · ${preview}` : ""}`}
                </span>
              </MongoValueTypeSlot>
            )}
          </div>
        </div>

        {expanded ? (
          <div className="bg-muted/[0.02]">
            {entries.length === 0 ? (
              <div className="px-2 py-1 text-[9px] text-muted-foreground" style={{ paddingLeft: `${23 + offset}px` }}>
                Empty object
              </div>
            ) : (
              entries.map(([childField, childValue]) => (
                <MongoNestedValueRow
                  key={`${field}.${childField}`}
                  field={childField}
                  value={childValue}
                  path={[...path, childField]}
                  depth={depth + 1}
                  editable={editable}
                  inlineEdit={inlineEdit}
                  onStartEdit={onStartEdit}
                  onSelectValueType={onSelectValueType}
                  onEditDraftChange={onEditDraftChange}
                  onCommitEdit={onCommitEdit}
                  onCancelEdit={onCancelEdit}
                />
              ))
            )}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="grid border-b border-border/10 text-[9px] last:border-b-0"
      style={{ gridTemplateColumns: `${MONGO_NESTED_COLUMN_WIDTH} minmax(0,1fr)` }}
    >
      <div className="min-w-0 overflow-hidden bg-muted/[0.05] px-2 py-1">
        {isEditingKey ? (
          <div style={{ paddingLeft: `${23 + offset}px` }}>
            <MongoInlineCellEditor value={inlineEdit.draft} onChange={onEditDraftChange} onCommit={onCommitEdit} onCancel={onCancelEdit} />
          </div>
        ) : (
          <span
            className="block min-w-0 break-all font-semibold leading-4 text-sky-500 dark:text-sky-300"
            style={{ paddingLeft: `${23 + offset}px` }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (canEditKey) {
                onStartEdit(path, "key");
              }
            }}
          >
            {field}
          </span>
        )}
      </div>
      <div className="min-w-0 px-2 py-1">
        {isEditingValue ? (
          <MongoValueTypeSlot valueType={currentValueType} onChange={(nextType) => onSelectValueType(path, nextType)}>
            <MongoInlineCellEditor
              value={inlineEdit.draft}
              onChange={onEditDraftChange}
              onCommit={onCommitEdit}
              onCancel={onCancelEdit}
              className="min-w-0 w-full"
            />
          </MongoValueTypeSlot>
        ) : (
          <MongoValueTypeSlot
            valueType={currentValueType}
            disabled={!canEditValue}
            onChange={(nextType) => onSelectValueType(path, nextType)}
          >
            <span
              className={cn("block min-w-0 flex-1 break-all font-mono leading-4", typeColor)}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (canEditValue) {
                  onStartEdit(path, "value");
                }
              }}
            >
              {formatMongoSummaryValue(value)}
            </span>
          </MongoValueTypeSlot>
        )}
      </div>
    </div>
  );
}

function MongoTreeRow({
  field,
  value,
  path,
  depth = 0,
  editable,
  inlineEdit,
  onStartEdit,
  onSelectValueType,
  onEditDraftChange,
  onCommitEdit,
  onCancelEdit,
}: {
  field: string;
  value: unknown;
  path: MongoPath;
  depth?: number;
  editable: boolean;
  inlineEdit: MongoInlineEditState | null;
  onStartEdit: (path: MongoPath, mode: MongoInlineEditMode) => void;
  onSelectValueType: (path: MongoPath, valueType: MongoInlineValueType) => void;
  onEditDraftChange: (value?: string, valueType?: MongoInlineValueType) => void;
  onCommitEdit: () => void;
  onCancelEdit: () => void;
}) {
  const type = getMongoValueType(value);
  const typeColor = getMongoTypeColor(type);
  const [expanded, setExpanded] = useState(false);
  const indent = 8 + depth * 12;
  const canEditKey = editable && typeof path[path.length - 1] === "string" && path[path.length - 1] !== "_id";
  const canEditValue = editable && String(path[path.length - 1]) !== "_id";
  const isEditingKey = inlineEdit?.mode === "key" && isMongoPathEqual(inlineEdit.path, path);
  const isEditingValue = inlineEdit?.mode === "value" && isMongoPathEqual(inlineEdit.path, path);
  const currentValueType = isEditingValue ? inlineEdit.valueType ?? getMongoInlineValueType(value) : getMongoInlineValueType(value);

  if (type === "array") {
    const items = value as unknown[];
    const preview = getMongoStructurePreview(value);

    return (
      <div className="border-b border-border/20 last:border-b-0">
        <div
          className="grid w-full text-left text-[9px]"
          style={{ gridTemplateColumns: `${MONGO_TREE_COLUMN_WIDTH} minmax(0,1fr)` }}
        >
          <div
            className="min-w-0 overflow-hidden bg-muted/[0.06] px-2 py-1 font-semibold leading-4 text-sky-500 dark:text-sky-300"
            onClick={() => setExpanded((current) => !current)}
          >
            <span className="flex min-w-0 items-start gap-1" style={{ paddingLeft: `${indent}px` }}>
              {expanded ? (
                <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              {isEditingKey ? (
                <MongoInlineCellEditor value={inlineEdit.draft} onChange={onEditDraftChange} onCommit={onCommitEdit} onCancel={onCancelEdit} />
              ) : (
                <span
                  className="block min-w-0 break-all leading-4"
                  title={field}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (canEditKey) {
                      onStartEdit(path, "key");
                    }
                  }}
                >
                  {field}
                </span>
              )}
            </span>
          </div>
          <div className="flex min-w-0 items-center px-2 py-1 font-mono leading-4" onClick={() => setExpanded((current) => !current)}>
            {isEditingValue ? (
              <MongoValueTypeSlot valueType={currentValueType} onChange={(nextType) => onSelectValueType(path, nextType)}>
                <MongoInlineCellEditor
                  value={inlineEdit.draft}
                  onChange={onEditDraftChange}
                  onCommit={onCommitEdit}
                  onCancel={onCancelEdit}
                  className="min-w-0 w-full"
                />
              </MongoValueTypeSlot>
            ) : (
              <MongoValueTypeSlot
                valueType={currentValueType}
                disabled={!canEditValue}
                onChange={(nextType) => onSelectValueType(path, nextType)}
              >
                <span
                  className={cn("block min-w-0 break-all", typeColor)}
                  title={preview || `Array [${items.length}]`}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (canEditValue) {
                      onStartEdit(path, "value");
                    }
                  }}
                >
                  {`Array [${items.length}]${!expanded && preview ? ` · ${preview}` : ""}`}
                </span>
              </MongoValueTypeSlot>
            )}
          </div>
        </div>

        {expanded ? (
          <div
            className="grid border-t border-border/10 bg-muted/[0.02]"
            style={{ gridTemplateColumns: `${MONGO_TREE_COLUMN_WIDTH} minmax(0,1fr)` }}
          >
            <div className="bg-muted/[0.04]" />
            <div>
              {items.length === 0 ? (
              <div className="px-2 py-1 text-[9px] text-muted-foreground">Empty array</div>
            ) : (
              items.map((item, index) => (
                  <MongoNestedValueRow
                    key={`${field}.${index}`}
                    field={String(index)}
                    value={item}
                    path={[...path, index]}
                    editable={editable}
                    inlineEdit={inlineEdit}
                    onStartEdit={onStartEdit}
                    onSelectValueType={onSelectValueType}
                    onEditDraftChange={onEditDraftChange}
                    onCommitEdit={onCommitEdit}
                    onCancelEdit={onCancelEdit}
                  />
              ))
            )}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (type === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const preview = getMongoStructurePreview(value);

    return (
      <div className="border-b border-border/20 last:border-b-0">
        <div
          className="grid w-full text-left text-[9px]"
          style={{ gridTemplateColumns: `${MONGO_TREE_COLUMN_WIDTH} minmax(0,1fr)` }}
        >
          <div
            className="min-w-0 overflow-hidden bg-muted/[0.06] px-2 py-1 font-semibold leading-4 text-sky-500 dark:text-sky-300"
            onClick={() => setExpanded((current) => !current)}
          >
            <span className="flex min-w-0 items-start gap-1" style={{ paddingLeft: `${indent}px` }}>
              {expanded ? (
                <ChevronDown className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              )}
              {isEditingKey ? (
                <MongoInlineCellEditor value={inlineEdit.draft} onChange={onEditDraftChange} onCommit={onCommitEdit} onCancel={onCancelEdit} />
              ) : (
                <span
                  className="block min-w-0 break-all leading-4"
                  title={field}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (canEditKey) {
                      onStartEdit(path, "key");
                    }
                  }}
                >
                  {field}
                </span>
              )}
            </span>
          </div>
          <div className="flex min-w-0 items-center px-2 py-1 font-mono leading-4" onClick={() => setExpanded((current) => !current)}>
            {isEditingValue ? (
              <MongoValueTypeSlot valueType={currentValueType} onChange={(nextType) => onSelectValueType(path, nextType)}>
                <MongoInlineCellEditor
                  value={inlineEdit.draft}
                  onChange={onEditDraftChange}
                  onCommit={onCommitEdit}
                  onCancel={onCancelEdit}
                  className="min-w-0 w-full"
                />
              </MongoValueTypeSlot>
            ) : (
              <MongoValueTypeSlot
                valueType={currentValueType}
                disabled={!canEditValue}
                onChange={(nextType) => onSelectValueType(path, nextType)}
              >
                <span
                  className={cn("block min-w-0 break-all", typeColor)}
                  title={preview || `Object {${entries.length}}`}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (canEditValue) {
                      onStartEdit(path, "value");
                    }
                  }}
                >
                  {`Object {${entries.length}}${!expanded && preview ? ` · ${preview}` : ""}`}
                </span>
              </MongoValueTypeSlot>
            )}
          </div>
        </div>

        {expanded ? (
          <div
            className="grid border-t border-border/10 bg-muted/[0.02]"
            style={{ gridTemplateColumns: `${MONGO_TREE_COLUMN_WIDTH} minmax(0,1fr)` }}
          >
            <div className="bg-muted/[0.04]" />
            <div>
              {entries.length === 0 ? (
              <div className="px-2 py-1 text-[9px] text-muted-foreground">Empty object</div>
            ) : (
              entries.map(([childField, childValue]) => (
                  <MongoNestedValueRow
                    key={`${field}.${childField}`}
                    field={childField}
                    value={childValue}
                    path={[...path, childField]}
                    editable={editable}
                    inlineEdit={inlineEdit}
                    onStartEdit={onStartEdit}
                    onSelectValueType={onSelectValueType}
                    onEditDraftChange={onEditDraftChange}
                    onCommitEdit={onCommitEdit}
                    onCancelEdit={onCancelEdit}
                  />
              ))
            )}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="grid border-b border-border/20 text-[9px] last:border-b-0"
      style={{ gridTemplateColumns: `${MONGO_TREE_COLUMN_WIDTH} minmax(0,1fr)` }}
    >
      <div className="min-w-0 overflow-hidden bg-muted/[0.06] px-2 py-1 font-semibold leading-4 text-sky-500 dark:text-sky-300">
        {isEditingKey ? (
          <div style={{ paddingLeft: `${indent + 13}px` }}>
            <MongoInlineCellEditor value={inlineEdit.draft} onChange={onEditDraftChange} onCommit={onCommitEdit} onCancel={onCancelEdit} />
          </div>
        ) : (
          <span
            className="block min-w-0 break-all leading-4"
            style={{ paddingLeft: `${indent + 13}px` }}
            title={field}
            onDoubleClick={(event) => {
              event.stopPropagation();
              if (canEditKey) {
                onStartEdit(path, "key");
              }
            }}
          >
            {field}
          </span>
        )}
      </div>
      <div className="flex min-w-0 items-center px-2 py-1 font-mono leading-4">
        {isEditingValue ? (
          <MongoValueTypeSlot valueType={currentValueType} onChange={(nextType) => onSelectValueType(path, nextType)}>
            <MongoInlineCellEditor
              value={inlineEdit.draft}
              onChange={onEditDraftChange}
              onCommit={onCommitEdit}
              onCancel={onCancelEdit}
              className="min-w-0 w-full"
            />
          </MongoValueTypeSlot>
        ) : (
          <MongoValueTypeSlot
            valueType={currentValueType}
            disabled={!canEditValue}
            onChange={(nextType) => onSelectValueType(path, nextType)}
          >
            <span
              className={cn("block min-w-0 break-all", typeColor)}
              title={formatMongoLeafValue(value)}
              onDoubleClick={(event) => {
                event.stopPropagation();
                if (canEditValue) {
                  onStartEdit(path, "value");
                }
              }}
            >
              {formatMongoSummaryValue(value)}
            </span>
          </MongoValueTypeSlot>
        )}
      </div>
    </div>
  );
}

function MongoDocumentCard({
  document,
  index,
  active,
  onSelect,
  onEdit,
  onRequestWriteAccess,
  onSaveDocument,
  saving,
}: {
  document: Record<string, unknown>;
  index: number;
  active: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onRequestWriteAccess: () => boolean;
  onSaveDocument: (document: Record<string, unknown>) => Promise<void>;
  saving: boolean;
}) {
  const [draftDocument, setDraftDocument] = useState(() => cloneMongoDocument(document));
  const [copied, setCopied] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [inlineEdit, setInlineEdit] = useState<MongoInlineEditState | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const renderedDocument = active ? draftDocument : document;
  const fieldEntries = Object.entries(renderedDocument);
  const previewEntries = getMongoPreviewEntries(renderedDocument);
  const docId = getMongoDocumentIdLabel(renderedDocument);

  useEffect(() => {
    setDraftDocument(cloneMongoDocument(document));
    setDirty(false);
    setInlineEdit(null);
    setInlineError(null);
  }, [document, active]);

  const commitInlineEdit = useCallback(() => {
    if (!inlineEdit) {
      return draftDocument;
    }

    try {
      let nextDocument = draftDocument;

      if (inlineEdit.mode === "key") {
        nextDocument = renameMongoPathKey(draftDocument, inlineEdit.path, inlineEdit.draft);
      } else {
        if (String(inlineEdit.path[inlineEdit.path.length - 1]) === "_id") {
          throw new Error("_id cannot be edited.");
        }

        const nextValue = parseMongoInlineValue(
          inlineEdit.draft,
          inlineEdit.valueType ?? getMongoInlineValueType(getMongoValueAtPath(draftDocument, inlineEdit.path)),
        );
        nextDocument = setMongoValueAtPath(draftDocument, inlineEdit.path, nextValue);
      }

      const hasChanges = JSON.stringify(nextDocument) !== JSON.stringify(document);
      setDraftDocument(nextDocument);
      setDirty(hasChanges);
      setInlineEdit(null);
      setInlineError(null);
      return nextDocument;
    } catch (error) {
      setInlineError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [document, draftDocument, inlineEdit]);

  const startInlineEdit = useCallback(
    (path: MongoPath, mode: MongoInlineEditMode) => {
      if (!active) {
        onSelect();
        return;
      }

      if (!onRequestWriteAccess()) {
        return;
      }

      const committedDocument = commitInlineEdit();
      if (!committedDocument) {
        return;
      }

      const currentValue = getMongoValueAtPath(committedDocument, path);
      const nextDraft =
        mode === "key" ? String(path[path.length - 1] ?? "") : formatMongoInlineValue(currentValue);

      setDraftDocument(committedDocument);
      setInlineEdit({
        path,
        mode,
        draft: nextDraft,
        valueType: mode === "value" ? getMongoInlineValueType(currentValue) : undefined,
      });
      setInlineError(null);
    },
    [active, commitInlineEdit, onRequestWriteAccess, onSelect],
  );

  const selectInlineValueType = useCallback(
    (path: MongoPath, valueType: MongoInlineValueType) => {
      if (!active) {
        onSelect();
        return;
      }

      if (!onRequestWriteAccess()) {
        return;
      }

      const committedDocument = commitInlineEdit();
      if (!committedDocument) {
        return;
      }

      const currentValue = getMongoValueAtPath(committedDocument, path);
      setDraftDocument(committedDocument);
      setInlineEdit({
        path,
        mode: "value",
        draft: formatMongoInlineValue(currentValue),
        valueType,
      });
      setInlineError(null);
    },
    [active, commitInlineEdit, onRequestWriteAccess, onSelect],
  );

  const handleSaveInline = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();

      if (!onRequestWriteAccess()) {
        return;
      }

      const nextDocument = commitInlineEdit();
      if (!nextDocument) {
        return;
      }

      if (JSON.stringify(nextDocument) === JSON.stringify(document)) {
        setDirty(false);
        return;
      }

      try {
        await onSaveDocument(nextDocument);
        setDraftDocument(cloneMongoDocument(nextDocument));
        setDirty(false);
        setInlineError(null);
      } catch (error) {
        setInlineError(error instanceof Error ? error.message : String(error));
      }
    },
    [commitInlineEdit, document, onRequestWriteAccess, onSaveDocument],
  );

  const handleCopyJson = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(JSON.stringify(renderedDocument, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-background transition",
        active ? "border-emerald-500/40 bg-emerald-500/[0.04] shadow-sm shadow-emerald-500/10" : "border-border/60 hover:border-border",
      )}
    >
      <div className="group flex items-center gap-1.5 border-b border-border/30 bg-muted/20 px-2.5 py-1.5">
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 text-left"
        >
          <div className="h-[12px]" />
          <div className="text-[8px] text-muted-foreground/70">{fieldEntries.length} fields</div>
        </button>
        <div className={cn("flex items-center gap-0.5 transition-opacity", active ? "opacity-100" : "opacity-0 group-hover:opacity-100")}>
          {active ? (
            <button
              type="button"
              onClick={handleSaveInline}
              disabled={saving || (!dirty && !inlineEdit)}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-1 text-[9px] font-medium text-emerald-700 transition hover:bg-emerald-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-300"
              title="Save inline changes"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          ) : null}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
            className="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title="Edit document"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={handleCopyJson}
            className="rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title="Copy JSON"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Clipboard className="h-3 w-3" />}
          </button>
          <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[9px] text-muted-foreground">
            #{index + 1}
          </span>
        </div>
      </div>

      {inlineError ? (
        <div className="border-b border-rose-500/20 bg-rose-500/5 px-2.5 py-1 text-[10px] text-rose-600 dark:text-rose-300">
          {inlineError}
        </div>
      ) : null}

      <div className="block w-full text-left" onClick={onSelect}>
        <div>
          {(active ? fieldEntries : previewEntries).map(([field, value]) =>
            active ? (
              <MongoTreeRow
                key={`${docId}.${field}`}
                field={field}
                value={value}
                path={[field]}
                editable={active}
                inlineEdit={inlineEdit}
                onStartEdit={startInlineEdit}
                onSelectValueType={selectInlineValueType}
                onEditDraftChange={(nextValue, nextType) =>
                  setInlineEdit((current) =>
                    current
                      ? {
                          ...current,
                          draft: nextValue ?? current.draft,
                          valueType: nextType ?? current.valueType,
                        }
                      : current,
                  )
                }
                onCommitEdit={() => {
                  commitInlineEdit();
                }}
                onCancelEdit={() => {
                  setInlineEdit(null);
                  setInlineError(null);
                }}
              />
            ) : (
              <MongoSummaryRow key={`${docId}.${field}`} field={field} value={value} />
            ),
          )}
          {(active ? fieldEntries : previewEntries).length === 0 ? (
            <div className="px-2.5 py-2 text-[10px] text-muted-foreground">No preview fields.</div>
          ) : null}
        </div>
      </div>

      <div className="border-t border-border/30 px-2.5 py-1 text-[9px] text-muted-foreground">
        {fieldEntries.length} field{fieldEntries.length === 1 ? "" : "s"}
      </div>
    </div>
  );
}

function MongoConnectionDialog({
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
}: MongoConnectionDialogProps) {
  const [tagSelection, setTagSelection] = useState("");

  useEffect(() => {
    const currentTag = draft.tag?.trim() || "";
    if (!currentTag) {
      setTagSelection("");
      return;
    }

    setTagSelection(existingTags.includes(currentTag) ? currentTag : "__custom__");
  }, [draft.tag, existingTags]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Create MongoDB Connection" : "Edit MongoDB Connection"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Connection Name</label>
              <Input
                value={draft.name}
                onChange={(event) => onChange({ ...draft, name: event.target.value })}
                placeholder="Orders Cluster"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Tag</label>
              <Select
                value={tagSelection}
                onChange={(event) => {
                  const value = event.target.value;
                  setTagSelection(value);
                  if (value === "__custom__") {
                    return;
                  }
                  onChange({ ...draft, tag: value });
                }}
                options={[
                  { value: "", label: "No Tag" },
                  ...existingTags.map((tag) => ({ value: tag, label: tag })),
                  { value: "__custom__", label: "Create New Tag" },
                ]}
              />
            </div>

            {tagSelection === "__custom__" ? (
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-medium text-foreground">New Tag</label>
                <Input
                  value={draft.tag ?? ""}
                  onChange={(event) => onChange({ ...draft, tag: event.target.value })}
                  placeholder="staging"
                />
              </div>
            ) : null}

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-foreground">MongoDB URI</label>
              <Input
                value={draft.uri}
                onChange={(event) => onChange({ ...draft, uri: event.target.value })}
                placeholder="mongodb://localhost:27017"
                className="font-mono text-sm"
              />
            </div>
          </div>

          {testFeedback ? (
            <div
              className={cn(
                "rounded-xl border px-4 py-3 text-sm",
                testFeedback.tone === "success" &&
                  "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                testFeedback.tone === "error" &&
                  "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
                testFeedback.tone === "info" &&
                  "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
              )}
            >
              {testFeedback.message}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={onTest} disabled={testing || saving}>
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Test
              </Button>
              <Button
                variant="outline"
                onClick={() => onSave()}
                disabled={saving || testing}
              >
                {saving && saveIntent === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save
              </Button>
              <Button
                onClick={() => onSave({ connectAfterSave: true })}
                disabled={saving || testing}
              >
                {saving && saveIntent === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                {mode === "create" ? "Create & Connect" : "Save & Connect"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MongoDocumentDialog({
  open,
  mode,
  busy,
  value,
  error,
  onChange,
  onClose,
  onSave,
}: MongoDocumentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-3xl" onClose={onClose}>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add Document" : "Edit Document"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={false}
            className="min-h-[360px] w-full rounded-xl border border-input bg-background px-4 py-3 font-mono text-sm leading-6 text-foreground outline-none transition focus-visible:ring-1 focus-visible:ring-ring"
            placeholder='{ "name": "Alice" }'
          />

          {error ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
              {error}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {mode === "create" ? "Insert Document" : "Save Document"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function MongoWorkspace() {
  const [connections, setConnections] = useState<MongoConnectionRecord[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>("create");
  const [dialogDraft, setDialogDraft] = useState<MongoConnectionDraft>(createEmptyDraft());
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [dialogTesting, setDialogTesting] = useState(false);
  const [dialogSaving, setDialogSaving] = useState(false);
  const [dialogSaveIntent, setDialogSaveIntent] = useState<"save" | "connect">("save");
  const [dialogFeedback, setDialogFeedback] = useState<NoticeState | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);
  const [browserConnectionId, setBrowserConnectionId] = useState<string | null>(null);
  const [browserSidebarQuery, setBrowserSidebarQuery] = useState("");
  const [sidebarConnectionFilter, setSidebarConnectionFilter] = useState<"all" | "connected">("all");
  const [sidebarTagFilters, setSidebarTagFilters] = useState<string[]>([]);
  const [sidebarTagMenuOpen, setSidebarTagMenuOpen] = useState(false);
  const [collapsedBrowserGroups, setCollapsedBrowserGroups] = useState<Record<string, boolean>>({});
  const [databases, setDatabases] = useState<MongoDatabaseNode[]>([]);
  const [searchDatabasesByConnection, setSearchDatabasesByConnection] = useState<Record<string, MongoDatabaseNode[]>>({});
  const [searchLoadingByConnection, setSearchLoadingByConnection] = useState<Record<string, boolean>>({});
  const [forceCollapsedDatabases, setForceCollapsedDatabases] = useState(false);
  const [databaseTreeCollapsed, setDatabaseTreeCollapsed] = useState(false);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const [selectedDatabase, setSelectedDatabase] = useState<string | null>(null);
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);
  const [filterInput, setFilterInput] = useState("");
  const [projectionInput, setProjectionInput] = useState("");
  const [projectionQuickInput, setProjectionQuickInput] = useState("");
  const [projectionSelectedFields, setProjectionSelectedFields] = useState<string[]>([]);
  const [projectionMenuOpen, setProjectionMenuOpen] = useState(false);
  const [projectionSeedKey, setProjectionSeedKey] = useState<string | null>(null);
  const [sortInput, setSortInput] = useState("");
  const [sortQuickInput, setSortQuickInput] = useState("");
  const [sortSelectedFields, setSortSelectedFields] = useState<MongoSortFieldSelection[]>([]);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [collationInput, setCollationInput] = useState("");
  const [hintInput, setHintInput] = useState("");
  const [maxTimeMsInput, setMaxTimeMsInput] = useState("");
  const [highlightMaxTimeMsInput, setHighlightMaxTimeMsInput] = useState(false);
  const [skipInput, setSkipInput] = useState("");
  const [limitInput, setLimitInput] = useState(DEFAULT_MONGO_LIMIT);
  const [queryOptionsOpen, setQueryOptionsOpen] = useState(true);
  const [documentView, setDocumentView] = useState<DocumentViewMode>("cards");
  const [writeMode, setWriteMode] = useState<MongoWriteMode>("view");
  const [documents, setDocuments] = useState<Array<Record<string, unknown>>>([]);
  const [documentsSourceKey, setDocumentsSourceKey] = useState<string | null>(null);
  const [collectionFieldCatalog, setCollectionFieldCatalog] = useState<Record<string, string[]>>({});
  const [documentDetails, setDocumentDetails] = useState<Record<string, Record<string, unknown>>>({});
  const [documentCount, setDocumentCount] = useState<number | null>(null);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [selectedDocumentIndex, setSelectedDocumentIndex] = useState<number | null>(null);
  const [openCollectionTabs, setOpenCollectionTabs] = useState<MongoCollectionTab[]>([]);
  const [activeCollectionTabKey, setActiveCollectionTabKey] = useState<string | null>(null);
  const [documentDialogOpen, setDocumentDialogOpen] = useState(false);
  const [documentDialogMode, setDocumentDialogMode] = useState<DocumentDialogMode>("create");
  const [documentEditorValue, setDocumentEditorValue] = useState("{\n  \n}");
  const [documentDialogError, setDocumentDialogError] = useState<string | null>(null);
  const [documentSaving, setDocumentSaving] = useState(false);
  const [writeModeDialogOpen, setWriteModeDialogOpen] = useState(false);
  const documentCountRequestRef = useRef(0);
  const pendingCollectionSelectionRef = useRef<MongoPendingCollectionSelection | null>(null);
  const sidebarTagMenuRef = useRef<HTMLDivElement | null>(null);
  const projectionMenuRef = useRef<HTMLDivElement | null>(null);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);
  const maxTimeMsFieldRef = useRef<HTMLInputElement | null>(null);
  const filterInputRef = useRef(filterInput);
  const projectionInputRef = useRef(projectionInput);
  const projectionSelectedFieldsRef = useRef(projectionSelectedFields);
  const sortInputRef = useRef(sortInput);
  const sortSelectedFieldsRef = useRef(sortSelectedFields);
  const collationInputRef = useRef(collationInput);
  const hintInputRef = useRef(hintInput);
  const maxTimeMsInputRef = useRef(maxTimeMsInput);
  const skipInputRef = useRef(skipInput);
  const limitInputRef = useRef(limitInput);

  filterInputRef.current = filterInput;
  projectionInputRef.current = projectionInput;
  projectionSelectedFieldsRef.current = projectionSelectedFields;
  sortInputRef.current = sortInput;
  sortSelectedFieldsRef.current = sortSelectedFields;
  collationInputRef.current = collationInput;
  hintInputRef.current = hintInput;
  maxTimeMsInputRef.current = maxTimeMsInput;
  skipInputRef.current = skipInput;
  limitInputRef.current = limitInput;

  const activeConnection =
    connections.find((connection) => connection.id === browserConnectionId && connection.connected) ??
    connections.find((connection) => connection.connected) ??
    null;
  const documentColumns = useMemo(() => deriveDocumentColumns(documents), [documents]);
  const activeCollectionKey = useMemo(
    () => (activeConnection && selectedDatabase && selectedCollection ? `${activeConnection.id}:${selectedDatabase}.${selectedCollection}` : null),
    [activeConnection, selectedCollection, selectedDatabase],
  );
  const availableFieldColumns = useMemo(() => {
    if (!activeCollectionKey) {
      return documentColumns;
    }

    const cached = collectionFieldCatalog[activeCollectionKey] ?? [];
    return cached.length > 0 ? cached : documentColumns;
  }, [activeCollectionKey, collectionFieldCatalog, documentColumns]);
  const triggerMaxTimeMsAttention = useCallback(() => {
    setQueryOptionsOpen(true);
    setHighlightMaxTimeMsInput(true);
    window.setTimeout(() => {
      maxTimeMsFieldRef.current?.focus();
      maxTimeMsFieldRef.current?.select();
    }, 0);
  }, []);

  const loadConnections = useCallback(async () => {
    setLoadingConnections(true);
    try {
      const nextConnections = await listMongoConnections();
      setConnections(nextConnections);
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoadingConnections(false);
    }
  }, []);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    const timeoutMs = notice?.tone === "error" ? 5000 : 3000;
    if (!notice) return;

    const handle = window.setTimeout(() => setNotice(null), timeoutMs);
    return () => window.clearTimeout(handle);
  }, [notice]);

  useEffect(() => {
    if (!highlightMaxTimeMsInput) {
      return;
    }

    const handle = window.setTimeout(() => setHighlightMaxTimeMsInput(false), 3200);
    return () => window.clearTimeout(handle);
  }, [highlightMaxTimeMsInput]);

  useEffect(() => {
    const connected = connections.filter((connection) => connection.connected);
    if (connected.length === 0) {
      setBrowserConnectionId(null);
      return;
    }

    setBrowserConnectionId((current) =>
      current && connected.some((connection) => connection.id === current)
        ? current
        : connected[0].id,
    );
  }, [connections]);

  const loadCollectionsForDatabase = useCallback(
    async (connectionId: string, databaseName: string) => {
      setDatabases((current) =>
        current.map((database) =>
          database.info.name === databaseName
            ? { ...database, expanded: true, loadingCollections: true }
            : database,
        ),
      );
      setSearchDatabasesByConnection((current) => {
        const databasesForConnection = current[connectionId];
        if (!databasesForConnection) {
          return current;
        }

        return {
          ...current,
          [connectionId]: databasesForConnection.map((database) =>
            database.info.name === databaseName
              ? { ...database, expanded: true, loadingCollections: true }
              : database,
          ),
        };
      });

      try {
        const collections = await listMongoCollections(connectionId, databaseName);
        setDatabases((current) =>
          current.map((database) =>
            database.info.name === databaseName
              ? {
                  ...database,
                  expanded: true,
                  loadingCollections: false,
                  collectionsLoaded: true,
                  collections,
                }
              : database,
          ),
        );
        setSearchDatabasesByConnection((current) => {
          const databasesForConnection = current[connectionId];
          if (!databasesForConnection) {
            return current;
          }

          return {
            ...current,
            [connectionId]: databasesForConnection.map((database) =>
              database.info.name === databaseName
                ? {
                    ...database,
                    expanded: true,
                    loadingCollections: false,
                    collectionsLoaded: true,
                    collections,
                  }
                : database,
            ),
          };
        });

      } catch (error) {
        setDatabases((current) =>
          current.map((database) =>
            database.info.name === databaseName
              ? {
                  ...database,
                  expanded: true,
                  loadingCollections: false,
                  collectionsLoaded: true,
                  collections: [],
                }
              : database,
          ),
        );
        setSearchDatabasesByConnection((current) => {
          const databasesForConnection = current[connectionId];
          if (!databasesForConnection) {
            return current;
          }

          return {
            ...current,
            [connectionId]: databasesForConnection.map((database) =>
              database.info.name === databaseName
                ? {
                    ...database,
                    expanded: true,
                    loadingCollections: false,
                    collectionsLoaded: true,
                    collections: [],
                  }
                : database,
            ),
          };
        });
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [],
  );

  const loadSearchDatabasesForConnection = useCallback(
    async (connectionId: string) => {
      const cachedDatabases = searchDatabasesByConnection[connectionId];
      const fullyHydrated = cachedDatabases?.length
        ? cachedDatabases.every((database) => database.collectionsLoaded)
        : false;

      if (searchLoadingByConnection[connectionId] || fullyHydrated) {
        return;
      }

      setSearchLoadingByConnection((current) => ({
        ...current,
        [connectionId]: true,
      }));

      try {
        const nextDatabases = await listMongoDatabases(connectionId);
        const nodes = await Promise.all(
          nextDatabases.map(async (database) => {
            try {
              const collections = await listMongoCollections(connectionId, database.name);
              return {
                info: database,
                expanded: false,
                loadingCollections: false,
                collectionsLoaded: true,
                collections,
              } satisfies MongoDatabaseNode;
            } catch {
              return {
                info: database,
                expanded: false,
                loadingCollections: false,
                collectionsLoaded: true,
                collections: [],
              } satisfies MongoDatabaseNode;
            }
          }),
        );

        setSearchDatabasesByConnection((current) => ({
          ...current,
          [connectionId]: nodes,
        }));
      } catch (error) {
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setSearchLoadingByConnection((current) => ({
          ...current,
          [connectionId]: false,
        }));
      }
    },
    [searchDatabasesByConnection, searchLoadingByConnection],
  );

  const loadDatabasesForConnection = useCallback(
    async (connectionId: string, options?: { preserveSelection?: boolean }) => {
      setLoadingDatabases(true);
      setDatabases([]);
      if (options?.preserveSelection) {
        setDocuments([]);
        setDocumentCount(null);
        setSelectedDocumentIndex(null);
      } else {
        setSelectedDatabase(null);
        setSelectedCollection(null);
        setDocuments([]);
        setDocumentCount(null);
        setSelectedDocumentIndex(null);
        setOpenCollectionTabs([]);
        setActiveCollectionTabKey(null);
      }

      try {
        const nextDatabases = await listMongoDatabases(connectionId);
        const nodes: MongoDatabaseNode[] = nextDatabases.map((database) => ({
          info: database,
          expanded: false,
          loadingCollections: false,
          collectionsLoaded: false,
          collections: [],
        }));

        setDatabases(nodes);
        setSearchDatabasesByConnection((current) =>
          current[connectionId]
            ? current
            : {
                ...current,
                [connectionId]: nodes,
              },
        );
      } catch (error) {
        setNotice({
          tone: "error",
          message: formatMongoWorkspaceError(error),
        });
      } finally {
        setLoadingDatabases(false);
      }
    },
    [loadCollectionsForDatabase],
  );

  const collapseAllDatabases = useCallback(() => {
    setDatabaseTreeCollapsed(true);
    setForceCollapsedDatabases(true);
    setDatabases((current) =>
      current.map((database) =>
        database.expanded ? { ...database, expanded: false } : database,
      ),
    );
  }, []);

  useEffect(() => {
    if (!activeConnection) {
      setDatabases([]);
      setSelectedDatabase(null);
      setSelectedCollection(null);
      setDocuments([]);
      setDocumentCount(null);
      pendingCollectionSelectionRef.current = null;
      return;
    }

    setDatabaseTreeCollapsed(false);
    setForceCollapsedDatabases(false);
    const pendingSelection = pendingCollectionSelectionRef.current;
    const preserveSelection = pendingSelection?.connectionId === activeConnection.id;

    void loadDatabasesForConnection(activeConnection.id, { preserveSelection }).then(() => {
      const nextPendingSelection = pendingCollectionSelectionRef.current;
      if (!nextPendingSelection || nextPendingSelection.connectionId !== activeConnection.id) {
        return;
      }

      void loadCollectionsForDatabase(activeConnection.id, nextPendingSelection.database);
      pendingCollectionSelectionRef.current = null;
    });
  }, [activeConnection?.id, loadCollectionsForDatabase, loadDatabasesForConnection]);

  const loadDocuments = useCallback(async () => {
    if (!activeConnection || !selectedDatabase || !selectedCollection) {
      return;
    }

    const currentCountRequest = documentCountRequestRef.current + 1;
    documentCountRequestRef.current = currentCountRequest;
    setLoadingDocuments(true);
    setDocumentDetails({});
    setDocumentCount(null);

    const nextFilterInput = filterInputRef.current;
    const nextProjectionInput = projectionInputRef.current;
    const nextProjectionSelectedFields = projectionSelectedFieldsRef.current;
    const nextSortInput = sortInputRef.current;
    const nextSortSelectedFields = sortSelectedFieldsRef.current;
    const nextCollationInput = collationInputRef.current;
    const nextHintInput = hintInputRef.current;
    const nextMaxTimeMsInput = maxTimeMsInputRef.current;
    const nextSkipInput = skipInputRef.current;
    const nextLimitInput = limitInputRef.current;
    const parsedMaxTimeMs = Number(nextMaxTimeMsInput);
    const parsedSkip = Number(nextSkipInput);
    const parsedLimit = Number(nextLimitInput);
    const projectionValue = buildMongoProjectionInput(nextProjectionSelectedFields, nextProjectionInput);
    const sortValue = buildMongoSortInput(nextSortSelectedFields, nextSortInput);
    const options: MongoFindOptions = {
      filter: nextFilterInput.trim() || null,
      projection: projectionValue || null,
      sort: sortValue || null,
      collation: nextCollationInput.trim() || null,
      hint: nextHintInput.trim() || null,
      maxTimeMs:
        nextMaxTimeMsInput.trim() && Number.isFinite(parsedMaxTimeMs) && parsedMaxTimeMs > 0
          ? parsedMaxTimeMs
          : null,
      skip: nextSkipInput.trim() && Number.isFinite(parsedSkip) && parsedSkip >= 0 ? parsedSkip : null,
      limit: nextLimitInput.trim() && Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : Number(DEFAULT_MONGO_LIMIT),
      summaryOnly: false,
    };

    try {
      const result = await findMongoDocuments(
        activeConnection.id,
        selectedDatabase,
        selectedCollection,
        options,
      );
      setDocuments(result.documents);
      setDocumentsSourceKey(activeCollectionKey);
      setSelectedDocumentIndex(null);

      void countMongoDocuments(
        activeConnection.id,
        selectedDatabase,
        selectedCollection,
        options,
      )
        .then((count) => {
          if (documentCountRequestRef.current !== currentCountRequest) {
            return;
          }

          setDocumentCount(count);
        })
        .catch((error) => {
          if (documentCountRequestRef.current !== currentCountRequest) {
            return;
          }

          if (isMongoMaxTimeError(error)) {
            triggerMaxTimeMsAttention();
          }
          setNotice({
            tone: "error",
            message: formatMongoWorkspaceError(error),
          });
        })
        .finally(() => {
          if (documentCountRequestRef.current !== currentCountRequest) {
            return;
          }
        });
    } catch (error) {
      setDocuments([]);
      setDocumentsSourceKey(null);
      setDocumentDetails({});
      setDocumentCount(null);
      if (isMongoMaxTimeError(error)) {
        triggerMaxTimeMsAttention();
      }
      setNotice({
        tone: "error",
        message: formatMongoWorkspaceError(error),
      });
    } finally {
      setLoadingDocuments(false);
    }
  }, [
    activeCollectionKey,
    activeConnection,
    selectedCollection,
    selectedDatabase,
  ]);

  useEffect(() => {
    if (!activeConnection || !selectedDatabase || !selectedCollection) {
      return;
    }

    void loadDocuments();
  }, [activeConnection?.id, selectedDatabase, selectedCollection, loadDocuments]);

  const handleTestDialog = async () => {
    const normalized = normalizeDraft(dialogDraft);
    setDialogTesting(true);
    setDialogFeedback(null);

    try {
      const message = await testMongoConnection(normalized);
      setDialogFeedback({ tone: "success", message });
    } catch (error) {
      setDialogFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDialogTesting(false);
    }
  };

  const handleSaveDialog = async (options?: { connectAfterSave?: boolean }) => {
    const normalized = normalizeDraft(dialogDraft);
    if (!normalized.name || !normalized.uri) {
      setDialogFeedback({
        tone: "error",
        message: "Connection name and MongoDB URI are required.",
      });
      return;
    }

    setDialogSaving(true);
    setDialogSaveIntent(options?.connectAfterSave ? "connect" : "save");

    try {
      const record =
        dialogMode === "create"
          ? await addMongoConnection(normalized)
          : await updateMongoConnection(editingConnectionId!, normalized);

      if (options?.connectAfterSave) {
        await connectMongoConnection(record.id);
        setNotice({ tone: "success", message: `Connected to ${record.name}.` });
        setBrowserConnectionId(record.id);
      } else {
        setNotice({
          tone: "success",
          message: dialogMode === "create" ? "Saved MongoDB connection." : `Updated ${record.name}.`,
        });
      }

      setDialogOpen(false);
      setDialogFeedback(null);
      await loadConnections();
    } catch (error) {
      setDialogFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDialogSaving(false);
    }
  };

  const openCreateDialog = () => {
    setDialogMode("create");
    setEditingConnectionId(null);
    setDialogDraft(createEmptyDraft());
    setDialogFeedback(null);
    setDialogOpen(true);
  };

  const openEditDialog = (record: MongoConnectionRecord) => {
    setDialogMode("edit");
    setEditingConnectionId(record.id);
    setDialogDraft(recordToDraft(record));
    setDialogFeedback(null);
    setDialogOpen(true);
  };

  const handleTestSavedConnection = async (record: MongoConnectionRecord) => {
    setBusyConnectionId(record.id);
    try {
      const message = await testMongoConnection(recordToDraft(record));
      setNotice({ tone: "success", message });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyConnectionId(null);
    }
  };

  const handleToggleConnection = async (record: MongoConnectionRecord) => {
    setBusyConnectionId(record.id);
    try {
      if (record.connected) {
        await disconnectMongoConnection(record.id);
        setNotice({ tone: "info", message: `Disconnected ${record.name}.` });
      } else {
        const message = await connectMongoConnection(record.id);
        setNotice({ tone: "success", message });
        setBrowserConnectionId(record.id);
      }

      await loadConnections();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyConnectionId(null);
    }
  };

  const handleDeleteConnection = async (record: MongoConnectionRecord) => {
    if (!window.confirm(`Delete MongoDB connection "${record.name}"?`)) {
      return;
    }

    setBusyConnectionId(record.id);
    try {
      await deleteMongoConnection(record.id);
      setNotice({ tone: "info", message: `Deleted ${record.name}.` });
      await loadConnections();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyConnectionId(null);
    }
  };

  const handleDisconnectAll = async () => {
    const connectedConnections = connections.filter((connection) => connection.connected);
    if (connectedConnections.length === 0) {
      return;
    }

    setBusyConnectionId("__all__");
    try {
      await Promise.all(connectedConnections.map((connection) => disconnectMongoConnection(connection.id)));
      setNotice({
        tone: "info",
        message: `Disconnected ${connectedConnections.length} MongoDB connection${connectedConnections.length === 1 ? "" : "s"}.`,
      });
      await loadConnections();
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusyConnectionId(null);
    }
  };

  const filteredConnections = useMemo(() => {
    const loweredQuery = searchQuery.trim().toLowerCase();
    return connections.filter((connection) => {
      const matchesTag = tagFilter === "all" || (connection.tag?.trim() || UNGROUPED_TAG) === tagFilter;
      if (!matchesTag) return false;
      if (!loweredQuery) return true;

      return (
        connection.name.toLowerCase().includes(loweredQuery) ||
        connection.uri.toLowerCase().includes(loweredQuery) ||
        parseMongoHost(connection.uri).toLowerCase().includes(loweredQuery)
      );
    });
  }, [connections, searchQuery, tagFilter]);

  const tagGroups = useMemo(() => groupConnectionsByTag(filteredConnections), [filteredConnections]);
  const browserGroups = useMemo(() => {
    const loweredQuery = browserSidebarQuery.trim().toLowerCase();

    const nextConnections = connections.filter((connection) => {
      if (sidebarConnectionFilter === "connected" && !connection.connected) {
        return false;
      }

      if (sidebarTagFilters.length > 0 && !sidebarTagFilters.includes(connection.tag?.trim() || UNGROUPED_TAG)) {
        return false;
      }

      if (!loweredQuery) {
        return true;
      }

      if (
        fuzzyMatchMongoLabel(connection.name, loweredQuery) ||
        fuzzyMatchMongoLabel(connection.uri, loweredQuery) ||
        fuzzyMatchMongoLabel(parseMongoHost(connection.uri), loweredQuery)
      ) {
        return true;
      }

      const connectionDatabases =
        loweredQuery && connection.connected
          ? searchDatabasesByConnection[connection.id] ?? (activeConnection?.id === connection.id ? databases : [])
          : activeConnection?.id === connection.id
            ? databases
            : [];

      return connectionDatabases.some(
          (database) =>
            fuzzyMatchMongoLabel(database.info.name, loweredQuery) ||
            database.collections.some((collection) => fuzzyMatchMongoLabel(collection.name, loweredQuery)),
      );
    });

    return groupConnectionsByTag(nextConnections).map((group) => ({
      ...group,
      connections: [...group.connections].sort((left, right) => {
        if (left.connected !== right.connected) {
          return left.connected ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      }),
    }));
  }, [activeConnection?.id, browserSidebarQuery, connections, databases, searchDatabasesByConnection, sidebarConnectionFilter, sidebarTagFilters]);

  const connectionColorMap = useMemo(() => {
    const orderedConnections = [...connections].sort((left, right) =>
      `${left.name}:${left.id}`.localeCompare(`${right.name}:${right.id}`),
    );

    return new Map(
      orderedConnections.map((connection, index) => [connection.id, getMongoTreeClasses(index)]),
    );
  }, [connections]);

  useEffect(() => {
    const query = browserSidebarQuery.trim();
    if (!query) {
      return;
    }

    connections
      .filter((connection) => connection.connected)
      .forEach((connection) => {
        void loadSearchDatabasesForConnection(connection.id);
      });
  }, [browserSidebarQuery, connections, loadSearchDatabasesForConnection]);

  useEffect(() => {
    if (!sidebarTagMenuOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!sidebarTagMenuRef.current?.contains(event.target as Node)) {
        setSidebarTagMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [sidebarTagMenuOpen]);

  useEffect(() => {
    if (!projectionMenuOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!projectionMenuRef.current?.contains(event.target as Node)) {
        setProjectionMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [projectionMenuOpen]);

  useEffect(() => {
    if (!sortMenuOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!sortMenuRef.current?.contains(event.target as Node)) {
        setSortMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [sortMenuOpen]);

  useEffect(() => {
    setProjectionInput("");
    setProjectionQuickInput("");
    setProjectionSelectedFields([]);
    setProjectionSeedKey(null);
    setProjectionMenuOpen(false);
    setSortInput("");
    setSortQuickInput("");
    setSortSelectedFields([]);
    setSortMenuOpen(false);
    setDocumentsSourceKey(null);
  }, [activeCollectionKey]);

  useEffect(() => {
    if (!activeCollectionKey) {
      return;
    }

    if (documentsSourceKey !== activeCollectionKey || documentColumns.length === 0) {
      return;
    }

    setCollectionFieldCatalog((current) => {
      const merged = orderMongoFieldNames([
        ...(current[activeCollectionKey] ?? []),
        ...documentColumns,
      ]);

      const existing = current[activeCollectionKey] ?? [];
      if (existing.length === merged.length && existing.every((value, index) => value === merged[index])) {
        return current;
      }

      return {
        ...current,
        [activeCollectionKey]: merged,
      };
    });
  }, [activeCollectionKey, documentColumns, documentsSourceKey]);

  useEffect(() => {
    if (!activeCollectionKey) {
      return;
    }

    if (documentsSourceKey !== activeCollectionKey || projectionSeedKey === activeCollectionKey || documentColumns.length === 0) {
      return;
    }

    setProjectionSelectedFields(availableFieldColumns);
    setProjectionSeedKey(activeCollectionKey);
  }, [activeCollectionKey, availableFieldColumns, documentColumns.length, documentsSourceKey, projectionSeedKey]);

  useEffect(() => {
    setSortSelectedFields((current) =>
      current.filter((item) => availableFieldColumns.includes(item.field)),
    );
  }, [availableFieldColumns]);

  const knownTags = useMemo(
    () =>
      Array.from(
        new Set(
          connections
            .map((connection) => connection.tag?.trim() || "")
            .filter((tag) => tag.length > 0),
        ),
      ).sort(),
    [connections],
  );
  const tagOptions = useMemo(
    () => [
      { value: "all", label: "All tags" },
      ...knownTags.map((tag) => ({ value: tag, label: tag })),
      { value: UNGROUPED_TAG, label: "Ungrouped" },
    ],
    [knownTags],
  );
  const sidebarTagOptions = useMemo(() => {
    const options = [{ value: "all", label: "All tags" }];
    options.push(...knownTags.map((tag) => ({ value: tag, label: tag })));
    if (connections.some((connection) => !(connection.tag?.trim()))) {
      options.push({ value: UNGROUPED_TAG, label: "Ungrouped" });
    }
    return options;
  }, [connections, knownTags]);
  const sidebarTagSummaryLabel = useMemo(() => {
    if (sidebarTagFilters.length === 0) {
      return "Tags";
    }

    if (sidebarTagFilters.length === 1) {
      return sidebarTagOptions.find((option) => option.value === sidebarTagFilters[0])?.label ?? "Tags";
    }

    return `${sidebarTagFilters.length} selected`;
  }, [sidebarTagFilters, sidebarTagOptions]);
  const projectionSummaryLabel = useMemo(() => {
    if (projectionInput.trim()) {
      if (projectionSelectedFields.length === 0) {
        return "Manual";
      }
      return `${projectionSelectedFields.length} + manual`;
    }

    if (availableFieldColumns.length === 0) {
      return "Projection";
    }

    if (projectionSelectedFields.length === 0) {
      return "No fields";
    }

    if (projectionSelectedFields.length === availableFieldColumns.length) {
      return "All fields";
    }

    return `${projectionSelectedFields.length} fields`;
  }, [availableFieldColumns.length, projectionInput, projectionSelectedFields.length]);
  const sortSummaryLabel = useMemo(() => {
    if (sortInput.trim()) {
      if (sortSelectedFields.length === 0) {
        return "Manual";
      }
      return `${sortSelectedFields.length} + manual`;
    }

    if (sortSelectedFields.length === 0) {
      return "Sort";
    }

    if (sortSelectedFields.length === 1) {
      const current = sortSelectedFields[0];
      return `${current.field} ${current.direction === 1 ? "↑" : "↓"}`;
    }

    return `${sortSelectedFields.length} fields`;
  }, [sortInput, sortSelectedFields]);
  const projectionQuickSuggestions = useMemo(() => {
    const query = projectionQuickInput.trim();
    if (!query || shouldTreatMongoTokenAsManual(query)) {
      return [];
    }

    return availableFieldColumns
      .filter((field) => fuzzyMatchMongoLabel(field, query))
      .slice(0, 6);
  }, [availableFieldColumns, projectionQuickInput]);
  const projectionManualTokens = useMemo(
    () => splitMongoManualTokens(projectionInput),
    [projectionInput],
  );
  const sortQuickSuggestions = useMemo(() => {
    const query = sortQuickInput.trim();
    if (!query || shouldTreatMongoTokenAsManual(query)) {
      return [];
    }

    return availableFieldColumns
      .filter((field) => fuzzyMatchMongoLabel(field, query))
      .slice(0, 6);
  }, [availableFieldColumns, sortQuickInput]);
  const sortManualTokens = useMemo(() => splitMongoManualTokens(sortInput), [sortInput]);
  const selectedDocument =
    selectedDocumentIndex != null ? documents[selectedDocumentIndex] ?? null : null;
  const toggleSortField = useCallback((field: string) => {
    setSortSelectedFields((current) => {
      const index = current.findIndex((item) => item.field === field);
      if (index >= 0) {
        return current.filter((item) => item.field !== field);
      }
      return [...current, { field, direction: 1 }];
    });
  }, []);
  const setSortFieldDirection = useCallback((field: string, direction: MongoSortDirection) => {
    setSortSelectedFields((current) => {
      const index = current.findIndex((item) => item.field === field);
      if (index >= 0) {
        return current.map((item) => (item.field === field ? { ...item, direction } : item));
      }
      return [...current, { field, direction }];
    });
  }, []);
  const commitProjectionQuickInput = useCallback(
    (field?: string) => {
      const typedValue = projectionQuickInput.trim();
      const nextField = field?.trim();

      if (nextField) {
        setProjectionSelectedFields((current) =>
          current.includes(nextField) ? current : [...current, nextField],
        );
        setProjectionQuickInput("");
        return;
      }

      if (!typedValue) {
        return;
      }

      setProjectionInput((current) =>
        appendMongoManualToken(current, buildProjectionManualToken(typedValue)),
      );
      setProjectionQuickInput("");
    },
    [projectionQuickInput],
  );
  const commitSortQuickInput = useCallback(
    (field?: string, direction: MongoSortDirection = 1) => {
      const typedValue = sortQuickInput.trim();
      const nextField = field?.trim();

      if (nextField) {
        setSortFieldDirection(nextField, direction);
        setSortQuickInput("");
        return;
      }

      if (!typedValue) {
        return;
      }

      setSortInput((current) =>
        appendMongoManualToken(current, buildSortManualToken(typedValue)),
      );
      setSortQuickInput("");
    },
    [setSortFieldDirection, sortQuickInput],
  );
  const handleProjectionQuickInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) {
        return;
      }

      event.preventDefault();
      if (shouldTreatMongoTokenAsManual(projectionQuickInput)) {
        commitProjectionQuickInput();
        return;
      }
      if (projectionQuickSuggestions.length > 0) {
        commitProjectionQuickInput(projectionQuickSuggestions[0]);
        return;
      }

      commitProjectionQuickInput();
    },
    [commitProjectionQuickInput, projectionQuickInput, projectionQuickSuggestions],
  );
  const handleSortQuickInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) {
        return;
      }

      event.preventDefault();
      if (shouldTreatMongoTokenAsManual(sortQuickInput)) {
        commitSortQuickInput();
        return;
      }
      if (sortQuickSuggestions.length > 0) {
        commitSortQuickInput(sortQuickSuggestions[0]);
        return;
      }

      commitSortQuickInput();
    },
    [commitSortQuickInput, sortQuickInput, sortQuickSuggestions],
  );
  const removeProjectionManualToken = useCallback((token: string) => {
    setProjectionInput((current) =>
      splitMongoManualTokens(current)
        .filter((item) => item !== token)
        .join(", "),
    );
  }, []);
  const removeSortManualToken = useCallback((token: string) => {
    setSortInput((current) =>
      splitMongoManualTokens(current)
        .filter((item) => item !== token)
        .join(", "),
    );
  }, []);
  const guardEditMode = useCallback(() => {
    if (writeMode === "edit") {
      return true;
    }

    setWriteModeDialogOpen(true);
    return false;
  }, [writeMode]);

  const handleRunQuery = useCallback(() => {
    if (loadingDocuments || !selectedDatabase || !selectedCollection) {
      return;
    }

    void loadDocuments();
  }, [loadDocuments, loadingDocuments, selectedCollection, selectedDatabase]);

  const handleQueryInputKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) {
        return;
      }

      event.preventDefault();
      handleRunQuery();
    },
    [handleRunQuery],
  );

  const handleResetQuery = () => {
    const currentCountRequest = documentCountRequestRef.current + 1;
    documentCountRequestRef.current = currentCountRequest;
    setFilterInput("");
    setProjectionInput("");
    setProjectionQuickInput("");
    setProjectionSelectedFields([]);
    setProjectionSeedKey(null);
    setProjectionMenuOpen(false);
    setSortInput("");
    setSortQuickInput("");
    setSortSelectedFields([]);
    setSortMenuOpen(false);
    setCollationInput("");
    setHintInput("");
    setMaxTimeMsInput("");
    setSkipInput("");
    setLimitInput(DEFAULT_MONGO_LIMIT);
    setDocumentDetails({});
    setDocumentCount(null);
    if (activeConnection && selectedDatabase && selectedCollection) {
      void findMongoDocuments(activeConnection.id, selectedDatabase, selectedCollection, {
        limit: Number(DEFAULT_MONGO_LIMIT),
        summaryOnly: false,
      })
        .then((result) => {
          setDocuments(result.documents);
          setDocumentsSourceKey(activeCollectionKey);
          setDocumentDetails({});
          setSelectedDocumentIndex(null);

          return countMongoDocuments(
            activeConnection.id,
            selectedDatabase,
            selectedCollection,
            null,
          )
            .then((count) => {
              if (documentCountRequestRef.current !== currentCountRequest) {
                return;
              }

              setDocumentCount(count);
            })
            .catch((error) => {
              if (documentCountRequestRef.current !== currentCountRequest) {
                return;
              }

              if (isMongoMaxTimeError(error)) {
                triggerMaxTimeMsAttention();
              }
              setNotice({
                tone: "error",
                message: formatMongoWorkspaceError(error),
              });
            })
            .finally(() => {
              if (documentCountRequestRef.current !== currentCountRequest) {
                return;
              }
            });
        })
        .catch((error) => {
          setDocumentsSourceKey(null);
          if (isMongoMaxTimeError(error)) {
            triggerMaxTimeMsAttention();
          }
          setNotice({
            tone: "error",
            message: formatMongoWorkspaceError(error),
          });
        });
    }
  };

  const loadDocumentDetail = useCallback(
    async (document: Record<string, unknown>) => {
      if (!activeConnection || !selectedDatabase || !selectedCollection) {
        throw new Error("Choose a collection first.");
      }

      const documentId = getMongoDocumentId(document);
      const cacheKey = serializeMongoDocumentId(documentId);
      if (documentId == null || cacheKey == null) {
        throw new Error("Selected document does not have an _id.");
      }

      if (documentDetails[cacheKey]) {
        return documentDetails[cacheKey];
      }

      const detail = await getMongoDocument(
        activeConnection.id,
        selectedDatabase,
        selectedCollection,
        documentId,
      );
      setDocumentDetails((current) => ({
        ...current,
        [cacheKey]: detail,
      }));
      return detail;
    },
    [activeConnection, documentDetails, selectedCollection, selectedDatabase],
  );

  const openCollectionForConnection = useCallback(
    (connectionId: string, databaseName: string, collectionName: string) => {
      const collectionTabKey = getMongoCollectionTabKey(connectionId, databaseName, collectionName);

      pendingCollectionSelectionRef.current = {
        connectionId,
        database: databaseName,
        collection: collectionName,
      };

      setDatabaseTreeCollapsed(false);
      setForceCollapsedDatabases(false);
      setBrowserConnectionId(connectionId);
      setOpenCollectionTabs((current) => {
        if (current.some((tab) => tab.key === collectionTabKey)) {
          return current;
        }

        return [
          ...current,
          {
            key: collectionTabKey,
            label: `${databaseName}.${collectionName}`,
            database: databaseName,
            collection: collectionName,
          },
        ];
      });
      setActiveCollectionTabKey(collectionTabKey);
      setSelectedDatabase(databaseName);
      setSelectedCollection(collectionName);
      setSelectedDocumentIndex(null);
      setDocumentDetails({});

      if (activeConnection?.id === connectionId) {
        void loadCollectionsForDatabase(connectionId, databaseName);
        pendingCollectionSelectionRef.current = null;
      }
    },
    [activeConnection?.id, loadCollectionsForDatabase],
  );

  const closeCollectionTab = useCallback((collectionTabKey: string) => {
    setOpenCollectionTabs((current) =>
      current.filter((tab) => tab.key !== collectionTabKey),
    );
    setSelectedDocumentIndex(null);
  }, []);

  const handleSelectDocument = useCallback(
    (index: number) => {
      setSelectedDocumentIndex(index);
      const document = documents[index];
      const documentKey = getMongoDocumentCacheKey(document);
      if (!documentKey || documentView === "cards") {
        return;
      }

      setDocumentDetails((current) =>
        current[documentKey] ? current : { ...current, [documentKey]: document },
      );
    },
    [documentView, documents],
  );

  const openDocumentEditor = useCallback(
    async (document: Record<string, unknown>) => {
      if (!guardEditMode()) {
        return;
      }

      let nextDocument = document;

      if (documentView === "cards") {
        try {
          nextDocument = await loadDocumentDetail(document);
        } catch (error) {
          setNotice({
            tone: "error",
            message: error instanceof Error ? error.message : String(error),
          });
          return;
        }
      }

      setDocumentDialogMode("edit");
      setDocumentEditorValue(JSON.stringify(nextDocument, null, 2));
      setDocumentDialogError(null);
      setDocumentDialogOpen(true);
    },
    [documentView, guardEditMode, loadDocumentDetail],
  );

  const handleInlineSaveDocument = useCallback(
    async (index: number, nextDocument: Record<string, unknown>) => {
      if (!activeConnection || !selectedDatabase || !selectedCollection) {
        throw new Error("Choose a collection first.");
      }

      if (!guardEditMode()) {
        throw new Error(VIEW_MODE_MESSAGE);
      }

      const currentDocument = documents[index];
      if (!currentDocument) {
        throw new Error("Selected document is no longer available.");
      }

      const documentId = getMongoDocumentId(currentDocument);
      if (documentId == null) {
        throw new Error("Selected document does not have an _id.");
      }

      setDocumentSaving(true);
      try {
        await updateMongoDocument(
          activeConnection.id,
          selectedDatabase,
          selectedCollection,
          documentId,
          nextDocument,
        );

        setDocuments((current) =>
          current.map((document, documentIndex) => (documentIndex === index ? nextDocument : document)),
        );

        const previousCacheKey = getMongoDocumentCacheKey(currentDocument);
        const nextCacheKey = getMongoDocumentCacheKey(nextDocument);
        setDocumentDetails((current) => {
          const next = { ...current };
          if (previousCacheKey) {
            delete next[previousCacheKey];
          }
          if (nextCacheKey) {
            next[nextCacheKey] = nextDocument;
          }
          return next;
        });

        setNotice({ tone: "success", message: "Updated document." });
      } catch (error) {
        setNotice({
          tone: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        setDocumentSaving(false);
      }
    },
    [activeConnection, documents, guardEditMode, selectedCollection, selectedDatabase],
  );

  useEffect(() => {
    if (activeCollectionTabKey && !openCollectionTabs.some((tab) => tab.key === activeCollectionTabKey)) {
      const nextTab = openCollectionTabs[0] ?? null;
      setActiveCollectionTabKey(nextTab?.key ?? null);
      setSelectedDatabase(nextTab?.database ?? null);
      setSelectedCollection(nextTab?.collection ?? null);
      setSelectedDocumentIndex(null);
    }
  }, [activeCollectionTabKey, openCollectionTabs]);

  useEffect(() => {
    setCollapsedBrowserGroups((current) => {
      const next = { ...current };
      let changed = false;

      browserGroups.forEach((group) => {
        if (!(group.key in next)) {
          next[group.key] = false;
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [browserGroups]);

  useEffect(() => {
    documentCountRequestRef.current += 1;
    setDocumentDetails({});
    setSelectedDocumentIndex(null);
  }, [selectedDatabase, selectedCollection]);

  useEffect(() => {
    const pendingSelection = pendingCollectionSelectionRef.current;
    if (pendingSelection?.connectionId === activeConnection?.id) {
      return;
    }

    setOpenCollectionTabs([]);
    setActiveCollectionTabKey(null);
  }, [activeConnection?.id]);

  return (
    <>
      <div className="flex-1 overflow-hidden bg-background">
        {activeConnection ? (
          <div className="flex h-full gap-3 p-3">
            <aside className="flex w-[272px] shrink-0 flex-col rounded-2xl border border-border bg-card shadow-sm">
              <div className="space-y-2 border-b border-border px-2.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">MongoDB</p>
                    <p className="text-[10px] text-muted-foreground">
                      {connections.filter((connection) => connection.connected).length} connected · {connections.length} saved
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={openCreateDialog}>
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => void handleDisconnectAll()}
                      disabled={busyConnectionId === "__all__"}
                    >
                      {busyConnectionId === "__all__" ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Unplug className="h-3 w-3" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={browserSidebarQuery}
                    onChange={(event) => setBrowserSidebarQuery(event.target.value)}
                    placeholder="Fuzzy search collections"
                    className="h-7 pl-8 pr-8 text-[11px]"
                  />
                  {browserSidebarQuery ? (
                    <button
                      type="button"
                      onClick={() => setBrowserSidebarQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                      aria-label="Clear collection search"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>

                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex min-w-0 items-center gap-1">
                    <div className="flex items-center overflow-hidden rounded-lg border border-border bg-background/70">
                      <button
                        type="button"
                        onClick={() => setSidebarConnectionFilter("all")}
                        className={cn(
                          "flex h-[22px] items-center px-1.5 text-[9px] font-medium leading-none transition",
                          sidebarConnectionFilter === "all"
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => setSidebarConnectionFilter("connected")}
                        className={cn(
                          "flex h-[22px] items-center px-1.5 text-[9px] font-medium leading-none transition",
                          sidebarConnectionFilter === "connected"
                            ? "bg-accent text-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        Connected
                      </button>
                    </div>
                    {sidebarTagOptions.length > 1 ? (
                      <div ref={sidebarTagMenuRef} className="relative">
                        <button
                          type="button"
                          onClick={() => setSidebarTagMenuOpen((current) => !current)}
                          className={cn(
                            "flex h-[22px] min-w-[84px] items-center justify-between gap-1 rounded-lg border border-border bg-background/70 px-1.5 text-[9px] font-medium text-muted-foreground transition hover:bg-accent/40 hover:text-foreground",
                            sidebarTagMenuOpen && "bg-accent/50 text-foreground",
                            sidebarTagFilters.length > 0 && "text-foreground",
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-1 self-stretch">
                            <span className="flex min-w-0 items-center truncate leading-none">{sidebarTagSummaryLabel}</span>
                            {sidebarTagFilters.length > 0 ? (
                              <span className="flex h-3 items-center rounded-sm bg-muted px-1 text-[8px] leading-none text-muted-foreground">
                                {sidebarTagFilters.length}
                              </span>
                            ) : null}
                          </span>
                          <ChevronDown className={cn("h-2.5 w-2.5 shrink-0 transition-transform", sidebarTagMenuOpen && "rotate-180")} />
                        </button>

                        {sidebarTagMenuOpen ? (
                          <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg border border-border bg-popover p-1 shadow-xl">
                            <div className="mb-1 flex items-center justify-between gap-2 px-1 py-0.5">
                              <span className="text-[8px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                                Tags
                              </span>
                              {sidebarTagFilters.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => setSidebarTagFilters([])}
                                  className="text-[8px] font-medium text-muted-foreground transition hover:text-foreground"
                                >
                                  Clear
                                </button>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSidebarTagFilters([]);
                                setSidebarTagMenuOpen(false);
                              }}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[9px] transition hover:bg-accent hover:text-accent-foreground",
                                sidebarTagFilters.length === 0 && "bg-accent/60 text-accent-foreground",
                              )}
                            >
                              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border/70 bg-background">
                                {sidebarTagFilters.length === 0 ? <Check className="h-2.5 w-2.5" /> : null}
                              </span>
                              <span className="truncate">All tags</span>
                            </button>
                            <div className="my-1 border-t border-border/70" />
                            <div className="max-h-44 overflow-y-auto">
                              {sidebarTagOptions
                                .filter((option) => option.value !== "all")
                                .map((option) => {
                                  const active = sidebarTagFilters.includes(option.value);
                                  const isColoredTag = option.value !== UNGROUPED_TAG;

                                  return (
                                    <button
                                      key={option.value}
                                      type="button"
                                      onClick={() =>
                                        setSidebarTagFilters((current) =>
                                          current.includes(option.value)
                                            ? current.filter((value) => value !== option.value)
                                            : [...current, option.value],
                                        )
                                      }
                                      className={cn(
                                        "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[9px] transition hover:bg-accent hover:text-accent-foreground",
                                        active && "bg-accent/60 text-accent-foreground",
                                      )}
                                    >
                                      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border/70 bg-background">
                                        {active ? <Check className="h-2.5 w-2.5" /> : null}
                                      </span>
                                      {isColoredTag ? (
                                        <span
                                          className={cn(
                                            "h-2 w-2 shrink-0 rounded-full border border-current/20",
                                            getTagClasses(option.label),
                                          )}
                                        />
                                      ) : (
                                        <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/30" />
                                      )}
                                      <span className="truncate">{option.label}</span>
                                    </button>
                                  );
                                })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={collapseAllDatabases}
                    className="inline-flex h-[22px] items-center rounded-lg border border-border px-1.5 text-[8px] font-medium leading-none text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    Collapse DBs
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
                <div className="space-y-1.5">
                  {browserGroups.map((group) => {
                    const groupCollapsed = collapsedBrowserGroups[group.key] ?? false;
                    const isUngrouped = group.key === UNGROUPED_TAG;

                    return (
                      <div
                        key={group.key}
                        className={cn(
                          "rounded-xl border bg-background/30",
                          isUngrouped ? "border-border/50" : getTagSectionBorderClasses(group.label),
                          !isUngrouped && getTagSectionSurfaceClasses(group.label),
                        )}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedBrowserGroups((current) => ({
                              ...current,
                              [group.key]: !groupCollapsed,
                            }))
                          }
                          className={cn(
                            "flex w-full items-center justify-between gap-1 px-1.5 py-0.5 text-left",
                            !isUngrouped && getTagSectionHeaderClasses(group.label),
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            {groupCollapsed ? (
                              <ChevronRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                            )}
                            <Badge
                              variant="outline"
                              className={cn(
                                "px-1 py-0 text-[8px]",
                                group.key !== UNGROUPED_TAG && getTagClasses(group.label),
                              )}
                            >
                              {group.label}
                            </Badge>
                          </span>
                          <span className="text-[8px] text-muted-foreground">{group.connections.length}</span>
                        </button>

                        {!groupCollapsed ? (
                          <div className="space-y-0.5 px-0.5 pb-0.5">
                            {group.connections.map((connection) => {
                              const isActive = activeConnection.id === connection.id;
                              const isBusy = busyConnectionId === connection.id;
                              const loweredSidebarQuery = browserSidebarQuery.trim().toLowerCase();
                              const hasSidebarQuery = loweredSidebarQuery.length > 0;
                              const connectionTreeClasses =
                                connectionColorMap.get(connection.id) ?? DEFAULT_MONGO_TREE_CLASSES;
                              const connectionDatabases =
                                hasSidebarQuery && connection.connected
                                  ? searchDatabasesByConnection[connection.id] ?? (isActive ? databases : [])
                                  : isActive
                                    ? databases
                                    : [];
                              const visibleDatabases = connectionDatabases.filter((database) => {
                                if (!loweredSidebarQuery) return true;
                                if (fuzzyMatchMongoLabel(database.info.name, loweredSidebarQuery)) return true;
                                return database.collections.some((collection) =>
                                  fuzzyMatchMongoLabel(collection.name, loweredSidebarQuery),
                                );
                              });
                              const showConnectionTree =
                                connection.connected &&
                                ((isActive && !databaseTreeCollapsed) || hasSidebarQuery);
                              const connectionDatabasesLoading =
                                hasSidebarQuery && connection.connected
                                  ? Boolean(searchLoadingByConnection[connection.id]) ||
                                    (isActive && loadingDatabases && !searchDatabasesByConnection[connection.id])
                                  : isActive && loadingDatabases;

                              return (
                                <div key={connection.id} className="rounded-lg">
                                  <div
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => {
                                      if (connection.connected) {
                                        setDatabaseTreeCollapsed(false);
                                        setBrowserConnectionId(connection.id);
                                      } else {
                                        void handleToggleConnection(connection);
                                      }
                                    }}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        if (connection.connected) {
                                          setDatabaseTreeCollapsed(false);
                                          setBrowserConnectionId(connection.id);
                                        } else {
                                          void handleToggleConnection(connection);
                                        }
                                      }
                                    }}
                                    className={cn(
                                      "flex w-full items-center justify-between gap-1 rounded-lg border px-1 py-0.5 text-left transition",
                                      isActive
                                        ? cn(connectionTreeClasses.rowActiveBorder, connectionTreeClasses.surfaceActive)
                                        : "border-transparent hover:border-border hover:bg-muted/30",
                                    )}
                                    title={connection.uri}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5">
                                        <span
                                          className={cn(
                                            "h-1.5 w-1.5 shrink-0 rounded-full",
                                            connection.connected ? connectionTreeClasses.dot : "bg-muted-foreground/30",
                                          )}
                                        />
                                        <span
                                          className={cn(
                                            "truncate text-[9px] font-medium leading-3.5",
                                            connection.connected ? connectionTreeClasses.accent : "text-foreground",
                                          )}
                                        >
                                          {connection.name}
                                        </span>
                                      </div>
                                    </div>

                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleToggleConnection(connection);
                                      }}
                                      className="rounded-md p-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                                    >
                                      {isBusy ? (
                                        <Loader2 className="h-2 w-2 animate-spin" />
                                      ) : connection.connected ? (
                                        <Unplug className="h-2 w-2" />
                                      ) : (
                                        <Plug className="h-2 w-2" />
                                      )}
                                    </button>
                                  </div>

                                  {showConnectionTree ? (
                                    <div className="ml-3 mt-0.5 border-l border-border/60 pl-1.5">
                                      {connectionDatabasesLoading ? (
                                        <div className="flex items-center gap-1.5 px-1.5 py-1 text-[9px] text-muted-foreground">
                                          <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                          Loading databases...
                                        </div>
                                      ) : visibleDatabases.length === 0 ? (
                                        <div className="px-1.5 py-1 text-[9px] text-muted-foreground">
                                          {connectionDatabases.length === 0 ? "No databases" : "No matches"}
                                        </div>
                                      ) : (
                                        visibleDatabases.map((database) => {
                                          const isSelectedDb = selectedDatabase === database.info.name;
                                          const visibleCollections = database.collections.filter((collection) =>
                                            !loweredSidebarQuery ||
                                            fuzzyMatchMongoLabel(database.info.name, loweredSidebarQuery) ||
                                            fuzzyMatchMongoLabel(collection.name, loweredSidebarQuery),
                                          );
                                          const showCollections =
                                            !forceCollapsedDatabases &&
                                            (database.expanded || (hasSidebarQuery && visibleCollections.length > 0));

                                          return (
                                            <div key={database.info.name}>
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setDatabaseTreeCollapsed(false);
                                                  setForceCollapsedDatabases(false);
                                                  if (isActive && database.expanded) {
                                                    setDatabases((current) =>
                                                      current.map((item) =>
                                                        item.info.name === database.info.name
                                                          ? { ...item, expanded: false }
                                                          : item,
                                                      ),
                                                    );
                                                    return;
                                                  }

                                                  if (!database.collectionsLoaded) {
                                                    void loadCollectionsForDatabase(connection.id, database.info.name);
                                                  } else if (isActive) {
                                                    setDatabases((current) =>
                                                      current.map((item) =>
                                                        item.info.name === database.info.name
                                                          ? { ...item, expanded: true }
                                                          : item,
                                                      ),
                                                    );
                                                  }

                                                  if (!isActive) {
                                                    setBrowserConnectionId(connection.id);
                                                  }
                                                  setSelectedDatabase(database.info.name);
                                                }}
                                                className={cn(
                                                  "flex w-full items-center justify-between gap-1.5 rounded-lg px-1.5 py-0.5 text-left transition hover:bg-muted/30",
                                                  isSelectedDb && connectionTreeClasses.surfaceActive,
                                                )}
                                              >
                                                <span className="flex min-w-0 items-center gap-1.5">
                                                  {showCollections ? (
                                                    <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
                                                  ) : (
                                                    <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
                                                  )}
                                                  {showCollections ? (
                                                    <FolderOpen className="h-2.5 w-2.5 text-muted-foreground" />
                                                  ) : (
                                                    <Folder className="h-2.5 w-2.5 text-muted-foreground" />
                                                  )}
                                                  <span className={cn("truncate text-[9px] font-medium leading-3.5", connectionTreeClasses.accent)}>
                                                    {database.info.name}
                                                  </span>
                                                </span>
                                                <span className={cn("text-[8px]", connectionTreeClasses.accent)}>
                                                  {database.collections.length}
                                                </span>
                                              </button>

                                              {showCollections ? (
                                                <div className={cn("ml-3 space-y-0.5 border-l pl-1.5", connectionTreeClasses.rail)}>
                                                  {database.loadingCollections ? (
                                                    <div className="flex items-center gap-1.5 px-1.5 py-1 text-[9px] text-muted-foreground">
                                                      <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                                      Loading collections...
                                                    </div>
                                                  ) : visibleCollections.length === 0 ? (
                                                    <div className="px-1.5 py-1 text-[9px] text-muted-foreground">
                                                      No collections
                                                    </div>
                                                  ) : (
                                                    visibleCollections.map((collection) => {
                                                      const collectionTabKey = getMongoCollectionTabKey(
                                                        connection.id,
                                                        database.info.name,
                                                        collection.name,
                                                      );
                                                      const isSelected =
                                                        activeCollectionTabKey === collectionTabKey;

                                                      return (
                                                        <button
                                                          key={`${database.info.name}:${collection.name}`}
                                                          type="button"
                                                          onClick={() => {
                                                            openCollectionForConnection(connection.id, database.info.name, collection.name);
                                                          }}
                                                          className={cn(
                                                            "flex w-full items-center gap-1 rounded-lg px-1.5 py-0.5 text-left text-[9px] transition hover:bg-muted/30",
                                                            isSelected && connectionTreeClasses.surfaceActive,
                                                          )}
                                                        >
                                                          <Table2 className="h-2.5 w-2.5 shrink-0 text-muted-foreground" />
                                                          <span className={cn("truncate leading-3.5", connectionTreeClasses.accent)}>{collection.name}</span>
                                                        </button>
                                                      );
                                                    })
                                                  )}
                                                </div>
                                              ) : null}
                                            </div>
                                          );
                                        })
                                      )}
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </aside>

            <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-border bg-card shadow-sm">
              <div className="border-b border-border px-4 py-3">
                {openCollectionTabs.length > 0 ? (
                  <div className="mb-3 rounded-xl border border-border bg-background/50">
                    <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-1.5">
                      {openCollectionTabs.map((tab) => (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => {
                            setActiveCollectionTabKey(tab.key);
                            setSelectedDatabase(tab.database);
                            setSelectedCollection(tab.collection);
                            setSelectedDocumentIndex(null);
                          }}
                          className={cn(
                            "group inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-left text-[11px] transition",
                            activeCollectionTabKey === tab.key
                              ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : "border-border bg-card text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <span className="max-w-[180px] truncate">{tab.label}</span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(event) => {
                              event.stopPropagation();
                              closeCollectionTab(tab.key);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                event.stopPropagation();
                                closeCollectionTab(tab.key);
                              }
                            }}
                            className="rounded p-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          >
                            <X className="h-2.5 w-2.5" />
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Database className="h-3 w-3 text-emerald-500" />
                      <h1 className="text-sm font-semibold text-foreground">{activeConnection.name}</h1>
                    </div>
                    <p
                      className={cn(
                        "mt-0.5 max-w-[340px] truncate text-[10px] text-muted-foreground sm:max-w-[420px]",
                        selectedDatabase && selectedCollection && "font-mono",
                      )}
                      title={
                        selectedDatabase && selectedCollection
                          ? `${selectedDatabase}.${selectedCollection}`
                          : "Select a collection to inspect documents."
                      }
                    >
                      {selectedDatabase && selectedCollection
                        ? `${selectedDatabase}.${selectedCollection}`
                        : "Select a collection to inspect documents."}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="flex items-center rounded-lg border border-border bg-background/70 p-[2px]">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-6 px-2 text-[10px]",
                          writeMode === "view" &&
                            "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300",
                        )}
                        onClick={() => setWriteMode("view")}
                      >
                        View Mode
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                          "h-6 px-2 text-[10px]",
                          writeMode === "edit" &&
                            "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300",
                        )}
                        onClick={() => setWriteMode("edit")}
                      >
                        Edit Mode
                      </Button>
                    </div>
                    <div className="flex items-center rounded-lg border border-border bg-background/70 p-[2px]">
                      <Button
                        variant={documentView === "cards" ? "secondary" : "ghost"}
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setDocumentView("cards")}
                      >
                        Cards
                      </Button>
                      <Button
                        variant={documentView === "table" ? "secondary" : "ghost"}
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setDocumentView("table")}
                      >
                        Table
                      </Button>
                      <Button
                        variant={documentView === "json" ? "secondary" : "ghost"}
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => setDocumentView("json")}
                      >
                        JSON
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => {
                        if (!selectedDatabase || !selectedCollection) {
                          return;
                        }
                        if (!guardEditMode()) {
                          return;
                        }
                        setDocumentDialogMode("create");
                        setDocumentEditorValue("{\n  \n}");
                        setDocumentDialogError(null);
                        setDocumentDialogOpen(true);
                      }}
                      disabled={!selectedDatabase || !selectedCollection}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add
                    </Button>
                    <Button
                      variant="outline"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => {
                        if (!selectedDocument) {
                          return;
                        }
                        void openDocumentEditor(selectedDocument);
                      }}
                      disabled={!selectedDocument}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => {
                        if (!selectedDocument || !selectedDatabase || !selectedCollection) {
                          return;
                        }
                        if (!guardEditMode()) {
                          return;
                        }

                        const documentId = getMongoDocumentId(selectedDocument);
                        if (documentId == null) {
                          setNotice({
                            tone: "error",
                            message: "Selected document does not have an _id.",
                          });
                          return;
                        }

                        if (!window.confirm(`Delete document ${getMongoDocumentIdLabel(selectedDocument)}?`)) {
                          return;
                        }

                        void (async () => {
                          setDocumentSaving(true);
                          try {
                            const result = await deleteMongoDocuments(
                              activeConnection.id,
                              selectedDatabase,
                              selectedCollection,
                              [documentId],
                            );
                            setNotice({
                              tone: "info",
                              message: `Deleted ${result.deletedCount} document${result.deletedCount === 1 ? "" : "s"}.`,
                            });
                            await loadDocuments();
                          } catch (error) {
                            setNotice({
                              tone: "error",
                              message: error instanceof Error ? error.message : String(error),
                            });
                          } finally {
                            setDocumentSaving(false);
                          }
                        })();
                      }}
                      disabled={!selectedDocument || documentSaving}
                    >
                      {documentSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      Delete
                    </Button>
                    <Button
                      variant="outline"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => void loadDocuments()}
                      disabled={loadingDocuments || !selectedDatabase || !selectedCollection}
                    >
                      {loadingDocuments ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Refresh
                    </Button>
                  </div>
                </div>

                <div className="mt-2 rounded-xl border border-border/70 bg-card/80 px-2 py-1.5">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[8px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        Query
                      </span>
                      <span className="text-[8px] text-muted-foreground">Enter to search</span>
                    </div>
                    <span className="text-[8px] text-muted-foreground">No outer braces needed</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <div className="relative min-w-[220px] flex-1">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={filterInput}
                        onChange={(event) => setFilterInput(normalizeMongoQueryText(event.target.value))}
                        onKeyDown={handleQueryInputKeyDown}
                        placeholder='playerId: "", isActive: true'
                        className="h-7 pl-6 font-mono text-[10px]"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                      />
                    </div>
                    <Button
                      size="sm"
                      className="h-7 px-2 text-[10px]"
                      onClick={handleRunQuery}
                      disabled={loadingDocuments || !selectedDatabase || !selectedCollection}
                    >
                      {loadingDocuments ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                      Find
                    </Button>
                    <Button variant="outline" size="sm" className="h-7 px-2 text-[10px]" onClick={handleResetQuery}>
                      Reset
                    </Button>
                    <Button
                      variant={queryOptionsOpen ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 px-2 text-[10px]"
                      onClick={() => setQueryOptionsOpen((current) => !current)}
                    >
                      Options
                      {queryOptionsOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>

                  {queryOptionsOpen ? (
                    <div className="mt-1.5 grid gap-1.5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_84px_72px_72px]">
                      <div ref={projectionMenuRef} className="relative">
                        <button
                          type="button"
                          onClick={() => setProjectionMenuOpen((current) => !current)}
                          className={cn(
                            "flex h-7 w-full items-center justify-between rounded-md border border-input bg-background px-2 text-[10px] font-medium text-muted-foreground transition hover:bg-accent/40 hover:text-foreground",
                            projectionMenuOpen && "ring-1 ring-ring",
                            (projectionSelectedFields.length > 0 || projectionInput.trim()) && "text-foreground",
                          )}
                        >
                          <span className="truncate">{projectionSummaryLabel}</span>
                          <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", projectionMenuOpen && "rotate-180")} />
                        </button>

                        {projectionMenuOpen ? (
                          <div className="absolute left-0 top-full z-20 mt-1 w-[280px] rounded-lg border border-border bg-popover p-1 shadow-xl">
                            <div className="mb-1 flex items-center justify-between gap-2 px-1 py-0.5">
                              <span className="text-[8px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                                Projection
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setProjectionSelectedFields(availableFieldColumns)}
                                  className="text-[8px] font-medium text-muted-foreground transition hover:text-foreground"
                                >
                                  All
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setProjectionSelectedFields([])}
                                  className="text-[8px] font-medium text-muted-foreground transition hover:text-foreground"
                                >
                                  None
                                </button>
                              </div>
                            </div>
                            <div className="mb-1 px-1">
                              <Input
                                value={projectionQuickInput}
                                onChange={(event) => setProjectionQuickInput(normalizeMongoQueryText(event.target.value))}
                                onKeyDown={handleProjectionQuickInputKeyDown}
                                placeholder="Type field or manual rule"
                                className="h-7 font-mono text-[10px]"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                              />
                            </div>
                            {projectionManualTokens.length > 0 ? (
                              <div className="mb-1 px-1">
                                <div className="flex flex-wrap gap-1 rounded-md border border-border/70 bg-background/60 p-1">
                                  {projectionManualTokens.map((token) => (
                                    <button
                                      key={token}
                                      type="button"
                                      onClick={() => removeProjectionManualToken(token)}
                                      className="inline-flex max-w-full items-center gap-1 rounded border border-border/70 bg-background px-1.5 py-0.5 text-[8px] text-muted-foreground transition hover:text-foreground"
                                      title={token}
                                    >
                                      <span className="truncate font-mono">{token}</span>
                                      <X className="h-2.5 w-2.5 shrink-0" />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            <div className="max-h-44 overflow-y-auto px-1 pb-1">
                              {availableFieldColumns.length === 0 ? (
                                <div className="rounded-md px-1.5 py-2 text-[9px] text-muted-foreground">
                                  Load documents first to detect fields.
                                </div>
                              ) : (
                                <>
                                  {projectionQuickInput.trim() ? (
                                    <button
                                      type="button"
                                      onClick={() => commitProjectionQuickInput()}
                                      className="mb-1 flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-[9px] transition hover:bg-accent hover:text-accent-foreground"
                                    >
                                      <span className="truncate font-mono">{projectionQuickInput.trim()}</span>
                                      <span className="text-[8px] text-muted-foreground">Use typed</span>
                                    </button>
                                  ) : null}
                                  {(projectionQuickInput.trim() && projectionQuickSuggestions.length > 0
                                    ? projectionQuickSuggestions
                                    : !projectionQuickInput.trim()
                                      ? availableFieldColumns
                                      : []
                                  ).map((field) => {
                                  const selected = projectionSelectedFields.includes(field);
                                  return (
                                    <button
                                      key={field}
                                      type="button"
                                      onClick={() =>
                                        setProjectionSelectedFields((current) =>
                                          current.includes(field)
                                            ? current.filter((item) => item !== field)
                                            : [...current, field],
                                        )
                                      }
                                      className={cn(
                                        "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[9px] transition hover:bg-accent hover:text-accent-foreground",
                                        selected && "bg-accent/60 text-accent-foreground",
                                      )}
                                    >
                                      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border/70 bg-background">
                                        {selected ? <Check className="h-2.5 w-2.5" /> : null}
                                      </span>
                                      <span className="truncate font-mono">{field}</span>
                                    </button>
                                  );
                                  })}
                                </>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div ref={sortMenuRef} className="relative">
                        <button
                          type="button"
                          onClick={() => setSortMenuOpen((current) => !current)}
                          className={cn(
                            "flex h-7 w-full items-center justify-between rounded-md border border-input bg-background px-2 text-[10px] font-medium text-muted-foreground transition hover:bg-accent/40 hover:text-foreground",
                            sortMenuOpen && "ring-1 ring-ring",
                            (sortSelectedFields.length > 0 || sortInput.trim()) && "text-foreground",
                          )}
                        >
                          <span className="truncate">{sortSummaryLabel}</span>
                          <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform", sortMenuOpen && "rotate-180")} />
                        </button>

                        {sortMenuOpen ? (
                          <div className="absolute left-0 top-full z-20 mt-1 w-[280px] rounded-lg border border-border bg-popover p-1 shadow-xl">
                            <div className="mb-1 flex items-center justify-between gap-2 px-1 py-0.5">
                              <span className="text-[8px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                                Sort
                              </span>
                              <button
                                type="button"
                                onClick={() => setSortSelectedFields([])}
                                className="text-[8px] font-medium text-muted-foreground transition hover:text-foreground"
                              >
                                Clear
                              </button>
                            </div>
                            <div className="mb-1 px-1">
                              <Input
                                value={sortQuickInput}
                                onChange={(event) => setSortQuickInput(normalizeMongoQueryText(event.target.value))}
                                onKeyDown={handleSortQuickInputKeyDown}
                                placeholder="Type field or manual rule"
                                className="h-7 font-mono text-[10px]"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                              />
                            </div>
                            {sortManualTokens.length > 0 ? (
                              <div className="mb-1 px-1">
                                <div className="flex flex-wrap gap-1 rounded-md border border-border/70 bg-background/60 p-1">
                                  {sortManualTokens.map((token) => (
                                    <button
                                      key={token}
                                      type="button"
                                      onClick={() => removeSortManualToken(token)}
                                      className="inline-flex max-w-full items-center gap-1 rounded border border-border/70 bg-background px-1.5 py-0.5 text-[8px] text-muted-foreground transition hover:text-foreground"
                                      title={token}
                                    >
                                      <span className="truncate font-mono">{token}</span>
                                      <X className="h-2.5 w-2.5 shrink-0" />
                                    </button>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            <div className="max-h-44 overflow-y-auto px-1 pb-1">
                              {availableFieldColumns.length === 0 ? (
                                <div className="rounded-md px-1.5 py-2 text-[9px] text-muted-foreground">
                                  Load documents first to detect fields.
                                </div>
                              ) : (
                                <>
                                  {sortQuickInput.trim() ? (
                                    <button
                                      type="button"
                                      onClick={() => commitSortQuickInput()}
                                      className="mb-1 flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-[9px] transition hover:bg-accent hover:text-accent-foreground"
                                    >
                                      <span className="truncate font-mono">{sortQuickInput.trim()}</span>
                                      <span className="text-[8px] text-muted-foreground">Use typed</span>
                                    </button>
                                  ) : null}
                                  {(sortQuickInput.trim() && sortQuickSuggestions.length > 0
                                    ? sortQuickSuggestions
                                    : !sortQuickInput.trim()
                                      ? availableFieldColumns
                                      : []
                                  ).map((field) => {
                                  const selectedEntry = sortSelectedFields.find((item) => item.field === field);
                                  const selected = Boolean(selectedEntry);
                                  return (
                                    <div
                                      key={field}
                                      className={cn(
                                        "flex items-center gap-1 rounded-md px-1.5 py-1 transition hover:bg-accent/70",
                                        selected && "bg-accent/50",
                                      )}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => toggleSortField(field)}
                                        className="flex min-w-0 flex-1 items-center gap-2 text-left text-[9px]"
                                      >
                                        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-sm border border-border/70 bg-background">
                                          {selected ? <Check className="h-2.5 w-2.5" /> : null}
                                        </span>
                                        <span className="truncate font-mono">{field}</span>
                                      </button>
                                      <div className="flex items-center rounded-md border border-border/70 bg-background p-0.5">
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setSortFieldDirection(field, 1);
                                          }}
                                          className={cn(
                                            "rounded px-1.5 py-0.5 text-[8px] font-medium transition",
                                            selectedEntry?.direction === 1
                                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                              : "text-muted-foreground hover:text-foreground",
                                          )}
                                        >
                                          Asc
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setSortFieldDirection(field, -1);
                                          }}
                                          className={cn(
                                            "rounded px-1.5 py-0.5 text-[8px] font-medium transition",
                                            selectedEntry?.direction === -1
                                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                                              : "text-muted-foreground hover:text-foreground",
                                          )}
                                        >
                                          Desc
                                        </button>
                                      </div>
                                    </div>
                                  );
                                  })}
                                </>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <Input
                        value={collationInput}
                        onChange={(event) => setCollationInput(normalizeMongoQueryText(event.target.value))}
                        onKeyDown={handleQueryInputKeyDown}
                        placeholder='Collation: locale: "en", strength: 2'
                        className="h-7 font-mono text-[10px]"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                      />
                      <Input
                        value={hintInput}
                        onChange={(event) => setHintInput(normalizeMongoQueryText(event.target.value))}
                        onKeyDown={handleQueryInputKeyDown}
                        placeholder="Index Hint: name_1 or name: 1"
                        className="h-7 font-mono text-[10px]"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                      />
                      <Input
                        ref={maxTimeMsFieldRef}
                        type="number"
                        min={1}
                        value={maxTimeMsInput}
                        onChange={(event) => {
                          setMaxTimeMsInput(event.target.value);
                          if (highlightMaxTimeMsInput) {
                            setHighlightMaxTimeMsInput(false);
                          }
                        }}
                        onKeyDown={handleQueryInputKeyDown}
                        placeholder="Max MS"
                        className={cn(
                          "h-7 text-[10px] transition",
                          highlightMaxTimeMsInput &&
                            "border-red-500 ring-2 ring-red-500/40 animate-pulse",
                        )}
                      />
                      <Input
                        type="number"
                        min={0}
                        value={skipInput}
                        onChange={(event) => setSkipInput(event.target.value)}
                        onKeyDown={handleQueryInputKeyDown}
                        placeholder="Skip"
                        className="h-7 text-[10px]"
                      />
                      <Input
                        type="number"
                        min={1}
                        max={500}
                        value={limitInput}
                        onChange={(event) => setLimitInput(event.target.value)}
                        onKeyDown={handleQueryInputKeyDown}
                        placeholder={DEFAULT_MONGO_LIMIT}
                        className="h-7 text-[10px]"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{documents.length.toLocaleString()} loaded</span>
                  {documentCount != null ? (
                    <>
                      <span>·</span>
                      <span>{documentCount.toLocaleString()} total</span>
                    </>
                  ) : null}
                </div>
              </div>

              {!selectedDatabase || !selectedCollection ? (
                <div className="flex flex-1 items-center justify-center p-8 text-center">
                  <div className="max-w-md space-y-1.5">
                    <p className="text-sm font-medium text-foreground">Choose a collection</p>
                    <p className="text-xs text-muted-foreground">
                      Start from the combined sidebar on the left. MongoDB Browser will load documents for the selected collection.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {documentView === "cards" ? (
                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                      <div className="space-y-2">
                        {documents.map((document, index) => (
                          <MongoDocumentCard
                            key={`${selectedDatabase}.${selectedCollection}.${index}`}
                            document={document}
                            index={index}
                            active={selectedDocumentIndex === index}
                            onSelect={() => handleSelectDocument(index)}
                            onEdit={() => {
                              handleSelectDocument(index);
                              void openDocumentEditor(document);
                            }}
                            onRequestWriteAccess={guardEditMode}
                            onSaveDocument={(nextDocument) => handleInlineSaveDocument(index, nextDocument)}
                            saving={documentSaving && selectedDocumentIndex === index}
                          />
                        ))}
                        {documents.length === 0 && !loadingDocuments ? (
                          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                            No documents matched this query.
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : documentView === "json" ? (
                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                      <div className="space-y-2">
                        {documents.map((document, index) => (
                          <div
                            key={`${selectedDatabase}.${selectedCollection}.${index}`}
                            onClick={() => handleSelectDocument(index)}
                            className={cn(
                              "cursor-pointer rounded-xl border bg-background/60 transition",
                              selectedDocumentIndex === index
                                ? "border-emerald-500/35 bg-emerald-500/5"
                                : "border-border",
                            )}
                          >
                            <div className="border-b border-border px-3 py-1.5 text-[10px] text-muted-foreground">
                              Document {index + 1}
                            </div>
                            <pre className="overflow-x-auto px-3 py-3 text-[10px] leading-5 text-foreground">
                              {JSON.stringify(document, null, 2)}
                            </pre>
                          </div>
                        ))}
                        {documents.length === 0 && !loadingDocuments ? (
                          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
                            No documents matched this query.
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-auto">
                      <table className="w-full min-w-[720px] text-xs">
                        <thead className="sticky top-0 z-10 bg-card">
                          <tr className="border-b border-border">
                            {documentColumns.map((column) => (
                              <th
                                key={column}
                                className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                              >
                                {column}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {documents.map((document, index) => (
                            <tr
                              key={`${selectedDatabase}.${selectedCollection}.${index}`}
                              className={cn(
                                "cursor-pointer border-b border-border/60 transition hover:bg-muted/30",
                                selectedDocumentIndex === index && "bg-emerald-500/10",
                              )}
                              onClick={() => handleSelectDocument(index)}
                            >
                              {documentColumns.map((column) => (
                                <td key={column} className="max-w-[220px] px-3 py-2 align-top">
                                  <span
                                    className="block whitespace-pre-wrap break-all font-mono text-xs leading-4 text-foreground"
                                    title={compactMongoValue(document[column])}
                                  >
                                    {compactMongoValue(document[column])}
                                  </span>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {documents.length === 0 && !loadingDocuments ? (
                        <div className="p-6 text-center text-xs text-muted-foreground">
                          No documents matched this query.
                        </div>
                      ) : null}
                    </div>
                  )}
                </>
              )}
            </section>
          </div>
        ) : (
          <div className="h-full overflow-y-auto p-6">
            <div className="mx-auto flex max-w-6xl flex-col gap-6">
              <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      MongoDB Foundation
                    </div>
                    <h1 className="mt-4 text-2xl font-semibold text-foreground">MongoDB Connections</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Save MongoDB URIs, test access, connect into the browser, and start exploring databases and collections.
                    </p>
                  </div>

                  <Button onClick={openCreateDialog}>
                    <Plus className="h-4 w-4" />
                    Create Connection
                  </Button>
                </div>
              </section>

              <section className="rounded-3xl border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative min-w-[260px] flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search MongoDB connections"
                      className="pl-9"
                    />
                  </div>
                  <Select
                    value={tagFilter}
                    onChange={(event) => setTagFilter(event.target.value)}
                    options={tagOptions}
                    className="w-44"
                  />
                  <Badge variant="outline" className="px-2 py-1">
                    {connections.length} saved
                  </Badge>
                  <Badge variant="outline" className="px-2 py-1">
                    {connections.filter((connection) => connection.connected).length} connected
                  </Badge>
                </div>
              </section>

              {loadingConnections ? (
                <div className="flex items-center gap-3 rounded-3xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading MongoDB connections...
                </div>
              ) : tagGroups.length === 0 ? (
                <section className="rounded-3xl border border-dashed border-border bg-card px-6 py-16 text-center shadow-sm">
                  <p className="text-base font-medium text-foreground">No MongoDB connections found</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Create one to start browsing databases and collections.
                  </p>
                </section>
              ) : (
                tagGroups.map((group) => (
                  <section
                    key={group.key}
                    className={cn(
                      "overflow-hidden rounded-3xl border bg-card shadow-sm",
                      group.key === UNGROUPED_TAG ? "border-border" : getTagSectionBorderClasses(group.label),
                      group.key !== UNGROUPED_TAG && getTagSectionSurfaceClasses(group.label),
                    )}
                  >
                    <div
                      className={cn(
                        "flex items-center justify-between gap-3 border-b px-5 py-3",
                        group.key === UNGROUPED_TAG ? "border-border bg-muted/20" : cn("border-current/20", getTagSectionHeaderClasses(group.label)),
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <h2 className="text-sm font-semibold text-foreground">{group.label}</h2>
                        <Badge variant="outline" className="px-2 py-0.5 text-[11px]">
                          {group.connections.length}
                        </Badge>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[860px] text-sm">
                        <thead className="bg-muted/30">
                          <tr className="border-b border-border">
                            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Name</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Host</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Status</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Last Connected</th>
                            <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.connections.map((connection) => {
                            const isBusy = busyConnectionId === connection.id;
                            return (
                              <tr key={connection.id} className="border-b border-border/60 last:border-b-0">
                                <td className="px-4 py-2.5 align-middle">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={cn(
                                        "h-2.5 w-2.5 rounded-full",
                                        connection.connected ? "bg-emerald-500" : "bg-muted-foreground/30",
                                      )}
                                    />
                                    <span className="font-medium text-foreground">{connection.name}</span>
                                  </div>
                                </td>
                                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                                  {parseMongoHost(connection.uri)}
                                </td>
                                <td className="px-4 py-2.5">
                                  {connection.connected ? (
                                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                      Connected
                                    </span>
                                  ) : (
                                    <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
                                      Saved
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                                  {formatTimestamp(connection.lastConnectedAt)}
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8"
                                      onClick={() => void handleTestSavedConnection(connection)}
                                      disabled={isBusy}
                                    >
                                      {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                                      Test
                                    </Button>
                                    <Button
                                      variant={connection.connected ? "secondary" : "outline"}
                                      size="sm"
                                      className="h-8"
                                      onClick={() => void handleToggleConnection(connection)}
                                      disabled={isBusy}
                                    >
                                      {connection.connected ? <Unplug className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
                                      {connection.connected ? "Disconnect" : "Connect"}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8"
                                      onClick={() => openEditDialog(connection)}
                                    >
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                      onClick={() => void handleDeleteConnection(connection)}
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
                  </section>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      <MongoConnectionDialog
        open={dialogOpen}
        mode={dialogMode}
        draft={dialogDraft}
        existingTags={knownTags}
        testing={dialogTesting}
        saving={dialogSaving}
        saveIntent={dialogSaveIntent}
        testFeedback={dialogFeedback}
        onChange={setDialogDraft}
        onClose={() => setDialogOpen(false)}
        onTest={() => void handleTestDialog()}
        onSave={(options) => void handleSaveDialog(options)}
      />

      <MongoDocumentDialog
        open={documentDialogOpen}
        mode={documentDialogMode}
        busy={documentSaving}
        value={documentEditorValue}
        error={documentDialogError}
        onChange={setDocumentEditorValue}
        onClose={() => {
          if (documentSaving) {
            return;
          }
          setDocumentDialogOpen(false);
          setDocumentDialogError(null);
        }}
        onSave={() => {
          if (!activeConnection || !selectedDatabase || !selectedCollection) {
            return;
          }

          let parsedDocument: unknown;
          try {
            parsedDocument = JSON.parse(documentEditorValue);
          } catch (error) {
            setDocumentDialogError(
              error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON.",
            );
            return;
          }

          if (!parsedDocument || Array.isArray(parsedDocument) || typeof parsedDocument !== "object") {
            setDocumentDialogError("Document must be a JSON object.");
            return;
          }

          if (documentDialogMode === "edit") {
            const documentId = getMongoDocumentId(selectedDocument);
            if (documentId == null) {
              setDocumentDialogError("Selected document does not have an _id.");
              return;
            }

            void (async () => {
              setDocumentSaving(true);
              setDocumentDialogError(null);
              try {
                await updateMongoDocument(
                  activeConnection.id,
                  selectedDatabase,
                  selectedCollection,
                  documentId,
                  parsedDocument as Record<string, unknown>,
                );
                setDocumentDialogOpen(false);
                setNotice({ tone: "success", message: "Updated document." });
                await loadDocuments();
              } catch (error) {
                setDocumentDialogError(error instanceof Error ? error.message : String(error));
              } finally {
                setDocumentSaving(false);
              }
            })();
            return;
          }

          void (async () => {
            setDocumentSaving(true);
            setDocumentDialogError(null);
            try {
              await insertMongoDocument(
                activeConnection.id,
                selectedDatabase,
                selectedCollection,
                parsedDocument as Record<string, unknown>,
              );
              setDocumentDialogOpen(false);
              setNotice({ tone: "success", message: "Inserted document." });
              await loadDocuments();
            } catch (error) {
              setDocumentDialogError(error instanceof Error ? error.message : String(error));
            } finally {
              setDocumentSaving(false);
            }
          })();
        }}
      />

      <Dialog open={writeModeDialogOpen} onOpenChange={(next) => !next && setWriteModeDialogOpen(false)}>
        <DialogContent className="max-w-md" onClose={() => setWriteModeDialogOpen(false)}>
          <DialogHeader>
            <DialogTitle>View Mode Active</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{VIEW_MODE_MESSAGE}</p>
            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <Button variant="outline" onClick={() => setWriteModeDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setWriteMode("edit");
                  setWriteModeDialogOpen(false);
                }}
              >
                Switch to Edit Mode
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {notice ? (
        <div className="pointer-events-none fixed right-6 top-20 z-[120]">
          <div
            className={cn(
              "pointer-events-auto flex min-w-[280px] items-center gap-3 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur-sm",
              noticeClasses(notice.tone),
            )}
          >
            <div
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                notice.tone === "success" && "bg-emerald-500",
                notice.tone === "error" && "bg-rose-500",
                notice.tone === "info" && "bg-sky-500",
              )}
            />
            <p className="flex-1 text-sm font-medium">{notice.message}</p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="rounded-md p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
