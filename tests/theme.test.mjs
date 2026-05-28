import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function loadThemeModule() {
  const source = await readFile(new URL("../src/lib/theme.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const encoded = Buffer.from(outputText).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

test("includes Antarctic Snow as a valid app theme", async () => {
  const { THEMES, isAppTheme } = await loadThemeModule();

  assert.equal(isAppTheme("antarctic-snow"), true);
  assert.ok(THEMES.some((theme) => theme.id === "antarctic-snow" && theme.label === "Antarctic Snow"));
});

test("treats Antarctic Snow as a light visual theme", async () => {
  const { isLightAppTheme } = await loadThemeModule();

  assert.equal(isLightAppTheme("light"), true);
  assert.equal(isLightAppTheme("antarctic-snow"), true);
  assert.equal(isLightAppTheme("dark"), false);
});

test("Antarctic Snow background covers html and body", async () => {
  const source = await readFile(new URL("../src/index.css", import.meta.url), "utf8");

  assert.match(source, /html\[data-theme="antarctic-snow"\],\s*\[data-theme="antarctic-snow"\] body/);
});

test("rejects unknown theme names", async () => {
  const { isAppTheme } = await loadThemeModule();

  assert.equal(isAppTheme("snow"), false);
  assert.equal(isAppTheme("antarctic"), false);
});
