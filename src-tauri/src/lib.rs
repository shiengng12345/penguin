mod mongo_workspace;
mod redis_workspace;

use base64::Engine;
use mongo_workspace::{
    mongo_add_connection, mongo_connect, mongo_delete_connection, mongo_disconnect,
    mongo_count_documents, mongo_delete_documents, mongo_find_documents, mongo_get_document, mongo_insert_document,
    mongo_list_collections, mongo_list_connections,
    mongo_list_databases, mongo_test_connection, mongo_update_connection, MongoWorkspaceManager,
    mongo_update_document,
};
use redis_workspace::{
    redis_add_connection, redis_connect, redis_db_size, redis_delete_connection, redis_delete_keys,
    redis_disconnect, redis_execute_command, redis_get_key_info, redis_get_key_value, redis_get_server_info,
    redis_list_connections, redis_rename_key, redis_scan_keys, redis_select_db,
    redis_set_key_value, redis_set_ttl, redis_test_connection, redis_update_connection,
    RedisWorkspaceManager,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use tauri::Manager;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerOverview {
    pub available: bool,
    pub context: Option<String>,
    pub context_endpoint: Option<String>,
    pub provider: Option<String>,
    pub provider_label: Option<String>,
    pub can_start_provider: bool,
    pub server_version: Option<String>,
    pub running_containers: u64,
    pub stopped_containers: u64,
    pub images: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerContextSummary {
    pub name: String,
    pub description: String,
    pub docker_endpoint: String,
    pub active: bool,
    pub provider: String,
    pub provider_label: String,
    pub can_start_provider: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainerSummary {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub state: String,
    pub ports: String,
    pub running_for: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerImageSummary {
    pub id: String,
    pub repository: String,
    pub tag: String,
    pub created_since: String,
    pub size: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerPortBinding {
    pub host_port: String,
    pub container_port: String,
    pub protocol: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerEnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerRunRequest {
    pub image: String,
    pub name: Option<String>,
    pub ports: Vec<DockerPortBinding>,
    pub environment: Vec<DockerEnvVar>,
    pub command: Option<String>,
    pub restart_policy: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerTerminalResult {
    pub command: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub success: bool,
}

#[derive(Debug, Deserialize)]
struct DockerInfoRow {
    #[serde(rename = "ServerVersion")]
    server_version: Option<String>,
    #[serde(rename = "ContainersRunning")]
    containers_running: Option<u64>,
    #[serde(rename = "ContainersStopped")]
    containers_stopped: Option<u64>,
    #[serde(rename = "Images")]
    images: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct DockerPsRow {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Names")]
    names: String,
    #[serde(rename = "Image")]
    image: String,
    #[serde(rename = "Status")]
    status: String,
    #[serde(rename = "State")]
    state: String,
    #[serde(rename = "Ports")]
    ports: String,
    #[serde(rename = "RunningFor")]
    running_for: String,
}

#[derive(Debug, Deserialize)]
struct DockerImagesRow {
    #[serde(rename = "ID")]
    id: String,
    #[serde(rename = "Repository")]
    repository: String,
    #[serde(rename = "Tag")]
    tag: String,
    #[serde(rename = "CreatedSince")]
    created_since: String,
    #[serde(rename = "Size")]
    size: String,
}

#[derive(Debug, Deserialize)]
struct DockerContextRow {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Description")]
    description: String,
    #[serde(rename = "DockerEndpoint")]
    docker_endpoint: String,
}

fn format_command_error(error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        "Docker CLI not found. Install Docker and make sure the `docker` command is in PATH."
            .to_string()
    } else {
        error.to_string()
    }
}

fn run_docker<I, S>(args: I) -> Result<std::process::Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    Command::new("docker")
        .args(args)
        .output()
        .map_err(format_command_error)
}

fn stdout_string(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stdout).to_string()
}

fn stderr_string(output: &std::process::Output) -> String {
    String::from_utf8_lossy(&output.stderr).to_string()
}

fn ensure_docker_success(output: std::process::Output) -> Result<std::process::Output, String> {
    if output.status.success() {
        Ok(output)
    } else {
        let stderr = stderr_string(&output);
        if stderr.trim().is_empty() {
            Err("Docker command failed without stderr output.".to_string())
        } else {
            Err(stderr.trim().to_string())
        }
    }
}

fn parse_json_lines<T: for<'de> Deserialize<'de>>(raw: &str) -> Result<Vec<T>, String> {
    let mut rows = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let row = serde_json::from_str::<T>(trimmed).map_err(|error| error.to_string())?;
        rows.push(row);
    }
    Ok(rows)
}

fn docker_ready() -> bool {
    run_docker(["info"])
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn current_docker_context_name() -> Option<String> {
    run_docker(["context", "show"])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| stdout_string(&output).trim().to_string())
        .filter(|value| !value.is_empty())
}

fn infer_docker_provider(name: &str, endpoint: &str) -> (&'static str, &'static str, bool) {
    let normalized_name = name.trim().to_lowercase();
    let normalized_endpoint = endpoint.trim().to_lowercase();

    if normalized_name.contains("colima") || normalized_endpoint.contains("colima") {
        ("colima", "Colima", true)
    } else if normalized_name.contains("desktop-linux")
        || normalized_endpoint.contains(".docker/run/docker.sock")
    {
        ("docker-desktop", "Docker Desktop", true)
    } else if normalized_name.contains("orbstack") || normalized_endpoint.contains("orbstack") {
        ("orbstack", "OrbStack", true)
    } else if normalized_endpoint.starts_with("tcp://") {
        ("remote", "Remote Docker Host", false)
    } else if normalized_endpoint.starts_with("ssh://") {
        ("ssh", "SSH Docker Host", false)
    } else if normalized_endpoint.starts_with("unix://") {
        ("custom-socket", "Custom Socket", false)
    } else {
        ("unknown", "Unknown Provider", false)
    }
}

fn docker_contexts() -> Result<Vec<DockerContextSummary>, String> {
    let output = ensure_docker_success(run_docker([
        "context",
        "ls",
        "--format",
        "{{json .}}",
    ])?)?;
    let rows = parse_json_lines::<DockerContextRow>(&stdout_string(&output))?;
    let active_name = current_docker_context_name();

    Ok(rows
        .into_iter()
        .map(|row| {
            let (provider, provider_label, can_start_provider) =
                infer_docker_provider(&row.name, &row.docker_endpoint);

            DockerContextSummary {
                active: active_name
                    .as_ref()
                    .map(|value| value == &row.name)
                    .unwrap_or(false),
                name: row.name,
                description: row.description,
                docker_endpoint: row.docker_endpoint,
                provider: provider.to_string(),
                provider_label: provider_label.to_string(),
                can_start_provider,
            }
        })
        .collect())
}

fn active_docker_context() -> Option<DockerContextSummary> {
    docker_contexts()
        .ok()
        .and_then(|contexts| contexts.into_iter().find(|context| context.active))
}

fn format_start_command_error(binary: &str, error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        format!(
            "{} is not installed or not available in PATH. Start your Docker provider manually and retry.",
            binary
        )
    } else {
        error.to_string()
    }
}

fn start_provider_process(context: &DockerContextSummary) -> Result<(), String> {
    match context.provider.as_str() {
        "docker-desktop" => {
            #[cfg(target_os = "macos")]
            {
                let output = Command::new("open")
                    .args(["-a", "Docker"])
                    .output()
                    .map_err(|error| format_start_command_error("Docker Desktop", error))?;

                if !output.status.success() {
                    let stderr = stderr_string(&output);
                    return Err(if stderr.trim().is_empty() {
                        "Failed to launch Docker Desktop.".to_string()
                    } else {
                        stderr.trim().to_string()
                    });
                }

                Ok(())
            }

            #[cfg(target_os = "windows")]
            {
                let output = Command::new("cmd")
                    .args(["/C", "start", "", "Docker Desktop"])
                    .output()
                    .map_err(|error| format_start_command_error("Docker Desktop", error))?;

                if !output.status.success() {
                    let stderr = stderr_string(&output);
                    return Err(if stderr.trim().is_empty() {
                        "Failed to launch Docker Desktop.".to_string()
                    } else {
                        stderr.trim().to_string()
                    });
                }

                Ok(())
            }

            #[cfg(target_os = "linux")]
            {
                let attempts = [
                    vec!["docker-desktop"],
                    vec!["systemctl", "--user", "start", "docker-desktop"],
                ];

                for attempt in attempts {
                    if let Ok(output) = Command::new(attempt[0]).args(&attempt[1..]).output() {
                        if output.status.success() {
                            return Ok(());
                        }
                    }
                }

                Err(
                    "Automatic Docker Desktop startup is not available on this Linux setup. Start your Docker daemon manually and retry."
                        .to_string(),
                )
            }
        }
        "colima" => {
            let output = Command::new("colima")
                .arg("start")
                .output()
                .map_err(|error| format_start_command_error("Colima", error))?;

            if output.status.success() {
                Ok(())
            } else {
                let stderr = stderr_string(&output);
                Err(if stderr.trim().is_empty() {
                    "Failed to start Colima.".to_string()
                } else {
                    stderr.trim().to_string()
                })
            }
        }
        "orbstack" => {
            #[cfg(target_os = "macos")]
            {
                let output = Command::new("open")
                    .args(["-a", "OrbStack"])
                    .output()
                    .map_err(|error| format_start_command_error("OrbStack", error))?;

                if output.status.success() {
                    Ok(())
                } else {
                    let stderr = stderr_string(&output);
                    Err(if stderr.trim().is_empty() {
                        "Failed to launch OrbStack.".to_string()
                    } else {
                        stderr.trim().to_string()
                    })
                }
            }

            #[cfg(not(target_os = "macos"))]
            {
                Err("Automatic OrbStack startup is only available on macOS.".to_string())
            }
        }
        _ => Err(format!(
            "Automatic startup is not available for the `{}` provider. Start it externally, then press Refresh.",
            context.provider_label
        )),
    }
}

#[tauri::command]
async fn docker_start_provider(context_name: Option<String>) -> Result<String, String> {
    let target_name = context_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let contexts = docker_contexts()?;
    let target_context = if let Some(name) = target_name {
        contexts
            .iter()
            .find(|context| context.name == name)
            .cloned()
            .ok_or_else(|| format!("Docker context `{}` was not found.", name))?
    } else {
        contexts
            .iter()
            .find(|context| context.active)
            .cloned()
            .ok_or_else(|| "No active Docker context found.".to_string())?
    };

    if !target_context.active {
        ensure_docker_success(run_docker([
            "context",
            "use",
            target_context.name.as_str(),
        ])?)?;
    }

    if docker_ready() {
        return Ok(format!(
            "{} is already reachable on the `{}` context.",
            target_context.provider_label, target_context.name
        ));
    }

    start_provider_process(&target_context)?;

    for _ in 0..45 {
        tokio::time::sleep(Duration::from_secs(1)).await;
        if docker_ready() {
            return Ok(format!(
                "{} is ready on the `{}` context.",
                target_context.provider_label, target_context.name
            ));
        }
    }

    Err(format!(
        "{} was started, but the Docker daemon is still not ready on the `{}` context. Give it a bit more time and press Refresh.",
        target_context.provider_label, target_context.name
    ))
}

#[tauri::command]
fn docker_overview() -> DockerOverview {
    let active_context = active_docker_context();
    let info_output = match run_docker(["info", "--format", "{{json .}}"]) {
        Ok(output) => output,
        Err(error) => {
            return DockerOverview {
                available: false,
                context: active_context.as_ref().map(|context| context.name.clone()),
                context_endpoint: active_context
                    .as_ref()
                    .map(|context| context.docker_endpoint.clone()),
                provider: active_context.as_ref().map(|context| context.provider.clone()),
                provider_label: active_context
                    .as_ref()
                    .map(|context| context.provider_label.clone()),
                can_start_provider: active_context
                    .as_ref()
                    .map(|context| context.can_start_provider)
                    .unwrap_or(false),
                server_version: None,
                running_containers: 0,
                stopped_containers: 0,
                images: 0,
                error: Some(error),
            };
        }
    };

    if !info_output.status.success() {
        return DockerOverview {
            available: false,
            context: active_context.as_ref().map(|context| context.name.clone()),
            context_endpoint: active_context
                .as_ref()
                .map(|context| context.docker_endpoint.clone()),
            provider: active_context.as_ref().map(|context| context.provider.clone()),
            provider_label: active_context
                .as_ref()
                .map(|context| context.provider_label.clone()),
            can_start_provider: active_context
                .as_ref()
                .map(|context| context.can_start_provider)
                .unwrap_or(false),
            server_version: None,
            running_containers: 0,
            stopped_containers: 0,
            images: 0,
            error: Some(stderr_string(&info_output).trim().to_string()),
        };
    }

    let info = serde_json::from_str::<DockerInfoRow>(stdout_string(&info_output).trim())
        .unwrap_or(DockerInfoRow {
            server_version: None,
            containers_running: Some(0),
            containers_stopped: Some(0),
            images: Some(0),
        });

    DockerOverview {
        available: true,
        context: active_context.as_ref().map(|context| context.name.clone()),
        context_endpoint: active_context
            .as_ref()
            .map(|context| context.docker_endpoint.clone()),
        provider: active_context.as_ref().map(|context| context.provider.clone()),
        provider_label: active_context
            .as_ref()
            .map(|context| context.provider_label.clone()),
        can_start_provider: active_context
            .as_ref()
            .map(|context| context.can_start_provider)
            .unwrap_or(false),
        server_version: info.server_version,
        running_containers: info.containers_running.unwrap_or(0),
        stopped_containers: info.containers_stopped.unwrap_or(0),
        images: info.images.unwrap_or(0),
        error: None,
    }
}

#[tauri::command]
fn docker_list_contexts() -> Result<Vec<DockerContextSummary>, String> {
    docker_contexts()
}

#[tauri::command]
fn docker_use_context(context_name: String) -> Result<String, String> {
    let trimmed_name = context_name.trim();
    if trimmed_name.is_empty() {
        return Err("Docker context name is required.".to_string());
    }

    ensure_docker_success(run_docker(["context", "use", trimmed_name])?)?;
    Ok(format!("Switched to Docker context `{}`.", trimmed_name))
}

#[tauri::command]
fn docker_list_containers(all: Option<bool>) -> Result<Vec<DockerContainerSummary>, String> {
    let mut args = vec!["ps"];
    if all.unwrap_or(true) {
        args.push("-a");
    }
    args.push("--format");
    args.push("{{json .}}");

    let output = ensure_docker_success(run_docker(args)?)?;
    let rows = parse_json_lines::<DockerPsRow>(&stdout_string(&output))?;

    Ok(rows
        .into_iter()
        .map(|row| DockerContainerSummary {
            id: row.id,
            name: row.names,
            image: row.image,
            status: row.status,
            state: row.state,
            ports: row.ports,
            running_for: row.running_for,
        })
        .collect())
}

#[tauri::command]
fn docker_list_images() -> Result<Vec<DockerImageSummary>, String> {
    let output = ensure_docker_success(run_docker([
        "images",
        "--format",
        "{{json .}}",
    ])?)?;

    let rows = parse_json_lines::<DockerImagesRow>(&stdout_string(&output))?;

    Ok(rows
        .into_iter()
        .map(|row| DockerImageSummary {
            id: row.id,
            repository: row.repository,
            tag: row.tag,
            created_since: row.created_since,
            size: row.size,
        })
        .collect())
}

#[tauri::command]
fn docker_container_action(container_id: String, action: String) -> Result<String, String> {
    let trimmed_action = action.trim().to_lowercase();
    let allowed = ["start", "stop", "restart", "remove"];
    if !allowed.contains(&trimmed_action.as_str()) {
        return Err(format!("Unsupported docker action: {}", action));
    }

    let args = if trimmed_action == "remove" {
        vec!["rm", "-f", container_id.as_str()]
    } else {
        vec![trimmed_action.as_str(), container_id.as_str()]
    };

    let output = ensure_docker_success(run_docker(args)?)?;
    let stdout = stdout_string(&output).trim().to_string();
    if stdout.is_empty() {
        Ok(format!("{} completed", trimmed_action))
    } else {
        Ok(stdout)
    }
}

#[tauri::command]
fn docker_container_logs(container_id: String, tail: Option<u32>) -> Result<String, String> {
    let tail_value = tail.unwrap_or(200).to_string();
    let output = ensure_docker_success(run_docker([
        "logs",
        "--tail",
        tail_value.as_str(),
        container_id.as_str(),
    ])?)?;

    Ok(format!(
        "{}{}",
        stdout_string(&output),
        stderr_string(&output)
    ))
}

#[tauri::command]
fn docker_container_inspect(container_id: String) -> Result<String, String> {
    let output = ensure_docker_success(run_docker([
        "inspect",
        container_id.as_str(),
    ])?)?;
    let parsed =
        serde_json::from_str::<serde_json::Value>(&stdout_string(&output)).map_err(|e| e.to_string())?;
    serde_json::to_string_pretty(&parsed).map_err(|e| e.to_string())
}

#[tauri::command]
fn docker_run_container(request: DockerRunRequest) -> Result<String, String> {
    if request.image.trim().is_empty() {
        return Err("Image is required.".to_string());
    }

    let mut args: Vec<String> = vec!["run".to_string(), "-d".to_string()];

    if let Some(name) = request.name.as_ref().map(|value| value.trim()).filter(|value| !value.is_empty()) {
        args.push("--name".to_string());
        args.push(name.to_string());
    }

    if let Some(policy) = request
        .restart_policy
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        args.push("--restart".to_string());
        args.push(policy.to_string());
    }

    for port in request.ports {
        if port.host_port.trim().is_empty() || port.container_port.trim().is_empty() {
            continue;
        }

        let protocol = port
            .protocol
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("tcp");

        args.push("-p".to_string());
        args.push(format!(
            "{}:{}/{}",
            port.host_port.trim(),
            port.container_port.trim(),
            protocol
        ));
    }

    for env_var in request.environment {
        if env_var.key.trim().is_empty() {
            continue;
        }
        args.push("-e".to_string());
        args.push(format!("{}={}", env_var.key.trim(), env_var.value));
    }

    args.push(request.image.trim().to_string());

    if let Some(command) = request
        .command
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        args.extend(command.split_whitespace().map(|part| part.to_string()));
    }

    let output = ensure_docker_success(run_docker(args)?)?;
    Ok(stdout_string(&output).trim().to_string())
}

#[tauri::command]
fn docker_terminal(command: String) -> Result<DockerTerminalResult, String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("Command is required.".to_string());
    }
    if trimmed != "docker" && !trimmed.starts_with("docker ") {
        return Err("Only docker commands are allowed in the Docker terminal.".to_string());
    }

    #[cfg(target_os = "windows")]
    let output = Command::new("cmd")
        .args(["/C", trimmed])
        .output()
        .map_err(format_command_error)?;

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("/bin/zsh")
        .args(["-lc", trimmed])
        .output()
        .map_err(format_command_error)?;

    Ok(DockerTerminalResult {
        command: trimmed.to_string(),
        stdout: stdout_string(&output),
        stderr: stderr_string(&output),
        exit_code: output.status.code().unwrap_or(-1),
        success: output.status.success(),
    })
}

fn pengvi_packages_dir(protocol: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not determine home directory")?;
    Ok(home.join(".pengvi").join(protocol))
}

#[tauri::command]
fn ensure_packages_dir(protocol: String) -> Result<String, String> {
    let dir = pengvi_packages_dir(&protocol)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let package_json = dir.join("package.json");
    if !package_json.exists() {
        let pkg = serde_json::json!({
            "name": "pengvi-packages",
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
    let dir = pengvi_packages_dir(&protocol)?;
    dir.to_str()
        .map(String::from)
        .ok_or_else(|| "Invalid path".to_string())
}

fn read_file_content(path: &std::path::Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_installed_packages(protocol: String) -> Result<Vec<InstalledPackage>, String> {
    let base_dir = pengvi_packages_dir(&protocol)?;
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
        paths_to_try.push(home.join(".pengvi").join("config.json"));
        paths_to_try.push(home.join(".pengvi.config.json"));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        paths_to_try.push(resource_dir.join(".pengvi.config.json"));
    }

    if let Ok(cwd) = std::env::current_dir() {
        paths_to_try.push(cwd.join(".pengvi.config.json"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            paths_to_try.push(parent.join(".pengvi.config.json"));
            if let Some(grandparent) = parent.parent() {
                paths_to_try.push(grandparent.join(".pengvi.config.json"));
                paths_to_try.push(grandparent.join("Resources").join(".pengvi.config.json"));
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
    let base_dir = pengvi_packages_dir(&protocol)?;
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
        let dir = pengvi_packages_dir(protocol)?;
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
            "name": "pengvi-packages",
            "version": "1.0.0",
            "private": true
        });
        fs::write(&package_json, serde_json::to_string_pretty(&pkg).unwrap())
            .map_err(|e| e.to_string())?;

        cleared.push(*protocol);
    }

    Ok(format!("Cleared packages for: {}", cleared.join(", ")))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(
            MongoWorkspaceManager::new().expect("Failed to initialize MongoDB workspace manager"),
        )
        .manage(
            RedisWorkspaceManager::new().expect("Failed to initialize Redis workspace manager"),
        )
        .invoke_handler(tauri::generate_handler![
            ensure_packages_dir,
            get_packages_dir,
            list_installed_packages,
            read_config,
            http_proxy,
            read_package_bundle,
            clear_all_packages,
            mongo_list_connections,
            mongo_add_connection,
            mongo_update_connection,
            mongo_delete_connection,
            mongo_test_connection,
            mongo_connect,
            mongo_disconnect,
            mongo_list_databases,
            mongo_list_collections,
            mongo_find_documents,
            mongo_count_documents,
            mongo_get_document,
            mongo_insert_document,
            mongo_update_document,
            mongo_delete_documents,
            redis_list_connections,
            redis_add_connection,
            redis_update_connection,
            redis_delete_connection,
            redis_test_connection,
            redis_connect,
            redis_disconnect,
            redis_get_server_info,
            redis_select_db,
            redis_db_size,
            redis_scan_keys,
            redis_get_key_info,
            redis_get_key_value,
            redis_set_key_value,
            redis_delete_keys,
            redis_rename_key,
            redis_set_ttl,
            redis_execute_command,
            docker_start_provider,
            docker_overview,
            docker_list_contexts,
            docker_use_context,
            docker_list_containers,
            docker_list_images,
            docker_container_action,
            docker_container_logs,
            docker_container_inspect,
            docker_run_container,
            docker_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
