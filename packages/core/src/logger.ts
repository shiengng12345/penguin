// Thin project-wide logger wrapper. Centralizes all log calls so future work
// (file logging, telemetry, log-level filtering) only needs to change here.
// Sidecar processes (grpc-native-client, sdk-client) intentionally keep raw
// console.* — their stdout IS the IPC channel back to the Tauri host process.

type LogContext = Record<string, unknown>;

// Optional sink — the app wires this up at boot to forward warn/error
// into the SQLite error_log table. Core stays dep-free (no `invoke`
// import) by leaving the sink installation to the consumer.
export interface LoggerSink {
  capture(
    severity: "error" | "warn",
    scope: string,
    message: string,
    details: Record<string, unknown> | undefined,
  ): void;
}

let activeSink: LoggerSink | null = null;
export function setLoggerSink(sink: LoggerSink | null): void {
  activeSink = sink;
}

function format(scope: string, message: string, context?: LogContext): string {
  if (!context) return `[${scope}] ${message}`;
  return `[${scope}] ${message} ${JSON.stringify(context)}`;
}

export const logger = {
  info(scope: string, message: string, context?: LogContext): void {
    console.info(format(scope, message, context));
  },
  warn(scope: string, message: string, context?: LogContext): void {
    console.warn(format(scope, message, context));
    if (activeSink !== null) {
      try {
        activeSink.capture("warn", scope, message, context);
      } catch {
        /* sink failure must never tank a log call */
      }
    }
  },
  error(scope: string, message: string, error?: unknown, context?: LogContext): void {
    const errMsg = error instanceof Error ? error.message : String(error ?? "");
    const merged = { ...(context ?? {}), error: errMsg };
    console.error(format(scope, message, merged));
    if (activeSink !== null) {
      try {
        const details: Record<string, unknown> = { ...merged };
        if (error instanceof Error && typeof error.stack === "string") {
          details.stack = error.stack;
        }
        activeSink.capture("error", scope, message, details);
      } catch {
        /* sink failure must never tank a log call */
      }
    }
  },
  debug(scope: string, message: string, context?: LogContext): void {
    console.debug(format(scope, message, context));
  },
};
