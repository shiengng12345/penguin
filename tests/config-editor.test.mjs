import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function readEditor() {
  return readFile(new URL("../tools/config-editor.html", import.meta.url), "utf8");
}

test("local config editor is a standalone HTML tool", async () => {
  const source = await readEditor();

  assert.match(source, /<!doctype html>/i);
  assert.match(source, /<title>Penguin Config Editor<\/title>/);
  assert.doesNotMatch(source, /<script[^>]+src=/i);
  assert.doesNotMatch(source, /<link[^>]+href=["']https?:\/\//i);
  assert.doesNotMatch(source, /from ["']https?:\/\//i);
});

test("config editor exposes simple form import and export controls", async () => {
  const source = await readEditor();

  for (const id of [
    "config-file",
    "json-input",
    "import-json",
    "protocol-tabs",
    "editor-title",
    "environment-form-list",
    "add-environment",
    "package-name",
    "package-version",
    "package-registry",
    "packages-input",
    "save-sdk",
    "copy-json",
    "download-json",
  ]) {
    assert.match(source, new RegExp(`id="${id}"`), id);
  }

  assert.doesNotMatch(source, /id="search-input"/);
  assert.doesNotMatch(source, /id="page-size"/);
  assert.doesNotMatch(source, /id="environment-table"/);
  assert.doesNotMatch(source, /<table[\s>]/i);
});

test("config editor uses a clean developer settings design", async () => {
  const source = await readEditor();

  assert.match(source, /font-family:\s*Inter,\s*system-ui/);
  assert.match(source, /--theme-bg:\s*#0b0d12/);
  assert.match(source, /--theme-panel:\s*#10131a/);
  assert.match(source, /--theme-accent:\s*#8b5cf6/);
  assert.match(source, /--content-width:\s*1200px/);
  assert.match(source, /data-design="developer-config-editor"/);
  assert.match(source, /class="protocol-shell"/);
  assert.match(source, /class="protocol-sidebar"/);
  assert.match(source, /class="config-form"/);
  assert.match(source, /Upload JSON/);
  assert.match(source, /Import JSON/);
  assert.match(source, /Export JSON/);
  assert.doesNotMatch(source, /Overview/);
  assert.doesNotMatch(source, /Environment summary/);
  assert.doesNotMatch(source, /Pagination/i);
});

test("config editor supports visible protocols only", async () => {
  const source = await readEditor();

  assert.match(source, /const PROTOCOLS = \["grpc", "grpc-web", "sdk"\]/);
  assert.match(source, /data-protocol="grpc"/);
  assert.match(source, /data-protocol="grpc-web"/);
  assert.match(source, /data-protocol="sdk"/);
  assert.doesNotMatch(source, /data-protocol="rest"/);
});

test("config editor has protocol form validation and JSON output functions", async () => {
  const source = await readEditor();

  for (const fn of [
    "normalizeConfig",
    "validateConfig",
    "renderEnvironmentForms",
    "renderSdkForm",
    "renderEditor",
    "addEnvironment",
    "saveEnvironment",
    "deleteEnvironment",
    "saveSdkConfig",
    "openImportDialog",
    "downloadConfig",
    "copyConfigJson",
  ]) {
    assert.match(source, new RegExp(`function ${fn}\\(`), fn);
  }

  assert.match(source, /URL/);
  assert.match(source, /TOKEN/);
  assert.match(source, /X_ENV_TAG/);
  assert.match(source, /packages/);
  assert.match(source, /Package Name/);
  assert.match(source, /Version/);
  assert.match(source, /Registry/);
});
