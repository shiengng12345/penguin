export type RedisValueKind =
  | "json-object"
  | "json-array"
  | "boolean"
  | "number"
  | "date"
  | "null"
  | "string";

export const REDIS_VALUE_KIND_LABEL: Record<RedisValueKind, string> = {
  "json-object": "JSON",
  "json-array": "JSON[]",
  boolean: "BOOL",
  number: "NUM",
  date: "DATE",
  null: "NULL",
  string: "STR",
};

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

function isDateLike(value: string): boolean {
  const text = value.trim();
  if (text.length < 8) return false;
  if (!/[a-zA-Z]/.test(text) && !/^\d{4}-\d{2}-\d{2}/.test(text)) return false;
  if (Number.isNaN(Date.parse(text))) return false;
  return (
    /^\d{4}-\d{2}-\d{2}/.test(text) ||
    /\b(?:GMT|UTC)\b/.test(text) ||
    /^[A-Z][a-z]{2}\s+[A-Z][a-z]{2}\s+\d{1,2}\s+\d{4}/.test(text)
  );
}

export function inferRedisValueKind(value: string): RedisValueKind {
  const text = value.trim();
  if (text.length === 0) return "string";

  try {
    const parsed = parseJson(text);
    if (parsed === null) return "null";
    if (Array.isArray(parsed)) return "json-array";
    if (typeof parsed === "object") return "json-object";
    if (typeof parsed === "boolean") return "boolean";
    if (typeof parsed === "number") return "number";
    if (typeof parsed === "string" && isDateLike(parsed)) return "date";
    return "string";
  } catch {
    // Fall through to scalar/date heuristics for plain Redis strings.
  }

  if (/^(true|false)$/i.test(text)) return "boolean";
  if (/^null$/i.test(text)) return "null";
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text)) return "number";
  if (isDateLike(text)) return "date";
  return "string";
}

export function formatRedisValueForEditor(value: string): string {
  const text = value.trim();
  if (text.length === 0) return value;

  try {
    const parsed = parseJson(text);
    if (parsed !== null && (Array.isArray(parsed) || typeof parsed === "object")) {
      return JSON.stringify(parsed, null, 2);
    }
  } catch {
    // Keep invalid or non-JSON values exactly as stored.
  }

  return value;
}
