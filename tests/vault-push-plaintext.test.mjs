import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

if (globalThis.crypto === undefined) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

// TEMP behavior (encryption-at-rest disabled pending redesign): pushToLark must
// write the ACTUAL, readable vault to the Lark doc — plaintext markdown with a
// ```json fence of the projects — NOT the opaque `penguin-vault-encrypted-v1`
// envelope. Re-enable the encrypted assertions in vault-lark-encrypted-flow when
// encryption is restored.

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

async function loadVaultPushModule() {
  const source = await readFile(
    new URL("../src/components/vault/vault-push.ts", import.meta.url),
    "utf8",
  );
  const mocks = {
    "@/lib/logger": dataUrl("export const logger = { info: () => {}, warn: () => {}, error: () => {} };"),
    "@/lib/app-persistence": dataUrl(`
      export function getPersistedValue() { return null; }
      export function setPersistedValue() {}
      export function deletePersistedValue() {}
    `),
    "@/lib/persistence-keys": dataUrl(`
      export const APP_VALUE_KEYS = {
        devModeToken: "dev-mode-token",
        vaultLastSyncedHash: "vault-last-synced-hash",
        vaultLastSyncedContentHash: "vault-last-synced-content-hash",
        vaultLarkUrlLocked: "vault-lark-url-locked",
      };
    `),
    "@/lib/dev-mode-store": dataUrl(`
      export function requireSuperAdmin() { return true; }
      export function getInMemoryDevToken() { return null; }
      export async function getStoredDeveloperModeTokens() { return { adminToken: "a", superAdminToken: "b" }; }
    `),
    "./vault-lark": dataUrl(`
      export function extractJsonFromMarkdown() { return { success: false, reason: "no json" }; }
      export async function extractVaultJsonFromMarkdown() { return { success: true, json: "[]" }; }
      export async function resolveLarkSource(input) { return input; }
      export async function runLarkFetch() { return { success: true, markdown: "" }; }
      export async function runLarkUpdate(payload) {
        globalThis.__pushedMarkdown = payload.markdown;
        return { success: true };
      }
      export function validateLarkUrl() { return { success: true }; }
    `),
    // If encryption is (still) active this fake envelope is what would be written.
    "./vault-crypto": dataUrl(`
      export async function encryptVaultJson() { return { format: "penguin-vault-encrypted-v1", recipients: [], iv: "iv", data: "ciphertext" }; }
      export function getVaultCryptoTokensFromToken() { return {}; }
      export function isVaultEncryptedEnvelope() { return false; }
      export async function reencryptVaultJson() { return { success: true, envelope: { format: "penguin-vault-encrypted-v1" } }; }
    `),
  };
  let patched = source;
  for (const [specifier, url] of Object.entries(mocks)) {
    patched = patched.replaceAll(`"${specifier}"`, JSON.stringify(url));
  }
  const { outputText } = ts.transpileModule(patched, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import(`${dataUrl(outputText)}#${Math.random()}`);
}

test("pushToLark writes the readable plaintext vault, not an encrypted envelope", async () => {
  globalThis.__pushedMarkdown = undefined;
  const { pushToLark } = await loadVaultPushModule();

  const result = await pushToLark({
    url: "https://team.larksuite.com/docx/abc",
    projects: [
      {
        id: "p1",
        name: "Brazil Prod",
        environments: [{ id: "prod", name: "PROD", color: "bg-red-500" }],
        credentials: [
          { id: "c1", kind: "login", name: "Admin", valueByEnv: { prod: "secret-password-value" }, isSensitive: true },
        ],
        kinds: [{ id: "login", label: "Login", baseKind: "login" }],
      },
    ],
    expectedHash: null,
  });

  assert.equal(result.success, true);
  const pushed = globalThis.__pushedMarkdown ?? "";
  // The doc must contain the actual vault, readable.
  assert.match(pushed, /Brazil Prod/);
  assert.match(pushed, /```json/);
  // And must NOT be the opaque encrypted envelope (encryption disabled for now).
  assert.doesNotMatch(pushed, /penguin-vault-encrypted-v1/);
});
