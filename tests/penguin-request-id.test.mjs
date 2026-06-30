import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

// crypto.getRandomValues isn't a global inside data: URL module realms on
// Node 18 — polyfill so the generator's RNG works under the test transpile.
if (globalThis.crypto === undefined) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

async function loadModule() {
  const src = await readFile(
    new URL("../src/lib/penguin-request-id.ts", import.meta.url),
    "utf8",
  );
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}#${Math.random()}`);
}

// Matches `penguin-` + a canonical UUIDv7: the 13th hex digit must be `7`
// (version) and the 17th must be 8/9/a/b (variant). Anything else means the
// id isn't a real v7.
const PENGUIN_UUIDV7 =
  /^penguin-[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("generatePenguinRequestId returns penguin-<uuidv7>", async () => {
  const { generatePenguinRequestId } = await loadModule();
  const result = generatePenguinRequestId();
  assert.match(result.value, PENGUIN_UUIDV7);
});

test("each generated id is unique", async () => {
  const { generatePenguinRequestId } = await loadModule();
  const first = generatePenguinRequestId().value;
  const second = generatePenguinRequestId().value;
  assert.notEqual(first, second);
});

test("uuidv7 ids are time-ordered — a later id sorts after an earlier one", async () => {
  const { generatePenguinRequestId } = await loadModule();
  // The 48-bit timestamp prefix makes v7 lexicographically sortable by
  // creation time once the millisecond ticks over.
  const early = generatePenguinRequestId().value;
  const start = Date.now();
  while (Date.now() === start) {
    /* spin one millisecond so the timestamp prefix advances */
  }
  const late = generatePenguinRequestId().value;
  assert.ok(late > early, `expected ${late} > ${early}`);
});

test("PENGUIN_REQUEST_ID_HEADER is x-penguin-id", async () => {
  const { PENGUIN_REQUEST_ID_HEADER } = await loadModule();
  assert.equal(PENGUIN_REQUEST_ID_HEADER, "x-penguin-id");
});
