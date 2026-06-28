import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

if (globalThis.crypto === undefined) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

const ADMIN_TOKEN = "41361213-996d-41ae-a8cc-0a19087fd36c";
const SUPER_ADMIN_TOKEN = "463ad864-0209-49fe-b47f-2ca05b9e42c6-af5q";

async function moduleDataUrl(relPath, patches = {}) {
  let source = await readFile(new URL(relPath, import.meta.url), "utf8");
  for (const [specifier, replacement] of Object.entries(patches)) {
    source = source.replaceAll(`"${specifier}"`, JSON.stringify(replacement));
  }
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}#${Math.random()}`;
}

async function loadVaultCryptoModule() {
  return import(await moduleDataUrl("../src/components/vault/vault-crypto.ts"));
}

async function loadVaultPushModule() {
  const cryptoUrl = await moduleDataUrl("../src/components/vault/vault-crypto.ts");
  const mocks = {
    "@/lib/logger": dataUrl("export const logger = { info: () => {}, warn: () => {}, error: () => {} };"),
    "@/lib/app-persistence": dataUrl(`
      export function getPersistedValue(key) {
        return globalThis.__vaultPushHarness?.persisted?.[key] ?? null;
      }
      export function setPersistedValue(key, value) {
        if (globalThis.__vaultPushHarness) {
          globalThis.__vaultPushHarness.persisted[key] = value;
        }
      }
      export function deletePersistedValue(key) {
        if (globalThis.__vaultPushHarness) {
          delete globalThis.__vaultPushHarness.persisted[key];
        }
      }
    `),
    "@/lib/persistence-keys": dataUrl(`
      export const APP_VALUE_KEYS = {
        devModeToken: "dev-mode-token",
        devModeAdminToken: "dev-mode-admin-token",
        devModeSuperAdminToken: "dev-mode-super-admin-token",
        vaultLastSyncedHash: "vault-last-synced-hash",
        vaultLastSyncedContentHash: "vault-last-synced-content-hash",
        vaultLarkUrlLocked: "vault-lark-url-locked",
      };
    `),
    "@/lib/dev-mode-store": dataUrl(`
      export function requireSuperAdmin() { return true; }
      export function getInMemoryDevToken() {
        return globalThis.__vaultPushHarness?.devToken ?? null;
      }
      export async function getStoredDeveloperModeTokens() {
        const persisted = globalThis.__vaultPushHarness?.persisted ?? {};
        return {
          adminToken: persisted["dev-mode-admin-token"] ?? null,
          superAdminToken: persisted["dev-mode-super-admin-token"] ?? null,
        };
      }
    `),
    "./vault-lark": dataUrl(`
      export function extractJsonFromMarkdown(payload) {
        const match = /\\\`\\\`\\\`json\\s*([\\s\\S]*?)\\\`\\\`\\\`/i.exec(payload.markdown);
        if (match === null) return { success: false, reason: "no json" };
        return { success: true, json: match[1].trim() };
      }
      export async function extractVaultJsonFromMarkdown() { return { success: true, json: "[]" }; }
      export async function runLarkFetch() {
        return { success: true, markdown: globalThis.__vaultPushHarness?.remoteMarkdown ?? "" };
      }
      export async function runLarkUpdate(payload) {
        if (globalThis.__vaultPushHarness) globalThis.__vaultPushHarness.updatedMarkdown = payload.markdown;
        return { success: true };
      }
      export function validateLarkUrl() { return { success: true }; }
    `),
    "./vault-crypto": cryptoUrl,
  };
  return import(await moduleDataUrl("../src/components/vault/vault-push.ts", mocks));
}

async function loadVaultLarkModule() {
  const cryptoUrl = await moduleDataUrl("../src/components/vault/vault-crypto.ts");
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
        devModeAdminToken: "dev-mode-admin-token",
        devModeSuperAdminToken: "dev-mode-super-admin-token",
        vaultLarkUrl: "vault-lark-url",
        vaultLastSyncedAt: "vault-last-synced-at",
        vaultLarkUrlLocked: "vault-lark-url-locked",
        vaultLastSyncedHash: "vault-last-synced-hash",
        vaultLastSyncedContentHash: "vault-last-synced-content-hash",
      };
    `),
    "@/lib/dev-mode-store": dataUrl(`
      export function getInMemoryDevToken() {
        return globalThis.__vaultLarkHarness?.devToken ?? null;
      }
    `),
    "@/lib/store": dataUrl(`
      const state = {
        setVaultLarkUrl: () => {},
        setVaultProjects: () => {},
        setVaultIsDirty: () => {},
        setVaultLastSyncedAt: () => {},
      };
      export const useAppStore = { getState: () => state };
    `),
    "@/lib/sidecar": dataUrl('export const NODE_PATH_SETUP = "";'),
    "./vault-storage": dataUrl(`
      export function parseVaultJson() { return { success: true, projects: [] }; }
      export function persistVaultToDisk() { return { success: true }; }
    `),
    "./vault-crypto": cryptoUrl,
    "@tauri-apps/plugin-shell": dataUrl(`
      export const Command = { create: () => ({ execute: async () => ({ code: 0, stdout: "", stderr: "" }) }) };
    `),
  };
  return import(await moduleDataUrl("../src/components/vault/vault-lark.ts", mocks));
}

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

function sampleProjects() {
  return [
    {
      id: "project-1",
      name: "Brazil Prod",
      environments: [{ id: "prod", name: "PROD", color: "bg-red-500" }],
      credentials: [
        {
          id: "credential-1",
          kind: "login",
          name: "Admin Password",
          valueByEnv: { prod: "secret-password-value" },
          isSensitive: true,
        },
      ],
      kinds: [{ id: "login", label: "Login", baseKind: "login" }],
    },
  ];
}

function extractJsonFence(markdown) {
  const match = /```json\s*([\s\S]*?)```/i.exec(markdown);
  assert.notEqual(match, null);
  return match[1].trim();
}

test("serializeEncryptedVaultMarkdown stores only an envelope while both keys decrypt to the original projects", async () => {
  const { decryptVaultJson } = await loadVaultCryptoModule();
  const { serializeEncryptedVaultMarkdown } = await loadVaultPushModule();
  const projects = sampleProjects();

  const markdown = await serializeEncryptedVaultMarkdown({
    projects,
    tokens: { adminToken: ADMIN_TOKEN, superAdminToken: SUPER_ADMIN_TOKEN },
  });

  assert.match(markdown, /penguin-vault-encrypted-v1/);
  assert.doesNotMatch(markdown, /Brazil Prod/);
  assert.doesNotMatch(markdown, /secret-password-value/);

  const envelope = JSON.parse(extractJsonFence(markdown));
  const adminResult = await decryptVaultJson({
    envelope,
    tokens: { adminToken: ADMIN_TOKEN },
  });
  const superAdminResult = await decryptVaultJson({
    envelope,
    tokens: { superAdminToken: SUPER_ADMIN_TOKEN },
  });

  assert.equal(adminResult.success, true);
  assert.deepEqual(JSON.parse(adminResult.plaintext), projects);
  assert.equal(superAdminResult.success, true);
  assert.deepEqual(JSON.parse(superAdminResult.plaintext), projects);
});

test("extractVaultJsonFromMarkdown decrypts encrypted docs and keeps legacy plaintext docs readable", async () => {
  const { serializeEncryptedVaultMarkdown } = await loadVaultPushModule();
  const { extractVaultJsonFromMarkdown } = await loadVaultLarkModule();
  const projects = sampleProjects();
  const plaintext = JSON.stringify(projects);
  const encryptedMarkdown = await serializeEncryptedVaultMarkdown({
    projects,
    tokens: { adminToken: ADMIN_TOKEN, superAdminToken: SUPER_ADMIN_TOKEN },
  });

  const encryptedResult = await extractVaultJsonFromMarkdown({
    markdown: encryptedMarkdown,
    tokens: { superAdminToken: SUPER_ADMIN_TOKEN },
  });
  assert.equal(encryptedResult.success, true);
  assert.deepEqual(JSON.parse(encryptedResult.json), projects);

  const legacyResult = await extractVaultJsonFromMarkdown({
    markdown: `# Old Vault\n\n\`\`\`json\n${plaintext}\n\`\`\`\n`,
  });
  assert.equal(legacyResult.success, true);
  assert.equal(legacyResult.json, plaintext);
});

test("pushToLark re-encrypts an existing envelope with the stored developer token and preserves both recipients", async () => {
  const { decryptVaultJson } = await loadVaultCryptoModule();
  const { serializeEncryptedVaultMarkdown } = await loadVaultPushModule();
  const originalProjects = sampleProjects();
  const originalMarkdown = await serializeEncryptedVaultMarkdown({
    projects: originalProjects,
    tokens: { adminToken: ADMIN_TOKEN, superAdminToken: SUPER_ADMIN_TOKEN },
  });
  const originalEnvelope = JSON.parse(extractJsonFence(originalMarkdown));
  globalThis.__vaultPushHarness = {
    remoteMarkdown: originalMarkdown,
    updatedMarkdown: "",
    devToken: ADMIN_TOKEN,
    persisted: {},
  };
  const { pushToLark } = await loadVaultPushModule();
  const updatedProjects = [
    {
      ...originalProjects[0],
      name: "Brazil Prod Updated",
      credentials: [
        {
          ...originalProjects[0].credentials[0],
          valueByEnv: { prod: "updated-secret-value" },
        },
      ],
    },
  ];

  const result = await pushToLark({
    url: "https://team.larksuite.com/docx/abc",
    projects: updatedProjects,
    expectedHash: null,
  });

  assert.equal(result.success, true);
  assert.match(globalThis.__vaultPushHarness.updatedMarkdown, /penguin-vault-encrypted-v1/);
  assert.doesNotMatch(globalThis.__vaultPushHarness.updatedMarkdown, /updated-secret-value/);
  const updatedEnvelope = JSON.parse(extractJsonFence(globalThis.__vaultPushHarness.updatedMarkdown));
  assert.deepEqual(updatedEnvelope.recipients, originalEnvelope.recipients);

  const superAdminResult = await decryptVaultJson({
    envelope: updatedEnvelope,
    tokens: { superAdminToken: SUPER_ADMIN_TOKEN },
  });
  assert.equal(superAdminResult.success, true);
  assert.deepEqual(JSON.parse(superAdminResult.plaintext), updatedProjects);
});

test("pushToLark encrypts a legacy plaintext remote doc when both tier tokens are cached", async () => {
  const { decryptVaultJson } = await loadVaultCryptoModule();
  const plaintextProjects = sampleProjects();
  globalThis.__vaultPushHarness = {
    remoteMarkdown: `# Legacy Vault\n\n\`\`\`json\n${JSON.stringify(plaintextProjects)}\n\`\`\`\n`,
    updatedMarkdown: "",
    devToken: SUPER_ADMIN_TOKEN,
    persisted: {
      "dev-mode-admin-token": ADMIN_TOKEN,
      "dev-mode-super-admin-token": SUPER_ADMIN_TOKEN,
    },
  };
  const { pushToLark } = await loadVaultPushModule();

  const result = await pushToLark({
    url: "https://team.larksuite.com/docx/abc",
    projects: plaintextProjects,
    expectedHash: null,
  });

  assert.equal(result.success, true);
  assert.match(globalThis.__vaultPushHarness.updatedMarkdown, /penguin-vault-encrypted-v1/);
  assert.doesNotMatch(globalThis.__vaultPushHarness.updatedMarkdown, /secret-password-value/);
  const envelope = JSON.parse(extractJsonFence(globalThis.__vaultPushHarness.updatedMarkdown));
  const adminResult = await decryptVaultJson({
    envelope,
    tokens: { adminToken: ADMIN_TOKEN },
  });
  const superAdminResult = await decryptVaultJson({
    envelope,
    tokens: { superAdminToken: SUPER_ADMIN_TOKEN },
  });
  assert.equal(adminResult.success, true);
  assert.deepEqual(JSON.parse(adminResult.plaintext), plaintextProjects);
  assert.equal(superAdminResult.success, true);
  assert.deepEqual(JSON.parse(superAdminResult.plaintext), plaintextProjects);
});

test("VaultPage push passes the last synced markdown hash into conflict detection", async () => {
  const src = await readFile(new URL("../src/components/vault/VaultPage.tsx", import.meta.url), "utf8");
  assert.match(src, /const expectedHash\s*=\s*getPersistedValue\(APP_VALUE_KEYS\.vaultLastSyncedHash\)/);
  assert.match(src, /expectedHash,\s*\n\s*\}\)/);
  assert.doesNotMatch(src, /expectedHash:\s*null/);
});
