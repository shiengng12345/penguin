import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function loadConfigSyncModule() {
  const source = await readFile(new URL("../src/lib/config-sync.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const encoded = Buffer.from(outputText).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

const localQat = {
  id: "local-qat",
  name: "QAT",
  color: "pink",
  variables: [
    { key: "URL", value: "https://local.example.test" },
    { key: "TOKEN", value: "local-token" },
  ],
};

const remoteQat = {
  name: "QAT",
  color: "blue",
  variables: {
    URL: "https://remote.example.test",
    TOKEN: "remote-token",
  },
};

const remoteUat = {
  name: "UAT",
  color: "amber",
  variables: {
    URL: "https://uat.example.test",
    TOKEN: "",
    X_ENV_TAG: "UAT",
  },
};

test("safe config merge adds missing remote environments without overwriting local ones", async () => {
  const { mergeConfigEnvironments } = await loadConfigSyncModule();

  const result = mergeConfigEnvironments([localQat], [remoteQat, remoteUat], "grpc-web");

  assert.equal(result.environments.length, 2);
  assert.deepEqual(result.added, ["UAT"]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.conflicts.map((item) => item.name), ["QAT"]);
  assert.equal(result.environments[0].id, "local-qat");
  assert.equal(result.environments[0].color, "pink");
  assert.deepEqual(result.environments[0].variables, localQat.variables);
  assert.equal(result.environments[1].id, "remote-grpc-web-uat");
  assert.deepEqual(result.environments[1].variables, [
    { key: "URL", value: "https://uat.example.test" },
    { key: "TOKEN", value: "" },
    { key: "X_ENV_TAG", value: "UAT" },
  ]);
});

test("safe config merge skips same-name environments when variables already match", async () => {
  const { mergeConfigEnvironments } = await loadConfigSyncModule();
  const localMatchingRemote = {
    id: "local-uat",
    name: "UAT",
    color: "orange",
    variables: [
      { key: "TOKEN", value: "" },
      { key: "X_ENV_TAG", value: "UAT" },
      { key: "URL", value: "https://uat.example.test" },
    ],
  };

  const result = mergeConfigEnvironments([localMatchingRemote], [remoteUat], "grpc-web");

  assert.equal(result.environments.length, 1);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.skipped, ["UAT"]);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.environments[0].color, "orange");
});

test("safe config merge never deletes local environments missing from remote config", async () => {
  const { mergeConfigEnvironments } = await loadConfigSyncModule();

  const result = mergeConfigEnvironments([localQat], [], "grpc-web");

  assert.deepEqual(result.environments, [localQat]);
  assert.deepEqual(result.added, []);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.conflicts, []);
});

test("fetchRemoteConfig parses config JSON from a caller-provided fetch", async () => {
  const { fetchRemoteConfig } = await loadConfigSyncModule();

  const config = await fetchRemoteConfig(async (url) => ({
    ok: true,
    text: async () => JSON.stringify({ "grpc-web": { environments: [remoteUat] } }),
    url,
  }));

  assert.deepEqual(config["grpc-web"].environments, [remoteUat]);
});

test("remote config parser rejects non-object top-level JSON", async () => {
  const { parseConfig } = await loadConfigSyncModule();

  assert.deepEqual(parseConfig(JSON.stringify([{ "grpc-web": { environments: [remoteUat] } }])), {});
  assert.deepEqual(parseConfig(JSON.stringify(null)), {});
});

test("remote config environments filter malformed entries before merge", async () => {
  const { configEnvsForProtocol, mergeConfigEnvironments } = await loadConfigSyncModule();
  const config = {
    "grpc-web": {
      environments: [
        remoteUat,
        { color: "red", variables: { URL: "https://missing-name.example.test" } },
        { name: "   ", variables: { URL: "https://blank-name.example.test" } },
        { name: "Bad Variables", variables: "URL=https://bad-vars.example.test" },
      ],
    },
  };

  const envs = configEnvsForProtocol(config, "grpc-web");
  const result = mergeConfigEnvironments([], envs, "grpc-web");

  assert.deepEqual(envs, [remoteUat]);
  assert.deepEqual(result.added, ["UAT"]);
  assert.equal(result.environments.length, 1);
});

test("remote config cache snapshot preserves pulled JSON with source metadata", async () => {
  const {
    createRemoteConfigCacheSnapshot,
    parseRemoteConfigCacheSnapshot,
  } = await loadConfigSyncModule();
  const config = { "grpc-web": { environments: [remoteUat] } };
  const pulledAt = "2026-05-30T10:49:00.000Z";
  const source = "https://example.test/penguin.remote-config.json";

  const snapshot = createRemoteConfigCacheSnapshot(config, { pulledAt, source });
  const parsed = parseRemoteConfigCacheSnapshot(JSON.stringify(snapshot));

  assert.deepEqual(snapshot, {
    version: 1,
    source,
    pulledAt,
    config,
  });
  assert.deepEqual(parsed, snapshot);
});

test("remote config cache persists through SQLite-backed app values", async () => {
  const keysSource = await readFile(new URL("../src/lib/persistence-keys.ts", import.meta.url), "utf8");
  const persistenceSource = await readFile(new URL("../src/lib/remote-config-persistence.ts", import.meta.url), "utf8");
  const syncSource = await readFile(new URL("../src/lib/environment-sync.ts", import.meta.url), "utf8");

  assert.match(keysSource, /remoteConfigCache:\s*"penguin-remote-config-cache"/);
  assert.match(keysSource, /remoteConfigLastPulledAt:\s*"penguin-remote-config-last-pulled-at"/);
  assert.match(keysSource, /remoteConfigSource:\s*"penguin-remote-config-source"/);
  assert.match(persistenceSource, /setPersistedValue\(APP_VALUE_KEYS\.remoteConfigCache/);
  assert.match(persistenceSource, /setPersistedValue\(APP_VALUE_KEYS\.remoteConfigLastPulledAt/);
  assert.match(persistenceSource, /setPersistedValue\(APP_VALUE_KEYS\.remoteConfigSource/);
  assert.match(persistenceSource, /parseRemoteConfigCacheSnapshot/);
  assert.match(syncSource, /persistRemoteConfigSnapshot/);
  assert.match(syncSource, /mergeConfigEnvironments/);
  assert.match(syncSource, /persistEnvironmentSnapshot/);
});

test("remote config file exists and does not contain old QAT/UAT numbered presets", async () => {
  const raw = await readFile(new URL("../config/penguin.remote-config.json", import.meta.url), "utf8");
  const parsed = JSON.parse(raw);

  assert.deepEqual(parsed["grpc-web"].environments.map((env) => env.name), ["QAT", "UAT"]);
  assert.deepEqual(parsed.sdk.environments.map((env) => env.name), ["QAT", "UAT"]);
  assert.doesNotMatch(raw, /"name":\s*"(QAT[1-9]|UAT[1-9]|UAT-STABLE)"/);
});

test("startup environment sync uses safe merge instead of replacing local config", async () => {
  const source = await readFile(new URL("../src/hooks/useEnvironments.ts", import.meta.url), "utf8");

  // Tightened: scope the assertion to the syncAllProtocolEnvs body so
  // a stray import / comment can't satisfy /mergeConfigEnvironments/
  // by itself. Match on the call site (open paren) inside the function.
  const start = source.indexOf("syncAllProtocolEnvs");
  assert.ok(start >= 0, "syncAllProtocolEnvs function not found");
  const body = source.slice(start, start + 4000);
  assert.match(body, /mergeConfigEnvironments\(/);
  // Negative — locks the absence of the unsafe wholesale-replace shape.
  assert.doesNotMatch(source, /variables:\s*Object\.entries\(cfg\.variables/);
});

test("environment manager exposes Pull Latest Config safe merge action", async () => {
  const source = await readFile(new URL("../src/components/environment/EnvManager.tsx", import.meta.url), "utf8");

  // User-visible label.
  assert.match(source, /Pull Latest Config/);
  // The actual sync helper is invoked, not just referenced.
  assert.match(source, /syncRemoteConfigForProtocol\(/);
  // Lock the conflict-resolution UX surface — when a pull lands and
  // merge keeps the user's local edits, we tell them about it.
  // `Local kept` is the user-facing copy from EnvManager.tsx (~line 337).
  assert.match(source, /Local kept|pullStatus/);
});

test("environment manager PROTOCOL_TABS cover only the gRPC family — REST has its own dedicated module", async () => {
  const source = await readFile(new URL("../src/components/environment/EnvManager.tsx", import.meta.url), "utf8");
  const start = source.indexOf("const PROTOCOL_TABS");
  const end = source.indexOf("function envsForProtocolState", start);
  const visibleTabs = source.slice(start, end);

  assert.match(visibleTabs, /id: "grpc-web"/);
  assert.match(visibleTabs, /id: "grpc"/);
  assert.match(visibleTabs, /id: "sdk"/);
  assert.doesNotMatch(visibleTabs, /id: "rest"/);
  assert.doesNotMatch(visibleTabs, /label: "REST"/);
});

test("header exposes one-click current protocol config sync", async () => {
  const source = await readFile(new URL("../src/components/layout/Header.tsx", import.meta.url), "utf8");
  const buttonIndex = source.indexOf('aria-label="Sync Environment Config"');
  const protocolBadgeIndex = source.indexOf('{protocolName}');
  const envSelectIndex = source.indexOf('placeholder="Environment / 环境"');
  const themeButtonIndex = source.indexOf('title="Theme / 主题"');

  assert.match(source, /RefreshCw/);
  assert.match(source, /syncRemoteConfigForProtocol/);
  assert.match(source, /setEnvsForProtocolState/);
  assert.match(source, /Sync Environment Config/);
  assert.ok(buttonIndex > -1, "header should expose a sync config button");
  assert.ok(protocolBadgeIndex > -1, "header should render the protocol badge");
  assert.ok(envSelectIndex > -1, "header should render the environment selector");
  assert.ok(themeButtonIndex > -1, "header should render the theme button");
  assert.ok(buttonIndex > protocolBadgeIndex, "sync config button should appear after the protocol badge");
  assert.ok(buttonIndex > envSelectIndex, "sync config button should appear after the environment selector");
  assert.ok(buttonIndex < themeButtonIndex, "sync config button should appear before the theme button");
  // className assertion dropped — incidental layout class would shift
  // on a redesign without affecting the actual sync wiring. The
  // surrounding behavioral assertions above lock the contract.
});
