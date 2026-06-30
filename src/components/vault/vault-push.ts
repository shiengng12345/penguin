// Vault → Lark push pipeline (Sprint 3 DEC #81, #82, #95; Sprint 5 backup
// ring removed). Orchestration: resolve passphrase → validate URL → fetch
// remote → SHA-256 compare to expected → serialize local → lark-cli +update
// overwrite → recompute hash → persist new hash. On a hash mismatch the push
// short-circuits before any shell write and returns a { reason: "conflict" }
// result (with remoteJson/remoteHash) so the caller can resolve it.
// NOTE: encryption-at-rest is temporarily disabled — push writes the readable
// plaintext vault. See the TEMP block in pushToLark (pending redesign).

import { logger } from "@/lib/logger";
import { getPersistedValue, setPersistedValue } from "@/lib/app-persistence";
import { APP_VALUE_KEYS } from "@/lib/persistence-keys";
import {
  getInMemoryDevToken,
  getStoredDeveloperModeTokens,
  requireSuperAdmin,
} from "@/lib/dev-mode-store";
import {
  // extractJsonFromMarkdown, // (re-enable with extractEncryptedEnvelopeFromMarkdown when encryption returns)
  extractVaultJsonFromMarkdown,
  resolveLarkSource,
  runLarkFetch,
  runLarkUpdate,
  validateLarkUrl,
} from "./vault-lark";
import {
  encryptVaultJson,
  getVaultCryptoTokensFromToken,
  // isVaultEncryptedEnvelope, // (re-enable with extractEncryptedEnvelopeFromMarkdown when encryption returns)
  reencryptVaultJson,
  type VaultEncryptedEnvelope,
  type VaultCryptoTokens,
} from "./vault-crypto";
import type { VaultProject } from "./types";

const LOG_SCOPE = "vault-push";
const PUSH_TITLE_FALLBACK = "Source of Truth";

export type PushResult =
  | { success: true; hash: string }
  | { success: false; reason: "conflict"; remoteJson: string; remoteHash: string }
  | { success: false; reason: string };

export interface PushToLarkPayload {
  url: string;
  projects: VaultProject[];
  expectedHash: string | null;
}

// SHA-256 hex over UTF-8 text. Web Crypto is available in Tauri webview.
export async function sha256Hex(payload: { text: string }): Promise<string> {
  const data = new TextEncoder().encode(payload.text);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Build the markdown body we overwrite the Lark doc with. Mirror the layout
// used by the Newport doc so a human editor sees a friendly heading, blurb,
// and one ```json fence the sync pipeline can read back.
export interface SerializeMarkdownPayload {
  projects: VaultProject[];
}
export function serializeVaultMarkdown(payload: SerializeMarkdownPayload): string {
  const firstName = payload.projects[0]?.name ?? PUSH_TITLE_FALLBACK;
  const heading = `# Penguin Vault — ${firstName}`;
  const blurb =
    "Auto-generated from Penguin. Edit via the app or directly here — the next Sync will overwrite local edits.";
  const json = JSON.stringify(payload.projects, null, 2);
  return `${heading}\n\n${blurb}\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}

export interface SerializeEncryptedMarkdownPayload extends SerializeMarkdownPayload {
  baseEnvelope?: VaultEncryptedEnvelope;
  tokens?: VaultCryptoTokens;
}
export async function serializeEncryptedVaultMarkdown(
  payload: SerializeEncryptedMarkdownPayload,
): Promise<string> {
  const heading = "# Penguin Vault";
  const blurb =
    "Auto-generated encrypted vault data from Penguin. Edit via the app so the envelope stays valid.";
  const plaintext = JSON.stringify(payload.projects);
  let envelope: VaultEncryptedEnvelope;
  if (payload.baseEnvelope !== undefined) {
    const tokens = payload.tokens ?? getVaultCryptoTokensFromStoredDevToken();
    const reencrypted = await reencryptVaultJson({
      envelope: payload.baseEnvelope,
      plaintext,
      tokens,
    });
    if (!reencrypted.success) {
      throw new Error(reencrypted.reason);
    }
    envelope = reencrypted.envelope;
  } else {
    const tokens = payload.tokens ?? await getStoredDeveloperModeTokens();
    if (!hasBothVaultEncryptionTokens(tokens)) {
      throw new Error(
        "Encrypted Lark vault first upload needs both cached developer tokens. Validate both admin and super-admin tokens in Developer Mode once, then retry.",
      );
    }
    envelope = await encryptVaultJson({
      plaintext,
      adminToken: tokens.adminToken,
      superAdminToken: tokens.superAdminToken,
    });
  }
  const json = JSON.stringify(envelope, null, 2);
  return `${heading}\n\n${blurb}\n\n\`\`\`json\n${json}\n\`\`\`\n`;
}

// Push pipeline. Returns a discriminated union the UI can switch on
// (success / conflict / error) without inspecting strings.
export async function pushToLark(payload: PushToLarkPayload): Promise<PushResult> {
  logger.info(LOG_SCOPE, "pushToLark — entry");
  const isAuthorized = requireSuperAdmin();
  const notAuthorized = !isAuthorized;
  // Hard gate — UI should already block this path but defense-in-depth.
  if (notAuthorized) {
    logger.warn(LOG_SCOPE, "pushToLark — caller is not super admin");
    return { success: false, reason: "not authorized" };
  }
  // Resolve a passphrase (e.g. "PENGUIN") to the real Lark URL, mirroring the
  // sync path — push must validate and shell out against the same doc the sync
  // read from, not the raw passphrase the user typed.
  const resolvedUrl = await resolveLarkSource(payload.url);
  const urlCheck = validateLarkUrl({ url: resolvedUrl });
  const isBadUrl = !urlCheck.success;
  // URL rejected before any shell call — surface the reason for the toast.
  if (isBadUrl) {
    logger.warn(LOG_SCOPE, `pushToLark — url rejected: ${urlCheck.reason ?? "invalid"}`);
    return { success: false, reason: urlCheck.reason ?? "invalid url" };
  }
  const fetchResult = await runLarkFetch({ url: resolvedUrl });
  const fetchFailed = !fetchResult.success;
  // Pre-fetch failed — abort push so we don't overwrite an unread remote.
  if (fetchFailed) {
    logger.warn(LOG_SCOPE, `pushToLark — pre-fetch failed: ${fetchResult.reason ?? "unknown"}`);
    return { success: false, reason: fetchResult.reason ?? "pre-fetch failed" };
  }
  const remoteMarkdown = fetchResult.markdown ?? "";
  const remoteHash = await sha256Hex({ text: remoteMarkdown });
  const isConflict = payload.expectedHash !== null && payload.expectedHash !== remoteHash;
  // Remote changed since last sync — bail and let the UI render the conflict modal.
  if (isConflict) {
    const extracted = await extractVaultJsonFromMarkdown({ markdown: remoteMarkdown });
    const remoteJson = extracted.success ? extracted.json ?? "" : "";
    logger.warn(LOG_SCOPE, "pushToLark — hash mismatch, conflict surfaced");
    return { success: false, reason: "conflict", remoteJson, remoteHash };
  }
  // TEMP (encryption-at-rest disabled pending redesign): push the readable
  // PLAINTEXT vault so the Lark doc shows the actual vault instead of an opaque
  // encrypted envelope. Secrets land in the doc in clear text — this is a
  // deliberate, temporary trade-off until the encryption flow is reworked.
  // To restore encryption: delete the plaintext line below and uncomment the
  // block beneath it.
  const markdown = serializeVaultMarkdown({ projects: payload.projects });
  // --- encrypted push (disabled pending redesign) ---
  // let markdown: string;
  // try {
  //   const baseEnvelope = extractEncryptedEnvelopeFromMarkdown(remoteMarkdown);
  //   markdown = await serializeEncryptedVaultMarkdown({
  //     projects: payload.projects,
  //     baseEnvelope: baseEnvelope ?? undefined,
  //   });
  // } catch (error) {
  //   const message = error instanceof Error ? error.message : "vault encryption failed";
  //   logger.error(LOG_SCOPE, `pushToLark — encryption failed: ${message}`);
  //   return { success: false, reason: message };
  // }
  const update = await runLarkUpdate({ url: resolvedUrl, markdown });
  const pushFailed = !update.success;
  // Shell-out failed — keep local state unchanged so the user can retry.
  if (pushFailed) {
    logger.error(LOG_SCOPE, `pushToLark — lark-cli update failed: ${update.reason ?? "unknown"}`);
    return { success: false, reason: update.reason ?? "update failed" };
  }
  const newHash = await sha256Hex({ text: markdown });
  setPersistedValue(APP_VALUE_KEYS.vaultLastSyncedHash, newHash);
  const contentHash = await sha256Hex({ text: JSON.stringify(payload.projects) });
  setPersistedValue(APP_VALUE_KEYS.vaultLastSyncedContentHash, contentHash);
  // Persist the user's raw input (a passphrase like "PENGUIN" stays a
  // passphrase), NOT resolvedUrl — mirrors the sync path and keeps the real
  // Lark URL off disk, which is the entire point of the passphrase scheme.
  setPersistedValue(APP_VALUE_KEYS.vaultLarkUrlLocked, payload.url);
  logger.info(LOG_SCOPE, "pushToLark — exit");
  return { success: true, hash: newHash };
}

function getVaultCryptoTokensFromStoredDevToken(): VaultCryptoTokens {
  const token =
    getInMemoryDevToken() ?? getPersistedValue(APP_VALUE_KEYS.devModeToken);
  return getVaultCryptoTokensFromToken(token);
}

function hasBothVaultEncryptionTokens(tokens: VaultCryptoTokens): boolean {
  return (
    typeof tokens.adminToken === "string" &&
    tokens.adminToken.trim().length > 0 &&
    typeof tokens.superAdminToken === "string" &&
    tokens.superAdminToken.trim().length > 0
  );
}

// Disabled along with the encrypted push path (pending encryption redesign).
// Restore this together with the commented block in pushToLark and the
// extractJsonFromMarkdown / isVaultEncryptedEnvelope imports above.
// function extractEncryptedEnvelopeFromMarkdown(markdown: string): VaultEncryptedEnvelope | null {
//   const extracted = extractJsonFromMarkdown({ markdown });
//   if (!extracted.success) return null;
//   try {
//     const parsed: unknown = JSON.parse(extracted.json ?? "");
//     if (isVaultEncryptedEnvelope(parsed)) return parsed;
//   } catch {
//     return null;
//   }
//   return null;
// }
