// Pure structural diff between local and remote VaultProject trees.
// Used by the Push Confirm Modal to show "Added N / Modified M / Deleted D"
// before the user commits a Lark overwrite (DEC #79, DEC #95). Sprint 4
// flattens credentials onto the project — categoriesChanged removed from the
// result shape; projectsChanged stays.

import type { VaultCredential, VaultProject } from "./types";

export interface VaultDiffResult {
  added: VaultCredential[];
  modified: VaultCredential[];
  deleted: VaultCredential[];
  projectsChanged: boolean;
}

export interface ComputeVaultDiffPayload {
  local: VaultProject[];
  remote: VaultProject[];
}

interface CredentialIndexEntry {
  credential: VaultCredential;
  serialized: string;
}

// Flatten projects → credentials into a single id-keyed map so we can compare
// local and remote trees with one pass each. Sprint 4 ids are unique per
// project; conflicts across projects collapse to the last entry seen.
function indexCredentials(projects: readonly VaultProject[]): Map<string, CredentialIndexEntry> {
  const out = new Map<string, CredentialIndexEntry>();
  for (const project of projects) {
    for (const credential of project.credentials) {
      const serialized = JSON.stringify(credential);
      out.set(credential.id, { credential, serialized });
    }
  }
  return out;
}

function compareProjectIds(payload: ComputeVaultDiffPayload): boolean {
  const localKey = payload.local.map((project) => project.id).sort().join("|");
  const remoteKey = payload.remote.map((project) => project.id).sort().join("|");
  return localKey !== remoteKey;
}

// Diff at credential granularity, by id. Modified = present in both but
// JSON-serialized differs (treat any field change as opaque "modified").
export function computeVaultDiff(payload: ComputeVaultDiffPayload): VaultDiffResult {
  const localIndex = indexCredentials(payload.local);
  const remoteIndex = indexCredentials(payload.remote);
  const added: VaultCredential[] = [];
  const modified: VaultCredential[] = [];
  const deleted: VaultCredential[] = [];

  for (const [id, entry] of localIndex.entries()) {
    const remoteEntry = remoteIndex.get(id);
    const isAdded = remoteEntry === undefined;
    // Local credential has no remote counterpart — newly added.
    if (isAdded) {
      added.push(entry.credential);
      continue;
    }
    const isModified = entry.serialized !== remoteEntry.serialized;
    // Same id but content differs — flag as modified.
    if (isModified) modified.push(entry.credential);
  }

  for (const [id, entry] of remoteIndex.entries()) {
    const isDeleted = !localIndex.has(id);
    // Remote credential missing from local — user deleted it.
    if (isDeleted) deleted.push(entry.credential);
  }

  return {
    added,
    modified,
    deleted,
    projectsChanged: compareProjectIds(payload),
  };
}
