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

test("normalizePackageSpec converts package.json / yaml lines to canonical @name@version", async () => {
  const { normalizePackageSpec, isAllowedSnsoftPackageSpec } = await loadPackageSpecModule();

  // ---- All 3 protocol types must round-trip cleanly ----
  // The normalizer doesn't care about protocol — but we lock end-to-end that
  // each form a user actually copies from package.json comes out canonical
  // AND passes isAllowedSnsoftPackageSpec (so Install button enables).

  // gRPC — numeric timestamp suffix is the common Snsoft build format.
  const grpc = normalizePackageSpec('"@snsoft/auth-grpc": "1.0.0-20260512103732"');
  assert.equal(grpc, "@snsoft/auth-grpc@1.0.0-20260512103732");
  assert.equal(isAllowedSnsoftPackageSpec(grpc), true);

  // gRPC-Web — same shape, different protocol suffix.
  const grpcWeb = normalizePackageSpec('"@snsoft/player-grpc-web": "1.0.0-20260512103732"');
  assert.equal(grpcWeb, "@snsoft/player-grpc-web@1.0.0-20260512103732");
  assert.equal(isAllowedSnsoftPackageSpec(grpcWeb), true);

  // JS-SDK — singleton (no `-grpc` suffix in the name).
  const sdk = normalizePackageSpec('"@snsoft/js-sdk": "1.0.0-20260512103732"');
  assert.equal(sdk, "@snsoft/js-sdk@1.0.0-20260512103732");
  assert.equal(isAllowedSnsoftPackageSpec(sdk), true);

  // JS-SDK with ISO-ish timestamp (older build format with embedded T).
  const sdkIso = normalizePackageSpec('"@snsoft/js-sdk": "1.0.0-2026-03-05T06-26-26-341Z"');
  assert.equal(sdkIso, "@snsoft/js-sdk@1.0.0-2026-03-05T06-26-26-341Z");
  assert.equal(isAllowedSnsoftPackageSpec(sdkIso), true);

  // ---- Surrounding format variations ----
  // Mid-list package.json with trailing comma — common when copying one row.
  assert.equal(
    normalizePackageSpec('"@snsoft/player-grpc-web": "1.0.0",'),
    "@snsoft/player-grpc-web@1.0.0",
  );
  // Leading + trailing whitespace.
  assert.equal(
    normalizePackageSpec('  "@snsoft/js-sdk": "1.0.0"   '),
    "@snsoft/js-sdk@1.0.0",
  );
  // YAML-ish (unquoted) — supports rare hand-edit cases. Works across all 3.
  assert.equal(
    normalizePackageSpec("@snsoft/auth-grpc: 1.0.0"),
    "@snsoft/auth-grpc@1.0.0",
  );
  assert.equal(
    normalizePackageSpec("@snsoft/player-grpc-web: 1.0.0"),
    "@snsoft/player-grpc-web@1.0.0",
  );
  assert.equal(
    normalizePackageSpec("@snsoft/js-sdk: 1.0.0"),
    "@snsoft/js-sdk@1.0.0",
  );

  // Already canonical — passthrough, all 3 types.
  for (const canonical of [
    "@snsoft/auth-grpc@1.0.0",
    "@snsoft/player-grpc-web@1.0.0",
    "@snsoft/js-sdk@1.0.0",
  ]) {
    assert.equal(normalizePackageSpec(canonical), canonical);
  }

  // Partial / typo / unmatched format — returned as-is so the validator
  // surfaces the real error to the user instead of mangled garbage.
  assert.equal(normalizePackageSpec(""), "");
  assert.equal(normalizePackageSpec("@snsoft/player-grpc"), "@snsoft/player-grpc");
  assert.equal(normalizePackageSpec('"unclosed'), '"unclosed');
});

test("PackageInstaller routes input through normalizePackageSpec", async () => {
  // Source-assertion: onChange must call the normalizer so paste auto-converts.
  // Reverting to `setSpec(e.target.value)` would re-introduce the bug the
  // user reported (pasting `"@snsoft/x": "1.0.0"` showed broken text).
  const source = await readFile(
    new URL("../src/components/packages/PackageInstaller.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /import \{[^}]*normalizePackageSpec[^}]*\}/);
  // The onChange handler must pipe its input through normalizePackageSpec
  // before setting state. Loosened to tolerate parameter rename / handler
  // extraction — what we care about is that the function is in the chain.
  assert.match(source, /onChange=\{[^}]*normalizePackageSpec[^}]*\}/);
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
