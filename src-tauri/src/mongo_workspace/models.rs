use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MongoConnectionDraft {
    pub name: String,
    pub uri: String,
    #[serde(default)]
    pub tag: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MongoConnectionRecord {
    pub id: String,
    pub name: String,
    pub uri: String,
    pub tag: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_connected_at: Option<i64>,
    pub connected: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MongoDatabaseInfo {
    pub name: String,
    pub size_on_disk: u64,
    pub empty: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MongoCollectionInfo {
    pub name: String,
    #[serde(default)]
    pub document_count: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MongoFindOptions {
    #[serde(default)]
    pub filter: Option<String>,
    #[serde(default)]
    pub projection: Option<String>,
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub collation: Option<String>,
    #[serde(default)]
    pub hint: Option<String>,
    #[serde(default)]
    pub max_time_ms: Option<u64>,
    #[serde(default)]
    pub skip: Option<u64>,
    #[serde(default)]
    pub limit: Option<i64>,
    #[serde(default)]
    pub summary_only: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MongoFindResponse {
    pub documents: Vec<serde_json::Value>,
    pub count: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MongoInsertResult {
    pub inserted_count: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MongoUpdateResult {
    pub matched_count: u64,
    pub modified_count: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MongoDeleteResult {
    pub deleted_count: u64,
}

impl Default for MongoConnectionDraft {
    fn default() -> Self {
        Self {
            name: String::new(),
            uri: "mongodb://localhost:27017".to_string(),
            tag: None,
        }
    }
}
