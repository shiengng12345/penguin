import { logger } from "@/lib/logger";
import {
  getPersistedValue,
  setPersistedValue,
  deletePersistedValue,
} from "@/lib/app-persistence";
import { APP_VALUE_KEYS } from "@/lib/persistence-keys";
import { getInMemoryDevToken } from "@/lib/dev-mode-store";
import { useAppStore } from "@/lib/store";
// Shared PATH setup so lark-cli (installed under nvm) resolves the same way
// npm/node do — single source of truth in sidecar.ts.
import { NODE_PATH_SETUP } from "@/lib/sidecar";
import {
  parseVaultJson,
  persistVaultToDisk,
} from "./vault-storage";
import {
  decryptVaultJson,
  getVaultCryptoTokensFromToken,
  isVaultEncryptedEnvelope,
  type VaultCryptoTokens,
} from "./vault-crypto";

const LOG_SCOPE = "vault-lark";

const LARK_HOST_REGEX = /^https:\/\/[a-z0-9.-]+\.(larksuite\.com|feishu\.cn)\//;
const JSON_BLOCK_REGEX = /```json\s*([\s\S]*?)```/i;
const LARK_FETCH_TIMEOUT_MS = 30000;

export interface LarkUrlValidationResult {
  success: boolean;
  reason?: string;
}

export interface LarkSyncResult {
  success: boolean;
  projectCount?: number;
  reason?: string;
}

// Persisted Lark source URL is the single field the user configures; the
// rest of the sync flow derives from it.
export function loadLarkUrlFromDisk(): string | null {
  logger.info(LOG_SCOPE, "loadLarkUrlFromDisk — entry");
  const stored = getPersistedValue(APP_VALUE_KEYS.vaultLarkUrl);
  const isMissing = stored === null;
  // Empty disk state — caller should prompt for URL. Once the user enters it
  // once, it's persisted here and never asked again (no source/.env baking).
  if (isMissing) {
    logger.info(LOG_SCOPE, "loadLarkUrlFromDisk — no url on disk");
    return null;
  }
  logger.info(LOG_SCOPE, "loadLarkUrlFromDisk — url restored");
  return stored;
}

// One-time cleanup: earlier builds baked the doc URL as a default and a
// sync persisted its full plaintext to disk. Now that the passphrase flow
// is the intended path, wipe any persisted value that matches the secret
// doc (decrypted at runtime — never compared against a plaintext literal in
// source). Other URLs the user saved on purpose are left untouched.
export async function cleanupResidualLarkUrl(): Promise<void> {
  const stored = getPersistedValue(APP_VALUE_KEYS.vaultLarkUrl);
  if (stored === null) return;
  const secret = await decryptDocUrl("PENGUIN");
  if (secret !== null && stored === secret) {
    deletePersistedValue(APP_VALUE_KEYS.vaultLarkUrl);
    useAppStore.getState().setVaultLarkUrl(null);
    logger.info(LOG_SCOPE, "cleanupResidualLarkUrl — cleared residual plaintext doc url");
  }
}

// Persist Lark source URL and mirror into the Zustand store so the UI sees
// the change without a reload.
export function saveLarkUrl(payload: { url: string }): { success: boolean } {
  logger.info(LOG_SCOPE, "saveLarkUrl — entry");
  try {
    // The sync-hash anchor (vaultLastSyncedHash / ...ContentHash) is scoped to
    // the doc it was computed against. When the user points at a DIFFERENT
    // doc, the old anchor no longer applies — leaving it on disk makes the
    // next push compare the new doc's remote hash against the old doc's anchor
    // and mis-fire a "conflict". Clear it on a real URL change only: the normal
    // sync path re-saves the SAME url right before syncing and the anchor must
    // survive that (first-ever save has previous === null → nothing to clear).
    const previous = getPersistedValue(APP_VALUE_KEYS.vaultLarkUrl);
    const urlChanged = previous !== null && previous !== payload.url;
    setPersistedValue(APP_VALUE_KEYS.vaultLarkUrl, payload.url);
    // Switched to a different doc — drop the previous doc's anchors so the next
    // push starts from a clean (no-conflict) baseline.
    if (urlChanged) {
      deletePersistedValue(APP_VALUE_KEYS.vaultLastSyncedHash);
      deletePersistedValue(APP_VALUE_KEYS.vaultLastSyncedContentHash);
      deletePersistedValue(APP_VALUE_KEYS.vaultLarkUrlLocked);
      logger.info(LOG_SCOPE, "saveLarkUrl — url changed; cleared stale sync hashes");
    }
    useAppStore.getState().setVaultLarkUrl(payload.url);
    logger.info(LOG_SCOPE, "saveLarkUrl — saved");
    return { success: true };
  } catch (error) {
    logger.error(LOG_SCOPE, "saveLarkUrl — disk write failed", error);
    return { success: false };
  }
}

// Restore the last-synced timestamp on app start so the empty state can show
// "synced 3 min ago" without a fresh fetch.
export function loadLastSyncedAtFromDisk(): number | null {
  const stored = getPersistedValue(APP_VALUE_KEYS.vaultLastSyncedAt);
  const isMissing = stored === null;
  // No sync has ever happened — leave timestamp null.
  if (isMissing) return null;
  const parsed = Number(stored);
  const isInvalid = Number.isNaN(parsed);
  // Disk value corrupted somehow — treat as never-synced and move on.
  if (isInvalid) return null;
  return parsed;
}

// Shell metacharacters that zsh interprets inside double quotes — `$` triggers
// command substitution ($(…)) and variable expansion, backtick triggers legacy
// command substitution, others can break out of quoting via newlines or other
// special chars. The URL is interpolated into `lark-cli --doc "<url>"` inside a
// zsh -c script, so any of these in the URL = arbitrary command execution.
const SHELL_METACHAR_REGEX = /[$`;&|()<>\\\n\r\t"']/;

// Validate the URL shape before we hand it to a shell command. Only Lark
// Suite / Feishu hosts are accepted, AND the URL must not contain any shell
// metacharacter — JSON.stringify quoting alone does NOT protect against zsh
// command substitution inside double quotes.
export function validateLarkUrl(payload: { url: string }): LarkUrlValidationResult {
  const trimmed = payload.url.trim();
  const isEmpty = trimmed.length === 0;
  if (isEmpty) return { success: false, reason: "URL is empty" };
  const isLarkHost = LARK_HOST_REGEX.test(trimmed);
  // Restrict shell execution to known Lark hosts.
  if (!isLarkHost) {
    return {
      success: false,
      reason: "URL must be a Lark Suite or Feishu link (larksuite.com / feishu.cn)",
    };
  }
  const hasShellMetachar = SHELL_METACHAR_REGEX.test(trimmed);
  // Defense-in-depth — well-formed Lark URLs never contain these characters,
  // but a crafted URL could otherwise execute commands via $(…) inside the
  // double-quoted shell argument.
  if (hasShellMetachar) {
    return {
      success: false,
      reason: "URL contains characters that could be interpreted by the shell",
    };
  }
  return { success: true };
}

// A short passphrase can stand in for the full Lark doc URL. The real URL
// ships ONLY as AES-GCM ciphertext (below) — never in plaintext source or
// .env — decryptable with the passphrase the user types. So the user can
// enter e.g. "PENGUIN" instead of pasting/remembering the link.
const ENCRYPTED_DOC_BLOB_B64 =
  "rbA17eHrN7wHQVq+TEDa8CY0YpEuGY+Div7P7RzWzxouyrMaDPgy5mGPhMevEPmoP6rc3uUjtXyqQljLTR5dwXBUA4BSxN8BwFlfkKZvAiRgRkFxSLBzjHCQikzVyCDi";

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Decrypt the baked doc URL with `passphrase` (key = SHA-256(passphrase),
// AES-GCM, IV prepended). Returns the URL on success, or null when the
// passphrase is wrong (GCM auth failure) or the output isn't a Lark URL.
async function decryptDocUrl(passphrase: string): Promise<string | null> {
  try {
    const keyBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(passphrase));
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
    const blob = base64ToBytes(ENCRYPTED_DOC_BLOB_B64);
    const iv = blob.slice(0, 12);
    const ciphertext = blob.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    const text = new TextDecoder().decode(plaintext);
    return LARK_HOST_REGEX.test(text) ? text : null;
  } catch {
    return null;
  }
}

// Resolve the sync source: a real Lark URL passes through unchanged; anything
// else is treated as a decryption passphrase for the baked default doc. Falls
// back to the raw input (so validation can surface a clear error) when it's
// neither a URL nor a valid passphrase.
// Exported so the push pipeline (vault-push.ts) resolves passphrases the same
// way sync does — otherwise a passphrase-configured vault can sync but not push.
export async function resolveLarkSource(input: string): Promise<string> {
  const trimmed = input.trim();
  if (LARK_HOST_REGEX.test(trimmed)) return trimmed;
  const decrypted = await decryptDocUrl(trimmed);
  return decrypted ?? trimmed;
}

// Orchestrate: shell-fetch → extract JSON block → parse → persist → set store.
// Each step is logged so failures surface in the project logger.
export async function syncVaultFromLark(payload: { url: string }): Promise<LarkSyncResult> {
  logger.info(LOG_SCOPE, "syncVaultFromLark — entry");
  // Allow a passphrase (e.g. "PENGUIN") in place of the full URL.
  const resolvedUrl = await resolveLarkSource(payload.url);
  const urlCheck = validateLarkUrl({ url: resolvedUrl });
  const isBadUrl = !urlCheck.success;
  // URL rejected before any shell call — surface the reason verbatim.
  if (isBadUrl) {
    logger.warn(LOG_SCOPE, `syncVaultFromLark — url rejected: ${urlCheck.reason ?? "invalid"}`);
    return { success: false, reason: urlCheck.reason };
  }
  const fetchResult = await runLarkFetch({ url: resolvedUrl });
  const fetchFailed = !fetchResult.success;
  // Shell-out failed — bubble up the underlying reason for the toast.
  if (fetchFailed) {
    logger.warn(LOG_SCOPE, `syncVaultFromLark — fetch failed: ${fetchResult.reason ?? "unknown"}`);
    return { success: false, reason: fetchResult.reason };
  }
  const extractResult = await extractVaultJsonFromMarkdown({
    markdown: fetchResult.markdown ?? "",
  });
  const noJsonBlock = !extractResult.success;
  // Doc fetched but no ```json``` code block was found inside.
  if (noJsonBlock) {
    logger.warn(LOG_SCOPE, `syncVaultFromLark — extract failed: ${extractResult.reason ?? "no json block"}`);
    return { success: false, reason: extractResult.reason };
  }
  const parseResult = parseVaultJson({ text: extractResult.json ?? "" });
  const isInvalidSchema = !parseResult.success;
  // JSON extracted but the schema does not match VaultProject[].
  if (isInvalidSchema) {
    logger.warn(LOG_SCOPE, `syncVaultFromLark — parse failed: ${parseResult.reason ?? "invalid schema"}`);
    return { success: false, reason: parseResult.reason };
  }
  useAppStore.getState().setVaultProjects(parseResult.projects);
  useAppStore.getState().setVaultIsDirty(false);
  const persist = persistVaultToDisk({ projects: parseResult.projects });
  const persistFailed = !persist.success;
  // Persist failed but in-memory data is good — flag a warning, do not abort.
  if (persistFailed) {
    logger.warn(LOG_SCOPE, "syncVaultFromLark — in-memory updated but disk persist failed");
  }
  const now = Date.now();
  useAppStore.getState().setVaultLastSyncedAt(now);
  setPersistedValue(APP_VALUE_KEYS.vaultLastSyncedAt, String(now));
  // Sprint 3 — DEC #80 + #82: lock URL anchor + persist SHA-256 of fetched markdown.
  setPersistedValue(APP_VALUE_KEYS.vaultLarkUrlLocked, payload.url);
  const markdown = fetchResult.markdown ?? "";
  const hash = await computeMarkdownSha256(markdown);
  setPersistedValue(APP_VALUE_KEYS.vaultLastSyncedHash, hash);
  const contentHash = await computeMarkdownSha256(JSON.stringify(parseResult.projects));
  setPersistedValue(APP_VALUE_KEYS.vaultLastSyncedContentHash, contentHash);
  logger.info(
    LOG_SCOPE,
    `syncVaultFromLark — synced ${parseResult.projects.length} project(s)`,
  );
  return { success: true, projectCount: parseResult.projects.length };
}

// SHA-256 hex over the fetched markdown so the push pipeline can detect
// external Lark edits before overwriting. Web Crypto is available in Tauri.
async function computeMarkdownSha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface LarkFetchResult {
  success: boolean;
  markdown?: string;
  reason?: string;
}

// Shell out via zsh-login (Tauri-permitted) and run lark-cli. URL is quoted
// with JSON.stringify which produces a safe double-quoted string for zsh
// since we already validated the host above.
// Exported so the Sprint 3 push pipeline can re-fetch before overwriting.
export async function runLarkFetch(payload: { url: string }): Promise<LarkFetchResult> {
  logger.info(LOG_SCOPE, "runLarkFetch — entry");
  const { Command } = await import("@tauri-apps/plugin-shell");
  const quotedUrl = JSON.stringify(payload.url);
  const script = `${NODE_PATH_SETUP}; lark-cli docs +fetch --doc ${quotedUrl} --format pretty`;
  const cmd = Command.create("lark-fetch", ["-l", "-c", script]);
  const startedAt = Date.now();
  try {
    const childPromise = cmd.execute();
    const timeoutPromise = new Promise<LarkFetchResult>((_resolve, reject) => {
      setTimeout(() => reject(new Error("lark-cli timeout")), LARK_FETCH_TIMEOUT_MS);
    });
    const child = await Promise.race([
      childPromise,
      timeoutPromise as unknown as ReturnType<typeof cmd.execute>,
    ]);
    const isExitNonZero = child.code !== 0;
    // lark-cli returned non-zero — likely auth missing or doc inaccessible.
    if (isExitNonZero) {
      const stderr = child.stderr.trim().slice(0, 400);
      logger.warn(LOG_SCOPE, `runLarkFetch — lark-cli exit ${child.code}: ${stderr}`);
      return {
        success: false,
        reason: `lark-cli exited ${child.code}. ${stderr || "Check 'lark-cli auth status'."}`,
      };
    }
    const elapsed = Date.now() - startedAt;
    logger.info(LOG_SCOPE, `runLarkFetch — fetched in ${elapsed}ms`);
    return { success: true, markdown: child.stdout };
  } catch (error) {
    logger.error(LOG_SCOPE, "runLarkFetch — shell execution failed", error);
    const message = error instanceof Error ? error.message : "shell error";
    return { success: false, reason: message };
  }
}

export interface LarkUpdateResult {
  success: boolean;
  reason?: string;
}

// Shell out via zsh-login (Tauri-permitted) and run lark-cli docs +update.
// Markdown is piped through stdin to avoid argument-length limits and to
// keep the body out of the visible process argv. URL is validated by the
// caller (vault-push.ts) before reaching this function.
export async function runLarkUpdate(payload: {
  url: string;
  markdown: string;
}): Promise<LarkUpdateResult> {
  logger.info(LOG_SCOPE, "runLarkUpdate — entry");
  try {
    const { Command } = await import("@tauri-apps/plugin-shell");
    const quotedUrl = JSON.stringify(payload.url);
    // lark-cli 1.0.30+ rejects `--markdown -` (stdin) at the validation layer,
    // and Tauri's Command.execute() does not expose a stdin writer, so we feed
    // markdown via a zsh heredoc piped into `--markdown -`. The delimiter is
    // randomized to make collision with credential values (~0% chance) safe.
    const delimiter = `PENGUIN_VAULT_${Math.random().toString(36).slice(2, 10).toUpperCase()}_EOF`;
    const collisionFreeMarkdown = sanitizeHeredocBody({
      markdown: payload.markdown,
      delimiter,
    });
    const script =
      `${NODE_PATH_SETUP}; ` +
      `lark-cli docs +update --doc ${quotedUrl} --mode overwrite --markdown - <<'${delimiter}'\n` +
      `${collisionFreeMarkdown}\n` +
      `${delimiter}`;
    const cmd = Command.create("lark-update", ["-l", "-c", script], {
      encoding: "utf-8",
    });
    const childPromise = cmd.execute();
    const timeoutPromise = new Promise<LarkUpdateResult>((_resolve, reject) => {
      setTimeout(() => reject(new Error("lark-cli timeout")), LARK_FETCH_TIMEOUT_MS);
    });
    const child = await Promise.race([
      childPromise,
      timeoutPromise as unknown as ReturnType<typeof cmd.execute>,
    ]);
    const isExitNonZero = child.code !== 0;
    // lark-cli returned non-zero — surface stderr so the user sees auth/perm hints.
    if (isExitNonZero) {
      const stderr = child.stderr.trim().slice(0, 400);
      logger.warn(LOG_SCOPE, `runLarkUpdate — lark-cli exit ${child.code}: ${stderr}`);
      return {
        success: false,
        reason: `lark-cli exited ${child.code}. ${stderr || "Check 'lark-cli auth status'."}`,
      };
    }
    logger.info(LOG_SCOPE, "runLarkUpdate — push ok");
    return { success: true };
  } catch (error) {
    logger.error(LOG_SCOPE, "runLarkUpdate — shell execution failed", error);
    const message = error instanceof Error ? error.message : "shell error";
    return { success: false, reason: message };
  }
}

// Guard against the impossible-but-paranoid case where the markdown body
// happens to contain a line equal to our heredoc delimiter — would prematurely
// terminate the heredoc and corrupt the push. We swap any such line.
function sanitizeHeredocBody(payload: { markdown: string; delimiter: string }): string {
  const lines = payload.markdown.split("\n");
  const safeLines = lines.map((line) => {
    const trimmedLine = line.trimEnd();
    const isDelimiterLine = trimmedLine === payload.delimiter;
    // Append a zero-width space so the delimiter no longer matches exactly
    // when zsh scans for the heredoc terminator. Reader sees the same content.
    if (isDelimiterLine) return `${line} `;
    return line;
  });
  return safeLines.join("\n");
}

export interface ExtractJsonResult {
  success: boolean;
  json?: string;
  reason?: string;
}

export async function extractVaultJsonFromMarkdown(payload: {
  markdown: string;
  tokens?: VaultCryptoTokens;
}): Promise<ExtractJsonResult> {
  const extracted = extractJsonFromMarkdown({ markdown: payload.markdown });
  if (!extracted.success) return extracted;
  const rawJson = extracted.json ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    // Legacy plaintext path: parseVaultJson owns the final schema error.
    return extracted;
  }
  if (!isVaultEncryptedEnvelope(parsed)) return extracted;
  const decrypted = await decryptVaultJson({
    envelope: parsed,
    tokens: payload.tokens ?? getVaultCryptoTokensFromStoredDevToken(),
  });
  if (!decrypted.success) {
    return {
      success: false,
      reason: decrypted.reason,
    };
  }
  return {
    success: true,
    json: decrypted.plaintext,
  };
}

function getVaultCryptoTokensFromStoredDevToken(): VaultCryptoTokens {
  const token =
    getInMemoryDevToken() ?? getPersistedValue(APP_VALUE_KEYS.devModeToken);
  return getVaultCryptoTokensFromToken(token);
}

// Find the first ```json fenced block in the markdown and return its body.
// Multiple blocks are ignored — caller can re-run sync after editing.
export function extractJsonFromMarkdown(payload: { markdown: string }): ExtractJsonResult {
  const match = JSON_BLOCK_REGEX.exec(payload.markdown);
  const noMatch = match === null;
  // No fenced JSON block — Lark doc must contain ```json … ```.
  if (noMatch) {
    return {
      success: false,
      reason: "no ```json code block found in Lark doc",
    };
  }
  const inner = match[1].trim();
  const isEmpty = inner.length === 0;
  // Block was found but empty inside the fences.
  if (isEmpty) return { success: false, reason: "json code block is empty" };
  return { success: true, json: inner };
}
