mod manager;
mod models;

use tauri::State;

pub use manager::MongoWorkspaceManager;
pub use models::{
    MongoCollectionInfo, MongoConnectionDraft, MongoConnectionRecord, MongoDatabaseInfo,
    MongoDeleteResult, MongoFindOptions, MongoFindResponse, MongoInsertResult, MongoUpdateResult,
};

#[tauri::command]
pub fn mongo_list_connections(
    state: State<'_, MongoWorkspaceManager>,
) -> Result<Vec<MongoConnectionRecord>, String> {
    state.list_connections()
}

#[tauri::command]
pub fn mongo_add_connection(
    state: State<'_, MongoWorkspaceManager>,
    draft: MongoConnectionDraft,
) -> Result<MongoConnectionRecord, String> {
    state.add_connection(draft)
}

#[tauri::command]
pub fn mongo_update_connection(
    state: State<'_, MongoWorkspaceManager>,
    id: String,
    draft: MongoConnectionDraft,
) -> Result<MongoConnectionRecord, String> {
    state.update_connection(&id, draft)
}

#[tauri::command]
pub fn mongo_delete_connection(
    state: State<'_, MongoWorkspaceManager>,
    id: String,
) -> Result<(), String> {
    state.delete_connection(&id)
}

#[tauri::command]
pub async fn mongo_test_connection(
    state: State<'_, MongoWorkspaceManager>,
    draft: MongoConnectionDraft,
) -> Result<String, String> {
    state.test_connection(draft).await
}

#[tauri::command]
pub async fn mongo_connect(
    state: State<'_, MongoWorkspaceManager>,
    id: String,
) -> Result<String, String> {
    state.connect(&id).await
}

#[tauri::command]
pub fn mongo_disconnect(
    state: State<'_, MongoWorkspaceManager>,
    id: String,
) -> Result<(), String> {
    state.disconnect(&id)
}

#[tauri::command]
pub async fn mongo_list_databases(
    state: State<'_, MongoWorkspaceManager>,
    id: String,
) -> Result<Vec<MongoDatabaseInfo>, String> {
    state.list_databases(&id).await
}

#[tauri::command]
pub async fn mongo_list_collections(
    state: State<'_, MongoWorkspaceManager>,
    id: String,
    db: String,
) -> Result<Vec<MongoCollectionInfo>, String> {
    state.list_collections(&id, &db).await
}

#[tauri::command]
pub async fn mongo_find_documents(
    state: State<'_, MongoWorkspaceManager>,
    id: String,
    db: String,
    collection: String,
    options: Option<MongoFindOptions>,
) -> Result<MongoFindResponse, String> {
    state.find_documents(&id, &db, &collection, options).await
}

#[tauri::command]
pub async fn mongo_count_documents(
    state: State<'_, MongoWorkspaceManager>,
    id: String,
    db: String,
    collection: String,
    options: Option<MongoFindOptions>,
) -> Result<u64, String> {
    state.count_documents(&id, &db, &collection, options).await
}

#[tauri::command]
pub async fn mongo_get_document(
    state: State<'_, MongoWorkspaceManager>,
    id: String,
    db: String,
    collection: String,
    document_id: serde_json::Value,
) -> Result<serde_json::Value, String> {
    state
        .get_document(&id, &db, &collection, document_id)
        .await
}

#[tauri::command]
pub async fn mongo_insert_document(
    state: State<'_, MongoWorkspaceManager>,
    id: String,
    db: String,
    collection: String,
    document: serde_json::Value,
) -> Result<MongoInsertResult, String> {
    state.insert_document(&id, &db, &collection, document).await
}

#[tauri::command]
pub async fn mongo_update_document(
    state: State<'_, MongoWorkspaceManager>,
    id: String,
    db: String,
    collection: String,
    document_id: serde_json::Value,
    document: serde_json::Value,
) -> Result<MongoUpdateResult, String> {
    state
        .update_document(&id, &db, &collection, document_id, document)
        .await
}

#[tauri::command]
pub async fn mongo_delete_documents(
    state: State<'_, MongoWorkspaceManager>,
    id: String,
    db: String,
    collection: String,
    document_ids: Vec<serde_json::Value>,
) -> Result<MongoDeleteResult, String> {
    state
        .delete_documents(&id, &db, &collection, document_ids)
        .await
}
