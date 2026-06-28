// Mirrors the Rust types in src-tauri/src/redis/

export interface SavedConnection {
  id: string;
  label: string;
  host: string;
  port: number;
  db: number;
  has_password: boolean;
  created_at: number;
}

export interface ConnectResult {
  ok: boolean;
  latency_ms: number;
  error: string | null;
}

export interface ScanPage {
  keys: string[];
  next_cursor: number;
  done: boolean;
}

export interface StringValue {
  value: string;
  truncated: boolean;
  total_bytes: number;
}

export interface HashField {
  field: string;
  value: string;
}

export interface HashPage {
  fields: HashField[];
  total: number;
  next_cursor: number;
}

export interface ListPage {
  items: string[];
  total: number;
}

export interface SetPage {
  members: string[];
  next_cursor: number;
}

export interface ZSetEntry {
  member: string;
  score: number;
}

export interface ZSetPage {
  entries: ZSetEntry[];
  total: number;
}

export interface RedisStats {
  redis_version: string;
  uptime_in_seconds: number;
  connected_clients: number;
  blocked_clients: number;
  used_memory_human: string;
  used_memory_peak_human: string;
  used_memory_rss_human: string;
  total_commands_processed: number;
  instantaneous_ops_per_sec: number;
  keyspace: Array<{ db: string; keys: number; expires: number }>;
}

export type RedisKeyType = "string" | "hash" | "list" | "set" | "zset" | "stream" | "none";

export interface EnrichedKey {
  key: string;
  key_type: RedisKeyType;
  ttl: number;        // -1 no expiry, -2 gone, >0 seconds
  size_bytes: number; // MEMORY USAGE; -1 when unavailable
}

export interface EnrichedScanPage {
  keys: EnrichedKey[];
  next_cursor: number;
  done: boolean;
  scanned: number;
}
