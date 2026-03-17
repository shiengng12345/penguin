mod manager;
mod models;

use tauri::State;

pub use manager::RedisWorkspaceManager;
pub use models::{
    RedisConnectResponse, RedisConnectionDraft, RedisConnectionRecord, RedisKeyInfo,
    RedisKeyValue, RedisScanResult, RedisServerInfo,
};

#[tauri::command]
pub fn redis_list_connections(
    state: State<'_, RedisWorkspaceManager>,
) -> Result<Vec<RedisConnectionRecord>, String> {
    state.list_connections()
}

#[tauri::command]
pub fn redis_add_connection(
    state: State<'_, RedisWorkspaceManager>,
    draft: RedisConnectionDraft,
) -> Result<RedisConnectionRecord, String> {
    state.add_connection(draft)
}

#[tauri::command]
pub fn redis_update_connection(
    state: State<'_, RedisWorkspaceManager>,
    id: String,
    draft: RedisConnectionDraft,
) -> Result<RedisConnectionRecord, String> {
    state.update_connection(&id, draft)
}

#[tauri::command]
pub fn redis_delete_connection(
    state: State<'_, RedisWorkspaceManager>,
    id: String,
) -> Result<(), String> {
    state.delete_connection(&id)
}

#[tauri::command]
pub async fn redis_test_connection(
    state: State<'_, RedisWorkspaceManager>,
    draft: RedisConnectionDraft,
) -> Result<String, String> {
    state.test_connection(draft).await
}

#[tauri::command]
pub async fn redis_connect(
    state: State<'_, RedisWorkspaceManager>,
    id: String,
) -> Result<RedisConnectResponse, String> {
    state.connect(&id).await
}

#[tauri::command]
pub fn redis_disconnect(
    state: State<'_, RedisWorkspaceManager>,
    id: String,
) -> Result<(), String> {
    state.disconnect(&id)
}

#[tauri::command]
pub async fn redis_get_server_info(
    state: State<'_, RedisWorkspaceManager>,
    id: String,
) -> Result<RedisServerInfo, String> {
    state.get_server_info(&id).await
}

#[tauri::command]
pub async fn redis_select_db(
    state: State<'_, RedisWorkspaceManager>,
    id: String,
    db: u8,
) -> Result<(), String> {
    state.select_db(&id, db).await
}

#[tauri::command]
pub async fn redis_db_size(
    state: State<'_, RedisWorkspaceManager>,
    id: String,
) -> Result<u64, String> {
    state.db_size(&id).await
}

#[tauri::command]
pub async fn redis_scan_keys(
    state: State<'_, RedisWorkspaceManager>,
    id: String,
    pattern: String,
    cursor: String,
    count: u64,
) -> Result<RedisScanResult, String> {
    state.scan_keys(&id, &pattern, &cursor, count).await
}

#[tauri::command]
pub async fn redis_get_key_info(
    state: State<'_, RedisWorkspaceManager>,
    id: String,
    key: String,
) -> Result<RedisKeyInfo, String> {
    state.get_key_info(&id, &key).await
}

#[tauri::command]
pub async fn redis_get_key_value(
    state: State<'_, RedisWorkspaceManager>,
    id: String,
    key: String,
) -> Result<RedisKeyValue, String> {
    state.get_key_value(&id, &key).await
}

#[tauri::command]
pub async fn redis_set_key_value(
    state: State<'_, RedisWorkspaceManager>,
    id: String,
    key: String,
    value: RedisKeyValue,
    ttl: Option<i64>,
) -> Result<(), String> {
    state.set_key_value(&id, &key, value, ttl).await
}

#[tauri::command]
pub async fn redis_delete_keys(
    state: State<'_, RedisWorkspaceManager>,
    id: String,
    keys: Vec<String>,
) -> Result<u64, String> {
    state.delete_keys(&id, keys).await
}

#[tauri::command]
pub async fn redis_rename_key(
    state: State<'_, RedisWorkspaceManager>,
    id: String,
    old_key: String,
    new_key: String,
) -> Result<(), String> {
    state.rename_key(&id, &old_key, &new_key).await
}

#[tauri::command]
pub async fn redis_set_ttl(
    state: State<'_, RedisWorkspaceManager>,
    id: String,
    key: String,
    ttl: i64,
) -> Result<(), String> {
    state.set_ttl(&id, &key, ttl).await
}

#[tauri::command]
pub async fn redis_execute_command(
    state: State<'_, RedisWorkspaceManager>,
    id: String,
    command: String,
) -> Result<String, String> {
    state.execute_command(&id, &command).await
}
