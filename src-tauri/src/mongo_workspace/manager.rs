use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use futures::TryStreamExt;
use mongodb::bson::{self, doc, Document};
use mongodb::options::{Collation, FindOptions, Hint};
use mongodb::Client;
use rusqlite::{params, Connection, OptionalExtension};
use tokio::time::{timeout, Duration};

use super::models::{
    MongoCollectionInfo, MongoConnectionDraft, MongoConnectionRecord, MongoDatabaseInfo,
    MongoDeleteResult, MongoFindOptions, MongoFindResponse, MongoInsertResult, MongoUpdateResult,
};

const MONGO_CONNECT_TIMEOUT_SECS: u64 = 8;
const MONGO_SUMMARY_TOP_LEVEL_FIELDS: usize = 6;
const MONGO_SUMMARY_NESTED_FIELDS: usize = 4;
const MONGO_SUMMARY_ARRAY_ITEMS: usize = 4;

struct MongoConnectionHandle {
    client: Client,
}

struct MongoConnectionRow {
    id: String,
    name: String,
    uri: String,
    tag: Option<String>,
    created_at: i64,
    updated_at: i64,
    last_connected_at: Option<i64>,
}

pub struct MongoWorkspaceManager {
    db_path: PathBuf,
    connections: Mutex<HashMap<String, MongoConnectionHandle>>,
}

impl MongoWorkspaceManager {
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

    pub fn list_connections(&self) -> Result<Vec<MongoConnectionRecord>, String> {
        let connection = self.open_db()?;
        let mut statement = connection
            .prepare(
                "SELECT id, name, uri, tag, created_at, updated_at, last_connected_at
                 FROM mongo_connections
                 ORDER BY updated_at DESC, name COLLATE NOCASE ASC",
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map([], |row| {
                Ok(MongoConnectionRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    uri: row.get(2)?,
                    tag: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                    last_connected_at: row.get(6)?,
                })
            })
            .map_err(|error| error.to_string())?;

        let connected_ids = self.connected_ids()?;
        let mut connections = Vec::new();
        for row in rows {
            connections.push(self.hydrate_row(row.map_err(|error| error.to_string())?, &connected_ids));
        }

        Ok(connections)
    }

    pub fn add_connection(
        &self,
        draft: MongoConnectionDraft,
    ) -> Result<MongoConnectionRecord, String> {
        let validated = sanitize_draft(draft)?;
        let now = now_timestamp_ms()?;

        let record = MongoConnectionRecord {
            id: generate_id(),
            name: validated.name,
            uri: validated.uri,
            tag: validated.tag,
            created_at: now,
            updated_at: now,
            last_connected_at: None,
            connected: false,
        };

        let connection = self.open_db()?;
        connection
            .execute(
                "INSERT INTO mongo_connections (
                    id, name, uri, tag, created_at, updated_at, last_connected_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    record.id.as_str(),
                    record.name.as_str(),
                    record.uri.as_str(),
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
        draft: MongoConnectionDraft,
    ) -> Result<MongoConnectionRecord, String> {
        let validated = sanitize_draft(draft)?;
        let existing = self.fetch_record(id)?;
        let updated_at = now_timestamp_ms()?;

        let record = MongoConnectionRecord {
            id: existing.id.clone(),
            name: validated.name,
            uri: validated.uri,
            tag: validated.tag,
            created_at: existing.created_at,
            updated_at,
            last_connected_at: existing.last_connected_at,
            connected: existing.connected,
        };

        let connection = self.open_db()?;
        connection
            .execute(
                "UPDATE mongo_connections
                 SET name = ?2, uri = ?3, tag = ?4, updated_at = ?5
                 WHERE id = ?1",
                params![
                    record.id.as_str(),
                    record.name.as_str(),
                    record.uri.as_str(),
                    record.tag.as_deref(),
                    record.updated_at,
                ],
            )
            .map_err(|error| error.to_string())?;

        Ok(record)
    }

    pub fn delete_connection(&self, id: &str) -> Result<(), String> {
        self.disconnect(id)?;

        self.open_db()?
            .execute("DELETE FROM mongo_connections WHERE id = ?1", params![id])
            .map_err(|error| error.to_string())?;

        Ok(())
    }

    pub async fn test_connection(&self, draft: MongoConnectionDraft) -> Result<String, String> {
        let validated = sanitize_draft(draft)?;
        create_and_ping_client(&validated.uri).await?;
        Ok("Can connect to MongoDB.".to_string())
    }

    pub async fn connect(&self, id: &str) -> Result<String, String> {
        let record = self.fetch_record(id)?;
        let client = create_and_ping_client(&record.uri).await?;

        self.connections
            .lock()
            .map_err(|_| "Failed to lock MongoDB connections.".to_string())?
            .insert(id.to_string(), MongoConnectionHandle { client });

        let now = now_timestamp_ms()?;
        self.open_db()?
            .execute(
                "UPDATE mongo_connections
                 SET last_connected_at = ?2, updated_at = ?3
                 WHERE id = ?1",
                params![id, now, now],
            )
            .map_err(|error| error.to_string())?;

        Ok(format!("Connected to {}.", record.name))
    }

    pub fn disconnect(&self, id: &str) -> Result<(), String> {
        self.connections
            .lock()
            .map_err(|_| "Failed to lock MongoDB connections.".to_string())?
            .remove(id);
        Ok(())
    }

    pub async fn list_databases(&self, id: &str) -> Result<Vec<MongoDatabaseInfo>, String> {
        let client = self.client_for(id)?;
        let databases = client
            .list_databases()
            .await
            .map_err(|error| format!("Failed to list databases: {}", error))?;

        Ok(databases
            .into_iter()
            .map(|database| MongoDatabaseInfo {
                name: database.name,
                size_on_disk: database.size_on_disk,
                empty: database.size_on_disk == 0,
            })
            .collect())
    }

    pub async fn list_collections(&self, id: &str, db: &str) -> Result<Vec<MongoCollectionInfo>, String> {
        let client = self.client_for(id)?;
        let names = client
            .database(db)
            .list_collection_names()
            .await
            .map_err(|error| format!("Failed to list collections: {}", error))?;

        Ok(names
            .into_iter()
            .filter(|name| !name.starts_with("system."))
            .map(|name| MongoCollectionInfo {
                name,
                document_count: None,
            })
            .collect())
    }

    pub async fn find_documents(
        &self,
        id: &str,
        db: &str,
        collection: &str,
        options: Option<MongoFindOptions>,
    ) -> Result<MongoFindResponse, String> {
        let client = self.client_for(id)?;
        let database = client.database(db);
        let collection = database.collection::<Document>(collection);
        let filter = options
            .as_ref()
            .and_then(|value| value.filter.as_deref())
            .filter(|value| !value.trim().is_empty() && value.trim() != "{}")
            .map(parse_document)
            .transpose()?
            .unwrap_or_default();

        let find_options = build_find_options(options.as_ref())?;
        let mut cursor = collection
            .find(filter)
            .with_options(find_options)
            .await
            .map_err(|error| format!("Find failed: {}", error))?;

        let mut documents = Vec::new();
        let summary_only = options
            .as_ref()
            .and_then(|value| value.summary_only)
            .unwrap_or(false);
        while let Some(document) = cursor
            .try_next()
            .await
            .map_err(|error| format!("Cursor error: {}", error))?
        {
            let document = if summary_only {
                summarize_document(document)
            } else {
                document
            };
            documents.push(
                serde_json::to_value(&document).unwrap_or(serde_json::Value::Null),
            );
        }

        let loaded_count = documents.len() as u64;

        Ok(MongoFindResponse {
            documents,
            count: loaded_count,
        })
    }

    pub async fn count_documents(
        &self,
        id: &str,
        db: &str,
        collection: &str,
        options: Option<MongoFindOptions>,
    ) -> Result<u64, String> {
        let client = self.client_for(id)?;
        let database = client.database(db);
        let collection = database.collection::<Document>(collection);

        let normalized_filter = options
            .as_ref()
            .and_then(|value| value.filter.as_deref())
            .as_deref()
            .filter(|value| !value.trim().is_empty() && value.trim() != "{}")
            .map(parse_document)
            .transpose()?;

        if let Some(filter_document) = normalized_filter {
            let mut action = collection.count_documents(filter_document);

            if let Some(collation) = options
                .as_ref()
                .and_then(|value| value.collation.as_deref())
                .filter(|value| !value.trim().is_empty())
                .map(parse_collation)
                .transpose()?
            {
                action = action.collation(collation);
            }

            if let Some(hint) = options
                .as_ref()
                .and_then(|value| value.hint.as_deref())
                .filter(|value| !value.trim().is_empty())
                .map(parse_hint)
                .transpose()?
            {
                action = action.hint(hint);
            }

            if let Some(max_time) = options
                .as_ref()
                .and_then(|value| value.max_time_ms)
                .map(Duration::from_millis)
            {
                action = action.max_time(max_time);
            }

            action.await.map_err(|error| format!("Count failed: {}", error))
        } else {
            collection
                .estimated_document_count()
                .await
                .map_err(|error| format!("Count failed: {}", error))
        }
    }

    pub async fn get_document(
        &self,
        id: &str,
        db: &str,
        collection: &str,
        document_id: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let client = self.client_for(id)?;
        let database = client.database(db);
        let collection = database.collection::<Document>(collection);
        let id_bson = parse_id_value(document_id)?;

        let document = collection
            .find_one(doc! { "_id": id_bson })
            .await
            .map_err(|error| format!("Find document failed: {}", error))?
            .ok_or_else(|| "Document was not found.".to_string())?;

        Ok(serde_json::to_value(&document).unwrap_or(serde_json::Value::Null))
    }

    pub async fn insert_document(
        &self,
        id: &str,
        db: &str,
        collection: &str,
        document: serde_json::Value,
    ) -> Result<MongoInsertResult, String> {
        let client = self.client_for(id)?;
        let database = client.database(db);
        let collection = database.collection::<Document>(collection);
        let document = parse_value_document(document)?;

        collection
            .insert_one(document)
            .await
            .map_err(|error| format!("Insert failed: {}", error))?;

        Ok(MongoInsertResult { inserted_count: 1 })
    }

    pub async fn update_document(
        &self,
        id: &str,
        db: &str,
        collection: &str,
        document_id: serde_json::Value,
        document: serde_json::Value,
    ) -> Result<MongoUpdateResult, String> {
        let client = self.client_for(id)?;
        let database = client.database(db);
        let collection = database.collection::<Document>(collection);
        let id_bson = parse_id_value(document_id)?;
        let mut replacement = parse_value_document(document)?;

        replacement.insert("_id", id_bson.clone());

        let result = collection
            .replace_one(doc! { "_id": id_bson }, replacement)
            .await
            .map_err(|error| format!("Update failed: {}", error))?;

        Ok(MongoUpdateResult {
            matched_count: result.matched_count,
            modified_count: result.modified_count,
        })
    }

    pub async fn delete_documents(
        &self,
        id: &str,
        db: &str,
        collection: &str,
        document_ids: Vec<serde_json::Value>,
    ) -> Result<MongoDeleteResult, String> {
        let client = self.client_for(id)?;
        let database = client.database(db);
        let collection = database.collection::<Document>(collection);
        let ids = document_ids
            .into_iter()
            .map(parse_id_value)
            .collect::<Result<Vec<_>, _>>()?;

        let result = collection
            .delete_many(doc! { "_id": { "$in": ids } })
            .await
            .map_err(|error| format!("Delete failed: {}", error))?;

        Ok(MongoDeleteResult {
            deleted_count: result.deleted_count,
        })
    }

    fn ensure_schema(&self) -> Result<(), String> {
        self.open_db()?
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS mongo_connections (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    uri TEXT NOT NULL,
                    tag TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    last_connected_at INTEGER
                );
                CREATE INDEX IF NOT EXISTS idx_mongo_connections_updated_at
                    ON mongo_connections(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_mongo_connections_name
                    ON mongo_connections(name COLLATE NOCASE);",
            )
            .map_err(|error| error.to_string())
    }

    fn open_db(&self) -> Result<Connection, String> {
        Connection::open(&self.db_path).map_err(|error| error.to_string())
    }

    fn fetch_record(&self, id: &str) -> Result<MongoConnectionRecord, String> {
        let connection = self.open_db()?;
        let row = connection
            .query_row(
                "SELECT id, name, uri, tag, created_at, updated_at, last_connected_at
                 FROM mongo_connections
                 WHERE id = ?1",
                params![id],
                |row| {
                    Ok(MongoConnectionRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        uri: row.get(2)?,
                        tag: row.get(3)?,
                        created_at: row.get(4)?,
                        updated_at: row.get(5)?,
                        last_connected_at: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("MongoDB connection `{}` was not found.", id))?;

        Ok(self.hydrate_row(row, &self.connected_ids()?))
    }

    fn hydrate_row(
        &self,
        row: MongoConnectionRow,
        connected_ids: &[String],
    ) -> MongoConnectionRecord {
        MongoConnectionRecord {
            id: row.id.clone(),
            name: row.name,
            uri: row.uri,
            tag: row.tag,
            created_at: row.created_at,
            updated_at: row.updated_at,
            last_connected_at: row.last_connected_at,
            connected: connected_ids.iter().any(|value| value == &row.id),
        }
    }

    fn connected_ids(&self) -> Result<Vec<String>, String> {
        let connections = self
            .connections
            .lock()
            .map_err(|_| "Failed to lock MongoDB connections.".to_string())?;
        Ok(connections.keys().cloned().collect())
    }

    fn client_for(&self, id: &str) -> Result<Client, String> {
        let connections = self
            .connections
            .lock()
            .map_err(|_| "Failed to lock MongoDB connections.".to_string())?;
        connections
            .get(id)
            .map(|handle| handle.client.clone())
            .ok_or_else(|| "MongoDB connection is not active. Connect first.".to_string())
    }
}

fn sanitize_draft(draft: MongoConnectionDraft) -> Result<MongoConnectionDraft, String> {
    let name = draft.name.trim();
    if name.is_empty() {
        return Err("Connection name is required.".to_string());
    }

    let uri = draft.uri.trim();
    if uri.is_empty() {
        return Err("MongoDB URI is required.".to_string());
    }

    Ok(MongoConnectionDraft {
        name: name.to_string(),
        uri: uri.to_string(),
        tag: draft
            .tag
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    })
}

fn generate_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("mongo-{}-{}", nanos, std::process::id())
}

fn now_timestamp_ms() -> Result<i64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis() as i64)
}

async fn create_and_ping_client(uri: &str) -> Result<Client, String> {
    let client = timeout(Duration::from_secs(MONGO_CONNECT_TIMEOUT_SECS), Client::with_uri_str(uri))
        .await
        .map_err(|_| format!("Timed out after {}s while trying to connect to MongoDB.", MONGO_CONNECT_TIMEOUT_SECS))?
        .map_err(|error| format!("Failed to create client: {}", error))?;

    timeout(
        Duration::from_secs(MONGO_CONNECT_TIMEOUT_SECS),
        client.database("admin").run_command(doc! { "ping": 1 }),
    )
    .await
    .map_err(|_| format!("Timed out after {}s while trying to connect to MongoDB.", MONGO_CONNECT_TIMEOUT_SECS))?
    .map_err(|error| format!("Failed to connect: {}", error))?;

    Ok(client)
}

fn to_strict_json(input: &str) -> String {
    let mut result = String::with_capacity(input.len() + 32);
    let chars: Vec<char> = input.chars().collect();
    let len = chars.len();
    let mut index = 0;

    while index < len {
        let character = chars[index];

        if character == '"' {
            result.push('"');
            index += 1;
            while index < len {
                let current = chars[index];
                result.push(current);
                if current == '\\' && index + 1 < len {
                    index += 1;
                    result.push(chars[index]);
                } else if current == '"' {
                    break;
                }
                index += 1;
            }
            index += 1;
            continue;
        }

        if character == '{' || character == ',' {
            result.push(character);
            index += 1;
            while index < len && chars[index].is_whitespace() {
                result.push(chars[index]);
                index += 1;
            }

            if index < len
                && (chars[index].is_alphabetic() || chars[index] == '_' || chars[index] == '$')
            {
                let start = index;
                while index < len
                    && (chars[index].is_alphanumeric()
                        || chars[index] == '_'
                        || chars[index] == '.'
                        || chars[index] == '$')
                {
                    index += 1;
                }

                let after_key = index;
                while index < len && chars[index].is_whitespace() {
                    index += 1;
                }

                if index < len && chars[index] == ':' {
                    let key: String = chars[start..after_key].iter().collect();
                    result.push('"');
                    result.push_str(&key);
                    result.push('"');
                    for item in chars.iter().take(index).skip(after_key) {
                        result.push(*item);
                    }
                } else {
                    for item in chars.iter().take(index).skip(start) {
                        result.push(*item);
                    }
                }
            }
            continue;
        }

        result.push(character);
        index += 1;
    }

    result
}

fn normalize_document_input(json: &str) -> String {
    let trimmed = json.trim();
    if trimmed.starts_with('{') {
        trimmed.to_string()
    } else {
        format!("{{{}}}", trimmed)
    }
}

fn parse_document(json: &str) -> Result<Document, String> {
    let normalized = normalize_document_input(json);
    let strict = to_strict_json(&normalized);
    let value: serde_json::Value =
        serde_json::from_str(&strict).map_err(|error| format!("Invalid JSON: {}", error))?;
    let bson_value =
        bson::to_bson(&value).map_err(|error| format!("BSON conversion error: {}", error))?;

    match bson_value {
        bson::Bson::Document(document) => Ok(document),
        _ => Err("Expected a JSON object.".to_string()),
    }
}

fn parse_value_document(value: serde_json::Value) -> Result<Document, String> {
    let bson_value =
        bson::to_bson(&value).map_err(|error| format!("BSON conversion error: {}", error))?;

    match bson_value {
        bson::Bson::Document(document) => Ok(document),
        _ => Err("Expected a JSON object.".to_string()),
    }
}

fn parse_id_value(value: serde_json::Value) -> Result<bson::Bson, String> {
    bson::to_bson(&value).map_err(|error| format!("BSON conversion error: {}", error))
}

fn parse_collation(json: &str) -> Result<Collation, String> {
    let normalized = normalize_document_input(json);
    let strict = to_strict_json(&normalized);
    serde_json::from_str(&strict).map_err(|error| format!("Invalid collation: {}", error))
}

fn parse_hint(value: &str) -> Result<Hint, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Index hint cannot be empty.".to_string());
    }

    if trimmed.starts_with('{') || trimmed.contains(':') {
        parse_document(trimmed).map(Hint::Keys)
    } else {
        Ok(Hint::Name(
            trimmed
                .trim_matches('"')
                .trim_matches('\'')
                .to_string(),
        ))
    }
}

fn build_find_options(options: Option<&MongoFindOptions>) -> Result<FindOptions, String> {
    match options {
        Some(options) => {
            let projection = options
                .projection
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(parse_document)
                .transpose()?;

            let sort = options
                .sort
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(parse_document)
                .transpose()?;

            let collation = options
                .collation
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(parse_collation)
                .transpose()?;

            let hint = options
                .hint
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(parse_hint)
                .transpose()?;

            let max_time = options.max_time_ms.map(Duration::from_millis);

            Ok(FindOptions::builder()
                .projection(projection)
                .sort(sort)
                .collation(collation)
                .hint(hint)
                .max_time(max_time)
                .skip(options.skip)
                .limit(options.limit.or(Some(50)))
                .build())
        }
        None => Ok(FindOptions::builder().limit(Some(50)).build()),
    }
}

fn summarize_document(document: Document) -> Document {
    let mut summarized = Document::new();

    if let Some(id) = document.get("_id").cloned() {
        summarized.insert("_id", id);
    }

    for (key, value) in document.into_iter().filter(|(key, _)| key != "_id").take(MONGO_SUMMARY_TOP_LEVEL_FIELDS) {
        summarized.insert(key, summarize_bson(value, 1));
    }

    summarized
}

fn summarize_bson(value: bson::Bson, depth: usize) -> bson::Bson {
    match value {
        bson::Bson::Document(document) => {
            let limit = if depth == 0 {
                MONGO_SUMMARY_TOP_LEVEL_FIELDS
            } else {
                MONGO_SUMMARY_NESTED_FIELDS
            };

            let mut summarized = Document::new();
            for (key, child) in document.into_iter().take(limit) {
                summarized.insert(key, summarize_bson(child, depth + 1));
            }
            bson::Bson::Document(summarized)
        }
        bson::Bson::Array(values) => bson::Bson::Array(
            values
                .into_iter()
                .take(MONGO_SUMMARY_ARRAY_ITEMS)
                .map(|child| summarize_bson(child, depth + 1))
                .collect(),
        ),
        other => other,
    }
}
