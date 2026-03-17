use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use redis::aio::MultiplexedConnection;
use redis::{AsyncCommands, Client, Value};
use rusqlite::{params, Connection, OptionalExtension};
use tokio::sync::Mutex as AsyncMutex;
use tokio::time::timeout;

use super::models::{
    RedisConnType, RedisConnectResponse, RedisConnectionDraft, RedisConnectionRecord, RedisDbInfo,
    RedisHashField, RedisKeyInfo, RedisKeyValue, RedisScanResult, RedisServerInfo,
    RedisSshConfig, RedisTlsConfig, RedisZSetMember,
};

struct RedisConnectionHandle {
    connection: Arc<AsyncMutex<MultiplexedConnection>>,
}

const REDIS_CONNECT_TIMEOUT_SECS: u64 = 8;

struct RedisConnectionRow {
    id: String,
    name: String,
    conn_type: String,
    host: String,
    port: u16,
    username: Option<String>,
    password: Option<String>,
    db: u8,
    tls_json: String,
    ssh_json: Option<String>,
    tag: Option<String>,
    created_at: i64,
    updated_at: i64,
    last_connected_at: Option<i64>,
}

pub struct RedisWorkspaceManager {
    db_path: PathBuf,
    connections: Mutex<HashMap<String, RedisConnectionHandle>>,
}

impl RedisWorkspaceManager {
    pub fn new() -> Result<Self, String> {
        let base_dir = dirs::home_dir()
            .ok_or_else(|| "Could not determine home directory.".to_string())?
            .join(".pengvi");

        fs::create_dir_all(&base_dir).map_err(|error| error.to_string())?;

        let manager = Self {
            db_path: base_dir.join("workspace.sqlite3"),
            connections: Mutex::new(HashMap::new()),
        };

        manager.ensure_schema()?;
        Ok(manager)
    }

    pub fn list_connections(&self) -> Result<Vec<RedisConnectionRecord>, String> {
        let connection = self.open_db()?;
        let mut statement = connection
            .prepare(
                "SELECT id, name, conn_type, host, port, username, password, db_index, tls_json, ssh_json, tag, created_at, updated_at, last_connected_at
                 FROM redis_connections
                 ORDER BY updated_at DESC, name COLLATE NOCASE ASC",
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map([], |row| {
                Ok(RedisConnectionRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    conn_type: row.get(2)?,
                    host: row.get(3)?,
                    port: row.get(4)?,
                    username: row.get(5)?,
                    password: row.get(6)?,
                    db: row.get(7)?,
                    tls_json: row.get(8)?,
                    ssh_json: row.get(9)?,
                    tag: row.get(10)?,
                    created_at: row.get(11)?,
                    updated_at: row.get(12)?,
                    last_connected_at: row.get(13)?,
                })
            })
            .map_err(|error| error.to_string())?;

        let connected_ids = self.connected_ids()?;
        let mut connections = Vec::new();
        for row in rows {
            connections.push(self.hydrate_row(row.map_err(|error| error.to_string())?, &connected_ids)?);
        }

        Ok(connections)
    }

    pub fn add_connection(
        &self,
        draft: RedisConnectionDraft,
    ) -> Result<RedisConnectionRecord, String> {
        let validated = sanitize_draft(draft)?;
        let now = now_timestamp_ms()?;
        let record = RedisConnectionRecord {
            id: generate_id(),
            name: validated.name,
            conn_type: validated.conn_type,
            host: validated.host,
            port: validated.port,
            username: validated.username,
            password: validated.password,
            db: validated.db,
            tls: validated.tls,
            ssh: validated.ssh,
            tag: validated.tag,
            created_at: now,
            updated_at: now,
            last_connected_at: None,
            connected: false,
        };
        let tls_json = serde_json::to_string(&record.tls).map_err(|error| error.to_string())?;
        let ssh_json = record
            .ssh
            .as_ref()
            .map(|ssh| serde_json::to_string(ssh).map_err(|error| error.to_string()))
            .transpose()?;

        let connection = self.open_db()?;
        connection
            .execute(
                "INSERT INTO redis_connections (
                    id, name, conn_type, host, port, username, password, db_index, tls_json, ssh_json, tag, created_at, updated_at, last_connected_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    record.id.as_str(),
                    record.name.as_str(),
                    conn_type_to_string(&record.conn_type),
                    record.host.as_str(),
                    record.port,
                    record.username.as_deref(),
                    record.password.as_deref(),
                    record.db,
                    tls_json.as_str(),
                    ssh_json.as_deref(),
                    record.tag.as_deref(),
                    record.created_at,
                    record.updated_at,
                    record.last_connected_at,
                ],
            )
            .map_err(|error| error.to_string())?;

        Ok(record)
    }

    pub fn update_connection(
        &self,
        id: &str,
        draft: RedisConnectionDraft,
    ) -> Result<RedisConnectionRecord, String> {
        let validated = sanitize_draft(draft)?;
        let existing = self.fetch_record(id)?;
        let updated_at = now_timestamp_ms()?;

        let record = RedisConnectionRecord {
            id: existing.id.clone(),
            name: validated.name,
            conn_type: validated.conn_type,
            host: validated.host,
            port: validated.port,
            username: validated.username,
            password: validated.password,
            db: validated.db,
            tls: validated.tls,
            ssh: validated.ssh,
            tag: validated.tag,
            created_at: existing.created_at,
            updated_at,
            last_connected_at: existing.last_connected_at,
            connected: existing.connected,
        };
        let tls_json = serde_json::to_string(&record.tls).map_err(|error| error.to_string())?;
        let ssh_json = record
            .ssh
            .as_ref()
            .map(|ssh| serde_json::to_string(ssh).map_err(|error| error.to_string()))
            .transpose()?;

        let connection = self.open_db()?;
        connection
            .execute(
                "UPDATE redis_connections
                 SET name = ?2, conn_type = ?3, host = ?4, port = ?5, username = ?6, password = ?7,
                     db_index = ?8, tls_json = ?9, ssh_json = ?10, tag = ?11, updated_at = ?12
                 WHERE id = ?1",
                params![
                    record.id.as_str(),
                    record.name.as_str(),
                    conn_type_to_string(&record.conn_type),
                    record.host.as_str(),
                    record.port,
                    record.username.as_deref(),
                    record.password.as_deref(),
                    record.db,
                    tls_json.as_str(),
                    ssh_json.as_deref(),
                    record.tag.as_deref(),
                    record.updated_at,
                ],
            )
            .map_err(|error| error.to_string())?;

        Ok(record)
    }

    pub fn delete_connection(&self, id: &str) -> Result<(), String> {
        self.connections_lock()?.remove(id);

        let connection = self.open_db()?;
        let changed = connection
            .execute("DELETE FROM redis_connections WHERE id = ?1", params![id])
            .map_err(|error| error.to_string())?;

        if changed == 0 {
            return Err(format!("Redis connection `{}` was not found.", id));
        }

        Ok(())
    }

    pub async fn test_connection(&self, draft: RedisConnectionDraft) -> Result<String, String> {
        let config = sanitize_draft(draft)?;
        let (client, _) = self.create_client(&config)?;
        timeout(
            std::time::Duration::from_secs(REDIS_CONNECT_TIMEOUT_SECS),
            async {
                let mut connection = client
                    .get_multiplexed_async_connection()
                    .await
                    .map_err(|error| error.to_string())?;
                let pong: String = redis::cmd("PING")
                    .query_async(&mut connection)
                    .await
                    .map_err(|error| error.to_string())?;
                Ok::<String, String>(pong)
            },
        )
        .await
        .map_err(|_| {
            timeout_message(
                &config.host,
                config.port,
                "test Redis connection",
                REDIS_CONNECT_TIMEOUT_SECS,
            )
        })?
    }

    pub async fn connect(&self, id: &str) -> Result<RedisConnectResponse, String> {
        let config = self.fetch_record(id)?;
        let draft = RedisConnectionDraft {
            name: config.name.clone(),
            conn_type: config.conn_type.clone(),
            host: config.host.clone(),
            port: config.port,
            username: config.username.clone(),
            password: config.password.clone(),
            db: config.db,
            tls: config.tls.clone(),
            ssh: config.ssh.clone(),
            tag: config.tag.clone(),
        };

        let (client, message_suffix) = self.create_client(&draft)?;
        let connection_timeout = timeout(
            std::time::Duration::from_secs(REDIS_CONNECT_TIMEOUT_SECS),
            async {
                let connection = client
                    .get_multiplexed_async_connection()
                    .await
                    .map_err(|error| error.to_string())?;
                let connection = Arc::new(AsyncMutex::new(connection));
                let server_info = fetch_server_info(&connection).await?;
                Ok::<_, String>((connection, server_info))
            },
        )
        .await
        .map_err(|_| {
            timeout_message(
                &draft.host,
                draft.port,
                "connect to Redis",
                REDIS_CONNECT_TIMEOUT_SECS,
            )
        })?;

        let (connection, server_info) = connection_timeout?;

        self.connections_lock()?.insert(
            id.to_string(),
            RedisConnectionHandle {
                connection: connection.clone(),
            },
        );

        let now = now_timestamp_ms()?;
        self.open_db()?
            .execute(
                "UPDATE redis_connections SET last_connected_at = ?2, updated_at = ?3 WHERE id = ?1",
                params![id, now, now],
            )
            .map_err(|error| error.to_string())?;

        Ok(RedisConnectResponse {
            message: format!(
                "Connected to {}:{}{}.",
                config.host,
                config.port,
                message_suffix
            ),
            server_info,
        })
    }

    pub fn disconnect(&self, id: &str) -> Result<(), String> {
        if self.connections_lock()?.remove(id).is_none() {
            return Err(format!("Redis connection `{}` is not active.", id));
        }
        Ok(())
    }

    pub async fn get_server_info(&self, id: &str) -> Result<RedisServerInfo, String> {
        let connection = self
            .connections_lock()?
            .get(id)
            .map(|handle| handle.connection.clone())
            .ok_or_else(|| format!("Redis connection `{}` is not active.", id))?;

        fetch_server_info(&connection).await
    }

    pub async fn select_db(&self, id: &str, db: u8) -> Result<(), String> {
        let connection = self.runtime_connection(id)?;
        let mut connection = connection.lock().await;
        redis::cmd("SELECT")
            .arg(db)
            .query_async::<()>(&mut *connection)
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn db_size(&self, id: &str) -> Result<u64, String> {
        let connection = self.runtime_connection(id)?;
        let mut connection = connection.lock().await;
        redis::cmd("DBSIZE")
            .query_async::<u64>(&mut *connection)
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn scan_keys(
        &self,
        id: &str,
        pattern: &str,
        cursor: &str,
        count: u64,
    ) -> Result<RedisScanResult, String> {
        let connection = self.runtime_connection(id)?;
        let mut connection = connection.lock().await;

        let cursor_value = cursor.parse::<u64>().unwrap_or(0);
        let (new_cursor, raw_keys): (u64, Vec<String>) = redis::cmd("SCAN")
            .arg(cursor_value)
            .arg("MATCH")
            .arg(pattern)
            .arg("COUNT")
            .arg(count)
            .query_async(&mut *connection)
            .await
            .map_err(|error| error.to_string())?;

        if raw_keys.is_empty() {
            return Ok(RedisScanResult {
                cursor: new_cursor.to_string(),
                keys: Vec::new(),
            });
        }

        let mut pipeline = redis::pipe();
        for key in &raw_keys {
            pipeline.cmd("TYPE").arg(key);
            pipeline.cmd("TTL").arg(key);
        }

        let results: Vec<Value> = pipeline
            .query_async(&mut *connection)
            .await
            .map_err(|error| error.to_string())?;

        let mut keys = Vec::with_capacity(raw_keys.len());
        for (index, key) in raw_keys.iter().enumerate() {
            let key_type = match &results[index * 2] {
                Value::SimpleString(value) => value.clone(),
                Value::BulkString(value) => String::from_utf8_lossy(value).to_string(),
                _ => "unknown".to_string(),
            };
            let ttl = match &results[index * 2 + 1] {
                Value::Int(value) => *value,
                _ => -1,
            };

            keys.push(RedisKeyInfo {
                key: key.clone(),
                key_type,
                ttl,
            });
        }

        Ok(RedisScanResult {
            cursor: new_cursor.to_string(),
            keys,
        })
    }

    pub async fn get_key_info(&self, id: &str, key: &str) -> Result<RedisKeyInfo, String> {
        let connection = self.runtime_connection(id)?;
        let mut connection = connection.lock().await;

        let key_type: String = redis::cmd("TYPE")
            .arg(key)
            .query_async(&mut *connection)
            .await
            .map_err(|error| error.to_string())?;
        let ttl: i64 = connection.ttl(key).await.map_err(|error| error.to_string())?;

        Ok(RedisKeyInfo {
            key: key.to_string(),
            key_type,
            ttl,
        })
    }

    pub async fn get_key_value(&self, id: &str, key: &str) -> Result<RedisKeyValue, String> {
        let connection = self.runtime_connection(id)?;
        let mut connection = connection.lock().await;

        let key_type: String = redis::cmd("TYPE")
            .arg(key)
            .query_async(&mut *connection)
            .await
            .map_err(|error| error.to_string())?;

        match key_type.as_str() {
            "string" => {
                let value: String = connection.get(key).await.map_err(|error| error.to_string())?;
                Ok(RedisKeyValue::String(value))
            }
            "hash" => {
                let fields: Vec<(String, String)> =
                    connection.hgetall(key).await.map_err(|error| error.to_string())?;
                Ok(RedisKeyValue::Hash(
                    fields
                        .into_iter()
                        .map(|(field, value)| RedisHashField { field, value })
                        .collect(),
                ))
            }
            "list" => {
                let values: Vec<String> =
                    connection.lrange(key, 0, -1).await.map_err(|error| error.to_string())?;
                Ok(RedisKeyValue::List(values))
            }
            "set" => {
                let values: Vec<String> =
                    connection.smembers(key).await.map_err(|error| error.to_string())?;
                Ok(RedisKeyValue::Set(values))
            }
            "zset" => {
                let members: Vec<(String, f64)> = connection
                    .zrange_withscores(key, 0, -1)
                    .await
                    .map_err(|error| error.to_string())?;
                Ok(RedisKeyValue::ZSet(
                    members
                        .into_iter()
                        .map(|(member, score)| RedisZSetMember { member, score })
                        .collect(),
                ))
            }
            _ => Ok(RedisKeyValue::None),
        }
    }

    pub async fn set_key_value(
        &self,
        id: &str,
        key: &str,
        value: RedisKeyValue,
        ttl: Option<i64>,
    ) -> Result<(), String> {
        let connection = self.runtime_connection(id)?;
        let mut connection = connection.lock().await;

        match value {
            RedisKeyValue::String(data) => {
                connection
                    .set::<_, _, ()>(key, data)
                    .await
                    .map_err(|error| error.to_string())?;
            }
            RedisKeyValue::Hash(fields) => {
                connection.del::<_, ()>(key).await.map_err(|error| error.to_string())?;
                for field in fields {
                    connection
                        .hset::<_, _, _, ()>(key, field.field, field.value)
                        .await
                        .map_err(|error| error.to_string())?;
                }
            }
            RedisKeyValue::List(items) => {
                connection.del::<_, ()>(key).await.map_err(|error| error.to_string())?;
                for item in items {
                    connection
                        .rpush::<_, _, ()>(key, item)
                        .await
                        .map_err(|error| error.to_string())?;
                }
            }
            RedisKeyValue::Set(items) => {
                connection.del::<_, ()>(key).await.map_err(|error| error.to_string())?;
                for item in items {
                    connection
                        .sadd::<_, _, ()>(key, item)
                        .await
                        .map_err(|error| error.to_string())?;
                }
            }
            RedisKeyValue::ZSet(items) => {
                connection.del::<_, ()>(key).await.map_err(|error| error.to_string())?;
                for item in items {
                    connection
                        .zadd::<_, _, _, ()>(key, item.member, item.score)
                        .await
                        .map_err(|error| error.to_string())?;
                }
            }
            RedisKeyValue::None => {}
        }

        if let Some(ttl_value) = ttl {
            if ttl_value > 0 {
                connection
                    .expire::<_, ()>(key, ttl_value)
                    .await
                    .map_err(|error| error.to_string())?;
            } else if ttl_value <= 0 {
                connection
                    .persist::<_, ()>(key)
                    .await
                    .map_err(|error| error.to_string())?;
            }
        }

        Ok(())
    }

    pub async fn delete_keys(&self, id: &str, keys: Vec<String>) -> Result<u64, String> {
        let connection = self.runtime_connection(id)?;
        let mut connection = connection.lock().await;
        connection.del(keys).await.map_err(|error| error.to_string())
    }

    pub async fn rename_key(&self, id: &str, old_key: &str, new_key: &str) -> Result<(), String> {
        let connection = self.runtime_connection(id)?;
        let mut connection = connection.lock().await;
        connection
            .rename::<_, _, ()>(old_key, new_key)
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn set_ttl(&self, id: &str, key: &str, ttl: i64) -> Result<(), String> {
        let connection = self.runtime_connection(id)?;
        let mut connection = connection.lock().await;

        if ttl > 0 {
            connection
                .expire::<_, ()>(key, ttl)
                .await
                .map_err(|error| error.to_string())?;
        } else {
            connection
                .persist::<_, ()>(key)
                .await
                .map_err(|error| error.to_string())?;
        }

        Ok(())
    }

    pub async fn execute_command(&self, id: &str, command: &str) -> Result<String, String> {
        let trimmed = command.trim();
        if trimmed.is_empty() {
            return Ok(String::new());
        }

        let connection = self.runtime_connection(id)?;
        let mut connection = connection.lock().await;
        let parts: Vec<&str> = trimmed.split_whitespace().collect();

        if parts.is_empty() {
            return Ok(String::new());
        }

        let mut redis_command = redis::cmd(parts[0]);
        for part in &parts[1..] {
            redis_command.arg(*part);
        }

        let result: Value = redis_command
            .query_async(&mut *connection)
            .await
            .map_err(|error| error.to_string())?;

        Ok(format_redis_value(&result, 0))
    }

    fn ensure_schema(&self) -> Result<(), String> {
        self.open_db()?
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS redis_connections (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    conn_type TEXT NOT NULL,
                    host TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    username TEXT,
                    password TEXT,
                    db_index INTEGER NOT NULL DEFAULT 0,
                    tls_json TEXT NOT NULL,
                    ssh_json TEXT,
                    tag TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    last_connected_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_redis_connections_updated_at
                    ON redis_connections(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_redis_connections_name
                    ON redis_connections(name COLLATE NOCASE);",
            )
            .map_err(|error| error.to_string())
    }

    fn open_db(&self) -> Result<Connection, String> {
        Connection::open(&self.db_path).map_err(|error| error.to_string())
    }

    fn fetch_record(&self, id: &str) -> Result<RedisConnectionRecord, String> {
        let connection = self.open_db()?;
        let row = connection
            .query_row(
                "SELECT id, name, conn_type, host, port, username, password, db_index, tls_json, ssh_json, tag, created_at, updated_at, last_connected_at
                 FROM redis_connections
                 WHERE id = ?1",
                params![id],
                |row| {
                    Ok(RedisConnectionRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        conn_type: row.get(2)?,
                        host: row.get(3)?,
                        port: row.get(4)?,
                        username: row.get(5)?,
                        password: row.get(6)?,
                        db: row.get(7)?,
                        tls_json: row.get(8)?,
                        ssh_json: row.get(9)?,
                        tag: row.get(10)?,
                        created_at: row.get(11)?,
                        updated_at: row.get(12)?,
                        last_connected_at: row.get(13)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("Redis connection `{}` was not found.", id))?;

        self.hydrate_row(row, &self.connected_ids()?)
    }

    fn hydrate_row(
        &self,
        row: RedisConnectionRow,
        connected_ids: &[String],
    ) -> Result<RedisConnectionRecord, String> {
        let tls = serde_json::from_str::<RedisTlsConfig>(&row.tls_json)
            .unwrap_or_else(|_| RedisTlsConfig::default());
        let ssh = row
            .ssh_json
            .as_deref()
            .map(serde_json::from_str::<RedisSshConfig>)
            .transpose()
            .map_err(|error| error.to_string())?;

        Ok(RedisConnectionRecord {
            id: row.id.clone(),
            name: row.name,
            conn_type: conn_type_from_string(&row.conn_type)?,
            host: row.host,
            port: row.port,
            username: row.username,
            password: row.password,
            db: row.db,
            tls,
            ssh,
            tag: row.tag,
            created_at: row.created_at,
            updated_at: row.updated_at,
            last_connected_at: row.last_connected_at,
            connected: connected_ids.iter().any(|value| value == &row.id),
        })
    }

    fn create_client(&self, config: &RedisConnectionDraft) -> Result<(Client, String), String> {
        if config.ssh.is_some() {
            return Err(
                "SSH tunneling from Raven is not wired into Penguin yet. Save the connection without SSH for now."
                    .to_string(),
            );
        }

        let scheme = if config.tls.enabled { "rediss" } else { "redis" };
        let auth = match (&config.username, &config.password) {
            (Some(username), Some(password)) if !username.trim().is_empty() => {
                format!("{}:{}@", username.trim(), password)
            }
            (None, Some(password)) | (Some(_), Some(password)) => format!(":{}@", password),
            _ => String::new(),
        };

        let url = match config.conn_type {
            RedisConnType::Cluster => {
                format!("{}://{}{}:{}", scheme, auth, config.host, config.port)
            }
            RedisConnType::Standalone | RedisConnType::Sentinel => {
                format!(
                    "{}://{}{}:{}/{}",
                    scheme, auth, config.host, config.port, config.db
                )
            }
        };

        let client = Client::open(url.as_str()).map_err(|error| error.to_string())?;
        let message_suffix = if config.conn_type == RedisConnType::Cluster {
            " (cluster mode)"
        } else if config.conn_type == RedisConnType::Sentinel {
            " (sentinel mode)"
        } else {
            ""
        };

        Ok((client, message_suffix.to_string()))
    }

    fn connections_lock(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, HashMap<String, RedisConnectionHandle>>, String> {
        self.connections
            .lock()
            .map_err(|_| "Redis runtime state is unavailable right now.".to_string())
    }

    fn connected_ids(&self) -> Result<Vec<String>, String> {
        Ok(self.connections_lock()?.keys().cloned().collect())
    }

    fn runtime_connection(&self, id: &str) -> Result<Arc<AsyncMutex<MultiplexedConnection>>, String> {
        self.connections_lock()?
            .get(id)
            .map(|handle| handle.connection.clone())
            .ok_or_else(|| format!("Redis connection `{}` is not active.", id))
    }
}

fn sanitize_draft(draft: RedisConnectionDraft) -> Result<RedisConnectionDraft, String> {
    let name = draft.name.trim();
    if name.is_empty() {
        return Err("Connection name is required.".to_string());
    }

    let host = draft.host.trim();
    if host.is_empty() {
        return Err("Redis host is required.".to_string());
    }

    Ok(RedisConnectionDraft {
        name: name.to_string(),
        conn_type: draft.conn_type,
        host: host.to_string(),
        port: draft.port,
        username: draft
            .username
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        password: draft.password.filter(|value| !value.is_empty()),
        db: draft.db,
        tls: draft.tls,
        ssh: draft.ssh,
        tag: draft
            .tag
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    })
}

fn conn_type_to_string(value: &RedisConnType) -> &'static str {
    match value {
        RedisConnType::Standalone => "standalone",
        RedisConnType::Cluster => "cluster",
        RedisConnType::Sentinel => "sentinel",
    }
}

fn conn_type_from_string(value: &str) -> Result<RedisConnType, String> {
    match value {
        "standalone" => Ok(RedisConnType::Standalone),
        "cluster" => Ok(RedisConnType::Cluster),
        "sentinel" => Ok(RedisConnType::Sentinel),
        other => Err(format!("Unsupported Redis connection type `{}`.", other)),
    }
}

fn generate_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("redis-{}-{}", nanos, std::process::id())
}

fn now_timestamp_ms() -> Result<i64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64)
}

async fn fetch_server_info(
    connection: &Arc<AsyncMutex<MultiplexedConnection>>,
) -> Result<RedisServerInfo, String> {
    let mut connection = connection.lock().await;
    let info_string: String = redis::cmd("INFO")
        .query_async(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;

    let field = |name: &str| -> String {
        info_string
            .lines()
            .find(|line| line.starts_with(name))
            .and_then(|line| line.split_once(':').map(|(_, value)| value.trim().to_string()))
            .unwrap_or_default()
    };

    let mut db_info = Vec::new();
    let mut total_keys = 0;

    for line in info_string.lines() {
        if let Some(db_line) = line.strip_prefix("db") {
            if let Some((db_number, metrics)) = db_line.split_once(':') {
                if let Ok(db) = db_number.parse::<u8>() {
                    let keys = metrics
                        .split(',')
                        .find_map(|part| part.strip_prefix("keys="))
                        .and_then(|value| value.parse::<u64>().ok())
                        .unwrap_or(0);

                    total_keys += keys;
                    db_info.push(RedisDbInfo { db, keys });
                }
            }
        }
    }

    Ok(RedisServerInfo {
        redis_version: field("redis_version"),
        used_memory_human: field("used_memory_human"),
        used_memory: field("used_memory").parse().unwrap_or(0),
        connected_clients: field("connected_clients"),
        connected_clients_count: field("connected_clients").parse().unwrap_or(0),
        total_keys,
        uptime_in_seconds: field("uptime_in_seconds"),
        instantaneous_ops_per_sec: field("instantaneous_ops_per_sec").parse().unwrap_or(0),
        keyspace_hits: field("keyspace_hits").parse().unwrap_or(0),
        keyspace_misses: field("keyspace_misses").parse().unwrap_or(0),
        total_commands_processed: field("total_commands_processed").parse().unwrap_or(0),
        db_info,
    })
}

fn format_redis_value(value: &Value, indent: usize) -> String {
    let prefix = " ".repeat(indent);

    match value {
        Value::Nil => format!("{}(nil)", prefix),
        Value::Int(number) => format!("{}(integer) {}", prefix, number),
        Value::BulkString(bytes) => match String::from_utf8(bytes.clone()) {
            Ok(text) => format!("{}\"{}\"", prefix, text),
            Err(_) => format!("{}(binary data, {} bytes)", prefix, bytes.len()),
        },
        Value::Array(items) => {
            if items.is_empty() {
                return format!("{}(empty array)", prefix);
            }

            items
                .iter()
                .enumerate()
                .map(|(index, item)| {
                    format!(
                        "{}{}) {}",
                        prefix,
                        index + 1,
                        format_redis_value(item, 0)
                    )
                })
                .collect::<Vec<_>>()
                .join("\n")
        }
        Value::SimpleString(text) => format!("{}{}", prefix, text),
        Value::Okay => format!("{}OK", prefix),
        Value::Map(entries) => entries
            .iter()
            .enumerate()
            .map(|(index, (key, item))| {
                format!(
                    "{}{}) {} -> {}",
                    prefix,
                    index + 1,
                    format_redis_value(key, 0),
                    format_redis_value(item, 0)
                )
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => format!("{}{:?}", prefix, value),
    }
}

fn timeout_message(host: &str, port: u16, action: &str, seconds: u64) -> String {
    format!(
        "Timed out after {}s while trying to {} at {}:{}.",
        seconds, action, host, port
    )
}
