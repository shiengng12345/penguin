// Sprint 4 search — auto-detects wildcard syntax (`*` / `?`). When detected,
// runs glob-style anchored regex matching; otherwise falls back to a
// char-subsequence fuzzy match against the credential's name + current-env
// value. All comparisons case-insensitive.

import type { VaultCredential } from "./types";

const WILDCARD_REGEX = /[*?]/;

// Highlight payload: returns the input segmented into matched/unmatched
// chunks so the renderer can wrap matched chunks in <mark>. Falls back to a
// single unmatched chunk when the query is empty or no match exists.
export interface HighlightSegment {
  text: string;
  match: boolean;
}

export function highlightSegments(payload: { query: string; text: string }): HighlightSegment[] {
  const trimmed = payload.query.trim();
  const noQuery = trimmed.length === 0;
  if (noQuery) return [{ text: payload.text, match: false }];
  const isWildcard = WILDCARD_REGEX.test(trimmed.toLowerCase());
  if (isWildcard) return wildcardSegments({ pattern: trimmed.toLowerCase(), text: payload.text });
  return fuzzySegments({ pattern: trimmed.toLowerCase(), text: payload.text });
}

function fuzzySegments(payload: { pattern: string; text: string }): HighlightSegment[] {
  const lower = payload.text.toLowerCase();
  const matchIndices: number[] = [];
  let needleIdx = 0;
  for (let i = 0; i < lower.length && needleIdx < payload.pattern.length; i += 1) {
    const matches = lower[i] === payload.pattern[needleIdx];
    if (matches) {
      matchIndices.push(i);
      needleIdx += 1;
    }
  }
  const isFullMatch = needleIdx === payload.pattern.length;
  if (!isFullMatch) return [{ text: payload.text, match: false }];
  return splitByIndices({ text: payload.text, indices: matchIndices });
}

function wildcardSegments(payload: { pattern: string; text: string }): HighlightSegment[] {
  const escaped = payload.pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexBody = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  try {
    const compiled = new RegExp(`(${regexBody})`, "i");
    const match = compiled.exec(payload.text);
    const noMatch = match === null || match[0].length === 0;
    if (noMatch) return [{ text: payload.text, match: false }];
    const before = payload.text.slice(0, match.index);
    const hit = payload.text.slice(match.index, match.index + match[0].length);
    const after = payload.text.slice(match.index + match[0].length);
    const out: HighlightSegment[] = [];
    if (before.length > 0) out.push({ text: before, match: false });
    out.push({ text: hit, match: true });
    if (after.length > 0) out.push({ text: after, match: false });
    return out;
  } catch {
    return [{ text: payload.text, match: false }];
  }
}

function splitByIndices(payload: { text: string; indices: number[] }): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const idx of payload.indices) {
    const gap = payload.text.slice(cursor, idx);
    if (gap.length > 0) segments.push({ text: gap, match: false });
    segments.push({ text: payload.text[idx], match: true });
    cursor = idx + 1;
  }
  const tail = payload.text.slice(cursor);
  if (tail.length > 0) segments.push({ text: tail, match: false });
  // Coalesce consecutive same-match segments so <mark> wraps contiguous runs.
  return coalesceSegments(segments);
}

function coalesceSegments(segments: HighlightSegment[]): HighlightSegment[] {
  const out: HighlightSegment[] = [];
  for (const seg of segments) {
    const tail = out[out.length - 1];
    const canCoalesce = tail !== undefined && tail.match === seg.match;
    if (canCoalesce) {
      tail.text += seg.text;
      continue;
    }
    out.push({ ...seg });
  }
  return out;
}

export interface MatchesSearchPayload {
  query: string;
  credential: VaultCredential;
  envValue: string;
}

export function matchesSearch(payload: MatchesSearchPayload): boolean {
  const haystack = `${payload.credential.name}\n${payload.envValue}`.toLowerCase();
  const needle = payload.query.toLowerCase();
  const isWildcard = WILDCARD_REGEX.test(needle);
  if (isWildcard) return matchesWildcard({ pattern: needle, haystack });
  return matchesFuzzy({ pattern: needle, haystack });
}

// Char-subsequence fuzzy match — every needle char appears in haystack in
// order (skipping arbitrary chars between matches). Cheap, no scoring.
interface MatchesFuzzyPayload {
  pattern: string;
  haystack: string;
}
function matchesFuzzy(payload: MatchesFuzzyPayload): boolean {
  let needleIdx = 0;
  for (let i = 0; i < payload.haystack.length; i += 1) {
    const allMatched = needleIdx >= payload.pattern.length;
    if (allMatched) return true;
    const match = payload.haystack[i] === payload.pattern[needleIdx];
    if (match) needleIdx += 1;
  }
  return needleIdx >= payload.pattern.length;
}

// Glob-style match: `*` = any sequence (zero or more), `?` = exactly one char.
// Pattern is escaped except for the two wildcards, then compiled as an
// unanchored RegExp so "vault*token" finds the substring anywhere.
interface MatchesWildcardPayload {
  pattern: string;
  haystack: string;
}
function matchesWildcard(payload: MatchesWildcardPayload): boolean {
  const escaped = payload.pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexBody = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  try {
    const compiled = new RegExp(regexBody);
    return compiled.test(payload.haystack);
  } catch {
    // Malformed pattern — degrade to no-match rather than crashing the panel.
    return false;
  }
}
