import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const SOURCE_URL = new URL("../src/components/vault/vault-crypto.ts", import.meta.url);

if (globalThis.crypto === undefined) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

async function loadVaultCryptoModule() {
  const source = await readFile(SOURCE_URL, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}#${Math.random()}`);
}

function sampleVaultJson() {
  return JSON.stringify([
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
  ]);
}

const ADMIN_TOKEN = "41361213-996d-41ae-a8cc-0a19087fd36c";
const SUPER_ADMIN_TOKEN = "463ad864-0209-49fe-b47f-2ca05b9e42c6-af5q";

test("vault crypto envelope decrypts the same payload with admin and super-admin tokens", async () => {
  const { decryptVaultJson, encryptVaultJson, isVaultEncryptedEnvelope } =
    await loadVaultCryptoModule();
  const plaintext = sampleVaultJson();

  const envelope = await encryptVaultJson({
    plaintext,
    adminToken: ADMIN_TOKEN,
    superAdminToken: SUPER_ADMIN_TOKEN,
  });

  assert.equal(isVaultEncryptedEnvelope(envelope), true);
  assert.equal(envelope.schema, "penguin-vault-encrypted-v1");
  assert.deepEqual(
    envelope.recipients.map((recipient) => recipient.id).sort(),
    ["admin", "super-admin"],
  );

  const serializedEnvelope = JSON.stringify(envelope);
  assert.doesNotMatch(serializedEnvelope, /secret-password-value/);
  assert.doesNotMatch(serializedEnvelope, /Brazil Prod/);

  const adminResult = await decryptVaultJson({
    envelope,
    tokens: { adminToken: ADMIN_TOKEN },
  });
  assert.equal(adminResult.success, true);
  assert.equal(adminResult.recipientId, "admin");
  assert.equal(adminResult.plaintext, plaintext);

  const superAdminResult = await decryptVaultJson({
    envelope,
    tokens: { superAdminToken: SUPER_ADMIN_TOKEN },
  });
  assert.equal(superAdminResult.success, true);
  assert.equal(superAdminResult.recipientId, "super-admin");
  assert.equal(superAdminResult.plaintext, plaintext);
});

test("vault crypto refuses upload encryption unless both recipient tokens are present", async () => {
  const { encryptVaultJson } = await loadVaultCryptoModule();
  await assert.rejects(
    () =>
      encryptVaultJson({
        plaintext: sampleVaultJson(),
        adminToken: ADMIN_TOKEN,
        superAdminToken: "",
      }),
    /both vault encryption tokens/i,
  );
});

test("vault crypto re-encrypts an existing dual-recipient envelope with only the current token", async () => {
  const { decryptVaultJson, encryptVaultJson, reencryptVaultJson } =
    await loadVaultCryptoModule();
  const updatedPlaintext = JSON.stringify([
    {
      id: "project-1",
      name: "Brazil Prod Updated",
      environments: [{ id: "prod", name: "PROD", color: "bg-red-500" }],
      credentials: [
        {
          id: "credential-1",
          kind: "login",
          name: "Admin Password",
          valueByEnv: { prod: "updated-secret-value" },
          isSensitive: true,
        },
      ],
      kinds: [{ id: "login", label: "Login", baseKind: "login" }],
    },
  ]);
  const originalEnvelope = await encryptVaultJson({
    plaintext: sampleVaultJson(),
    adminToken: ADMIN_TOKEN,
    superAdminToken: SUPER_ADMIN_TOKEN,
  });

  const reencrypted = await reencryptVaultJson({
    envelope: originalEnvelope,
    plaintext: updatedPlaintext,
    tokens: { adminToken: ADMIN_TOKEN },
  });

  assert.equal(reencrypted.success, true);
  assert.deepEqual(reencrypted.envelope.recipients, originalEnvelope.recipients);
  assert.notEqual(reencrypted.envelope.ciphertext, originalEnvelope.ciphertext);

  const superAdminResult = await decryptVaultJson({
    envelope: reencrypted.envelope,
    tokens: { superAdminToken: SUPER_ADMIN_TOKEN },
  });
  assert.equal(superAdminResult.success, true);
  assert.equal(superAdminResult.plaintext, updatedPlaintext);
});

test("vault crypto reports failure instead of plaintext when no recipient key matches", async () => {
  const { decryptVaultJson, encryptVaultJson } = await loadVaultCryptoModule();
  const envelope = await encryptVaultJson({
    plaintext: sampleVaultJson(),
    adminToken: ADMIN_TOKEN,
    superAdminToken: SUPER_ADMIN_TOKEN,
  });

  const result = await decryptVaultJson({
    envelope,
    tokens: { adminToken: "wrong-admin-token" },
  });

  assert.equal(result.success, false);
  assert.match(result.reason ?? "", /decrypt/i);
  assert.equal(result.plaintext, undefined);
});
