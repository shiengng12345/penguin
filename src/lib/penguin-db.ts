import { invoke } from "@tauri-apps/api/core";
import type { SavedRequest } from "./store";

let databaseUnavailable = false;

function shouldSkipDatabase(): boolean {
  return databaseUnavailable || typeof window === "undefined";
}

export async function persistSavedRequest(entry: SavedRequest): Promise<void> {
  if (shouldSkipDatabase()) return;
  try {
    await invoke("db_upsert_saved_request", { entry });
  } catch {
    databaseUnavailable = true;
  }
}

export async function persistSavedRequests(entries: SavedRequest[]): Promise<void> {
  if (shouldSkipDatabase()) return;
  for (const entry of entries) {
    await persistSavedRequest(entry);
    if (databaseUnavailable) return;
  }
}

export async function loadSavedRequestsFromDatabase(): Promise<SavedRequest[]> {
  if (shouldSkipDatabase()) return [];
  try {
    return await invoke<SavedRequest[]>("db_list_saved_requests");
  } catch {
    databaseUnavailable = true;
    return [];
  }
}

export async function deleteSavedRequestFromDatabase(id: string): Promise<void> {
  if (shouldSkipDatabase()) return;
  try {
    await invoke("db_delete_saved_request", { id });
  } catch {
    databaseUnavailable = true;
  }
}

export async function renameSavedRequestInDatabase(
  id: string,
  name: string,
): Promise<void> {
  if (shouldSkipDatabase()) return;
  try {
    await invoke("db_rename_saved_request", { id, name });
  } catch {
    databaseUnavailable = true;
  }
}
