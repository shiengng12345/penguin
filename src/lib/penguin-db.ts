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

export async function setAppValueInDatabase(
  key: string,
  value: string,
): Promise<boolean> {
  if (shouldSkipDatabase()) return false;
  try {
    await invoke("db_set_app_value", { key, value });
    return true;
  } catch {
    databaseUnavailable = true;
    return false;
  }
}

export async function getAppValueFromDatabase(key: string): Promise<string | null> {
  if (shouldSkipDatabase()) return null;
  try {
    return await invoke<string | null>("db_get_app_value", { key });
  } catch {
    databaseUnavailable = true;
    return null;
  }
}

export async function loadAppValuesFromDatabase(): Promise<Record<string, string>> {
  if (shouldSkipDatabase()) return {};
  try {
    return await invoke<Record<string, string>>("db_list_app_values");
  } catch {
    databaseUnavailable = true;
    return {};
  }
}

export async function deleteAppValueFromDatabase(key: string): Promise<boolean> {
  if (shouldSkipDatabase()) return false;
  try {
    await invoke("db_delete_app_value", { key });
    return true;
  } catch {
    databaseUnavailable = true;
    return false;
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
