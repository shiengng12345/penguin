import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const SOURCE_URL = new URL(
  "../src/components/vault/vault-id-slug.ts",
  import.meta.url,
);

test("vault-id-slug source exports slugify and uniqueSlug (DEC #78)", async () => {
  // Tightened: locks the export-with-payload-signature so a bare
  // import + comment-only mention can't satisfy this. The DEC #78
  // marker is intentional — production source at vault-id-slug.ts:1
  // cites the same DEC anchor, so dropping it from the test title
  // would actually lose live-spec traceability.
  const source = await readFile(SOURCE_URL, "utf8");
  assert.match(source, /export function slugify\(payload: SlugifyPayload\)/);
  assert.match(source, /export function uniqueSlug\(payload: UniqueSlugPayload\)/);
  // Confirm the payload types are also exported so call sites can
  // construct the args type-safely.
  assert.match(source, /export interface SlugifyPayload/);
  assert.match(source, /export interface UniqueSlugPayload/);
});

test("vault-id-slug exposes payload-shaped function signatures (coding standard)", async () => {
  // Tightened: bare /SlugifyPayload/ would pass if the type was only
  // imported and never used. Anchor on the function-parameter
  // position so a refactor that drops the payload-shape contract
  // (e.g. switching to positional args) fails the test.
  const source = await readFile(SOURCE_URL, "utf8");
  assert.match(source, /export function slugify\(payload: SlugifyPayload\)/);
  assert.match(source, /export function uniqueSlug\(payload: UniqueSlugPayload\)/);
});
