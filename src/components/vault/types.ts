// Vault domain types — Sprint 4 redesign.
// Categories removed: credentials live flat on the project. isFavorite is a
// per-credential boolean powering the Favorites tab in the list view. The
// JSON schema persisted to disk and to the Lark doc is the same shape.

// Env id is an open string — projects define any environments they need
// (QAT / UAT / PROD / SANDBOX / 自定义 etc.).
export type VaultEnvId = string;

export type VaultCredentialKind =
  | "link"
  | "token"
  | "database"
  | "cache"
  | "generic"
  | "vault"
  | "argocd"
  | "monitoring"
  | "web"
  | "api"
  | "login";

export interface VaultEnv {
  id: VaultEnvId;
  name: string;
  // Tailwind class such as "bg-emerald-500" — colocated with the env so
  // sidebar dots, breadcrumb pill, and tab indicators stay in sync.
  color: string;
}

export interface VaultCredential {
  id: string;
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
}
