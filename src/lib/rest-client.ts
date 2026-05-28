import type { MetadataEntry, ResponseState } from "@/lib/store";
import { metadataToHeaders, type RestMethod } from "@/lib/rest";
import { proxyFetch } from "@/lib/proxy-fetch";

export async function callRest(params: {
  method: RestMethod;
  url: string;
  body: string;
  metadata: MetadataEntry[];
}): Promise<ResponseState> {
  const started = performance.now();
  const response = await proxyFetch(params.url, {
    method: params.method,
    headers: metadataToHeaders(params.metadata),
    body: params.method === "GET" || params.method === "HEAD" ? undefined : params.body,
  });
  const body = await response.text();
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    status: response.statusText || String(response.status),
    statusCode: response.status,
    body,
    headers,
    duration: Math.round(performance.now() - started),
  };
}
