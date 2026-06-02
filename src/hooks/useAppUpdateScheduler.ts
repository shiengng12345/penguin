import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  STARTUP_UPDATE_CHECK_DELAY_MS,
  shouldRunUpdateCheck,
  shouldShowUpdateBadge,
  UPDATE_CHECK_INTERVAL_MS,
  normalizeUpdateError,
} from "@/lib/app-update";
import { getPersistedValue, setPersistedValue } from "@/lib/app-persistence";
import { APP_VALUE_KEYS } from "@/lib/persistence-keys";
import { logger } from "@/lib/logger";

export type AppUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "ready"
  | "error";

export interface AppUpdateController {
  status: AppUpdateStatus;
  updateInfo: Update | null;
  updateVersion: string | null;
  updateError: string;
  downloadProgress: number;
  hasVisibleUpdate: boolean;
  shouldShowToast: boolean;
  checkNow: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  downloadInstallAndRestart: () => Promise<void>;
  restart: () => Promise<void>;
  dismiss: () => void;
  openUpdateSettings: () => void;
}

async function restartApplication(): Promise<void> {
  await relaunch();
}

export function useAppUpdateScheduler(onOpenSettings: () => void): AppUpdateController {
  const [status, setStatus] = useState<AppUpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<Update | null>(null);
  const [updateError, setUpdateError] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(() =>
    import.meta.env.DEV ? null : getPersistedValue(APP_VALUE_KEYS.updateDismissedVersion),
  );
  const checkingRef = useRef(false);

  const runCheck = useCallback(
    async (manual: boolean) => {
      if (checkingRef.current) return;

      const now = new Date();
      const lastCheckedAt = getPersistedValue(APP_VALUE_KEYS.updateLastCheckedAt);
      if (
        !shouldRunUpdateCheck({
          nowMs: now.getTime(),
          lastCheckedAt,
          manual,
        })
      ) {
        return;
      }

      checkingRef.current = true;
      setStatus("checking");
      setUpdateError("");

      try {
        const update = await check();
        setPersistedValue(APP_VALUE_KEYS.updateLastCheckedAt, now.toISOString());

        if (update) {
          setUpdateInfo(update);
          setStatus("available");
        } else {
          setUpdateInfo(null);
          setStatus("up-to-date");
        }
      } catch (error) {
        const message = normalizeUpdateError(error);
        if (manual) {
          setUpdateError(message);
          setStatus("error");
        } else {
          logger.warn("AppUpdateScheduler", "Scheduled update check failed", {
            error: message,
          });
          setStatus("idle");
        }
      } finally {
        checkingRef.current = false;
      }
    },
    [],
  );

  useEffect(() => {
    if (import.meta.env.DEV) {
      return;
    }

    const startupTimer = window.setTimeout(() => {
      void runCheck(false);
    }, STARTUP_UPDATE_CHECK_DELAY_MS);
    const interval = window.setInterval(() => {
      void runCheck(false);
    }, UPDATE_CHECK_INTERVAL_MS);
    const onFocus = () => {
      void runCheck(false);
    };

    window.addEventListener("focus", onFocus);

    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [runCheck]);

  const checkNow = useCallback(async () => {
    await runCheck(true);
  }, [runCheck]);

  const installUpdate = useCallback(async (): Promise<boolean> => {
    if (!updateInfo) return false;

    setStatus("downloading");
    setDownloadProgress(0);
    setUpdateError("");

    try {
      let totalLen = 0;
      let downloaded = 0;

      await updateInfo.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalLen = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          if (totalLen > 0) {
            setDownloadProgress(Math.round((downloaded / totalLen) * 100));
          }
        } else if (event.event === "Finished") {
          setDownloadProgress(100);
        }
      });

      setStatus("ready");
      return true;
    } catch (error) {
      setUpdateError(normalizeUpdateError(error));
      setStatus("error");
      return false;
    }
  }, [updateInfo]);

  const downloadAndInstall = useCallback(async () => {
    await installUpdate();
  }, [installUpdate]);

  const restart = useCallback(async () => {
    await restartApplication();
  }, []);

  const downloadInstallAndRestart = useCallback(async () => {
    const installed = await installUpdate();
    if (installed) {
      await restartApplication();
    }
  }, [installUpdate]);

  const updateVersion = updateInfo?.version ?? null;
  const hasVisibleUpdate = shouldShowUpdateBadge({
    updateVersion,
    dismissedVersion,
  });

  const dismiss = useCallback(() => {
    if (!updateVersion) return;

    setDismissedVersion(updateVersion);
    if (!import.meta.env.DEV) {
      setPersistedValue(APP_VALUE_KEYS.updateDismissedVersion, updateVersion);
    }
  }, [updateVersion]);

  const openUpdateSettings = useCallback(() => {
    onOpenSettings();
  }, [onOpenSettings]);

  return useMemo(
    () => ({
      status,
      updateInfo,
      updateVersion,
      updateError,
      downloadProgress,
      hasVisibleUpdate,
      shouldShowToast: hasVisibleUpdate && (status === "available" || status === "downloading"),
      checkNow,
      downloadAndInstall,
      downloadInstallAndRestart,
      restart,
      dismiss,
      openUpdateSettings,
    }),
    [
      status,
      updateInfo,
      updateVersion,
      updateError,
      downloadProgress,
      hasVisibleUpdate,
      checkNow,
      downloadAndInstall,
      downloadInstallAndRestart,
      restart,
      dismiss,
      openUpdateSettings,
    ],
  );
}
