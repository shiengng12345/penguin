import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Bug #1b: pushToLark returns { reason: "conflict", remoteJson, remoteHash } so
// the UI can offer a force-overwrite, but handlePushClick used to discard those
// and dead-end on a "Push failed — conflict" toast. The push handler must now
// route a conflict into the confirm modal and, on confirm, re-push with the
// remote hash as the expected baseline (which makes the conflict check pass).
//
// VaultPage is a large React component with no runtime test harness in this
// repo; the established convention (see vault-lark-encrypted-flow test #5) is to
// assert the wiring at the source level.

async function readVaultPageSource() {
  return readFile(
    new URL("../src/components/vault/VaultPage.tsx", import.meta.url),
    "utf8",
  );
}

test("push handler branches on a conflict result instead of only toasting", async () => {
  const src = await readVaultPageSource();
  assert.match(src, /reason === "conflict"/, "should detect the conflict discriminant");
});

test("conflict opens an Overwrite confirm dialog", async () => {
  const src = await readVaultPageSource();
  assert.match(src, /confirmLabel:\s*"Overwrite"/, "conflict should surface an Overwrite confirm action");
});

test("overwrite re-pushes with the remote hash as the expected baseline", async () => {
  const src = await readVaultPageSource();
  // Re-pushing with expectedHash = the remote hash forces pushToLark's conflict
  // check (expectedHash !== remoteHash) to pass on the retry.
  assert.match(src, /expectedHash:\s*conflict\.remoteHash/, "overwrite must re-push with conflict.remoteHash");
});
