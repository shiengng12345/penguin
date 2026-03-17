import { invoke } from "@tauri-apps/api/core";
import type { ProtocolTab, InstalledPackage } from "./store";

interface RawProtoFile {
  name: string;
  path: string;
  content: string;
}

interface RawInstalledPackage {
  name: string;
  version: string;
  protos: RawProtoFile[];
}

export async function ensurePackagesDir(
  protocol: ProtocolTab
): Promise<string> {
  return invoke<string>("ensure_packages_dir", { protocol });
}

export async function getPackagesDir(protocol: ProtocolTab): Promise<string> {
  return invoke<string>("get_packages_dir", { protocol });
}

export async function listInstalledPackages(
  protocol: ProtocolTab
): Promise<InstalledPackage[]> {
  const raw = await invoke<RawInstalledPackage[]>("list_installed_packages", {
    protocol,
  });

  const [{ parseProtoContent }, { parseSdkDts }] = await Promise.all([
    import("./proto-parser"),
    import("./sdk-parser"),
  ]);

  return raw.map((pkg) => {
    const files = pkg.protos.map((p) => ({ name: p.name, content: p.content }));
    const services =
      protocol === "sdk" ? parseSdkDts(files) : parseProtoContent(files);
    return {
      name: pkg.name,
      version: pkg.version,
      protoFiles: pkg.protos.map((p) => p.name),
      services,
    };
  });
}

const INSTALL_TIMEOUT_MS = 300_000;

async function shellCmd(script: string, cwd: string) {
  const { Command } = await import("@tauri-apps/plugin-shell");
  return Command.create("zsh-login", ["-l", "-c", `cd ${JSON.stringify(cwd)} && ${script}`]);
}

interface CommandRunResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
}

async function runLoggedCommand(
  script: string,
  cwd: string,
  onLog: (line: string) => void,
  timeoutMessage: string
): Promise<CommandRunResult> {
  const cmd = await shellCmd(script, cwd);

  let finished = false;
  let output = "";
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const appendOutput = (data: string) => {
    output += data;
    if (data.trim()) onLog(data.trimEnd());
  };

  cmd.stdout.on("data", appendOutput);
  cmd.stderr.on("data", appendOutput);

  const result = new Promise<CommandRunResult>((resolve) => {
    const resolveOnce = (value: CommandRunResult) => {
      if (finished) return;
      finished = true;
      if (timeoutId) clearTimeout(timeoutId);
      resolve(value);
    };

    cmd.on("close", (ev) => {
      resolveOnce({
        ok: ev.code === 0,
        exitCode: ev.code,
        output,
      });
    });

    cmd.on("error", (err) => {
      onLog(`Error: ${err}`);
      resolveOnce({
        ok: false,
        exitCode: null,
        output: output + String(err),
      });
    });
  });

  const child = await cmd.spawn();

  timeoutId = setTimeout(() => {
    if (finished) return;
    onLog(timeoutMessage);
    child.kill();
  }, INSTALL_TIMEOUT_MS);

  return result;
}

function isLikelyStalePackument(result: CommandRunResult): boolean {
  return (
    result.output.includes("ETARGET") ||
    result.output.includes("No matching version found")
  );
}

function npmInstallScript(packageSpec: string, preferOffline: boolean): string {
  const args = [
    "npm",
    "install",
    "--save",
    "--no-audit",
    "--no-fund",
  ];

  if (preferOffline) {
    args.push("--prefer-offline");
  }

  args.push(JSON.stringify(packageSpec));
  return args.join(" ");
}

export async function installPackage(
  protocol: ProtocolTab,
  packageSpec: string,
  onLog: (line: string) => void
): Promise<boolean> {
  const dir = await ensurePackagesDir(protocol);
  onLog(`Installing ${packageSpec}...`);
  onLog(`Protocol: ${protocol.toUpperCase()}`);
  onLog(`Target: ${dir}`);

  let result = await runLoggedCommand(
    npmInstallScript(packageSpec, true),
    dir,
    onLog,
    "Installation timed out (5 min). Killing process..."
  );

  if (!result.ok && isLikelyStalePackument(result)) {
    onLog("Registry metadata may be stale. Retrying without --prefer-offline...");
    result = await runLoggedCommand(
      npmInstallScript(packageSpec, false),
      dir,
      onLog,
      "Retry timed out (5 min). Killing process..."
    );
  }

  if (result.ok) {
    onLog("Installation complete!");
    return true;
  }

  onLog(`Installation failed (exit code ${result.exitCode ?? "unknown"})`);
  return false;
}

export async function uninstallPackage(
  protocol: ProtocolTab,
  packageName: string,
  onLog: (line: string) => void
): Promise<boolean> {
  const dir = await ensurePackagesDir(protocol);
  onLog(`Removing ${packageName}...`);

  const result = await runLoggedCommand(
    `npm uninstall --no-audit --no-fund ${JSON.stringify(packageName)}`,
    dir,
    onLog,
    "Uninstall timed out (5 min). Killing process..."
  );

  if (result.ok) onLog("Package removed!");
  else onLog(`Removal failed (exit code ${result.exitCode ?? "unknown"})`);

  return result.ok;
}
