import type { MetadataEntry } from "@/lib/store";

export const REST_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type RestMethod = (typeof REST_METHODS)[number];

export const REST_BODY_MODES = ["json", "raw"] as const;
export type RestBodyMode = (typeof REST_BODY_MODES)[number];

export function toRestMethod(value: string | undefined, fallback: RestMethod = "GET"): RestMethod {
  const upper = value?.toUpperCase();
  return REST_METHODS.includes(upper as RestMethod) ? (upper as RestMethod) : fallback;
}

export function inferRestBodyMode(body: string, contentType?: string): RestBodyMode {
  if (/json/i.test(contentType ?? "")) return "json";
  if (!body.trim()) return "json";
  try {
    JSON.parse(body);
    return "json";
  } catch {
    return "raw";
  }
}

export function resolveRestUrl(input: string, env: Record<string, string | undefined>): string {
  const interpolated = input.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => env[key] ?? "");
  if (/^https?:\/\//i.test(interpolated)) return interpolated;

  const base = env.URL?.replace(/\/+$/, "");
  if (!base) {
    throw new Error("REST path requires URL environment variable");
  }

  const path = interpolated.startsWith("/") ? interpolated : `/${interpolated}`;
  return `${base}${path}`;
}

export function metadataToHeaders(metadata: MetadataEntry[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of metadata) {
    const key = entry.key.trim();
    if (!entry.enabled || !key) continue;
    headers[key] = entry.value;
  }
  return headers;
}

function shellSingleQuote(value: string): string {
  return value.replace(/'/g, "'\\''");
}

export function buildRestCurl(params: {
  method: RestMethod;
  url: string;
  headers: MetadataEntry[];
  body: string;
}): string {
  const lines = [`curl -X ${params.method} '${shellSingleQuote(params.url)}'`];
  for (const entry of params.headers) {
    const key = entry.key.trim();
    if (!entry.enabled || !key) continue;
    lines.push(`  -H '${shellSingleQuote(`${key}: ${entry.value}`)}'`);
  }
  if (params.body.trim() && params.method !== "GET" && params.method !== "HEAD") {
    lines.push(`  -d '${shellSingleQuote(params.body)}'`);
  }
  return lines.join(" \\\n");
}
