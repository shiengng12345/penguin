import { logger } from "@/lib/logger";
import {
  getPersistedValue,
  setPersistedValue,
} from "@/lib/app-persistence";
import { APP_VALUE_KEYS } from "@/lib/persistence-keys";
import { useAppStore } from "@/lib/store";

const LOG_SCOPE = "dev-mode-store";
const SUPERADMIN_MIN_LENGTH = 32;

// Module-scoped raw token. Per DEC #33 this MUST NOT enter Zustand or React
// state — only the boolean derived signal `hasValidToken` is shared.
let inMemoryToken: string | null = null;

export interface ValidateTokenPayload {
  input: string;
}

export interface LoadTokenResult {
  success: boolean;
  loaded: boolean;
}

export interface ValidateTokenResult {
  success: boolean;
  matched: boolean;
  isSuperAdmin: boolean;
}

// Compare the supplied raw token against the configured normal + super envs.
// Super match wins over normal match (DEC #75). Returns booleans only — never
// leaks the token value.
interface TokenTierMatch {
  matchedNormal: boolean;
  matchedSuper: boolean;
}
function classifyTokenInput(input: string): TokenTierMatch {
  const normalExpected = import.meta.env.VITE_DEV_MODE_TOKEN;
  const superExpected = import.meta.env.VITE_DEV_MODE_SUPERADMIN_TOKEN;
  const hasNormalExpected = typeof normalExpected === "string" && normalExpected.length > 0;
  const hasSuperExpected = typeof superExpected === "string" && superExpected.length > 0;
  const matchedNormal = hasNormalExpected && input === normalExpected;
  const matchedSuper = hasSuperExpected && input === superExpected;
  return { matchedNormal, matchedSuper };
}

// Read any previously-validated token from disk and mark the store as having
// a valid token. Called when the user toggles Dev Mode back on so the user
// does not have to re-enter the token every session.
export async function loadToken(): Promise<LoadTokenResult> {
  logger.info(LOG_SCOPE, "loadToken — entry");
  try {
    const stored = getPersistedValue(APP_VALUE_KEYS.devModeToken);
    const isMissing = stored === null;
    // First-time path — no token persisted yet; this is a normal state, not an error.
    if (isMissing) {
      logger.info(LOG_SCOPE, "loadToken — no token on disk");
      return { success: true, loaded: false };
    }
    inMemoryToken = stored;
    const tier = classifyTokenInput(stored);
    const isSuperAdmin = tier.matchedSuper;
    useAppStore.getState().setHasValidToken(true);
    useAppStore.getState().setIsSuperAdmin(isSuperAdmin);
    logger.info(LOG_SCOPE, "loadToken — token found on disk", { isSuperAdmin });
    return { success: true, loaded: true };
  } catch (error) {
    logger.error(LOG_SCOPE, "loadToken — disk read failed", error);
    return { success: false, loaded: false };
  }
}

// Compare user input against the build-time configured tokens (normal + super).
// On match, persist and flip the store booleans. On mismatch, leave state alone.
// CONTRACT NOTE: 如果未来改远端校验，必须改成 constant-time
export async function validateAndSetToken(
  payload: ValidateTokenPayload,
): Promise<ValidateTokenResult> {
  logger.info(LOG_SCOPE, "validateAndSetToken — entry");
  const tier = classifyTokenInput(payload.input);
  const isAnyMatch = tier.matchedNormal || tier.matchedSuper;
  const isMismatch = !isAnyMatch;
  // Token mismatch — failed validation; do not persist, do not mutate flags.
  if (isMismatch) {
    logger.warn(LOG_SCOPE, "validateAndSetToken — token mismatch");
    return { success: true, matched: false, isSuperAdmin: false };
  }
  try {
    inMemoryToken = payload.input;
    setPersistedValue(APP_VALUE_KEYS.devModeToken, payload.input);
    const isSuperAdmin = tier.matchedSuper;
    useAppStore.getState().setHasValidToken(true);
    useAppStore.getState().setIsSuperAdmin(isSuperAdmin);
    logger.info(LOG_SCOPE, "validateAndSetToken — token configured", { isSuperAdmin });
    return { success: true, matched: true, isSuperAdmin };
  } catch (error) {
    inMemoryToken = null;
    logger.error(LOG_SCOPE, "validateAndSetToken — persist failed", error);
    return { success: false, matched: false, isSuperAdmin: false };
  }
}

// Soft clear: drop the in-memory token and flip the store booleans off, but
// keep the disk record so toggling Dev Mode back on later auto-restores.
export function clearTokenInMemory(): void {
  logger.info(LOG_SCOPE, "clearTokenInMemory — entry");
  inMemoryToken = null;
  useAppStore.getState().setHasValidToken(false);
  useAppStore.getState().setIsSuperAdmin(false);
  logger.info(LOG_SCOPE, "clearTokenInMemory — cleared");
}

// Sprint 2 Vault entry point. Returns the in-memory token so the Vault can
// authenticate its remote calls. Kept here so the raw value never travels
// through Zustand / React props. NEVER log the return value.
export function getInMemoryDevToken(): string | null {
  return inMemoryToken;
}

// SPRINT 4 RED LINE (DEC #76):
// Client-side token model expires at distribution >1 user. Sprint 4 must
// migrate to server-side validation. Every CRUD handler MUST call this at
// entry — UI conditional rendering uses the Zustand boolean instead.
// Returns true only when the in-memory token strictly equals the super env.
export function requireSuperAdmin(): boolean {
  const superExpected = import.meta.env.VITE_DEV_MODE_SUPERADMIN_TOKEN;
  const hasExpected = typeof superExpected === "string" && superExpected.length > 0;
  const hasToken = inMemoryToken !== null;
  const isUnconfigured = !hasExpected;
  // Build was not configured with a super token — fail closed.
  if (isUnconfigured) return false;
  const isMissingToken = !hasToken;
  // No token in memory at all (Dev Mode never validated this session).
  if (isMissingToken) return false;
  return inMemoryToken === superExpected;
}

// App-start hook. If the user enabled Dev Mode in a previous session, the
// boolean has been hydrated from disk by the store; we still need to pull
// the token off disk so hasValidToken + isSuperAdmin flip automatically.
// Safe to call when Dev Mode is off — it no-ops.
export async function initializeDevModeOnAppStart(): Promise<void> {
  logger.info(LOG_SCOPE, "initializeDevModeOnAppStart — entry");
  warnIfSuperAdminMisconfigured();
  const isEnabled = useAppStore.getState().devModeEnabled;
  const isDisabled = !isEnabled;
  // Dev Mode never enabled previously — nothing to restore.
  if (isDisabled) {
    logger.info(LOG_SCOPE, "initializeDevModeOnAppStart — dev mode off, skipping");
    return;
  }
  await loadToken();
  logger.info(LOG_SCOPE, "initializeDevModeOnAppStart — exit");
}

// Boot-time sanity check for the super env. Per DEC #75 we do NOT fail boot;
// we just log a warning so a misconfigured build is observable.
function warnIfSuperAdminMisconfigured(): void {
  const normalExpected = import.meta.env.VITE_DEV_MODE_TOKEN;
  const superExpected = import.meta.env.VITE_DEV_MODE_SUPERADMIN_TOKEN;
  const hasSuper = typeof superExpected === "string" && superExpected.length > 0;
  const isSuperUnset = !hasSuper;
  // Super token not configured — nothing to validate; CRUD will fail closed.
  if (isSuperUnset) {
    logger.info(LOG_SCOPE, "warnIfSuperAdminMisconfigured — super token not configured");
    return;
  }
  const isTooShort = superExpected.length < SUPERADMIN_MIN_LENGTH;
  // Super tokens shorter than the minimum entropy bar are flagged at boot.
  if (isTooShort) {
    logger.warn(
      LOG_SCOPE,
      `warnIfSuperAdminMisconfigured — super token shorter than ${SUPERADMIN_MIN_LENGTH} chars`,
    );
  }
  const isSameAsNormal =
    typeof normalExpected === "string" && normalExpected === superExpected;
  // Super token collides with normal token — tier separation lost.
  if (isSameAsNormal) {
    logger.warn(
      LOG_SCOPE,
      "warnIfSuperAdminMisconfigured — super token equals normal token",
    );
  }
}
