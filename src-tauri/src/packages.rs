use notify::{event::EventKind, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::{Duration, Instant};
use tauri::Emitter;

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

pub(crate) fn penguin_packages_dir(protocol: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    Ok(home.join(".penguin").join(protocol))
}

// One-shot migration for users upgrading from the "pengvi" naming: if their
// data still lives under ~/.pengvi and the new ~/.penguin doesn't exist yet,
// rename the whole tree in one atomic step. Same-filesystem mv is cheap and
// preserves inodes (so npm's cached extraction symlinks stay valid). Failures
// are logged but never fatal — worst case the user reinstalls a few packages.
pub(crate) fn migrate_legacy_pengvi_dir() {
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
pub(crate) fn ensure_packages_dir(protocol: String) -> Result<String, String> {
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
pub(crate) fn get_packages_dir(protocol: String) -> Result<String, String> {
    let dir = penguin_packages_dir(&protocol)?;
    dir.to_str()
        .map(String::from)
        .ok_or_else(|| "Invalid path".to_string())
}

fn read_file_content(path: &std::path::Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn list_installed_packages(protocol: String) -> Result<Vec<InstalledPackage>, String> {
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
pub(crate) fn read_package_bundle(protocol: String, package_name: String) -> Result<String, String> {
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
pub(crate) fn clear_all_packages() -> Result<String, String> {
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

// Watches ~/.penguin/ recursively and emits `packages-changed` whenever a
// node_modules tree changes. The frontend listens for this so newly-installed
// packages (including ones installed by the MCP server out-of-band) show up
// without a manual reload. Events are coalesced with a 500ms quiet window —
// `npm install` produces thousands of file events per package and we only want
// a single refresh once the dust settles.
pub(crate) fn start_package_watcher<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
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
