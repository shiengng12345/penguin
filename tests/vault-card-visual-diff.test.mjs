import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Visual differentiation for credential cards — 18+ Redis cards in one
// list look identical without a per-card accent. We keep the hash-based
// color stripe (border-left in a hashed HSL color). The old URL diff
// highlighting (dim shared prefix/suffix, bold middle) was removed by
// user request — credential values now render in one uniform color.
// Source-assertion style: lock the stripe helper + its wiring so a
// refactor that drops it fails loudly.

const PANEL_URL = new URL("../src/components/vault/VaultMainPanel.tsx", import.meta.url);

test("VaultMainPanel exports the hashHue helper backing the card stripe", async () => {
  const src = await readFile(PANEL_URL, "utf8");
  assert.match(src, /function hashHue\(input: string\): number/);
  // Hue mod 360 — the whole point is uniform spread across the color wheel.
  assert.match(src, /Math\.abs\(hash\) % 360/);
});

test("CredentialRow paints a hashed HSL stripe via inline borderLeftColor", async () => {
  const src = await readFile(PANEL_URL, "utf8");
  assert.match(src, /const accentHue = hashHue\(primary\.name\)/);
  assert.match(src, /`hsl\(\$\{accentHue\}, 60%, 55%\)`/);
  assert.match(src, /borderLeftColor: accentColor, borderLeftWidth: "6px"/);
});

test("VaultMainPanel renders credential values in one uniform color (no prefix/suffix dimming)", async () => {
  const src = await readFile(PANEL_URL, "utf8");
  // The diff-segmentation renderer and its machinery are gone.
  assert.doesNotMatch(src, /DiffHighlightedValue/);
  assert.doesNotMatch(src, /longestCommonPrefix/);
  assert.doesNotMatch(src, /sharedByKind/);
  // Values render through the plain search-highlighter.
  assert.match(src, /<HighlightedText query=\{props\.searchQuery\} text=\{props\.displayValue\} \/>/);
});
