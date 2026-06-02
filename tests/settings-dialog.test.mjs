import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("MCP settings show Codex setup alongside Claude clients", async () => {
  const source = await readFile(
    new URL("../src/components/settings/SettingsDialog.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /Codex CLI/);
  assert.match(source, /codex mcp add penguin --/);
  assert.match(source, /Claude Desktop \/ Cursor/);
  assert.match(source, /Claude Code/);
});

test("MCP primary action uses client-neutral wording", async () => {
  const source = await readFile(
    new URL("../src/components/settings/SettingsDialog.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /Configure Claude \+ Codex/);
  assert.match(source, /Reconfigure Claude \+ Codex/);
  assert.match(source, /Both Configured/);
  assert.match(source, /Partial Setup/);
  assert.match(source, /invoke<string>\("mcp_install_to_local_clients"\)/);
  assert.doesNotMatch(source, /Add to Claude Desktop/);
  assert.doesNotMatch(source, /Re-add to Claude Desktop/);
  assert.doesNotMatch(source, /Claude Desktop Configured/);
  assert.doesNotMatch(source, /Restart Claude Desktop/);
});

test("MCP install refreshes status after partial failure", async () => {
  const source = await readFile(
    new URL("../src/components/settings/SettingsDialog.tsx", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("  const handleMcpInstall");
  const end = source.indexOf("  const mcpNodePath", start);
  const handler = source.slice(start, end);

  assert.match(handler, /catch \(err\) \{\n\s+await refreshMcpStatus\(\);\n\s+setMcpInstallMsg/);
});

test("MCP backend exposes only the dual-client install command", async () => {
  const source = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

  assert.match(source, /fn mcp_install_to_local_clients/);
  assert.match(source, /mcp_install_to_local_clients,/);
  assert.doesNotMatch(source, /fn mcp_install_to_claude_desktop/);
  assert.doesNotMatch(source, /mcp_install_to_claude_desktop,/);
});

test("clear cache refreshes package state without reloading the app", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const storeSource = await readFile(new URL("../src/lib/store.ts", import.meta.url), "utf8");
  const settingsSource = await readFile(
    new URL("../src/components/settings/SettingsDialog.tsx", import.meta.url),
    "utf8",
  );
  const clearStart = settingsSource.indexOf("  const handleClearCache");
  const clearEnd = settingsSource.indexOf("  const updateHeader", clearStart);
  const clearHandler = settingsSource.slice(clearStart, clearEnd);

  assert.match(settingsSource, /onPackagesCleared: \(\) => Promise<void>/);
  assert.match(storeSource, /resetPackageTabs: \(\) => void/);
  assert.match(storeSource, /resetPackageTabs: \(\) => \{/);
  assert.match(storeSource, /const fresh = createTab\(\)/);
  assert.match(storeSource, /set\(\{ tabs: \[fresh\], activeTabId: fresh\.id \}\)/);
  assert.match(storeSource, /saveTabs\(\[fresh\], fresh\.id\)/);
  assert.match(storeSource, /selectedPackage: null/);
  assert.match(storeSource, /selectedService: null/);
  assert.match(storeSource, /selectedMethod: null/);
  assert.match(appSource, /const handlePackagesCleared/);
  assert.match(appSource, /resetPackageTabs\(\);\n\s+await refresh\(\);/);
  assert.match(appSource, /onPackagesCleared=\{handlePackagesCleared\}/);
  assert.match(clearHandler, /await invoke<string>\("clear_all_packages"\)/);
  assert.match(clearHandler, /await onPackagesCleared\(\)/);
  assert.doesNotMatch(clearHandler, /window\.location\.reload/);
});

test("manage environments uses an explicit button affordance", async () => {
  const source = await readFile(
    new URL("../src/components/settings/SettingsDialog.tsx", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("Manage Environments / 管理环境");
  const section = source.slice(Math.max(0, start - 900), start + 500);

  assert.match(section, /Settings2/);
  assert.match(section, /ChevronRight/);
  assert.match(section, /variant="outline"/);
  assert.match(section, /justify-between/);
  assert.match(section, /Open environment manager/);
});

test("settings default header tabs hide REST while the feature is disabled", async () => {
  const source = await readFile(
    new URL("../src/components/settings/SettingsDialog.tsx", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("const PROTOCOL_TABS");
  const end = source.indexOf("function envsForProtocol", start);
  const visibleTabs = source.slice(start, end);

  assert.match(visibleTabs, /id: "grpc-web"/);
  assert.match(visibleTabs, /id: "grpc"/);
  assert.match(visibleTabs, /id: "sdk"/);
  assert.doesNotMatch(visibleTabs, /id: "rest"/);
  assert.doesNotMatch(visibleTabs, /label: "REST"/);
});
