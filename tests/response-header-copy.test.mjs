import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Click-to-copy on response header rows (mirrors the Vault floating-toast copy
// UX). No runtime React harness in this repo, so the wiring is asserted at the
// source level: clicking a row copies its value and pops a "Copied" toast at
// the click position, leaving the row value visible.

async function readResponsePanel() {
  return readFile(
    new URL("../src/components/request/ResponsePanel.tsx", import.meta.url),
    "utf8",
  );
}

test("response header rows are clickable and copy their value at the click position", async () => {
  const src = await readResponsePanel();
  assert.match(src, /onClick=\{\(e\) => handleCopyHeader\(\{ value, x: e\.clientX, y: e\.clientY \}\)\}/);
  assert.match(src, /void writeClipboard\(payload\.value\)/);
});

test("a copy pops a floating 'Copied' toast, not an inline label", async () => {
  const src = await readResponsePanel();
  assert.match(src, /setCopyToast\(\{ x: payload\.x, y: payload\.y, nonce: Date\.now\(\) \}\)/);
  assert.match(src, /\{copyToast !== null \? \(/);
  assert.match(src, /✓ Copied/);
  // The row value must stay visible — no inline "Copied" replacing the value.
  assert.doesNotMatch(src, /isCopied \? "✓ Copied" : value/);
});
