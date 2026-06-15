// Clipboard write helper.
//
// `navigator.clipboard.writeText()` in Tauri's WKWebView fails after any
// `await` between the click and the call because the user-gesture
// token is consumed by the first microtask boundary — MDN spec calls
// this "transient activation", macOS Safari is strict about it. The
// symptom is the cryptic error: "Clipboard write failed: The request
// is not allowed by the user agent or the platform in the current
// context, possibly because the user denied permission."
//
// Tauri's clipboard-manager plugin routes the write through Rust
// (system clipboard API), which has no gesture requirement. We prefer
// it everywhere; navigator.clipboard stays as a fallback for any
// web-only build path that doesn't have the plugin loaded.

import { writeText as tauriWriteText } from "@tauri-apps/plugin-clipboard-manager";

export async function writeClipboard(text: string): Promise<void> {
  try {
    await tauriWriteText(text);
    return;
  } catch (e) {
    // Fall through to the navigator API. Most likely this never runs
    // in production (Tauri context always available), but keeps the
    // helper testable in plain-browser scenarios.
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {
        // Re-throw the Tauri error for a more informative message.
      }
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}
