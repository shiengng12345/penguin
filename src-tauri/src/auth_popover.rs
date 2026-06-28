// Authenticator popover as a separate Tauri WebviewWindow. Native
// WKWebView child views always paint above the parent's HTML, so an
// in-page popover gets covered by the embedded browser webview. A
// real top-level OS window dodges that — it sits above ALL child
// views, the same way Chrome's extension popups do.
//
// Lifecycle:
//   1. BrowserPage assembles a TOTP snapshot (vault entries + active
//      webview label + project/env scope) and calls `auth_popover_open`.
//   2. We stash the snapshot in AuthPopoverState and spawn a small
//      borderless transparent window at the requested anchor.
//   3. The window's React entry detects `#popover=auth` and renders
//      AuthPopoverApp, which calls `auth_popover_get_snapshot` to
//      hydrate.
//   4. Blur / Esc / X / outside-click → `auth_popover_close` destroys
//      the window. Main window listens for the destroy event to
//      flip the KeyRound button's active state back.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    AppHandle, Emitter, LogicalPosition, Manager, PhysicalPosition, Runtime, WebviewUrl,
    WebviewWindowBuilder, WindowEvent,
};

const POPOVER_LABEL: &str = "auth-popover";
const POPOVER_WIDTH: f64 = 380.0;
const POPOVER_HEIGHT: f64 = 500.0;

// Set while `auth_capture_qr` is running so the popover's blur handler
// doesn't close the window when we hide it for the macOS crosshair.
// AtomicBool is fine because the flag is touched only on Rust threads.
static SCANNING: AtomicBool = AtomicBool::new(false);

#[derive(Default)]
pub struct AuthPopoverState {
    snapshot: Mutex<Option<serde_json::Value>>,
}

#[tauri::command]
pub fn auth_popover_open<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AuthPopoverState>,
    snapshot: serde_json::Value,
    anchor_x: f64,
    anchor_y: f64,
) -> Result<(), String> {
    // Stash the snapshot BEFORE creating the window so when the
    // window's React app fires `auth_popover_get_snapshot` on mount
    // the data is already there. No need for an event handshake.
    {
        let mut guard = state.snapshot.lock().map_err(|e| e.to_string())?;
        *guard = Some(snapshot);
    }

    // If an old popover window is still around (e.g. user clicked the
    // button twice fast), close it before creating a fresh one.
    if let Some(existing) = app.get_webview_window(POPOVER_LABEL) {
        let _ = existing.close();
    }

    let window = WebviewWindowBuilder::new(
        &app,
        POPOVER_LABEL,
        WebviewUrl::App("index.html#popover=auth".into()),
    )
    .title("Authenticator")
    .inner_size(POPOVER_WIDTH, POPOVER_HEIGHT)
    .position(anchor_x, anchor_y)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(true)
    .build()
    .map_err(|e| e.to_string())?;

    // (1) Auto-close on blur (Chrome extension popup behaviour).
    // (2) On destruction, emit an app-wide event so the main window
    //     can flip the KeyRound button back to inactive — Tauri's
    //     per-window lifecycle events don't cross window boundaries
    //     on their own.
    let app_handle = app.clone();
    let close_app = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(false) => {
            // Skip auto-close while a QR scan is in progress — we
            // intentionally hide the popover so the macOS crosshair
            // can target whatever is behind it, and an auto-close
            // would destroy the JS context mid-scan.
            if SCANNING.load(Ordering::SeqCst) {
                return;
            }
            if let Some(w) = close_app.get_webview_window(POPOVER_LABEL) {
                let _ = w.close();
            }
        }
        WindowEvent::Destroyed => {
            let _ = app_handle.emit("auth-popover-closed", ());
        }
        _ => {}
    });

    Ok(())
}

#[tauri::command]
pub fn auth_popover_get_snapshot(
    state: tauri::State<'_, AuthPopoverState>,
) -> Result<Option<serde_json::Value>, String> {
    let guard = state.snapshot.lock().map_err(|e| e.to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
pub fn auth_popover_close<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(POPOVER_LABEL) {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// --- Standalone TOTP entries owned by the Authenticator popover ---
//
// These are entries the user adds directly inside the popover (via the
// pencil / QR buttons) — they're independent of Vault and the Jenkins
// tab. Persisted under app_kv key "penguin-auth-standalone" as a JSON
// array. Popover reads on open, writes on add/delete. Main window's
// snapshot DOES NOT need to know about them — the popover combines its
// local standalone list with the snapshot at render time.

const AUTH_STANDALONE_KEY: &str = "penguin-auth-standalone";

#[tauri::command]
pub fn auth_load_standalone() -> Result<serde_json::Value, String> {
    let value = crate::db::db_get_app_value(AUTH_STANDALONE_KEY.to_string())?;
    let raw = value.unwrap_or_default();
    if raw.is_empty() {
        return Ok(serde_json::Value::Array(Vec::new()));
    }
    serde_json::from_str::<serde_json::Value>(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn auth_save_standalone(entries: serde_json::Value) -> Result<(), String> {
    if !entries.is_array() {
        return Err("entries must be a JSON array".to_string());
    }
    let serialized = serde_json::to_string(&entries).map_err(|e| e.to_string())?;
    crate::db::db_set_app_value(AUTH_STANDALONE_KEY.to_string(), serialized)
}

/// macOS-only: launches the system `screencapture -i` tool so the user
/// can drag-select a region with the familiar Cmd+Shift+4 crosshair.
/// Structured outcome of a single QR scan attempt. Keeping decode in
/// Rust (via `rqrr` + `image`) avoids the canvas/jsQR fragility we hit
/// when the captured PNG is large or includes surrounding UI chrome.
#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum QrScanResult {
    /// User pressed Esc before completing the crosshair selection.
    Cancelled,
    /// Capture succeeded but the PNG is suspiciously small —
    /// almost always means macOS Screen Recording permission is denied
    /// (the captured region comes back near-empty / desktop-only).
    EmptyCapture { bytes: u64 },
    /// PNG decoded fine; rqrr scanned every channel but no QR found.
    /// Image dims help the user judge whether they cropped too tight.
    NoQr { width: u32, height: u32 },
    /// QR decoded but the payload isn't an `otpauth://` URI — happens
    /// when the user crops a non-TOTP QR (e.g. URL or contact card).
    NotOtpauth { preview: String },
    /// Success — FE parses the otpauth URI and appends to standalone.
    Found { otpauth: String },
}

/// Run a native interactive screen capture and decode the QR inside.
/// Decode is done in Rust so we never depend on the popover's HTML
/// canvas being responsive after the window hide/show dance.
///
/// First call triggers macOS's Screen Recording permission prompt;
/// once granted, subsequent calls are seamless.
#[tauri::command]
pub fn auth_capture_qr<R: Runtime>(app: AppHandle<R>) -> Result<QrScanResult, String> {
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    // 1. Get the popover OUT OF THE WAY before screencapture launches.
    //    Triple-redundant: move offscreen + hide + minimize. If any one
    //    of these works the popover is gone from the captured frame.
    //    SCANNING flag suppresses the auto-close-on-blur path.
    SCANNING.store(true, Ordering::SeqCst);
    let saved_pos: Option<PhysicalPosition<i32>> =
        if let Some(w) = app.get_webview_window(POPOVER_LABEL) {
            let pos = w.outer_position().ok();
            // (1a) Move offscreen first — most reliable; doesn't rely on
            // the windowing system honoring hide(). (-50000, -50000) is
            // well beyond any monitor coordinate space.
            if let Err(e) = w.set_position(LogicalPosition::new(-50000.0, -50000.0)) {
                eprintln!("[auth_capture_qr] set_position offscreen failed: {}", e);
            }
            if let Err(e) = w.hide() {
                eprintln!("[auth_capture_qr] hide failed: {}", e);
            }
            if let Err(e) = w.minimize() {
                eprintln!("[auth_capture_qr] minimize failed: {}", e);
            }
            pos
        } else {
            None
        };
    // 250ms gives macOS plenty of time to commit the move + hide
    // before screencapture takes its first frame.
    std::thread::sleep(std::time::Duration::from_millis(250));

    // 2. Run the native interactive capture.
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let path = std::env::temp_dir().join(format!("penguin-qr-{}.png", nonce));
    let path_str = path
        .to_str()
        .ok_or_else(|| "invalid temp path".to_string())?
        .to_string();
    let status_result = Command::new("/usr/sbin/screencapture")
        .args(["-i", "-t", "png", "-x", &path_str])
        .status();

    // 3. Always restore the popover, regardless of capture outcome.
    if let Some(w) = app.get_webview_window(POPOVER_LABEL) {
        if let Err(e) = w.unminimize() {
            eprintln!("[auth_capture_qr] unminimize failed: {}", e);
        }
        // Restore original position if we saved it; otherwise the
        // window stays at the offscreen coords and the user can't see
        // it after show().
        if let Some(p) = saved_pos {
            if let Err(e) = w.set_position(p) {
                eprintln!("[auth_capture_qr] set_position restore failed: {}", e);
            }
        }
        if let Err(e) = w.show() {
            eprintln!("[auth_capture_qr] show failed: {}", e);
        }
        if let Err(e) = w.set_focus() {
            eprintln!("[auth_capture_qr] set_focus failed: {}", e);
        }
    }
    SCANNING.store(false, Ordering::SeqCst);

    let status = status_result.map_err(|e| format!("screencapture failed to launch: {}", e))?;
    if !status.success() {
        return Ok(QrScanResult::Cancelled);
    }
    if !path.exists() {
        // screencapture exits 0 + writes no file when user cancels via Esc.
        return Ok(QrScanResult::Cancelled);
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&path);
    let byte_count = bytes.len() as u64;
    eprintln!("[auth_capture_qr] captured PNG: {} bytes", byte_count);

    // Tiny PNG → almost certainly Screen Recording permission denied
    // (macOS returns a blank screenshot in that case). 5KB threshold
    // chosen empirically — even a 1×1 transparent PNG is ~70 bytes,
    // but a real screenshot of any non-trivial region clears 20KB.
    if byte_count < 5000 {
        return Ok(QrScanResult::EmptyCapture { bytes: byte_count });
    }

    // Decode PNG → grayscale → rqrr scan.
    let img = image::load_from_memory(&bytes).map_err(|e| format!("PNG decode failed: {}", e))?;
    let luma = img.to_luma8();
    let (width, height) = (luma.width(), luma.height());
    eprintln!("[auth_capture_qr] decoded image: {}x{}", width, height);

    let mut prepared = rqrr::PreparedImage::prepare(luma);
    let grids = prepared.detect_grids();
    eprintln!("[auth_capture_qr] rqrr grids found: {}", grids.len());

    for grid in grids {
        if let Ok((_meta, content)) = grid.decode() {
            eprintln!(
                "[auth_capture_qr] QR decoded ({} bytes content)",
                content.len()
            );
            if content.starts_with("otpauth://") {
                return Ok(QrScanResult::Found { otpauth: content });
            }
            let preview: String = content.chars().take(60).collect();
            return Ok(QrScanResult::NotOtpauth { preview });
        }
    }

    Ok(QrScanResult::NoQr { width, height })
}
