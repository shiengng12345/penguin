use notify::{event::EventKind, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
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

    if let Some(home) = dirs::home_dir() {
        mirror_npmrc(&home.join(".npmrc"), &dir.join(".npmrc"));
    }

    dir.to_str()
        .map(String::from)
        .ok_or_else(|| "Invalid path".to_string())
}

// Mirror ~/.npmrc into the per-protocol package dir. npm resolves .npmrc
// walking UP from cwd, so a project-local file shadows the user-level one.
// Pengvi's install cwd is ~/.penguin/<protocol>/ — if we cached ~/.npmrc
// there once and never refreshed (the pre-1.10.1 behavior), users who
// rotated registry credentials would silently keep hitting the old ones
// via the stale snapshot: terminal `npm install` worked (used fresh
// ~/.npmrc) but Pengvi-spawned npm hit ERR_SOCKET_TIMEOUT.
//
// Semantics:
//   * global exists, local missing OR differs → copy global → local
//   * global exists, local already matches → no-op (don't churn mtime)
//   * global missing, local exists           → delete local snapshot
//   * neither exists                         → no-op
//
// Failures are intentionally swallowed — worst case the user falls back to
// the prior behavior (stale snapshot or no .npmrc); we never want this
// helper to abort ensure_packages_dir.
pub(crate) fn mirror_npmrc(global_npmrc: &Path, local_npmrc: &Path) {
    if global_npmrc.exists() {
        let global_bytes = fs::read(global_npmrc).ok();
        let local_bytes = fs::read(local_npmrc).ok();
        if global_bytes.is_some() && global_bytes != local_bytes {
            let _ = fs::copy(global_npmrc, local_npmrc);
        }
    } else if local_npmrc.exists() {
        let _ = fs::remove_file(local_npmrc);
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    // Each test gets its own scratch directory under std::env::temp_dir() so
    // they don't trip over each other when cargo runs in parallel.
    fn scratch_dir(label: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let pid = std::process::id();
        let dir = std::env::temp_dir().join(format!("penguin-npmrc-{label}-{pid}-{n}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create scratch dir");
        dir
    }

    #[test]
    fn mirror_copies_when_local_missing() {
        let dir = scratch_dir("copy");
        let global = dir.join("home.npmrc");
        let local = dir.join("local.npmrc");
        fs::write(&global, b"registry=https://new.example.com/\n").unwrap();

        mirror_npmrc(&global, &local);

        assert!(local.exists(), "local snapshot was not created");
        assert_eq!(fs::read(&local).unwrap(), fs::read(&global).unwrap());
    }

    #[test]
    fn mirror_refreshes_stale_local_after_credential_rotation() {
        // This is the v1.10.1 bug fix's load-bearing case: the user updated
        // ~/.npmrc with new credentials but Pengvi's local snapshot still
        // contains the old ones. Pre-fix this silently kept the stale copy.
        let dir = scratch_dir("rotate");
        let global = dir.join("home.npmrc");
        let local = dir.join("local.npmrc");
        fs::write(&global, b"OLD_TOKEN=abc\n").unwrap();
        fs::write(&local, b"OLD_TOKEN=abc\n").unwrap();

        // Simulate user rotating credentials in ~/.npmrc.
        fs::write(&global, b"NEW_TOKEN=xyz\nregistry=https://new.example.com/\n").unwrap();

        mirror_npmrc(&global, &local);

        let after = fs::read(&local).unwrap();
        assert_eq!(after, fs::read(&global).unwrap());
        assert!(
            String::from_utf8_lossy(&after).contains("NEW_TOKEN"),
            "local snapshot still contains stale credentials: {:?}",
            String::from_utf8_lossy(&after)
        );
    }

    #[test]
    fn mirror_is_noop_when_local_already_matches() {
        // Don't churn the file's mtime on every install — npm doesn't care
        // about mtime here, but flapping it makes log diagnosis harder and
        // would trip the file-watcher (packages-changed event) needlessly.
        let dir = scratch_dir("noop");
        let global = dir.join("home.npmrc");
        let local = dir.join("local.npmrc");
        fs::write(&global, b"same\n").unwrap();
        fs::write(&local, b"same\n").unwrap();

        let before_mtime = fs::metadata(&local).unwrap().modified().unwrap();
        // sleep tiny so mtime delta would be observable IF we wrote.
        std::thread::sleep(Duration::from_millis(20));

        mirror_npmrc(&global, &local);

        let after_mtime = fs::metadata(&local).unwrap().modified().unwrap();
        assert_eq!(
            before_mtime, after_mtime,
            "mirror touched local snapshot even though contents already match",
        );
    }

    #[test]
    fn mirror_deletes_local_when_global_removed() {
        // User deleted their ~/.npmrc (e.g. switched machines, scrubbed
        // creds). The cached snapshot is no longer authoritative — drop it
        // so npm falls back to its built-in defaults instead of stale state.
        let dir = scratch_dir("delete");
        let global = dir.join("home.npmrc");
        let local = dir.join("local.npmrc");
        fs::write(&local, b"orphaned snapshot\n").unwrap();
        assert!(!global.exists());

        mirror_npmrc(&global, &local);

        assert!(!local.exists(), "orphaned local snapshot was not removed");
    }

    #[test]
    fn mirror_is_noop_when_neither_exists() {
        // Fresh machine with no ~/.npmrc. We don't conjure a local file out
        // of thin air; npm will just use its defaults.
        let dir = scratch_dir("none");
        let global = dir.join("home.npmrc");
        let local = dir.join("local.npmrc");
        assert!(!global.exists());
        assert!(!local.exists());

        mirror_npmrc(&global, &local);

        assert!(!local.exists());
    }
}
