import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const SOURCE_URL = new URL(
  "../src/components/vault/vault-id-slug.ts",
  import.meta.url,
);

test("vault-id-slug source exports slugify and uniqueSlug (DEC #78)", async () => {
  const source = await readFile(SOURCE_URL, "utf8");
  assert.match(source, /export function slugify\(/);
  assert.match(source, /export function uniqueSlug\(/);
});

test("vault-id-slug exposes payload-shaped function signatures (coding standard)", async () => {
  const source = await readFile(SOURCE_URL, "utf8");
  assert.match(source, /SlugifyPayload/);
  assert.match(source, /UniqueSlugPayload/);
});
