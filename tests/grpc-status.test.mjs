import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function loadGrpcStatusModule() {
  const source = await readFile(new URL("../src/lib/grpc-status.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const encoded = Buffer.from(outputText).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

async function loadGrpcJsonModule() {
  const source = await readFile(new URL("../packages/core/src/grpc-json.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const encoded = Buffer.from(outputText).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

test("summarizes gRPC 14 HTTP 504 as unavailable gateway timeout", async () => {
  const { formatGrpcStatusBadgeLabel, summarizeGrpcStatusResponse } = await loadGrpcStatusModule();

  const summary = summarizeGrpcStatusResponse({
    status: "gRPC 14",
    statusCode: 200,
    body: JSON.stringify({ code: 14, message: "HTTP 504" }),
    headers: {
      "grpc-status": "14",
      "grpc-message": "HTTP 504",
    },
    duration: 60135,
  });

  assert.equal(summary?.title, "UNAVAILABLE (14)");
  assert.equal(summary?.transport, "HTTP 504 Gateway Timeout");
  assert.equal(summary?.retryable, true);
  assert.match(summary?.explanation ?? "", /service is unavailable/i);
  assert.match(summary?.hint ?? "", /upstream service did not respond/i);
  assert.equal(formatGrpcStatusBadgeLabel(summary), "gRPC UNAVAILABLE (14)");
});

test("summarizes gRPC 12 as method not implemented", async () => {
  const { summarizeGrpcStatusResponse } = await loadGrpcStatusModule();

  const summary = summarizeGrpcStatusResponse({
    status: "gRPC 12",
    statusCode: 200,
    body: JSON.stringify({ code: 12, message: "Method not found" }),
    headers: {},
    duration: 42,
  });

  assert.equal(summary?.title, "UNIMPLEMENTED (12)");
  assert.equal(summary?.retryable, false);
  assert.match(summary?.explanation ?? "", /not implemented/i);
  assert.match(summary?.hint ?? "", /selected method/i);
});

test("ResponsePanel renders the readable gRPC status summary", async () => {
  const source = await readFile(new URL("../src/components/request/ResponsePanel.tsx", import.meta.url), "utf8");

  assert.match(source, /summarizeGrpcStatusResponse\(tab\.response\)/);
  assert.match(source, /Error details/);
});

test("normalizes proto enum strings through the generated request fromJson", async () => {
  const { normalizeGrpcJsonBody } = await loadGrpcJsonModule();
  const requestType = {
    fromJson(value) {
      if (value.game === "A") return { ...value, game: 1 };
      if (typeof value.game === "number") return value;
      throw new Error("cannot decode enum sample.Game from JSON");
    },
  };

  assert.deepEqual(normalizeGrpcJsonBody({ game: "A" }, requestType), { game: 1 });
  assert.deepEqual(normalizeGrpcJsonBody({ game: 1 }, requestType), { game: 1 });
});

test("wraps invalid proto enum strings with a readable request body error", async () => {
  const { normalizeGrpcJsonBody } = await loadGrpcJsonModule();
  const requestType = {
    fromJson() {
      throw new Error("cannot decode enum sample.Game from JSON: \"BAD\"");
    },
  };

  assert.throws(
    () => normalizeGrpcJsonBody({ game: "BAD" }, requestType),
    /Request body does not match proto schema.*sample\.Game/s,
  );
});

test("gRPC-Web client sends the normalized proto JSON body", async () => {
  const source = await readFile(new URL("../packages/core/src/grpc-web-client.ts", import.meta.url), "utf8");

  assert.match(source, /normalizeGrpcJsonBody\(parsedBody, serviceDef\.methods\[resolvedMethodName\]\.I\)/);
  assert.match(source, /await clientMethod\(requestData\)/);
  assert.doesNotMatch(source, /await clientMethod\(parsedBody\)/);
});

test("gRPC-Web ConnectError responses are marked as errors", async () => {
  const source = await readFile(new URL("../packages/core/src/grpc-web-client.ts", import.meta.url), "utf8");

  assert.match(source, /error: ce\.rawMessage/);
});
