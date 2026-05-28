import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function loadRestModule() {
  const source = await readFile(new URL("../src/lib/rest.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const encoded = Buffer.from(outputText).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

test("resolves absolute and templated REST URLs", async () => {
  const { resolveRestUrl } = await loadRestModule();
  const env = { URL: "https://qat.example.test" };

  assert.equal(resolveRestUrl("https://api.example.test/v1/users", env), "https://api.example.test/v1/users");
  assert.equal(resolveRestUrl("{{URL}}/v1/users", env), "https://qat.example.test/v1/users");
  assert.equal(resolveRestUrl("/v1/users", env), "https://qat.example.test/v1/users");
  assert.equal(resolveRestUrl("v1/users", env), "https://qat.example.test/v1/users");
});

test("throws when path-only REST URL has no URL env variable", async () => {
  const { resolveRestUrl } = await loadRestModule();

  assert.throws(() => resolveRestUrl("/v1/users", {}), /URL environment variable/);
});

test("generates REST curl with method headers and body", async () => {
  const { buildRestCurl } = await loadRestModule();
  const curl = buildRestCurl({
    method: "POST",
    url: "https://qat.example.test/v1/users",
    headers: [
      { key: "Authorization", value: "Bearer token", enabled: true },
      { key: "x-disabled", value: "no", enabled: false },
    ],
    body: "{\"name\":\"A\"}",
  });

  assert.match(curl, /^curl -X POST 'https:\/\/qat\.example\.test\/v1\/users'/);
  assert.match(curl, /-H 'Authorization: Bearer token'/);
  assert.match(curl, /-d '\{"name":"A"\}'/);
  assert.doesNotMatch(curl, /x-disabled/);
});

test("normalizes REST method and body mode", async () => {
  const { inferRestBodyMode, toRestMethod } = await loadRestModule();

  assert.equal(toRestMethod("patch"), "PATCH");
  assert.equal(toRestMethod("TRACE", "GET"), "GET");
  assert.equal(inferRestBodyMode('{"ok":true}', ""), "json");
  assert.equal(inferRestBodyMode("plain text", "text/plain"), "raw");
  assert.equal(inferRestBodyMode("plain text", "application/json"), "json");
});

test("REST method selector uses themed app Select instead of native select", async () => {
  const source = await readFile(new URL("../src/components/layout/UrlBar.tsx", import.meta.url), "utf8");

  assert.match(source, /@\/components\/ui\/select/);
  assert.doesNotMatch(source, /<select[\s>]/);
});

test("URL bar keeps REST method menu above the request panel", async () => {
  const source = await readFile(new URL("../src/components/layout/UrlBar.tsx", import.meta.url), "utf8");

  assert.match(source, /relative z-30 border-b border-border bg-card/);
});

test("header keeps environment and theme dropdowns above lower bars", async () => {
  const source = await readFile(new URL("../src/components/layout/Header.tsx", import.meta.url), "utf8");

  assert.match(source, /relative z-40/);
});

test("themed Select menu uses an opaque app background", async () => {
  const source = await readFile(new URL("../src/components/ui/select.tsx", import.meta.url), "utf8");

  assert.match(source, /role="listbox"/);
  assert.match(source, /bg-background/);
  assert.doesNotMatch(source, /role="listbox"[\s\S]*bg-popover/);
});

test("themed Select selected and highlighted rows use solid primary color", async () => {
  const source = await readFile(new URL("../src/components/ui/select.tsx", import.meta.url), "utf8");

  assert.match(source, /isHighlighted && "bg-primary text-primary-foreground"/);
  assert.match(source, /isSelected && "bg-primary text-primary-foreground font-medium"/);
  assert.doesNotMatch(source, /isHighlighted && "bg-accent/);
});
