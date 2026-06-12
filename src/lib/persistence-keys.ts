export type PersistedProtocol = "grpc-web" | "grpc" | "sdk" | "rest";

export const APP_VALUE_KEYS = {
  theme: "penguin-theme",
  tutorialSeen: "penguin-tutorial-seen",
  userName: "penguin-username",
  tabs: "penguin-tabs",
  activeTab: "penguin-active-tab",
  history: "penguin-history",
  maxHistory: "penguin-max-history",
  savedRequests: "penguin-saved-requests",
  defaultHeaders: "penguin-default-headers",
  cacheVersion: "penguin-cache-version",
  remoteConfigCache: "penguin-remote-config-cache",
  remoteConfigLastPulledAt: "penguin-remote-config-last-pulled-at",
  remoteConfigSource: "penguin-remote-config-source",
  updateLastCheckedAt: "penguin-update-last-checked-at",
  updateDismissedVersion: "penguin-update-dismissed-version",
  devModeEnabled: "penguin-dev-mode-enabled",
  devModeToken: "penguin-dev-mode-token",
  vaultData: "penguin-vault-data",
  vaultLarkUrl: "penguin-vault-lark-url",
  vaultLastSyncedAt: "penguin-vault-last-synced-at",
  vaultLarkUrlLocked: "penguin-vault-lark-url-locked",
  vaultLastSyncedHash: "penguin-vault-last-synced-hash",
  vaultSchemaVersion: "penguin-vault-schema-version",
  docsLarkUrl: "penguin-docs-lark-url",
  docsKnowledgeBase: "penguin-docs-knowledge-base",
  docsLastSyncedAt: "penguin-docs-last-synced-at",
  docsLastSyncedHash: "penguin-docs-last-synced-hash",
} as const;

export const ENVIRONMENT_VALUE_KEYS: Record<PersistedProtocol, string> = {
  "grpc-web": "penguin-grpc-web-environments",
  grpc: "penguin-grpc-environments",
  sdk: "penguin-sdk-environments",
  rest: "penguin-rest-environments",
};

export const ACTIVE_ENV_VALUE_KEYS: Record<PersistedProtocol, string> = {
  "grpc-web": "penguin-grpc-web-active-env",
  grpc: "penguin-grpc-active-env",
  sdk: "penguin-sdk-active-env",
  rest: "penguin-rest-active-env",
};

export const LEGACY_BROWSER_STORAGE_KEYS = [
  ...Object.values(APP_VALUE_KEYS),
  ...Object.values(ENVIRONMENT_VALUE_KEYS),
  ...Object.values(ACTIVE_ENV_VALUE_KEYS),
];
