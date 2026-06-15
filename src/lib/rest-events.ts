// Sprint 10 — REST module custom event names. The global App.tsx keydown
// handler dispatches these instead of the gRPC-shaped `penguin:send-request`
// / NewRequestDialog / removeTab flows when activeModule === "rest", so the
// same physical shortcut (Cmd+N, Cmd+W, Cmd+Enter, Cmd+S, Cmd+L, Cmd+F) does
// the right thing per module instead of always firing the gRPC path.

export const REST_NEW_REQUEST_EVENT = "penguin:rest-new-request";
export const REST_CLOSE_TAB_EVENT = "penguin:rest-close-tab";
export const REST_SEND_REQUEST_EVENT = "penguin:rest-send-request";
export const REST_SAVE_REQUEST_EVENT = "penguin:rest-save-request";
export const REST_FOCUS_SEARCH_EVENT = "penguin:rest-focus-search";
export const REST_FOCUS_URL_EVENT = "penguin:rest-focus-url";
export const REST_OPEN_CURL_IMPORT_EVENT = "penguin:rest-open-curl-import";
export const REST_OPEN_HISTORY_EVENT = "penguin:rest-open-history";
