import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const SOURCE_URL = new URL(
  "../src/components/vault/vault-diff.ts",
  import.meta.url,
);

test("vault-diff source exports computeVaultDiff (DEC #95)", async () => {
  const source = await readFile(SOURCE_URL, "utf8");
  assert.match(source, /export function computeVaultDiff\(/);
});

test("vault-diff exports the VaultDiffResult shape (added/modified/deleted)", async () => {
  const source = await readFile(SOURCE_URL, "utf8");
  assert.match(source, /VaultDiffResult/);
  assert.match(source, /added:\s*VaultCredential\[\]/);
  assert.match(source, /modified:\s*VaultCredential\[\]/);
  assert.match(source, /deleted:\s*VaultCredential\[\]/);
});

test("vault-diff Sprint 4 — walks project.credentials directly (no categories)", async () => {
  const source = await readFile(SOURCE_URL, "utf8");
  assert.match(source, /for \(const credential of project\.credentials\)/);
});
