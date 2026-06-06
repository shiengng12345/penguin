// Vault → Lark push pipeline (Sprint 3 DEC #81, #82, #95; Sprint 5 backup
// ring removed). Orchestration: validate URL → fetch remote → SHA-256 compare
// to expected → serialize local → lark-cli +update overwrite → recompute hash
// → persist new hash. Conflict detection short-circuits before any shell
// write so the user always sees a Conflict Modal before destruction.

import { logger } from "@/lib/logger";
import { setPersistedValue } from "@/lib/app-persistence";
import { APP_VALUE_KEYS } from "@/lib/persistence-keys";
import { requireSuperAdmin } from "@/lib/dev-mode-store";
import {
  extractJsonFromMarkdown,
  runLarkFetch,
  runLarkUpdate,
  validateLarkUrl,
} from "./vault-lark";
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
  const urlCheck = validateLarkUrl({ url: payload.url });
  const isBadUrl = !urlCheck.success;
  // URL rejected before any shell call — surface the reason for the toast.
  if (isBadUrl) {
    logger.warn(LOG_SCOPE, `pushToLark — url rejected: ${urlCheck.reason ?? "invalid"}`);
    return { success: false, reason: urlCheck.reason ?? "invalid url" };
  }
  const fetchResult = await runLarkFetch({ url: payload.url });
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
    const extracted = extractJsonFromMarkdown({ markdown: remoteMarkdown });
    const remoteJson = extracted.success ? extracted.json ?? "" : "";
    logger.warn(LOG_SCOPE, "pushToLark — hash mismatch, conflict surfaced");
    return { success: false, reason: "conflict", remoteJson, remoteHash };
  }
  const markdown = serializeVaultMarkdown({ projects: payload.projects });
  const update = await runLarkUpdate({ url: payload.url, markdown });
  const pushFailed = !update.success;
  // Shell-out failed — keep local state unchanged so the user can retry.
  if (pushFailed) {
    logger.error(LOG_SCOPE, `pushToLark — lark-cli update failed: ${update.reason ?? "unknown"}`);
    return { success: false, reason: update.reason ?? "update failed" };
  }
  const newHash = await sha256Hex({ text: markdown });
  setPersistedValue(APP_VALUE_KEYS.vaultLastSyncedHash, newHash);
  setPersistedValue(APP_VALUE_KEYS.vaultLarkUrlLocked, payload.url);
  logger.info(LOG_SCOPE, "pushToLark — exit");
  return { success: true, hash: newHash };
}

