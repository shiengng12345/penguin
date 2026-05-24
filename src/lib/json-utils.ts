// Shared JSON parse/format helpers — consolidates the "user is mid-typing,
// invalid JSON is expected" pattern that previously appeared as duplicated
// try/catch blocks across history, saved-requests, response, and request panels.

// Pretty-prints JSON; on parse failure returns the raw string unchanged.
// Use when displaying user-authored or in-flight JSON where invalidity is normal.
export function tryFormatJson(raw: string, indent: number = 2): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, indent);
  } catch {
    return raw;
  }
}

// Parses JSON; returns the fallback (default: undefined) on failure.
// Caller must handle the undefined case explicitly when no fallback is given.
export function tryParseJson<T = unknown>(raw: string, fallback?: T): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
