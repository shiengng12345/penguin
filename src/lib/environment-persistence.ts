import {
  deletePersistedValue,
  getPersistedValue,
  setPersistedValue,
} from "./app-persistence";
import {
  ACTIVE_ENV_VALUE_KEYS,
  ENVIRONMENT_VALUE_KEYS,
  type PersistedProtocol,
} from "./persistence-keys";
import type { Environment, ProtocolTab } from "./store";

export function loadEnvironmentSnapshot(protocol: ProtocolTab): {
  environments: Environment[];
  activeEnvId: string | null;
} {
  const storeKey = ENVIRONMENT_VALUE_KEYS[protocol as PersistedProtocol];
  const activeKey = ACTIVE_ENV_VALUE_KEYS[protocol as PersistedProtocol];
  let environments: Environment[] = [];
  let activeEnvId: string | null = null;

  try {
    const raw = getPersistedValue(storeKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      environments = Array.isArray(parsed) ? parsed : [];
    }
    activeEnvId = getPersistedValue(activeKey);
  } catch {
    environments = [];
    activeEnvId = null;
  }

  return { environments, activeEnvId };
}

export function persistEnvironmentSnapshot(
  protocol: ProtocolTab,
  environments: Environment[],
  activeEnvId: string | null,
): void {
  setPersistedValue(
    ENVIRONMENT_VALUE_KEYS[protocol as PersistedProtocol],
    JSON.stringify(environments),
  );
  const activeKey = ACTIVE_ENV_VALUE_KEYS[protocol as PersistedProtocol];
  if (activeEnvId) {
    setPersistedValue(activeKey, activeEnvId);
  } else {
    deletePersistedValue(activeKey);
  }
}
