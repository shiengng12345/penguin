// Native child-webview lifecycle for the Vault module.
//
// Each call to inline_webview_open mounts a real OS-process WKWebView /
// WebView2 over a sub-region of the main window. Cookies + localStorage
// persist per `label`, so switching kinds back-and-forth does NOT
// re-trigger Vault / Argo login.
//
// Performance contract:
//   - Child webview runs in its own process. Heavy JS / re-renders in
//     Vault UI never touch Penguin's React main thread.
//   - bounds-sync calls are cheap (a single Cocoa / Win32 call). Frontend
//     is expected to rAF-throttle.
//
// Z-order caveat: native subviews always paint above HTML. The frontend
// must call inline_webview_set_visible(false) when a modal / dialog
// opens over the webview region.
//
// API note: requires tauri "unstable" feature for WebviewBuilder +
// Manager::webviews/get_window. Pinned in Cargo.toml.

use serde::{Deserialize, Serialize};
use tauri::{
    webview::PageLoadEvent, AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect,
    Runtime, Url, WebviewBuilder, WebviewUrl,
};

// Event name emitted to the frontend when a child webview reaches
// `Started` / `Finished` on page load. The frontend listens via
// `@tauri-apps/api/event` to drive the load-overlay-to-content
// transition without guessing timing.
const PAGE_LOAD_EVENT: &str = "inline-webview-page-load";

#[derive(Clone, Serialize)]
struct PageLoadPayload {
    label: String,
    event: &'static str,
    url: String,
}

#[derive(Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

fn clamp_size(v: f64) -> f64 {
    // A 0x0 webview triggers a panic on some platforms — round up to 1px.
    if v.is_finite() && v > 1.0 {
        v
    } else {
        1.0
    }
}

fn clamp_zoom(v: f64) -> f64 {
    if v.is_finite() {
        v.clamp(0.5, 1.5)
    } else {
        1.0
    }
}

fn logical_rect(bounds: &Bounds) -> Rect {
    Rect {
        position: LogicalPosition::new(bounds.x, bounds.y).into(),
        size: LogicalSize::new(clamp_size(bounds.width), clamp_size(bounds.height)).into(),
    }
}

fn parse_http_webview_url(url: &str) -> Result<Url, String> {
    let parsed = Url::parse(url).map_err(|e| format!("invalid url: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        scheme => Err(format!("unsupported inline webview URL scheme: {scheme}")),
    }
}

#[tauri::command]
pub fn inline_webview_open<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    url: String,
    bounds: Bounds,
    // Persistent data-store key. Two webviews opened with the SAME key
    // share cookies / localStorage / IndexedDB / cache (same on-disk
    // WKWebsiteDataStore at ~/.penguin/inline-webview-data/{key}). Two
    // webviews with DIFFERENT keys are fully isolated.
    //
    // Frontend convention (see openInlineWebview in inline-webview.ts):
    //   - "<shortcut-id>": per-shortcut isolation (default for roots)
    //   - "<parent-shortcut-id>": branch sharing its parent's session
    //   - "jenkins-acc-<id>": all links bound to the same account
    //     share login
    //
    // None / empty → fall back to the shared default WKWebsiteDataStore
    // (legacy behavior; new code should always pass a key).
    data_key: Option<String>,
) -> Result<(), String> {
    // Reuse path — preserves cookies + nav history when the user closes
    // and reopens the same kind. Just reposition + reveal, then emit a
    // synthetic "Finished" so the frontend's load-overlay can transition
    // without a wall-clock timeout (the page is already loaded).
    if let Some(webview) = app.webviews().get(&label).cloned() {
        webview
            .set_bounds(logical_rect(&bounds))
            .map_err(|e| e.to_string())?;
        webview.show().map_err(|e| e.to_string())?;
        let current_url = webview
            .url()
            .map(|u| u.to_string())
            .unwrap_or_else(|_| url.clone());
        let _ = app.emit(
            PAGE_LOAD_EVENT,
            PageLoadPayload {
                label: label.clone(),
                event: "Finished",
                url: current_url,
            },
        );
        return Ok(());
    }
    let main = app
        .get_window("main")
        .ok_or_else(|| "no main window".to_string())?;
    let parsed = parse_http_webview_url(&url)?;
    // Capture for the page-load callback closure. The handler runs on
    // wry's event loop thread; capturing the AppHandle lets us emit
    // back to the frontend.
    let emit_handle = app.app_handle().clone();
    let label_for_handler = label.clone();
    let mut builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed)).on_page_load(
        move |webview, payload| {
            let event_str = match payload.event() {
                PageLoadEvent::Started => "Started",
                PageLoadEvent::Finished => "Finished",
            };
            let _ = emit_handle.emit(
                PAGE_LOAD_EVENT,
                PageLoadPayload {
                    label: label_for_handler.clone(),
                    event: event_str,
                    url: payload.url().to_string(),
                },
            );
            let _ = webview;
        },
    );
    if let Some(key) = data_key.as_deref().filter(|s| !s.is_empty()) {
        // Sanitize: only allow filename-safe characters. Frontend keys
        // are alphanumeric + hyphen by construction (id schemas use
        // base36 + uuid-like suffixes), but paranoid filtering here
        // prevents any caller-controlled path traversal regardless.
        let safe_key: String = key
            .chars()
            .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
            .collect();
        if !safe_key.is_empty() {
            if let Some(home) = dirs::home_dir() {
                let dir = home
                    .join(".penguin")
                    .join("inline-webview-data")
                    .join(&safe_key);
                let _ = std::fs::create_dir_all(&dir);
                builder = builder.data_directory(dir);
            }
        }
    }
    main.add_child(
        builder,
        LogicalPosition::new(bounds.x, bounds.y),
        LogicalSize::new(clamp_size(bounds.width), clamp_size(bounds.height)),
    )
    .map_err(|e| {
        let msg = e.to_string();
        crate::db::record_be_error_log(
            "error",
            "inline-webview",
            &format!("inline_webview_open failed for label '{}': {}", label, msg),
            Some(&format!("{{\"label\":\"{}\",\"url\":\"{}\"}}", label, url)),
        );
        msg
    })?;
    Ok(())
}

#[tauri::command]
pub fn inline_webview_set_bounds<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    bounds: Bounds,
) -> Result<(), String> {
    let webview = app
        .webviews()
        .get(&label)
        .cloned()
        .ok_or_else(|| format!("inline webview not found: {label}"))?;
    webview
        .set_bounds(logical_rect(&bounds))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn inline_webview_set_visible<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    visible: bool,
) -> Result<(), String> {
    let webview = app
        .webviews()
        .get(&label)
        .cloned()
        .ok_or_else(|| format!("inline webview not found: {label}"))?;
    if visible {
        webview.show().map_err(|e| e.to_string())?;
    } else {
        webview.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn inline_webview_set_zoom<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    scale_factor: f64,
) -> Result<(), String> {
    let webview = app
        .webviews()
        .get(&label)
        .cloned()
        .ok_or_else(|| format!("inline webview not found: {label}"))?;
    webview
        .set_zoom(clamp_zoom(scale_factor))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn inline_webview_reload<R: Runtime>(app: AppHandle<R>, label: String) -> Result<(), String> {
    let webview = app
        .webviews()
        .get(&label)
        .cloned()
        .ok_or_else(|| format!("inline webview not found: {label}"))?;
    webview.reload().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn inline_webview_navigate<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    url: String,
) -> Result<(), String> {
    let webview = app
        .webviews()
        .get(&label)
        .cloned()
        .ok_or_else(|| format!("inline webview not found: {label}"))?;
    let parsed = parse_http_webview_url(&url)?;
    webview.navigate(parsed).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn inline_webview_back<R: Runtime>(app: AppHandle<R>, label: String) -> Result<(), String> {
    let webview = app
        .webviews()
        .get(&label)
        .cloned()
        .ok_or_else(|| format!("inline webview not found: {label}"))?;
    webview
        .eval("window.history.back()")
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn inline_webview_forward<R: Runtime>(app: AppHandle<R>, label: String) -> Result<(), String> {
    let webview = app
        .webviews()
        .get(&label)
        .cloned()
        .ok_or_else(|| format!("inline webview not found: {label}"))?;
    webview
        .eval("window.history.forward()")
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Inject arbitrary JS into the child webview's main world. Used by
// VaultMainPanel to auto-fill Vault's Token sign-in field from the
// user's paired token credential — saves a round trip to "copy token,
// switch back, paste, sign in".
//
// Security note: the JS string is sent IPC-plain. The receiving webview
// is isolated by process, but anyone with access to the running Tauri
// IPC channel could read the payload. Acceptable trade-off — the token
// is already in the user's local vault and the IPC is loopback-only.
#[tauri::command]
pub fn inline_webview_eval<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    js: String,
) -> Result<(), String> {
    let webview = app
        .webviews()
        .get(&label)
        .cloned()
        .ok_or_else(|| format!("inline webview not found: {label}"))?;
    webview.eval(&js).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn inline_webview_close<R: Runtime>(app: AppHandle<R>, label: String) -> Result<(), String> {
    let webview = app
        .webviews()
        .get(&label)
        .cloned()
        .ok_or_else(|| format!("inline webview not found: {label}"))?;
    webview.close().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn inline_webview_list<R: Runtime>(app: AppHandle<R>) -> Vec<String> {
    app.webviews()
        .keys()
        .filter(|k| is_our_label(k))
        .cloned()
        .collect()
}

// Defense-in-depth: closes every webview whose label looks like one
// of ours. Matches BOTH the current `inline-` prefix AND the legacy
// `browser-` prefix that older builds used before the rename — without
// this, zombie webviews from a previous Penguin run linger and paint
// over later modules. Idempotent.
fn is_our_label(label: &str) -> bool {
    label.starts_with("inline-") || label.starts_with("browser-")
}

#[tauri::command]
pub fn inline_webview_close_all<R: Runtime>(app: AppHandle<R>) -> Vec<String> {
    let labels: Vec<String> = app
        .webviews()
        .keys()
        .filter(|k| is_our_label(k))
        .cloned()
        .collect();
    for label in &labels {
        if let Some(webview) = app.webviews().get(label).cloned() {
            // Best-effort — log and move on if any individual close
            // fails (callers don't have a useful recovery path).
            let _ = webview.close();
        }
    }
    labels
}

/// Nuke every per-branch on-disk data store (cookies / localStorage /
/// IndexedDB / cache) AFTER closing the webviews that own them. Used
/// by the "general clear cache" button in the Browser top-bar — wipes
/// every shortcut's session in one shot. The caller is expected to
/// trigger a full main-webview reload afterward (window.location.reload)
/// so the React tree restarts against the empty stores.
///
/// Returns the closed labels for the FE to log. Failures during the
/// directory delete are swallowed (best-effort wipe).
#[tauri::command]
pub fn inline_webview_purge_all_data<R: Runtime>(app: AppHandle<R>) -> Vec<String> {
    let labels: Vec<String> = app
        .webviews()
        .keys()
        .filter(|k| is_our_label(k))
        .cloned()
        .collect();
    for label in &labels {
        if let Some(webview) = app.webviews().get(label).cloned() {
            let _ = webview.close();
        }
    }
    if let Some(home) = dirs::home_dir() {
        let root = home.join(".penguin").join("inline-webview-data");
        let _ = std::fs::remove_dir_all(&root);
    }
    labels
}

/// Delete the on-disk WKWebsiteDataStore for a specific data key.
/// Used when a Jenkins account is deleted — without this the
/// directory (cookies + IndexedDB + cache) accumulates indefinitely.
/// Best-effort: failures are logged but never bubble to the caller.
#[tauri::command]
pub fn inline_webview_delete_data_dir(data_key: String) -> Result<(), String> {
    let safe_key: String = data_key
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if safe_key.is_empty() {
        return Err("empty or invalid data_key".to_string());
    }
    if let Some(home) = dirs::home_dir() {
        let dir = home
            .join(".penguin")
            .join("inline-webview-data")
            .join(&safe_key);
        if dir.exists() {
            std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Defense-in-depth equivalent of inline_webview_close_all that HIDES
/// each webview instead of destroying it. Used when the user leaves a
/// module that owns inline webviews (Browser, formerly Vault) —
/// closing would force a URL reload on return (white-screen flash);
/// hiding preserves session + scroll position + cookies without
/// painting over the next module.
#[tauri::command]
pub fn inline_webview_hide_all<R: Runtime>(app: AppHandle<R>) -> Vec<String> {
    let labels: Vec<String> = app
        .webviews()
        .keys()
        .filter(|k| is_our_label(k))
        .cloned()
        .collect();
    for label in &labels {
        if let Some(webview) = app.webviews().get(label).cloned() {
            let _ = webview.hide();
        }
    }
    labels
}
