import {
  getDefaultHeadersForProtocol,
  useAppStore,
  type RequestTab,
  type SavedRequest,
} from "@/lib/store";
import { inferRestBodyMode, toRestMethod } from "@/lib/rest";

function getContentType(metadata: SavedRequest["metadata"]): string {
  return metadata.find((m) => m.key.trim().toLowerCase() === "content-type")?.value ?? "";
}

export function openSavedRequest(entry: SavedRequest): void {
  useAppStore.getState().addTab(entry.protocol);
  const isRest = entry.protocol === "rest";
  const patch: Partial<RequestTab> = {
    protocolTab: entry.protocol,
    targetUrl: entry.url,
    metadata:
      entry.metadata.length > 0
        ? entry.metadata
        : getDefaultHeadersForProtocol(entry.protocol),
    requestBody: entry.requestBody,
    selectedPackage: isRest ? null : entry.packageName || null,
    selectedService: isRest ? null : entry.serviceName || null,
    selectedMethod: isRest ? null : entry.selectedMethod ?? null,
    response: entry.response,
    origin: "saved",
  };
  if (isRest) {
    patch.restMethod = toRestMethod(entry.restMethod ?? entry.methodFullName, "GET");
    patch.restBodyMode =
      entry.restBodyMode ?? inferRestBodyMode(entry.requestBody, getContentType(entry.metadata));
    patch.pathOverride = null;
  }
  useAppStore.getState().updateActiveTab(patch);
  if (entry.packageName && entry.serviceName) {
    document.dispatchEvent(
      new CustomEvent("penguin:focus-method", {
        detail: {
          packageName: entry.packageName,
          serviceName: entry.serviceName,
        },
      }),
    );
  }
}
