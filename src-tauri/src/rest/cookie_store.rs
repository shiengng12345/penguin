// Sprint 10 Phase 10B — Per-collection cookie persistence.
//
// Backs rest_get_cookies / rest_clear_cookies with real SQLite rows instead
// of the Phase 10A empty stubs. Schema lives in src-tauri/src/db.rs:
//
//   CREATE TABLE rest_cookies (
//       id TEXT PRIMARY KEY,
//       collection_id TEXT NOT NULL,
//       domain TEXT NOT NULL,
//       name TEXT NOT NULL,
//       value TEXT NOT NULL,
//       path TEXT,
//       expires_at INTEGER,
//       updated_at INTEGER NOT NULL
//   );
//
// Phase 10D will wire auto Set-Cookie parsing from response headers and the
// Cookies tab UI. The shape this module exposes is stable so that work can
// land without touching commands.rs.

use rusqlite::{params, OptionalExtension};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::db::open_product_db_shared;
use crate::rest::RestCookie;

fn unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// List all cookies stored for a collection. Expired entries are filtered
/// out (still in the DB until clear_cookies, but invisible to callers).
pub fn list_cookies(collection_id: &str) -> Result<Vec<RestCookie>, String> {
    let conn = open_product_db_shared()?;
    let mut stmt = conn
        .prepare(
            "SELECT domain, name, value, path, expires_at \
             FROM rest_cookies \
             WHERE collection_id = ? \
             ORDER BY domain, name",
        )
        .map_err(|e| e.to_string())?;
    let now = unix_millis();
    // SQLite stores expires_at as INTEGER; the struct's u64 type means we
    // read into Option<i64> first (rusqlite doesn't bind u64 directly) then
    // cast — negative is treated as "no expiry" defensively.
    let rows = stmt
        .query_map(params![collection_id], |row| {
            let raw_exp: Option<i64> = row.get(4)?;
            Ok(RestCookie {
                domain: row.get(0)?,
                name: row.get(1)?,
                value: row.get(2)?,
                path: row.get::<_, Option<String>>(3)?,
                expires_at: raw_exp.and_then(|v| if v > 0 { Some(v as u64) } else { None }),
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    let now_u64 = now.max(0) as u64;
    for r in rows {
        let cookie = r.map_err(|e| e.to_string())?;
        // Hide expired cookies. We don't auto-delete here because callers may
        // want to surface "expired N hours ago" later; clear_cookies is the
        // only delete path right now.
        if let Some(exp) = cookie.expires_at {
            if exp < now_u64 {
                continue;
            }
        }
        out.push(cookie);
    }
    Ok(out)
}

/// Upsert a single cookie scoped to (collection_id, domain, name). Updating
/// an existing (domain, name) pair refreshes value / path / expires_at —
/// matches how a real browser tracks the latest Set-Cookie wins.
pub fn upsert_cookie(collection_id: &str, cookie: &RestCookie) -> Result<(), String> {
    let conn = open_product_db_shared()?;
    let now = unix_millis();
    // PRIMARY KEY is id (a TEXT) — for (collection_id, domain, name) tuples
    // we want UPSERT semantics. Build a stable synthetic id from the tuple.
    let synthetic_id = format!("{}::{}::{}", collection_id, cookie.domain, cookie.name,);
    // u64 max can't bind directly; cast to i64 (clamping to i64::MAX in the
    // extremely rare overflow case — sufficient for cookie expiry millis).
    let expires_i64 = cookie.expires_at.map(|v| {
        if v > i64::MAX as u64 {
            i64::MAX
        } else {
            v as i64
        }
    });
    conn.execute(
        "INSERT INTO rest_cookies (id, collection_id, domain, name, value, path, expires_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
         ON CONFLICT(id) DO UPDATE SET \
             value = excluded.value, \
             path = excluded.path, \
             expires_at = excluded.expires_at, \
             updated_at = excluded.updated_at",
        params![
            synthetic_id,
            collection_id,
            cookie.domain,
            cookie.name,
            cookie.value,
            cookie.path,
            expires_i64,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete a single cookie scoped by (collection_id, domain, name). Used by
/// the per-row delete button in the Cookies tab. The synthetic_id key
/// shape is mirrored from upsert_cookie so the row addresses match.
pub fn delete_cookie(collection_id: &str, domain: &str, name: &str) -> Result<(), String> {
    let conn = open_product_db_shared()?;
    let synthetic_id = format!("{}::{}::{}", collection_id, domain, name);
    conn.execute(
        "DELETE FROM rest_cookies WHERE id = ?",
        params![synthetic_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Delete every cookie for a collection. Used by the "Clear cookies" button
/// in the future Cookies tab + by collection delete cascade.
pub fn clear_cookies(collection_id: &str) -> Result<(), String> {
    let conn = open_product_db_shared()?;
    conn.execute(
        "DELETE FROM rest_cookies WHERE collection_id = ?",
        params![collection_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Count rows for a collection — exposed for tests + future "(N) cookies"
/// badge in the Cookies tab.
#[allow(dead_code)]
pub fn count_cookies(collection_id: &str) -> Result<i64, String> {
    let conn = open_product_db_shared()?;
    let count: Option<i64> = conn
        .query_row(
            "SELECT COUNT(*) FROM rest_cookies WHERE collection_id = ?",
            params![collection_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(count.unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    // Use a unique collection id per test so parallel cargo test runs don't
    // step on each other. The DB itself is shared with the user's real
    // Pengvi state — we use distinct scope IDs as isolation.
    fn unique_collection() -> String {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();
        format!("test-collection-{}-{}", pid, n)
    }

    fn sample(domain: &str, name: &str, value: &str) -> RestCookie {
        RestCookie {
            domain: domain.to_string(),
            name: name.to_string(),
            value: value.to_string(),
            path: Some("/".to_string()),
            expires_at: None,
        }
    }

    #[test]
    fn upsert_then_list_round_trips() {
        let cid = unique_collection();
        clear_cookies(&cid).unwrap();
        upsert_cookie(&cid, &sample("api.example.com", "session", "abc")).unwrap();
        let listed = list_cookies(&cid).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].value, "abc");
        clear_cookies(&cid).unwrap();
    }

    #[test]
    fn upsert_replaces_existing_value() {
        let cid = unique_collection();
        clear_cookies(&cid).unwrap();
        upsert_cookie(&cid, &sample("api.example.com", "session", "v1")).unwrap();
        upsert_cookie(&cid, &sample("api.example.com", "session", "v2")).unwrap();
        let listed = list_cookies(&cid).unwrap();
        assert_eq!(
            listed.len(),
            1,
            "duplicate (domain,name) should upsert, not append"
        );
        assert_eq!(listed[0].value, "v2");
        clear_cookies(&cid).unwrap();
    }

    #[test]
    fn clear_removes_all_for_collection() {
        let cid = unique_collection();
        upsert_cookie(&cid, &sample("a.example.com", "k1", "v1")).unwrap();
        upsert_cookie(&cid, &sample("b.example.com", "k2", "v2")).unwrap();
        assert_eq!(count_cookies(&cid).unwrap(), 2);
        clear_cookies(&cid).unwrap();
        assert_eq!(count_cookies(&cid).unwrap(), 0);
    }

    #[test]
    fn expired_cookies_are_filtered_from_list() {
        let cid = unique_collection();
        clear_cookies(&cid).unwrap();
        // expires_at in the past = expired
        let expired = RestCookie {
            domain: "api.example.com".to_string(),
            name: "stale".to_string(),
            value: "x".to_string(),
            path: None,
            expires_at: Some(1_u64),
        };
        let live = RestCookie {
            domain: "api.example.com".to_string(),
            name: "fresh".to_string(),
            value: "y".to_string(),
            path: None,
            // Y2100 ish — well into the future for the lifetime of this test
            expires_at: Some(4_102_444_800_000_u64),
        };
        upsert_cookie(&cid, &expired).unwrap();
        upsert_cookie(&cid, &live).unwrap();
        let listed = list_cookies(&cid).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "fresh");
        clear_cookies(&cid).unwrap();
    }

    #[test]
    fn delete_cookie_removes_one_row_leaves_others() {
        // Per-row delete must be addressable by (collection, domain, name)
        // without touching siblings — same synthetic_id shape as upsert.
        let cid = unique_collection();
        clear_cookies(&cid).unwrap();
        upsert_cookie(&cid, &sample("api.example.com", "session", "abc")).unwrap();
        upsert_cookie(&cid, &sample("api.example.com", "csrf", "xyz")).unwrap();
        assert_eq!(count_cookies(&cid).unwrap(), 2);
        delete_cookie(&cid, "api.example.com", "session").unwrap();
        let remaining = list_cookies(&cid).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].name, "csrf");
        // Idempotent — deleting a missing cookie is a no-op (not an error).
        delete_cookie(&cid, "api.example.com", "session").unwrap();
        clear_cookies(&cid).unwrap();
    }

    #[test]
    fn isolated_collections_do_not_leak() {
        let cid_a = unique_collection();
        let cid_b = unique_collection();
        upsert_cookie(&cid_a, &sample("api.example.com", "k", "from-a")).unwrap();
        upsert_cookie(&cid_b, &sample("api.example.com", "k", "from-b")).unwrap();
        let listed_a = list_cookies(&cid_a).unwrap();
        let listed_b = list_cookies(&cid_b).unwrap();
        assert_eq!(listed_a[0].value, "from-a");
        assert_eq!(listed_b[0].value, "from-b");
        clear_cookies(&cid_a).unwrap();
        clear_cookies(&cid_b).unwrap();
    }
}
