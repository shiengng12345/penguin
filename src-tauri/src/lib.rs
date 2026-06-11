use base64::engine::general_purpose::STANDARD;
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

const REGISTRY_AUTH_SUFFIX: &str = ":_auth=";
const REGISTRY_PROTOCOLS: [&str; 3] = ["grpc-web", "grpc", "sdk"];
const REGISTRY_STATUS_PROTOCOL: &str = "grpc-web";
const REGISTRY_NPMRC_FILE: &str = ".npmrc";
const REGISTRY_NPMRC_TMP_FILE: &str = ".npmrc.tmp";
const REGISTRY_AUTH_SEPARATOR: &str = ":";
const REGISTRY_AUTH_QUOTE: char = '"';
const REGISTRY_ERROR_SEPARATOR: &str = "; ";
const REGISTRY_INVALID_CREDENTIAL_CHARACTERS: [char; 3] = [':', '\n', '\r'];
const REGISTRY_INVALID_URL_CHARACTERS: [char; 2] = ['\n', '\r'];
const REGISTRY_EMPTY_CREDENTIAL_MESSAGE: &str = "请输入用户名和密码";
const REGISTRY_INVALID_CREDENTIAL_MESSAGE: &str = "用户名/密码不能包含 `:` `\\n` `\\r`";
const REGISTRY_EMPTY_URL_MESSAGE: &str = "请输入 Registry URL";
const REGISTRY_INVALID_URL_MESSAGE: &str = "Registry URL 必须以 http:// 或 https:// 开头";
const REGISTRY_WRITE_SUCCESS_MESSAGE: &str =
    "已保存（已更新 grpc-web / grpc / sdk 三个目录的 .npmrc）";
const REGISTRY_HTTP_PREFIX: &str = "http://";
const REGISTRY_HTTPS_PREFIX: &str = "https://";
const REGISTRY_URL_TRAILING_SLASH: char = '/';
const REGISTRY_SNSOFT_SCOPE_PREFIX: &str = "@snsoft:registry=";
const REGISTRY_SNSOFT_DEV_SCOPE_PREFIX: &str = "@snsoft-dev:registry=";

#[derive(Debug, Clone, Serialize)]
struct ConfiguredStatus {
    configured: bool,
    username: Option<String>,
    registry_url: Option<String>,
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

fn registry_unconfigured_status() -> ConfiguredStatus {
    eprintln!("INFO registry_unconfigured_status - entry");
    let status = ConfiguredStatus {
        configured: false,
        username: None,
        registry_url: None,
    };
    eprintln!("INFO registry_unconfigured_status - exit");
    status
}

fn registry_url_has_invalid_character(value: &str) -> bool {
    eprintln!("INFO registry_url_has_invalid_character - entry");
    let has_invalid_character = value
        .chars()
        .any(|character| REGISTRY_INVALID_URL_CHARACTERS.contains(&character));
    eprintln!(
        "INFO registry_url_has_invalid_character - exit invalid={}",
        has_invalid_character
    );
    has_invalid_character
}

fn normalize_registry_url(raw: &str) -> String {
    eprintln!("INFO normalize_registry_url - entry");
    let trimmed = raw.trim();
    let already_has_trailing_slash = trimmed.ends_with(REGISTRY_URL_TRAILING_SLASH);
    // 业务原因：npm scope registry 行约定以斜线结尾，缺斜线会导致 npm 拼接路径错。
    let normalized = if already_has_trailing_slash {
        trimmed.to_string()
    } else {
        format!("{trimmed}{REGISTRY_URL_TRAILING_SLASH}")
    };
    eprintln!("INFO normalize_registry_url - exit");
    normalized
}

fn derive_registry_auth_key(registry_url: &str) -> String {
    eprintln!("INFO derive_registry_auth_key - entry");
    let url_without_scheme = registry_url
        .strip_prefix(REGISTRY_HTTPS_PREFIX)
        .or_else(|| registry_url.strip_prefix(REGISTRY_HTTP_PREFIX))
        .unwrap_or(registry_url);
    let key = format!("//{url_without_scheme}{REGISTRY_AUTH_SUFFIX}");
    eprintln!("INFO derive_registry_auth_key - exit");
    key
}

fn derive_registry_scope_lines(registry_url: &str) -> [String; 2] {
    eprintln!("INFO derive_registry_scope_lines - entry");
    let scope_main = format!("{REGISTRY_SNSOFT_SCOPE_PREFIX}{registry_url}");
    let scope_dev = format!("{REGISTRY_SNSOFT_DEV_SCOPE_PREFIX}{registry_url}");
    eprintln!("INFO derive_registry_scope_lines - exit");
    [scope_main, scope_dev]
}

fn derive_registry_url_from_auth_line(line: &str) -> Option<String> {
    eprintln!("INFO derive_registry_url_from_auth_line - entry");
    let stripped_leading_slashes = line.strip_prefix("//")?;
    let auth_suffix_position = stripped_leading_slashes.find(REGISTRY_AUTH_SUFFIX)?;
    let url_without_scheme = &stripped_leading_slashes[..auth_suffix_position];
    let reconstructed = format!("{REGISTRY_HTTP_PREFIX}{url_without_scheme}");
    eprintln!("INFO derive_registry_url_from_auth_line - exit");
    Some(reconstructed)
}

fn registry_credential_has_invalid_character(value: &str) -> bool {
    eprintln!("INFO registry_credential_has_invalid_character - entry");
    let has_invalid_character = value
        .chars()
        .any(|character| REGISTRY_INVALID_CREDENTIAL_CHARACTERS.contains(&character));
    eprintln!(
        "INFO registry_credential_has_invalid_character - exit invalid={}",
        has_invalid_character
    );
    has_invalid_character
}

fn encode_registry_auth_value(username: &str, password: &str) -> String {
    eprintln!(
        "INFO encode_registry_auth_value - entry username={}",
        username
    );
    let credential = format!("{username}{REGISTRY_AUTH_SEPARATOR}{password}");
    let encoded = STANDARD.encode(credential);
    eprintln!("INFO encode_registry_auth_value - exit");
    encoded
}

fn read_optional_registry_npmrc(path: &Path) -> Result<String, String> {
    eprintln!(
        "INFO read_optional_registry_npmrc - entry path={}",
        path.display()
    );
    match fs::read_to_string(path) {
        Ok(content) => {
            eprintln!("INFO read_optional_registry_npmrc - exit found=true");
            Ok(content)
        }
        Err(error) => {
            let file_is_missing = error.kind() == std::io::ErrorKind::NotFound;
            // 业务原因：首次配置可能还没有 .npmrc，此时应从空文件内容开始生成。
            if file_is_missing {
                eprintln!(
                    "WARN read_optional_registry_npmrc - .npmrc 不存在，使用空内容 path={}",
                    path.display()
                );
                eprintln!("INFO read_optional_registry_npmrc - exit found=false");
                return Ok(String::new());
            }
            eprintln!(
                "ERROR read_optional_registry_npmrc - 读取 .npmrc 失败 path={} error={}",
                path.display(),
                error
            );
            Err(error.to_string())
        }
    }
}

fn write_registry_npmrc_for_protocol(
    protocol: &str,
    auth_key: &str,
    auth_line: &str,
    scope_lines: &[String; 2],
) -> Result<(), String> {
    eprintln!(
        "INFO write_registry_npmrc_for_protocol - entry protocol={}",
        protocol
    );
    let dir = ensure_packages_dir(protocol.to_string())?;
    let dir_path = PathBuf::from(dir);
    let npmrc_path = dir_path.join(REGISTRY_NPMRC_FILE);
    let tmp_path = dir_path.join(REGISTRY_NPMRC_TMP_FILE);
    let content = read_optional_registry_npmrc(&npmrc_path)?;
    let mut auth_replaced = false;
    let mut lines: Vec<String> = Vec::new();

    for line in content.lines() {
        let is_auth_line = line.starts_with(auth_key);
        let is_stale_snsoft_scope_line =
            line.starts_with(REGISTRY_SNSOFT_SCOPE_PREFIX) && line != scope_lines[0];
        let is_stale_snsoft_dev_scope_line =
            line.starts_with(REGISTRY_SNSOFT_DEV_SCOPE_PREFIX) && line != scope_lines[1];
        let is_stale_scope_line = is_stale_snsoft_scope_line || is_stale_snsoft_dev_scope_line;
        // 业务原因：Sonatype token 轮换后必须覆盖旧 _auth 行，避免 npm 继续用失效凭证。
        if is_auth_line {
            eprintln!(
                "WARN write_registry_npmrc_for_protocol - 替换旧 registry auth protocol={}",
                protocol
            );
            lines.push(auth_line.to_string());
            auth_replaced = true;
            continue;
        }
        // 业务原因：用户改了 Registry URL 后，旧的 @snsoft scope 行还指向旧 URL，会导致 npm 路由错误，必须丢弃。
        if is_stale_scope_line {
            eprintln!(
                "WARN write_registry_npmrc_for_protocol - 丢弃旧 scope 行 protocol={}",
                protocol
            );
            continue;
        }
        lines.push(line.to_string());
    }

    let auth_line_is_missing = auth_replaced == false;
    // 业务原因：缺少 registry auth 行时必须补上，否则安装内部包仍会 401。
    if auth_line_is_missing {
        eprintln!(
            "WARN write_registry_npmrc_for_protocol - 追加 registry auth protocol={}",
            protocol
        );
        lines.push(auth_line.to_string());
    }

    for scope_line in scope_lines.iter().rev() {
        let scope_line_exists = lines.iter().any(|line| line == scope_line);
        let scope_line_is_missing = scope_line_exists == false;
        // 业务原因：内部包作用域必须显式指向 Nexus，避免 npm 走默认公网 registry。
        if scope_line_is_missing {
            eprintln!(
                "WARN write_registry_npmrc_for_protocol - 补齐 scope registry protocol={}",
                protocol
            );
            lines.insert(0, scope_line.to_string());
        }
    }

    let output = format!("{}\n", lines.join("\n"));
    fs::write(&tmp_path, output).map_err(|error| error.to_string())?;
    fs::rename(&tmp_path, &npmrc_path).map_err(|error| error.to_string())?;
    eprintln!(
        "INFO write_registry_npmrc_for_protocol - exit protocol={}",
        protocol
    );
    Ok(())
}

#[tauri::command]
fn write_registry_npmrc(
    registry_url: String,
    username: String,
    password: String,
) -> Result<String, String> {
    eprintln!("INFO write_registry_npmrc - entry username={}", username);

    let registry_url_trimmed = registry_url.trim();
    let registry_url_is_empty = registry_url_trimmed.is_empty();
    // 业务原因：空 URL 无法构造 npm _auth key 与 scope 行。
    if registry_url_is_empty {
        eprintln!("WARN write_registry_npmrc - registry url 为空");
        return Err(REGISTRY_EMPTY_URL_MESSAGE.to_string());
    }

    let url_starts_with_http = registry_url_trimmed.starts_with(REGISTRY_HTTP_PREFIX);
    let url_starts_with_https = registry_url_trimmed.starts_with(REGISTRY_HTTPS_PREFIX);
    let url_scheme_is_valid = url_starts_with_http || url_starts_with_https;
    // 业务原因：限定 http/https 防止 shell 注入（npm 也只识别这两种）。
    if !url_scheme_is_valid {
        eprintln!("WARN write_registry_npmrc - registry url scheme 非法");
        return Err(REGISTRY_INVALID_URL_MESSAGE.to_string());
    }

    let url_has_invalid_character = registry_url_has_invalid_character(registry_url_trimmed);
    // 业务原因：URL 含换行会破坏 .npmrc 行结构。
    if url_has_invalid_character {
        eprintln!("WARN write_registry_npmrc - registry url 含非法字符");
        return Err(REGISTRY_INVALID_URL_MESSAGE.to_string());
    }

    let username_is_empty = username.is_empty();
    // 业务原因：空用户名无法生成有效 Nexus 凭证，必须在写盘前拒绝。
    if username_is_empty {
        eprintln!("WARN write_registry_npmrc - 用户名为空");
        return Err(REGISTRY_EMPTY_CREDENTIAL_MESSAGE.to_string());
    }

    let password_is_empty = password.is_empty();
    // 业务原因：空密码无法生成有效 Nexus 凭证，必须在写盘前拒绝。
    if password_is_empty {
        eprintln!("WARN write_registry_npmrc - 密码为空");
        return Err(REGISTRY_EMPTY_CREDENTIAL_MESSAGE.to_string());
    }

    let username_has_invalid_character = registry_credential_has_invalid_character(&username);
    // 业务原因：用户名进入 username:password 拼接格式，非法字符会破坏 npm _auth。
    if username_has_invalid_character {
        eprintln!("WARN write_registry_npmrc - 用户名包含非法字符");
        return Err(REGISTRY_INVALID_CREDENTIAL_MESSAGE.to_string());
    }

    let password_has_invalid_character = registry_credential_has_invalid_character(&password);
    // 业务原因：密码进入 username:password 拼接格式，非法字符会破坏 npm _auth。
    if password_has_invalid_character {
        eprintln!("WARN write_registry_npmrc - 密码包含非法字符");
        return Err(REGISTRY_INVALID_CREDENTIAL_MESSAGE.to_string());
    }

    let normalized_url = normalize_registry_url(registry_url_trimmed);
    let auth_key = derive_registry_auth_key(&normalized_url);
    let scope_lines = derive_registry_scope_lines(&normalized_url);
    let auth_value = encode_registry_auth_value(&username, &password);
    let auth_line = format!("{auth_key}{auth_value}");
    let mut errors: Vec<String> = Vec::new();

    for protocol in REGISTRY_PROTOCOLS {
        match write_registry_npmrc_for_protocol(protocol, &auth_key, &auth_line, &scope_lines) {
            Ok(()) => {
                eprintln!("INFO write_registry_npmrc - protocol saved {}", protocol);
            }
            Err(error) => {
                eprintln!(
                    "ERROR write_registry_npmrc - protocol failed {} error={}",
                    protocol, error
                );
                errors.push(format!("{protocol}: {error}"));
            }
        }
    }

    let has_errors = errors.len() > 0;
    // 业务原因：任一协议目录写入失败都会导致安装链路仍可能 401，必须把失败明细返回给 UI。
    if has_errors {
        let joined_errors = errors.join(REGISTRY_ERROR_SEPARATOR);
        eprintln!(
            "WARN write_registry_npmrc - partial failure {}",
            joined_errors
        );
        return Err(joined_errors);
    }

    eprintln!("INFO write_registry_npmrc - exit success");
    Ok(REGISTRY_WRITE_SUCCESS_MESSAGE.to_string())
}

fn read_registry_npmrc_status_inner() -> ConfiguredStatus {
    eprintln!("INFO read_registry_npmrc_status_inner - entry");
    let dir = match penguin_packages_dir(REGISTRY_STATUS_PROTOCOL) {
        Ok(dir) => dir,
        Err(error) => {
            eprintln!(
                "WARN read_registry_npmrc_status_inner - 无法定位目录 error={}",
                error
            );
            return registry_unconfigured_status();
        }
    };
    let npmrc_path = dir.join(REGISTRY_NPMRC_FILE);
    let content = match fs::read_to_string(&npmrc_path) {
        Ok(content) => content,
        Err(error) => {
            eprintln!(
                "WARN read_registry_npmrc_status_inner - 无法读取 .npmrc path={} error={}",
                npmrc_path.display(),
                error
            );
            return registry_unconfigured_status();
        }
    };
    let auth_line = match content
        .lines()
        .find(|line| line.starts_with("//") && line.contains(REGISTRY_AUTH_SUFFIX))
    {
        Some(line) => line,
        None => {
            eprintln!("WARN read_registry_npmrc_status_inner - 未找到 registry auth 行");
            return registry_unconfigured_status();
        }
    };
    let recovered_registry_url = match derive_registry_url_from_auth_line(auth_line) {
        Some(url) => url,
        None => {
            eprintln!(
                "WARN read_registry_npmrc_status_inner - 无法从 auth 行还原 registry url"
            );
            return registry_unconfigured_status();
        }
    };
    let auth_suffix_position = match auth_line.find(REGISTRY_AUTH_SUFFIX) {
        Some(position) => position,
        None => {
            eprintln!(
                "WARN read_registry_npmrc_status_inner - auth 行缺少 _auth= 分隔符"
            );
            return registry_unconfigured_status();
        }
    };
    let encoded_auth = auth_line[auth_suffix_position + REGISTRY_AUTH_SUFFIX.len()..]
        .trim()
        .trim_matches(REGISTRY_AUTH_QUOTE);
    let decoded_bytes = match STANDARD.decode(encoded_auth) {
        Ok(bytes) => bytes,
        Err(error) => {
            eprintln!(
                "WARN read_registry_npmrc_status_inner - registry auth base64 解码失败 error={}",
                error
            );
            return registry_unconfigured_status();
        }
    };
    let decoded_text = match String::from_utf8(decoded_bytes) {
        Ok(text) => text,
        Err(error) => {
            eprintln!(
                "WARN read_registry_npmrc_status_inner - registry auth 不是有效 UTF-8 error={}",
                error
            );
            return registry_unconfigured_status();
        }
    };
    let username = match decoded_text.split_once(REGISTRY_AUTH_SEPARATOR) {
        Some((username, _password)) => username,
        None => {
            eprintln!("WARN read_registry_npmrc_status_inner - registry auth 缺少分隔符");
            return registry_unconfigured_status();
        }
    };
    let username_is_empty = username.is_empty();
    // 业务原因：空用户名不能代表已配置凭证，必须按未配置展示。
    if username_is_empty {
        eprintln!("WARN read_registry_npmrc_status_inner - registry auth 用户名为空");
        return registry_unconfigured_status();
    }

    let status = ConfiguredStatus {
        configured: true,
        username: Some(username.to_string()),
        registry_url: Some(recovered_registry_url),
    };
    eprintln!("INFO read_registry_npmrc_status_inner - exit configured=true");
    status
}

#[tauri::command]
fn read_registry_npmrc_status() -> Result<ConfiguredStatus, String> {
    eprintln!("INFO read_registry_npmrc_status - entry");
    let status = read_registry_npmrc_status_inner();
    eprintln!(
        "INFO read_registry_npmrc_status - exit configured={}",
        status.configured
    );
    Ok(status)
}

#[cfg(test)]
mod registry_auth_tests {
    use super::*;

    const TEST_USERNAME: &str = "alice";
    const TEST_PASSWORD: &str = "secret";
    const TEST_CREDENTIAL: &str = "alice:secret";

    #[test]
    fn encode_registry_auth_value_uses_username_colon_password() -> Result<(), String> {
        let encoded = encode_registry_auth_value(TEST_USERNAME, TEST_PASSWORD);
        let decoded_bytes = STANDARD
            .decode(encoded)
            .map_err(|error| error.to_string())?;
        let decoded_text = String::from_utf8(decoded_bytes).map_err(|error| error.to_string())?;
        assert_eq!(decoded_text, TEST_CREDENTIAL);
        Ok(())
    }

    #[test]
    fn derive_registry_auth_key_strips_http_scheme() {
        let key =
            derive_registry_auth_key("http://sonatype.client88.me/repository/npm_hosted/");
        assert_eq!(key, "//sonatype.client88.me/repository/npm_hosted/:_auth=");
    }

    #[test]
    fn derive_registry_auth_key_strips_https_scheme() {
        let key = derive_registry_auth_key("https://nexus.example.com/repo/");
        assert_eq!(key, "//nexus.example.com/repo/:_auth=");
    }

    #[test]
    fn derive_registry_scope_lines_uses_both_scopes() {
        let lines =
            derive_registry_scope_lines("http://sonatype.client88.me/repository/npm_hosted/");
        assert_eq!(
            lines[0],
            "@snsoft:registry=http://sonatype.client88.me/repository/npm_hosted/"
        );
        assert_eq!(
            lines[1],
            "@snsoft-dev:registry=http://sonatype.client88.me/repository/npm_hosted/"
        );
    }

    #[test]
    fn derive_registry_url_from_auth_line_roundtrips() {
        let line = "//sonatype.client88.me/repository/npm_hosted/:_auth=YWRtaW46c25zb2Z0MTIz";
        let url = derive_registry_url_from_auth_line(line).expect("expected url");
        assert_eq!(url, "http://sonatype.client88.me/repository/npm_hosted/");
    }

    #[test]
    fn derive_registry_url_from_auth_line_rejects_non_auth_line() {
        let line = "@snsoft:registry=http://sonatype.client88.me/repository/npm_hosted/";
        let url = derive_registry_url_from_auth_line(line);
        assert!(url.is_none());
    }

    #[test]
    fn normalize_registry_url_appends_trailing_slash() {
        let normalized = normalize_registry_url("http://nexus.example.com/repo");
        assert_eq!(normalized, "http://nexus.example.com/repo/");
    }

    #[test]
    fn normalize_registry_url_preserves_trailing_slash() {
        let normalized = normalize_registry_url("http://nexus.example.com/repo/");
        assert_eq!(normalized, "http://nexus.example.com/repo/");
    }
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
        CREATE TABLE IF NOT EXISTS request_history (
            id TEXT PRIMARY KEY,
            timestamp INTEGER NOT NULL,
            protocol TEXT NOT NULL,
            method_full_name TEXT NOT NULL,
            service_name TEXT NOT NULL,
            package_name TEXT NOT NULL,
            url TEXT NOT NULL,
            entry_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_request_history_timestamp
            ON request_history(timestamp DESC);
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

// History lives in its own table (one row per request, full response JSON in
// entry_json) instead of a single app_kv blob, so the frontend can page and
// search without hydrating the entire archive at boot.
fn put_history_entry_at(
    conn: &Connection,
    entry: &serde_json::Value,
    max_size: i64,
) -> Result<(), String> {
    let id = json_text(entry, "id");
    if id.trim().is_empty() {
        return Err("history entry id is required".to_string());
    }
    let entry_json = serde_json::to_string(entry).map_err(|e| e.to_string())?;
    conn.execute(
        r#"
        INSERT INTO request_history (
            id, timestamp, protocol, method_full_name,
            service_name, package_name, url, entry_json
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(id) DO UPDATE SET
            timestamp = excluded.timestamp,
            protocol = excluded.protocol,
            method_full_name = excluded.method_full_name,
            service_name = excluded.service_name,
            package_name = excluded.package_name,
            url = excluded.url,
            entry_json = excluded.entry_json
        "#,
        params![
            id,
            json_i64(entry, "timestamp"),
            json_text(entry, "protocol"),
            json_text(entry, "methodFullName"),
            json_text(entry, "serviceName"),
            json_text(entry, "packageName"),
            json_text(entry, "url"),
            entry_json,
        ],
    )
    .map_err(|e| e.to_string())?;

    if max_size > 0 {
        conn.execute(
            r#"
            DELETE FROM request_history WHERE id NOT IN (
                SELECT id FROM request_history ORDER BY timestamp DESC LIMIT ?1
            )
            "#,
            params![max_size],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn db_put_history_entry(entry: serde_json::Value, max_size: i64) -> Result<(), String> {
    let conn = open_product_db()?;
    put_history_entry_at(&conn, &entry, max_size)
}

fn history_like_pattern(query: &str) -> String {
    format!("%{}%", query.trim().to_lowercase())
}

#[tauri::command]
fn db_list_history(
    limit: i64,
    offset: i64,
    query: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let conn = open_product_db()?;
    let limit = limit.clamp(1, 500);
    let offset = offset.max(0);

    let mut entries = Vec::new();
    let mut push_row = |raw: String| {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
            entries.push(value);
        }
    };

    match query.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
        Some(q) => {
            let pattern = history_like_pattern(q);
            let mut stmt = conn
                .prepare(
                    r#"
                    SELECT entry_json FROM request_history
                    WHERE lower(method_full_name) LIKE ?1
                       OR lower(service_name) LIKE ?1
                       OR lower(package_name) LIKE ?1
                       OR lower(url) LIKE ?1
                    ORDER BY timestamp DESC LIMIT ?2 OFFSET ?3
                    "#,
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![pattern, limit, offset], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(|e| e.to_string())?;
            for row in rows {
                push_row(row.map_err(|e| e.to_string())?);
            }
        }
        None => {
            let mut stmt = conn
                .prepare(
                    "SELECT entry_json FROM request_history ORDER BY timestamp DESC LIMIT ?1 OFFSET ?2",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![limit, offset], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            for row in rows {
                push_row(row.map_err(|e| e.to_string())?);
            }
        }
    }
    Ok(entries)
}

#[tauri::command]
fn db_count_history() -> Result<i64, String> {
    let conn = open_product_db()?;
    conn.query_row("SELECT COUNT(*) FROM request_history", [], |row| row.get(0))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_clear_history() -> Result<(), String> {
    let conn = open_product_db()?;
    conn.execute("DELETE FROM request_history", [])
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
    fn history_rows_round_trip_with_response_and_trim() {
        let path = temp_db_path("history");
        let conn = open_product_db_at(&path).unwrap();

        for i in 0..5 {
            let entry = serde_json::json!({
                "id": format!("hist_{i}"),
                "timestamp": i * 10,
                "protocol": "grpc",
                "methodFullName": format!("pkg.Svc.Method{i}"),
                "serviceName": "Svc",
                "packageName": "@snsoft/pkg",
                "url": "http://localhost:5006",
                "requestBody": "{}",
                "response": { "status": "OK", "statusCode": 200, "body": "{\"x\":1}" },
            });
            put_history_entry_at(&conn, &entry, 3).unwrap();
        }

        // Trimmed to max_size=3, newest first.
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM request_history", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 3);

        let newest: String = conn
            .query_row(
                "SELECT entry_json FROM request_history ORDER BY timestamp DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&newest).unwrap();
        assert_eq!(parsed["id"], "hist_4");
        // Full response archived with the row.
        assert_eq!(parsed["response"]["statusCode"], 200);

        // Upsert by id replaces instead of duplicating.
        let updated = serde_json::json!({
            "id": "hist_4",
            "timestamp": 40,
            "protocol": "grpc",
            "methodFullName": "pkg.Svc.Method4",
            "serviceName": "Svc",
            "packageName": "@snsoft/pkg",
            "url": "http://localhost:5006",
            "response": { "status": "ERROR", "statusCode": 500 },
        });
        put_history_entry_at(&conn, &updated, 3).unwrap();
        let count_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM request_history", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count_after, 3);

        let _ = fs::remove_dir_all(path.parent().unwrap());
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

// Claude Code (the CLI) keeps user-scope MCP servers in ~/.claude.json under
// the same `mcpServers` shape as Claude Desktop, so the desktop merge/check
// helpers are reused for it.
fn claude_code_config_path() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude.json"))
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

// Parse "v18.20.8"-style directory names into a sortable tuple. Returns None
// for non-version entries (e.g. ".DS_Store").
fn parse_node_version(name: &str) -> Option<(u64, u64, u64)> {
    let trimmed = name.trim().trim_start_matches('v');
    let mut parts = trimmed.split('.');
    let major: u64 = parts.next()?.parse().ok()?;
    let minor: u64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let patch: u64 = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    Some((major, minor, patch))
}

// Pick the numerically-highest installed nvm version. A lexical sort would
// rank v9.x above v22.x, pinning clients to an ancient node.
fn nvm_latest_node(home: &Path) -> Option<PathBuf> {
    let nvm_dir = home.join(".nvm/versions/node");
    let mut best: Option<((u64, u64, u64), PathBuf)> = None;
    for entry in std::fs::read_dir(&nvm_dir).ok()?.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(ver) = parse_node_version(&name) {
            if best.as_ref().map(|(b, _)| ver > *b).unwrap_or(true) {
                best = Some((ver, entry.path()));
            }
        }
    }
    best.map(|(_, p)| p.join("bin/node")).filter(|p| p.exists())
}

// Best-effort search for a usable `node` binary. Tauri-spawned processes don't
// inherit the user's interactive PATH, so we have to look in the common
// homebrew / nvm / volta / fnm / asdf / system locations explicitly, then fall
// back to asking a login shell.
fn detect_node_path() -> Option<PathBuf> {
    let candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }
    if let Some(home) = dirs::home_dir() {
        if let Some(node) = nvm_latest_node(&home) {
            return Some(node);
        }
        let manager_paths = [
            home.join(".volta/bin/node"),
            home.join("Library/Application Support/fnm/aliases/default/bin/node"),
            home.join(".fnm/aliases/default/bin/node"),
            home.join(".asdf/shims/node"),
        ];
        for p in manager_paths {
            if p.exists() {
                return Some(p);
            }
        }
    }
    // Last resort: a login+interactive shell sees whatever PATH setup the
    // user has, no matter which node manager they use.
    let output = std::process::Command::new("zsh")
        .args(["-ilc", "command -v node"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8(output.stdout).ok()?;
    let trimmed = path.trim();
    if trimmed.starts_with('/') {
        Some(PathBuf::from(trimmed))
    } else {
        None
    }
}

// Tauri-spawned processes inherit launchd's bare PATH, missing tools like
// lark-cli / pnpm global / nvm-installed npm. Login shells (`zsh -l`) source
// .zprofile but not .zshrc, where most users put PATH/nvm/fnm init — so we
// run an interactive+login shell once at startup and pin the result.
fn capture_user_path() -> Option<String> {
    let output = std::process::Command::new("zsh")
        .args(["-ilc", "printf %s \"$PATH\""])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8(output.stdout).ok()?;
    let trimmed = path.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

// Client configs must NOT point into the .app bundle: apps launched from a
// still-mounted DMG, App-Translocated (quarantined) apps, and moved/renamed
// apps all make that path vanish after the session that configured it — the
// health check passes, then Claude/Codex can never start the server again.
// Instead we sync the bundled server to a stable per-user location and point
// every client config there.
fn stable_mcp_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".penguin").join("mcp"))
}

// Atomic overwrite, skipped when content is already identical. Returns
// whether the destination changed.
fn copy_if_different(src: &Path, dest: &Path) -> Result<bool, String> {
    let src_bytes = std::fs::read(src).map_err(|e| format!("read {}: {e}", src.display()))?;
    if let Ok(existing) = std::fs::read(dest) {
        if existing == src_bytes {
            return Ok(false);
        }
    }
    let tmp = dest.with_extension("tmp");
    std::fs::write(&tmp, &src_bytes).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, dest).map_err(|e| format!("rename {}: {e}", dest.display()))?;
    Ok(true)
}

// Sync the bundled server JS (plus the package.json that carries
// "type": "module" — without it node would run the ESM bundle as CJS) into
// stable_dir. Refreshes stale copies after app updates. Returns the stable
// server path to put in client configs.
fn sync_stable_mcp_files(bundled_server: &Path, stable_dir: &Path) -> Result<PathBuf, String> {
    let dist = stable_dir.join("dist");
    std::fs::create_dir_all(&dist).map_err(|e| e.to_string())?;

    let server_dest = dist.join("index.js");
    copy_if_different(bundled_server, &server_dest)?;

    let pkg_dest = stable_dir.join("package.json");
    // Bundled layout: .../packages/mcp/dist/index.js with package.json two
    // levels up at .../packages/mcp/package.json.
    let pkg_src = bundled_server
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("package.json"))
        .filter(|p| p.exists());
    match pkg_src {
        Some(src) => {
            copy_if_different(&src, &pkg_dest)?;
        }
        None => {
            if !pkg_dest.exists() {
                std::fs::write(&pkg_dest, "{\n  \"type\": \"module\"\n}\n")
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(server_dest)
}

fn ensure_stable_mcp_server<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    let bundled = bundled_mcp_server_path(app)?;
    let dir = stable_mcp_dir().ok_or("No home directory")?;
    sync_stable_mcp_files(&bundled, &dir)
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
    claude_code_config_path: Option<String>,
    claude_code_configured: bool,
    codex_config_path: Option<String>,
    codex_configured: bool,
}

#[tauri::command]
fn mcp_status<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> McpStatus {
    // Prefer the stable per-user copy (and refresh it while we're here so app
    // updates propagate); fall back to the in-bundle path for diagnostics.
    let bundled = ensure_stable_mcp_server(&app)
        .ok()
        .or_else(|| bundled_mcp_server_path(&app).ok());
    let node = detect_node_path();
    let cfg_path = claude_desktop_config_path();
    let claude_code_cfg_path = claude_code_config_path();
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
    // Same mcpServers JSON shape — the desktop checker works for ~/.claude.json.
    let claude_code_configured = claude_code_cfg_path
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
        claude_code_config_path: claude_code_cfg_path.map(|p| p.to_string_lossy().to_string()),
        claude_code_configured,
        codex_config_path: codex_cfg_path.map(|p| p.to_string_lossy().to_string()),
        codex_configured,
    }
}

#[tauri::command]
fn mcp_install_to_local_clients<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<String, String> {
    let server = ensure_stable_mcp_server(&app)?;
    let node = detect_node_path().ok_or("Could not locate a node binary in common paths")?;
    let claude_cfg_path = claude_desktop_config_path().ok_or("No home directory")?;
    let claude_code_cfg_path = claude_code_config_path().ok_or("No home directory")?;
    let codex_cfg_path = codex_config_path().ok_or("No home directory")?;

    write_claude_desktop_mcp_config_at(&claude_cfg_path, &node, &server)?;
    // ~/.claude.json uses the same mcpServers shape, and the merge preserves
    // all of Claude Code's other state in that file.
    write_claude_desktop_mcp_config_at(&claude_code_cfg_path, &node, &server)?;
    write_codex_mcp_config_at(&codex_cfg_path, &node, &server)?;

    Ok(format!(
        "Configured penguin MCP server for Claude Desktop ({}), Claude Code ({}) and Codex CLI ({}). Restart the clients to pick it up.",
        claude_cfg_path.display(),
        claude_code_cfg_path.display(),
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
    fn parse_node_version_orders_numerically_not_lexically() {
        // Lexical sort would pick v9 over v22 — the bug that pinned client
        // configs to ancient node versions.
        assert!(parse_node_version("v22.1.0").unwrap() > parse_node_version("v9.11.2").unwrap());
        assert!(parse_node_version("v18.20.8").unwrap() < parse_node_version("v20.0.0").unwrap());
        assert_eq!(parse_node_version(".DS_Store"), None);
        assert_eq!(parse_node_version("v18"), Some((18, 0, 0)));
    }

    #[test]
    fn sync_stable_mcp_files_copies_server_and_module_package_json() {
        let cfg = temp_config_path("stable-sync");
        let root = cfg.parent().unwrap().to_path_buf();

        // Fake bundled layout: packages/mcp/dist/index.js + packages/mcp/package.json
        let bundle_dir = root.join("bundle/packages/mcp");
        fs::create_dir_all(bundle_dir.join("dist")).unwrap();
        fs::write(bundle_dir.join("dist/index.js"), "console.log('v1')").unwrap();
        fs::write(bundle_dir.join("package.json"), "{\"type\":\"module\"}").unwrap();

        let stable = root.join("stable");
        let server = sync_stable_mcp_files(&bundle_dir.join("dist/index.js"), &stable).unwrap();

        assert_eq!(server, stable.join("dist/index.js"));
        assert_eq!(fs::read_to_string(&server).unwrap(), "console.log('v1')");
        assert!(fs::read_to_string(stable.join("package.json"))
            .unwrap()
            .contains("\"type\":\"module\""));

        // App update: bundled content changed → stable copy refreshes.
        fs::write(bundle_dir.join("dist/index.js"), "console.log('v2')").unwrap();
        sync_stable_mcp_files(&bundle_dir.join("dist/index.js"), &stable).unwrap();
        assert_eq!(fs::read_to_string(&server).unwrap(), "console.log('v2')");

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn sync_stable_mcp_files_writes_minimal_package_json_when_bundle_lacks_one() {
        let cfg = temp_config_path("stable-nopkg");
        let root = cfg.parent().unwrap().to_path_buf();

        let bundle_dir = root.join("flat");
        fs::create_dir_all(&bundle_dir).unwrap();
        fs::write(bundle_dir.join("index.js"), "console.log('hi')").unwrap();

        let stable = root.join("stable");
        sync_stable_mcp_files(&bundle_dir.join("index.js"), &stable).unwrap();

        // Without "type": "module" node would execute the ESM bundle as CJS.
        assert!(fs::read_to_string(stable.join("package.json"))
            .unwrap()
            .contains("\"type\": \"module\""));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn write_claude_json_mcp_config_preserves_claude_code_state() {
        // ~/.claude.json holds far more than mcpServers — projects, settings,
        // OAuth state. The merge must touch only mcpServers.penguin.
        let cfg_path = temp_config_path("claude-code").with_extension("json");
        fs::write(
            &cfg_path,
            r#"{"numStartups": 42, "projects": {"/tmp/x": {"allowedTools": []}}, "mcpServers": {"other": {"command": "other-mcp"}}}"#,
        )
        .unwrap();

        write_claude_desktop_mcp_config_at(
            &cfg_path,
            &PathBuf::from("/usr/local/bin/node"),
            &PathBuf::from("/Users/u/.penguin/mcp/dist/index.js"),
        )
        .unwrap();

        let saved: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&cfg_path).unwrap()).unwrap();
        assert_eq!(saved["numStartups"], 42);
        assert!(saved["projects"]["/tmp/x"].is_object());
        assert_eq!(saved["mcpServers"]["other"]["command"], "other-mcp");
        assert_eq!(
            saved["mcpServers"]["penguin"]["command"],
            "/usr/local/bin/node"
        );
        assert_eq!(
            saved["mcpServers"]["penguin"]["args"][0],
            "/Users/u/.penguin/mcp/dist/index.js"
        );

        let _ = fs::remove_dir_all(cfg_path.parent().unwrap());
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
    match capture_user_path() {
        Some(user_path) => std::env::set_var("PATH", user_path),
        None => eprintln!(
            "[pengvi] warning: could not capture user PATH from zsh -ilc; \
             subprocess will use bundled NODE_PATH_SETUP fallback only"
        ),
    }
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
            db_put_history_entry,
            db_list_history,
            db_count_history,
            db_clear_history,
            mcp_status,
            mcp_install_to_local_clients,
            write_registry_npmrc,
            read_registry_npmrc_status,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
