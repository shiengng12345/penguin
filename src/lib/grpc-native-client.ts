// grpc-native-client now lives in @penguin/core. This shim handles the
// Tauri-specific concerns: ensuring @grpc/grpc-js is installed in the user's
// grpc packages dir (via npm under zsh-login) and running the sidecar script
// through @tauri-apps/plugin-shell.
import { Command } from "@tauri-apps/plugin-shell";
import { callGrpcNative as coreCallGrpcNative } from "@penguin/core";
import type { GrpcNativeCallParams, SidecarRunner } from "@penguin/core";
import type { ResponseState } from "@penguin/core";
import { ensurePackagesDir } from "./package-manager";

let depsInstalled = false;

async function ensureGrpcDeps(): Promise<void> {
  if (depsInstalled) return;

  const dir = await ensurePackagesDir("grpc");
  const check = Command.create("zsh-login", [
    "-l", "-c",
    `cd ${JSON.stringify(dir)} && npm ls @grpc/grpc-js --json`,
  ]);
  const out = await check.execute();
  const needsInstall =
    out.code !== 0 || !out.stdout.includes("@grpc/grpc-js");

  if (needsInstall) {
    const install = Command.create("zsh-login", [
      "-l", "-c",
      `cd ${JSON.stringify(dir)} && npm install --save --prefer-offline --no-audit --no-fund @grpc/grpc-js @grpc/proto-loader`,
    ]);
    await install.execute();
  }
  depsInstalled = true;
}

// Tauri runner: base64-encode the script and stream it into `node -` over a
// zsh-login shell so the user's PATH (nvm, asdf, etc.) is intact.
const tauriRunner: SidecarRunner = async (script: string) => {
  const b64 = btoa(unescape(encodeURIComponent(script)));
  const cmd = Command.create("zsh-login", [
    "-l", "-c",
    `echo "${b64}" | base64 -d | node -`,
  ]);
  const out = await cmd.execute();
  return { stdout: out.stdout, stderr: out.stderr, code: out.code ?? 0 };
};

export async function callGrpcNative(
  params: GrpcNativeCallParams,
): Promise<ResponseState> {
  await ensureGrpcDeps();
  return coreCallGrpcNative(params, tauriRunner);
}
