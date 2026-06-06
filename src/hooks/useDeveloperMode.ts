// CONTRACT LOCK — useDeveloperMode() signature is consumed by Sprint 2 + 3 Vault.
// Do not change { enabled, hasValidToken, isSuperAdmin } return shape without
// a Sprint 3+ review. Sprint 3 added `isSuperAdmin` (DEC #85) — additive only.
import { useAppStore } from "@/lib/store";

// Reactive view onto the Dev Mode booleans living in the main Zustand store.
// Kept as a hook (not a direct store read) so Vault has a stable integration
// surface even if storage moves later.
export interface DeveloperModeState {
  enabled: boolean;
  hasValidToken: boolean;
  isSuperAdmin: boolean;
}

export function useDeveloperMode(): DeveloperModeState {
  const enabled = useAppStore((state) => state.devModeEnabled);
  const hasValidToken = useAppStore((state) => state.hasValidToken);
  const isSuperAdmin = useAppStore((state) => state.isSuperAdmin);
  return { enabled, hasValidToken, isSuperAdmin };
}
