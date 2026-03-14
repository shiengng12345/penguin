import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { useAppStore, useActiveTab, type MetadataEntry, type HistoryEntry, type SavedRequest } from "@/lib/store";
import { useEnvironments } from "@/hooks/useEnvironments";
import { interpolate } from "@/lib/environment-store";
import { Button } from "@/components/ui/button";
import { Send, Plus, X, RotateCcw, Copy, Braces, Bookmark, Check, FileText, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";

const LazyJsonEditor = lazy(() => import("@/components/ui/json-editor").then(m => ({ default: m.JsonEditor })));

export function RequestPanel() {
  const { updateActiveTab, addHistory, saveRequest } = useAppStore();
  const tab = useActiveTab();
  const { activeEnv } = useEnvironments();
  const sendRef = useRef<() => void>(() => {});
  const saveRef = useRef<() => void>(() => {});
  const [savedFlash, setSavedFlash] = useState(false);
  const [curlFlash, setCurlFlash] = useState(false);
  const [offlineFlash, setOfflineFlash] = useState(false);

  useEffect(() => {
    const sendHandler = () => sendRef.current();
    const saveHandler = () => saveRef.current();
    document.addEventListener("pengvi:send-request", sendHandler);
    document.addEventListener("pengvi:save-request", saveHandler);
    return () => {
      document.removeEventListener("pengvi:send-request", sendHandler);
      document.removeEventListener("pengvi:save-request", saveHandler);
    };
  }, []);

  if (!tab) return null;

  const handleSend = async () => {
    if (!tab.selectedMethod || !tab.targetUrl.trim()) return;

    if (!navigator.onLine) {
      setOfflineFlash(true);
      setTimeout(() => setOfflineFlash(false), 3000);
      return;
    }

    const resolvedUrl = interpolate(tab.targetUrl, activeEnv);
    updateActiveTab({ isLoading: true, response: null });

    const entry: HistoryEntry = {
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      protocol: tab.protocolTab,
      methodFullName: tab.selectedMethod.fullName,
      serviceName: tab.selectedService ?? "",
      packageName: tab.selectedPackage ?? "",
      url: tab.targetUrl,
      metadata: tab.metadata.filter((m) => m.enabled && m.key),
      requestBody: tab.requestBody,
      selectedMethod: tab.selectedMethod,
    };
    addHistory(entry);

    try {
      const protocol = tab.protocolTab;
      let result;

      if (protocol === "grpc-web") {
        const typeName = tab.selectedMethod.fullName.substring(
          0, tab.selectedMethod.fullName.lastIndexOf(".")
        );
        const methodName = tab.selectedMethod.fullName.substring(
          tab.selectedMethod.fullName.lastIndexOf(".") +1
        );
        const protoPackage = typeName.split(".")[0];
        const servicePath = `/${protoPackage}/${typeName}/${methodName}`;
        const { callGrpcWeb } = await import("@/lib/grpc-web-client");
        result = await callGrpcWeb({
          url: resolvedUrl,
          servicePath,
          body: tab.requestBody,
          metadata: tab.metadata,
          packageName: tab.selectedPackage ?? undefined,
        });
      } else if (protocol === "grpc") {
        const typeName = tab.selectedMethod.fullName.substring(
          0, tab.selectedMethod.fullName.lastIndexOf(".")
        );
        const methodName = tab.selectedMethod.fullName.substring(
          tab.selectedMethod.fullName.lastIndexOf(".") +1
        );
        const protoPackage = typeName.split(".")[0];
        const servicePath = `/${protoPackage}/${typeName}/${methodName}`;
        const { getPackagesDir } = await import("@/lib/package-manager");
        const packagesDir = await getPackagesDir("grpc");
        const { callGrpcNative } = await import("@/lib/grpc-native-client");
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
        const { getPackagesDir } = await import("@/lib/package-manager");
        const packagesDir = await getPackagesDir("sdk");
        const { callSdk } = await import("@/lib/sdk-client");
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

  const handleResetBody = async () => {
    if (tab.selectedMethod?.requestFields) {
      const { generateDefaultJson } = await import("@/lib/proto-parser");
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

  const handleSaveRequest = () => {
    if (!tab.selectedMethod) return;
    const methodShort = tab.selectedMethod.name;
    const serviceShort = tab.selectedService?.split(".").pop() ?? "";
    const defaultName = serviceShort
      ? `${serviceShort}.${methodShort}`
      : methodShort;

    const entry: SavedRequest = {
      id: `saved_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: defaultName,
      savedAt: Date.now(),
      protocol: tab.protocolTab,
      methodFullName: tab.selectedMethod.fullName,
      serviceName: tab.selectedService ?? "",
      packageName: tab.selectedPackage ?? "",
      url: tab.targetUrl,
      metadata: tab.metadata.filter((m) => m.key),
      requestBody: tab.requestBody,
      response: tab.response,
      selectedMethod: tab.selectedMethod,
    };
    saveRequest(entry);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  };

  const handleCopyCurl = () => {
    if (!tab.selectedMethod) return;
    const resolvedUrl = interpolate(tab.targetUrl, activeEnv);
    const typeName = tab.selectedMethod.fullName.substring(
      0, tab.selectedMethod.fullName.lastIndexOf(".")
    );
    const methodName = tab.selectedMethod.fullName.substring(
      tab.selectedMethod.fullName.lastIndexOf(".") +1
    );
    const protoPackage = typeName.split(".")[0];
    const servicePath = `/${protoPackage}/${typeName}/${methodName}`;
    const fullUrl = `${resolvedUrl.replace(/\/$/, "")}${servicePath}`;

    const headers = tab.metadata
      .filter((m) => m.enabled && m.key)
      .map((m) => `  -H '${m.key}: ${m.value}'`)
      .join(" \\\n");

    const contentTypeH = `  -H 'Content-Type: application/json'`;
    const allHeaders = headers
      ? `${contentTypeH} \\\n${headers}`
      : contentTypeH;

    let body = "";
    try {
      body = JSON.stringify(JSON.parse(tab.requestBody));
    } catch {
      body = tab.requestBody;
    }

    const curl = `curl -X POST '${fullUrl}' \\\n${allHeaders} \\\n  -d '${body}'`;
    navigator.clipboard.writeText(curl);
    setCurlFlash(true);
    setTimeout(() => setCurlFlash(false), 1500);
  };

  sendRef.current = handleSend;
  saveRef.current = handleSaveRequest;

  const methodInfo =
    tab.selectedMethod && tab.selectedService
      ? `${tab.selectedService.split(".").pop() ?? tab.selectedService}.${tab.selectedMethod.name}`
      : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden border-r border-border" data-tour="request-panel">
      {offlineFlash && (
        <div className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive flex items-center gap-2">
          <span>No internet connection</span>
          <button onClick={() => setOfflineFlash(false)} className="ml-auto text-destructive/60 hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
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
          <Suspense fallback={
            <textarea
              value={tab.requestBody}
              onChange={(e) => updateActiveTab({ requestBody: e.target.value })}
              className="flex-1 w-full bg-transparent font-mono text-xs p-3 resize-none focus:outline-none"
              spellCheck={false}
            />
          }>
            <LazyJsonEditor
              value={tab.requestBody}
              onChange={(val) => updateActiveTab({ requestBody: val })}
              fields={tab.selectedMethod?.requestFields}
            />
          </Suspense>
        </div>
      </div>

      <div className="border-t border-border px-3 py-2 flex gap-1.5">
        <Button
          onClick={handleSend}
          disabled={tab.isLoading || !tab.selectedMethod}
          className="flex-1 h-8"
          size="sm"
        >
          <Send className="mr-1.5 h-3.5 w-3.5" />
          {tab.isLoading ? "Sending..." : "Send"}
        </Button>
        <Button
          variant={savedFlash ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-8 transition-all",
            savedFlash ? "px-3 bg-success text-success-foreground hover:bg-success" : "px-2.5"
          )}
          onClick={handleSaveRequest}
          disabled={!tab.selectedMethod}
          title="Save request ⌘ + Shift + S (⌘ + O to open)"
          data-tour="save-btn"
        >
          {savedFlash ? (
            <>
              <Check className="mr-1 h-3.5 w-3.5" />
              <span className="text-xs">Saved!</span>
            </>
          ) : (
            <Bookmark className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          variant={curlFlash ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-8 transition-all",
            curlFlash ? "px-3 bg-success text-success-foreground hover:bg-success" : "px-2.5"
          )}
          onClick={handleCopyCurl}
          disabled={!tab.selectedMethod}
          title="Copy as cURL"
          data-tour="curl-btn"
        >
          {curlFlash ? (
            <>
              <Check className="mr-1 h-3.5 w-3.5" />
              <span className="text-xs">cURL</span>
            </>
          ) : (
            <Terminal className="h-3.5 w-3.5" />
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-2.5"
          onClick={() => document.dispatchEvent(new CustomEvent("pengvi:open-doc"))}
          disabled={!tab.selectedMethod}
          title="Request as Doc ⌘ + D"
        >
          <FileText className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
