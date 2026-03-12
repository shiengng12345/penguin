import { useMemo } from "react";
import { useActiveTab } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Clock, AlertCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

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

function formatBody(body: string | undefined): string {
  if (!body) return "(empty)";
  try {
    const parsed = JSON.parse(body);
    const unwrapped = unwrapNestedJson(parsed);
    const cleaned = stripUnderscoreKeys(unwrapped);
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
    ? document.documentElement.getAttribute("data-theme") !== "light"
    : true;
  const colors = isDark ? TOKEN_CLASSES : TOKEN_CLASSES_LIGHT;

  return (
    <pre className={cn("font-mono text-xs leading-relaxed whitespace-pre-wrap break-all", className)}>
      {tokens.map((t, i) => (
        <span key={i} className={colors[t.type]}>{t.text}</span>
      ))}
    </pre>
  );
}

export function ResponsePanel() {
  const tab = useActiveTab();
  if (!tab) return null;

  if (tab.isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <div className="text-center space-y-1">
          <p className="text-xs">Sending request...</p>
          <p className="text-xs">发送请求中...</p>
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

  const isError = tab.response.status === "ERROR" ||
    (!!tab.response.error && tab.response.status !== "OK");

  const rawBody = tab.response.body;
  const hasBody = rawBody && rawBody !== "" && rawBody !== "{}" && rawBody !== "null";

  let bodyJson: string;
  if (hasBody) {
    bodyJson = formatBody(rawBody);
  } else if (tab.response.error) {
    try {
      const parsed = JSON.parse(tab.response.error);
      const unwrapped = unwrapNestedJson(parsed);
      const cleaned = stripUnderscoreKeys(unwrapped);
      bodyJson = JSON.stringify(cleaned, null, 2);
    } catch {
      bodyJson = JSON.stringify({
        error: tab.response.error,
        status: tab.response.statusCode || tab.response.status,
      }, null, 2);
    }
  } else {
    bodyJson = "(empty)";
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(bodyJson);
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
            {tab.response.status} {tab.response.statusCode > 0 ? tab.response.statusCode : ""}
          </Badge>
        </div>

        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {tab.response.duration}ms
        </div>
      </div>

      {/* Response headers */}
      {Object.keys(tab.response.headers).length > 0 && (
        <div className="border-b border-border px-4 py-2">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Headers
          </div>
          <div className="space-y-0.5">
            {Object.entries(tab.response.headers).map(([key, value]) => (
              <div key={key} className="flex gap-2 text-[11px] font-mono">
                <span className="text-primary">{key}:</span>
                <span className="text-muted-foreground truncate">{value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Response body */}
      <div className="flex-1 overflow-auto">
        <div className="flex items-center justify-between px-4 py-1.5 border-b border-border bg-muted/20">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Body
          </span>
          <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px]" onClick={handleCopy}>
            <Copy className="mr-1 h-3 w-3" />
            Copy
          </Button>
        </div>
        <div className="p-4">
          <SyntaxJson json={bodyJson} />
        </div>
      </div>
    </div>
  );
}
