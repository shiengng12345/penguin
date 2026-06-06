// Pure helper — compute credential groups from a flat array via `pairedWith`
// references. Transitive closure: chains A→B→C collapse into a single group.
// Order inside each group preserves source-array order so user-authored
// sequence (URL first, Token second, …) is kept.

import type { VaultCredential } from "./types";

export function buildCredentialGroups(credentials: VaultCredential[]): VaultCredential[][] {
  const byId = new Map(credentials.map((credential) => [credential.id, credential]));

  // Bidirectional adjacency — declaring `pairedWith` on either node is enough
  // to fuse them into the same group.
  const neighbors = new Map<string, Set<string>>();
  for (const credential of credentials) {
    if (!neighbors.has(credential.id)) neighbors.set(credential.id, new Set());
    const target = credential.pairedWith;
    const hasTarget = typeof target === "string" && target.length > 0;
    if (!hasTarget) continue;
    const isSelfReference = target === credential.id;
    if (isSelfReference) continue;
    const partnerExists = byId.has(target);
    if (!partnerExists) continue;
    neighbors.get(credential.id)!.add(target);
    if (!neighbors.has(target)) neighbors.set(target, new Set());
    neighbors.get(target)!.add(credential.id);
  }

  const consumed = new Set<string>();
  const groups: VaultCredential[][] = [];
  for (const credential of credentials) {
    const isAlreadyConsumed = consumed.has(credential.id);
    if (isAlreadyConsumed) continue;
    const memberIds = new Set<string>();
    const queue: string[] = [credential.id];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const isVisited = memberIds.has(currentId);
      if (isVisited) continue;
      memberIds.add(currentId);
      const adjacentIds = neighbors.get(currentId) ?? new Set<string>();
      for (const adjacentId of adjacentIds) queue.push(adjacentId);
    }
    const group: VaultCredential[] = [];
    for (const member of credentials) {
      const isMember = memberIds.has(member.id);
      if (isMember) group.push(member);
    }
    groups.push(group);
    for (const member of group) consumed.add(member.id);
  }
  return groups;
}

// Apply a new group order back to a flat credentials array. Group internal
// order is preserved from the existing data so paired field sequence stays
// stable across a reorder.
export interface ReorderCredentialsPayload {
  credentials: VaultCredential[];
  // Ordered list of group head ids (first credential id of each group).
  orderedGroupHeadIds: string[];
}

export function reorderCredentialsByGroup(payload: ReorderCredentialsPayload): VaultCredential[] {
  const groups = buildCredentialGroups(payload.credentials);
  const headToGroup = new Map(groups.map((group) => [group[0].id, group]));
  const out: VaultCredential[] = [];
  for (const headId of payload.orderedGroupHeadIds) {
    const group = headToGroup.get(headId);
    if (group !== undefined) out.push(...group);
  }
  // Defensive — append any groups that were not in the supplied order so we
  // never lose credentials silently.
  for (const group of groups) {
    const isAlreadyEmitted = payload.orderedGroupHeadIds.includes(group[0].id);
    if (isAlreadyEmitted) continue;
    out.push(...group);
  }
  return out;
}
