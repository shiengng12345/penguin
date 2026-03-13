import { Command } from "@tauri-apps/plugin-shell";
import { invoke } from "@tauri-apps/api/core";
import type { ProtocolTab, InstalledPackage } from "./store";
import { parseProtoContent } from "./proto-parser";
import { parseSdkDts } from "./sdk-parser";

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

function shellCmd(script: string, cwd: string) {
  return Command.create("zsh-login", ["-l", "-c", `cd ${JSON.stringify(cwd)} && ${script}`]);
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

  const cmd = shellCmd(
    `npm install --save --prefer-offline --no-audit --no-fund ${JSON.stringify(packageSpec)}`,
    dir
  );

  let finished = false;

  const logLine = (data: string) => {
    if (data.trim()) onLog(data.trimEnd());
  };
  cmd.stdout.on("data", logLine);
  cmd.stderr.on("data", logLine);

  const result = new Promise<boolean>((resolve) => {
    cmd.on("close", (ev) => {
      finished = true;
      if (ev.code === 0) {
        onLog("Installation complete!");
      } else {
        onLog(`Installation failed (exit code ${ev.code})`);
      }
      resolve(ev.code === 0);
    });
    cmd.on("error", (err) => {
      finished = true;
      onLog(`Error: ${err}`);
      resolve(false);
    });
  });

  const child = await cmd.spawn();

  setTimeout(() => {
    if (!finished) {
      onLog("Installation timed out (5 min). Killing process...");
      child.kill();
    }
  }, INSTALL_TIMEOUT_MS);

  return result;
}

export async function uninstallPackage(
  protocol: ProtocolTab,
  packageName: string,
  onLog: (line: string) => void
): Promise<boolean> {
  const dir = await ensurePackagesDir(protocol);
  onLog(`Removing ${packageName}...`);

  const cmd = shellCmd(
    `npm uninstall --no-audit --no-fund ${JSON.stringify(packageName)}`,
    dir
  );

  let finished = false;

  const logLine = (data: string) => {
    if (data.trim()) onLog(data.trimEnd());
  };
  cmd.stdout.on("data", logLine);
  cmd.stderr.on("data", logLine);

  const result = new Promise<boolean>((resolve) => {
    cmd.on("close", (ev) => {
      finished = true;
      if (ev.code === 0) onLog("Package removed!");
      else onLog(`Removal failed (exit code ${ev.code})`);
      resolve(ev.code === 0);
    });
    cmd.on("error", (err) => {
      finished = true;
      onLog(`Error: ${err}`);
      resolve(false);
    });
  });

  const child = await cmd.spawn();

  setTimeout(() => {
    if (!finished) {
      onLog("Uninstall timed out (5 min). Killing process...");
      child.kill();
    }
  }, INSTALL_TIMEOUT_MS);

  return result;
}
