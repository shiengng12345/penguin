import { useAppStore, useActiveTab } from "@/lib/store";
import { EnvInput } from "@/components/ui/env-input";
import { Badge } from "@/components/ui/badge";
import { Send, Globe, Server } from "lucide-react";
import { Button } from "@/components/ui/button";

interface UrlBarProps {
  resolvedUrl: string | null;
}

export function UrlBar({ resolvedUrl }: UrlBarProps) {
  const { updateActiveTab } = useAppStore();
  const tab = useActiveTab();
  if (!tab) return null;

  const servicePath = tab.selectedMethod
    ? (() => {
        const typeName = tab.selectedMethod.fullName.substring(0, tab.selectedMethod.fullName.lastIndexOf("."));
        const methodName = tab.selectedMethod.fullName.substring(tab.selectedMethod.fullName.lastIndexOf(".") +1);
        const protoPackage = typeName.split(".")[0];
        return `/${protoPackage}/${typeName}/${methodName}`;
      })()
    : null;

  const displayUrl = resolvedUrl ?? tab.targetUrl;
  const fullRequestUrl = servicePath && displayUrl
    ? `${displayUrl.replace(/\/$/, "")}${servicePath}`
    : null;

  return (
    <div className="border-b border-border bg-card" data-tour="url-bar">
      <div className="flex items-center gap-2 px-4 py-2">
        <Badge
          variant="outline"
          className="shrink-0 font-mono text-[10px] gap-1"
        >
          {tab.protocolTab === "grpc-web" ? (
            <Globe className="h-3 w-3" />
          ) : (
            <Server className="h-3 w-3" />
          )}
          {tab.protocolTab.toUpperCase()}
        </Badge>

        <EnvInput
          value={tab.targetUrl}
          onChange={(url) => updateActiveTab({ targetUrl: url })}
          placeholder="Enter URL — e.g. {{ URL }} or http://localhost:8080"
          className="flex-1"
        />

        <Button
          onClick={() => {
            document.dispatchEvent(new CustomEvent("pengvi:send-request"));
          }}
          disabled={tab.isLoading || !tab.targetUrl.trim() || !tab.selectedMethod}
          size="default"
          data-tour="send-btn"
        >
          <Send className="mr-1.5 h-4 w-4" />
          {tab.isLoading ? "Sending..." : "Send"}
        </Button>
      </div>

      {fullRequestUrl && (
        <div className="flex items-center gap-2 px-4 pb-1.5 -mt-0.5">
          <span className="text-[10px] text-muted-foreground">POST</span>
          <span className="font-mono text-[10px] text-primary truncate select-all">
            {fullRequestUrl}
          </span>
        </div>
      )}

      {tab.selectedMethod && (
        <div className="flex items-center gap-2 px-4 pb-2 -mt-0.5">
          <span className="text-[10px] text-muted-foreground">Method:</span>
          <span className="font-mono text-[10px] text-foreground">
            {tab.selectedMethod.fullName}
          </span>
          <span className="text-[10px] text-muted-foreground">
            ({tab.selectedMethod.requestType} → {tab.selectedMethod.responseType})
          </span>
        </div>
      )}
    </div>
  );
}
