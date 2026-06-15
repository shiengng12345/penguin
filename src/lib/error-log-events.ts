// Tiny in-process event bus so UI subscribers (the StatusBar badge,
// the open ErrorLogDialog) re-fetch when a new entry lands. Just a
// CustomEvent on `window` — DOM is already a global pub/sub, no need
// to pull in a state manager for one signal.

const EVENT_NAME = "penguin:error-log-changed";

export function emitErrorLogChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function subscribeErrorLogChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
