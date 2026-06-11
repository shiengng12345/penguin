// grpc-web-client now lives in @penguin/core. This shim pre-binds the
// Tauri-specific dependencies (proxyFetch for CORS, loadPackageModule for
// runtime module loading) so existing call sites can keep the old signature.
import { callGrpcWeb as coreCallGrpcWeb } from "@penguin/core";
import type { MetadataEntry, ResponseState } from "@penguin/core";
import { loadPackageModule } from "./package-loader";
import { proxyFetch } from "./proxy-fetch";

interface GrpcWebCallParams {
  url: string;
  servicePath: string;
  body: string;
  metadata: MetadataEntry[];
  packageName?: string;
}

export function callGrpcWeb(
  params: GrpcWebCallParams,
  signal?: AbortSignal,
): Promise<ResponseState> {
  // Inject the abort signal into every proxied fetch for this call so Esc
  // cancels the request inside the Rust proxy, not just in the UI.
  const fetchWithSignal: typeof proxyFetch = (input, init) =>
    proxyFetch(input, signal ? { ...init, signal } : init);
  return coreCallGrpcWeb({
    ...params,
    loadModule: loadPackageModule,
    fetch: fetchWithSignal,
  });
}
