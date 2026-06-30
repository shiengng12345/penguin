import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

// Bug: switching the vault to a NEW Lark doc leaves the previous doc's
// sync-hash anchor (vaultLastSyncedHash / vaultLastSyncedContentHash) on disk.
// The next push reads that stale anchor as expectedHash and mis-fires a
// "conflict" against a doc the local data was never synced from. saveLarkUrl
// must drop the now-invalid anchors when the URL actually changes — but must
// NOT drop them when re-saving the SAME url (the normal sync path re-saves the
// same url right before syncing, and the anchor must survive that).
//
// Loads the REAL vault-lark.ts with a stateful in-memory persistence mock so
// we can assert exactly which keys remain after saveLarkUrl.

const KEYS = {
  vaultLarkUrl: "penguin-vault-lark-url",
  vaultLastSyncedHash: "penguin-vault-last-synced-hash",
  vaultLastSyncedContentHash: "penguin-vault-last-synced-content-hash",
  vaultLarkUrlLocked: "penguin-vault-lark-url-locked",
};

async function loadSaveLarkUrl(seed) {
  globalThis.__larkUrlStore = { ...seed };
  const source = await readFile(
    new URL("../src/components/vault/vault-lark.ts", import.meta.url),
    "utf8",
  );
  const mocks = {
    "@/lib/logger": "export const logger = { info: () => {}, warn: () => {}, error: () => {} };",
    "@/lib/app-persistence": `
      export function getPersistedValue(key) {
        const s = globalThis.__larkUrlStore;
        return Object.prototype.hasOwnProperty.call(s, key) ? s[key] : null;
      }
      export function setPersistedValue(key, value) { globalThis.__larkUrlStore[key] = value; }
      export function deletePersistedValue(key) { delete globalThis.__larkUrlStore[key]; }
    `,
    "@/lib/persistence-keys": `
      export const APP_VALUE_KEYS = ${JSON.stringify(KEYS)};
    `,
    "@/lib/dev-mode-store": "export function getInMemoryDevToken() { return null; }",
    "@/lib/store": `
      const state = { setVaultLarkUrl: () => {}, setVaultProjects: () => {}, setVaultIsDirty: () => {}, setVaultLastSyncedAt: () => {} };
      export const useAppStore = { getState: () => state };
    `,
    "@/lib/sidecar": 'export const NODE_PATH_SETUP = "";',
    "./vault-storage": `
      export function parseVaultJson() { return { success: true, projects: [] }; }
      export function persistVaultToDisk() { return { success: true }; }
    `,
    "./vault-crypto": `
      export async function decryptVaultJson() { return { success: false, reason: "mock" }; }
      export function getVaultCryptoTokensFromToken() { return {}; }
      export function isVaultEncryptedEnvelope() { return false; }
    `,
    "@tauri-apps/plugin-shell": `
      export const Command = { create: () => ({ execute: async () => ({ code: 0, stdout: "", stderr: "" }) }) };
    `,
  };
  let patched = source;
  for (const [specifier, mockSource] of Object.entries(mocks)) {
    const url = `data:text/javascript;base64,${Buffer.from(mockSource).toString("base64")}`;
    patched = patched.replaceAll(`"${specifier}"`, JSON.stringify(url));
  }
  const { outputText } = ts.transpileModule(patched, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}#${Math.random()}`);
}

test("saveLarkUrl clears the stale sync-hash anchors when the URL actually changes", async () => {
  const { saveLarkUrl } = await loadSaveLarkUrl({
    [KEYS.vaultLarkUrl]: "https://old.larksuite.com/docx/OLD",
    [KEYS.vaultLastSyncedHash]: "hash-of-old-markdown",
    [KEYS.vaultLastSyncedContentHash]: "content-hash-of-old-projects",
    [KEYS.vaultLarkUrlLocked]: "https://old.larksuite.com/docx/OLD",
  });

  const result = saveLarkUrl({ url: "https://new.larksuite.com/docx/NEW" });

  assert.equal(result.success, true);
  const s = globalThis.__larkUrlStore;
  assert.equal(s[KEYS.vaultLarkUrl], "https://new.larksuite.com/docx/NEW");
  // Stale anchors from the old doc must be gone so the next push sees
  // expectedHash === null and does NOT mis-fire a conflict.
  assert.equal(s[KEYS.vaultLastSyncedHash] ?? null, null);
  assert.equal(s[KEYS.vaultLastSyncedContentHash] ?? null, null);
  assert.equal(s[KEYS.vaultLarkUrlLocked] ?? null, null);
});

test("saveLarkUrl preserves the sync-hash anchor when re-saving the SAME URL (sync happy path)", async () => {
  const SAME = "https://team.larksuite.com/docx/SAME";
  const { saveLarkUrl } = await loadSaveLarkUrl({
    [KEYS.vaultLarkUrl]: SAME,
    [KEYS.vaultLastSyncedHash]: "hash-must-survive",
    [KEYS.vaultLastSyncedContentHash]: "content-hash-must-survive",
  });

  saveLarkUrl({ url: SAME });

  const s = globalThis.__larkUrlStore;
  assert.equal(s[KEYS.vaultLarkUrl], SAME);
  // Re-saving the same url is the normal pre-sync write; the anchor must NOT
  // be dropped or every routine sync would lose its conflict baseline.
  assert.equal(s[KEYS.vaultLastSyncedHash], "hash-must-survive");
  assert.equal(s[KEYS.vaultLastSyncedContentHash], "content-hash-must-survive");
});

test("saveLarkUrl on a first-ever save (no previous URL) just stores the URL", async () => {
  const { saveLarkUrl } = await loadSaveLarkUrl({});

  const result = saveLarkUrl({ url: "https://team.larksuite.com/docx/FIRST" });

  assert.equal(result.success, true);
  assert.equal(globalThis.__larkUrlStore[KEYS.vaultLarkUrl], "https://team.larksuite.com/docx/FIRST");
});
