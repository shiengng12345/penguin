import { logger } from "@/lib/logger";
import { getPersistedValue, setPersistedValue } from "@/lib/app-persistence";
import { APP_VALUE_KEYS } from "@/lib/persistence-keys";
import { requireSuperAdmin } from "@/lib/dev-mode-store";
import { runLarkFetch, runLarkUpdate, validateLarkUrl } from "@/components/vault/vault-lark";
import { sha256Hex } from "@/components/vault/vault-push";

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

// Headers table row — replaces the freeform `authentication` field in
// Sprint 8.2's redesigned editor. Structured so the UI can render a table.
export interface DocHeader {
  key: string;
  value: string;
  description?: string;
}

export interface DocEndpoint {
  id: string;
  method: DocMethod;
  path: string; // "/cpf/check" or "pkg.Service.Method"
  // ---- Sprint 8.2 (new mock) primary fields ----
  title?: string; // human-readable name shown in list + detail header
  description?: string; // multi-line description (replaces overview/notes in new UI)
  headers?: DocHeader[]; // structured request headers (Sprint 8.2)
  requestBody?: string; // raw JSON body string (Sprint 8.2 — replaces requestExample in UI)
  responseBody?: string; // raw JSON body string (Sprint 8.2 — replaces responseExample in UI)
  // ---- Legacy fields retained for backward compat with Lark docs ----
  // The UI no longer surfaces these (Phase A "data shape preserved, UI hidden"
  // decision), but `parseEndpoint` migrates them into the new fields above on
  // first load so old endpoints render correctly under the new design.
  summary?: string;
  section?: string;
  overview?: string;
  requestFields: EndpointField[];
  responseFields: EndpointField[];
  requestExample?: string;
  responseExample?: string;
  notes?: string;
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
    title: "",
    description: "",
    headers: [],
    // Default to "{}" so the CodeMirror JSON editor doesn't flag an empty
    // body as a lint error on first paint. User can clear/replace it.
    requestBody: "{}",
    responseBody: "{}",
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
  } catch (error) {
    // Persisted JSON corrupted (manual edit / schema drift) — warn so future
    // debug can spot it, return empty KB to avoid blocking the UI.
    logger.warn(LOG_SCOPE, "loadKnowledgeBase — invalid JSON in persisted KB", { error: String(error) });
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

// Headers table row parser — drops entries that have no key.
function parseHeader(value: unknown): DocHeader | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const key = asTrimmedString(v.key);
  if (!key) return null;
  const header: DocHeader = { key, value: asTrimmedString(v.value) ?? "" };
  const description = asTrimmedString(v.description);
  if (description) header.description = description;
  return header;
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
    "title",
    "description",
    "summary",
    "section",
    "overview",
    "requestBody",
    "responseBody",
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

  // Headers — new structured table. If the stored shape has it, use as-is.
  // Otherwise migrate from the legacy `authentication` string to a single
  // Authorization row so old endpoints render correctly under the new UI.
  if (Array.isArray(v.headers)) {
    const headers = (v.headers as unknown[])
      .map(parseHeader)
      .filter((h): h is DocHeader => h !== null);
    if (headers.length > 0) endpoint.headers = headers;
  } else if (endpoint.authentication) {
    endpoint.headers = [
      { key: "Authorization", value: endpoint.authentication },
    ];
  }

  // Sprint 8.2 backward-compat shims — surface legacy data through the new
  // primary fields if the new ones are empty. Original fields stay populated
  // so a re-export round-trips the source document.
  if (!endpoint.title) {
    endpoint.title = endpoint.summary ?? `${endpoint.method} ${endpoint.path}`;
  }
  if (!endpoint.description) {
    const parts: string[] = [];
    if (endpoint.overview) parts.push(endpoint.overview);
    if (endpoint.notes) parts.push(endpoint.notes);
    if (parts.length > 0) endpoint.description = parts.join("\n\n");
  }
  if (!endpoint.requestBody && endpoint.requestExample) {
    endpoint.requestBody = endpoint.requestExample;
  }
  if (!endpoint.responseBody && endpoint.responseExample) {
    endpoint.responseBody = endpoint.responseExample;
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

// Sentinel-anchored machine block — robust against user-authored ```json
// fences inside example bodies. SENTINEL_REGEX is tried first; SENTINEL_BEGIN
// / SENTINEL_END are the literal markers buildDocsMarkdown emits around the
// machine JSON block.
const SENTINEL_BEGIN = "<!-- penguin:kb:begin v1 -->";
const SENTINEL_END = "<!-- penguin:kb:end -->";
const SENTINEL_REGEX =
  /<!--\s*penguin:kb:begin\s+v\d+\s*-->\s*```json\s*([\s\S]*?)\s*```\s*<!--\s*penguin:kb:end\s*-->/i;

// Pull the machine JSON block out of a Lark markdown payload. Prefers the
// sentinel-wrapped block (post-Sprint 8); falls back to the LAST ```json
// fence in the doc for backward compatibility with pre-Sprint-8 markdown
// where no sentinel was emitted yet.
function extractMachineBlock(markdown: string): string | null {
  const sentinelMatch = markdown.match(SENTINEL_REGEX);
  if (sentinelMatch) return sentinelMatch[1];
  const allBlocks = [...markdown.matchAll(/```json\s*([\s\S]*?)```/gi)];
  if (allBlocks.length === 0) return null;
  // Last block — machine block has always been emitted at end of doc, so the
  // legacy markdown's last ```json fence is still ours even if users added
  // earlier ```json fences in example bodies.
  return allBlocks[allBlocks.length - 1][1];
}

// Delegate to vault-lark's hardened validator (host whitelist + shell-metachar
// rejection). Sprint 5 DEC #126 deferred this dedupe; Sprint 8 finally landed
// it because the shell-injection fix needed to live in exactly one place.
export function validateDocsLarkUrl(url: string): { success: boolean; reason?: string } {
  return validateLarkUrl({ url });
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
  lines.push(
    "",
    SENTINEL_BEGIN,
    "```json",
    JSON.stringify(kb, null, 2),
    "```",
    SENTINEL_END,
    "",
  );
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

  const blockJson = extractMachineBlock(fetched.markdown);
  if (blockJson === null) return { success: false, reason: "Document has no ```json block" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(blockJson);
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
  // Save hash of the markdown we just pulled — Push will compare against this
  // to detect remote drift (someone edited the Lark doc since last sync).
  const fetchedHash = await sha256Hex({ text: fetched.markdown });
  setPersistedValue(APP_VALUE_KEYS.docsLastSyncedHash, fetchedHash);
  logger.info(LOG_SCOPE, "syncDocsFromLark — synced", { endpointCount: endpointCount(kb) });
  return { success: true, endpointCount: endpointCount(kb) };
}

export async function pushDocsToLark(): Promise<DocsSyncResult> {
  logger.info(LOG_SCOPE, "pushDocsToLark — entry");
  // Hard gate — UI hides the Push button for non-superadmins, but defense-in-depth
  // here protects against direct callers (devtools, future programmatic flows).
  const isAuthorized = requireSuperAdmin();
  if (!isAuthorized) {
    logger.warn(LOG_SCOPE, "pushDocsToLark — caller is not super admin");
    return { success: false, reason: "not authorized" };
  }
  const url = loadDocsLarkUrl();
  if (!url) return { success: false, reason: "No Lark document URL configured" };

  // Pre-fetch remote and compare hash — if it differs from what we last synced,
  // the doc has been edited externally and Push would silently clobber. Mirrors
  // vault-push.ts conflict gate (Sprint 3 DEC #82 pattern). Empty remote (first
  // push to a fresh doc) is allowed — only a failed fetch aborts.
  const preFetch = await runLarkFetch({ url });
  if (!preFetch.success) {
    return { success: false, reason: preFetch.reason ?? "Pre-fetch failed" };
  }
  const remoteMarkdown = preFetch.markdown ?? "";
  const remoteHash = await sha256Hex({ text: remoteMarkdown });
  const expectedHash = getPersistedValue(APP_VALUE_KEYS.docsLastSyncedHash);
  const isDrift = expectedHash !== null && expectedHash !== remoteHash;
  if (isDrift) {
    logger.warn(LOG_SCOPE, "pushDocsToLark — remote drift detected, aborting");
    return {
      success: false,
      reason: "Lark doc was edited since last sync — Pull first to merge, then Push again.",
    };
  }

  const kb = loadKnowledgeBase();
  const markdown = buildDocsMarkdown(kb);
  const result = await runLarkUpdate({ url, markdown });
  if (!result.success) return { success: false, reason: result.reason ?? "Push failed" };

  const newHash = await sha256Hex({ text: markdown });
  setPersistedValue(APP_VALUE_KEYS.docsLastSyncedAt, String(Date.now()));
  setPersistedValue(APP_VALUE_KEYS.docsLastSyncedHash, newHash);
  return { success: true, endpointCount: endpointCount(kb) };
}
