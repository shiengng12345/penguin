// Slug + collision helpers for Vault id generation (DEC #78).
// IDs are deterministically derived from the user-typed name so the
// pushed-to-Lark markdown stays stable across CRUD cycles.

const NON_ALPHANUM_GLOBAL = /[^a-z0-9]+/g;
const LEADING_TRAILING_DASH = /^-+|-+$/g;
const FALLBACK_SLUG = "item";

export interface SlugifyPayload {
  name: string;
}

// Lowercase + ASCII-only + hyphen-joined slug. Empty / all-symbol inputs fall
// back to a constant so we never emit an empty id; collision handling makes
// the constant safe.
export function slugify(payload: SlugifyPayload): string {
  const lowered = payload.name.toLowerCase();
  const ascii = lowered.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const collapsed = ascii.replace(NON_ALPHANUM_GLOBAL, "-");
  const trimmed = collapsed.replace(LEADING_TRAILING_DASH, "");
  const isEmpty = trimmed.length === 0;
  // Slug ended up empty after normalization — fall back to a stable seed.
  if (isEmpty) return FALLBACK_SLUG;
  return trimmed;
}

export interface UniqueSlugPayload {
  base: string;
  existingIds: readonly string[];
}

// Append `-2`, `-3`, ... until we find a slug that doesn't collide with the
// existing-id set. The set is scoped by the caller (category, project, etc).
export function uniqueSlug(payload: UniqueSlugPayload): string {
  const taken = new Set(payload.existingIds);
  const isBaseFree = !taken.has(payload.base);
  // Base slug is unused — return it untouched so the common path stays clean.
  if (isBaseFree) return payload.base;
  let suffix = 2;
  while (suffix < 10000) {
    const candidate = `${payload.base}-${suffix}`;
    const isFree = !taken.has(candidate);
    // Found an unused suffix — return it.
    if (isFree) return candidate;
    suffix += 1;
  }
  // Practical upper bound — if a user has 10k collisions we have bigger issues.
  return `${payload.base}-${Date.now()}`;
}
