// Pure curl parser shared by:
// - src/components/environment/CurlImport.tsx (request panel — full env creation)
// - src/components/docs/ApiDocsPage.tsx (Knowledge Base — endpoint pre-fill)
//
// Returns a flat record of what the curl asked for. Callers decide what to do
// with it (create env, fill form, etc.). No environment-detection lives here.

export interface ParsedCurl {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function extractQuoted(src: string, start: number): { value: string; end: number } | null {
  const ch = src[start];
  if (ch !== "'" && ch !== '"') return null;
  let i = start + 1;
  let out = "";
  while (i < src.length) {
    if (src[i] === "\\") {
      out += src[i + 1] ?? "";
      i += 2;
    } else if (src[i] === ch) {
      return { value: out, end: i + 1 };
    } else {
      out += src[i];
      i++;
    }
  }
  return { value: out, end: i };
}

function extractToken(src: string, start: number): { value: string; end: number } {
  if (start < src.length && (src[start] === "'" || src[start] === '"')) {
    const q = extractQuoted(src, start);
    if (q) return q;
  }
  let i = start;
  while (i < src.length && src[i] !== " " && src[i] !== "\t") i++;
  return { value: src.slice(start, i), end: i };
}

function skipWs(src: string, i: number): number {
  while (i < src.length && (src[i] === " " || src[i] === "\t")) i++;
  return i;
}

export function parseCurl(input: string): ParsedCurl | null {
  const normalized = input
    .trim()
    .replace(/\\\r?\n/g, " ")
    .replace(/[\r\n]+/g, " ");

  if (!normalized.toLowerCase().startsWith("curl")) return null;

  let method = "";
  let url = "";
  const headers: Record<string, string> = {};
  let body = "";

  let i = 4;
  while (i < normalized.length) {
    i = skipWs(normalized, i);
    if (i >= normalized.length) break;

    if (normalized[i] === "-") {
      if (normalized.startsWith("-X", i)) {
        i = skipWs(normalized, i + 2);
        const tok = extractToken(normalized, i);
        method = tok.value.toUpperCase();
        i = tok.end;
      } else if (normalized.startsWith("-H", i) || normalized.startsWith("--header", i)) {
        i += normalized.startsWith("--header", i) ? 8 : 2;
        i = skipWs(normalized, i);
        const tok = extractToken(normalized, i);
        i = tok.end;
        const colonIdx = tok.value.indexOf(":");
        if (colonIdx > 0) {
          headers[tok.value.slice(0, colonIdx).trim()] = tok.value.slice(colonIdx + 1).trim();
        }
      } else if (
        normalized.startsWith("-d", i) ||
        normalized.startsWith("--data-raw", i) ||
        normalized.startsWith("--data-binary", i) ||
        normalized.startsWith("--data", i)
      ) {
        const flagLen = normalized.startsWith("--data-raw", i)
          ? 10
          : normalized.startsWith("--data-binary", i)
          ? 13
          : normalized.startsWith("--data", i)
          ? 6
          : 2;
        i += flagLen;
        i = skipWs(normalized, i);
        // Skip the `$` shell sigil that some copy-paste flows include for
        // POSIX-style locale escape (e.g. `--data $'...'`).
        if (i < normalized.length && normalized[i] === "$") i++;
        const tok = extractToken(normalized, i);
        body = tok.value;
        i = tok.end;
      } else {
        const tok = extractToken(normalized, i);
        i = tok.end;
        // No-arg flags we silently skip — they don't affect parsed shape.
        if (
          tok.value === "--compressed" ||
          tok.value === "-k" ||
          tok.value === "--insecure" ||
          tok.value === "-s" ||
          tok.value === "--silent" ||
          tok.value === "-v" ||
          tok.value === "--verbose" ||
          tok.value === "-L" ||
          tok.value === "--location"
        ) {
          continue;
        }
        // Unknown short flag with value — swallow the value token too.
        if (tok.value.startsWith("-") && !tok.value.startsWith("--") && tok.value.length === 2) {
          i = skipWs(normalized, i);
          const valTok = extractToken(normalized, i);
          i = valTok.end;
        }
      }
    } else {
      const tok = extractToken(normalized, i);
      i = tok.end;
      const looksLikeUrl = tok.value.startsWith("http://") || tok.value.startsWith("https://");
      if (!url && looksLikeUrl) {
        url = tok.value;
      }
    }
  }

  if (!url) return null;
  if (!method) method = body ? "POST" : "GET";

  // Best-effort pretty-print JSON body so the editor shows a readable example;
  // leave non-JSON bodies (form data, raw text) untouched.
  try {
    body = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    // leave as-is
  }

  return { url, method, headers, body };
}

// Split a parsed URL into (origin, pathWithQuery) — KB editor fills baseUrl
// and path separately so the user can adjust either side.
export function splitUrlForKb(url: string): { baseUrl: string; path: string } {
  try {
    const u = new URL(url);
    const baseUrl = `${u.protocol}//${u.host}`;
    const path = `${u.pathname}${u.search}`;
    return { baseUrl, path };
  } catch {
    return { baseUrl: "", path: url };
  }
}

// Lookup helper for headers — case-insensitive, returns empty string if missing.
export function getHeader(headers: Record<string, string>, name: string): string {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return "";
}
