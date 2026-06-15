// Tiny JSONPath subset for the REST response viewer. Supports just what users
// actually type 95% of the time — full JSONPath spec would mean pulling in a
// 30 KB lib (jsonpath-plus). For complex queries users can paste the response
// elsewhere; this gives them quick drilling.
//
// Supported:
//   $                  root
//   $.foo              property lookup (no quoting)
//   $.foo.bar.baz      chained property lookup
//   $.arr[0]           positional index
//   $.arr[-1]          negative index (last)
//   $.arr[*]           every element (returns array of results)
//   $.arr[*].name      then property lookup per element
//   $["with space"]    bracket-quoted property name
//
// Output is always JSON-stringified — keeps the response panel rendering
// path identical to the "no filter" case.

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export interface JsonPathResult {
  ok: boolean;
  value: string;
  error?: string;
}

/// Parsed snapshot of the response body — useMemo this by body text so a
/// 50MB JSON.parse runs ONCE per response, not once per JSONPath keystroke.
export interface ParsedJsonBody {
  ok: boolean;
  parsed?: JsonValue;
  error?: string;
}

/// Parse the body once. ResponsePanel useMemo's this so subsequent path
/// changes reuse the parsed tree — the parse is the expensive step
/// (10 MB → ~30 ms, 50 MB → ~180 ms), traversal is fast.
export function parseJsonBody(jsonText: string): ParsedJsonBody {
  try {
    return { ok: true, parsed: JSON.parse(jsonText) as JsonValue };
  } catch {
    return { ok: false, error: "Response is not JSON" };
  }
}

/// Apply a JSONPath against an already-parsed body. Cheap part of the
/// pipeline — segment tokenization + tree walk only.
export function applyJsonPathToParsed(
  parsed: JsonValue,
  jsonText: string,
  path: string,
): JsonPathResult {
  const trimmed = path.trim();
  // Whole-body path: pretty-print the parsed value so the response
  // viewer shows indented JSON instead of the server's wire-format
  // minified blob. The serialize cost is one stringify per body change
  // (memoized by ResponsePanel), and the diff vs the raw text is what
  // users actually want to read.
  if (!trimmed || trimmed === "$") return prettyPrint(parsed, jsonText);
  if (!trimmed.startsWith("$")) {
    return { ok: false, value: jsonText, error: "JSONPath must start with $" };
  }
  return traverse(parsed, jsonText, trimmed);
}

function prettyPrint(parsed: JsonValue, jsonText: string): JsonPathResult {
  try {
    return { ok: true, value: JSON.stringify(parsed, null, 2) };
  } catch {
    // Circular / non-serializable — fall back to the raw text rather
    // than throwing. Shouldn't happen for server JSON but the body
    // came from JSON.parse so theoretically possible after mutation.
    return { ok: true, value: jsonText };
  }
}

/// Back-compat wrapper — parses + traverses in one call. Old callers that
/// don't useMemo can keep using this. New code (ResponsePanel) splits into
/// parse-once + traverse-many for the perf win.
export function applyJsonPath(jsonText: string, path: string): JsonPathResult {
  const trimmed = path.trim();
  if (!trimmed.startsWith("$") && trimmed !== "") {
    return { ok: false, value: jsonText, error: "JSONPath must start with $" };
  }
  const { ok, parsed, error } = parseJsonBody(jsonText);
  if (!ok || parsed === undefined) {
    return { ok: false, value: jsonText, error: error ?? "Response is not JSON" };
  }
  if (!trimmed || trimmed === "$") return prettyPrint(parsed, jsonText);
  return traverse(parsed, jsonText, trimmed);
}

function traverse(parsed: JsonValue, jsonText: string, trimmed: string): JsonPathResult {
  const segments = tokenize(trimmed.slice(1));
  if (!segments) {
    return { ok: false, value: jsonText, error: "Couldn't parse JSONPath" };
  }
  let current: JsonValue | JsonValue[] = parsed;
  let isWildcardExpanded = false;
  for (const seg of segments) {
    if (seg.kind === "key") {
      if (isWildcardExpanded && Array.isArray(current)) {
        current = current
          .map((v) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, JsonValue>)[seg.name] : undefined))
          .filter((v): v is JsonValue => v !== undefined);
      } else if (current && typeof current === "object" && !Array.isArray(current)) {
        current = (current as Record<string, JsonValue>)[seg.name];
        if (current === undefined) {
          return { ok: false, value: jsonText, error: `Key ${JSON.stringify(seg.name)} not found` };
        }
      } else {
        return { ok: false, value: jsonText, error: `Can't read .${seg.name} from non-object` };
      }
    } else if (seg.kind === "index") {
      if (!Array.isArray(current)) {
        return { ok: false, value: jsonText, error: `[${seg.index}] requires array` };
      }
      const idx = seg.index < 0 ? current.length + seg.index : seg.index;
      const next = current[idx];
      if (next === undefined) {
        return { ok: false, value: jsonText, error: `Index ${seg.index} out of bounds` };
      }
      current = next;
    } else if (seg.kind === "wildcard") {
      if (!Array.isArray(current)) {
        return { ok: false, value: jsonText, error: "[*] requires array" };
      }
      isWildcardExpanded = true;
    }
  }
  try {
    return { ok: true, value: JSON.stringify(current, null, 2) };
  } catch {
    return { ok: false, value: jsonText, error: "Result is not serializable" };
  }
}

/// Helper for callers that need to query "is this path a wildcard scan?"
/// without running the traversal — used to decide whether to gate large-body
/// queries behind an explicit confirm.
export function jsonPathUsesWildcard(path: string): boolean {
  return path.includes("[*]");
}

type Segment =
  | { kind: "key"; name: string }
  | { kind: "index"; index: number }
  | { kind: "wildcard" };

function tokenize(s: string): Segment[] | null {
  const out: Segment[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === ".") {
      i++;
      if (s[i] === "[") continue; // handled below
      let j = i;
      while (j < s.length && s[j] !== "." && s[j] !== "[") j++;
      const name = s.slice(i, j);
      if (!name) return null;
      out.push({ kind: "key", name });
      i = j;
    } else if (s[i] === "[") {
      const end = s.indexOf("]", i);
      if (end < 0) return null;
      const inner = s.slice(i + 1, end).trim();
      if (inner === "*") {
        out.push({ kind: "wildcard" });
      } else if (inner.startsWith('"') && inner.endsWith('"')) {
        out.push({ kind: "key", name: inner.slice(1, -1) });
      } else if (inner.startsWith("'") && inner.endsWith("'")) {
        out.push({ kind: "key", name: inner.slice(1, -1) });
      } else {
        const n = parseInt(inner, 10);
        if (Number.isNaN(n)) return null;
        out.push({ kind: "index", index: n });
      }
      i = end + 1;
    } else {
      return null;
    }
  }
  return out;
}
