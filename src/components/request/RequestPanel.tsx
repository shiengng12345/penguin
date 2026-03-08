import { useEffect, useRef } from "react";
import { useAppStore, useActiveTab, type MetadataEntry } from "@/lib/store";
import { useEnvironments } from "@/hooks/useEnvironments";
import { interpolate } from "@/lib/environment-store";
import { callGrpcWeb } from "@/lib/grpc-web-client";
import { callGrpcNative } from "@/lib/grpc-native-client";
import { callSdk } from "@/lib/sdk-client";
import { getPackagesDir } from "@/lib/package-manager";
import { generateDefaultJson } from "@/lib/proto-parser";
import { Button } from "@/components/ui/button";
import { Send, Plus, X, RotateCcw, Copy, Braces } from "lucide-react";

export function RequestPanel() {
  const { updateActiveTab } = useAppStore();
  const tab = useActiveTab();
  const { activeEnv } = useEnvironments();
  const sendRef = useRef<() => void>(() => {});

  useEffect(() => {
    const handler = () => sendRef.current();
    document.addEventListener("pengvi:send-request", handler);
    return () => document.removeEventListener("pengvi:send-request", handler);
  }, []);

  if (!tab) return null;

  const handleSend = async () => {
    if (!tab.selectedMethod || !tab.targetUrl.trim()) return;

    const resolvedUrl = interpolate(tab.targetUrl, activeEnv);
    updateActiveTab({ isLoading: true, response: null });

    try {
      const protocol = tab.protocolTab;
      let result;

      if (protocol === "grpc-web") {
        const typeName = tab.selectedMethod.fullName.substring(
          0,
          tab.selectedMethod.fullName.lastIndexOf(".")
        );
        const methodName = tab.selectedMethod.fullName.substring(
          tab.selectedMethod.fullName.lastIndexOf(".") + 1
        );
        const protoPackage = typeName.split(".")[0];
        const servicePath = `/${protoPackage}/${typeName}/${methodName}`;

        result = await callGrpcWeb({
          url: resolvedUrl,
          servicePath,
          body: tab.requestBody,
          metadata: tab.metadata,
          packageName: tab.selectedPackage ?? undefined,
        });
      } else if (protocol === "grpc") {
        const typeName = tab.selectedMethod.fullName.substring(
          0,
          tab.selectedMethod.fullName.lastIndexOf(".")
        );
        const methodName = tab.selectedMethod.fullName.substring(
          tab.selectedMethod.fullName.lastIndexOf(".") + 1
        );
        const protoPackage = typeName.split(".")[0];
        const servicePath = `/${protoPackage}/${typeName}/${methodName}`;
        const packagesDir = await getPackagesDir("grpc");

        result = await callGrpcNative({
          url: resolvedUrl,
          servicePath,
          body: tab.requestBody,
          metadata: tab.metadata,
          packagesDir,
        });
      } else {
        const fullName = tab.selectedMethod.fullName;
        const parts = fullName.split(".");
        const methodName = parts.pop() ?? "";
        const serviceName =
          parts.length > 0 ? parts[parts.length - 1] : fullName;
        const packagesDir = await getPackagesDir("sdk");

        result = await callSdk({
          url: resolvedUrl,
          serviceName,
          methodName,
          body: tab.requestBody,
          metadata: tab.metadata,
          packagesDir,
        });
      }

      updateActiveTab({ response: result, isLoading: false });
    } catch (error) {
      updateActiveTab({
        response: {
          status: "ERROR",
          statusCode: 0,
          body: "",
          headers: {},
          duration: 0,
          error: error instanceof Error ? error.message : String(error),
        },
        isLoading: false,
      });
    }
  };

  const handleAddHeader = () => {
    updateActiveTab({
      metadata: [
        ...tab.metadata,
        { key: "", value: "", enabled: true },
      ],
    });
  };

  const handleUpdateHeader = (index: number, patch: Partial<MetadataEntry>) => {
    const next = [...tab.metadata];
    next[index] = { ...next[index], ...patch };
    updateActiveTab({ metadata: next });
  };

  const handleRemoveHeader = (index: number) => {
    const next = tab.metadata.filter((_, i) => i !== index);
    updateActiveTab({ metadata: next });
  };

  const handleResetBody = () => {
    if (tab.selectedMethod?.requestFields) {
      const defaultJson = generateDefaultJson(tab.selectedMethod.requestFields);
      updateActiveTab({
        requestBody: JSON.stringify(defaultJson, null, 2),
      });
    }
  };

  const handleFormatBody = () => {
    try {
      const parsed = JSON.parse(tab.requestBody);
      updateActiveTab({ requestBody: JSON.stringify(parsed, null, 2) });
    } catch {
      // not valid JSON — leave as-is
    }
  };

  const handleCopyBody = () => {
    navigator.clipboard.writeText(tab.requestBody);
  };

  sendRef.current = handleSend;

  const methodInfo =
    tab.selectedMethod && tab.selectedService
      ? `${tab.selectedService.split(".").pop() ?? tab.selectedService}.${tab.selectedMethod.name}`
      : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden border-r border-border">
      {methodInfo && (
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Method
          </span>
          <span className="font-mono text-xs text-foreground">{methodInfo}</span>
        </div>
      )}

      <div className="flex-1 flex flex-col min-h-0 overflow-auto">
        {/* Headers — compact table style */}
        <div className="border-b border-border">
          <div className="flex items-center justify-between px-3 py-1.5 bg-muted/20">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Headers
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-[10px]"
              onClick={handleAddHeader}
            >
              <Plus className="mr-1 h-3 w-3" />
              Add
            </Button>
          </div>
          {tab.metadata.length > 0 && (
            <div className="divide-y divide-border">
              {tab.metadata.map((entry, i) => (
                <div key={i} className="flex items-center gap-1.5 px-3 py-1 group">
                  <input
                    type="checkbox"
                    checked={entry.enabled}
                    onChange={(e) =>
                      handleUpdateHeader(i, { enabled: e.target.checked })
                    }
                    className="h-3.5 w-3.5 rounded border-border accent-primary shrink-0"
                  />
                  <input
                    value={entry.key}
                    onChange={(e) =>
                      handleUpdateHeader(i, { key: e.target.value })
                    }
                    placeholder="Key"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="h-7 flex-1 min-w-0 bg-transparent font-mono text-xs px-1.5 rounded border border-transparent focus:border-border focus:outline-none"
                  />
                  <span className="text-muted-foreground/40 text-xs shrink-0">:</span>
                  <input
                    value={entry.value}
                    onChange={(e) =>
                      handleUpdateHeader(i, { value: e.target.value })
                    }
                    placeholder="Value"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="h-7 flex-[2] min-w-0 bg-transparent font-mono text-xs px-1.5 rounded border border-transparent focus:border-border focus:outline-none"
                  />
                  <button
                    className="opacity-0 group-hover:opacity-100 h-5 w-5 shrink-0 inline-flex items-center justify-center rounded hover:bg-destructive/10 transition-opacity"
                    onClick={() => handleRemoveHeader(i)}
                  >
                    <X className="h-3 w-3 text-muted-foreground" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-3 py-1.5 bg-muted/20 border-b border-border">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Body
            </span>
            <div className="flex gap-0.5">
              <button
                className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
                onClick={handleFormatBody}
                title="Format JSON"
              >
                <Braces className="h-3 w-3" />
              </button>
              <button
                className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
                onClick={handleResetBody}
                title="Reset to default"
              >
                <RotateCcw className="h-3 w-3" />
              </button>
              <button
                className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
                onClick={handleCopyBody}
                title="Copy"
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </div>
          <textarea
            value={tab.requestBody}
            onChange={(e) =>
              updateActiveTab({ requestBody: e.target.value })
            }
            placeholder='{"key": "value"}'
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-gramm="false"
            className="flex-1 w-full bg-transparent px-3 py-2 font-mono text-xs resize-none focus:outline-none"
          />
        </div>
      </div>

      <div className="border-t border-border px-3 py-2">
        <Button
          onClick={handleSend}
          disabled={tab.isLoading || !tab.selectedMethod}
          className="w-full h-8"
          size="sm"
        >
          <Send className="mr-1.5 h-3.5 w-3.5" />
          {tab.isLoading ? "Sending..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
