import { logger } from "@/lib/logger";
import {
  deletePersistedValue,
  getPersistedValue,
  setPersistedValue,
} from "@/lib/app-persistence";
import { APP_VALUE_KEYS } from "@/lib/persistence-keys";
import { useAppStore } from "@/lib/store";
import type {
  VaultCredential,
  VaultCredentialKind,
  VaultProject,
} from "./types";

const LOG_SCOPE = "vault-storage";

// Bumped to v2 in Sprint 4 — Sprint 3 shape had `categories: VaultCategory[]`
// nested on each project; Sprint 4 flattens credentials onto the project.
// Old persisted blobs are wiped on first load so the user starts clean.
const VAULT_SCHEMA_VERSION = "2";

const VAULT_KINDS: readonly VaultCredentialKind[] = [
  "link",
  "token",
  "database",
  "cache",
  "generic",
  "vault",
  "argocd",
  "monitoring",
  "web",
  "api",
  "login",
];
export interface VaultLoadResult {
  success: boolean;
  loaded: boolean;
}

export interface VaultParseResult {
  success: boolean;
  projects: VaultProject[];
  reason?: string;
}

// Schema version check + legacy wipe. Runs once at load time. Detects
// pre-Sprint-4 blobs by either the missing version marker OR by an outdated
// version string, then drops every vault-scoped persisted key so the user
// starts from a clean Lark setup state.
function ensureSchemaCurrent(): void {
  const stored = getPersistedValue(APP_VALUE_KEYS.vaultSchemaVersion);
  const isCurrent = stored === VAULT_SCHEMA_VERSION;
  // Already on the current schema — no-op.
  if (isCurrent) return;
  logger.warn(
    LOG_SCOPE,
    `ensureSchemaCurrent — wiping legacy vault data (stored=${stored ?? "none"} target=${VAULT_SCHEMA_VERSION})`,
  );
  deletePersistedValue(APP_VALUE_KEYS.vaultData);
  deletePersistedValue(APP_VALUE_KEYS.vaultLarkUrl);
  deletePersistedValue(APP_VALUE_KEYS.vaultLastSyncedAt);
  deletePersistedValue(APP_VALUE_KEYS.vaultLarkUrlLocked);
  deletePersistedValue(APP_VALUE_KEYS.vaultLastSyncedHash);
  setPersistedValue(APP_VALUE_KEYS.vaultSchemaVersion, VAULT_SCHEMA_VERSION);
}

// Read previously persisted vault data from SQLite plugin-store. Called once
// when the Vault page mounts so the in-memory store mirrors disk.
export async function loadVaultFromDisk(): Promise<VaultLoadResult> {
  logger.info(LOG_SCOPE, "loadVaultFromDisk — entry");
  try {
    ensureSchemaCurrent();
    const raw = getPersistedValue(APP_VALUE_KEYS.vaultData);
    const isMissing = raw === null;
    // No vault data on disk yet — first-time user; leave store at default [].
    if (isMissing) {
      logger.info(LOG_SCOPE, "loadVaultFromDisk — no vault data on disk");
      return { success: true, loaded: false };
    }
    const parseResult = parseVaultJson({ text: raw });
    const isBadShape = !parseResult.success;
    // Disk content failed schema validation — keep the in-memory store empty
    // rather than crashing the Vault view.
    if (isBadShape) {
      logger.warn(
        LOG_SCOPE,
        `loadVaultFromDisk — invalid persisted vault payload: ${parseResult.reason ?? "unknown"}`,
      );
      return { success: false, loaded: false };
    }
    useAppStore.getState().setVaultProjects(parseResult.projects);
    logger.info(
      LOG_SCOPE,
      `loadVaultFromDisk — restored ${parseResult.projects.length} project(s)`,
    );
    return { success: true, loaded: true };
  } catch (error) {
    logger.error(LOG_SCOPE, "loadVaultFromDisk — disk read failed", error);
    return { success: false, loaded: false };
  }
}

// Persist the current in-memory vault to SQLite plugin-store. Called by CRUD
// writers and the Lark sync pipeline; export does NOT persist.
export function persistVaultToDisk(payload: { projects: VaultProject[] }): {
  success: boolean;
} {
  logger.info(LOG_SCOPE, "persistVaultToDisk — entry");
  try {
    const serialized = JSON.stringify(payload.projects);
    setPersistedValue(APP_VALUE_KEYS.vaultData, serialized);
    setPersistedValue(APP_VALUE_KEYS.vaultSchemaVersion, VAULT_SCHEMA_VERSION);
    logger.info(
      LOG_SCOPE,
      `persistVaultToDisk — wrote ${payload.projects.length} project(s)`,
    );
    return { success: true };
  } catch (error) {
    logger.error(LOG_SCOPE, "persistVaultToDisk — disk write failed", error);
    return { success: false };
  }
}

// Validate user-supplied JSON against the VaultProject[] shape. Rejects
// anything that does not look like our schema — never throws. Sprint 4 shape
// requires `credentials: VaultCredential[]` flat on the project (no categories).
export function parseVaultJson(payload: { text: string }): VaultParseResult {
  logger.info(LOG_SCOPE, "parseVaultJson — entry");
  try {
    const parsed: unknown = JSON.parse(payload.text);
    const isArray = Array.isArray(parsed);
    // Top-level must be an array of projects — refuse object-wrapped formats.
    if (!isArray) {
      logger.warn(LOG_SCOPE, "parseVaultJson — top-level is not an array");
      return { success: false, projects: [], reason: "top-level must be an array" };
    }
    const projects: VaultProject[] = [];
    const total = parsed.length;
    for (let index = 0; index < total; index += 1) {
      const candidate = parsed[index];
      const validation = validateProject(candidate);
      const isInvalid = !validation.success;
      // Any malformed project rejects the whole file — partial imports are
      // unsafe because subsequent writes would persist a half-valid blob.
      if (isInvalid) {
        logger.warn(
          LOG_SCOPE,
          `parseVaultJson — project at index ${index} invalid: ${validation.reason ?? "unknown"}`,
        );
        return {
          success: false,
          projects: [],
          reason: `project[${index}]: ${validation.reason ?? "invalid"}`,
        };
      }
      projects.push(validation.project as VaultProject);
    }
    logger.info(LOG_SCOPE, `parseVaultJson — parsed ${projects.length} project(s)`);
    return { success: true, projects };
  } catch (error) {
    logger.error(LOG_SCOPE, "parseVaultJson — JSON.parse failed", error);
    return { success: false, projects: [], reason: "not valid JSON" };
  }
}

interface ValidateProjectResult {
  success: boolean;
  project?: VaultProject;
  reason?: string;
}

// Narrow an unknown JSON value into a Sprint 4 VaultProject. Required fields:
// id, name, environments[], credentials[]. Legacy projects shaped with
// `categories` instead of `credentials` are rejected here — caller wipes them.
function validateProject(input: unknown): ValidateProjectResult {
  const isObject = typeof input === "object" && input !== null;
  if (!isObject) return { success: false, reason: "not an object" };
  const record = input as Record<string, unknown>;
  const hasValidId = typeof record.id === "string" && record.id.length > 0;
  if (!hasValidId) return { success: false, reason: "missing string id" };
  const hasValidName = typeof record.name === "string";
  if (!hasValidName) return { success: false, reason: "missing string name" };
  const environments = record.environments;
  const envIsArray = Array.isArray(environments);
  if (!envIsArray) return { success: false, reason: "environments must be array" };
  const credentials = record.credentials;
  const credIsArray = Array.isArray(credentials);
  if (!credIsArray) return { success: false, reason: "credentials must be array (Sprint 4 shape)" };

  for (let index = 0; index < credentials.length; index += 1) {
    const check = validateCredential(credentials[index]);
    const isBad = !check.success;
    if (isBad) return { success: false, reason: `credentials[${index}]: ${check.reason ?? "invalid"}` };
  }

  return {
    success: true,
    project: {
      id: record.id as string,
      name: record.name as string,
      environments: environments as VaultProject["environments"],
      credentials: credentials as VaultProject["credentials"],
    },
  };
}

interface ValidateCredentialResult {
  success: boolean;
  reason?: string;
}

function validateCredential(input: unknown): ValidateCredentialResult {
  const isObject = typeof input === "object" && input !== null;
  if (!isObject) return { success: false, reason: "not an object" };
  const record = input as Record<string, unknown>;
  const hasValidId = typeof record.id === "string" && record.id.length > 0;
  if (!hasValidId) return { success: false, reason: "missing string id" };
  const isKindString = typeof record.kind === "string";
  const isKindKnown = isKindString && VAULT_KINDS.includes(record.kind as VaultCredentialKind);
  if (!isKindKnown) return { success: false, reason: `unknown kind '${String(record.kind)}'` };
  const hasName = typeof record.name === "string";
  if (!hasName) return { success: false, reason: "missing string name" };
  const valueByEnv = record.valueByEnv;
  const valueIsObject = typeof valueByEnv === "object" && valueByEnv !== null;
  if (!valueIsObject) return { success: false, reason: "valueByEnv must be object" };
  const isSensitive = typeof record.isSensitive === "boolean";
  if (!isSensitive) return { success: false, reason: "isSensitive must be boolean" };
  // Type-only assignment — confirms VaultCredential satisfies the input shape.
  const _credentialUsed: VaultCredential = {
    id: record.id as string,
    kind: record.kind as VaultCredentialKind,
    name: record.name as string,
    valueByEnv: valueByEnv as VaultCredential["valueByEnv"],
    isSensitive: record.isSensitive as boolean,
  };
  void _credentialUsed;
  return { success: true };
}
