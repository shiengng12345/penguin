import { useActiveTab } from "@/lib/store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Clock, AlertCircle, CheckCircle2 } from "lucide-react";

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

function formatBody(body: string | undefined): string {
  if (!body) return "(empty)";
  try {
    const parsed = JSON.parse(body);
    const cleaned = stripUnderscoreKeys(parsed);
    return JSON.stringify(cleaned, null, 2);
  } catch {
    return body;
  }
}

export function ResponsePanel() {
  const tab = useActiveTab();
  if (!tab) return null;

  const handleCopy = () => {
    if (tab.response?.body) {
      navigator.clipboard.writeText(tab.response.body);
    }
  };

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
          The response status, headers, and body will show here.
        </p>
        <p className="text-xs text-muted-foreground/50 text-center max-w-xs">
          选择方法，填写请求，点击发送。
          响应状态、头部和内容将显示在这里。
        </p>
      </div>
    );
  }

  const isError = tab.response.error || tab.response.status === "ERROR";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
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

        <div className="ml-auto">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleCopy}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {tab.response.error && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-4 py-2">
          <p className="text-xs text-destructive">{tab.response.error}</p>
        </div>
      )}

      {Object.keys(tab.response.headers).length > 0 && (
        <div className="border-b border-border px-4 py-2">
          <div className="mb-1 text-[10px] font-medium text-muted-foreground">
            Headers / 响应头
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

      <div className="flex-1 overflow-auto">
        <div className="px-4 py-1.5 border-b border-border">
          <span className="text-[10px] font-medium text-muted-foreground">
            Body / 响应体
          </span>
        </div>
        <pre className="p-4 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap break-all">
          {formatBody(tab.response.body)}
        </pre>
      </div>
    </div>
  );
}
