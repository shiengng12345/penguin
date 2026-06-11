import { logger } from "@/lib/logger";
import { getPersistedValue, setPersistedValue } from "@/lib/app-persistence";
import { APP_VALUE_KEYS } from "@/lib/persistence-keys";
import { runLarkFetch, runLarkUpdate } from "@/components/vault/vault-lark";

const LOG_SCOPE = "docs-lark";

// Same shape the Vault sync expects: human-maintained content lives in a Lark
// document inside a ```json fenced block. For docs the block maps a method's
// fullName to its team-written annotation:
//
// ```json
// {
//   "methods": {
//     "pengvi.auth.Auth.Login": {
//       "description": "登录接口，返回 JWT token",
//       "notes": "QAT 环境需要带 X-Env-Tag 请求头"
//     }
//   }
// }
// ```
// Docs cover every protocol Penguin speaks. REST has no proto package, so
// REST docs always come from custom entries tagged with their protocol.
export const DOCS_PROTOCOLS = ["grpc-web", "grpc", "sdk", "rest"] as const;
export type DocsProtocol = (typeof DOCS_PROTOCOLS)[number];

export interface MethodAnnotation {
  description?: string;
  notes?: string;
  // Entries created in-app for interfaces that have no installed package yet
  // (documented ahead of the proto shipping). They render without schema.
  custom?: boolean;
  // Which API kind this documents (grpc-web / grpc / sdk / rest).
  protocol?: DocsProtocol;
}

export interface DocsAnnotations {
  methods: Record<string, MethodAnnotation>;
}

export interface DocsSyncResult {
  success: boolean;
  methodCount?: number;
  reason?: string;
}

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

export function loadDocsAnnotations(): DocsAnnotations {
  const raw = getPersistedValue(APP_VALUE_KEYS.docsAnnotations);
  if (!raw) return { methods: {} };
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parseDocsAnnotations(parsed) ?? { methods: {} };
  } catch {
    return { methods: {} };
  }
}

export function loadDocsLastSyncedAt(): number | null {
  const raw = getPersistedValue(APP_VALUE_KEYS.docsLastSyncedAt);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

// Strict-shape parser: returns null when the JSON block isn't the annotations
// format, so a wrong document fails loudly instead of wiping local data.
export function parseDocsAnnotations(parsed: unknown): DocsAnnotations | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const methods = (parsed as { methods?: unknown }).methods;
  if (!methods || typeof methods !== "object" || Array.isArray(methods)) return null;

  const out: Record<string, MethodAnnotation> = {};
  for (const [fullName, value] of Object.entries(methods as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as { description?: unknown; notes?: unknown; custom?: unknown; protocol?: unknown };
    const annotation: MethodAnnotation = {};
    if (typeof entry.description === "string" && entry.description.trim()) {
      annotation.description = entry.description.trim();
    }
    if (typeof entry.notes === "string" && entry.notes.trim()) {
      annotation.notes = entry.notes.trim();
    }
    if (entry.custom === true) annotation.custom = true;
    if (
      typeof entry.protocol === "string" &&
      (DOCS_PROTOCOLS as readonly string[]).includes(entry.protocol)
    ) {
      annotation.protocol = entry.protocol as DocsProtocol;
    }
    if (annotation.description || annotation.notes || annotation.custom) out[fullName] = annotation;
  }
  return { methods: out };
}

// --- In-app CRUD (local persistence; push exports the result to Lark) ---

function persistAnnotations(annotations: DocsAnnotations): void {
  setPersistedValue(APP_VALUE_KEYS.docsAnnotations, JSON.stringify(annotations));
}

export function upsertMethodAnnotation(
  fullName: string,
  annotation: MethodAnnotation,
): DocsAnnotations {
  const current = loadDocsAnnotations();
  const cleaned: MethodAnnotation = {};
  if (annotation.description?.trim()) cleaned.description = annotation.description.trim();
  if (annotation.notes?.trim()) cleaned.notes = annotation.notes.trim();
  if (annotation.custom) cleaned.custom = true;
  if (annotation.protocol) cleaned.protocol = annotation.protocol;

  const next: DocsAnnotations = {
    methods: { ...current.methods, [fullName.trim()]: cleaned },
  };
  // An emptied non-custom annotation is a delete, not an empty record.
  if (!cleaned.description && !cleaned.notes && !cleaned.custom) {
    delete next.methods[fullName.trim()];
  }
  persistAnnotations(next);
  logger.info(LOG_SCOPE, "upsertMethodAnnotation", { fullName });
  return next;
}

export function deleteMethodAnnotation(fullName: string): DocsAnnotations {
  const current = loadDocsAnnotations();
  const next: DocsAnnotations = { methods: { ...current.methods } };
  delete next.methods[fullName];
  persistAnnotations(next);
  logger.info(LOG_SCOPE, "deleteMethodAnnotation", { fullName });
  return next;
}

// Export the local annotations back to the Lark document (Vault push
// pattern). The whole doc body is regenerated: a readable per-method list for
// humans plus the machine-readable ```json block the sync reads back.
export function buildDocsMarkdown(annotations: DocsAnnotations): string {
  const lines: string[] = [
    "# Penguin API Docs",
    "",
    "Maintained from the Penguin app (API Docs module). Edit there and push, or edit the JSON block directly — the app syncs the block below.",
    "",
  ];
  const entries = Object.entries(annotations.methods).sort(([a], [b]) => a.localeCompare(b));
  for (const [fullName, annotation] of entries) {
    const protocolTag = annotation.protocol ? `[${annotation.protocol}] ` : "";
    lines.push(`## ${protocolTag}${fullName}${annotation.custom ? " (custom)" : ""}`);
    if (annotation.description) lines.push("", annotation.description);
    if (annotation.notes) lines.push("", `> ${annotation.notes}`);
    lines.push("");
  }
  lines.push("```json", JSON.stringify({ methods: annotations.methods }, null, 2), "```", "");
  return lines.join("\n");
}

export async function pushDocsToLark(): Promise<DocsSyncResult> {
  logger.info(LOG_SCOPE, "pushDocsToLark — entry");
  const url = loadDocsLarkUrl();
  if (!url) return { success: false, reason: "No Lark document URL configured" };

  const annotations = loadDocsAnnotations();
  const markdown = buildDocsMarkdown(annotations);
  const result = await runLarkUpdate({ url, markdown });
  if (!result.success) {
    return { success: false, reason: result.reason ?? "Push failed" };
  }
  setPersistedValue(APP_VALUE_KEYS.docsLastSyncedAt, String(Date.now()));
  return { success: true, methodCount: Object.keys(annotations.methods).length };
}

// Pull the Lark document via lark-cli (reuses the Vault fetch pipeline) and
// persist the parsed annotations.
export async function syncDocsFromLark(): Promise<DocsSyncResult> {
  logger.info(LOG_SCOPE, "syncDocsFromLark — entry");
  const url = loadDocsLarkUrl();
  if (!url) return { success: false, reason: "No Lark document URL configured" };

  const fetched = await runLarkFetch({ url });
  if (!fetched.success || !fetched.markdown) {
    return { success: false, reason: fetched.reason ?? "Fetch failed" };
  }

  const block = fetched.markdown.match(JSON_BLOCK_REGEX);
  if (!block) {
    return { success: false, reason: "Document has no ```json block" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(block[1]);
  } catch (error) {
    logger.warn(LOG_SCOPE, "syncDocsFromLark — invalid JSON block", { error: String(error) });
    return { success: false, reason: "JSON block is not valid JSON" };
  }

  const annotations = parseDocsAnnotations(parsed);
  if (!annotations) {
    return { success: false, reason: 'JSON block must be { "methods": { "<fullName>": { "description", "notes" } } }' };
  }

  setPersistedValue(APP_VALUE_KEYS.docsAnnotations, JSON.stringify(annotations));
  setPersistedValue(APP_VALUE_KEYS.docsLastSyncedAt, String(Date.now()));
  logger.info(LOG_SCOPE, "syncDocsFromLark — synced", { methodCount: Object.keys(annotations.methods).length });
  return { success: true, methodCount: Object.keys(annotations.methods).length };
}
