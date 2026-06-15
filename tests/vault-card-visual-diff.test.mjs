import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Visual differentiation for credential cards — 18+ Redis cards in one
// list look identical without these two affordances:
//   #1 hash-based color stripe (border-left in a hashed HSL color)
//   #2 URL diff highlighting (dim shared prefix/suffix, bold middle)
// Source-assertion style: lock the helpers + their wiring so a
// refactor that drops either treatment fails loudly.

const PANEL_URL = new URL("../src/components/vault/VaultMainPanel.tsx", import.meta.url);

test("VaultMainPanel exports the three pure helpers backing visual diff", async () => {
  const src = await readFile(PANEL_URL, "utf8");
  assert.match(src, /function hashHue\(input: string\): number/);
  assert.match(src, /function longestCommonPrefix\(strs: readonly string\[\]\): string/);
  assert.match(src, /function longestCommonSuffix\(strs: readonly string\[\]\): string/);
  // Hue mod 360 — the whole point is uniform spread across the color wheel.
  assert.match(src, /Math\.abs\(hash\) % 360/);
});

test("VaultMainPanel computes per-kind sharedByKind memo over project.credentials", async () => {
  const src = await readFile(PANEL_URL, "utf8");
  assert.match(src, /sharedByKind = useMemo<Map<string, ValueDiffShared>>/);
  // Bucketing pulls each cred's value for the active env, then LCP/LCS over it.
  assert.match(src, /buckets\.set\(cred\.kind, arr\)/);
  assert.match(src, /longestCommonPrefix\(values\)/);
  assert.match(src, /longestCommonSuffix\(values\)/);
  // Single-credential kinds get no entry — nothing to compare.
  assert.match(src, /if \(values\.length < 2\) continue/);
  // Threaded to FieldInlineRow via the row props.
  assert.match(src, /shared=\{props\.sharedByKind\.get\(cred\.kind\)\}/);
});

test("CredentialRow paints a hashed HSL stripe via inline borderLeftColor", async () => {
  const src = await readFile(PANEL_URL, "utf8");
  assert.match(src, /const accentHue = hashHue\(primary\.name\)/);
  assert.match(src, /`hsl\(\$\{accentHue\}, 60%, 55%\)`/);
  assert.match(src, /borderLeftColor: accentColor, borderLeftWidth: "6px"/);
});

test("DiffHighlightedValue renders dim-prefix / bold-middle / dim-suffix when shared bookends match", async () => {
  const src = await readFile(PANEL_URL, "utf8");
  assert.match(src, /function DiffHighlightedValue\(props:/);
  // Bails out to plain HighlightedText when shared is undefined or doesn't fit.
  assert.match(src, /if \(!shared\) return <HighlightedText/);
  assert.match(src, /!text\.startsWith\(prefix\) \|\| !text\.endsWith\(suffix\)/);
  // Bright distinctive middle.
  assert.match(src, /className="font-semibold text-foreground"/);
  // Dimmed shared bookends.
  assert.match(src, /className="text-muted-foreground\/50"/);
});
