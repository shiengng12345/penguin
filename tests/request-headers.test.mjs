import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

// header-utils.ts is dependency-free, so we can transpile + import it directly
// without mocking anything.
async function loadHeaderUtils() {
  const source = await readFile(
    new URL("../src/lib/header-utils.ts", import.meta.url),
    "utf8",
  );
  const js = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const dataUrl =
    "data:text/javascript;base64," + Buffer.from(js).toString("base64");
  return import(dataUrl);
}

test("isEmptyAuthHeader — blank Authorization is dropped", async () => {
  const { isEmptyAuthHeader } = await loadHeaderUtils();
  assert.equal(isEmptyAuthHeader("Authorization", ""), true);
  assert.equal(isEmptyAuthHeader("Authorization", "   "), true);
  assert.equal(isEmptyAuthHeader("Authorization", "Bearer"), true);
  assert.equal(isEmptyAuthHeader("Authorization", "Bearer "), true);
  assert.equal(isEmptyAuthHeader("Authorization", "  Bearer  "), true);
  assert.equal(isEmptyAuthHeader("Authorization", "Basic "), true);
});

test("isEmptyAuthHeader — case-insensitive key + scheme", async () => {
  const { isEmptyAuthHeader } = await loadHeaderUtils();
  assert.equal(isEmptyAuthHeader("authorization", "bearer"), true);
  assert.equal(isEmptyAuthHeader("  AUTHORIZATION  ", "Bearer "), true);
});

test("isEmptyAuthHeader — Authorization with a real credential is kept", async () => {
  const { isEmptyAuthHeader } = await loadHeaderUtils();
  assert.equal(isEmptyAuthHeader("Authorization", "Bearer abc.def.ghi"), false);
  assert.equal(isEmptyAuthHeader("Authorization", "Basic dXNlcjpwYXNz"), false);
});

test("isEmptyAuthHeader — non-Authorization headers are never touched", async () => {
  const { isEmptyAuthHeader } = await loadHeaderUtils();
  // Empty eId / x-env-tag / platform-id keep their existing send behaviour.
  assert.equal(isEmptyAuthHeader("eId", ""), false);
  assert.equal(isEmptyAuthHeader("x-env-tag", ""), false);
  assert.equal(isEmptyAuthHeader("platform-id", ""), false);
  assert.equal(isEmptyAuthHeader("X-Api-Key", "Bearer"), false);
});
