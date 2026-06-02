import {
  getPersistedValue,
  setPersistedValue,
} from "./app-persistence";
import {
  createRemoteConfigCacheSnapshot,
  parseRemoteConfigCacheSnapshot,
  type ConfigShape,
  type RemoteConfigCacheSnapshot,
} from "./config-sync";
import { APP_VALUE_KEYS } from "./persistence-keys";

export function persistRemoteConfigSnapshot(
  config: ConfigShape,
  options: { source?: string; pulledAt?: string } = {},
): RemoteConfigCacheSnapshot {
  const snapshot = createRemoteConfigCacheSnapshot(config, options);
  setPersistedValue(APP_VALUE_KEYS.remoteConfigCache, JSON.stringify(snapshot));
  setPersistedValue(APP_VALUE_KEYS.remoteConfigLastPulledAt, snapshot.pulledAt);
  setPersistedValue(APP_VALUE_KEYS.remoteConfigSource, snapshot.source);
  return snapshot;
}

export function loadRemoteConfigSnapshot(): RemoteConfigCacheSnapshot | null {
  return parseRemoteConfigCacheSnapshot(
    getPersistedValue(APP_VALUE_KEYS.remoteConfigCache),
  );
}
