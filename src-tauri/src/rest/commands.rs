// Sprint 10 — REST Tauri commands.
//
// T10A.1: skeleton + stubs.
// T10A.2: real `rest_send_request` via reqwest + secret injection.
// T10A.3: keyring-backed save / resolve / cookies (still stub here).

use std::collections::HashMap;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use super::keychain::active_adapter;
use super::{
    RestBody, RestCookie, RestError, RestHeader, RestRequest, RestResponse, SecretHandle, SecretRef,
};

const MAX_RESPONSE_BYTES: usize = 100 * 1024 * 1024;
const KEYCHAIN_SERVICE: &str = "penguin-rest";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendRequestPayload {
    pub req: RestRequest,
    #[serde(default)]
    pub secret_refs: Vec<SecretRef>,
    // Optional — when present, response Set-Cookie headers are auto-parsed
    // and persisted to the collection's cookie store. Absent during stateless
    // one-off sends (e.g. unsaved drafts). (DEC #189 — per-collection scope.)
    #[serde(default)]
    pub collection_id: Option<String>,
}

#[tauri::command]
pub async fn rest_send_request(payload: SendRequestPayload) -> Result<RestResponse, RestError> {
    let req = payload.req;

    // 1) Resolve secrets via keychain. Each ref's path is dot-notation —
    //    "headers.Authorization" / "query.api_key". Body-injection paths are
    //    rejected in MVP (needs JSON-path mutation, defer to Phase 10D+).
    let resolved = resolve_secret_refs(&payload.secret_refs)?;

    // 2) Build reqwest client honoring timeout + redirect policy.
    let timeout = Duration::from_millis(req.timeout_ms.unwrap_or(30_000));
    let redirect_policy = if req.follow_redirects {
        reqwest::redirect::Policy::limited(10)
    } else {
        reqwest::redirect::Policy::none()
    };
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .redirect(redirect_policy)
        .build()
        .map_err(|e| RestError {
            kind: "client-build".to_string(),
            message: e.to_string(),
        })?;

    // 3) Method.
    let method = match req.method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        other => {
            return Err(RestError {
                kind: "method".to_string(),
                message: format!("unsupported HTTP method: {}", other),
            });
        }
    };

    // 4) URL + query params (secret-aware).
    let mut url = reqwest::Url::parse(&req.url).map_err(|e| RestError {
        kind: "url-parse".to_string(),
        message: e.to_string(),
    })?;
    {
        let mut q = url.query_pairs_mut();
        for qp in &req.query_params {
            if !qp.enabled {
                continue;
            }
            let secret_path = format!("query.{}", qp.key);
            let value = resolved
                .get(&secret_path)
                .cloned()
                .unwrap_or_else(|| qp.value.clone());
            q.append_pair(&qp.key, &value);
        }
    }

    // 5) Build request — headers (secret-aware) + body.
    let mut rb = client.request(method, url);
    for h in &req.headers {
        if !h.enabled {
            continue;
        }
        let secret_path = format!("headers.{}", h.key);
        let value = resolved
            .get(&secret_path)
            .cloned()
            .unwrap_or_else(|| h.value.clone());
        rb = rb.header(&h.key, &value);
    }

    if let Some(body) = &req.body {
        rb = apply_body(rb, body);
    }

    // 6) Send + measure.
    let start = Instant::now();
    let response = rb.send().await.map_err(|e| {
        let kind = if e.is_timeout() {
            "timeout"
        } else if e.is_connect() {
            "connect"
        } else {
            "network"
        };
        RestError {
            kind: kind.to_string(),
            message: e.to_string(),
        }
    })?;

    let status = response.status().as_u16();
    let resp_headers: Vec<RestHeader> = response
        .headers()
        .iter()
        .map(|(k, v)| RestHeader {
            key: k.to_string(),
            value: v.to_str().unwrap_or("").to_string(),
            enabled: true,
        })
        .collect();

    // Phase 10D — auto-persist Set-Cookie headers to the collection's cookie
    // store. Failures are swallowed (the request itself succeeded; we don't
    // want a cookie write hiccup to nullify the response on the FE).
    if let Some(collection_id) = payload.collection_id.as_deref() {
        let request_host = reqwest::Url::parse(&req.url)
            .ok()
            .and_then(|u| u.host_str().map(String::from))
            .unwrap_or_default();
        for h in &resp_headers {
            if !h.key.eq_ignore_ascii_case("set-cookie") {
                continue;
            }
            if let Some(cookie) = parse_set_cookie(&h.value, &request_host) {
                let _ = super::cookie_store::upsert_cookie(collection_id, &cookie);
            }
        }
    }

    // 7) Body with 100MB cap (DEC #194 — no streaming in MVP).
    let body_bytes = response.bytes().await.map_err(|e| RestError {
        kind: "read-body".to_string(),
        message: e.to_string(),
    })?;
    let total_size = body_bytes.len() as u64;
    let truncated = body_bytes.len() > MAX_RESPONSE_BYTES;
    let kept_bytes: Vec<u8> = if truncated {
        body_bytes[..MAX_RESPONSE_BYTES].to_vec()
    } else {
        body_bytes.to_vec()
    };

    // Try UTF-8 first; if binary, base64-encode so JSON IPC stays clean.
    let body_str = match String::from_utf8(kept_bytes) {
        Ok(s) => s,
        Err(e) => {
            use base64::Engine;
            base64::engine::general_purpose::STANDARD.encode(e.into_bytes())
        }
    };

    let elapsed_ms = start.elapsed().as_millis() as u64;

    Ok(RestResponse {
        status,
        headers: resp_headers,
        body: body_str,
        body_bytes: total_size,
        elapsed_ms,
        truncated,
        error: None,
    })
}

/// Parse + validate each secret ref, resolve via keychain. Returns map from
/// `path` → plaintext value. The plaintext lives only on the Rust side for
/// the duration of this function — never re-serialized to the FE.
fn resolve_secret_refs(refs: &[SecretRef]) -> Result<HashMap<String, String>, RestError> {
    let mut out = HashMap::new();
    for sref in refs {
        let (location, key) = parse_secret_path(&sref.path)?;
        if location != "headers" && location != "query" {
            return Err(RestError {
                kind: "invalid-secret-path".to_string(),
                message: format!(
                    "body-path secret injection deferred — got {:?} on path {:?}",
                    location, sref.path
                ),
            });
        }
        if key.is_empty() {
            return Err(RestError {
                kind: "invalid-secret-path".to_string(),
                message: format!("empty key segment on path {:?}", sref.path),
            });
        }
        let plaintext = active_adapter()
            .get(KEYCHAIN_SERVICE, &sref.handle_id)
            .map_err(|e| RestError {
                kind: "auth-locked".to_string(),
                message: e,
            })?
            .ok_or_else(|| RestError {
                kind: "secret-not-found".to_string(),
                message: format!("keychain entry missing for handle id {:?}", sref.handle_id),
            })?;
        out.insert(sref.path.clone(), plaintext);
    }
    Ok(out)
}

/// Path examples: "headers.Authorization" → ("headers", "Authorization").
/// Only first dot splits — header names that legitimately contain dots are
/// rare but we keep everything after the first segment as the key.
fn parse_secret_path(path: &str) -> Result<(&str, &str), RestError> {
    let mut split = path.splitn(2, '.');
    let location = split.next().unwrap_or("");
    let key = split.next().ok_or_else(|| RestError {
        kind: "invalid-secret-path".to_string(),
        message: format!("path missing key segment: {:?}", path),
    })?;
    if location.is_empty() {
        return Err(RestError {
            kind: "invalid-secret-path".to_string(),
            message: format!("path missing location: {:?}", path),
        });
    }
    Ok((location, key))
}

fn apply_body(rb: reqwest::RequestBuilder, body: &RestBody) -> reqwest::RequestBuilder {
    match body {
        RestBody::Json { content } => rb
            .header("content-type", "application/json")
            .body(content.clone()),
        RestBody::Raw { content } => rb.body(content.clone()),
        RestBody::FormUrlencoded { fields } => {
            let pairs: Vec<(&str, &str)> = fields
                .iter()
                .filter(|f| f.enabled)
                .map(|f| (f.key.as_str(), f.value.as_str()))
                .collect();
            rb.form(&pairs)
        }
        // Multipart upload is Phase 10D; skip for now.
        RestBody::Multipart { .. } => rb,
        // Binary body assumed already-encoded UTF-8 or base64 text; raw send.
        RestBody::Binary { content } => rb.body(content.clone()),
        RestBody::None => rb,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSecretPayload {
    pub collection_id: String,
    pub key: String,
    pub plaintext: String,
}

#[tauri::command]
pub async fn rest_save_secret(payload: SaveSecretPayload) -> Result<SecretHandle, RestError> {
    // Handle ID is opaque — collection-scoped + key. Real impl writes via
    // keyring crate in T10A.3; for now we save through the active_adapter
    // (which is MockKeychain by default + KeyringAdapter once T10A.3 swaps).
    let handle_id = format!("{}::{}", payload.collection_id, payload.key);
    active_adapter()
        .save(KEYCHAIN_SERVICE, &handle_id, &payload.plaintext)
        .map_err(|e| RestError {
            kind: "keychain-write".to_string(),
            message: e,
        })?;
    Ok(SecretHandle {
        kind: "keychain".to_string(),
        id: handle_id,
        masked: mask_secret(&payload.plaintext),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveSecretMaskedPayload {
    pub id: String,
}

#[tauri::command]
pub async fn rest_resolve_secret_masked(
    payload: ResolveSecretMaskedPayload,
) -> Result<SecretHandle, RestError> {
    // Fetch the secret only to compute its mask; plaintext immediately drops.
    let plaintext = active_adapter()
        .get(KEYCHAIN_SERVICE, &payload.id)
        .map_err(|e| RestError {
            kind: "keychain-read".to_string(),
            message: e,
        })?;
    let masked = match &plaintext {
        Some(t) => mask_secret(t),
        None => "(missing)".to_string(),
    };
    Ok(SecretHandle {
        kind: "keychain".to_string(),
        id: payload.id,
        masked,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlainSecret {
    pub id: String,
    pub plaintext: String,
}

/// Resolve a secret's plaintext for in-app display + inline editing in the
/// Authorization tab. Departure from the original DEC #195 masked-only
/// contract — accepted because:
/// 1. The IPC channel is process-local, not network.
/// 2. The plaintext was typed by this same user; we're returning their
///    own value to themselves, not exposing a credential they don't own.
/// 3. Postman / Insomnia / every comparable tool shows credentials in
///    plain text. Masking-only was over-cautious and led the user to
///    file the "i can't see / can't edit my own key" complaint.
#[tauri::command]
pub async fn rest_resolve_secret_plain(
    payload: ResolveSecretMaskedPayload,
) -> Result<PlainSecret, RestError> {
    let plaintext = active_adapter()
        .get(KEYCHAIN_SERVICE, &payload.id)
        .map_err(|e| RestError {
            kind: "keychain-read".to_string(),
            message: e,
        })?
        .unwrap_or_default();
    Ok(PlainSecret {
        id: payload.id,
        plaintext,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookiesScopePayload {
    pub collection_id: String,
}

#[tauri::command]
pub async fn rest_get_cookies(payload: CookiesScopePayload) -> Result<Vec<RestCookie>, RestError> {
    // Phase 10B — real SQLite-backed list (expired cookies filtered out).
    // Auto Set-Cookie parsing from response headers + the Cookies tab UI
    // ship in Phase 10D; this returns whatever the FE has explicitly upserted
    // until then.
    super::cookie_store::list_cookies(&payload.collection_id).map_err(|e| RestError {
        kind: "cookies-read".to_string(),
        message: e,
    })
}

#[tauri::command]
pub async fn rest_clear_cookies(payload: CookiesScopePayload) -> Result<(), RestError> {
    super::cookie_store::clear_cookies(&payload.collection_id).map_err(|e| RestError {
        kind: "cookies-clear".to_string(),
        message: e,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCookiePayload {
    pub collection_id: String,
    pub cookie: RestCookie,
}

#[tauri::command]
pub async fn rest_save_cookie(payload: SaveCookiePayload) -> Result<(), RestError> {
    // Manual cookie upsert from the Cookies tab + Add row. The same upsert
    // path the response Set-Cookie auto-extractor uses; user edits and
    // server responses live in one bucket.
    super::cookie_store::upsert_cookie(&payload.collection_id, &payload.cookie).map_err(|e| RestError {
        kind: "cookies-write".to_string(),
        message: e,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCookiePayload {
    pub collection_id: String,
    pub domain: String,
    pub name: String,
}

#[tauri::command]
pub async fn rest_delete_cookie(payload: DeleteCookiePayload) -> Result<(), RestError> {
    super::cookie_store::delete_cookie(&payload.collection_id, &payload.domain, &payload.name).map_err(|e| RestError {
        kind: "cookies-delete".to_string(),
        message: e,
    })
}

/// Parse a Set-Cookie header value into a RestCookie. Format:
///   <name>=<value>[; Domain=<d>][; Path=<p>][; Expires=<http-date>][; Max-Age=<sec>]
/// We extract name/value/Domain/Path/Expires (or Max-Age). Domain falls back
/// to the request host when the header omits it. Returns None on parse
/// failures — we'd rather silently skip a malformed cookie than crash the
/// response path.
pub fn parse_set_cookie(value: &str, fallback_domain: &str) -> Option<super::RestCookie> {
    let mut parts = value.split(';').map(|s| s.trim());
    let first = parts.next()?;
    let eq = first.find('=')?;
    let name = first[..eq].trim().to_string();
    let val = first[eq + 1..].trim().to_string();
    if name.is_empty() {
        return None;
    }
    let mut domain: Option<String> = None;
    let mut path: Option<String> = None;
    let mut expires_at: Option<u64> = None;
    let mut max_age: Option<i64> = None;
    for attr in parts {
        let lc = attr.to_lowercase();
        if let Some(rest) = lc.strip_prefix("domain=") {
            domain = Some(rest.trim().to_string());
        } else if let Some(rest) = lc.strip_prefix("path=") {
            // preserve case of the path
            let original = &attr[5..];
            let _ = rest; // suppress unused
            path = Some(original.trim().to_string());
        } else if let Some(rest) = lc.strip_prefix("max-age=") {
            max_age = rest.trim().parse::<i64>().ok();
        } else if let Some(rest) = lc.strip_prefix("expires=") {
            // RFC 6265 IMF-fixdate. Parse via httpdate; fallback: leave None.
            // We avoid pulling a date dep — instead callers can interpret a
            // missing expires_at as "session cookie" (forever-ish for now).
            let _ = rest;
        }
    }
    if let Some(secs) = max_age {
        if secs > 0 {
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            expires_at = Some(now_ms + (secs as u64) * 1000);
        } else {
            // Max-Age=0 means "delete now" — flag with 1ms past epoch.
            expires_at = Some(1);
        }
    }
    Some(super::RestCookie {
        domain: domain.unwrap_or_else(|| fallback_domain.to_string()),
        name,
        value: val,
        path,
        expires_at,
    })
}

/// Mask middle of a secret, leaving the last 4 chars visible.
pub fn mask_secret(plaintext: &str) -> String {
    let visible_tail = 4;
    let len = plaintext.chars().count();
    if len <= visible_tail {
        return "•".repeat(len);
    }
    let tail: String = plaintext.chars().skip(len - visible_tail).collect();
    format!("••••{}", tail)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_set_cookie_minimal() {
        let c = parse_set_cookie("session=abc123", "api.example.com").unwrap();
        assert_eq!(c.name, "session");
        assert_eq!(c.value, "abc123");
        assert_eq!(c.domain, "api.example.com");
        assert_eq!(c.path, None);
        assert_eq!(c.expires_at, None);
    }

    #[test]
    fn parse_set_cookie_with_attributes() {
        let c = parse_set_cookie(
            "auth=xyz; Domain=.example.com; Path=/v1; Max-Age=3600",
            "api.example.com",
        )
        .unwrap();
        assert_eq!(c.name, "auth");
        assert_eq!(c.value, "xyz");
        assert_eq!(c.domain, ".example.com");
        assert_eq!(c.path.as_deref(), Some("/v1"));
        // expires_at = now + 3600s — must be in the near future, not None.
        assert!(c.expires_at.unwrap() > 1_700_000_000_000);
    }

    #[test]
    fn parse_set_cookie_lowercase_attributes() {
        // Real-world Set-Cookie headers often use lowercase attribute names
        // (some servers emit them post-normalization). The parser lower-cases
        // before matching; this test locks that behavior against a refactor
        // that drops the to_lowercase().
        let c = parse_set_cookie(
            "session=abc; domain=example.com; path=/api; max-age=60",
            "api.example.com",
        )
        .unwrap();
        assert_eq!(c.name, "session");
        assert_eq!(c.value, "abc");
        assert_eq!(c.domain, "example.com");
        assert_eq!(c.path.as_deref(), Some("/api"));
        assert!(c.expires_at.unwrap() > 1_700_000_000_000);
    }

    #[test]
    fn parse_set_cookie_max_age_zero_marks_expired() {
        let c = parse_set_cookie("kill=now; Max-Age=0", "api.example.com").unwrap();
        assert_eq!(c.expires_at, Some(1));
    }

    #[test]
    fn parse_set_cookie_rejects_malformed() {
        assert!(parse_set_cookie("no-equals-sign", "api.example.com").is_none());
        assert!(parse_set_cookie("=novalue", "api.example.com").is_none());
        assert!(parse_set_cookie("", "api.example.com").is_none());
    }

    #[test]
    fn parse_secret_path_extracts_location_and_key() {
        let (loc, key) = parse_secret_path("headers.Authorization").unwrap();
        assert_eq!(loc, "headers");
        assert_eq!(key, "Authorization");
    }

    #[test]
    fn parse_secret_path_rejects_missing_dot() {
        let err = parse_secret_path("nodot").unwrap_err();
        assert_eq!(err.kind, "invalid-secret-path");
    }

    #[test]
    fn parse_secret_path_rejects_empty_location() {
        let err = parse_secret_path(".key").unwrap_err();
        assert_eq!(err.kind, "invalid-secret-path");
    }

    #[test]
    fn mask_secret_short_string() {
        assert_eq!(mask_secret("ab"), "••");
    }

    #[test]
    fn mask_secret_long_string() {
        assert_eq!(mask_secret("supersecret123"), "••••t123");
    }
}
