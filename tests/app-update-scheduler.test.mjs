import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function loadAppUpdateModule() {
  const source = await readFile(new URL("../src/lib/app-update.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const encoded = Buffer.from(outputText).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

test("scheduled update checks run only after the six hour cooldown", async () => {
  const { UPDATE_CHECK_INTERVAL_MS, shouldRunScheduledUpdateCheck } = await loadAppUpdateModule();
  const nowMs = Date.parse("2026-05-30T10:00:00.000Z");

  assert.equal(
    shouldRunScheduledUpdateCheck({
      nowMs,
      lastCheckedAt: "2026-05-30T05:59:59.999Z",
    }),
    false,
  );
  assert.equal(
    shouldRunScheduledUpdateCheck({
      nowMs,
      lastCheckedAt: new Date(nowMs - UPDATE_CHECK_INTERVAL_MS).toISOString(),
    }),
    true,
  );
  assert.equal(
    shouldRunScheduledUpdateCheck({
      nowMs,
      lastCheckedAt: null,
    }),
    true,
  );
});

test("manual update checks bypass the scheduler cooldown", async () => {
  const { shouldRunUpdateCheck } = await loadAppUpdateModule();
  const nowMs = Date.parse("2026-05-30T10:00:00.000Z");

  assert.equal(
    shouldRunUpdateCheck({
      nowMs,
      lastCheckedAt: "2026-05-30T09:59:00.000Z",
      manual: true,
    }),
    true,
  );
  assert.equal(
    shouldRunUpdateCheck({
      nowMs,
      lastCheckedAt: "2026-05-30T09:59:00.000Z",
      manual: false,
    }),
    false,
  );
});

test("dismissed versions hide only the matching update badge", async () => {
  const { shouldShowUpdateBadge } = await loadAppUpdateModule();

  assert.equal(
    shouldShowUpdateBadge({ updateVersion: "1.7.0", dismissedVersion: "1.7.0" }),
    false,
  );
  assert.equal(
    shouldShowUpdateBadge({ updateVersion: "1.7.1", dismissedVersion: "1.7.0" }),
    true,
  );
  assert.equal(
    shouldShowUpdateBadge({ updateVersion: null, dismissedVersion: "1.7.0" }),
    false,
  );
});

test("update scheduler is mounted globally and not inside Settings only", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const headerSource = await readFile(new URL("../src/components/layout/Header.tsx", import.meta.url), "utf8");
  const notificationSource = await readFile(
    new URL("../src/components/layout/UpdateNotification.tsx", import.meta.url),
    "utf8",
  );
  const settingsSource = await readFile(
    new URL("../src/components/settings/SettingsDialog.tsx", import.meta.url),
    "utf8",
  );
  const hookSource = await readFile(new URL("../src/hooks/useAppUpdateScheduler.ts", import.meta.url), "utf8");
  const keysSource = await readFile(new URL("../src/lib/persistence-keys.ts", import.meta.url), "utf8");

  assert.match(appSource, /useAppUpdateScheduler/);
  assert.match(appSource, /appUpdate=\{appUpdate\}/);
  assert.match(appSource, /UpdateNotification/);
  assert.match(appSource, /onUpdate=\{appUpdate\.downloadInstallAndRestart\}/);
  assert.match(headerSource, /hasVisibleUpdate/);
  assert.match(headerSource, /Update available/);
  assert.match(notificationSource, /Penguin update available/);
  assert.match(notificationSource, /Later/);
  assert.match(notificationSource, /Update/);
  assert.match(notificationSource, /ArrowDownToLine/);
  assert.match(settingsSource, /appUpdate/);
  assert.doesNotMatch(settingsSource, /from "@tauri-apps\/plugin-updater"/);
  assert.match(hookSource, /setTimeout/);
  assert.match(hookSource, /setInterval/);
  assert.match(hookSource, /addEventListener\("focus"/);
  assert.match(hookSource, /check\(\)/);
  assert.match(hookSource, /downloadInstallAndRestart/);
  assert.doesNotMatch(hookSource, /window\.location\.reload\(\)/);
  assert.match(hookSource, /await relaunch\(\)/);
  assert.match(hookSource, /APP_VALUE_KEYS\.updateLastCheckedAt/);
  assert.match(hookSource, /APP_VALUE_KEYS\.updateDismissedVersion/);
  assert.match(keysSource, /updateLastCheckedAt:\s*"penguin-update-last-checked-at"/);
  assert.match(keysSource, /updateDismissedVersion:\s*"penguin-update-dismissed-version"/);
});

test("development builds do not synthesize a fake update notification", async () => {
  const hookSource = await readFile(new URL("../src/hooks/useAppUpdateScheduler.ts", import.meta.url), "utf8");

  assert.doesNotMatch(hookSource, /DEV_PREVIEW_UPDATE_VERSION/);
  assert.doesNotMatch(hookSource, /createDevPreviewUpdate/);
  assert.doesNotMatch(hookSource, /showDevPreviewUpdate/);
  assert.doesNotMatch(hookSource, /version:\s*"1\.7\.0"/);
});
