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
