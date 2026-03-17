import { invoke } from "@tauri-apps/api/core";

export type RedisConnType = "standalone" | "cluster" | "sentinel";

export interface RedisTlsConfig {
  enabled: boolean;
  caCertPath?: string | null;
  clientCertPath?: string | null;
  clientKeyPath?: string | null;
}

export interface RedisSshPasswordAuth {
  type: "Password";
  value: string;
}

export interface RedisSshKeyFileAuth {
  type: "KeyFile";
  value: string;
}

export type RedisSshAuth = RedisSshPasswordAuth | RedisSshKeyFileAuth;

export interface RedisSshConfig {
  host: string;
  port: number;
  username: string;
  auth: RedisSshAuth;
}

export interface RedisConnectionDraft {
  name: string;
  connType: RedisConnType;
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  db: number;
  tls: RedisTlsConfig;
  ssh?: RedisSshConfig | null;
  tag?: string | null;
}

export interface RedisConnectionRecord extends RedisConnectionDraft {
  id: string;
  createdAt: number;
  updatedAt: number;
  lastConnectedAt?: number | null;
  connected: boolean;
}

export interface RedisDbInfo {
  db: number;
  keys: number;
}

export interface RedisServerInfo {
  redisVersion: string;
  usedMemoryHuman: string;
  usedMemory: number;
  connectedClients: string;
  connectedClientsCount: number;
  totalKeys: number;
  uptimeInSeconds: string;
  instantaneousOpsPerSec: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  totalCommandsProcessed: number;
  dbInfo: RedisDbInfo[];
}

export interface RedisConnectResponse {
  message: string;
  serverInfo: RedisServerInfo;
}

export interface RedisKeyInfo {
  key: string;
  keyType: string;
  ttl: number;
}

export interface RedisScanResult {
  cursor: string;
  keys: RedisKeyInfo[];
}

export interface RedisHashField {
  field: string;
  value: string;
}

export interface RedisZSetMember {
  member: string;
  score: number;
}

export type RedisKeyValue =
  | { type: "string"; data: string }
  | { type: "hash"; data: RedisHashField[] }
  | { type: "list"; data: string[] }
  | { type: "set"; data: string[] }
  | { type: "zset"; data: RedisZSetMember[] }
  | { type: "none"; data?: null };

export async function listRedisConnections() {
  return invoke<RedisConnectionRecord[]>("redis_list_connections");
}

export async function addRedisConnection(draft: RedisConnectionDraft) {
  return invoke<RedisConnectionRecord>("redis_add_connection", { draft });
}

export async function updateRedisConnection(id: string, draft: RedisConnectionDraft) {
  return invoke<RedisConnectionRecord>("redis_update_connection", { id, draft });
}

export async function deleteRedisConnection(id: string) {
  return invoke<void>("redis_delete_connection", { id });
}

export async function testRedisConnection(draft: RedisConnectionDraft) {
  return invoke<string>("redis_test_connection", { draft });
}

export async function connectRedisConnection(id: string) {
  return invoke<RedisConnectResponse>("redis_connect", { id });
}

export async function disconnectRedisConnection(id: string) {
  return invoke<void>("redis_disconnect", { id });
}

export async function getRedisServerInfo(id: string) {
  return invoke<RedisServerInfo>("redis_get_server_info", { id });
}

export async function selectRedisDb(id: string, db: number) {
  return invoke<void>("redis_select_db", { id, db });
}

export async function getRedisDbSize(id: string) {
  return invoke<number>("redis_db_size", { id });
}

export async function scanRedisKeys(
  id: string,
  pattern: string,
  cursor = "0",
  count = 200,
) {
  return invoke<RedisScanResult>("redis_scan_keys", { id, pattern, cursor, count });
}

export async function getRedisKeyInfo(id: string, key: string) {
  return invoke<RedisKeyInfo>("redis_get_key_info", { id, key });
}

export async function getRedisKeyValue(id: string, key: string) {
  return invoke<RedisKeyValue>("redis_get_key_value", { id, key });
}

export async function setRedisKeyValue(
  id: string,
  key: string,
  value: RedisKeyValue,
  ttl?: number | null,
) {
  return invoke<void>("redis_set_key_value", { id, key, value, ttl });
}

export async function deleteRedisKeys(id: string, keys: string[]) {
  return invoke<number>("redis_delete_keys", { id, keys });
}

export async function renameRedisKey(id: string, oldKey: string, newKey: string) {
  return invoke<void>("redis_rename_key", { id, oldKey, newKey });
}

export async function setRedisKeyTtl(id: string, key: string, ttl: number) {
  return invoke<void>("redis_set_ttl", { id, key, ttl });
}

export async function executeRedisCommand(id: string, command: string) {
  return invoke<string>("redis_execute_command", { id, command });
}
