// Thin project-wide logger wrapper. Centralizes all log calls so future work
// (file logging, telemetry, log-level filtering) only needs to change here.
// Sidecar processes (grpc-native-client, sdk-client) intentionally keep raw
// console.* — their stdout IS the IPC channel back to the Tauri host process.

type LogContext = Record<string, unknown>;

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
  },
  error(scope: string, message: string, error?: unknown, context?: LogContext): void {
    const errMsg = error instanceof Error ? error.message : String(error ?? "");
    const merged = { ...(context ?? {}), error: errMsg };
    console.error(format(scope, message, merged));
  },
  debug(scope: string, message: string, context?: LogContext): void {
    console.debug(format(scope, message, context));
  },
};
