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

  // Topology — App owns the scheduler + the notification, Settings
  // doesn't import the updater plugin directly. This is the load-bearing
  // shape; everything else is incidental wiring.
  assert.match(appSource, /useAppUpdateScheduler/);
  assert.match(appSource, /UpdateNotification/);
  // The downloadInstallAndRestart action lives on appUpdate and is
  // routed into UpdateNotification (catches accidental rename / decoupling).
  assert.match(appSource, /onUpdate=\{appUpdate\.downloadInstallAndRestart\}/);
  // KEEP THIS VERBATIM — the single line that prevents Settings from
  // re-acquiring its own updater dependency (was the original bug:
  // Settings polled in parallel with the scheduler, double-prompting).
  assert.doesNotMatch(settingsSource, /from "@tauri-apps\/plugin-updater"/);
  // Settings consumes the appUpdate controller (no own polling).
  assert.match(settingsSource, /appUpdate/);
  // Header surfaces the "update available" badge from controller state.
  assert.match(headerSource, /hasVisibleUpdate/);
  // Notification UI carries the visible action labels.
  assert.match(notificationSource, /Penguin update available/);
  assert.match(notificationSource, /Later/);
  // Scheduler hook polls via setInterval + focus, calls check() and
  // installs via relaunch() (no full-page reload as a workaround).
  assert.match(hookSource, /setInterval/);
  assert.match(hookSource, /addEventListener\("focus"/);
  assert.match(hookSource, /check\(\)/);
  assert.match(hookSource, /await relaunch\(\)/);
  assert.doesNotMatch(hookSource, /window\.location\.reload\(\)/);
  // Persistence keys exist for last-checked + dismissed-version state.
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

test("auto-check-for-updates is opt-in (default false) and gates the scheduler effect", async () => {
  // Background polling (startup timer / interval / focus) must NOT run unless
  // the user explicitly opts in. Default state is OFF so a fresh install
  // never reaches the updater endpoint without consent.
  const hookSource = await readFile(
    new URL("../src/hooks/useAppUpdateScheduler.ts", import.meta.url),
    "utf8",
  );

  // The persisted setting key exists in the central registry.
  const keysSource = await readFile(
    new URL("../src/lib/persistence-keys.ts", import.meta.url),
    "utf8",
  );
  assert.match(keysSource, /autoCheckForUpdates:\s*"penguin-auto-check-for-updates"/);

  // Default reading: only "1" enables — everything else (null, "0",
  // garbage) falls through to false. So a fresh install is OFF.
  assert.match(
    hookSource,
    /getPersistedValue\(APP_VALUE_KEYS\.autoCheckForUpdates\) === "1"/,
  );

  // The scheduler effect early-returns when autoCheckEnabled is false.
  assert.match(
    hookSource,
    /if \(!autoCheckEnabled\) \{[\s\S]{0,80}?return;[\s\S]{0,20}?\}/,
  );

  // The effect's dependency list includes autoCheckEnabled + runCheck
  // so flipping the toggle in Settings actually starts/stops polling
  // without a reload. Asserted as an unordered set — React treats dep
  // arrays as a set, so locking the exact order would be brittle.
  const depMatch = hookSource.match(/\},\s*\[([^\]]+)\]\);(?=[\s\S]{0,200}?autoCheckEnabled \|\| !appWindowFocusedRef|[\s\S]{0,200}?return;)/)
    ?? hookSource.match(/if \(!autoCheckEnabled\)[\s\S]*?\},\s*\[([^\]]+)\]\)/);
  assert.ok(depMatch, "scheduler effect dependency array not found");
  const deps = depMatch[1];
  assert.match(deps, /\brunCheck\b/);
  assert.match(deps, /\bautoCheckEnabled\b/);

  // Setter persists via setPersistedValue with "1" / "0" so the value
  // survives reload and round-trips through the default reader above.
  assert.match(
    hookSource,
    /setPersistedValue\(APP_VALUE_KEYS\.autoCheckForUpdates, next \? "1" : "0"\)/,
  );

  // Controller surfaces both autoCheckEnabled + setAutoCheckEnabled so the
  // settings dialog can drive it.
  assert.match(hookSource, /autoCheckEnabled: boolean;/);
  assert.match(hookSource, /setAutoCheckEnabled: \(next: boolean\) => void;/);

  // Settings UI renders a checkbox bound to the controller — default-false
  // user-controllable opt-in.
  const settingsSource = await readFile(
    new URL("../src/components/settings/SettingsDialog.tsx", import.meta.url),
    "utf8",
  );
  assert.match(settingsSource, /type="checkbox"/);
  assert.match(settingsSource, /checked=\{appUpdate\.autoCheckEnabled\}/);
  assert.match(
    settingsSource,
    /onChange=\{\(e\) => appUpdate\.setAutoCheckEnabled\(e\.target\.checked\)\}/,
  );
  assert.match(settingsSource, /Auto-check for updates/);
});
