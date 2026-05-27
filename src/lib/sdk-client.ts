// sdk-client now lives in @pengvi/core. This shim provides the Tauri-specific
// sidecar runner (base64 + zsh-login + node -) and preserves the old single-arg
// signature so existing call sites keep working.
import { Command } from "@tauri-apps/plugin-shell";
import { callSdk as coreCallSdk } from "@pengvi/core";
import type { SdkCallParams, SidecarRunner, ResponseState } from "@pengvi/core";

const tauriRunner: SidecarRunner = async (script: string) => {
  const b64 = btoa(unescape(encodeURIComponent(script)));
  const cmd = Command.create("zsh-login", [
    "-l", "-c",
    `echo "${b64}" | base64 -d | node -`,
  ]);
  const out = await cmd.execute();
  return { stdout: out.stdout, stderr: out.stderr, code: out.code ?? 0 };
};

export function callSdk(params: SdkCallParams): Promise<ResponseState> {
  return coreCallSdk(params, tauriRunner);
}
