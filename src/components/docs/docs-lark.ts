import { logger } from "@/lib/logger";
import { getPersistedValue, setPersistedValue } from "@/lib/app-persistence";
import { APP_VALUE_KEYS } from "@/lib/persistence-keys";
import { runLarkFetch, runLarkUpdate } from "@/components/vault/vault-lark";

const LOG_SCOPE = "docs-lark";

// ---------------------------------------------------------------------------
// Knowledge Base model — collections of manually-authored endpoint records
// (the docs module is a store for saving/copying, it never sends requests).
// ---------------------------------------------------------------------------

export const DOC_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "GRPC",
  "GRPC-WEB",
  "SDK",
] as const;
export type DocMethod = (typeof DOC_METHODS)[number];

export interface EndpointField {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  example?: string;
}

export interface DocEndpoint {
  id: string;
  method: DocMethod;
  path: string; // "/cpf/check" or "pkg.Service.Method"
  summary?: string; // one-liner under the path in lists
  section?: string; // group header inside the collection (e.g. "CPF & Document Check")
  overview?: string;
  requestFields: EndpointField[];
  responseFields: EndpointField[];
  requestExample?: string;
  responseExample?: string;
  notes?: string; // one bullet per line
  service?: string;
  baseUrl?: string;
  rateLimit?: string;
  category?: string;
  authentication?: string;
  environment?: string;
  owner?: string;
  tags: string[];
  updatedAt: number;
}

export interface DocCollection {
  id: string;
  name: string;
  endpoints: DocEndpoint[];
}

export interface KnowledgeBase {
  collections: DocCollection[];
}

export interface DocsSyncResult {
  success: boolean;
  endpointCount?: number;
  reason?: string;
}

const EMPTY_KB: KnowledgeBase = { collections: [] };

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyEndpoint(): DocEndpoint {
  return {
    id: newId("ep"),
    method: "GET",
    path: "/new-endpoint",
    requestFields: [],
    responseFields: [],
    tags: [],
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Persistence (SQLite app values, vault pattern)
// ---------------------------------------------------------------------------

export function loadKnowledgeBase(): KnowledgeBase {
  const raw = getPersistedValue(APP_VALUE_KEYS.docsKnowledgeBase);
  if (!raw) return EMPTY_KB;
  try {
    return parseKnowledgeBase(JSON.parse(raw)) ?? EMPTY_KB;
  } catch {
    return EMPTY_KB;
  }
}

function persist(kb: KnowledgeBase): KnowledgeBase {
  setPersistedValue(APP_VALUE_KEYS.docsKnowledgeBase, JSON.stringify(kb));
  return kb;
}

// ---------------------------------------------------------------------------
// CRUD — every mutation persists and returns the next KB snapshot
// ---------------------------------------------------------------------------

export function createCollection(name: string): KnowledgeBase {
  const kb = loadKnowledgeBase();
  const collection: DocCollection = { id: newId("col"), name: name.trim(), endpoints: [] };
  logger.info(LOG_SCOPE, "createCollection", { name: collection.name });
  return persist({ collections: [...kb.collections, collection] });
}

export function renameCollection(id: string, name: string): KnowledgeBase {
  const kb = loadKnowledgeBase();
  return persist({
    collections: kb.collections.map((c) => (c.id === id ? { ...c, name: name.trim() } : c)),
  });
}

export function deleteCollection(id: string): KnowledgeBase {
  const kb = loadKnowledgeBase();
  logger.info(LOG_SCOPE, "deleteCollection", { id });
  return persist({ collections: kb.collections.filter((c) => c.id !== id) });
}

export function upsertEndpoint(collectionId: string, endpoint: DocEndpoint): KnowledgeBase {
  const kb = loadKnowledgeBase();
  const stamped = { ...endpoint, updatedAt: Date.now() };
  return persist({
    collections: kb.collections.map((c) => {
      if (c.id !== collectionId) return c;
      const exists = c.endpoints.some((e) => e.id === stamped.id);
      return {
        ...c,
        endpoints: exists
          ? c.endpoints.map((e) => (e.id === stamped.id ? stamped : e))
          : [...c.endpoints, stamped],
      };
    }),
  });
}

export function deleteEndpoint(collectionId: string, endpointId: string): KnowledgeBase {
  const kb = loadKnowledgeBase();
  return persist({
    collections: kb.collections.map((c) =>
      c.id === collectionId
        ? { ...c, endpoints: c.endpoints.filter((e) => e.id !== endpointId) }
        : c,
    ),
  });
}

// ---------------------------------------------------------------------------
// Parsing — strict top-level shape so syncing a wrong Lark doc fails loudly
// instead of wiping local data; per-field normalization is lenient.
// ---------------------------------------------------------------------------

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseField(value: unknown): EndpointField | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const name = asTrimmedString(v.name);
  if (!name) return null;
  const field: EndpointField = { name, type: asTrimmedString(v.type) ?? "string" };
  if (v.required === true) field.required = true;
  const description = asTrimmedString(v.description);
  if (description) field.description = description;
  const example = asTrimmedString(v.example);
  if (example) field.example = example;
  return field;
}

function parseEndpoint(value: unknown): DocEndpoint | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const path = asTrimmedString(v.path);
  if (!path) return null;

  const methodRaw = asTrimmedString(v.method)?.toUpperCase();
  const method = (DOC_METHODS as readonly string[]).includes(methodRaw ?? "")
    ? (methodRaw as DocMethod)
    : "GET";

  const fields = (key: "requestFields" | "responseFields"): EndpointField[] =>
    Array.isArray(v[key])
      ? (v[key] as unknown[]).map(parseField).filter((f): f is EndpointField => f !== null)
      : [];

  const endpoint: DocEndpoint = {
    id: asTrimmedString(v.id) ?? newId("ep"),
    method,
    path,
    requestFields: fields("requestFields"),
    responseFields: fields("responseFields"),
    tags: Array.isArray(v.tags)
      ? (v.tags as unknown[]).map(asTrimmedString).filter((t): t is string => !!t)
      : [],
    updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : Date.now(),
  };

  for (const key of [
    "summary",
    "section",
    "overview",
    "requestExample",
    "responseExample",
    "notes",
    "service",
    "baseUrl",
    "rateLimit",
    "category",
    "authentication",
    "environment",
    "owner",
  ] as const) {
    const parsed = asTrimmedString(v[key]);
    if (parsed) endpoint[key] = parsed;
  }
  return endpoint;
}

export function parseKnowledgeBase(parsed: unknown): KnowledgeBase | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const collections = (parsed as { collections?: unknown }).collections;
  if (!Array.isArray(collections)) return null;

  const out: DocCollection[] = [];
  for (const value of collections) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const v = value as Record<string, unknown>;
    const name = asTrimmedString(v.name);
    if (!name) continue;
    out.push({
      id: asTrimmedString(v.id) ?? newId("col"),
      name,
      endpoints: Array.isArray(v.endpoints)
        ? (v.endpoints as unknown[]).map(parseEndpoint).filter((e): e is DocEndpoint => e !== null)
        : [],
    });
  }
  return { collections: out };
}

// ---------------------------------------------------------------------------
// Lark sync — same lark-cli pipeline as Vault; doc carries a human-readable
// rendering plus the machine ```json block the pull reads back.
// ---------------------------------------------------------------------------

const LARK_HOST_REGEX = /^https:\/\/[a-z0-9.-]+\.(larksuite\.com|feishu\.cn)\//;
const JSON_BLOCK_REGEX = /```json\s*([\s\S]*?)```/i;

export function validateDocsLarkUrl(url: string): { success: boolean; reason?: string } {
  if (!LARK_HOST_REGEX.test(url.trim())) {
    return { success: false, reason: "URL must be a Lark/Feishu document link" };
  }
  return { success: true };
}

export function loadDocsLarkUrl(): string | null {
  return getPersistedValue(APP_VALUE_KEYS.docsLarkUrl);
}

export function saveDocsLarkUrl(url: string): { success: boolean; reason?: string } {
  const validation = validateDocsLarkUrl(url);
  if (!validation.success) return validation;
  setPersistedValue(APP_VALUE_KEYS.docsLarkUrl, url.trim());
  return { success: true };
}

export function loadDocsLastSyncedAt(): number | null {
  const raw = getPersistedValue(APP_VALUE_KEYS.docsLastSyncedAt);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

function endpointCount(kb: KnowledgeBase): number {
  return kb.collections.reduce((sum, c) => sum + c.endpoints.length, 0);
}

function fieldTableMarkdown(title: string, fields: EndpointField[]): string[] {
  if (fields.length === 0) return [];
  const lines = [
    "",
    `### ${title}`,
    "",
    "| Name | Type | Required | Description | Example |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const f of fields) {
    lines.push(
      `| ${f.name} | ${f.type} | ${f.required ? "yes" : "no"} | ${f.description ?? ""} | ${f.example ?? ""} |`,
    );
  }
  return lines;
}

export function buildDocsMarkdown(kb: KnowledgeBase): string {
  const lines: string[] = [
    "# Penguin Knowledge Base",
    "",
    "Maintained from the Penguin app (Knowledge Base module). Edit there and push, or edit the JSON block at the bottom — the app syncs that block.",
  ];
  for (const collection of kb.collections) {
    lines.push("", `## ${collection.name}`);
    for (const ep of collection.endpoints) {
      lines.push("", `### [${ep.method}] ${ep.path}`);
      if (ep.summary) lines.push("", ep.summary);
      if (ep.overview) lines.push("", ep.overview);
      lines.push(...fieldTableMarkdown("Request", ep.requestFields).map((l) => l.replace("### ", "#### ")));
      lines.push(...fieldTableMarkdown("Response", ep.responseFields).map((l) => l.replace("### ", "#### ")));
      // Plain ``` fences on purpose: the pull regex looks for the ```json
      // block at the bottom, and json-tagged examples would shadow it.
      if (ep.requestExample) lines.push("", "#### Request example", "", "```", ep.requestExample, "```");
      if (ep.responseExample) lines.push("", "#### Response example", "", "```", ep.responseExample, "```");
      if (ep.notes) {
        lines.push("", "#### Notes", "");
        for (const note of ep.notes.split("\n").filter((n) => n.trim())) {
          lines.push(`- ${note.trim()}`);
        }
      }
    }
  }
  lines.push("", "```json", JSON.stringify(kb, null, 2), "```", "");
  return lines.join("\n");
}

export async function syncDocsFromLark(): Promise<DocsSyncResult> {
  logger.info(LOG_SCOPE, "syncDocsFromLark — entry");
  const url = loadDocsLarkUrl();
  if (!url) return { success: false, reason: "No Lark document URL configured" };

  const fetched = await runLarkFetch({ url });
  if (!fetched.success || !fetched.markdown) {
    return { success: false, reason: fetched.reason ?? "Fetch failed" };
  }

  const block = fetched.markdown.match(JSON_BLOCK_REGEX);
  if (!block) return { success: false, reason: "Document has no ```json block" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(block[1]);
  } catch (error) {
    logger.warn(LOG_SCOPE, "syncDocsFromLark — invalid JSON block", { error: String(error) });
    return { success: false, reason: "JSON block is not valid JSON" };
  }

  const kb = parseKnowledgeBase(parsed);
  if (!kb) {
    return { success: false, reason: 'JSON block must be { "collections": [ { "name", "endpoints": [...] } ] }' };
  }

  persist(kb);
  setPersistedValue(APP_VALUE_KEYS.docsLastSyncedAt, String(Date.now()));
  logger.info(LOG_SCOPE, "syncDocsFromLark — synced", { endpointCount: endpointCount(kb) });
  return { success: true, endpointCount: endpointCount(kb) };
}

export async function pushDocsToLark(): Promise<DocsSyncResult> {
  logger.info(LOG_SCOPE, "pushDocsToLark — entry");
  const url = loadDocsLarkUrl();
  if (!url) return { success: false, reason: "No Lark document URL configured" };

  const kb = loadKnowledgeBase();
  const markdown = buildDocsMarkdown(kb);
  const result = await runLarkUpdate({ url, markdown });
  if (!result.success) return { success: false, reason: result.reason ?? "Push failed" };

  setPersistedValue(APP_VALUE_KEYS.docsLastSyncedAt, String(Date.now()));
  return { success: true, endpointCount: endpointCount(kb) };
}
