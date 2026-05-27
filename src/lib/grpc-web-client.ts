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

export function callGrpcWeb(params: GrpcWebCallParams): Promise<ResponseState> {
  return coreCallGrpcWeb({
    ...params,
    loadModule: loadPackageModule,
    fetch: proxyFetch,
  });
}
