use base64::Engine;
use notify::{event::EventKind, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::{Duration, Instant};

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
        // .d.ts files in dist/ excluding index.d.ts, interfaces/, utils/, enum/
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
                // Exclude interfaces/, utils/, enum/ subdirectories
                if components.iter().any(|c| {
                    c.as_os_str()
                        .to_str()
                        .map(|s| ["interfaces", "utils", "enum"].contains(&s))
                        .unwrap_or(false)
                }) {
                    continue;
                }

                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
                let content = read_file_content(&p).unwrap_or_default();
                files.push(ProtoFile { name, path: path_str, content });
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

// ---- MCP integration with Claude Desktop ---------------------------------
// The MCP server JS (~/packages/mcp/dist/index.js) is bundled with the app as
// a Tauri resource. The Settings UI surfaces a one-click flow that writes a
// pengvi entry into ~/Library/Application Support/Claude/claude_desktop_config.json
// pointing at that bundled file, merging without disturbing other servers.

fn claude_desktop_config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| {
        h.join("Library")
            .join("Application Support")
            .join("Claude")
            .join("claude_desktop_config.json")
    })
}

// Resolve the bundled MCP server path from the Tauri resource dir. Bundled at
// release time via tauri.conf.json `resources`; falls back to the workspace
// build output during `tauri dev`.
fn bundled_mcp_server_path<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
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

#[derive(serde::Serialize)]
struct McpStatus {
    server_name: String,
    bundled_server_path: Option<String>,
    node_path: Option<String>,
    claude_desktop_config_path: Option<String>,
    claude_desktop_configured: bool,
}

#[tauri::command]
fn mcp_status<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> McpStatus {
    let bundled = bundled_mcp_server_path(&app).ok();
    let node = detect_node_path();
    let cfg_path = claude_desktop_config_path();

    let configured = cfg_path
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .and_then(|v| v.get("mcpServers")?.get("penguin").cloned())
        .is_some();

    McpStatus {
        server_name: "penguin".to_string(),
        bundled_server_path: bundled.map(|p| p.to_string_lossy().to_string()),
        node_path: node.map(|p| p.to_string_lossy().to_string()),
        claude_desktop_config_path: cfg_path.map(|p| p.to_string_lossy().to_string()),
        claude_desktop_configured: configured,
    }
}

#[tauri::command]
fn mcp_install_to_claude_desktop<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<String, String> {
    let server = bundled_mcp_server_path(&app)?;
    let node = detect_node_path().ok_or("Could not locate a node binary in common paths")?;
    let cfg_path = claude_desktop_config_path().ok_or("No home directory")?;

    if let Some(parent) = cfg_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut root: serde_json::Value = if cfg_path.exists() {
        let raw = std::fs::read_to_string(&cfg_path).map_err(|e| e.to_string())?;
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
    std::fs::write(&cfg_path, pretty).map_err(|e| e.to_string())?;

    Ok(format!(
        "Added penguin MCP server to {}. Restart Claude Desktop to pick it up.",
        cfg_path.display()
    ))
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
            mcp_status,
            mcp_install_to_claude_desktop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
