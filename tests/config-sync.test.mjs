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

test("remote config file exists and does not contain old QAT/UAT numbered presets", async () => {
  const raw = await readFile(new URL("../config/penguin.remote-config.json", import.meta.url), "utf8");
  const parsed = JSON.parse(raw);

  assert.deepEqual(parsed["grpc-web"].environments.map((env) => env.name), ["QAT", "UAT"]);
  assert.deepEqual(parsed.sdk.environments.map((env) => env.name), ["QAT", "UAT"]);
  assert.doesNotMatch(raw, /"name":\s*"(QAT[1-9]|UAT[1-9]|UAT-STABLE)"/);
});

test("startup environment sync uses safe merge instead of replacing local config", async () => {
  const source = await readFile(new URL("../src/hooks/useEnvironments.ts", import.meta.url), "utf8");

  assert.match(source, /mergeConfigEnvironments/);
  assert.doesNotMatch(source, /variables:\s*Object\.entries\(cfg\.variables/);
});

test("environment manager exposes Pull Latest Config safe merge action", async () => {
  const source = await readFile(new URL("../src/components/environment/EnvManager.tsx", import.meta.url), "utf8");

  assert.match(source, /Pull Latest Config/);
  assert.match(source, /fetchRemoteConfig/);
  assert.match(source, /mergeConfigEnvironments/);
  assert.match(source, /conflicts/);
});
