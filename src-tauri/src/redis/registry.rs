// ---------------------------------------------------------------------------
// Multi-connection registry + MONITOR spike (Foundation vertical slice)
//
// This module is the prototype for the Tiny-RDM-parity rebuild. It proves three
// foundation decisions WITHOUT disturbing the existing single-connection module:
//   F1  multiple live connections held in a registry keyed by ConnectionId,
//       each cloned out under a SHORT read lock (the fred client is Clone +
//       internally Arc) so a long SCAN on one tab never blocks another.
//   F3  MONITOR runs on a DEDICATED raw-TCP bypass connection while the fred
//       command pool keeps serving normal commands concurrently.
//       SPIKE FINDING: fred 9's native `monitor` feature does NOT compile with
//       `enable-rustls-ring` (fred's monitor/utils.rs has a non-exhaustive match
//       missing ConnectionKind::Rustls). So we keep rustls for the main client
//       and isolate MONITOR on a hand-rolled RESP reader over tokio TcpStream —
//       exactly the "side connection, main architecture untouched" fallback.
//       (Limitation: this bypass is plaintext TCP; TLS MONITOR would need a
//       rustls stream — deferred, not needed for the prototype.)
//   db-per-request routing: every routed command takes (connectionId, db) and
//       SELECTs explicitly — the backend keeps NO "current db" state of its own.
// ---------------------------------------------------------------------------

use super::connection::{
    db_create_group, db_delete_connection, db_delete_group, db_get_connection_full,
    db_list_connections_full, db_list_groups, db_load_connection_password,
    db_save_connection_full, SaveConnectionInput, SavedConnectionFull,
};
use super::stats::{parse_info, RedisStats};
use fred::prelude::*;
use fred::types::{ClusterHash, CustomCommand, Server, TlsConnector};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Runtime, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

/// One live connection. Holds the fred client (cheap to clone out) plus the
/// centralized config so MONITOR can spin its own dedicated connection.
pub struct ConnectionInstance {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub client: RedisClient,
    pub config: RedisConfig,
    /// Per-connection MONITOR cancellation. `None` = not monitoring.
    pub monitor_cancel: RwLock<Option<CancellationToken>>,
    /// Per-connection Pub/Sub subscription cancellation. `None` = not subscribed.
    pub pubsub_cancel: RwLock<Option<CancellationToken>>,
}

/// Multi-connection registry — replaces the single-connection global model.
/// The map lock only guards instance add/remove + lookup; the fred client is
/// cloned out under a short read lock so a long SCAN never blocks other tabs.
#[derive(Default)]
pub struct RedisRegistry {
    instances: RwLock<HashMap<String, Arc<ConnectionInstance>>>,
}

impl RedisRegistry {
    /// Clone the fred client for a connection (used by the keys module).
    pub async fn client_for(&self, id: &str) -> Result<RedisClient, String> {
        self.get(id).await.map(|instance| instance.client.clone())
    }

    async fn get(&self, id: &str) -> Result<Arc<ConnectionInstance>, String> {
        // WHY: clone the Arc out under a short read lock, then release — the
        // caller runs its (possibly long) command without holding the map lock.
        let guard = self.instances.read().await;
        match guard.get(id) {
            Some(inst) => Ok(inst.clone()),
            None => Err(format!("connection not found: {id}")),
        }
    }
}

// ---------------------------------------------------------------------------
// Advanced connection config — deployment (standalone/sentinel/cluster) + TLS
// Parsed from the connection's opaque `config_json`. (Phase 2a)
// ---------------------------------------------------------------------------

#[derive(Default, serde::Deserialize)]
struct NodeOpt {
    #[serde(default)]
    host: String,
    #[serde(default)]
    port: u16,
}

#[derive(Default, serde::Deserialize)]
struct TlsOpt {
    #[serde(default)]
    enabled: bool,
}

#[derive(Default, serde::Deserialize)]
struct SentinelOpt {
    #[serde(default)]
    master: String,
    #[serde(default)]
    nodes: Vec<NodeOpt>,
    #[serde(default)]
    password: String,
}

#[derive(Default, serde::Deserialize)]
struct ClusterOpt {
    #[serde(default)]
    nodes: Vec<NodeOpt>,
}

#[derive(Default, serde::Deserialize)]
struct AdvancedConfig {
    #[serde(default)]
    deployment: String,
    #[serde(default)]
    tls: TlsOpt,
    #[serde(default)]
    sentinel: SentinelOpt,
    #[serde(default)]
    cluster: ClusterOpt,
}

/// Build a fred RedisConfig from the stored fields + advanced `config_json`.
/// Shared by open + test so both honour deployment mode and TLS identically.
fn build_redis_config(
    host: &str,
    port: u16,
    db: u8,
    username: &str,
    password: &str,
    config_json: &str,
) -> Result<RedisConfig, String> {
    let raw = if config_json.trim().is_empty() {
        "{}"
    } else {
        config_json
    };
    let adv: AdvancedConfig = serde_json::from_str(raw).map_err(|e| e.to_string())?;

    let server = match adv.deployment.as_str() {
        "sentinel" => {
            let mut hosts: Vec<Server> = adv
                .sentinel
                .nodes
                .iter()
                .filter(|node| !node.host.is_empty())
                .map(|node| Server::new(node.host.clone(), node.port))
                .collect();
            // WHY: fall back to the primary host as the single sentinel seed.
            if hosts.is_empty() {
                hosts.push(Server::new(host.to_string(), port));
            }
            // NOTE: fred 9.4 Sentinel variant only carries hosts + service_name.
            // Sentinel-specific auth (separate from data-node password) is a later
            // refinement; the connection password still applies to the data nodes.
            ServerConfig::Sentinel {
                hosts,
                service_name: if adv.sentinel.master.is_empty() {
                    "mymaster".to_string()
                } else {
                    adv.sentinel.master.clone()
                },
            }
        }
        "cluster" => {
            let mut nodes: Vec<(String, u16)> = adv
                .cluster
                .nodes
                .iter()
                .filter(|node| !node.host.is_empty())
                .map(|node| (node.host.clone(), node.port))
                .collect();
            // WHY: one reachable seed is enough — fred discovers the rest via CLUSTER NODES.
            if nodes.is_empty() {
                nodes.push((host.to_string(), port));
            }
            ServerConfig::new_clustered(nodes)
        }
        _ => ServerConfig::new_centralized(host, port),
    };

    // WHY: default rustls TLS (system roots) when enabled. Custom CA / mTLS /
    // skip-verify need a hand-built rustls connector — deferred to a later pass.
    let tls = if adv.tls.enabled {
        Some(TlsConnector::default_rustls().map_err(|e| e.to_string())?.into())
    } else {
        None
    };

    Ok(RedisConfig {
        server,
        username: if username.is_empty() {
            None
        } else {
            Some(username.to_string())
        },
        password: if password.is_empty() {
            None
        } else {
            Some(password.to_string())
        },
        database: Some(db),
        tls,
        ..Default::default()
    })
}

// ---------------------------------------------------------------------------
// Connect / list / disconnect
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct RegistryConnectResult {
    pub ok: bool,
    pub id: String,
    pub latency_ms: u64,
    pub error: Option<String>,
}

#[derive(serde::Serialize)]
pub struct LiveConnection {
    pub id: String,
    pub label: String,
    pub host: String,
    pub port: u16,
}

#[tauri::command]
pub async fn redis_reg_connect(
    id: String,
    label: String,
    host: String,
    port: u16,
    password: String,
    db: u8,
    registry: State<'_, RedisRegistry>,
) -> Result<RegistryConnectResult, String> {
    let config = RedisConfig {
        server: ServerConfig::new_centralized(&host, port),
        password: if password.is_empty() {
            None
        } else {
            Some(password)
        },
        database: Some(db),
        ..Default::default()
    };

    let client = Builder::from_config(config.clone())
        .build()
        .map_err(|e| e.to_string())?;

    let t0 = Instant::now();
    client.init().await.map_err(|e| e.to_string())?;

    match client.ping::<()>().await {
        Ok(_) => {
            let latency_ms = t0.elapsed().as_millis() as u64;
            let instance = Arc::new(ConnectionInstance {
                id: id.clone(),
                label,
                host,
                port,
                client,
                config,
                monitor_cancel: RwLock::new(None),
                pubsub_cancel: RwLock::new(None),
            });
            registry
                .instances
                .write()
                .await
                .insert(id.clone(), instance);
            Ok(RegistryConnectResult {
                ok: true,
                id,
                latency_ms,
                error: None,
            })
        }
        Err(e) => {
            // WHY: ping failed — tear the half-open client down, do not register it.
            let _ = client.quit().await;
            Ok(RegistryConnectResult {
                ok: false,
                id,
                latency_ms: 0,
                error: Some(e.to_string()),
            })
        }
    }
}

#[tauri::command]
pub async fn redis_reg_list(
    registry: State<'_, RedisRegistry>,
) -> Result<Vec<LiveConnection>, String> {
    let guard = registry.instances.read().await;
    let list = guard
        .values()
        .map(|inst| LiveConnection {
            id: inst.id.clone(),
            label: inst.label.clone(),
            host: inst.host.clone(),
            port: inst.port,
        })
        .collect();
    Ok(list)
}

#[tauri::command]
pub async fn redis_reg_disconnect(
    id: String,
    registry: State<'_, RedisRegistry>,
) -> Result<(), String> {
    // WHY: explicit disconnect (no auto-GC) — remove from map, stop MONITOR, quit.
    let removed = registry.instances.write().await.remove(&id);
    match removed {
        Some(inst) => {
            if let Some(token) = inst.monitor_cancel.write().await.take() {
                token.cancel();
            }
            let _ = inst.client.quit().await;
            Ok(())
        }
        None => {
            // WHY: not found is non-fatal — the connection is already gone.
            Ok(())
        }
    }
}

// ---------------------------------------------------------------------------
// Import / Export connection config (Phase 7) — metadata only, no secrets.
// WHY: passwords live in the OS keychain and are never exported; importing a
// bundle re-creates connections/groups and the user re-enters passwords.
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ExportedConnection {
    pub label: String,
    pub group_name: String,
    pub conn_type: String,
    pub host: String,
    pub port: u16,
    pub db: u8,
    pub username: String,
    pub config_json: String,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct ExportBundle {
    pub groups: Vec<String>,
    pub connections: Vec<ExportedConnection>,
}

#[tauri::command]
pub async fn redis_conn_export() -> Result<String, String> {
    let connections = db_list_connections_full()?
        .into_iter()
        .map(|c| ExportedConnection {
            label: c.label,
            group_name: c.group_name,
            conn_type: c.conn_type,
            host: c.host,
            port: c.port,
            db: c.db,
            username: c.username,
            config_json: c.config_json,
        })
        .collect();
    let bundle = ExportBundle {
        groups: db_list_groups()?,
        connections,
    };
    serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn redis_conn_import(payload: String) -> Result<usize, String> {
    let bundle: ExportBundle = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    for group in &bundle.groups {
        // WHY: pre-create groups so connections can reference them; ignore dup errors.
        let _ = db_create_group(group);
    }
    let mut imported = 0usize;
    for connection in bundle.connections {
        db_save_connection_full(SaveConnectionInput {
            id: None,
            label: connection.label,
            group_name: connection.group_name,
            conn_type: connection.conn_type,
            host: connection.host,
            port: connection.port,
            db: connection.db,
            username: connection.username,
            password: None,
            config_json: connection.config_json,
        })?;
        imported += 1;
    }
    Ok(imported)
}

// ---------------------------------------------------------------------------
// Connection Manager — persisted address book (groups + saved connections)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_conn_list_full() -> Result<Vec<SavedConnectionFull>, String> {
    db_list_connections_full()
}

#[tauri::command]
pub async fn redis_group_list() -> Result<Vec<String>, String> {
    db_list_groups()
}

#[tauri::command]
pub async fn redis_group_create(name: String) -> Result<(), String> {
    db_create_group(&name)
}

#[tauri::command]
pub async fn redis_group_delete(name: String) -> Result<(), String> {
    db_delete_group(&name)
}

#[tauri::command]
pub async fn redis_conn_save(input: SaveConnectionInput) -> Result<String, String> {
    db_save_connection_full(input)
}

#[tauri::command]
pub async fn redis_conn_delete(
    id: String,
    registry: State<'_, RedisRegistry>,
) -> Result<(), String> {
    // WHY: if the saved connection is currently open, tear the live instance down too.
    let removed = registry.instances.write().await.remove(&id);
    if let Some(instance) = removed {
        if let Some(token) = instance.monitor_cancel.write().await.take() {
            token.cancel();
        }
        let _ = instance.client.quit().await;
    }
    db_delete_connection(&id)
}

#[tauri::command]
pub async fn redis_conn_open(
    id: String,
    registry: State<'_, RedisRegistry>,
) -> Result<RegistryConnectResult, String> {
    let full = db_get_connection_full(&id)?;
    let password = db_load_connection_password(&id)?.unwrap_or_default();

    let config = build_redis_config(
        &full.host,
        full.port,
        full.db,
        &full.username,
        &password,
        &full.config_json,
    )?;
    connect_and_register(&registry, full.id.clone(), full.label, full.host.clone(), full.port, config)
        .await
}

#[derive(serde::Deserialize)]
pub struct TestConnectionInput {
    pub host: String,
    pub port: u16,
    pub db: u8,
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub config_json: String,
}

#[tauri::command]
pub async fn redis_conn_test(
    input: TestConnectionInput,
) -> Result<RegistryConnectResult, String> {
    let config = build_redis_config(
        &input.host,
        input.port,
        input.db,
        &input.username,
        &input.password,
        &input.config_json,
    )?;
    let client = Builder::from_config(config)
        .build()
        .map_err(|e| e.to_string())?;
    let t0 = Instant::now();
    if let Err(err) = client.init().await {
        return Ok(RegistryConnectResult {
            ok: false,
            id: String::new(),
            latency_ms: 0,
            error: Some(err.to_string()),
        });
    }
    let result = match client.ping::<()>().await {
        Ok(_) => RegistryConnectResult {
            ok: true,
            id: String::new(),
            latency_ms: t0.elapsed().as_millis() as u64,
            error: None,
        },
        Err(err) => RegistryConnectResult {
            ok: false,
            id: String::new(),
            latency_ms: 0,
            error: Some(err.to_string()),
        },
    };
    let _ = client.quit().await;
    Ok(result)
}

/// Shared connect-and-insert path used by `redis_conn_open`.
async fn connect_and_register(
    registry: &State<'_, RedisRegistry>,
    id: String,
    label: String,
    host: String,
    port: u16,
    config: RedisConfig,
) -> Result<RegistryConnectResult, String> {
    let client = Builder::from_config(config.clone())
        .build()
        .map_err(|e| e.to_string())?;
    let t0 = Instant::now();
    client.init().await.map_err(|e| e.to_string())?;
    match client.ping::<()>().await {
        Ok(_) => {
            let latency_ms = t0.elapsed().as_millis() as u64;
            let instance = Arc::new(ConnectionInstance {
                id: id.clone(),
                label,
                host,
                port,
                client,
                config,
                monitor_cancel: RwLock::new(None),
                pubsub_cancel: RwLock::new(None),
            });
            registry
                .instances
                .write()
                .await
                .insert(id.clone(), instance);
            Ok(RegistryConnectResult {
                ok: true,
                id,
                latency_ms,
                error: None,
            })
        }
        Err(err) => {
            let _ = client.quit().await;
            Ok(RegistryConnectResult {
                ok: false,
                id,
                latency_ms: 0,
                error: Some(err.to_string()),
            })
        }
    }
}

// ---------------------------------------------------------------------------
// Routed command proof — DBSIZE on (connectionId, db)
// Proves: command routes by connectionId AND db; backend holds no "current db".
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
pub struct RoutedDbSize {
    pub id: String,
    pub db: u8,
    pub dbsize: u64,
    pub latency_ms: u64,
}

#[tauri::command]
pub async fn redis_reg_dbsize(
    id: String,
    db: u8,
    registry: State<'_, RedisRegistry>,
) -> Result<RoutedDbSize, String> {
    let instance = registry.get(&id).await?;
    let client = instance.client.clone();

    let t0 = Instant::now();
    // WHY: SELECT the requested db first — the db comes from the caller (tab),
    // never from backend state. RedisClient is a single connection so SELECT
    // reliably pins the subsequent DBSIZE to the same db.
    let select = CustomCommand::new_static("SELECT", ClusterHash::FirstKey, false);
    let _: RedisValue = client
        .custom(select, vec![db.to_string()])
        .await
        .map_err(|e| e.to_string())?;

    let dbsize: u64 = client.dbsize().await.map_err(|e| e.to_string())?;

    Ok(RoutedDbSize {
        id,
        db,
        dbsize,
        latency_ms: t0.elapsed().as_millis() as u64,
    })
}

// ---------------------------------------------------------------------------
// Status — INFO on a registry connection (reuses the existing parse_info asset)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_reg_info(
    id: String,
    registry: State<'_, RedisRegistry>,
) -> Result<RedisStats, String> {
    let instance = registry.get(&id).await?;
    let client = instance.client.clone();
    let info_cmd = CustomCommand::new_static("INFO", ClusterHash::FirstKey, false);
    let raw: String = client
        .custom(info_cmd, Vec::<String>::new())
        .await
        .map_err(|e| e.to_string())?;
    Ok(parse_info(&raw))
}

// ---------------------------------------------------------------------------
// MONITOR spike — dedicated connection, streams to the frontend via events
// Event name: `redis://monitor/{connectionId}` — payload is each command line.
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn redis_reg_monitor_start<R: Runtime>(
    id: String,
    app: AppHandle<R>,
    registry: State<'_, RedisRegistry>,
) -> Result<(), String> {
    let instance = registry.get(&id).await?;

    // WHY: refuse a second MONITOR on the same connection — one stream per conn.
    {
        let guard = instance.monitor_cancel.read().await;
        if guard.is_some() {
            return Err("MONITOR already running on this connection".to_string());
        }
    }

    let token = CancellationToken::new();
    *instance.monitor_cancel.write().await = Some(token.clone());

    // WHY: MONITOR locks its connection into a one-way stream, so it gets its OWN
    // raw-TCP bypass connection — the fred command pool stays free for CRUD.
    let host = instance.host.clone();
    let port = instance.port;
    let password = instance.config.password.clone();
    let event = format!("redis://monitor/{id}");

    tokio::spawn(async move {
        let stream = match TcpStream::connect((host.as_str(), port)).await {
            Ok(stream) => stream,
            Err(err) => {
                let _ = app.emit(&event, format!("MONITOR connect error: {err}"));
                return;
            }
        };
        let (read_half, mut write_half) = stream.into_split();

        // WHY: authenticate first when the server needs a password, else MONITOR
        // is rejected with NOAUTH.
        if let Some(pw) = password {
            let auth = format!("AUTH {pw}\r\n");
            if let Err(err) = write_half.write_all(auth.as_bytes()).await {
                let _ = app.emit(&event, format!("MONITOR auth error: {err}"));
                return;
            }
        }
        if let Err(err) = write_half.write_all(b"MONITOR\r\n").await {
            let _ = app.emit(&event, format!("MONITOR start error: {err}"));
            return;
        }

        let mut reader = BufReader::new(read_half);
        let mut line = String::new();
        loop {
            line.clear();
            tokio::select! {
                _ = token.cancelled() => break,
                read = reader.read_line(&mut line) => match read {
                    Ok(0) => break,
                    Ok(_) => {
                        // WHY: MONITOR replies are RESP simple strings ("+...") —
                        // strip the marker + CRLF; skip the initial "+OK" ack.
                        let trimmed = line.trim_end();
                        let cleaned = trimmed.strip_prefix('+').unwrap_or(trimmed);
                        if cleaned == "OK" {
                            continue;
                        }
                        let _ = app.emit(&event, cleaned.to_string());
                    }
                    Err(err) => {
                        let _ = app.emit(&event, format!("MONITOR read error: {err}"));
                        break;
                    }
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn redis_reg_monitor_stop(
    id: String,
    registry: State<'_, RedisRegistry>,
) -> Result<(), String> {
    let instance = registry.get(&id).await?;
    if let Some(token) = instance.monitor_cancel.write().await.take() {
        token.cancel();
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Pub/Sub — dedicated raw-TCP subscriber connection; emits redis://pubsub/{id}
// (Same bypass-connection pattern as MONITOR. Line-based parse assumes text
// payloads — binary payloads with embedded CRLF are a later refinement.)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn reg_pubsub_start<R: Runtime>(
    id: String,
    channel: String,
    app: AppHandle<R>,
    registry: State<'_, RedisRegistry>,
) -> Result<(), String> {
    let instance = registry.get(&id).await?;
    {
        let guard = instance.pubsub_cancel.read().await;
        if guard.is_some() {
            return Err("已有订阅在运行".to_string());
        }
    }
    let token = CancellationToken::new();
    *instance.pubsub_cancel.write().await = Some(token.clone());

    let host = instance.host.clone();
    let port = instance.port;
    let password = instance.config.password.clone();
    let event = format!("redis://pubsub/{id}");
    let is_pattern = channel.contains('*');

    tokio::spawn(async move {
        let stream = match TcpStream::connect((host.as_str(), port)).await {
            Ok(stream) => stream,
            Err(err) => {
                let _ = app.emit(&event, format!("订阅连接失败: {err}"));
                return;
            }
        };
        let (read_half, mut write_half) = stream.into_split();
        if let Some(pw) = password {
            let _ = write_half.write_all(format!("AUTH {pw}\r\n").as_bytes()).await;
        }
        let sub_cmd = if is_pattern { "PSUBSCRIBE" } else { "SUBSCRIBE" };
        if let Err(err) = write_half
            .write_all(format!("{sub_cmd} {channel}\r\n").as_bytes())
            .await
        {
            let _ = app.emit(&event, format!("订阅失败: {err}"));
            return;
        }

        let mut reader = BufReader::new(read_half);
        let mut line = String::new();
        // WHY: collect RESP bulk-string data lines; skip *N / $N / :N markers.
        let mut data: Vec<String> = Vec::new();
        loop {
            line.clear();
            tokio::select! {
                _ = token.cancelled() => break,
                read = reader.read_line(&mut line) => match read {
                    Ok(0) => break,
                    Ok(_) => {
                        let trimmed = line.trim_end();
                        if trimmed.starts_with('*') || trimmed.starts_with('$') || trimmed.starts_with(':') {
                            continue;
                        }
                        data.push(trimmed.to_string());
                        match data.first().map(|s| s.as_str()) {
                            Some("message") if data.len() >= 3 => {
                                let _ = app.emit(&event, format!("[{}] {}", data[1], data[2]));
                                data.clear();
                            }
                            Some("pmessage") if data.len() >= 4 => {
                                let _ = app.emit(&event, format!("[{}] {}", data[2], data[3]));
                                data.clear();
                            }
                            Some("subscribe") | Some("psubscribe") if data.len() >= 2 => {
                                let _ = app.emit(&event, format!("✅ 已订阅 {channel}"));
                                data.clear();
                            }
                            // WHY: safety reset so a malformed frame can't grow unbounded.
                            _ if data.len() > 6 => data.clear(),
                            _ => {}
                        }
                    }
                    Err(_) => break,
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn reg_pubsub_stop(
    id: String,
    registry: State<'_, RedisRegistry>,
) -> Result<(), String> {
    let instance = registry.get(&id).await?;
    if let Some(token) = instance.pubsub_cancel.write().await.take() {
        token.cancel();
    }
    Ok(())
}
