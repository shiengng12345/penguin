import { create } from "zustand";
import {
  deleteSavedRequestFromDatabase,
  loadSavedRequestsFromDatabase,
  persistSavedRequest,
  persistSavedRequests,
  renameSavedRequestInDatabase,
} from "./penguin-db";
import {
  deletePersistedValue,
  getPersistedValue,
  hydratePersistedValues,
  setPersistedValue,
} from "./app-persistence";
import { APP_VALUE_KEYS } from "./persistence-keys";
import type { VaultProject } from "@/components/vault/types";
import type {
  ProtoService as CoreProtoService,
  ProtoMethod as CoreProtoMethod,
  FieldInfo as CoreFieldInfo,
  MetadataEntry as CoreMetadataEntry,
  ResponseState as CoreResponseState,
} from "@penguin/core";
import { isAppTheme, THEMES, type AppTheme } from "./theme";
import type { RestBodyMode, RestMethod } from "./rest";

// --- Types ---

// Re-export protocol-agnostic types from @penguin/core. Kept as named exports
// here so existing call sites (`import { ResponseState } from "./store"`) keep
// working unchanged after the core extraction.
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

export { THEMES, type AppTheme };

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

// --- Helpers ---

// Backend routes all UAT/QAT traffic through one shared URL per group;
// x-env-tag is the routing signal. Value left empty so the user fills it in
// (literal "QAT"/"UAT" or a `{{VAR}}` template) — no implicit template default.
// Declared here (above _defaultHeaders) because loadDefaultHeaders runs at
// module load time and reads this in its fallback object — a later const
// declaration would put it in TDZ at first use.
const X_ENV_TAG_DEFAULT: MetadataEntry = {
  key: "x-env-tag",
  value: "",
  enabled: true,
};

const PLATFORM_ID_DEFAULT: MetadataEntry = {
  key: "platform-id",
  value: "",
  enabled: true,
};

const _defaultHeaders = loadDefaultHeaders();

function createTab(origin: TabOrigin = null, protocol: ProtocolTab = "grpc-web"): RequestTab {
  const visibleProtocol = visibleProtocolForTab(protocol);
  let headers: MetadataEntry[];
  try {
    headers = useAppStore.getState().defaultHeaders[visibleProtocol];
  } catch {
    headers = _defaultHeaders[visibleProtocol];
  }
  return {
    id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    protocolTab: visibleProtocol,
    targetUrl: "{{URL}}",
    pathOverride: null,
    restMethod: "POST",
    restBodyMode: "json",
    requestBody: "{}",
    metadata: headers.map((h) => ({ ...h })),
    selectedPackage: null,
    selectedService: null,
    selectedMethod: null,
    response: null,
    isLoading: false,
    origin,
  };
}

export function getDefaultHeadersForProtocol(protocol: ProtocolTab): MetadataEntry[] {
  try {
    return useAppStore.getState().defaultHeaders[protocol].map((h) => ({ ...h }));
  } catch {
    return _defaultHeaders[protocol].map((h) => ({ ...h }));
  }
}

// Returns the headers that should actually be sent for a tab: tab.metadata
// takes precedence (including when an entry is present-but-disabled — the user
// has explicitly opted out), and any default header whose key the tab hasn't
// touched is appended. Header keys compare case-insensitively per HTTP semantics.
export function mergeWithDefaultHeaders(
  tabMetadata: MetadataEntry[],
  protocol: ProtocolTab,
): MetadataEntry[] {
  const tabKeys = new Set(
    tabMetadata
      .map((entry) => entry.key.trim().toLowerCase())
      .filter((key) => key.length > 0),
  );
  const inherited = getDefaultHeadersForProtocol(protocol).filter((entry) => {
    const key = entry.key.trim().toLowerCase();
    return key.length > 0 && !tabKeys.has(key);
  });
  return [...tabMetadata, ...inherited];
}

export { createTab };

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
  history: HistoryEntry[];
  addHistory: (entry: HistoryEntry) => void;
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

const THEME_KEY = APP_VALUE_KEYS.theme;
const TUTORIAL_KEY = APP_VALUE_KEYS.tutorialSeen;
const USERNAME_KEY = APP_VALUE_KEYS.userName;
const TABS_KEY = APP_VALUE_KEYS.tabs;
const ACTIVE_TAB_KEY = APP_VALUE_KEYS.activeTab;
const HISTORY_KEY = APP_VALUE_KEYS.history;
const MAX_HISTORY_KEY = APP_VALUE_KEYS.maxHistory;
const DEFAULT_MAX_HISTORY = 500;
const SAVED_REQUESTS_KEY = APP_VALUE_KEYS.savedRequests;
const DEFAULT_HEADERS_KEY = APP_VALUE_KEYS.defaultHeaders;

function loadMaxHistorySize(): number {
  const raw = getPersistedValue(MAX_HISTORY_KEY);
  if (raw) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return DEFAULT_MAX_HISTORY;
}

function loadDefaultHeaders(): Record<ProtocolTab, MetadataEntry[]> {
  const fallback: Record<ProtocolTab, MetadataEntry[]> = {
    "grpc-web": [
      { key: "Authorization", value: "Bearer ", enabled: true },
      { key: "eId", value: "", enabled: true },
      { ...X_ENV_TAG_DEFAULT },
      { ...PLATFORM_ID_DEFAULT },
    ],
    grpc: [
      { key: "Authorization", value: "Bearer ", enabled: true },
      { key: "eId", value: "", enabled: true },
      { ...X_ENV_TAG_DEFAULT },
      { ...PLATFORM_ID_DEFAULT },
    ],
    sdk: [
      { key: "Authorization", value: "Bearer ", enabled: true },
      { key: "eId", value: "", enabled: true },
      { ...X_ENV_TAG_DEFAULT },
      { ...PLATFORM_ID_DEFAULT },
    ],
    rest: [
      { key: "Authorization", value: "Bearer ", enabled: true },
      { key: "Content-Type", value: "application/json", enabled: true },
      { ...X_ENV_TAG_DEFAULT },
      { ...PLATFORM_ID_DEFAULT },
    ],
  };
  try {
    const raw = getPersistedValue(DEFAULT_HEADERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<ProtocolTab, MetadataEntry[]>;
      const merged = { ...fallback, ...parsed };
      // One-time migration: existing users predate x-env-tag; if their stored
      // default headers don't include it, append it without disturbing other entries.
      const protocols: ProtocolTab[] = ["grpc-web", "grpc", "sdk", "rest"];
      let migrated = false;
      for (const protocol of protocols) {
        const current = merged[protocol] ?? [];
        const hasXEnvTag = current.some(
          (entry) => entry.key.trim().toLowerCase() === "x-env-tag",
        );
        if (!hasXEnvTag) {
          merged[protocol] = [...current, { ...X_ENV_TAG_DEFAULT }];
          migrated = true;
        }
        const hasPlatformId = merged[protocol].some(
          (entry) => entry.key.trim().toLowerCase() === "platform-id",
        );
        if (!hasPlatformId) {
          merged[protocol] = [...merged[protocol], { ...PLATFORM_ID_DEFAULT }];
          migrated = true;
        }
      }
      if (migrated) {
        setPersistedValue(DEFAULT_HEADERS_KEY, JSON.stringify(merged));
      }
      return merged;
    }
  } catch { /* corrupted */ }
  return fallback;
}

function loadUserName(): string {
  return getPersistedValue(USERNAME_KEY) ?? "";
}

function loadTabs(): { tabs: RequestTab[]; activeTabId: string | null } {
  try {
    const raw = getPersistedValue(TABS_KEY);
    if (raw) {
      const tabs: RequestTab[] = (JSON.parse(raw) as RequestTab[])
        .map((t: RequestTab) => ({
          ...t,
          restMethod: t.restMethod ?? "POST",
          restBodyMode: t.restBodyMode ?? "json",
          origin: t.origin ?? null,
        }))
        .filter((tab: RequestTab) => tab.protocolTab !== "rest");
      if (Array.isArray(tabs) && tabs.length > 0) {
        const activeTabId =
          getPersistedValue(ACTIVE_TAB_KEY) ?? tabs[0].id;
        return { tabs, activeTabId };
      }
    }
  } catch { /* corrupted data, start fresh */ }
  return { tabs: [], activeTabId: null };
}

let _saveTabsTimer: ReturnType<typeof setTimeout> | null = null;
function saveTabs(tabs: RequestTab[], activeTabId: string | null) {
  if (_saveTabsTimer) clearTimeout(_saveTabsTimer);
  _saveTabsTimer = setTimeout(() => {
    setPersistedValue(TABS_KEY, JSON.stringify(tabs));
    if (activeTabId) {
      setPersistedValue(ACTIVE_TAB_KEY, activeTabId);
    } else {
      deletePersistedValue(ACTIVE_TAB_KEY);
    }
    _saveTabsTimer = null;
  }, 300);
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = getPersistedValue(HISTORY_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch { /* corrupted */ }
  return [];
}

let _saveHistoryTimer: ReturnType<typeof setTimeout> | null = null;
function saveHistory(entries: HistoryEntry[], maxSize?: number) {
  if (_saveHistoryTimer) clearTimeout(_saveHistoryTimer);
  const limit = maxSize ?? useAppStore.getState().maxHistorySize;
  _saveHistoryTimer = setTimeout(() => {
    setPersistedValue(HISTORY_KEY, JSON.stringify(entries.slice(0, limit)));
    _saveHistoryTimer = null;
  }, 500);
}

function loadSavedRequests(): SavedRequest[] {
  try {
    const raw = getPersistedValue(SAVED_REQUESTS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch { /* corrupted */ }
  return [];
}

function loadTheme(): AppTheme {
  const stored = getPersistedValue(THEME_KEY);
  if (stored && isAppTheme(stored)) return stored;
  return "dark";
}

function loadShowTutorial(): boolean {
  return getPersistedValue(TUTORIAL_KEY) !== "true";
}

export const useAppStore = create<AppState>((set, get) => {
  const initialTheme = loadTheme();
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", initialTheme);
  }
  const restored = loadTabs();
  const initialTab = restored.tabs.length > 0 ? null : createTab();
  const startTabs = restored.tabs.length > 0 ? restored.tabs : [initialTab!];
  const startActiveId =
    restored.activeTabId && restored.tabs.some((tab) => tab.id === restored.activeTabId)
      ? restored.activeTabId
      : startTabs[0].id;
  return {
    tabs: startTabs,
    activeTabId: startActiveId,
    addTab: (protocol = "grpc-web") => {
      const tab = createTab(null, protocol);
      set((s) => {
        const next = { tabs: [...s.tabs, tab], activeTabId: tab.id };
        saveTabs(next.tabs, next.activeTabId);
        return next;
      });
      return tab;
    },
    removeTab: (id) => {
      set((s) => {
        const idx = s.tabs.findIndex((t) => t.id === id);
        const next = s.tabs.filter((t) => t.id !== id);
        if (next.length === 0) {
          const fresh = createTab();
          saveTabs([fresh], fresh.id);
          return { tabs: [fresh], activeTabId: fresh.id };
        }
        const nextActive =
          s.activeTabId === id
            ? (next[Math.min(idx, next.length - 1)]?.id ?? next[0]?.id ?? null)
            : s.activeTabId;
        saveTabs(next, nextActive);
        return { tabs: next, activeTabId: nextActive };
      });
    },
    resetActiveTab: () => {
      const tabs = get().tabs;
      const activeTabId = tabs[0]?.id ?? null;
      set({ activeTabId });
      saveTabs(tabs, activeTabId);
    },
    resetPackageTabs: () => {
      const fresh = createTab();
      set({ tabs: [fresh], activeTabId: fresh.id });
      saveTabs([fresh], fresh.id);
    },
    sanitizeHiddenRestTabs: () => {
      set((s) => {
        const nextTabs = s.tabs.filter((tab) => tab.protocolTab !== "rest");
        if (nextTabs.length === s.tabs.length) return {};
        const tabs = nextTabs.length > 0 ? nextTabs : [createTab()];
        const activeTabId =
          s.activeTabId && tabs.some((tab) => tab.id === s.activeTabId)
            ? s.activeTabId
            : tabs[0].id;
        saveTabs(tabs, activeTabId);
        return { tabs, activeTabId };
      });
    },
    setActiveTab: (id) => {
      set({ activeTabId: id });
      saveTabs(get().tabs, id);
    },
    updateActiveTab: (patch) => {
      const { activeTabId, tabs } = get();
      if (!activeTabId) return;
      const nextTabs = tabs.map((t) =>
        t.id === activeTabId ? { ...t, ...patch } : t
      );
      set({ tabs: nextTabs });
      saveTabs(nextTabs, activeTabId);
    },

    grpcWebPackages: [],
    grpcPackages: [],
    sdkPackages: [],
    setGrpcWebPackages: (pkgs) => set({ grpcWebPackages: pkgs }),
    setGrpcPackages: (pkgs) => set({ grpcPackages: pkgs }),
    setSdkPackages: (pkgs) => set({ sdkPackages: pkgs }),
    addGrpcWebPackage: (pkg) =>
      set((s) => ({
        grpcWebPackages: [...s.grpcWebPackages, pkg],
      })),
    addGrpcPackage: (pkg) =>
      set((s) => ({
        grpcPackages: [...s.grpcPackages, pkg],
      })),
    addSdkPackage: (pkg) =>
      set((s) => ({
        sdkPackages: [...s.sdkPackages, pkg],
      })),
    removeGrpcWebPackage: (name) =>
      set((s) => ({
        grpcWebPackages: s.grpcWebPackages.filter((p) => p.name !== name),
      })),
    removeGrpcPackage: (name) =>
      set((s) => ({
        grpcPackages: s.grpcPackages.filter((p) => p.name !== name),
      })),
    removeSdkPackage: (name) =>
      set((s) => ({
        sdkPackages: s.sdkPackages.filter((p) => p.name !== name),
      })),

    grpcWebEnvironments: [],
    grpcEnvironments: [],
    sdkEnvironments: [],
    restEnvironments: [],
    grpcWebActiveEnvId: null,
    grpcActiveEnvId: null,
    sdkActiveEnvId: null,
    restActiveEnvId: null,
    setGrpcWebEnvironments: (envs) => set({ grpcWebEnvironments: envs }),
    setGrpcEnvironments: (envs) => set({ grpcEnvironments: envs }),
    setSdkEnvironments: (envs) => set({ sdkEnvironments: envs }),
    setRestEnvironments: (envs) => set({ restEnvironments: envs }),
    setGrpcWebActiveEnvId: (id) => set({ grpcWebActiveEnvId: id }),
    setGrpcActiveEnvId: (id) => set({ grpcActiveEnvId: id }),
    setSdkActiveEnvId: (id) => set({ sdkActiveEnvId: id }),
    setRestActiveEnvId: (id) => set({ restActiveEnvId: id }),
    addGrpcWebEnvironment: (env) =>
      set((s) => ({
        grpcWebEnvironments: [...s.grpcWebEnvironments, env],
      })),
    addGrpcEnvironment: (env) =>
      set((s) => ({
        grpcEnvironments: [...s.grpcEnvironments, env],
      })),
    addSdkEnvironment: (env) =>
      set((s) => ({
        sdkEnvironments: [...s.sdkEnvironments, env],
      })),
    addRestEnvironment: (env) =>
      set((s) => ({
        restEnvironments: [...s.restEnvironments, env],
      })),
    updateGrpcWebEnvironment: (id, patch) =>
      set((s) => ({
        grpcWebEnvironments: s.grpcWebEnvironments.map((e) =>
          e.id === id ? { ...e, ...patch } : e
        ),
      })),
    updateGrpcEnvironment: (id, patch) =>
      set((s) => ({
        grpcEnvironments: s.grpcEnvironments.map((e) =>
          e.id === id ? { ...e, ...patch } : e
        ),
      })),
    updateSdkEnvironment: (id, patch) =>
      set((s) => ({
        sdkEnvironments: s.sdkEnvironments.map((e) =>
          e.id === id ? { ...e, ...patch } : e
        ),
      })),
    updateRestEnvironment: (id, patch) =>
      set((s) => ({
        restEnvironments: s.restEnvironments.map((e) =>
          e.id === id ? { ...e, ...patch } : e
        ),
      })),
    deleteGrpcWebEnvironment: (id) =>
      set((s) => ({
        grpcWebEnvironments: s.grpcWebEnvironments.filter((e) => e.id !== id),
        grpcWebActiveEnvId:
          s.grpcWebActiveEnvId === id ? null : s.grpcWebActiveEnvId,
      })),
    deleteGrpcEnvironment: (id) =>
      set((s) => ({
        grpcEnvironments: s.grpcEnvironments.filter((e) => e.id !== id),
        grpcActiveEnvId: s.grpcActiveEnvId === id ? null : s.grpcActiveEnvId,
      })),
    deleteSdkEnvironment: (id) =>
      set((s) => ({
        sdkEnvironments: s.sdkEnvironments.filter((e) => e.id !== id),
        sdkActiveEnvId: s.sdkActiveEnvId === id ? null : s.sdkActiveEnvId,
      })),
    deleteRestEnvironment: (id) =>
      set((s) => ({
        restEnvironments: s.restEnvironments.filter((e) => e.id !== id),
        restActiveEnvId: s.restActiveEnvId === id ? null : s.restActiveEnvId,
      })),

    theme: initialTheme,
    setTheme: (theme) => {
      if (typeof window !== "undefined") {
        setPersistedValue(THEME_KEY, theme);
        document.documentElement.setAttribute("data-theme", theme);
      }
      set({ theme });
    },

    isInstallerOpen: false,
    setInstallerOpen: (open) => set({ isInstallerOpen: open, installerPrefill: open ? get().installerPrefill : "" }),
    installerPrefill: "",
    setInstallerPrefill: (value) => set({ installerPrefill: value }),
    installLog: [],
    addInstallLog: (line) =>
      set((s) => ({ installLog: [...s.installLog, line] })),
    clearInstallLog: () => set({ installLog: [] }),

    searchPrefill: "",
    setSearchPrefill: (value) => set({ searchPrefill: value }),

    showTutorial: loadShowTutorial(),
    setShowTutorial: (show) => {
      setPersistedValue(TUTORIAL_KEY, show ? "false" : "true");
      set({ showTutorial: show });
    },

    userName: loadUserName(),
    setUserName: (name) => {
      setPersistedValue(USERNAME_KEY, name);
      set({ userName: name });
    },

    devModeEnabled: getPersistedValue(APP_VALUE_KEYS.devModeEnabled) === "true",
    setDevModeEnabled: (value) => {
      setPersistedValue(APP_VALUE_KEYS.devModeEnabled, value ? "true" : "false");
      set({ devModeEnabled: value });
    },
    hasValidToken: false,
    setHasValidToken: (value) => set({ hasValidToken: value }),
    isSuperAdmin: false,
    setIsSuperAdmin: (value) => set({ isSuperAdmin: value }),
    vaultProjects: [],
    setVaultProjects: (projects) => set({ vaultProjects: projects }),
    vaultLarkUrl: null,
    setVaultLarkUrl: (url) => set({ vaultLarkUrl: url }),
    vaultLastSyncedAt: null,
    setVaultLastSyncedAt: (timestamp) => set({ vaultLastSyncedAt: timestamp }),
    vaultIsDirty: false,
    setVaultIsDirty: (value) => set({ vaultIsDirty: value }),
    history: [],
    addHistory: (entry) => {
      set((s) => {
        const next = [entry, ...s.history].slice(0, s.maxHistorySize);
        saveHistory(next, s.maxHistorySize);
        return { history: next };
      });
    },
    clearHistory: () => {
      saveHistory([], DEFAULT_MAX_HISTORY);
      set({ history: [] });
    },

    savedRequests: [],
    saveRequest: (entry) => {
      void persistSavedRequest(entry);
      set((s) => {
        const next = [entry, ...s.savedRequests];
        return { savedRequests: next };
      });
    },
    deleteSavedRequest: (id) => {
      void deleteSavedRequestFromDatabase(id);
      set((s) => {
        const next = s.savedRequests.filter((r) => r.id !== id);
        return { savedRequests: next };
      });
    },
    renameSavedRequest: (id, name) => {
      void renameSavedRequestInDatabase(id, name);
      set((s) => {
        const next = s.savedRequests.map((r) =>
          r.id === id ? { ...r, name } : r
        );
        return { savedRequests: next };
      });
    },

    maxHistorySize: loadMaxHistorySize(),
    setMaxHistorySize: (size) => {
      setPersistedValue(MAX_HISTORY_KEY, String(size));
      set((s) => {
        const trimmed = s.history.slice(0, size);
        saveHistory(trimmed, size);
        return { maxHistorySize: size, history: trimmed };
      });
    },

    defaultHeaders: loadDefaultHeaders(),
    setDefaultHeaders: (protocol, headers) => {
      set((s) => {
        const next = { ...s.defaultHeaders, [protocol]: headers };
        setPersistedValue(DEFAULT_HEADERS_KEY, JSON.stringify(next));
        return { defaultHeaders: next };
      });
    },
  };
});

// Defer loading heavy data until after initial render
if (typeof window !== "undefined") {
  requestAnimationFrame(() => {
    void hydratePersistedValues().then(async () => {
      const theme = loadTheme();
      document.documentElement.setAttribute("data-theme", theme);

      const restored = loadTabs();
      const update: Partial<AppState> = {
        defaultHeaders: loadDefaultHeaders(),
        history: loadHistory(),
        maxHistorySize: loadMaxHistorySize(),
        showTutorial: loadShowTutorial(),
        theme,
        userName: loadUserName(),
      };

      if (restored.tabs.length > 0) {
        update.tabs = restored.tabs;
        update.activeTabId =
          restored.activeTabId &&
          restored.tabs.some((tab) => tab.id === restored.activeTabId)
            ? restored.activeTabId
            : restored.tabs[0].id;
      }

      const legacySavedRequests = loadSavedRequests();
      if (legacySavedRequests.length > 0) {
        await persistSavedRequests(legacySavedRequests);
        deletePersistedValue(SAVED_REQUESTS_KEY);
        update.savedRequests = legacySavedRequests;
      }

      useAppStore.setState(update);

      const databaseSavedRequests = await loadSavedRequestsFromDatabase();
      if (databaseSavedRequests.length > 0) {
        useAppStore.setState({ savedRequests: databaseSavedRequests });
      }
    });
  });
}

export function useActiveTab(): RequestTab | null {
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  return tabs.find((t) => t.id === activeTabId) ?? null;
}
