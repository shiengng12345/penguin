use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const REDIS_SECRET_PREFIX: &str = "redis:secret:";

fn redis_db_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("no home dir")?;
    Ok(home.join(".penguin").join("penguin.sqlite3"))
}

fn open_db() -> Result<Connection, String> {
    let path = redis_db_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS redis_connections (
             id          TEXT PRIMARY KEY NOT NULL,
             label       TEXT NOT NULL,
             host        TEXT NOT NULL,
             port        INTEGER NOT NULL DEFAULT 6379,
             db          INTEGER NOT NULL DEFAULT 0,
             password    TEXT NOT NULL DEFAULT '',
             created_at  INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS redis_groups (
             name        TEXT PRIMARY KEY NOT NULL,
             created_at  INTEGER NOT NULL
         );",
    )
    .map_err(|e| e.to_string())?;

    // Connection-manager migration: add columns for group / username / type /
    // advanced config. WHY: ALTER ADD COLUMN errors with "duplicate column name"
    // on every run after the first — that is expected, so the error is ignored.
    for statement in [
        "ALTER TABLE redis_connections ADD COLUMN group_name TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE redis_connections ADD COLUMN username TEXT NOT NULL DEFAULT ''",
        "ALTER TABLE redis_connections ADD COLUMN conn_type TEXT NOT NULL DEFAULT 'tcp'",
        "ALTER TABLE redis_connections ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}'",
    ] {
        let _ = conn.execute(statement, []);
    }
    Ok(conn)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub db: u8,
    pub has_password: bool,
    pub created_at: u64,
}

#[derive(Debug, Clone)]
pub struct ConnectionConfig {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) db: u8,
    pub(crate) password: String,
}

struct RawConnectionRow {
    id: String,
    label: String,
    host: String,
    port: u16,
    db: u8,
    legacy_password: String,
    created_at: u64,
}

fn redis_secret_key(id: &str) -> String {
    format!("{REDIS_SECRET_PREFIX}{id}")
}

fn save_secret(id: &str, password: &str) -> Result<(), String> {
    if password.is_empty() {
        crate::db::app_value_delete_internal(redis_secret_key(id))
    } else {
        crate::db::app_value_set_internal(redis_secret_key(id), password.to_string())
    }
}

fn load_secret(id: &str) -> Result<Option<String>, String> {
    crate::db::app_value_get_internal(redis_secret_key(id))
}

fn migrate_legacy_password(conn: &Connection, id: &str, legacy_password: &str) -> Result<(), String> {
    if legacy_password.is_empty() {
        return Ok(());
    }
    save_secret(id, legacy_password)?;
    conn.execute(
        "UPDATE redis_connections SET password = '' WHERE id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn db_save_connection(
    label: &str,
    host: &str,
    port: u16,
    db: u8,
    password: &str,
) -> Result<String, String> {
    let conn = open_db()?;
    let id = format!(
        "redis-{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        &uuid_fragment()
    );
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO redis_connections (id, label, host, port, db, password, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            label,
            host,
            port as i64,
            db as i64,
            "",
            now as i64
        ],
    )
    .map_err(|e| e.to_string())?;
    save_secret(&id, password)?;
    Ok(id)
}

pub fn db_list_connections() -> Result<Vec<SavedConnection>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, label, host, port, db, password, created_at
             FROM redis_connections ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(RawConnectionRow {
                id: row.get(0)?,
                label: row.get(1)?,
                host: row.get(2)?,
                port: row.get::<_, i64>(3)? as u16,
                db: row.get::<_, i64>(4)? as u8,
                legacy_password: row.get(5)?,
                created_at: row.get::<_, i64>(6)? as u64,
            })
        })
        .map_err(|e| e.to_string())?;
    let rows = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        migrate_legacy_password(&conn, &row.id, &row.legacy_password)?;
        let has_password = !row.legacy_password.is_empty() || load_secret(&row.id)?.is_some();
        result.push(SavedConnection {
            id: row.id,
            label: row.label,
            host: row.host,
            port: row.port,
            db: row.db,
            has_password,
            created_at: row.created_at,
        });
    }
    Ok(result)
}

pub fn db_get_connection_config(id: &str) -> Result<ConnectionConfig, String> {
    let conn = open_db()?;
    let row: RawConnectionRow = conn
        .query_row(
            "SELECT id, label, host, port, db, password, created_at
             FROM redis_connections WHERE id = ?1",
            params![id],
            |row| {
                Ok(RawConnectionRow {
                    id: row.get(0)?,
                    label: row.get(1)?,
                    host: row.get(2)?,
                    port: row.get::<_, i64>(3)? as u16,
                    db: row.get::<_, i64>(4)? as u8,
                    legacy_password: row.get(5)?,
                    created_at: row.get::<_, i64>(6)? as u64,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Redis connection not found".to_string())?;

    migrate_legacy_password(&conn, &row.id, &row.legacy_password)?;
    let password = load_secret(&row.id)?.unwrap_or(row.legacy_password);
    Ok(ConnectionConfig {
        host: row.host,
        port: row.port,
        db: row.db,
        password,
    })
}

pub fn db_delete_connection(id: &str) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM redis_connections WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    crate::db::app_value_delete_internal(redis_secret_key(id))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Connection Manager — groups + full connection records (Phase 1)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct SavedConnectionFull {
    pub id: String,
    pub label: String,
    pub group_name: String,
    pub conn_type: String,
    pub host: String,
    pub port: u16,
    pub db: u8,
    pub username: String,
    pub has_password: bool,
    pub config_json: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaveConnectionInput {
    pub id: Option<String>,
    pub label: String,
    pub group_name: String,
    pub conn_type: String,
    pub host: String,
    pub port: u16,
    pub db: u8,
    pub username: String,
    /// `Some` sets/replaces the secret; `None` leaves the stored secret unchanged.
    pub password: Option<String>,
    pub config_json: String,
}

pub fn db_list_groups() -> Result<Vec<String>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT name FROM redis_groups ORDER BY name ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let names = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(names)
}

pub fn db_create_group(name: &str) -> Result<(), String> {
    // WHY: empty group must be creatable — Tiny RDM allows New Group before any
    // connection is added to it.
    if name.trim().is_empty() {
        return Err("group name is empty".to_string());
    }
    let conn = open_db()?;
    conn.execute(
        "INSERT OR IGNORE INTO redis_groups (name, created_at) VALUES (?1, ?2)",
        params![name, now_secs() as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn db_delete_group(name: &str) -> Result<(), String> {
    let conn = open_db()?;
    // WHY: ungroup the connections rather than delete them with the group.
    conn.execute(
        "UPDATE redis_connections SET group_name = '' WHERE group_name = ?1",
        params![name],
    )
    .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM redis_groups WHERE name = ?1", params![name])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn db_list_connections_full() -> Result<Vec<SavedConnectionFull>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, label, group_name, conn_type, host, port, db, username, password, config_json, created_at
             FROM redis_connections ORDER BY created_at ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)? as u16,
                row.get::<_, i64>(6)? as u8,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, i64>(10)? as u64,
            ))
        })
        .map_err(|e| e.to_string())?;
    let rows = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    let mut result = Vec::with_capacity(rows.len());
    for (id, label, group_name, conn_type, host, port, db, username, legacy_password, config_json, created_at) in
        rows
    {
        migrate_legacy_password(&conn, &id, &legacy_password)?;
        let has_password = !legacy_password.is_empty() || load_secret(&id)?.is_some();
        result.push(SavedConnectionFull {
            id,
            label,
            group_name,
            conn_type,
            host,
            port,
            db,
            username,
            has_password,
            config_json,
            created_at,
        });
    }
    Ok(result)
}

pub fn db_get_connection_full(id: &str) -> Result<SavedConnectionFull, String> {
    db_list_connections_full()?
        .into_iter()
        .find(|connection| connection.id == id)
        .ok_or_else(|| format!("connection not found: {id}"))
}

pub fn db_load_connection_password(id: &str) -> Result<Option<String>, String> {
    load_secret(id)
}

pub fn db_save_connection_full(input: SaveConnectionInput) -> Result<String, String> {
    let conn = open_db()?;
    let id = match &input.id {
        Some(existing) => existing.clone(),
        None => format!(
            "redis-{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0),
            uuid_fragment()
        ),
    };
    let now = now_secs();
    conn.execute(
        "INSERT INTO redis_connections
            (id, label, group_name, conn_type, host, port, db, username, password, config_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, '', ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
            label=?2, group_name=?3, conn_type=?4, host=?5, port=?6, db=?7, username=?8, config_json=?9",
        params![
            id,
            input.label,
            input.group_name,
            input.conn_type,
            input.host,
            input.port as i64,
            input.db as i64,
            input.username,
            input.config_json,
            now as i64
        ],
    )
    .map_err(|e| e.to_string())?;

    // WHY: only touch the secret when a password was supplied; on edit with no
    // password change the caller sends None so the stored secret is preserved.
    if let Some(password) = input.password {
        save_secret(&id, &password)?;
    }

    if !input.group_name.trim().is_empty() {
        conn.execute(
            "INSERT OR IGNORE INTO redis_groups (name, created_at) VALUES (?1, ?2)",
            params![input.group_name, now as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(id)
}

fn uuid_fragment() -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    SystemTime::now().hash(&mut h);
    format!("{:x}", h.finish() & 0xFFFFFF)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saved_connection_serializes_metadata_without_password() {
        let saved = SavedConnection {
            id: "redis-1".to_string(),
            label: "Local".to_string(),
            host: "127.0.0.1".to_string(),
            port: 6379,
            db: 0,
            has_password: true,
            created_at: 123,
        };

        let value = serde_json::to_value(saved).unwrap();

        assert_eq!(value["has_password"], true);
        assert!(value.get("password").is_none());
    }

    #[test]
    fn redis_secret_key_uses_reserved_app_kv_prefix() {
        assert_eq!(redis_secret_key("redis-1"), "redis:secret:redis-1");
    }
}
