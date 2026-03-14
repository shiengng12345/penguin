import { create } from "zustand";

// --- Types ---

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

export interface ProtoService {
  name: string;
  fullName: string;
  methods: ProtoMethod[];
}

export interface ProtoMethod {
  name: string;
  fullName: string;
  requestType: string;
  responseType: string;
  requestFields: FieldInfo[];
  responseFields: FieldInfo[];
}

export interface FieldInfo {
  name: string;
  type: string;
  repeated: boolean;
  optional: boolean;
  fields?: FieldInfo[];
  enumValues?: string[];
}

export interface InstalledPackage {
  name: string;
  version: string;
  protoFiles: string[];
  services: ProtoService[];
}

export interface MetadataEntry {
  key: string;
  value: string;
  enabled: boolean;
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
  response: ResponseState | null;
  selectedMethod: ProtoMethod | null;
}

export type ProtocolTab = "grpc-web" | "grpc" | "sdk";

export type AppTheme =
  | "dark"
  | "light"
  | "nord"
  | "emerald"
  | "rose"
  | "violet";

export const THEMES = [
  { id: "dark" as const, label: "Dark", color: "oklch(0.25 0.02 260)" },
  { id: "light" as const, label: "Light", color: "oklch(0.98 0.01 260)" },
  { id: "nord" as const, label: "Nord", color: "oklch(0.55 0.08 220)" },
  { id: "emerald" as const, label: "Emerald", color: "oklch(0.55 0.12 160)" },
  { id: "rose" as const, label: "Rose", color: "oklch(0.65 0.15 10)" },
  { id: "violet" as const, label: "Violet", color: "oklch(0.55 0.2 290)" },
] as const;

export interface ResponseState {
  status: string;
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  duration: number;
  error?: string;
}

export type TabOrigin = "history" | "saved" | null;

export interface RequestTab {
  id: string;
  protocolTab: ProtocolTab;
  targetUrl: string;
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

const _defaultHeaders = loadDefaultHeaders();

function createTab(origin: TabOrigin = null): RequestTab {
  const protocol: ProtocolTab = "grpc-web";
  let headers: MetadataEntry[];
  try {
    headers = useAppStore.getState().defaultHeaders[protocol];
  } catch {
    headers = _defaultHeaders[protocol];
  }
  return {
    id: `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    protocolTab: protocol,
    targetUrl: "{{URL}}",
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

export { createTab };

// --- App State ---

export interface AppState {
  tabs: RequestTab[];
  activeTabId: string | null;
  addTab: () => void;
  removeTab: (id: string) => void;
  resetActiveTab: () => void;
  setActiveTab: (id: string) => void;
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
  grpcWebActiveEnvId: string | null;
  grpcActiveEnvId: string | null;
  sdkActiveEnvId: string | null;
  setGrpcWebEnvironments: (envs: Environment[]) => void;
  setGrpcEnvironments: (envs: Environment[]) => void;
  setSdkEnvironments: (envs: Environment[]) => void;
  setGrpcWebActiveEnvId: (id: string | null) => void;
  setGrpcActiveEnvId: (id: string | null) => void;
  setSdkActiveEnvId: (id: string | null) => void;
  addGrpcWebEnvironment: (env: Environment) => void;
  addGrpcEnvironment: (env: Environment) => void;
  addSdkEnvironment: (env: Environment) => void;
  updateGrpcWebEnvironment: (id: string, patch: Partial<Environment>) => void;
  updateGrpcEnvironment: (id: string, patch: Partial<Environment>) => void;
  updateSdkEnvironment: (id: string, patch: Partial<Environment>) => void;
  deleteGrpcWebEnvironment: (id: string) => void;
  deleteGrpcEnvironment: (id: string) => void;
  deleteSdkEnvironment: (id: string) => void;

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

const THEME_KEY = "pengvi-theme";
const TUTORIAL_KEY = "pengvi-tutorial-seen";
const USERNAME_KEY = "pengvi-username";
const TABS_KEY = "pengvi-tabs";
const ACTIVE_TAB_KEY = "pengvi-active-tab";
const HISTORY_KEY = "pengvi-history";
const MAX_HISTORY_KEY = "pengvi-max-history";
const DEFAULT_MAX_HISTORY = 500;
const SAVED_REQUESTS_KEY = "pengvi-saved-requests";
const DEFAULT_HEADERS_KEY = "pengvi-default-headers";

function loadMaxHistorySize(): number {
  if (typeof window === "undefined") return DEFAULT_MAX_HISTORY;
  const raw = localStorage.getItem(MAX_HISTORY_KEY);
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
    ],
    grpc: [
      { key: "Authorization", value: "Bearer ", enabled: true },
      { key: "eId", value: "", enabled: true },
    ],
    sdk: [
      { key: "Authorization", value: "Bearer ", enabled: true },
      { key: "eId", value: "", enabled: true },
    ],
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(DEFAULT_HEADERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...fallback, ...parsed };
    }
  } catch { /* corrupted */ }
  return fallback;
}

function loadUserName(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(USERNAME_KEY) ?? "";
}

function loadTabs(): { tabs: RequestTab[]; activeTabId: string | null } {
  if (typeof window === "undefined") return { tabs: [], activeTabId: null };
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const tabs: RequestTab[] = JSON.parse(raw).map((t: RequestTab) => ({
        ...t,
        origin: t.origin ?? null,
      }));
      if (Array.isArray(tabs) && tabs.length > 0) {
        const activeTabId =
          localStorage.getItem(ACTIVE_TAB_KEY) ?? tabs[0].id;
        return { tabs, activeTabId };
      }
    }
  } catch { /* corrupted data, start fresh */ }
  return { tabs: [], activeTabId: null };
}

let _saveTabsTimer: ReturnType<typeof setTimeout> | null = null;
function saveTabs(tabs: RequestTab[], activeTabId: string | null) {
  if (typeof window === "undefined") return;
  if (_saveTabsTimer) clearTimeout(_saveTabsTimer);
  _saveTabsTimer = setTimeout(() => {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
    if (activeTabId) localStorage.setItem(ACTIVE_TAB_KEY, activeTabId);
    _saveTabsTimer = null;
  }, 300);
}

function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch { /* corrupted */ }
  return [];
}

let _saveHistoryTimer: ReturnType<typeof setTimeout> | null = null;
function saveHistory(entries: HistoryEntry[], maxSize?: number) {
  if (typeof window === "undefined") return;
  if (_saveHistoryTimer) clearTimeout(_saveHistoryTimer);
  const limit = maxSize ?? useAppStore.getState().maxHistorySize;
  _saveHistoryTimer = setTimeout(() => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, limit)));
    _saveHistoryTimer = null;
  }, 500);
}

function loadSavedRequests(): SavedRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SAVED_REQUESTS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch { /* corrupted */ }
  return [];
}

let _saveSavedTimer: ReturnType<typeof setTimeout> | null = null;
function saveSavedRequests(entries: SavedRequest[]) {
  if (typeof window === "undefined") return;
  if (_saveSavedTimer) clearTimeout(_saveSavedTimer);
  _saveSavedTimer = setTimeout(() => {
    localStorage.setItem(SAVED_REQUESTS_KEY, JSON.stringify(entries));
    _saveSavedTimer = null;
  }, 500);
}

function loadTheme(): AppTheme {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem(THEME_KEY);
  const valid: AppTheme[] = ["dark", "light", "nord", "emerald", "rose", "violet"];
  if (stored && valid.includes(stored as AppTheme)) return stored as AppTheme;
  return "dark";
}

function loadShowTutorial(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(TUTORIAL_KEY) !== "true";
}

export const useAppStore = create<AppState>((set, get) => {
  const initialTheme = loadTheme();
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", initialTheme);
  }
  const restored = loadTabs();
  const initialTab = restored.tabs.length > 0 ? null : createTab();
  const startTabs = restored.tabs.length > 0 ? restored.tabs : [initialTab!];
  const startActiveId = restored.tabs.length > 0 ? restored.activeTabId : initialTab!.id;
  return {
    tabs: startTabs,
    activeTabId: startActiveId,
    addTab: () => {
      const tab = createTab();
      set((s) => {
        const next = { tabs: [...s.tabs, tab], activeTabId: tab.id };
        saveTabs(next.tabs, next.activeTabId);
        return next;
      });
    },
    removeTab: (id) => {
      set((s) => {
        if (s.tabs.length <= 1) return s;
        const idx = s.tabs.findIndex((t) => t.id === id);
        const next = s.tabs.filter((t) => t.id !== id);
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
      if (tabs.length === 0) return;
      set({ activeTabId: tabs[0].id });
      saveTabs(tabs, tabs[0].id);
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
    grpcWebActiveEnvId: null,
    grpcActiveEnvId: null,
    sdkActiveEnvId: null,
    setGrpcWebEnvironments: (envs) => set({ grpcWebEnvironments: envs }),
    setGrpcEnvironments: (envs) => set({ grpcEnvironments: envs }),
    setSdkEnvironments: (envs) => set({ sdkEnvironments: envs }),
    setGrpcWebActiveEnvId: (id) => set({ grpcWebActiveEnvId: id }),
    setGrpcActiveEnvId: (id) => set({ grpcActiveEnvId: id }),
    setSdkActiveEnvId: (id) => set({ sdkActiveEnvId: id }),
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

    theme: initialTheme,
    setTheme: (theme) => {
      if (typeof window !== "undefined") {
        localStorage.setItem(THEME_KEY, theme);
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
      if (typeof window !== "undefined") {
        localStorage.setItem(TUTORIAL_KEY, show ? "false" : "true");
      }
      set({ showTutorial: show });
    },

    userName: loadUserName(),
    setUserName: (name) => {
      if (typeof window !== "undefined") {
        localStorage.setItem(USERNAME_KEY, name);
      }
      set({ userName: name });
    },

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
      set((s) => {
        const next = [entry, ...s.savedRequests];
        saveSavedRequests(next);
        return { savedRequests: next };
      });
    },
    deleteSavedRequest: (id) => {
      set((s) => {
        const next = s.savedRequests.filter((r) => r.id !== id);
        saveSavedRequests(next);
        return { savedRequests: next };
      });
    },
    renameSavedRequest: (id, name) => {
      set((s) => {
        const next = s.savedRequests.map((r) =>
          r.id === id ? { ...r, name } : r
        );
        saveSavedRequests(next);
        return { savedRequests: next };
      });
    },

    maxHistorySize: loadMaxHistorySize(),
    setMaxHistorySize: (size) => {
      localStorage.setItem(MAX_HISTORY_KEY, String(size));
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
        localStorage.setItem(DEFAULT_HEADERS_KEY, JSON.stringify(next));
        return { defaultHeaders: next };
      });
    },
  };
});

// Defer loading heavy data until after initial render
if (typeof window !== "undefined") {
  requestAnimationFrame(() => {
    const history = loadHistory();
    const savedRequests = loadSavedRequests();
    if (history.length > 0 || savedRequests.length > 0) {
      useAppStore.setState({ history, savedRequests });
    }
  });
}

export function useActiveTab(): RequestTab | null {
  const activeTabId = useAppStore((s) => s.activeTabId);
  const tabs = useAppStore((s) => s.tabs);
  return tabs.find((t) => t.id === activeTabId) ?? null;
}
