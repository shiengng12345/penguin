import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

// response-search.ts is pure (no imports) — transpile + import directly, no
// mocks needed. We exercise the real computeResponseMatches, not a regex over
// source, so a logic regression (wrong offsets, case sensitivity, missed
// occurrences, bad global indices) fails loudly.
async function loadSearch() {
  const source = await readFile(
    new URL("../src/lib/response-search.ts", import.meta.url),
    "utf8",
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
  return import(url);
}

const { computeResponseMatches } = await loadSearch();

test("empty query yields no matches", () => {
  const { flat, perLine } = computeResponseMatches(["hello world"], "");
  assert.equal(flat.length, 0);
  assert.equal(perLine.size, 0);
});

test("no occurrences yields no matches", () => {
  const { flat } = computeResponseMatches(['{ "a": 1 }', '{ "b": 2 }'], "zzz");
  assert.equal(flat.length, 0);
});

test("finds a single match and records its line + offsets", () => {
  const { flat, perLine } = computeResponseMatches(["  \"status\": 1470,"], "1470");
  assert.equal(flat.length, 1);
  assert.deepEqual(flat[0], { line: 0 });
  const ranges = perLine.get(0);
  assert.equal(ranges.length, 1);
  const text = "  \"status\": 1470,";
  assert.equal(text.slice(ranges[0].start, ranges[0].end), "1470");
  assert.equal(ranges[0].globalIndex, 0);
});

test("matching is case-insensitive", () => {
  const { flat, perLine } = computeResponseMatches(["FunctionName: LookupNationalId"], "lookupnationalid");
  assert.equal(flat.length, 1);
  const r = perLine.get(0)[0];
  // Offsets index into the original (cased) text.
  assert.equal("FunctionName: LookupNationalId".slice(r.start, r.end), "LookupNationalId");
});

test("multiple occurrences on one line each get a sequential global index", () => {
  const { flat, perLine } = computeResponseMatches(["aXaXa"], "a");
  assert.equal(flat.length, 3);
  const ranges = perLine.get(0);
  assert.deepEqual(ranges.map((r) => r.start), [0, 2, 4]);
  assert.deepEqual(ranges.map((r) => r.globalIndex), [0, 1, 2]);
});

test("matches span lines in document order with continuous global indices", () => {
  const lines = ["id: RQ1", "other", "requestId: RQ1", "nested RQ1 RQ1"];
  const { flat, perLine } = computeResponseMatches(lines, "RQ1");
  // 1 + 0 + 1 + 2 = 4 matches, lines 0,2,3,3.
  assert.equal(flat.length, 4);
  assert.deepEqual(flat.map((f) => f.line), [0, 2, 3, 3]);
  // perLine only has entries for lines that matched.
  assert.deepEqual([...perLine.keys()].sort((a, b) => a - b), [0, 2, 3]);
  assert.equal(perLine.get(3).length, 2);
  // Global indices are unique, contiguous 0..3, ascending.
  assert.deepEqual(flat.map((_, i) => i), [0, 1, 2, 3]);
});

test("scan resumes after each match (no overlapping matches for repeated patterns)", () => {
  // "aa" in "aaaa" → positions 0 and 2, not 0,1,2 (non-overlapping).
  const { flat, perLine } = computeResponseMatches(["aaaa"], "aa");
  assert.equal(flat.length, 2);
  assert.deepEqual(perLine.get(0).map((r) => r.start), [0, 2]);
});
