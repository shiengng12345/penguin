import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Cmd+N opens the new request dialog instead of directly adding a tab", async () => {
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const cmdNStart = source.indexOf('case "n":');
  const cmdNEnd = source.indexOf("break;", cmdNStart);
  const cmdNBlock = source.slice(cmdNStart, cmdNEnd);

  assert.match(source, /NewRequestDialog/);
  assert.match(source, /const \[newRequestOpen, setNewRequestOpen\]/);
  assert.match(cmdNBlock, /setNewRequestOpen\(true\)/);
  assert.doesNotMatch(cmdNBlock, /addTab\(\)/);
});

test("tab plus button opens the same new request dialog", async () => {
  const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const tabBarSource = await readFile(new URL("../src/components/layout/TabBar.tsx", import.meta.url), "utf8");

  assert.match(appSource, /<TabBar[\s\S]*onNewRequest=\{\(\) => setNewRequestOpen\(true\)\}/);
  assert.match(tabBarSource, /onNewRequest/);
  assert.match(tabBarSource, /onClick=\{onNewRequest\}/);
});

test("new request dialog offers Penguin request types and creates protocol tabs", async () => {
  const source = await readFile(new URL("../src/components/request/NewRequestDialog.tsx", import.meta.url), "utf8");

  for (const label of ["gRPC-Web", "gRPC", "JS-SDK", "REST"]) {
    assert.match(source, new RegExp(label));
  }
  assert.match(source, /addTab\(option.protocol\)/);
});

test("new request dialog orders transport types with REST last", async () => {
  const source = await readFile(new URL("../src/components/request/NewRequestDialog.tsx", import.meta.url), "utf8");

  const grpcWeb = source.indexOf('protocol: "grpc-web"');
  const grpc = source.indexOf('protocol: "grpc"');
  const sdk = source.indexOf('protocol: "sdk"');
  const rest = source.indexOf('protocol: "rest"');

  assert.ok(grpcWeb > -1);
  assert.ok(grpc > grpcWeb);
  assert.ok(sdk > grpc);
  assert.ok(rest > sdk);
});

test("new request dialog uses option titles as accessible button labels", async () => {
  const source = await readFile(new URL("../src/components/request/NewRequestDialog.tsx", import.meta.url), "utf8");

  assert.match(source, /aria-label=\{option\.title\}/);
  assert.match(source, /title=\{option\.title\}/);
});

test("SDK protocol is labeled JS-SDK in primary app chrome", async () => {
  const files = [
    "../src/components/layout/Header.tsx",
    "../src/components/layout/TabBar.tsx",
    "../src/components/layout/Sidebar.tsx",
    "../src/components/history/HistoryPanel.tsx",
    "../src/components/saved/SavedRequestsPanel.tsx",
    "../src/components/search/CommandSearch.tsx",
    "../src/components/settings/SettingsDialog.tsx",
    "../src/components/environment/EnvManager.tsx",
    "../src/components/packages/PackageInstaller.tsx",
    "../src/components/shortcuts/ShortcutCheatSheet.tsx",
    "../src/components/onboarding/Welcome.tsx",
    "../src/components/onboarding/Tutorial.tsx",
    "../src/components/onboarding/InteractiveTutorial.tsx",
  ];

  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /label: "SDK"/, file);
    assert.doesNotMatch(source, /sdk: "SDK"/, file);
    assert.doesNotMatch(source, /[,→·] SDK\b/, file);
    assert.match(source, /JS-SDK|js-sdk/, file);
  }
});

test("new request dialog does not show planned placeholder request types", async () => {
  const source = await readFile(new URL("../src/components/request/NewRequestDialog.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /Planned/);
  assert.doesNotMatch(source, /GraphQL/);
  assert.doesNotMatch(source, /WebSocket/);
  assert.doesNotMatch(source, /Collection/);
  assert.doesNotMatch(source, /Environment/);
});

test("method command search omits REST because REST has no indexed methods", async () => {
  const source = await readFile(new URL("../src/components/search/CommandSearch.tsx", import.meta.url), "utf8");

  assert.match(source, /type MethodProtocol = Exclude<ProtocolTab, "rest">/);
  assert.match(source, /\["all", "grpc-web", "grpc", "sdk"\]/);
  assert.doesNotMatch(source, /\["all", "grpc-web", "grpc", "sdk", "rest"\]/);
  assert.doesNotMatch(source, /rest: \[\]/);
});
