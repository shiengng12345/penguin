use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum RedisConnType {
    Standalone,
    Cluster,
    Sentinel,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RedisTlsConfig {
    pub enabled: bool,
    pub ca_cert_path: Option<String>,
    pub client_cert_path: Option<String>,
    pub client_key_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RedisSshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: RedisSshAuth,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", content = "value")]
pub enum RedisSshAuth {
    Password(String),
    KeyFile(String),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RedisConnectionDraft {
    pub name: String,
    pub conn_type: RedisConnType,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub db: u8,
    pub tls: RedisTlsConfig,
    #[serde(default)]
    pub ssh: Option<RedisSshConfig>,
    #[serde(default)]
    pub tag: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RedisConnectionRecord {
    pub id: String,
    pub name: String,
    pub conn_type: RedisConnType,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
    pub db: u8,
    pub tls: RedisTlsConfig,
    pub ssh: Option<RedisSshConfig>,
    pub tag: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_connected_at: Option<i64>,
    pub connected: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RedisDbInfo {
    pub db: u8,
    pub keys: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RedisServerInfo {
    pub redis_version: String,
    pub used_memory_human: String,
    pub used_memory: u64,
    pub connected_clients: String,
    pub connected_clients_count: u64,
    pub total_keys: u64,
    pub uptime_in_seconds: String,
    pub instantaneous_ops_per_sec: u64,
    pub keyspace_hits: u64,
    pub keyspace_misses: u64,
    pub total_commands_processed: u64,
    pub db_info: Vec<RedisDbInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RedisConnectResponse {
    pub message: String,
    pub server_info: RedisServerInfo,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RedisKeyInfo {
    pub key: String,
    pub key_type: String,
    pub ttl: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RedisScanResult {
    pub cursor: String,
    pub keys: Vec<RedisKeyInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RedisHashField {
    pub field: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RedisZSetMember {
    pub member: String,
    pub score: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", content = "data", rename_all = "lowercase")]
pub enum RedisKeyValue {
    String(String),
    Hash(Vec<RedisHashField>),
    List(Vec<String>),
    Set(Vec<String>),
    ZSet(Vec<RedisZSetMember>),
    None,
}

impl Default for RedisTlsConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            ca_cert_path: None,
            client_cert_path: None,
            client_key_path: None,
        }
    }
}

impl Default for RedisConnectionDraft {
    fn default() -> Self {
        Self {
            name: String::new(),
            conn_type: RedisConnType::Standalone,
            host: "127.0.0.1".to_string(),
            port: 6379,
            username: None,
            password: None,
            db: 0,
            tls: RedisTlsConfig::default(),
            ssh: None,
            tag: None,
        }
    }
}
