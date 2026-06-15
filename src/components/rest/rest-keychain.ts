// Sprint 10 — REST keychain IPC client.
//
// FE-side helper that calls the 4 Tauri commands defined in
// src-tauri/src/rest/commands.rs. Never receives plaintext — only masked
// SecretHandle values. Used by the request editor to store/display
// authentication credentials.

import { invoke } from "@tauri-apps/api/core";
import type {
  RestAuth,
  RestCookie,
  RestError,
  RestRequestRecord,
  SecretHandle,
  SecretRef,
} from "./rest-types";

export async function saveSecret(payload: {
  collectionId: string;
  key: string;
  plaintext: string;
}): Promise<SecretHandle> {
  return invoke<SecretHandle>("rest_save_secret", { payload });
}

export async function resolveSecretMasked(payload: { id: string }): Promise<SecretHandle> {
  return invoke<SecretHandle>("rest_resolve_secret_masked", { payload });
}

// Resolve plaintext for in-app display + inline editing of the saved
// secret. The Authorization tab uses this so users can see + edit their
// own keys directly instead of going through a Change-then-retype loop.
// IPC is process-local — the plaintext doesn't leave the machine.
export async function resolveSecretPlain(payload: {
  id: string;
}): Promise<{ id: string; plaintext: string }> {
  return invoke<{ id: string; plaintext: string }>("rest_resolve_secret_plain", {
    payload,
  });
}

export async function getCookies(payload: { collectionId: string }): Promise<RestCookie[]> {
  return invoke<RestCookie[]>("rest_get_cookies", { payload });
}

export async function clearCookies(payload: { collectionId: string }): Promise<void> {
  return invoke<void>("rest_clear_cookies", { payload });
}

/// Manually upsert a single cookie. Used by the Cookies tab's + Add row.
/// Same backend path as the auto Set-Cookie extractor — user-typed and
/// server-returned cookies share one bucket per (collection, domain, name).
export async function saveCookie(payload: {
  collectionId: string;
  cookie: RestCookie;
}): Promise<void> {
  return invoke<void>("rest_save_cookie", { payload });
}

/// Delete one cookie addressed by (collection, domain, name). Per-row × in
/// the Cookies tab. Idempotent — deleting a missing cookie is a no-op.
export async function deleteCookie(payload: {
  collectionId: string;
  domain: string;
  name: string;
}): Promise<void> {
  return invoke<void>("rest_delete_cookie", { payload });
}

export function isRestError(value: unknown): value is RestError {
  return (
    !!value &&
    typeof value === "object" &&
    "kind" in value &&
    "message" in value &&
    typeof (value as Record<string, unknown>).kind === "string"
  );
}

// Build the SecretRef array for rest_send_request from a request's auth
// settings. Plaintext was stashed in the OS keychain at save time — the FE
// only knows the handle id. Rust resolves the handle + injects at the path
// the moment before the HTTP call goes out, so plaintext never traverses IPC.
//
// What the secret value contains depends on the auth mode (assembled by the
// editor at save time, before the secret leaves the FE):
//   * bearer  → "Bearer <token>"
//   * basic   → "Basic <base64(user:pass)>"
//   * api-key → raw key value
//
// The corresponding header (or query param) name comes from the auth shape.
export function authToSecretRefs(auth: RestAuth | undefined): SecretRef[] {
  if (!auth || auth.kind === "none") return [];

  if (auth.kind === "bearer") {
    if (!auth.tokenHandleId) return [];
    return [{ path: "headers.Authorization", handleId: auth.tokenHandleId }];
  }

  if (auth.kind === "basic") {
    if (!auth.passwordHandleId) return [];
    return [{ path: "headers.Authorization", handleId: auth.passwordHandleId }];
  }

  if (auth.kind === "api-key") {
    if (!auth.valueHandleId || !auth.name.trim()) return [];
    const bucket = auth.in === "query" ? "query" : "headers";
    return [{ path: `${bucket}.${auth.name.trim()}`, handleId: auth.valueHandleId }];
  }

  return [];
}

// Stable key under which we ask Rust to store the secret. Keying by request id
// + auth slot keeps secrets scoped per-request — rotating a token in one
// request won't clobber another request that happened to share a name.
export function authSecretKey(request: RestRequestRecord, slot: "bearer" | "basic" | "api-key"): string {
  return `rest:${request.id}:auth:${slot}`;
}

// Extract the keychain handle id from a RestAuth, regardless of mode. Used
// by history replay to validate the credential still exists before applying
// the auth to a new request.
export function handleIdForAuth(auth: RestAuth | undefined): string | null {
  if (!auth) return null;
  if (auth.kind === "bearer") return auth.tokenHandleId ?? null;
  if (auth.kind === "basic") return auth.passwordHandleId ?? null;
  if (auth.kind === "api-key") return auth.valueHandleId ?? null;
  return null;
}

// Return a copy of the auth with its handle reference removed — used when
// a history replay finds the original keychain entry is gone, so the user
// gets a clean Authorization-tab state instead of a "secret-not-found" error.
export function stripAuthHandle(auth: RestAuth | undefined): RestAuth | undefined {
  if (!auth) return undefined;
  if (auth.kind === "bearer") return { kind: "bearer" };
  if (auth.kind === "basic") return { kind: "basic", username: auth.username };
  if (auth.kind === "api-key") return { kind: "api-key", in: auth.in, name: auth.name };
  return auth;
}
