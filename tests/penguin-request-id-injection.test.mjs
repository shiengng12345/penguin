import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// RequestPanel is a large React component with no runtime harness in this repo;
// per the established convention (VaultPage tests) the send-pipeline wiring is
// asserted at the source level. These guard that the auto x-penguin-id stays
// (a) injected into every outgoing request and (b) echoed into the response.

async function readRequestPanel() {
  return readFile(
    new URL("../src/components/request/RequestPanel.tsx", import.meta.url),
    "utf8",
  );
}

test("RequestPanel imports the penguin request-id generator", async () => {
  const src = await readRequestPanel();
  assert.match(src, /from "@\/lib\/penguin-request-id"/);
  assert.match(src, /generatePenguinRequestId\(\)\.value/);
});

test("the generated id is appended to outgoing metadata, replacing any manual entry", async () => {
  const src = await readRequestPanel();
  assert.match(src, /key\.toLowerCase\(\) !== PENGUIN_REQUEST_ID_HEADER/, "must dedupe a manually-typed x-penguin-id");
  assert.match(src, /\{ key: PENGUIN_REQUEST_ID_HEADER, value: penguinRequestId, enabled: true \}/);
});

test("the sent id is echoed into the response headers (success and error paths)", async () => {
  const src = await readRequestPanel();
  // Success path merges it into the live result headers.
  assert.match(src, /\.\.\.result\.headers, \[PENGUIN_REQUEST_ID_HEADER\]: penguinRequestId/);
  // Error path seeds the headers with it too.
  assert.match(src, /headers: \{ \[PENGUIN_REQUEST_ID_HEADER\]: penguinRequestId \}/);
});
