// Source-assertion tests for the middle category bar on the Vault
// page (VaultKindRail) — Sprint 5 user-managed kinds shape.
//
// Locks the wiring so a future refactor that drops the kind filter,
// changes the count source, breaks the CRUD pipeline, or skips the
// schema-v3 migration fails CI.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function loadSource(relPath) {
  return readFile(new URL(relPath, import.meta.url), "utf8");
}

test("vault types — VaultCredentialKind is open string + BUILTIN_KIND_IDS + VaultKindDef shape", async () => {
  // History: Sprint 4 had a closed 11-member union. Sprint 5 made
  // kinds user-managed (CRUD via VaultKindRail) — the union became
  // a free string + a separate BUILTIN_KIND_IDS tuple seeds defaults.
  const src = await loadSource("../src/components/vault/types.ts");

  // Open string for VaultCredentialKind so user-created kind ids
  // (kind-XXXX-YYYY) don't fail validation.
  assert.match(src, /export type VaultCredentialKind = string/);

  // BUILTIN_KIND_IDS — 11 built-in icon-having kinds used to seed
  // defaults + drive VaultBrandIcon.
  assert.match(src, /export const BUILTIN_KIND_IDS = \[/);
  for (const id of [
    "vault", "database", "cache", "link", "token",
    "argocd", "monitoring", "web", "api", "login", "generic",
  ]) {
    assert.match(src, new RegExp(`"${id}"`), `BUILTIN_KIND_IDS should include "${id}"`);
  }

  // VaultKindDef — { id, label, baseKind? } — user-managed per-project.
  assert.match(src, /export interface VaultKindDef \{[\s\S]{0,400}?id: string;[\s\S]{0,200}?label: string;[\s\S]{0,200}?baseKind\?:/);

  // VaultProject gains optional `kinds: VaultKindDef[]` (optional so
  // vault-storage.normalizeProject can seed it on hydrate).
  assert.match(src, /kinds\?: VaultKindDef\[\]/);

  // defaultKindsForProject seeds the 11 built-ins for new / migrated projects.
  assert.match(src, /export function defaultKindsForProject\(\): VaultKindDef\[\]/);
});

test("vault-storage — schema v3 + validates / auto-seeds project.kinds", async () => {
  // Schema bump from v2 → v3 because the project shape changed
  // (gained `kinds`). v2 blobs without `kinds` get auto-seeded via
  // defaultKindsForProject() so existing data hydrates clean.
  const src = await loadSource("../src/components/vault/vault-storage.ts");

  assert.match(src, /VAULT_SCHEMA_VERSION = "3"/);
  // Auto-seed when kinds is missing.
  assert.match(src, /kinds = defaultKindsForProject\(\)/);
  // Validates kinds[] entries (id + label strings, optional baseKind).
  assert.match(src, /kinds\[\$\{i\}\][\s\S]{0,80}?missing string id/);
  assert.match(src, /kinds\[\$\{i\}\][\s\S]{0,80}?missing string label/);

  // Credential.kind is now an open string — no more closed-union
  // rejection. Empty string still rejected (would be unusable).
  assert.match(src, /kind must be non-empty string/);
  // The old VAULT_KINDS whitelist is gone.
  assert.doesNotMatch(src, /VAULT_KINDS/);
});

test("VaultKindRail — full CRUD parity with VaultSidebar (drag + 3-dot menu + add)", async () => {
  // User direction: "Kinds 跟 Projects 一模一样，可以 drag 可以 CRUD".
  // The rail mirrors VaultSidebar's SortableProjectRow pattern.
  const src = await loadSource("../src/components/vault/VaultKindRail.tsx");

  // dnd-kit SortableContext + useSortable drives drag-to-reorder.
  assert.match(src, /SortableContext/);
  assert.match(src, /useSortable/);
  // arrayMove on drop-end emits an ordered id list to onReorderKinds.
  assert.match(src, /arrayMove/);
  assert.match(src, /onReorderKinds\?\.\(next\)/);

  // + button calls onAddKind (super-admin gate at the caller).
  assert.match(src, /onAddKind\?:/);
  assert.match(src, /onAddKind\(trimmed\)/);

  // 3-dot menu with Rename + Delete options.
  assert.match(src, /Rename kind/);
  assert.match(src, /Delete kind/);
  assert.match(src, /onRenameKind\?\.\(kind\.id, trimmed\)/);
  assert.match(src, /onDeleteKind\(kind\.id\)/);

  // Inline edit row for Add / Rename — Enter commits, Esc cancels.
  assert.match(src, /function InlineEditRow\(/);
  assert.match(src, /if \(e\.key === "Enter"\)/);
  assert.match(src, /if \(e\.key === "Escape"\)/);

  // "All" pseudo-row — non-draggable, non-deletable, always first.
  assert.match(src, /function AllRow\(/);
  assert.match(src, /onSelectKind\("all"\)/);

  // Reuses VaultBrandIcon. User-created kinds without baseKind fall
  // through to the generic padlock.
  assert.match(src, /import \{ VaultBrandIcon \}/);
  assert.match(src, /kind\.baseKind \?\? "generic"/);

  // Type export so VaultMainPanel can type its state.
  assert.match(src, /export type VaultKindSelection = string \| "all"/);
});

test("VaultMainPanel — wires selectedKind state, kind-keyed counts, and forwards CRUD handlers", async () => {
  const src = await loadSource("../src/components/vault/VaultMainPanel.tsx");

  // selectedKind state — local useState, mirrors activeTab/searchQuery.
  assert.match(
    src,
    /const \[selectedKind, setSelectedKind\] = useState<VaultKindSelection>\("all"\)/,
  );

  // countsByKind — HEAD-kind only so paired groups aren't double-counted.
  // Type is Partial<Record<string, number>> since kind is now open.
  assert.match(
    src,
    /const countsByKind = useMemo<Partial<Record<VaultCredentialKind, number>>>\([\s\S]{0,400}?for \(const group of allGroups\)[\s\S]{0,200}?group\[0\]\?\.kind/,
  );

  // visibleGroups filter — kind filter inserts BEFORE search.
  assert.match(
    src,
    /selectedKind === "all"[\s\S]{0,200}?allGroups\.filter\(\(group\) => group\[0\]\?\.kind === selectedKind\)/,
  );
  assert.match(src, /\}, \[allGroups, activeTab, searchQuery, selectedEnvId, selectedKind\]\)/);

  // Rail mounted as left sibling via fragment, project.kinds passed in.
  assert.match(src, /<VaultKindRail[\s\S]{0,400}?kinds=\{project\.kinds \?\? \[\]\}/);
  assert.match(src, /counts=\{countsByKind\}/);
  assert.match(src, /selectedKind=\{selectedKind\}/);

  // CRUD handlers forwarded from props (VaultPage owns the data,
  // VaultMainPanel only forwards).
  assert.match(src, /onAddKind=\{props\.onAddKind\}/);
  assert.match(src, /onRenameKind=\{props\.onRenameKind\}/);
  assert.match(src, /onDeleteKind=\{props\.onDeleteKind\}/);
  assert.match(src, /onReorderKinds=\{props\.onReorderKinds\}/);
});

test("VaultPage — defines handleAddKind / handleRenameKind / handleDeleteKind / handleReorderKinds with super-admin gate", async () => {
  const src = await loadSource("../src/components/vault/VaultPage.tsx");

  // All 4 handlers exist + use the shared mutateProjects pipeline so
  // the change persists + is push-dirty-flagged + Lark-synced.
  assert.match(src, /const handleAddKind = useCallback\(/);
  assert.match(src, /const handleRenameKind = useCallback\(/);
  assert.match(src, /const handleDeleteKind = useCallback\(/);
  assert.match(src, /const handleReorderKinds = useCallback\(/);

  // Super-admin gate on every mutation. Looser window (2000 chars)
  // since each handler's body has variable length; non-greedy `?` on
  // the dotall match keeps it scoped to the immediate function block.
  for (const name of [
    "handleAddKind",
    "handleRenameKind",
    "handleDeleteKind",
    "handleReorderKinds",
  ]) {
    const re = new RegExp(`const ${name} = useCallback\\([\\s\\S]{0,2000}?requireSuperAdmin`);
    assert.match(src, re, `${name} must gate on requireSuperAdmin`);
  }

  // Delete blocks the operation when any credential still uses the kind.
  assert.match(src, /handleDeleteKind[\s\S]{0,1500}?credentials\.filter\(\(c\) => c\.kind === kindId\)/);

  // VaultMainPanel receives the 4 handlers, gated by isSuperAdmin.
  assert.match(src, /onAddKind=\{isSuperAdmin \? handleAddKind : undefined\}/);
  assert.match(src, /onRenameKind=\{isSuperAdmin \? handleRenameKind : undefined\}/);
  assert.match(src, /onDeleteKind=\{isSuperAdmin \? handleDeleteKind : undefined\}/);
  assert.match(src, /onReorderKinds=\{isSuperAdmin \? handleReorderKinds : undefined\}/);
});

test("VaultCredentialEditor — exports resolveTemplateIdForKind with the agreed kind → template id mapping", async () => {
  // Sprint 5 — rail kind pre-fill. When the user has a kind row
  // selected on VaultKindRail and clicks Add credential, the parent
  // calls resolveTemplateIdForKind(kindHint) to skip the picker grid
  // and open the matching template directly.
  const src = await loadSource("../src/components/vault/VaultCredentialEditor.tsx");

  // Mapping table for built-in kinds with a dedicated multi-field
  // template. Source of truth — if KIND_TO_TEMPLATE_ID drops one of
  // these, that kind regresses to the picker grid.
  assert.match(src, /KIND_TO_TEMPLATE_ID/);
  for (const [kind, tid] of [
    ["vault", "vault-server"],
    ["login", "service-auth"],
    ["database", "database"],
    ["cache", "cache"],
    ["link", "link"],
  ]) {
    // Object literal keys can be quoted or bare — accept either form.
    assert.match(
      src,
      new RegExp(`["']?${kind}["']?\\s*:\\s*["']${tid}["']`),
      `KIND_TO_TEMPLATE_ID should map ${kind} → ${tid}`,
    );
  }

  // Resolver exists + handles the 3 documented edge cases:
  // (1) undefined / "all" → undefined (fall through to picker)
  // (2) direct match → no seedKind
  // (3) fall through to "custom" with seedKind = the hint
  assert.match(src, /export function resolveTemplateIdForKind\(/);
  assert.match(src, /kindHint === undefined \|\| kindHint === "all"/);
  assert.match(src, /templateId: "custom", seedKind: kindHint/);
});

test("VaultCredentialEditor — initialTemplateId seeds pickedTemplateId; open-effect honors it (no picker flash)", async () => {
  const src = await loadSource("../src/components/vault/VaultCredentialEditor.tsx");

  // Lazy initial — pickedTemplateId starts at the supplied hint, not
  // unconditionally null. Without this the editor would render the
  // picker for one frame before the effect catches up.
  assert.match(
    src,
    /useState<string \| null>\(\s*props\.initialTemplateId \?\? null/,
  );

  // Open-effect must respect the hint on every add-mode open so a
  // close → reopen with a hint goes straight past the picker.
  assert.match(
    src,
    /if \(isAddMode\) setPickedTemplateId\(props\.initialTemplateId \?\? null\)/,
  );

  // seedKind + seedKindLabel reach SingleCredentialForm only on the
  // custom branch (multi-field templates already encode the kind via
  // their first field).
  assert.match(src, /seedKind=\{isCustom \? props\.seedKind : undefined\}/);
  assert.match(src, /seedKindLabel=\{isCustom \? props\.seedKindLabel : undefined\}/);

  // Locked-kind UX: select disabled when lockedByRailKind; replaced
  // with read-only label when the kind id isn't in KIND_OPTIONS
  // (user-created custom kinds — arbitrary nanoid ids).
  assert.match(src, /lockedByRailKind = props\.mode === "add" && props\.seedKind !== undefined/);
  assert.match(src, /seedKindNotInOptions/);
  assert.match(src, /disabled=\{lockedByRailKind\}/);
});

test("VaultMainPanel + VaultPage — Add credential forwards selectedKind to handleAddCredential", async () => {
  const panel = await loadSource("../src/components/vault/VaultMainPanel.tsx");
  const page = await loadSource("../src/components/vault/VaultPage.tsx");

  // Toolbar Add button passes the active rail kind (or undefined when
  // "all" is selected) so the editor can pre-fill the template.
  assert.match(
    panel,
    /onClick=\{\(\) => props\.onAddCredential\?\.\(selectedKind === "all" \? undefined : selectedKind\)\}/,
  );
  // Prop signature widened to accept the optional hint.
  assert.match(panel, /onAddCredential\?:\s*\(kindHint\?: string\) => void/);

  // VaultPage stores the hint on the modal state + threads it into
  // the editor mount via resolveTemplateIdForKind.
  assert.match(page, /kindHint\?: string/);
  // useCallback with optional kindHint param — return type annotation
  // may or may not be present, hence the [\s\S] window.
  assert.match(page, /useCallback\(\(kindHint\?: string\)[\s\S]{0,40}?=> \{/);
  assert.match(page, /setCredentialModal\(\{ open: true, mode: "add", kindHint \}\)/);
  assert.match(page, /resolveTemplateIdForKind\(credentialModal\.kindHint\)/);
});
