import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("app starts directly in request workspace without a Packages home page", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const tabBarSource = await readFile(new URL("../src/components/layout/TabBar.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(appSource, /PackagesHome/);
  assert.doesNotMatch(appSource, /homeActive/);
  assert.doesNotMatch(appSource, /onHomeClick/);
  assert.doesNotMatch(tabBarSource, /Packages/);
  assert.doesNotMatch(tabBarSource, /homeActive/);
  assert.doesNotMatch(tabBarSource, /onHomeClick/);
});

test("app always renders request chrome for the active request tab", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

  assert.match(appSource, /<UrlBar resolvedUrl=\{resolvedUrl\} \/>/);
  assert.match(appSource, /<RequestPanel \/>/);
  assert.match(appSource, /<ResponsePanel \/>/);
  assert.doesNotMatch(appSource, /activeTab \? \(/);
});

test("request sidebar switches horizontally between packages and collections", async () => {
  const sidebarSource = await readFile(new URL("../src/components/layout/Sidebar.tsx", import.meta.url), "utf8");

  assert.match(sidebarSource, /savedRequests/);
  assert.match(sidebarSource, /Collections/);
  assert.match(sidebarSource, /const \[sidebarView, setSidebarView\]/);
  assert.match(sidebarSource, /sidebarView === "packages"/);
  assert.match(sidebarSource, /sidebarView === "collections"/);
  assert.match(sidebarSource, /aria-pressed=\{sidebarView === "packages"\}/);
  assert.match(sidebarSource, /aria-pressed=\{sidebarView === "collections"\}/);
  assert.match(sidebarSource, /openSavedRequest/);
  assert.doesNotMatch(sidebarSource, /ChevronsDownUp/);
  assert.doesNotMatch(sidebarSource, /\{collectionsSection\}/);
});

test("request sidebar tabs use a quiet underline selected state", async () => {
  const sidebarSource = await readFile(new URL("../src/components/layout/Sidebar.tsx", import.meta.url), "utf8");

  assert.match(sidebarSource, /border-b-2/);
  assert.match(sidebarSource, /h-7 min-w-0/);
  assert.match(sidebarSource, /border-primary text-primary/);
  assert.doesNotMatch(sidebarSource, /bg-primary\/15/);
  assert.doesNotMatch(sidebarSource, /border-primary\/60 bg-primary/);
});

test("request sidebar does not duplicate method search", async () => {
  const sidebarSource = await readFile(new URL("../src/components/layout/Sidebar.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(sidebarSource, /Search methods\.\.\./);
  assert.doesNotMatch(sidebarSource, /searchQuery/);
  assert.doesNotMatch(sidebarSource, /filteredPackages/);
});

test("desktop persistence has SQLite commands for app state and saved requests", async () => {
  const rustSource = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const cargoSource = await readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
  const dbBridgeSource = await readFile(new URL("../src/lib/penguin-db.ts", import.meta.url), "utf8");

  assert.match(cargoSource, /rusqlite/);
  assert.match(rustSource, /CREATE TABLE IF NOT EXISTS app_kv/);
  assert.match(rustSource, /fn db_set_app_value/);
  assert.match(rustSource, /fn db_get_app_value/);
  assert.match(rustSource, /fn db_list_app_values/);
  assert.match(rustSource, /CREATE TABLE IF NOT EXISTS saved_requests/);
  assert.match(rustSource, /fn db_upsert_saved_request/);
  assert.match(rustSource, /fn db_list_saved_requests/);
  assert.match(rustSource, /db_set_app_value,/);
  assert.match(rustSource, /db_get_app_value,/);
  assert.match(rustSource, /db_list_app_values,/);
  assert.match(rustSource, /db_upsert_saved_request,/);
  assert.match(dbBridgeSource, /invoke\("db_set_app_value"/);
  assert.match(dbBridgeSource, /invoke<string \| null>\("db_get_app_value"/);
  assert.match(dbBridgeSource, /invoke<Record<string, string>>\("db_list_app_values"/);
  assert.match(dbBridgeSource, /invoke\("db_upsert_saved_request"/);
  assert.match(dbBridgeSource, /invoke<SavedRequest\[\]>\("db_list_saved_requests"/);
});

test("app state no longer writes browser storage from product surfaces", async () => {
  const productFiles = [
    "../src/main.tsx",
    "../src/lib/store.ts",
    "../src/hooks/useEnvironments.ts",
    "../src/components/environment/EnvManager.tsx",
    "../src/components/environment/CurlImport.tsx",
    "../src/components/settings/SettingsDialog.tsx",
  ];

  for (const file of productFiles) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /localStorage/, `${file} should persist through SQLite helpers`);
  }
});

test("version cache uses SQLite app values", async () => {
  const mainSource = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");

  assert.match(mainSource, /getAppValueFromDatabase/);
  assert.match(mainSource, /setAppValueInDatabase/);
  assert.doesNotMatch(mainSource, /localStorage/);
});
