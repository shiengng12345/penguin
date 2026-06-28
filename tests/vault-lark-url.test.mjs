import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

// Load vault-lark.ts with its imports swapped for inert mocks so we can call
// the pure validateLarkUrl function without pulling in Tauri / Zustand /
// disk persistence at module-load time. validateLarkUrl is pure — it never
// touches the shell or the store — so the mocks just need to satisfy import
// resolution.
async function loadVaultLarkModule() {
  const source = await readFile(
    new URL("../src/components/vault/vault-lark.ts", import.meta.url),
    "utf8",
  );

  const mocks = {
    "@/lib/logger": "export const logger = { info: () => {}, warn: () => {}, error: () => {} };",
    "@/lib/app-persistence": `
      export function getPersistedValue() { return null; }
      export function setPersistedValue() {}
      export function deletePersistedValue() {}
    `,
    "@/lib/persistence-keys": `
      export const APP_VALUE_KEYS = {
        devModeToken: "dev-mode-token",
        vaultLarkUrl: "vault-lark-url",
        vaultLastSyncedAt: "vault-last-synced-at",
        vaultLarkUrlLocked: "vault-lark-url-locked",
        vaultLastSyncedHash: "vault-last-synced-hash",
      };
    `,
    "@/lib/dev-mode-store": "export function getInMemoryDevToken() { return null; }",
    "@/lib/store": `
      const state = {
        setVaultLarkUrl: () => {},
        setVaultProjects: () => {},
        setVaultIsDirty: () => {},
        setVaultLastSyncedAt: () => {},
      };
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

test("validateLarkUrl accepts a well-formed Lark Suite URL", async () => {
  const { validateLarkUrl } = await loadVaultLarkModule();
  const result = validateLarkUrl({
    url: "https://casinoplus.sg.larksuite.com/docx/R8EwdtG1Io9S5MxTIuVlSIuZgVg",
  });
  assert.equal(result.success, true);
  assert.equal(result.reason, undefined);
});

test("validateLarkUrl rejects an empty URL with an 'empty' reason", async () => {
  const { validateLarkUrl } = await loadVaultLarkModule();
  const result = validateLarkUrl({ url: "   " });
  assert.equal(result.success, false);
  assert.match(result.reason ?? "", /empty/i);
});

test("validateLarkUrl rejects a non-Lark host", async () => {
  const { validateLarkUrl } = await loadVaultLarkModule();
  const result = validateLarkUrl({ url: "https://evil.example.com/docx/abc" });
  assert.equal(result.success, false);
  assert.match(result.reason ?? "", /Lark Suite|Feishu|larksuite\.com|feishu\.cn/i);
});

test("validateLarkUrl rejects URLs containing $() command substitution (Sprint 8 C2)", async () => {
  const { validateLarkUrl } = await loadVaultLarkModule();
  const result = validateLarkUrl({
    url: "https://team.larksuite.com/docx/$(rm -rf ~)",
  });
  assert.equal(result.success, false);
  assert.match(result.reason ?? "", /shell/i);
});

test("validateLarkUrl rejects URLs containing a backtick (Sprint 8 C2)", async () => {
  const { validateLarkUrl } = await loadVaultLarkModule();
  const result = validateLarkUrl({
    url: "https://team.larksuite.com/docx/`whoami`",
  });
  assert.equal(result.success, false);
  assert.match(result.reason ?? "", /shell/i);
});

test("validateLarkUrl rejects URLs containing a newline (Sprint 8 C2)", async () => {
  const { validateLarkUrl } = await loadVaultLarkModule();
  const result = validateLarkUrl({
    url: "https://team.larksuite.com/docx/abc\nrm -rf ~",
  });
  assert.equal(result.success, false);
  assert.match(result.reason ?? "", /shell/i);
});

test("validateLarkUrl rejects URLs containing a double-quote (Sprint 8 C2)", async () => {
  const { validateLarkUrl } = await loadVaultLarkModule();
  const result = validateLarkUrl({
    url: 'https://team.larksuite.com/docx/abc"; rm -rf ~; #',
  });
  assert.equal(result.success, false);
  assert.match(result.reason ?? "", /shell/i);
});

test("validateLarkUrl rejects URLs containing a single-quote (Sprint 8 C2)", async () => {
  const { validateLarkUrl } = await loadVaultLarkModule();
  const result = validateLarkUrl({
    url: "https://team.larksuite.com/docx/abc'whoami'",
  });
  assert.equal(result.success, false);
  assert.match(result.reason ?? "", /shell/i);
});

test("validateLarkUrl rejects URLs containing ;& command chaining (Sprint 8 C2)", async () => {
  const { validateLarkUrl } = await loadVaultLarkModule();
  const result = validateLarkUrl({
    url: "https://team.larksuite.com/docx/abc;&whoami",
  });
  assert.equal(result.success, false);
  assert.match(result.reason ?? "", /shell/i);
});

test("validateLarkUrl rejects URLs containing a pipe character (Sprint 8 C2)", async () => {
  const { validateLarkUrl } = await loadVaultLarkModule();
  const result = validateLarkUrl({
    url: "https://team.larksuite.com/docx/abc|whoami",
  });
  assert.equal(result.success, false);
  assert.match(result.reason ?? "", /shell/i);
});
