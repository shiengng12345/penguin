// Thin typed wrapper around the Rust inline_webview_* commands.
// Caller is responsible for label uniqueness — convention:
//   `inline-vault-{projectId}-{envId}-{kindId}`
// so cookies + nav stack survive kind switches but never bleed across
// envs (a dev token must not be hot in a uat webview).

import { invoke } from "@tauri-apps/api/core";

export interface InlineWebviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function openInlineWebview(
  label: string,
  url: string,
  bounds: InlineWebviewBounds,
  // Persistent data-store key. Webviews sharing the same dataKey share
  // cookies / localStorage / IndexedDB / cache (same WKWebsiteDataStore
  // on disk). Distinct keys → fully isolated sessions.
  //
  //   - null / undefined: legacy shared default store (DON'T use for
  //     new code — it's the cause of "all my QAT/UAT shortcuts share
  //     login" bugs when they live on the same domain).
  //   - "<shortcut-id>": per-shortcut isolation (different env → no
  //     bleed-through).
  //   - "<parent-shortcut-id>": branch shortcut sharing its parent's
  //     login (multiple windows on the same account).
  //   - "aliyun-acc-<id>" / "jenkins-acc-<id>": all links bound to the
  //     same account share login.
  dataKey?: string | null,
): Promise<void> {
  return invoke("inline_webview_open", {
    label,
    url,
    bounds,
    dataKey: dataKey ?? null,
  });
}

export function setInlineWebviewBounds(
  label: string,
  bounds: InlineWebviewBounds,
): Promise<void> {
  return invoke("inline_webview_set_bounds", { label, bounds });
}

export function setInlineWebviewVisible(
  label: string,
  visible: boolean,
): Promise<void> {
  return invoke("inline_webview_set_visible", { label, visible });
}

export function reloadInlineWebview(label: string): Promise<void> {
  return invoke("inline_webview_reload", { label });
}

export function navigateInlineWebview(
  label: string,
  url: string,
): Promise<void> {
  return invoke("inline_webview_navigate", { label, url });
}

export function inlineWebviewBack(label: string): Promise<void> {
  return invoke("inline_webview_back", { label });
}

export function inlineWebviewForward(label: string): Promise<void> {
  return invoke("inline_webview_forward", { label });
}

export function closeInlineWebview(label: string): Promise<void> {
  return invoke("inline_webview_close", { label });
}

// Inject arbitrary JS into the child webview's main world. Used for
// auto-filling Vault's Token sign-in field — never log `js` (it carries
// the token in cleartext).
export function evalInlineWebview(label: string, js: string): Promise<void> {
  return invoke("inline_webview_eval", { label, js });
}

export function listInlineWebviews(): Promise<string[]> {
  return invoke("inline_webview_list");
}

// Force-close every inline-* webview. Used as a defense-in-depth
// guard at the App boundary: when the user leaves the Vault module,
// we call this even if per-panel unmount cleanup is already in
// flight, to make sure no native WKWebView bleeds through the next
// module's UI.
export function closeAllInlineWebviews(): Promise<string[]> {
  return invoke("inline_webview_close_all");
}

// Same defense-in-depth as closeAllInlineWebviews but HIDES instead of
// destroying. Preserves the page (no URL reload / white flash on
// return) — used when the user leaves a module that owns webviews so
// next visit lands on the same page state.
export function hideAllInlineWebviews(): Promise<string[]> {
  return invoke("inline_webview_hide_all");
}

// Nuke every inline webview AND its on-disk data directory (cookies /
// localStorage / IndexedDB / cache). Caller is expected to trigger a
// full window.location.reload after this so the React tree restarts.
export function purgeAllInlineWebviewData(): Promise<string[]> {
  return invoke("inline_webview_purge_all_data");
}
