// React error boundary — catches render-time crashes anywhere in the
// child tree and (1) logs them to the error_log table via the same
// pipeline as logger.error(), (2) renders a recovery panel so the user
// isn't staring at a blank white screen.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { recordErrorLog } from "@/lib/penguin-db";
import { emitErrorLogChanged } from "@/lib/error-log-events";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const details: Record<string, unknown> = {
      componentStack: info.componentStack ?? null,
    };
    if (typeof error.stack === "string") {
      details.stack = error.stack;
    }
    void recordErrorLog({
      source: "fe",
      severity: "error",
      scope: "react.errorBoundary",
      message: error.message || "Unknown render error",
      details: JSON.stringify(details),
    }).then(() => emitErrorLogChanged());
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  reload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "var(--color-background, #0a0a0a)",
          color: "var(--color-foreground, #e5e7eb)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ maxWidth: 480, padding: 24 }}>
          <h2 style={{ margin: 0, marginBottom: 12, fontSize: 18, fontWeight: 600 }}>
            Penguin hit an unexpected error
          </h2>
          <pre
            style={{
              padding: 12,
              backgroundColor: "rgba(255,255,255,0.04)",
              borderRadius: 6,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 12,
              maxHeight: 200,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {this.state.error.message}
          </pre>
          <p style={{ fontSize: 13, color: "#9aa5b8", marginTop: 12 }}>
            The error is saved to the in-app error log. Try the recovery
            buttons below — if Penguin keeps crashing, click Reload.
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button
              type="button"
              onClick={this.reset}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.12)",
                backgroundColor: "transparent",
                color: "inherit",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.reload}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid rgba(91,141,239,0.35)",
                backgroundColor: "rgba(91,141,239,0.15)",
                color: "#cdd9f5",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              Reload Penguin
            </button>
          </div>
        </div>
      </div>
    );
  }
}
