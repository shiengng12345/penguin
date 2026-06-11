// sdk-client now lives in @penguin/core. This shim wires in the shared
// sidecar runner (cached node path, one login shell per session) and
// preserves the old single-arg signature so existing call sites keep working.
import { callSdk as coreCallSdk } from "@penguin/core";
import type { SdkCallParams, SidecarRunner, ResponseState } from "@penguin/core";
import { runNodeScript } from "./sidecar";

export function callSdk(params: SdkCallParams, signal?: AbortSignal): Promise<ResponseState> {
  // Bind the abort signal via closure: aborting kills the node process.
  const runner: SidecarRunner = (script) => runNodeScript(script, signal);
  return coreCallSdk(params, runner);
}
