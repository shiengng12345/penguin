import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function loadMcpAppDbModule() {
  const source = await readFile(new URL("../packages/mcp/src/app-db.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const encoded = Buffer.from(outputText).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

test("parses protocol default headers from SQLite app_kv values", async () => {
  const { parseDefaultHeadersValue } = await loadMcpAppDbModule();
  const raw = JSON.stringify({
    "grpc-web": [
      { key: "x-env-tag", value: "{{X_ENV_TAG}}", enabled: true },
      { key: "x-disabled", value: "no", enabled: false },
    ],
    grpc: [{ key: "authorization", value: "Bearer token", enabled: true }],
  });

  assert.deepEqual(parseDefaultHeadersValue(raw, "grpc-web"), {
    "grpc-web": [
      { key: "x-env-tag", value: "{{X_ENV_TAG}}", enabled: true },
      { key: "x-disabled", value: "no", enabled: false },
    ],
  });
  assert.deepEqual(parseDefaultHeadersValue(raw), {
    "grpc-web": [
      { key: "x-env-tag", value: "{{X_ENV_TAG}}", enabled: true },
      { key: "x-disabled", value: "no", enabled: false },
    ],
    grpc: [{ key: "authorization", value: "Bearer token", enabled: true }],
  });
});

test("filters and summarizes stored history without leaking huge bodies", async () => {
  const { filterStoredRequests, summarizeStoredRequest } = await loadMcpAppDbModule();
  const entries = [
    {
      id: "hist_1",
      timestamp: 100,
      protocol: "grpc-web",
      methodFullName: "pengvi.auth.Auth.PhoneNumberLoginWithPassword",
      serviceName: "pengvi.auth.Auth",
      packageName: "@snsoft/auth-grpc-web",
      url: "{{URL}}",
      requestBody: JSON.stringify({ phoneNumber: "6012", password: "secret" }),
      metadata: [{ key: "x-env-tag", value: "QAT", enabled: true }],
    },
    {
      id: "hist_2",
      timestamp: 200,
      protocol: "sdk",
      methodFullName: "Auth.lookupNationalId",
      serviceName: "Auth",
      packageName: "@snsoft/js-sdk",
      url: "{{URL}}",
      requestBody: "x".repeat(5000),
      metadata: [],
    },
  ];

  const filtered = filterStoredRequests(entries, {
    protocol: "grpc-web",
    query: "phone",
    limit: 10,
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "hist_1");
  assert.equal(filtered[0].requestBodyTruncated, false);

  const summarized = summarizeStoredRequest(entries[1]);
  assert.equal(summarized.requestBody.length, 4000);
  assert.equal(summarized.requestBodyTruncated, true);
  assert.equal(summarized.methodFullName, "Auth.lookupNationalId");
});

test("SQLite query failures are reported instead of looking like empty desktop state", async () => {
  const { desktopStateStatus, readAppValues } = await loadMcpAppDbModule();
  const existingDirectory = new URL("../packages/mcp/src", import.meta.url).pathname;

  assert.throws(() => readAppValues(existingDirectory), /SQLite read failed/);

  const status = desktopStateStatus(existingDirectory);
  assert.equal(status.exists, true);
  assert.equal(status.ok, false);
  assert.match(status.error, /SQLite read failed/);
});

test("MCP exposes SQLite-backed desktop state tools", async () => {
  const source = await readFile(new URL("../packages/mcp/src/index.ts", import.meta.url), "utf8");

  for (const toolName of [
    "get_default_headers",
    "list_saved_requests",
    "search_request_history",
  ]) {
    assert.match(source, new RegExp(`name: "${toolName}"`), toolName);
  }
  assert.match(source, /readDefaultHeaders/);
  assert.match(source, /readSavedRequests/);
  assert.match(source, /readRequestHistory/);
  assert.match(source, /sqlite/);
});
