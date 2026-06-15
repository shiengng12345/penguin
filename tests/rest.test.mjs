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
  // Stacking context — the URL bar root sits above the request panel
  // (z-30 + relative to anchor the method dropdown). Match the tokens
  // independently so Tailwind class reorder doesn't break the test.
  const source = await readFile(new URL("../src/components/layout/UrlBar.tsx", import.meta.url), "utf8");

  const rootClassMatch = source.match(/className="([^"]+)"/);
  assert.ok(rootClassMatch, "UrlBar must have a className on its root");
  const rootClass = rootClassMatch[1];
  assert.match(rootClass, /\brelative\b/);
  assert.match(rootClass, /\bz-30\b/);
});

test("header keeps environment and theme dropdowns above lower bars", async () => {
  // Header must declare a stacking context (z-40) so its dropdowns float
  // above the URL bar (z-30). Anchor on the <header> element + assert
  // each token independently so a Prettier class reorder doesn't break
  // the test.
  const source = await readFile(new URL("../src/components/layout/Header.tsx", import.meta.url), "utf8");

  const headerMatch = source.match(/<header className="([^"]+)"/);
  assert.ok(headerMatch, "<header> element with className not found");
  const headerClass = headerMatch[1];
  assert.match(headerClass, /\brelative\b/);
  assert.match(headerClass, /\bz-40\b/);
});

test("themed Select menu uses an opaque app background", async () => {
  const source = await readFile(new URL("../src/components/ui/select.tsx", import.meta.url), "utf8");

  assert.match(source, /role="listbox"/);
  assert.match(source, /bg-background/);
  assert.doesNotMatch(source, /role="listbox"[\s\S]*bg-popover/);
});

test("themed Select selected and highlighted rows use solid primary color", async () => {
  // Tightened: closing-quote-anchored regex broke on any token
  // reorder. Now extract each conditional's class string and assert
  // tokens independently.
  const source = await readFile(new URL("../src/components/ui/select.tsx", import.meta.url), "utf8");

  const hi = source.match(/isHighlighted && "([^"]+)"/);
  assert.ok(hi, "isHighlighted conditional className not found");
  assert.match(hi[1], /\bbg-primary\b/);
  assert.match(hi[1], /\btext-primary-foreground\b/);

  const sel = source.match(/isSelected && "([^"]+)"/);
  assert.ok(sel, "isSelected conditional className not found");
  assert.match(sel[1], /\bbg-primary\b/);
  assert.match(sel[1], /\btext-primary-foreground\b/);
  assert.match(sel[1], /\bfont-medium\b/);

  // Anti-regression — must NOT regress to the prior pale-accent style.
  assert.doesNotMatch(source, /isHighlighted && "bg-accent/);
});
