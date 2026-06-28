use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default)]
pub struct RedisStats {
    pub redis_version: String,
    pub redis_mode: String,
    pub role: String,
    pub uptime_in_seconds: u64,
    pub connected_clients: u64,
    pub blocked_clients: u64,
    pub used_memory: u64,
    pub used_memory_human: String,
    pub used_memory_peak_human: String,
    pub used_memory_rss_human: String,
    pub total_commands_processed: u64,
    pub instantaneous_ops_per_sec: u64,
    pub total_net_input_bytes: u64,
    pub total_net_output_bytes: u64,
    pub keyspace: Vec<KeyspaceEntry>,
}

#[derive(Debug, Clone, Serialize)]
pub struct KeyspaceEntry {
    pub db: String,
    pub keys: u64,
    pub expires: u64,
}

pub fn parse_info(raw: &str) -> RedisStats {
    let mut stats = RedisStats::default();
    for line in raw.lines() {
        let line = line.trim();
        if line.starts_with('#') || line.is_empty() {
            continue;
        }
        if let Some((key, val)) = line.split_once(':') {
            match key.trim() {
                "redis_version" => stats.redis_version = val.trim().to_string(),
                "redis_mode" => stats.redis_mode = val.trim().to_string(),
                "role" => stats.role = val.trim().to_string(),
                "uptime_in_seconds" => stats.uptime_in_seconds = val.trim().parse().unwrap_or(0),
                "connected_clients" => stats.connected_clients = val.trim().parse().unwrap_or(0),
                "blocked_clients" => stats.blocked_clients = val.trim().parse().unwrap_or(0),
                "used_memory" => stats.used_memory = val.trim().parse().unwrap_or(0),
                "total_net_input_bytes" => {
                    stats.total_net_input_bytes = val.trim().parse().unwrap_or(0)
                }
                "total_net_output_bytes" => {
                    stats.total_net_output_bytes = val.trim().parse().unwrap_or(0)
                }
                "used_memory_human" => stats.used_memory_human = val.trim().to_string(),
                "used_memory_peak_human" => stats.used_memory_peak_human = val.trim().to_string(),
                "used_memory_rss_human" => stats.used_memory_rss_human = val.trim().to_string(),
                "total_commands_processed" => {
                    stats.total_commands_processed = val.trim().parse().unwrap_or(0)
                }
                "instantaneous_ops_per_sec" => {
                    stats.instantaneous_ops_per_sec = val.trim().parse().unwrap_or(0)
                }
                k if k.starts_with("db") => {
                    // e.g. "db0:keys=1234,expires=56,avg_ttl=0"
                    let db_name = k.to_string();
                    let mut keys = 0u64;
                    let mut expires = 0u64;
                    for part in val.split(',') {
                        if let Some((pk, pv)) = part.split_once('=') {
                            match pk.trim() {
                                "keys" => keys = pv.trim().parse().unwrap_or(0),
                                "expires" => expires = pv.trim().parse().unwrap_or(0),
                                _ => {}
                            }
                        }
                    }
                    stats.keyspace.push(KeyspaceEntry {
                        db: db_name,
                        keys,
                        expires,
                    });
                }
                _ => {}
            }
        }
    }
    stats
}
