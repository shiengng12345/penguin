import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function loadPackageSpecModule() {
  const source = await readFile(new URL("../packages/core/src/package-spec.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const encoded = Buffer.from(outputText).toString("base64");
  return import(`data:text/javascript;base64,${encoded}`);
}

test("accepts only versioned snsoft grpc, grpc-web, and js-sdk specs", async () => {
  const { isAllowedSnsoftPackageSpec } = await loadPackageSpecModule();

  assert.equal(isAllowedSnsoftPackageSpec("@snsoft/auth-grpc@1.0.0"), true);
  assert.equal(isAllowedSnsoftPackageSpec("@snsoft/player-grpc-web@1.0.0-20260312191315"), true);
  assert.equal(isAllowedSnsoftPackageSpec("@snsoft/js-sdk@1.0.0-2026-03-05T06-26-26-341Z"), true);

  assert.equal(isAllowedSnsoftPackageSpec("@snsoft/auth-grpc"), false);
  assert.equal(isAllowedSnsoftPackageSpec("@snsoft/js-sdk"), false);
  assert.equal(isAllowedSnsoftPackageSpec("@snsoft/auth-sdk@1.0.0"), false);
  assert.equal(isAllowedSnsoftPackageSpec("lodash@1.0.0"), false);
  assert.equal(isAllowedSnsoftPackageSpec("@evil/auth-grpc@1.0.0"), false);
});

test("extracts package name from allowed snsoft package specs", async () => {
  const { snsoftPackageNameFromSpec } = await loadPackageSpecModule();

  assert.equal(snsoftPackageNameFromSpec("@snsoft/auth-grpc@1.0.0"), "@snsoft/auth-grpc");
  assert.equal(
    snsoftPackageNameFromSpec("@snsoft/player-grpc-web@1.0.0-20260312191315"),
    "@snsoft/player-grpc-web",
  );
  assert.equal(
    snsoftPackageNameFromSpec("@snsoft/js-sdk@1.0.0-2026-03-05T06-26-26-341Z"),
    "@snsoft/js-sdk",
  );
  assert.equal(snsoftPackageNameFromSpec("@snsoft/auth-grpc"), null);
  assert.equal(snsoftPackageNameFromSpec("lodash@1.0.0"), null);
});
