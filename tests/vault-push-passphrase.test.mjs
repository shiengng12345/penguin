import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

// Node 18 does not expose globalThis.crypto inside data: URL module realms,
// so the production decryptDocUrl (Web Crypto) would silently fail and the
// passphrase would fall back to its raw form. Polyfill mirrors the existing
// vault-lark-encrypted-flow test.
if (globalThis.crypto === undefined) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

// Reproduces the reported bug: a user who configured the vault with the
// passphrase "PENGUIN" (instead of pasting the real Lark URL) can SYNC fine
// but PUSH fails with "URL must be a Lark Suite or Feishu link". The sync path
// resolves the passphrase to the real URL via resolveLarkSource before
// validating; the push path must do the same.
//
// This loads the REAL vault-push.ts wired to the REAL vault-lark.ts (only leaf
// dependencies — shell, persistence, crypto, store — are mocked) so the
// passphrase actually decrypts through the production resolve+validate code.

const LEAF_MOCKS = {
  "@/lib/logger": "export const logger = { info: () => {}, warn: () => {}, error: () => {} };",
  "@/lib/app-persistence": `
    export function getPersistedValue() { return null; }
    export function setPersistedValue() {}
    export function deletePersistedValue() {}
  `,
  "@/lib/persistence-keys": `
    export const APP_VALUE_KEYS = {
      devModeToken: "dev-mode-token",
      vaultData: "vault-data",
      vaultLarkUrl: "vault-lark-url",
      vaultLastSyncedAt: "vault-last-synced-at",
      vaultLarkUrlLocked: "vault-lark-url-locked",
      vaultLastSyncedHash: "vault-last-synced-hash",
      vaultLastSyncedContentHash: "vault-last-synced-content-hash",
    };
  `,
  "@/lib/sidecar": 'export const NODE_PATH_SETUP = "";',
  "@/lib/store": `
    const state = {
      setVaultLarkUrl: () => {},
      setVaultProjects: () => {},
      setVaultIsDirty: () => {},
      setVaultLastSyncedAt: () => {},
    };
    export const useAppStore = { getState: () => state };
  `,
  // lark-cli shell-out always "succeeds" with empty output — the doc is treated
  // as a first upload (no remote ```json``` block => no conflict).
  "@tauri-apps/plugin-shell": `
    export const Command = { create: () => ({ execute: async () => ({ code: 0, stdout: "", stderr: "" }) }) };
  `,
};

function toDataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

function patchImports(source, mocks) {
  let patched = source;
  for (const [specifier, mockSource] of Object.entries(mocks)) {
    patched = patched.replaceAll(`"${specifier}"`, JSON.stringify(toDataUrl(mockSource)));
  }
  return patched;
}

function transpile(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return outputText;
}

async function loadVaultPushModule() {
  // 1. Build the REAL vault-lark module with its leaf deps mocked.
  const larkSource = await readFile(
    new URL("../src/components/vault/vault-lark.ts", import.meta.url),
    "utf8",
  );
  const larkMocks = {
    ...LEAF_MOCKS,
    "@/lib/dev-mode-store": "export function getInMemoryDevToken() { return null; }",
    "./vault-storage": `
      export function parseVaultJson() { return { success: true, projects: [] }; }
      export function persistVaultToDisk() { return { success: true }; }
    `,
    "./vault-crypto": `
      export async function decryptVaultJson() { return { success: false, reason: "mock" }; }
      export function getVaultCryptoTokensFromToken() { return {}; }
      export function isVaultEncryptedEnvelope() { return false; }
    `,
  };
  const larkOut = transpile(patchImports(larkSource, larkMocks));
  const larkUrl = `${toDataUrl(larkOut)}#${Math.random()}`;

  // 2. Build the REAL vault-push module, pointing "./vault-lark" at the module
  //    above and mocking only push-specific leaf deps.
  const pushSource = await readFile(
    new URL("../src/components/vault/vault-push.ts", import.meta.url),
    "utf8",
  );
  const pushMocks = {
    ...LEAF_MOCKS,
    "./vault-lark": larkUrl,
    "@/lib/dev-mode-store": `
      export function getInMemoryDevToken() { return null; }
      export function requireSuperAdmin() { return true; }
      export async function getStoredDeveloperModeTokens() { return { adminToken: "admin-tok", superAdminToken: "super-tok" }; }
    `,
    "./vault-crypto": `
      export async function encryptVaultJson() { return { v: 1, alg: "AES-GCM", iv: "iv", data: "data" }; }
      export function getVaultCryptoTokensFromToken() { return {}; }
      export function isVaultEncryptedEnvelope() { return false; }
      export async function reencryptVaultJson() { return { success: true, envelope: {} }; }
    `,
  };
  // "./vault-lark" mock value is already a data URL, so patch it as a raw
  // specifier replacement without re-wrapping.
  let patchedPush = pushSource;
  for (const [specifier, mockSource] of Object.entries(pushMocks)) {
    const replacement = specifier === "./vault-lark" ? mockSource : toDataUrl(mockSource);
    patchedPush = patchedPush.replaceAll(`"${specifier}"`, JSON.stringify(replacement));
  }
  const pushOut = transpile(patchedPush);
  return import(`${toDataUrl(pushOut)}#${Math.random()}`);
}

test("pushToLark resolves the 'PENGUIN' passphrase instead of rejecting it as a non-Lark URL", async () => {
  const { pushToLark } = await loadVaultPushModule();
  const result = await pushToLark({
    url: "PENGUIN",
    projects: [{ id: "p1", name: "Demo", credentials: [] }],
    expectedHash: null,
  });
  // The bug: validateLarkUrl ran against the raw "PENGUIN" string and returned
  // "URL must be a Lark Suite or Feishu link", so the push aborted before any
  // shell call. After the fix the passphrase resolves to the real Lark URL.
  assert.doesNotMatch(
    result.reason ?? "",
    /Lark Suite|Feishu|larksuite\.com|feishu\.cn/i,
    `push must not reject a valid passphrase as a non-Lark URL (got reason: ${result.reason})`,
  );
  assert.equal(result.success, true);
});
