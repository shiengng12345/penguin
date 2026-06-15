// Sprint 10 Phase 10C — REST request history.
//
// Stores the last N sends as a JSON array in app_kv. We don't write to the
// pre-existing `request_history` SQLite table because that schema is gRPC-
// shaped (method_full_name / service_name / package_name columns that don't
// map to REST). Switching to SQLite is a Phase 10D upgrade — the UI doesn't
// change when storage swaps because callers go through these three helpers.

import { logger } from "@/lib/logger";
import { getPersistedValue, setPersistedValue } from "@/lib/app-persistence";
import type {
  RestAuth,
  RestBody,
  RestHeader,
  RestMethod,
  RestQueryParam,
} from "./rest-types";

const LOG_SCOPE = "rest-history";
const KEY = "penguin-rest-history";
// Cap at 200 — enough to recover "the request I sent half an hour ago"
// without bloating the app_kv blob / hydration cost on REST module open.
const MAX_ENTRIES = 200;

/// Snapshot of a request at the moment of send — sufficient to recreate it
/// in a new tab. Auth only carries the keychain HANDLE id, not plaintext.
export interface RestHistorySnapshot {
  method: RestMethod;
  url: string;
  headers: RestHeader[];
  queryParams: RestQueryParam[];
  body?: RestBody;
  auth?: RestAuth;
  followRedirects: boolean;
  timeoutMs?: number;
}

export interface RestHistoryEntry {
  id: string;
  timestamp: number;
  // Status 0 means the request never returned a status — canceled by the
  // user, network error, or timeout.
  status: number;
  elapsedMs: number;
  bodyBytes: number;
  requestName: string;
  // Where the request was stored when it ran — null if it was a one-off in
  // an unsaved tab (currently REST always associates with a collection, but
  // keep nullable for future "draft" mode).
  collectionId: string | null;
  // Full replay snapshot.
  snapshot: RestHistorySnapshot;
}

function newId(): string {
  return `hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadHistory(): RestHistoryEntry[] {
  const raw = getPersistedValue(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as RestHistoryEntry[];
  } catch (error) {
    logger.warn(LOG_SCOPE, "loadHistory — invalid JSON", { error: String(error) });
    return [];
  }
}

export function appendHistory(entry: Omit<RestHistoryEntry, "id" | "timestamp">): RestHistoryEntry {
  const stamped: RestHistoryEntry = {
    ...entry,
    id: newId(),
    timestamp: Date.now(),
  };
  // Newest first — UI just renders top-down. Trim from the END so oldest
  // get dropped first.
  const list = [stamped, ...loadHistory()].slice(0, MAX_ENTRIES);
  setPersistedValue(KEY, JSON.stringify(list));
  return stamped;
}

export function clearHistory(): void {
  setPersistedValue(KEY, "[]");
}

export function deleteHistoryEntry(id: string): RestHistoryEntry[] {
  const next = loadHistory().filter((e) => e.id !== id);
  setPersistedValue(KEY, JSON.stringify(next));
  return next;
}
