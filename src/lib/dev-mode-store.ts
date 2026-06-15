import { logger } from "@/lib/logger";
import {
  getPersistedValue,
  setPersistedValue,
} from "@/lib/app-persistence";
import { APP_VALUE_KEYS } from "@/lib/persistence-keys";
import { useAppStore } from "@/lib/store";

const LOG_SCOPE = "dev-mode-store";

// SHA-256 hashes of the expected tokens — the raw values never live in source
// so git history / extracted bundles only ever see opaque hex. Validate flow:
// user input → SHA-256 (Web Crypto) → hex compare against these constants.
// To rotate: compute the new hash with `printf "<token>" | shasum -a 256`.
const NORMAL_TOKEN_HASH = "7eb26c3596d5691379d0107ec58f21db2cb0a4aad9af9894337ce2902e169bff";
const SUPERADMIN_TOKEN_HASH = "b30412f69b46ee4d67eb1960247086a17ac4aaf05cc5347e7bec40a39ddda5fd";

// Cached hash of the in-memory token so requireSuperAdmin() stays synchronous
// (called from CRUD entry points that cannot await). Computed once at validate
// time. The raw token itself is also kept for Sprint 2 Vault remote calls.
let inMemoryToken: string | null = null;
let inMemoryTokenHash: string | null = null;

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

// SHA-256 hex digest of a UTF-8 string. Uses Web Crypto, available in Tauri
// webview + Node 20+. Never throws on valid input.
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface TokenTierMatch {
  matchedNormal: boolean;
  matchedSuper: boolean;
}
async function classifyTokenInput(input: string): Promise<TokenTierMatch> {
  const inputHash = await sha256Hex(input);
  const matchedNormal = inputHash === NORMAL_TOKEN_HASH;
  const matchedSuper = inputHash === SUPERADMIN_TOKEN_HASH;
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
    const tier = await classifyTokenInput(stored);
    const isAnyMatch = tier.matchedNormal || tier.matchedSuper;
    // Disk token doesn't match current build — could be after token rotation.
    if (!isAnyMatch) {
      logger.warn(LOG_SCOPE, "loadToken — disk token no longer valid");
      return { success: true, loaded: false };
    }
    inMemoryToken = stored;
    inMemoryTokenHash = await sha256Hex(stored);
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

// Hash user input + compare against stored hashes. On match, persist the raw
// token (so reloads work) and flip the store booleans. Raw token + its hash
// stay in memory for the session.
export async function validateAndSetToken(
  payload: ValidateTokenPayload,
): Promise<ValidateTokenResult> {
  logger.info(LOG_SCOPE, "validateAndSetToken — entry");
  const tier = await classifyTokenInput(payload.input);
  const isAnyMatch = tier.matchedNormal || tier.matchedSuper;
  if (!isAnyMatch) {
    logger.warn(LOG_SCOPE, "validateAndSetToken — token mismatch");
    return { success: true, matched: false, isSuperAdmin: false };
  }
  try {
    inMemoryToken = payload.input;
    inMemoryTokenHash = await sha256Hex(payload.input);
    setPersistedValue(APP_VALUE_KEYS.devModeToken, payload.input);
    const isSuperAdmin = tier.matchedSuper;
    useAppStore.getState().setHasValidToken(true);
    useAppStore.getState().setIsSuperAdmin(isSuperAdmin);
    logger.info(LOG_SCOPE, "validateAndSetToken — token configured", { isSuperAdmin });
    return { success: true, matched: true, isSuperAdmin };
  } catch (error) {
    inMemoryToken = null;
    inMemoryTokenHash = null;
    logger.error(LOG_SCOPE, "validateAndSetToken — persist failed", error);
    return { success: false, matched: false, isSuperAdmin: false };
  }
}

// Soft clear: drop the in-memory token and flip the store booleans off, but
// keep the disk record so toggling Dev Mode back on later auto-restores.
export function clearTokenInMemory(): void {
  logger.info(LOG_SCOPE, "clearTokenInMemory — entry");
  inMemoryToken = null;
  inMemoryTokenHash = null;
  useAppStore.getState().setHasValidToken(false);
  useAppStore.getState().setIsSuperAdmin(false);
  logger.info(LOG_SCOPE, "clearTokenInMemory — cleared");
}

// Sprint 2 Vault entry point. Returns the in-memory raw token so callers that
// need to authenticate remote calls can reach it. Kept here so the value never
// travels through Zustand / React props. NEVER log the return value.
export function getInMemoryDevToken(): string | null {
  return inMemoryToken;
}

// Synchronous superadmin gate — compares the CACHED hash of the in-memory
// token against the hardcoded super hash. Stays sync so CRUD handlers can call
// it at entry without await.
export function requireSuperAdmin(): boolean {
  const hasHash = inMemoryTokenHash !== null;
  if (!hasHash) return false;
  return inMemoryTokenHash === SUPERADMIN_TOKEN_HASH;
}

// App-start hook. If the user enabled Dev Mode in a previous session, the
// boolean has been hydrated from disk by the store; we still need to pull
// the token off disk so hasValidToken + isSuperAdmin flip automatically.
// Safe to call when Dev Mode is off — it no-ops.
export async function initializeDevModeOnAppStart(): Promise<void> {
  logger.info(LOG_SCOPE, "initializeDevModeOnAppStart — entry");
  // Read disk directly via the hydrated cache instead of trusting the
  // Zustand snapshot. The store's initial value for devModeEnabled is
  // computed at module-eval time and can race ahead of hydration; once
  // the helper trusted a stale `false` here, the token would never get
  // pulled into memory and Vault/Docs/REST/Home would stay locked even
  // though disk had a valid super-admin token. Reading the cache (which
  // by now IS hydrated, since App.tsx's effect runs post-render) is
  // authoritative.
  const enabledOnDisk =
    getPersistedValue(APP_VALUE_KEYS.devModeEnabled) === "true";
  if (!enabledOnDisk) {
    logger.info(LOG_SCOPE, "initializeDevModeOnAppStart — dev mode off, skipping");
    useAppStore.getState().setDevModeHydrated(true);
    return;
  }
  // Self-heal the store boolean if it lost the race at module-eval time.
  if (!useAppStore.getState().devModeEnabled) {
    useAppStore.getState().setDevModeEnabled(true);
  }
  await loadToken();
  useAppStore.getState().setDevModeHydrated(true);
  logger.info(LOG_SCOPE, "initializeDevModeOnAppStart — exit");
}
