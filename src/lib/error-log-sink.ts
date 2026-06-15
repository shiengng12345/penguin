// Install-once bridge between @penguin/core's logger and the SQLite
// error_log table. Lives in src/ (not in @penguin/core) so the core
// package stays free of Tauri / db deps.
//
// Also registers the global window error + unhandledrejection handlers
// — they go through the same recordErrorLog path so an unhandled crash
// shows up in the dialog alongside intentional logger.error() calls.

import { setLoggerSink } from "@penguin/core";
import { recordErrorLog } from "./penguin-db";
import { emitErrorLogChanged } from "./error-log-events";

function safeStringifyDetails(details: Record<string, unknown> | undefined): string | null {
  if (details === undefined) return null;
  try {
    const json = JSON.stringify(details);
    // 16KB cap per row — stack traces + context objects should fit;
    // anything larger is almost certainly noise.
    if (json.length > 16 * 1024) {
      return JSON.stringify({ truncated: true, head: json.slice(0, 16 * 1024) });
    }
    return json;
  } catch {
    return null;
  }
}

let installed = false;

export function installErrorLogSink(): void {
  if (installed) return;
  installed = true;

  // Pipe logger.warn() / logger.error() into SQLite.
  setLoggerSink({
    capture: (severity, scope, message, details) => {
      void recordErrorLog({
        source: "fe",
        severity,
        scope,
        message,
        details: safeStringifyDetails(details),
      }).then(() => emitErrorLogChanged());
    },
  });

  if (typeof window === "undefined") return;

  // Unhandled exceptions from event handlers, async callbacks, etc.
  window.addEventListener("error", (event) => {
    const error = event.error;
    const message =
      error instanceof Error
        ? error.message
        : typeof event.message === "string" && event.message.length > 0
        ? event.message
        : "Uncaught error";
    const details: Record<string, unknown> = {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    };
    if (error instanceof Error && typeof error.stack === "string") {
      details.stack = error.stack;
    }
    void recordErrorLog({
      source: "fe",
      severity: "error",
      scope: "window.onerror",
      message,
      details: safeStringifyDetails(details),
    }).then(() => emitErrorLogChanged());
  });

  // Promise rejections that weren't .catch()'d anywhere.
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
        ? reason
        : "Unhandled promise rejection";
    const details: Record<string, unknown> = {};
    if (reason instanceof Error && typeof reason.stack === "string") {
      details.stack = reason.stack;
    } else if (typeof reason === "object" && reason !== null) {
      details.reason = reason;
    }
    void recordErrorLog({
      source: "fe",
      severity: "error",
      scope: "unhandledrejection",
      message,
      details: safeStringifyDetails(details),
    }).then(() => emitErrorLogChanged());
  });
}
