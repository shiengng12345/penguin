import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { useActiveTab } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Clock, AlertCircle, CheckCircle2 } from "lucide-react";
import { isLightAppTheme } from "@/lib/theme";
import { formatGrpcStatusBadgeLabel, summarizeGrpcStatusResponse } from "@/lib/grpc-status";
import { cn } from "@/lib/utils";
import { writeClipboard } from "@/lib/clipboard";

function stripUnderscoreKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(stripUnderscoreKeys);
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      if (!key.startsWith("_")) {
        out[key] = stripUnderscoreKeys((obj as Record<string, unknown>)[key]);
      }
    }
    return out;
  }
  return obj;
}

function unwrapNestedJson(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(unwrapNestedJson);
  if (typeof obj === "string") {
    const trimmed = obj.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return unwrapNestedJson(JSON.parse(trimmed));
      } catch { /* not valid JSON */ }
    }
    return obj;
  }
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      out[k] = unwrapNestedJson(v);
    }
    return out;
  }
  return obj;
}

function formatBody(body: string | undefined, stripInternalKeys = true): string {
  if (!body) return "(empty)";
  try {
    const parsed = JSON.parse(body);
    const unwrapped = unwrapNestedJson(parsed);
    const cleaned = stripInternalKeys ? stripUnderscoreKeys(unwrapped) : unwrapped;
    return JSON.stringify(cleaned, null, 2);
  } catch {
    return body;
  }
}

type TokenType = "key" | "string" | "number" | "bool" | "null" | "punct";

interface JsonToken {
  text: string;
  type: TokenType;
}

function tokenizeJson(json: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  const re = /("(?:[^"\\]|\\.)*")\s*(?=:)|("(?:[^"\\]|\\.)*")|(true|false)|(null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\]:,])|(\s+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(json)) !== null) {
    if (match[1]) tokens.push({ text: match[1], type: "key" });
    else if (match[2]) tokens.push({ text: match[2], type: "string" });
    else if (match[3]) tokens.push({ text: match[3], type: "bool" });
    else if (match[4]) tokens.push({ text: match[4], type: "null" });
    else if (match[5]) tokens.push({ text: match[5], type: "number" });
    else if (match[6]) tokens.push({ text: match[6], type: "punct" });
    else if (match[7]) tokens.push({ text: match[7], type: "punct" });
  }
  return tokens;
}

const TOKEN_CLASSES: Record<TokenType, string> = {
  key: "text-sky-300",
  string: "text-green-300",
  number: "text-rose-300",
  bool: "text-violet-300",
  null: "text-slate-400",
  punct: "text-slate-500",
};

const TOKEN_CLASSES_LIGHT: Record<TokenType, string> = {
  key: "text-sky-700",
  string: "text-green-700",
  number: "text-rose-600",
  bool: "text-violet-600",
  null: "text-slate-500",
  punct: "text-slate-400",
};

function SyntaxJson({ json, className }: { json: string; className?: string }) {
  const tokens = useMemo(() => tokenizeJson(json), [json]);
  const isDark = typeof document !== "undefined"
    ? !isLightAppTheme(document.documentElement.getAttribute("data-theme"))
    : true;
  const colors = isDark ? TOKEN_CLASSES : TOKEN_CLASSES_LIGHT;

  if (tokens.length === 0 && json.length > 0) {
    return (
      <pre className={cn("min-w-max whitespace-pre font-mono text-[11px] leading-5", className)}>
        {json}
      </pre>
    );
  }

  return (
    <pre className={cn("min-w-max whitespace-pre font-mono text-[11px] leading-5", className)}>
      {tokens.map((t, i) => (
        <span key={i} className={colors[t.type]}>{t.text}</span>
      ))}
    </pre>
  );
}

const VIRTUAL_THRESHOLD = 500;
const LINE_HEIGHT = 18;
const OVERSCAN = 20;

function VirtualizedJson({ json }: { json: string }) {
  const lines = useMemo(() => json.split("\n"), [json]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerH, setContainerH] = useState(600);

  const isDark =
    typeof document !== "undefined"
      ? !isLightAppTheme(document.documentElement.getAttribute("data-theme"))
      : true;
  const colors = isDark ? TOKEN_CLASSES : TOKEN_CLASSES_LIGHT;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setContainerH(e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    if (containerRef.current) setScrollTop(containerRef.current.scrollTop);
  }, []);

  const totalHeight = lines.length * LINE_HEIGHT;
  const startIdx = Math.max(0, Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(containerH / LINE_HEIGHT) +OVERSCAN * 2;
  const endIdx = Math.min(lines.length, startIdx +visibleCount);

  const tokenizedLines = useMemo(() => {
    const result: { idx: number; tokens: JsonToken[] }[] = [];
    for (let i = startIdx; i < endIdx; i++) {
      result.push({ idx: i, tokens: tokenizeJson(lines[i]) });
    }
    return result;
  }, [lines, startIdx, endIdx]);

  return (
    <div
      ref={containerRef}
      data-response-code-surface
      className="flex-1 overflow-auto bg-background/95 text-foreground"
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: "relative" }}>
        <div
          className="p-3 font-mono text-[11px]"
          style={{
            position: "absolute",
            top: startIdx * LINE_HEIGHT,
            left: 0,
            right: 0,
          }}
        >
          {tokenizedLines.map(({ idx, tokens }) => (
            <div
              key={idx}
              style={{ height: LINE_HEIGHT }}
              className="min-w-max whitespace-pre leading-[18px]"
            >
              {tokens.length === 0
                ? lines[idx]
                : tokens.map((t, j) => (
                    <span key={j} className={colors[t.type]}>{t.text}</span>
                  ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type ResponseView = "pretty" | "raw" | "headers";

export function ResponsePanel() {
  const tab = useActiveTab();
  const [responseView, setResponseView] = useState<ResponseView>("pretty");

  // Memoized on the response object: parse+unwrap+stringify of a large body
  // must not re-run on unrelated tab re-renders (e.g. request-body keystrokes).
  const response = tab?.response ?? null;
  const isRest = tab?.protocolTab === "rest";

  const bodyJson = useMemo(() => {
    if (!response) return "(empty)";
    const rawBody = response.body;
    const hasBody = rawBody && rawBody !== "" && rawBody !== "{}" && rawBody !== "null";
    if (hasBody) return formatBody(rawBody, !isRest);
    if (response.error) {
      try {
        const parsed = JSON.parse(response.error);
        const unwrapped = unwrapNestedJson(parsed);
        const cleaned = stripUnderscoreKeys(unwrapped);
        return JSON.stringify(cleaned, null, 2);
      } catch {
        return JSON.stringify({
          error: response.error,
          status: response.statusCode || response.status,
        }, null, 2);
      }
    }
    return "(empty)";
  }, [response, isRest]);

  const headerText = useMemo(() => {
    if (!response) return "(none)";
    return Object.keys(response.headers).length > 0
      ? Object.entries(response.headers)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")
      : "(none)";
  }, [response]);

  const rawText = response ? (response.body || response.error || "(empty)") : "(empty)";
  const activeBody = isRest && responseView === "raw"
    ? rawText
    : isRest && responseView === "headers"
      ? headerText
      : bodyJson;
  // Counting lines of a multi-MB body is also per-render work worth caching.
  const bodyLines = useMemo(() => activeBody.split("\n").length, [activeBody]);

  if (!tab) return null;

  if (tab.isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <div className="text-center space-y-1">
          <p className="text-xs">Sending request...</p>
          <p className="text-xs">发送请求中...</p>
          <p className="text-[10px] text-muted-foreground/50 mt-2">Press Esc to cancel</p>
        </div>
      </div>
    );
  }

  if (!tab.response) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-muted-foreground px-6">
        <div className="h-12 w-12 rounded-full border-2 border-dashed border-border flex items-center justify-center">
          <Copy className="h-5 w-5 opacity-30" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-sm font-medium">Response will appear here</p>
          <p className="text-sm">响应将显示在此处</p>
        </div>
        <p className="text-xs text-muted-foreground/50 text-center max-w-xs">
          Select a method, fill in the request, and click Send.
        </p>
      </div>
    );
  }

  const grpcStatusSummary = !isRest ? summarizeGrpcStatusResponse(tab.response) : null;
  const isError = tab.response.status === "ERROR" ||
    (!!tab.response.error && tab.response.status !== "OK") ||
    !!grpcStatusSummary ||
    (isRest && tab.response.statusCode >= 400);
  const statusLabel = formatGrpcStatusBadgeLabel(grpcStatusSummary) ??
    `${tab.response.status}${tab.response.statusCode > 0 ? ` ${tab.response.statusCode}` : ""}`;

  const handleCopy = () => {
    writeClipboard(activeBody);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2 bg-card">
        <div className="flex items-center gap-1.5">
          {isError ? (
            <AlertCircle className="h-3.5 w-3.5 text-destructive" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-success" />
          )}
          <Badge variant={isError ? "destructive" : "success"} className="text-[10px]">
            {statusLabel}
          </Badge>
        </div>

        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {tab.response.duration}ms
        </div>
      </div>

      {grpcStatusSummary && (
        <div className="border-b border-border bg-destructive/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Error details
            </span>
            <Badge variant="destructive" className="text-[10px]">
              {grpcStatusSummary.title}
            </Badge>
            {grpcStatusSummary.transport && (
              <span className="font-mono text-[11px] text-muted-foreground">
                {grpcStatusSummary.transport}
              </span>
            )}
            {grpcStatusSummary.retryable && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                Retryable
              </Badge>
            )}
          </div>
          <div className="mt-2 space-y-1 text-xs leading-relaxed">
            <p className="text-foreground">{grpcStatusSummary.explanation}</p>
            <p className="text-muted-foreground">{grpcStatusSummary.hint}</p>
          </div>
        </div>
      )}

      {/* Response headers */}
      {!isRest && Object.keys(tab.response.headers).length > 0 && (
        <div className="border-b border-border bg-card/95 px-4 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Headers
          </div>
          <div className="grid gap-y-1">
            {Object.entries(tab.response.headers).map(([key, value]) => (
              <div key={key} className="grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-3 font-mono text-[11px]">
                <span className="whitespace-nowrap text-primary">{key}:</span>
                <span className="truncate text-muted-foreground" title={value}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Response body */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2">
          {isRest ? (
            <div className="flex items-center gap-1">
              {(["pretty", "raw", "headers"] as const).map((view) => (
                <button
                  key={view}
                  type="button"
                  onClick={() => setResponseView(view)}
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-medium uppercase transition-colors",
                    responseView === view
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  {view}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Body
            </span>
          )}
          {bodyLines > VIRTUAL_THRESHOLD && (
            <span className="text-[9px] text-muted-foreground/60 font-mono">
              {bodyLines.toLocaleString()} lines (virtual scroll)
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={handleCopy}>
          <Copy className="mr-1 h-3 w-3" />
          Copy
        </Button>
      </div>
      {bodyLines > VIRTUAL_THRESHOLD ? (
        <VirtualizedJson json={activeBody} />
      ) : (
        <div data-response-code-surface className="flex-1 overflow-auto bg-background/95 text-foreground">
          <div className="min-w-max p-3">
            <SyntaxJson json={activeBody} />
          </div>
        </div>
      )}
    </div>
  );
}
