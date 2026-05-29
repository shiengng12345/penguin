import { useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@/lib/store";
import { useActiveTab } from "@/lib/store";
import { hydratePersistedValues } from "@/lib/app-persistence";
import {
  loadEnvironmentSnapshot,
  persistEnvironmentSnapshot,
} from "@/lib/environment-persistence";
import {
  configEnvsForProtocol,
  mergeConfigEnvironments,
  parseConfig,
  type ConfigShape,
} from "@/lib/config-sync";
import type { Environment, ProtocolTab } from "@/lib/store";

async function fetchConfig(): Promise<string> {
  try {
    return await invoke<string>("read_config");
  } catch {
    try {
      const res = await fetch("/.penguin.config.json");
      if (res.ok) return await res.text();
    } catch {
      // ignore
    }
  }
  return "";
}

(function hydrateAll() {
  if (typeof window === "undefined") return;
  void hydratePersistedValues().then(() => {
    const protocols: ProtocolTab[] = ["grpc-web", "grpc", "sdk", "rest"];
    for (const p of protocols) {
      const { environments, activeEnvId } = loadEnvironmentSnapshot(p);
      if (environments.length > 0 || activeEnvId) {
        useAppStore.setState((s) => {
          const next = { ...s };
          if (p === "grpc-web") {
            next.grpcWebEnvironments = environments;
            next.grpcWebActiveEnvId = activeEnvId;
          } else if (p === "grpc") {
            next.grpcEnvironments = environments;
            next.grpcActiveEnvId = activeEnvId;
          } else if (p === "sdk") {
            next.sdkEnvironments = environments;
            next.sdkActiveEnvId = activeEnvId;
          } else {
            next.restEnvironments = environments;
            next.restActiveEnvId = activeEnvId;
          }
          return next;
        });
      }
    }

    // Defer Tauri IPC config sync to after first paint
    requestAnimationFrame(() => syncAllProtocolEnvs());
  });
})();

function getEnvsKey(p: ProtocolTab) {
  return p === "grpc-web" ? "grpcWebEnvironments"
    : p === "grpc" ? "grpcEnvironments"
    : p === "sdk" ? "sdkEnvironments"
    : "restEnvironments";
}

function getActiveKey(p: ProtocolTab) {
  return p === "grpc-web" ? "grpcWebActiveEnvId"
    : p === "grpc" ? "grpcActiveEnvId"
    : p === "sdk" ? "sdkActiveEnvId"
    : "restActiveEnvId";
}

function syncAllProtocolEnvs() {
  fetchConfig().then((raw) => {
    if (!raw?.trim()) return;
    let config: ConfigShape;
    try { config = parseConfig(raw); } catch { return; }

    const protocols: ProtocolTab[] = ["grpc-web", "grpc", "sdk", "rest"];
    const update: Record<string, unknown> = {};

    for (const p of protocols) {
      const configEnvs = configEnvsForProtocol(config, p);
      if (configEnvs.length === 0) continue;

      const state = useAppStore.getState();
      const existing = state[getEnvsKey(p)] as Environment[];
      const currentActiveId = state[getActiveKey(p)] as string | null;

      const result = mergeConfigEnvironments(existing, configEnvs, p);

      const nextActiveId =
        currentActiveId && result.environments.some((e) => e.id === currentActiveId)
          ? currentActiveId
          : result.environments[0]?.id ?? null;

      if (!result.changed && nextActiveId === currentActiveId) continue;

      update[getEnvsKey(p)] = result.environments;
      update[getActiveKey(p)] = nextActiveId;
      persistEnvironmentSnapshot(p, result.environments, nextActiveId);
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
        : protocol === "sdk"
          ? useAppStore((s) => s.sdkEnvironments)
          : useAppStore((s) => s.restEnvironments);

  const activeEnvId =
    protocol === "grpc-web"
      ? useAppStore((s) => s.grpcWebActiveEnvId)
      : protocol === "grpc"
        ? useAppStore((s) => s.grpcActiveEnvId)
        : protocol === "sdk"
          ? useAppStore((s) => s.sdkActiveEnvId)
          : useAppStore((s) => s.restActiveEnvId);

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
      else if (p === "sdk") state.setSdkActiveEnvId(id);
      else state.setRestActiveEnvId(id);
      const envs =
        p === "grpc-web" ? state.grpcWebEnvironments
        : p === "grpc" ? state.grpcEnvironments
        : p === "sdk" ? state.sdkEnvironments
        : state.restEnvironments;
      persistEnvironmentSnapshot(p, envs, id);
    },
    [protocol]
  );

  const addEnv =
    protocol === "grpc-web"
      ? useAppStore.getState().addGrpcWebEnvironment
      : protocol === "grpc"
        ? useAppStore.getState().addGrpcEnvironment
        : protocol === "sdk"
          ? useAppStore.getState().addSdkEnvironment
          : useAppStore.getState().addRestEnvironment;

  const updateEnv =
    protocol === "grpc-web"
      ? useAppStore.getState().updateGrpcWebEnvironment
      : protocol === "grpc"
        ? useAppStore.getState().updateGrpcEnvironment
        : protocol === "sdk"
          ? useAppStore.getState().updateSdkEnvironment
          : useAppStore.getState().updateRestEnvironment;

  const deleteEnv =
    protocol === "grpc-web"
      ? useAppStore.getState().deleteGrpcWebEnvironment
      : protocol === "grpc"
        ? useAppStore.getState().deleteGrpcEnvironment
        : protocol === "sdk"
          ? useAppStore.getState().deleteSdkEnvironment
          : useAppStore.getState().deleteRestEnvironment;

  const addEnvironment = useCallback(
    (env: Environment) => {
      addEnv(env);
      const next = [...environments, env];
      persistEnvironmentSnapshot(protocol, next, activeEnvId);
    },
    [protocol, environments, activeEnvId, addEnv]
  );

  const updateEnvironment = useCallback(
    (id: string, patch: Partial<Environment>) => {
      updateEnv(id, patch);
      const next = environments.map((e) =>
        e.id === id ? { ...e, ...patch } : e
      );
      persistEnvironmentSnapshot(protocol, next, activeEnvId);
    },
    [protocol, environments, activeEnvId, updateEnv]
  );

  const deleteEnvironment = useCallback(
    (id: string) => {
      deleteEnv(id);
      const next = environments.filter((e) => e.id !== id);
      const nextActive = activeEnvId === id ? null : activeEnvId;
      persistEnvironmentSnapshot(protocol, next, nextActive);
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
