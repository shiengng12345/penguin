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

test("desktop persistence has SQLite commands for saved requests", async () => {
  const rustSource = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const cargoSource = await readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
  const dbBridgeSource = await readFile(new URL("../src/lib/penguin-db.ts", import.meta.url), "utf8");

  assert.match(cargoSource, /rusqlite/);
  assert.match(rustSource, /CREATE TABLE IF NOT EXISTS saved_requests/);
  assert.match(rustSource, /fn db_upsert_saved_request/);
  assert.match(rustSource, /fn db_list_saved_requests/);
  assert.match(rustSource, /db_upsert_saved_request,/);
  assert.match(dbBridgeSource, /invoke\("db_upsert_saved_request"/);
  assert.match(dbBridgeSource, /invoke<SavedRequest\[\]>\("db_list_saved_requests"/);
});
