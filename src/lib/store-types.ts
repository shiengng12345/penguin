import type { VaultProject } from "@/components/vault/types";
import type {
  ProtoService as CoreProtoService,
  ProtoMethod as CoreProtoMethod,
  FieldInfo as CoreFieldInfo,
  MetadataEntry as CoreMetadataEntry,
  ResponseState as CoreResponseState,
} from "@penguin/core";
import type { AppTheme } from "./theme";
import type { RestBodyMode, RestMethod } from "./rest";

// --- Types ---

// Re-export protocol-agnostic types from @penguin/core. Kept as named exports
// here (and re-exported from ./store) so existing call sites
// (`import { ResponseState } from "./store"`) keep working unchanged after the
// core extraction.
export type ProtoService = CoreProtoService;
export type ProtoMethod = CoreProtoMethod;
export type FieldInfo = CoreFieldInfo;
export type MetadataEntry = CoreMetadataEntry;
export type ResponseState = CoreResponseState;

export interface EnvVariable {
  key: string;
  value: string;
}

export interface Environment {
  id: string;
  name: string;
  color: string;
  variables: EnvVariable[];
}

export const ENV_COLORS = [
  { id: "green", label: "Green", hex: "#22c55e" },
  { id: "blue", label: "Blue", hex: "#3b82f6" },
  { id: "amber", label: "Amber", hex: "#f59e0b" },
  { id: "red", label: "Red", hex: "#ef4444" },
  { id: "purple", label: "Purple", hex: "#a855f7" },
  { id: "cyan", label: "Cyan", hex: "#06b6d4" },
  { id: "pink", label: "Pink", hex: "#ec4899" },
  { id: "orange", label: "Orange", hex: "#f97316" },
] as const;

export interface InstalledPackage {
  name: string;
  version: string;
  protoFiles: string[];
  services: ProtoService[];
}

export interface HistoryEntry {
  id: string;
  timestamp: number;
  protocol: ProtocolTab;
  methodFullName: string;
  serviceName: string;
  packageName: string;
  url: string;
  metadata: MetadataEntry[];
  requestBody: string;
  restMethod?: RestMethod;
  restBodyMode?: RestBodyMode;
  selectedMethod?: ProtoMethod | null;
  // Full response archived after the request completes (v1.9+); older
  // migrated entries have no response.
  response?: ResponseState | null;
}

export interface SavedRequest {
  id: string;
  name: string;
  savedAt: number;
  protocol: ProtocolTab;
  methodFullName: string;
  serviceName: string;
  packageName: string;
  url: string;
  metadata: MetadataEntry[];
  requestBody: string;
  restMethod?: RestMethod;
  restBodyMode?: RestBodyMode;
  response: ResponseState | null;
  selectedMethod: ProtoMethod | null;
}

export type ProtocolTab = "grpc-web" | "grpc" | "sdk" | "rest";
export type VisibleProtocolTab = Exclude<ProtocolTab, "rest">;

export function visibleProtocolForTab(
  protocol: ProtocolTab | null | undefined,
): VisibleProtocolTab {
  return protocol === "grpc-web" || protocol === "grpc" || protocol === "sdk"
    ? protocol
    : "sdk";
}

export type TabOrigin = "history" | "saved" | null;

export interface RequestTab {
  id: string;
  protocolTab: ProtocolTab;
  targetUrl: string;
  pathOverride: string | null;
  restMethod: RestMethod;
  restBodyMode: RestBodyMode;
  requestBody: string;
  metadata: MetadataEntry[];
  selectedPackage: string | null;
  selectedService: string | null;
  selectedMethod: ProtoMethod | null;
  response: ResponseState | null;
  isLoading: boolean;
  origin: TabOrigin;
}

// --- App State ---

export interface AppState {
  tabs: RequestTab[];
  activeTabId: string | null;
  addTab: (protocol?: ProtocolTab) => RequestTab;
  removeTab: (id: string) => void;
  resetActiveTab: () => void;
  resetPackageTabs: () => void;
  sanitizeHiddenRestTabs: () => void;
  setActiveTab: (id: string | null) => void;
  updateActiveTab: (patch: Partial<RequestTab>) => void;

  grpcWebPackages: InstalledPackage[];
  grpcPackages: InstalledPackage[];
  sdkPackages: InstalledPackage[];
  setGrpcWebPackages: (pkgs: InstalledPackage[]) => void;
  setGrpcPackages: (pkgs: InstalledPackage[]) => void;
  setSdkPackages: (pkgs: InstalledPackage[]) => void;
  addGrpcWebPackage: (pkg: InstalledPackage) => void;
  addGrpcPackage: (pkg: InstalledPackage) => void;
  addSdkPackage: (pkg: InstalledPackage) => void;
  removeGrpcWebPackage: (name: string) => void;
  removeGrpcPackage: (name: string) => void;
  removeSdkPackage: (name: string) => void;

  grpcWebEnvironments: Environment[];
  grpcEnvironments: Environment[];
  sdkEnvironments: Environment[];
  restEnvironments: Environment[];
  grpcWebActiveEnvId: string | null;
  grpcActiveEnvId: string | null;
  sdkActiveEnvId: string | null;
  restActiveEnvId: string | null;
  setGrpcWebEnvironments: (envs: Environment[]) => void;
  setGrpcEnvironments: (envs: Environment[]) => void;
  setSdkEnvironments: (envs: Environment[]) => void;
  setRestEnvironments: (envs: Environment[]) => void;
  setGrpcWebActiveEnvId: (id: string | null) => void;
  setGrpcActiveEnvId: (id: string | null) => void;
  setSdkActiveEnvId: (id: string | null) => void;
  setRestActiveEnvId: (id: string | null) => void;
  addGrpcWebEnvironment: (env: Environment) => void;
  addGrpcEnvironment: (env: Environment) => void;
  addSdkEnvironment: (env: Environment) => void;
  addRestEnvironment: (env: Environment) => void;
  updateGrpcWebEnvironment: (id: string, patch: Partial<Environment>) => void;
  updateGrpcEnvironment: (id: string, patch: Partial<Environment>) => void;
  updateSdkEnvironment: (id: string, patch: Partial<Environment>) => void;
  updateRestEnvironment: (id: string, patch: Partial<Environment>) => void;
  deleteGrpcWebEnvironment: (id: string) => void;
  deleteGrpcEnvironment: (id: string) => void;
  deleteSdkEnvironment: (id: string) => void;
  deleteRestEnvironment: (id: string) => void;

  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;

  isInstallerOpen: boolean;
  setInstallerOpen: (open: boolean) => void;
  installerPrefill: string;
  setInstallerPrefill: (value: string) => void;
  installLog: string[];
  addInstallLog: (line: string) => void;
  clearInstallLog: () => void;

  searchPrefill: string;
  setSearchPrefill: (value: string) => void;

  showTutorial: boolean;
  setShowTutorial: (show: boolean) => void;

  userName: string;
  setUserName: (name: string) => void;

  // Developer Mode — see useDeveloperMode() contract
  devModeEnabled: boolean;
  setDevModeEnabled: (value: boolean) => void;
  hasValidToken: boolean;
  setHasValidToken: (value: boolean) => void;
  // Sprint 3 — superadmin tier. NOT persisted; always recomputed at boot via
  // initializeDevModeOnAppStart after the in-memory token is loaded.
  isSuperAdmin: boolean;
  setIsSuperAdmin: (value: boolean) => void;

  // Vault — projects state owned here, loaded/persisted via vault-storage.ts
  vaultProjects: VaultProject[];
  setVaultProjects: (projects: VaultProject[]) => void;
  vaultLarkUrl: string | null;
  setVaultLarkUrl: (url: string | null) => void;
  vaultLastSyncedAt: number | null;
  setVaultLastSyncedAt: (timestamp: number | null) => void;
  // Sprint 3 — dirty flag for local CRUD edits. NOT persisted: every cold
  // boot starts clean because either Sync or Push must reconcile against Lark.
  vaultIsDirty: boolean;
  setVaultIsDirty: (value: boolean) => void;
  // Paginated window over the request_history table — NOT the full archive.
  history: HistoryEntry[];
  historyTotal: number;
  addHistory: (entry: HistoryEntry) => void;
  attachHistoryResponse: (id: string, response: ResponseState) => void;
  loadMoreHistory: () => Promise<void>;
  clearHistory: () => void;

  savedRequests: SavedRequest[];
  saveRequest: (entry: SavedRequest) => void;
  deleteSavedRequest: (id: string) => void;
  renameSavedRequest: (id: string, name: string) => void;

  maxHistorySize: number;
  setMaxHistorySize: (size: number) => void;

  defaultHeaders: Record<ProtocolTab, MetadataEntry[]>;
  setDefaultHeaders: (protocol: ProtocolTab, headers: MetadataEntry[]) => void;
}
