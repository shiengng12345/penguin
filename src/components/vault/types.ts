// Vault domain types — Sprint 4 redesign.
// Categories removed: credentials live flat on the project. isFavorite is a
// per-credential boolean powering the Favorites tab in the list view. The
// JSON schema persisted to disk and to the Lark doc is the same shape.

// Env id is an open string — projects define any environments they need
// (QAT / UAT / PROD / SANDBOX / 自定义 etc.).
export type VaultEnvId = string;

// Sprint 5 — Kinds became user-data (CRUD + drag) per user direction.
// `VaultCredentialKind` is now an open string identifying a kind by
// id. The previous 11-member closed union ships as BUILTIN_KIND_IDS
// — used as the default seed for new projects + as the lookup key for
// VaultBrandIcon's per-kind SVG. Custom kinds added by the user have
// arbitrary ids (created via newId()); they render with the generic
// padlock icon unless baseKind is set.
export type VaultCredentialKind = string;

// The original 11 built-in kind ids. Used to:
//   (a) seed `project.kinds` on hydrate when a v2 project arrives
//       without the new field;
//   (b) drive VaultBrandIcon's switch — only these strings have a
//       brand-specific SVG, everything else falls through to generic.
export const BUILTIN_KIND_IDS = [
  "vault",
  "database",
  "cache",
  "link",
  "token",
  "argocd",
  "monitoring",
  "web",
  "api",
  "login",
  "generic",
  // Sprint 12 — TOTP secret for the in-app Authenticator popover. Not
  // mirrored as a Browser shortcut (no URL); surfaced via the KeyRound
  // button in the Browser top bar.
  "totp",
] as const;
export type VaultBuiltinKindId = (typeof BUILTIN_KIND_IDS)[number];

// Per-project kind definition. Users can add, rename, delete, and
// drag-reorder these via VaultKindRail.
export interface VaultKindDef {
  // Stable id. For built-in kinds matches a VaultBuiltinKindId so the
  // existing credentials (`kind: "vault"`) keep resolving without
  // migration. User-created kinds get a nanoid-style id.
  id: string;
  // User-visible label shown in the rail + on credential cards.
  label: string;
  // Optional pointer to a built-in icon for VaultBrandIcon. When
  // omitted, the rail / card show the generic padlock.
  baseKind?: VaultBuiltinKindId;
}

export interface VaultEnv {
  id: VaultEnvId;
  name: string;
  // Tailwind class such as "bg-emerald-500" — colocated with the env so
  // sidebar dots, breadcrumb pill, and tab indicators stay in sync.
  color: string;
}

export interface VaultCredential {
  id: string;
  // Free string referencing a VaultKindDef.id within the same project.
  // For credentials created before the user-managed-kinds refactor this
  // is one of the BUILTIN_KIND_IDS (auto-seeded on hydrate).
  kind: VaultCredentialKind;
  name: string;
  valueByEnv: Record<VaultEnvId, string>;
  isSensitive: boolean;
  // Optional reference to another credential's id in the same project. UI
  // groups paired credentials into a single multi-field card.
  pairedWith?: string;
  // Sprint 4 — Favorites tab. Optional so legacy data without the field
  // defaults to false.
  isFavorite?: boolean;
}

export interface VaultProject {
  id: string;
  name: string;
  environments: VaultEnv[];
  credentials: VaultCredential[];
  // Sprint 5 — user-managed kinds (renamable, deletable, reorderable,
  // and extensible). Order in the array IS the display order in the
  // rail. Optional on read so legacy v2 projects can be auto-seeded by
  // vault-storage.normalizeProject on hydrate; required after that.
  kinds?: VaultKindDef[];
}

// Default labels for the built-in kind ids — used by the storage seeder
// when a v2 project arrives without `kinds`. Kept here (not in
// VaultKindRail) so types.ts is self-contained and the migration logic
// has access without a UI-layer import.
export const BUILTIN_KIND_LABELS: Record<VaultBuiltinKindId, string> = {
  vault: "Vault",
  database: "Mongo / DB",
  cache: "Redis / Cache",
  link: "Link",
  token: "Token",
  argocd: "ArgoCD",
  monitoring: "Monitoring",
  web: "Web",
  api: "API",
  login: "Login",
  generic: "Generic",
  totp: "Authenticator (TOTP)",
};

// Build the default `kinds` array for a brand-new project (or for a
// legacy v2 project being migrated). Returns the 11 built-ins in
// BUILTIN_KIND_IDS order, each with its default label + baseKind.
export function defaultKindsForProject(): VaultKindDef[] {
  return BUILTIN_KIND_IDS.map((id) => ({
    id,
    label: BUILTIN_KIND_LABELS[id],
    baseKind: id,
  }));
}
