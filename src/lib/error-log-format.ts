// Format helpers for copying selected ErrorLog rows to clipboard. Two
// modes — JSON (for paste-into-ticket-tracker) and Markdown (for
// paste-into-Slack / GitHub-issue). Both prepend a small Penguin
// version + OS header so the recipient knows the environment.

import type { ErrorLogEntry } from "./penguin-db";
import pkg from "../../package.json";

function appVersionHeader(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return `Pengvi v${pkg.version} · ${ua || "unknown UA"}`;
}

function formatTimestamp(ms: number): string {
  // ISO 8601 keeps timezone info — easier to correlate across users
  // than a locale-formatted string.
  return new Date(ms).toISOString();
}

function tryParseDetails(raw: string | null): unknown {
  if (raw === null || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function formatErrorLogAsJson(entries: ErrorLogEntry[]): string {
  const payload = {
    env: appVersionHeader(),
    exportedAt: new Date().toISOString(),
    count: entries.length,
    entries: entries.map((e) => ({
      timestamp: formatTimestamp(e.timestamp),
      source: e.source,
      severity: e.severity,
      scope: e.scope,
      message: e.message,
      details: tryParseDetails(e.details),
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export function formatErrorLogAsMarkdown(entries: ErrorLogEntry[]): string {
  const lines: string[] = [];
  lines.push(`## ${entries.length} error log entries`);
  lines.push(`> ${appVersionHeader()}`);
  lines.push("");
  for (const e of entries) {
    const sev = e.severity === "error" ? "🔴" : "🟡";
    const src = e.source.toUpperCase();
    const scope = e.scope ?? "—";
    lines.push(
      `- ${sev} **${formatTimestamp(e.timestamp)}** \`[${src}]\` \`${scope}\` — ${e.message}`,
    );
    const parsed = tryParseDetails(e.details);
    if (parsed !== null) {
      const pretty = typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
      lines.push("  <details><summary>details</summary>");
      lines.push("");
      lines.push("  ```");
      // Indent each line by 2 spaces so the code block stays under the
      // list item in markdown renderers.
      for (const dl of pretty.split("\n")) lines.push(`  ${dl}`);
      lines.push("  ```");
      lines.push("  </details>");
    }
  }
  return lines.join("\n");
}
