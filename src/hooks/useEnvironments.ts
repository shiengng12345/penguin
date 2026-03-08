import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { generateEnvId } from "@/lib/environment-store";
import { useAppStore } from "@/lib/store";
import { useActiveTab } from "@/lib/store";
import type { Environment, EnvVariable, ProtocolTab } from "@/lib/store";

const STORE_KEYS: Record<ProtocolTab, string> = {
  "grpc-web": "pengvi-grpc-web-environments",
  grpc: "pengvi-grpc-environments",
  sdk: "pengvi-sdk-environments",
};

const ACTIVE_KEYS: Record<ProtocolTab, string> = {
  "grpc-web": "pengvi-grpc-web-active-env",
  grpc: "pengvi-grpc-active-env",
  sdk: "pengvi-sdk-active-env",
};

interface ConfigEnvironment {
  name: string;
  color: string;
  variables: Record<string, string>;
}

interface ConfigProtocolSection {
  environments?: ConfigEnvironment[];
  packages?: string[];
}

type ConfigShape = Record<string, ConfigProtocolSection | undefined>;

async function fetchConfig(): Promise<string> {
  try {
    return await invoke<string>("read_config");
  } catch {
    try {
      const res = await fetch("/.pengvi.config.json");
      if (res.ok) return await res.text();
    } catch {
      // ignore
    }
  }
  return "";
}

function configEnvsForProtocol(
  config: ConfigShape,
  protocol: ProtocolTab
): ConfigEnvironment[] {
  const section = config[protocol];
  if (section?.environments) {
    return section.environments;
  }
  return [];
}

function configEnvToEnvironment(cfg: ConfigEnvironment): Environment {
  const variables: EnvVariable[] = Object.entries(cfg.variables ?? {}).map(
    ([key, value]) => ({ key, value })
  );
  return {
    id: generateEnvId(),
    name: cfg.name,
    color: cfg.color ?? "green",
    variables,
  };
}

function loadFromStorage(protocol: ProtocolTab): {
  environments: Environment[];
  activeEnvId: string | null;
} {
  if (typeof window === "undefined") {
    return { environments: [], activeEnvId: null };
  }
  const storeKey = STORE_KEYS[protocol];
  const activeKey = ACTIVE_KEYS[protocol];
  let environments: Environment[] = [];
  let activeEnvId: string | null = null;
  try {
    const raw = localStorage.getItem(storeKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      environments = Array.isArray(parsed) ? parsed : [];
    }
    const activeRaw = localStorage.getItem(activeKey);
    if (activeRaw) activeEnvId = activeRaw;
  } catch {
    // ignore
  }
  return { environments, activeEnvId };
}

function saveToStorage(
  protocol: ProtocolTab,
  environments: Environment[],
  activeEnvId: string | null
): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORE_KEYS[protocol], JSON.stringify(environments));
  if (activeEnvId) {
    localStorage.setItem(ACTIVE_KEYS[protocol], activeEnvId);
  } else {
    localStorage.removeItem(ACTIVE_KEYS[protocol]);
  }
}

(function hydrateAll() {
  if (typeof window === "undefined") return;
  const protocols: ProtocolTab[] = ["grpc-web", "grpc", "sdk"];
  for (const p of protocols) {
    const { environments, activeEnvId } = loadFromStorage(p);
    if (environments.length > 0 || activeEnvId) {
      useAppStore.setState((s) => {
        const next = { ...s };
        if (p === "grpc-web") {
          next.grpcWebEnvironments = environments;
          next.grpcWebActiveEnvId = activeEnvId;
        } else if (p === "grpc") {
          next.grpcEnvironments = environments;
          next.grpcActiveEnvId = activeEnvId;
        } else {
          next.sdkEnvironments = environments;
          next.sdkActiveEnvId = activeEnvId;
        }
        return next;
      });
    }
  }

  syncAllProtocolEnvs();
})();

function getEnvsKey(p: ProtocolTab) {
  return p === "grpc-web" ? "grpcWebEnvironments"
    : p === "grpc" ? "grpcEnvironments"
    : "sdkEnvironments";
}

function getActiveKey(p: ProtocolTab) {
  return p === "grpc-web" ? "grpcWebActiveEnvId"
    : p === "grpc" ? "grpcActiveEnvId"
    : "sdkActiveEnvId";
}

function syncAllProtocolEnvs() {
  fetchConfig().then((raw) => {
    if (!raw?.trim()) return;
    let config: ConfigShape;
    try { config = JSON.parse(raw); } catch { return; }

    const protocols: ProtocolTab[] = ["grpc-web", "grpc", "sdk"];
    const update: Record<string, unknown> = {};

    for (const p of protocols) {
      const configEnvs = configEnvsForProtocol(config, p);
      if (configEnvs.length === 0) continue;

      const state = useAppStore.getState();
      const existing = state[getEnvsKey(p)] as Environment[];
      const currentActiveId = state[getActiveKey(p)] as string | null;

      const byName = new Map(existing.map((e) => [e.name, e]));
      const merged: Environment[] = [];

      for (const cfg of configEnvs) {
        const ex = byName.get(cfg.name);
        if (ex) {
          merged.push({
            ...ex,
            color: cfg.color ?? ex.color,
            variables: Object.entries(cfg.variables ?? {}).map(([key, value]) => ({ key, value })),
          });
        } else {
          merged.push(configEnvToEnvironment(cfg));
        }
      }

      const nextActiveId =
        currentActiveId && merged.some((e) => e.id === currentActiveId)
          ? currentActiveId
          : merged[0]?.id ?? null;

      update[getEnvsKey(p)] = merged;
      update[getActiveKey(p)] = nextActiveId;
      saveToStorage(p, merged, nextActiveId);
    }

    if (Object.keys(update).length > 0) {
      useAppStore.setState((s) => ({ ...s, ...update }));
    }
  });
}

export function useEnvironments(): {
  environments: Environment[];
  activeEnvId: string | null;
  activeEnv: Environment | null;
  setActiveEnvId: (id: string | null) => void;
  addEnvironment: (env: Environment) => void;
  updateEnvironment: (id: string, patch: Partial<Environment>) => void;
  deleteEnvironment: (id: string) => void;
  protocol: ProtocolTab;
} {
  const tab = useActiveTab();
  const protocol = tab?.protocolTab ?? "grpc-web";

  const environments =
    protocol === "grpc-web"
      ? useAppStore((s) => s.grpcWebEnvironments)
      : protocol === "grpc"
        ? useAppStore((s) => s.grpcEnvironments)
        : useAppStore((s) => s.sdkEnvironments);

  const activeEnvId =
    protocol === "grpc-web"
      ? useAppStore((s) => s.grpcWebActiveEnvId)
      : protocol === "grpc"
        ? useAppStore((s) => s.grpcActiveEnvId)
        : useAppStore((s) => s.sdkActiveEnvId);

  const activeEnv = useMemo(
    () => environments.find((e) => e.id === activeEnvId) ?? null,
    [environments, activeEnvId]
  );

  const setActiveEnvId = useCallback(
    (id: string | null) => {
      const state = useAppStore.getState();
      const p = protocol;
      if (p === "grpc-web") state.setGrpcWebActiveEnvId(id);
      else if (p === "grpc") state.setGrpcActiveEnvId(id);
      else state.setSdkActiveEnvId(id);
      const envs =
        p === "grpc-web" ? state.grpcWebEnvironments
        : p === "grpc" ? state.grpcEnvironments
        : state.sdkEnvironments;
      saveToStorage(p, envs, id);
    },
    [protocol]
  );

  const addEnv =
    protocol === "grpc-web"
      ? useAppStore.getState().addGrpcWebEnvironment
      : protocol === "grpc"
        ? useAppStore.getState().addGrpcEnvironment
        : useAppStore.getState().addSdkEnvironment;

  const updateEnv =
    protocol === "grpc-web"
      ? useAppStore.getState().updateGrpcWebEnvironment
      : protocol === "grpc"
        ? useAppStore.getState().updateGrpcEnvironment
        : useAppStore.getState().updateSdkEnvironment;

  const deleteEnv =
    protocol === "grpc-web"
      ? useAppStore.getState().deleteGrpcWebEnvironment
      : protocol === "grpc"
        ? useAppStore.getState().deleteGrpcEnvironment
        : useAppStore.getState().deleteSdkEnvironment;

  const addEnvironment = useCallback(
    (env: Environment) => {
      addEnv(env);
      const next = [...environments, env];
      saveToStorage(protocol, next, activeEnvId);
    },
    [protocol, environments, activeEnvId, addEnv]
  );

  const updateEnvironment = useCallback(
    (id: string, patch: Partial<Environment>) => {
      updateEnv(id, patch);
      const next = environments.map((e) =>
        e.id === id ? { ...e, ...patch } : e
      );
      saveToStorage(protocol, next, activeEnvId);
    },
    [protocol, environments, activeEnvId, updateEnv]
  );

  const deleteEnvironment = useCallback(
    (id: string) => {
      deleteEnv(id);
      const next = environments.filter((e) => e.id !== id);
      const nextActive = activeEnvId === id ? null : activeEnvId;
      saveToStorage(protocol, next, nextActive);
    },
    [protocol, environments, activeEnvId, deleteEnv]
  );

  return {
    environments,
    activeEnvId,
    activeEnv,
    setActiveEnvId,
    addEnvironment,
    updateEnvironment,
    deleteEnvironment,
    protocol,
  };
}
