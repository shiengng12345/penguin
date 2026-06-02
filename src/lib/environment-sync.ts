import {
  configEnvsForProtocol,
  fetchRemoteConfig,
  mergeConfigEnvironments,
  type ConfigShape,
  type ConfigSyncConflict,
} from "./config-sync";
import { persistEnvironmentSnapshot } from "./environment-persistence";
import { persistRemoteConfigSnapshot } from "./remote-config-persistence";
import type { Environment, ProtocolTab } from "./store";

export interface RemoteEnvironmentSyncResult {
  environments: Environment[];
  activeEnvId: string | null;
  added: string[];
  skipped: string[];
  conflicts: ConfigSyncConflict[];
  conflictNames: string[];
  pulledAt: string;
  changed: boolean;
}

export async function syncRemoteConfigForProtocol({
  protocol,
  environments,
  activeEnvId,
  fetchConfig = fetchRemoteConfig,
}: {
  protocol: ProtocolTab;
  environments: Environment[];
  activeEnvId: string | null;
  fetchConfig?: () => Promise<ConfigShape>;
}): Promise<RemoteEnvironmentSyncResult> {
  const config = await fetchConfig();
  const cachedConfig = persistRemoteConfigSnapshot(config);
  const configEnvs = configEnvsForProtocol(config, protocol);
  const result = mergeConfigEnvironments(environments, configEnvs, protocol);
  const nextActiveEnvId =
    activeEnvId && result.environments.some((env) => env.id === activeEnvId)
      ? activeEnvId
      : result.environments[0]?.id ?? null;
  const changed = result.changed || nextActiveEnvId !== activeEnvId;

  if (changed) {
    persistEnvironmentSnapshot(protocol, result.environments, nextActiveEnvId);
  }

  return {
    environments: result.environments,
    activeEnvId: nextActiveEnvId,
    added: result.added,
    skipped: result.skipped,
    conflicts: result.conflicts,
    conflictNames: result.conflicts.map((conflict) => conflict.name),
    pulledAt: cachedConfig.pulledAt,
    changed,
  };
}
