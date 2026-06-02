use base64::Engine;
use notify::{event::EventKind, RecursiveMode, Watcher};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use toml_edit::{value, Array, DocumentMut, Item, Table};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtoFile {
    pub name: String,
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPackage {
    pub name: String,
    pub version: String,
    pub protos: Vec<ProtoFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpProxyRequest {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub body_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpProxyResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub body_base64: String,
    pub error: Option<String>,
}

fn penguin_packages_dir(protocol: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    Ok(home.join(".penguin").join(protocol))
}

// One-shot migration for users upgrading from the "pengvi" naming: if their
// data still lives under ~/.pengvi and the new ~/.penguin doesn't exist yet,
// rename the whole tree in one atomic step. Same-filesystem mv is cheap and
// preserves inodes (so npm's cached extraction symlinks stay valid). Failures
// are logged but never fatal — worst case the user reinstalls a few packages.
fn migrate_legacy_pengvi_dir() {
    let Some(home) = dirs::home_dir() else { return };
    let new_dir = home.join(".penguin");
    let old_dir = home.join(".pengvi");
    if new_dir.exists() || !old_dir.exists() {
        return;
    }
    match std::fs::rename(&old_dir, &new_dir) {
        Ok(()) => eprintln!("Migrated {} -> {}", old_dir.display(), new_dir.display()),
        Err(e) => eprintln!("Failed to migrate ~/.pengvi -> ~/.penguin: {}", e),
    }
}

#[tauri::command]
fn ensure_packages_dir(protocol: String) -> Result<String, String> {
    let dir = penguin_packages_dir(&protocol)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let package_json = dir.join("package.json");
    if !package_json.exists() {
        let pkg = serde_json::json!({
            "name": "penguin-packages",
            "version": "1.0.0",
            "private": true
        });
        fs::write(&package_json, serde_json::to_string_pretty(&pkg).unwrap())
            .map_err(|e| e.to_string())?;
    }

    let local_npmrc = dir.join(".npmrc");
    if !local_npmrc.exists() {
        if let Some(home) = dirs::home_dir() {
            let global_npmrc = home.join(".npmrc");
            if global_npmrc.exists() {
                let _ = fs::copy(&global_npmrc, &local_npmrc);
            }
        }
    }

    dir.to_str()
        .map(String::from)
        .ok_or_else(|| "Invalid path".to_string())
}

#[tauri::command]
fn get_packages_dir(protocol: String) -> Result<String, String> {
    let dir = penguin_packages_dir(&protocol)?;
    dir.to_str()
        .map(String::from)
        .ok_or_else(|| "Invalid path".to_string())
}

fn read_file_content(path: &std::path::Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_installed_packages(protocol: String) -> Result<Vec<InstalledPackage>, String> {
    let base_dir = penguin_packages_dir(&protocol)?;
    let node_modules = base_dir.join("node_modules");

    if !node_modules.exists() {
        return Ok(Vec::new());
    }

    let root_pkg_json = base_dir.join("package.json");
    let direct_deps: HashMap<String, String> = if root_pkg_json.exists() {
        fs::read_to_string(&root_pkg_json)
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| {
                v.get("dependencies")
                    .and_then(|d| d.as_object())
                    .map(|obj| {
                        obj.iter()
                            .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                            .collect()
                    })
            })
            .unwrap_or_default()
    } else {
        HashMap::new()
    };

    if direct_deps.is_empty() {
        return Ok(Vec::new());
    }

    let mut packages = Vec::new();

    for (dep_name, _dep_version) in &direct_deps {
        if !dep_name.starts_with("@snsoft/") {
            continue;
        }
        let pkg_path = if dep_name.starts_with('@') {
            let parts: Vec<&str> = dep_name.splitn(2, '/').collect();
            if parts.len() == 2 {
                node_modules.join(parts[0]).join(parts[1])
            } else {
                node_modules.join(dep_name)
            }
        } else {
            node_modules.join(dep_name)
        };

        if !pkg_path.is_dir() {
            continue;
        }

        let child_pkg_json = pkg_path.join("package.json");
        let version = if child_pkg_json.exists() {
            fs::read_to_string(&child_pkg_json)
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v.get("version").and_then(|v| v.as_str()).map(String::from))
                .unwrap_or_default()
        } else {
            continue;
        };

        let protos = discover_package_files(&pkg_path, &protocol)?;
        packages.push(InstalledPackage {
            name: dep_name.clone(),
            version,
            protos,
        });
    }

    Ok(packages)
}

fn discover_package_files(pkg_path: &std::path::Path, protocol: &str) -> Result<Vec<ProtoFile>, String> {
    let mut files = Vec::new();
    let dist = pkg_path.join("dist");

    if !dist.exists() {
        return Ok(files);
    }

    let protocol_lower = protocol.to_lowercase();

    if protocol_lower == "grpc" || protocol_lower == "grpc-web" {
        // .proto files in dist/protos/
        let protos_dir = dist.join("protos");
        if protos_dir.exists() {
            for entry in glob::glob(protos_dir.join("**/*.proto").to_str().unwrap())
                .map_err(|e| e.to_string())?
            {
                if let Ok(p) = entry {
                    if p.is_file() {
                        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                        let path_str = p.to_string_lossy().to_string();
                        let content = read_file_content(&p).unwrap_or_default();
                        files.push(ProtoFile { name, path: path_str, content });
                    }
                }
            }
        }

        // *_connect.d.ts and *_pb.d.ts in dist/
        for pattern in &["**/*_connect.d.ts", "**/*_pb.d.ts"] {
            for entry in glob::glob(dist.join(pattern).to_str().unwrap()).map_err(|e| e.to_string())? {
                if let Ok(p) = entry {
                    if p.is_file() {
                        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                        let path_str = p.to_string_lossy().to_string();
                        let content = read_file_content(&p).unwrap_or_default();
                        files.push(ProtoFile { name, path: path_str, content });
                    }
                }
            }
        }
    } else if protocol_lower == "sdk" {
        // .d.ts files in dist/ excluding index.d.ts, utils/, enum/.
        // interfaces/ used to be excluded too, but the new parseSdkDts uses
        // those files to populate requestFields, so keep them in the payload.
        // Send the relative path from dist/ as `name` so the parser can apply
        // its own "is this a class file or an interface file?" filter.
        for entry in glob::glob(dist.join("**/*.d.ts").to_str().unwrap()).map_err(|e| e.to_string())? {
            if let Ok(p) = entry {
                if !p.is_file() {
                    continue;
                }
                let path_str = p.to_string_lossy().to_string();
                let rel = p.strip_prefix(&dist).unwrap_or(&p);
                let components: Vec<_> = rel.components().collect();

                // Exclude index.d.ts
                if components.last().map(|c| c.as_os_str().to_str()) == Some(Some("index.d.ts")) {
                    continue;
                }
                // Exclude utils/, enum/ subdirectories (still pure helpers).
                if components.iter().any(|c| {
                    c.as_os_str()
                        .to_str()
                        .map(|s| ["utils", "enum"].contains(&s))
                        .unwrap_or(false)
                }) {
                    continue;
                }

                let rel_name = rel.to_string_lossy().to_string();
                let content = read_file_content(&p).unwrap_or_default();
                files.push(ProtoFile { name: rel_name, path: path_str, content });
            }
        }
    }

    Ok(files)
}

#[tauri::command]
fn read_config<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> String {
    let mut paths_to_try: Vec<PathBuf> = Vec::new();

    if let Some(home) = dirs::home_dir() {
        paths_to_try.push(home.join(".penguin").join("config.json"));
        paths_to_try.push(home.join(".penguin.config.json"));
        // Legacy: users who still have the pre-rename file in their home.
        paths_to_try.push(home.join(".pengvi.config.json"));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        // Tauri rewrites `../foo` resource paths to `_up_/foo` inside the
        // bundled .app's Resources dir, so users installing the shipped DMG
        // need this path probed first. Without it the env dropdown comes up
        // empty for everyone except the developer who has the file in $HOME.
        paths_to_try.push(resource_dir.join("_up_").join(".penguin.config.json"));
        paths_to_try.push(resource_dir.join("_up_").join(".pengvi.config.json"));
        paths_to_try.push(resource_dir.join(".penguin.config.json"));
        paths_to_try.push(resource_dir.join(".pengvi.config.json"));
    }

    if let Ok(cwd) = std::env::current_dir() {
        paths_to_try.push(cwd.join(".penguin.config.json"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            paths_to_try.push(parent.join(".penguin.config.json"));
            if let Some(grandparent) = parent.parent() {
                paths_to_try.push(grandparent.join(".penguin.config.json"));
                paths_to_try.push(grandparent.join("Resources").join("_up_").join(".penguin.config.json"));
                paths_to_try.push(grandparent.join("Resources").join(".penguin.config.json"));
            }
        }
    }

    for path in &paths_to_try {
        if path.exists() {
            if let Ok(content) = fs::read_to_string(path) {
                return content;
            }
        }
    }

    String::new()
}

#[tauri::command]
async fn http_proxy(req: HttpProxyRequest) -> HttpProxyResponse {
    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(e) => {
            return HttpProxyResponse {
                status: 0,
                headers: HashMap::new(),
                body: String::new(),
                body_base64: String::new(),
                error: Some(e.to_string()),
            };
        }
    };

    let method = match req.method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => reqwest::Method::GET,
    };

    let mut request_builder = client.request(method, &req.url);

    for (k, v) in &req.headers {
        request_builder = request_builder.header(k, v);
    }

    let body: Option<Vec<u8>> = if let Some(ref b64) = req.body_base64 {
        match base64::engine::general_purpose::STANDARD.decode(b64) {
            Ok(b) => Some(b),
            Err(e) => {
                return HttpProxyResponse {
                    status: 0,
                    headers: HashMap::new(),
                    body: String::new(),
                    body_base64: String::new(),
                    error: Some(format!("Invalid base64 body: {}", e)),
                };
            }
        }
    } else if let Some(ref b) = req.body {
        Some(b.as_bytes().to_vec())
    } else {
        None
    };

    let request_builder = if let Some(b) = body {
        request_builder.body(b)
    } else {
        request_builder
    };

    let response = match request_builder.send().await {
        Ok(r) => r,
        Err(e) => {
            return HttpProxyResponse {
                status: 0,
                headers: HashMap::new(),
                body: String::new(),
                body_base64: String::new(),
                error: Some(e.to_string()),
            };
        }
    };

    let status = response.status().as_u16();
    let mut headers = HashMap::new();
    for (k, v) in response.headers() {
        if let Ok(v_str) = v.to_str() {
            headers.insert(k.as_str().to_string(), v_str.to_string());
        }
    }

    let bytes = match response.bytes().await {
        Ok(b) => b,
        Err(e) => {
            return HttpProxyResponse {
                status,
                headers,
                body: String::new(),
                body_base64: String::new(),
                error: Some(e.to_string()),
            };
        }
    };

    let body_str = String::from_utf8_lossy(&bytes).to_string();
    let body_base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    HttpProxyResponse {
        status,
        headers,
        body: body_str,
        body_base64,
        error: None,
    }
}

#[tauri::command]
fn read_package_bundle(protocol: String, package_name: String) -> Result<String, String> {
    let base_dir = penguin_packages_dir(&protocol)?;
    let pkg_path = if package_name.starts_with('@') {
        let parts: Vec<&str> = package_name.splitn(2, '/').collect();
        if parts.len() == 2 {
            base_dir.join("node_modules").join(parts[0]).join(parts[1])
        } else {
            base_dir.join("node_modules").join(&package_name)
        }
    } else {
        base_dir.join("node_modules").join(&package_name)
    };

    if !pkg_path.exists() {
        return Err(format!("Package {} not found", package_name));
    }

    let candidates = [
        pkg_path.join("dist").join("bundle.esm.js"),
        pkg_path.join("dist").join("bundle.js"),
        pkg_path.join("dist").join("bundle.cjs"),
        pkg_path.join("dist").join("index.js"),
        pkg_path.join("dist").join("index.esm.js"),
        pkg_path.join("dist").join("connect.js"),
    ];

    for path in &candidates {
        if path.exists() {
            return fs::read_to_string(path).map_err(|e| e.to_string());
        }
    }

    Err(format!(
        "No bundle found for {} (tried dist/bundle.esm.js, bundle.js, bundle.cjs, index.js, index.esm.js, connect.js)",
        package_name
    ))
}

#[tauri::command]
fn clear_all_packages() -> Result<String, String> {
    let protocols = ["grpc-web", "grpc", "sdk"];
    let mut cleared = Vec::new();

    for protocol in &protocols {
        let dir = penguin_packages_dir(protocol)?;
        let node_modules = dir.join("node_modules");
        if node_modules.exists() {
            fs::remove_dir_all(&node_modules).map_err(|e| e.to_string())?;
        }
        let lock = dir.join("package-lock.json");
        if lock.exists() {
            let _ = fs::remove_file(&lock);
        }

        let package_json = dir.join("package.json");
        let pkg = serde_json::json!({
            "name": "penguin-packages",
            "version": "1.0.0",
            "private": true
        });
        fs::write(&package_json, serde_json::to_string_pretty(&pkg).unwrap())
            .map_err(|e| e.to_string())?;

        cleared.push(*protocol);
    }

    Ok(format!("Cleared packages for: {}", cleared.join(", ")))
}

#[tauri::command]
fn copy_png_to_clipboard(base64_data: String) -> Result<(), String> {
    use base64::Engine;
    let png_bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_data)
        .map_err(|e| e.to_string())?;

    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let tmp_path = format!("/tmp/penguin-doc-{}.png", millis);

    std::fs::write(&tmp_path, &png_bytes).map_err(|e| e.to_string())?;

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(format!(
            "set the clipboard to (read (POSIX file \"{}\") as \u{00AB}class PNGf\u{00BB})",
            tmp_path
        ))
        .output()
        .map_err(|e| e.to_string())?;

    let _ = std::fs::remove_file(&tmp_path);

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

fn penguin_db_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    Ok(home.join(".penguin").join("penguin.sqlite3"))
}

fn open_product_db_at(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS app_kv (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS saved_requests (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            saved_at INTEGER NOT NULL,
            protocol TEXT NOT NULL,
            method_full_name TEXT NOT NULL,
            service_name TEXT NOT NULL,
            package_name TEXT NOT NULL,
            url TEXT NOT NULL,
            entry_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_saved_requests_saved_at
            ON saved_requests(saved_at DESC);
        "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

fn open_product_db() -> Result<Connection, String> {
    let path = penguin_db_path()?;
    open_product_db_at(&path)
}

fn unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[tauri::command]
fn db_set_app_value(key: String, value: String) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("app value key is required".to_string());
    }
    let conn = open_product_db()?;
    conn.execute(
        r#"
        INSERT INTO app_kv (key, value, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at
        "#,
        params![key, value, unix_millis()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_get_app_value(key: String) -> Result<Option<String>, String> {
    let conn = open_product_db()?;
    conn.query_row(
        "SELECT value FROM app_kv WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_list_app_values() -> Result<HashMap<String, String>, String> {
    let conn = open_product_db()?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM app_kv")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;

    let mut values = HashMap::new();
    for row in rows {
        let (key, value) = row.map_err(|e| e.to_string())?;
        values.insert(key, value);
    }
    Ok(values)
}

#[tauri::command]
fn db_delete_app_value(key: String) -> Result<(), String> {
    let conn = open_product_db()?;
    conn.execute("DELETE FROM app_kv WHERE key = ?1", params![key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn json_text(entry: &serde_json::Value, key: &str) -> String {
    entry
        .get(key)
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string()
}

fn json_i64(entry: &serde_json::Value, key: &str) -> i64 {
    entry
        .get(key)
        .and_then(|value| value.as_i64())
        .unwrap_or_default()
}

#[tauri::command]
fn db_upsert_saved_request(entry: serde_json::Value) -> Result<(), String> {
    let id = json_text(&entry, "id");
    if id.trim().is_empty() {
        return Err("saved request id is required".to_string());
    }

    let conn = open_product_db()?;
    let entry_json = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    conn.execute(
        r#"
        INSERT INTO saved_requests (
            id, name, saved_at, protocol, method_full_name,
            service_name, package_name, url, entry_json
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            saved_at = excluded.saved_at,
            protocol = excluded.protocol,
            method_full_name = excluded.method_full_name,
            service_name = excluded.service_name,
            package_name = excluded.package_name,
            url = excluded.url,
            entry_json = excluded.entry_json
        "#,
        params![
            id,
            json_text(&entry, "name"),
            json_i64(&entry, "savedAt"),
            json_text(&entry, "protocol"),
            json_text(&entry, "methodFullName"),
            json_text(&entry, "serviceName"),
            json_text(&entry, "packageName"),
            json_text(&entry, "url"),
            entry_json,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_list_saved_requests() -> Result<Vec<serde_json::Value>, String> {
    let conn = open_product_db()?;
    let mut stmt = conn
        .prepare("SELECT entry_json FROM saved_requests ORDER BY saved_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    for row in rows {
        let raw = row.map_err(|e| e.to_string())?;
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            entries.push(value);
        }
    }
    Ok(entries)
}

#[tauri::command]
fn db_delete_saved_request(id: String) -> Result<(), String> {
    let conn = open_product_db()?;
    conn.execute("DELETE FROM saved_requests WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn db_rename_saved_request(id: String, name: String) -> Result<(), String> {
    let conn = open_product_db()?;
    let raw: String = conn
        .query_row(
            "SELECT entry_json FROM saved_requests WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut entry: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if let Some(obj) = entry.as_object_mut() {
        obj.insert("name".to_string(), serde_json::Value::String(name.clone()));
    }
    let entry_json = serde_json::to_string(&entry).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE saved_requests SET name = ?1, entry_json = ?2 WHERE id = ?3",
        params![name, entry_json, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod product_db_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_db_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir()
            .join(format!("penguin-db-{name}-{nonce}"))
            .join("penguin.sqlite3")
    }

    #[test]
    fn product_db_schema_can_store_app_values() {
        let path = temp_db_path("kv");
        let conn = open_product_db_at(&path).unwrap();
        conn.execute(
            r#"
            INSERT INTO app_kv (key, value, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            "#,
            params!["penguin-theme", "dark", 10_i64],
        )
        .unwrap();

        let value: String = conn
            .query_row(
                "SELECT value FROM app_kv WHERE key = ?1",
                params!["penguin-theme"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "dark");

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }

    #[test]
    fn product_db_schema_can_store_saved_requests() {
        let path = temp_db_path("saved");
        let conn = open_product_db_at(&path).unwrap();
        conn.execute(
            r#"
            INSERT INTO saved_requests (
                id, name, saved_at, protocol, method_full_name,
                service_name, package_name, url, entry_json
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
            params![
                "saved_1",
                "Auth.login",
                10_i64,
                "grpc-web",
                "Auth.login",
                "Auth",
                "@snsoft/auth-grpc-web",
                "{{URL}}",
                r#"{"id":"saved_1","name":"Auth.login","savedAt":10}"#,
            ],
        )
        .unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM saved_requests", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);

        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}

// ---- MCP integration with local AI clients --------------------------------
// The MCP server JS (~/packages/mcp/dist/index.js) is bundled with the app as
// a Tauri resource. The Settings UI surfaces a one-click flow that writes a
// penguin entry into local MCP client configs pointing at that bundled file,
// merging without disturbing other servers.

fn claude_desktop_config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| {
        h.join("Library")
            .join("Application Support")
            .join("Claude")
            .join("claude_desktop_config.json")
    })
}

fn codex_config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".codex").join("config.toml"))
}

// Resolve the bundled MCP server path from the Tauri resource dir. Bundled at
// release time via tauri.conf.json `resources`; falls back to the workspace
// build output during `tauri dev`.
fn bundled_mcp_server_path<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    // Tauri rewrites resources declared with `../foo` to `_up_/foo` inside the
    // bundled .app's Resources directory (matches how .penguin.config.json is
    // shipped). Probe both the rewritten and the literal layout so this works
    // whether the resource is declared with a relative path or not.
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidates = [
            resource_dir.join("_up_/packages/mcp/dist/index.js"),
            resource_dir.join("packages/mcp/dist/index.js"),
            resource_dir.join("index.js"),
        ];
        for c in candidates {
            if c.exists() {
                return Ok(c);
            }
        }
    }
    // Dev mode fallback: walk up from the dev cwd until we find the workspace.
    if let Ok(cwd) = std::env::current_dir() {
        for ancestor in cwd.ancestors() {
            let candidate = ancestor.join("packages/mcp/dist/index.js");
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    Err("Bundled MCP server (packages/mcp/dist/index.js) not found".to_string())
}

// Best-effort search for a usable `node` binary. Tauri-spawned processes don't
// inherit the user's interactive PATH, so we have to look in the common nvm /
// homebrew / fnm / system locations explicitly.
fn detect_node_path() -> Option<PathBuf> {
    let candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }
    if let Some(home) = dirs::home_dir() {
        let nvm_dir = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            // Pick the latest (alphabetically-last) version; lexical sort is
            // close enough for v16/v18/v20 ordering.
            let mut versions: Vec<_> = entries.flatten().map(|e| e.path()).collect();
            versions.sort();
            if let Some(latest) = versions.last() {
                let node = latest.join("bin/node");
                if node.exists() {
                    return Some(node);
                }
            }
        }
    }
    None
}

fn claude_desktop_configured_at(cfg_path: &Path) -> bool {
    std::fs::read_to_string(cfg_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("mcpServers")?.get("penguin").cloned())
        .is_some()
}

fn write_claude_desktop_mcp_config_at(
    cfg_path: &Path,
    node: &Path,
    server: &Path,
) -> Result<(), String> {
    if let Some(parent) = cfg_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut root: serde_json::Value = if cfg_path.exists() {
        let raw = std::fs::read_to_string(cfg_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&raw).map_err(|e| format!("Existing config is not valid JSON: {e}"))?
    } else {
        serde_json::json!({})
    };

    if !root.is_object() {
        return Err("Existing config root is not a JSON object".to_string());
    }

    let servers = root
        .as_object_mut()
        .unwrap()
        .entry("mcpServers")
        .or_insert_with(|| serde_json::json!({}));

    if !servers.is_object() {
        return Err("mcpServers field exists but is not an object".to_string());
    }

    servers.as_object_mut().unwrap().insert(
        "penguin".to_string(),
        serde_json::json!({
            "command": node.to_string_lossy(),
            "args": [server.to_string_lossy()],
        }),
    );

    let pretty = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    std::fs::write(cfg_path, pretty).map_err(|e| e.to_string())
}

fn codex_mcp_configured_at(cfg_path: &Path) -> bool {
    let Ok(raw) = std::fs::read_to_string(cfg_path) else {
        return false;
    };
    let Ok(doc) = raw.parse::<DocumentMut>() else {
        return false;
    };

    doc.get("mcp_servers")
        .and_then(|servers| servers.as_table_like())
        .and_then(|servers| servers.get("penguin"))
        .and_then(|penguin| penguin.as_table_like())
        .and_then(|penguin| penguin.get("command"))
        .and_then(|command| command.as_str())
        .is_some()
}

#[derive(Debug)]
struct McpRuntimeHealth {
    healthy: bool,
    error: Option<String>,
}

fn parse_mcp_initialize_response(stdout: &str) -> Result<(), String> {
    for line in stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let server_name = value
            .get("result")
            .and_then(|result| result.get("serverInfo"))
            .and_then(|info| info.get("name"))
            .and_then(|name| name.as_str());
        if server_name == Some("penguin-mcp") {
            return Ok(());
        }
    }
    Err("MCP server did not return a valid initialize response".to_string())
}

fn check_mcp_server_runtime(node: &Path, server: &Path) -> McpRuntimeHealth {
    if !node.exists() {
        return McpRuntimeHealth {
            healthy: false,
            error: Some(format!("Node.js binary not found: {}", node.display())),
        };
    }
    if !server.exists() {
        return McpRuntimeHealth {
            healthy: false,
            error: Some(format!(
                "Bundled MCP server not found: {}",
                server.display()
            )),
        };
    }

    let mut child = match Command::new(node)
        .arg(server)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(e) => {
            return McpRuntimeHealth {
                healthy: false,
                error: Some(format!("Failed to start MCP server: {e}")),
            }
        }
    };

    const MCP_INITIALIZE_REQUEST: &str = r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"penguin-settings-check","version":"0.0.0"}}}"#;
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(e) = stdin.write_all(format!("{MCP_INITIALIZE_REQUEST}\n").as_bytes()) {
            let _ = child.kill();
            return McpRuntimeHealth {
                healthy: false,
                error: Some(format!("Failed to send MCP initialize request: {e}")),
            };
        }
    }

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) if started.elapsed() < Duration::from_millis(1500) => {
                std::thread::sleep(Duration::from_millis(25));
            }
            Ok(None) => {
                let _ = child.kill();
                let output = child.wait_with_output().ok();
                let stderr = output
                    .as_ref()
                    .map(|o| String::from_utf8_lossy(&o.stderr).trim().to_string())
                    .filter(|s| !s.is_empty());
                return McpRuntimeHealth {
                    healthy: false,
                    error: Some(stderr.unwrap_or_else(|| {
                        "MCP server did not answer initialize within 1500ms".to_string()
                    })),
                };
            }
            Err(e) => {
                let _ = child.kill();
                return McpRuntimeHealth {
                    healthy: false,
                    error: Some(format!("Failed while waiting for MCP server: {e}")),
                };
            }
        }
    }

    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(e) => {
            return McpRuntimeHealth {
                healthy: false,
                error: Some(format!("Failed to read MCP server output: {e}")),
            }
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return McpRuntimeHealth {
            healthy: false,
            error: Some(if stderr.is_empty() {
                format!("MCP server exited with status {}", output.status)
            } else {
                stderr
            }),
        };
    }

    match parse_mcp_initialize_response(&stdout) {
        Ok(()) => McpRuntimeHealth {
            healthy: true,
            error: None,
        },
        Err(e) => McpRuntimeHealth {
            healthy: false,
            error: Some(if stderr.is_empty() {
                e
            } else {
                format!("{e}. stderr: {stderr}")
            }),
        },
    }
}

fn write_codex_mcp_config_at(cfg_path: &Path, node: &Path, server: &Path) -> Result<(), String> {
    if let Some(parent) = cfg_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut doc = if cfg_path.exists() {
        let raw = std::fs::read_to_string(cfg_path).map_err(|e| e.to_string())?;
        if raw.trim().is_empty() {
            DocumentMut::new()
        } else {
            raw.parse::<DocumentMut>()
                .map_err(|e| format!("Existing Codex config is not valid TOML: {e}"))?
        }
    } else {
        DocumentMut::new()
    };

    let servers_item = doc
        .as_table_mut()
        .entry("mcp_servers")
        .or_insert_with(|| Item::Table(Table::new()));

    if !servers_item.is_table_like() {
        return Err("mcp_servers field exists but is not a TOML table".to_string());
    }

    let servers = servers_item
        .as_table_like_mut()
        .ok_or_else(|| "mcp_servers field exists but is not a TOML table".to_string())?;

    let mut args = Array::new();
    args.push(server.to_string_lossy().to_string());

    let mut penguin = Table::new();
    penguin["command"] = value(node.to_string_lossy().to_string());
    penguin["args"] = value(args);

    servers.insert("penguin", Item::Table(penguin));
    std::fs::write(cfg_path, doc.to_string()).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
struct McpStatus {
    server_name: String,
    bundled_server_path: Option<String>,
    node_path: Option<String>,
    server_healthy: bool,
    server_health_error: Option<String>,
    claude_desktop_config_path: Option<String>,
    claude_desktop_configured: bool,
    codex_config_path: Option<String>,
    codex_configured: bool,
}

#[tauri::command]
fn mcp_status<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> McpStatus {
    let bundled = bundled_mcp_server_path(&app).ok();
    let node = detect_node_path();
    let cfg_path = claude_desktop_config_path();
    let codex_cfg_path = codex_config_path();
    let server_health = match (&node, &bundled) {
        (Some(node), Some(server)) => check_mcp_server_runtime(node, server),
        (None, _) => McpRuntimeHealth {
            healthy: false,
            error: Some("Node.js not detected".to_string()),
        },
        (_, None) => McpRuntimeHealth {
            healthy: false,
            error: Some("Bundled MCP server missing".to_string()),
        },
    };

    let claude_configured = cfg_path
        .as_ref()
        .map(|p| claude_desktop_configured_at(p))
        .unwrap_or(false);
    let codex_configured = codex_cfg_path
        .as_ref()
        .map(|p| codex_mcp_configured_at(p))
        .unwrap_or(false);

    McpStatus {
        server_name: "penguin".to_string(),
        bundled_server_path: bundled.map(|p| p.to_string_lossy().to_string()),
        node_path: node.map(|p| p.to_string_lossy().to_string()),
        server_healthy: server_health.healthy,
        server_health_error: server_health.error,
        claude_desktop_config_path: cfg_path.map(|p| p.to_string_lossy().to_string()),
        claude_desktop_configured: claude_configured,
        codex_config_path: codex_cfg_path.map(|p| p.to_string_lossy().to_string()),
        codex_configured,
    }
}

#[tauri::command]
fn mcp_install_to_local_clients<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<String, String> {
    let server = bundled_mcp_server_path(&app)?;
    let node = detect_node_path().ok_or("Could not locate a node binary in common paths")?;
    let claude_cfg_path = claude_desktop_config_path().ok_or("No home directory")?;
    let codex_cfg_path = codex_config_path().ok_or("No home directory")?;

    write_claude_desktop_mcp_config_at(&claude_cfg_path, &node, &server)?;
    write_codex_mcp_config_at(&codex_cfg_path, &node, &server)?;

    Ok(format!(
        "Configured penguin MCP server for Claude Desktop ({}) and Codex CLI ({}). Restart both clients to pick it up.",
        claude_cfg_path.display(),
        codex_cfg_path.display()
    ))
}

#[cfg(test)]
mod mcp_config_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_config_path(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("penguin-mcp-{name}-{nonce}"));
        fs::create_dir_all(&dir).unwrap();
        dir.join("config.toml")
    }

    #[test]
    fn write_codex_mcp_config_preserves_existing_servers() {
        let cfg_path = temp_config_path("preserve");
        fs::write(
            &cfg_path,
            "[mcp_servers.github]\ncommand = \"github-mcp\"\nargs = [\"stdio\"]\n",
        )
        .unwrap();

        write_codex_mcp_config_at(
            &cfg_path,
            &PathBuf::from("/usr/local/bin/node"),
            &PathBuf::from(
                "/Applications/Penguin.app/Contents/Resources/_up_/packages/mcp/dist/index.js",
            ),
        )
        .unwrap();

        let saved = fs::read_to_string(&cfg_path).unwrap();
        assert!(saved.contains("[mcp_servers.github]"));
        assert!(saved.contains("[mcp_servers.penguin]"));
        assert!(saved.contains("command = \"/usr/local/bin/node\""));
        assert!(saved.contains("args = [\"/Applications/Penguin.app/Contents/Resources/_up_/packages/mcp/dist/index.js\"]"));
        assert!(codex_mcp_configured_at(&cfg_path));

        let _ = fs::remove_dir_all(cfg_path.parent().unwrap());
    }
}

// Watches ~/.penguin/ recursively and emits `packages-changed` whenever a
// node_modules tree changes. The frontend listens for this so newly-installed
// packages (including ones installed by the MCP server out-of-band) show up
// without a manual reload. Events are coalesced with a 500ms quiet window —
// `npm install` produces thousands of file events per package and we only want
// a single refresh once the dust settles.
fn start_package_watcher<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    let Some(home) = dirs::home_dir() else { return };
    let penguin_root = home.join(".penguin");
    if let Err(e) = fs::create_dir_all(&penguin_root) {
        eprintln!("watcher: cannot create {}: {}", penguin_root.display(), e);
        return;
    }

    std::thread::spawn(move || {
        let (tx, rx) = channel::<notify::Result<notify::Event>>();
        let mut watcher = match notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        }) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("watcher: failed to create: {}", e);
                return;
            }
        };

        if let Err(e) = watcher.watch(&penguin_root, RecursiveMode::Recursive) {
            eprintln!("watcher: failed to watch {}: {}", penguin_root.display(), e);
            return;
        }

        let debounce = Duration::from_millis(500);
        let mut pending = false;
        let mut last_event = Instant::now();

        loop {
            match rx.recv_timeout(debounce) {
                Ok(Ok(event)) => {
                    if matches!(event.kind, EventKind::Access(_)) {
                        continue;
                    }
                    let touched_node_modules = event.paths.iter().any(|p| {
                        p.components().any(|c| c.as_os_str() == "node_modules")
                    });
                    if touched_node_modules {
                        pending = true;
                        last_event = Instant::now();
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("watcher: event error: {}", e);
                }
                Err(RecvTimeoutError::Timeout) => {
                    if pending && last_event.elapsed() >= debounce {
                        let _ = app.emit("packages-changed", ());
                        pending = false;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}

pub fn run() {
    migrate_legacy_pengvi_dir();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            start_package_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ensure_packages_dir,
            get_packages_dir,
            list_installed_packages,
            read_config,
            http_proxy,
            read_package_bundle,
            clear_all_packages,
            copy_png_to_clipboard,
            db_set_app_value,
            db_get_app_value,
            db_list_app_values,
            db_delete_app_value,
            db_upsert_saved_request,
            db_list_saved_requests,
            db_delete_saved_request,
            db_rename_saved_request,
            mcp_status,
            mcp_install_to_local_clients,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
