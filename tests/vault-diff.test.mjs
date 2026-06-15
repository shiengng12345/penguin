import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const SOURCE_URL = new URL(
  "../src/components/vault/vault-diff.ts",
  import.meta.url,
);

test("vault-diff source exports computeVaultDiff with payload-shaped signature", async () => {
  // Tightened: bare /export function computeVaultDiff\(/ would pass
  // even if the signature broke its payload-shape contract. Lock the
  // payload param type so a refactor that goes back to positional
  // args breaks this test.
  const source = await readFile(SOURCE_URL, "utf8");
  assert.match(source, /export function computeVaultDiff\([\w]+: ComputeVaultDiffPayload\)/);
  assert.match(source, /export interface ComputeVaultDiffPayload/);
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
