// grpc-native-client now lives in @penguin/core. This shim handles the
// Tauri-specific concerns: ensuring @grpc/grpc-js is installed in the user's
// grpc packages dir and running the sidecar script via the shared cached-path
// runner in sidecar.ts (one login shell per session instead of per request).
import { Command } from "@tauri-apps/plugin-shell";
import { callGrpcNative as coreCallGrpcNative } from "@penguin/core";
import type { GrpcNativeCallParams, SidecarRunner } from "@penguin/core";
import type { ResponseState } from "@penguin/core";
import { ensurePackagesDir } from "./package-manager";
import { NODE_PATH_SETUP, runNodeScript } from "./sidecar";

let depsInstalled = false;

async function ensureGrpcDeps(): Promise<void> {
  if (depsInstalled) return;

  const dir = await ensurePackagesDir("grpc");
  // NODE_PATH_SETUP so npm resolves even when launched from the Dock with a
  // .zshrc-only nvm setup (same fix as package-manager.ts, v1.8.0).
  const checkDeps = () =>
    Command.create("zsh-login", [
      "-l", "-c",
      `${NODE_PATH_SETUP}; cd ${JSON.stringify(dir)} && npm ls @grpc/grpc-js @grpc/proto-loader --json`,
    ]).execute();

  const out = await checkDeps();
  const needsInstall =
    out.code !== 0 ||
    !out.stdout.includes("@grpc/grpc-js") ||
    !out.stdout.includes("@grpc/proto-loader");

  if (needsInstall) {
    const install = Command.create("zsh-login", [
      "-l", "-c",
      `${NODE_PATH_SETUP}; cd ${JSON.stringify(dir)} && npm install --save --prefer-offline --no-audit --no-fund @grpc/grpc-js @grpc/proto-loader`,
    ]);
    const installOut = await install.execute();
    if (installOut.code !== 0) {
      throw new Error(installOut.stderr || installOut.stdout || "Failed to install gRPC dependencies");
    }

    const verify = await checkDeps();
    if (
      verify.code !== 0 ||
      !verify.stdout.includes("@grpc/grpc-js") ||
      !verify.stdout.includes("@grpc/proto-loader")
    ) {
      throw new Error(verify.stderr || verify.stdout || "gRPC dependencies were not installed");
    }
  }
  depsInstalled = true;
}

export async function callGrpcNative(
  params: GrpcNativeCallParams,
  signal?: AbortSignal,
): Promise<ResponseState> {
  await ensureGrpcDeps();
  // Bind the abort signal via closure: aborting kills the node process.
  const runner: SidecarRunner = (script) => runNodeScript(script, signal);
  return coreCallGrpcNative(params, runner);
}
