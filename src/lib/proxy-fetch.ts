import { invoke } from "@tauri-apps/api/core";

interface HttpProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  body_base64: string;
  error: string | null;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function proxyFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const url = typeof input === "string" ? input : input.toString();
  const method = init?.method ?? "GET";

  const headers: Record<string, string> = {};
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        headers[key] = value;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [key, value] of init.headers) {
        headers[key] = value;
      }
    } else {
      Object.assign(headers, init.headers);
    }
  }

  let bodyBase64: string | undefined;
  let bodyText: string | undefined;

  if (init?.body != null) {
    if (init.body instanceof ArrayBuffer) {
      bodyBase64 = uint8ToBase64(new Uint8Array(init.body));
    } else if (init.body instanceof Uint8Array) {
      bodyBase64 = uint8ToBase64(init.body);
    } else if (typeof init.body === "string") {
      bodyText = init.body;
    } else {
      bodyText = String(init.body);
    }
  }

  const resp = await invoke<HttpProxyResponse>("http_proxy", {
    req: {
      url,
      method,
      headers,
      body: bodyText ?? null,
      body_base64: bodyBase64 ?? null,
    },
  });

  if (resp.error) {
    throw new Error(resp.error);
  }

  const responseBytes = resp.body_base64
    ? base64ToUint8(resp.body_base64)
    : new TextEncoder().encode(resp.body);

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(resp.headers)) {
    responseHeaders.set(key, value);
  }

  return new Response(responseBytes.buffer as ArrayBuffer, {
    status: resp.status,
    headers: responseHeaders,
  });
}
