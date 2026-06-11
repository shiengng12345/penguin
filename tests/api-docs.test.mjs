import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

// Load docs-lark.ts with its imports swapped for mocks: persistence becomes an
// in-memory map, lark-cli fetch/update become globalThis hooks.
async function loadDocsLarkModule() {
  const source = await readFile(
    new URL("../src/components/docs/docs-lark.ts", import.meta.url),
    "utf8",
  );

  const mocks = {
    "@/lib/logger": "export const logger = { info: () => {}, warn: () => {}, error: () => {} };",
    "@/lib/app-persistence": `
      export function getPersistedValue(key) { return globalThis.__docsKv?.[key] ?? null; }
      export function setPersistedValue(key, value) { (globalThis.__docsKv ??= {})[key] = value; }
    `,
    "@/lib/persistence-keys": `
      export const APP_VALUE_KEYS = {
        docsLarkUrl: "penguin-docs-lark-url",
        docsAnnotations: "penguin-docs-annotations",
        docsLastSyncedAt: "penguin-docs-last-synced-at",
      };
    `,
    "@/components/vault/vault-lark": `
      export const runLarkFetch = (...args) => globalThis.__docsLarkFetch(...args);
      export const runLarkUpdate = (...args) => globalThis.__docsLarkUpdate(...args);
    `,
  };

  let patched = source;
  for (const [specifier, mockSource] of Object.entries(mocks)) {
    const url = `data:text/javascript;base64,${Buffer.from(mockSource).toString("base64")}`;
    patched = patched.replaceAll(`"${specifier}"`, JSON.stringify(url));
  }

  const { outputText } = ts.transpileModule(patched, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  });
  globalThis.__docsKv = {};
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}#${Math.random()}`);
}

test("docs annotations CRUD persists and round-trips", async () => {
  const docs = await loadDocsLarkModule();

  let state = docs.upsertMethodAnnotation("pkg.Auth.Login", {
    description: "登录接口",
    notes: "QAT needs X-Env-Tag",
  });
  assert.equal(state.methods["pkg.Auth.Login"].description, "登录接口");

  state = docs.upsertMethodAnnotation("pkg.New.Endpoint", { custom: true, description: "未发包的新接口" });
  assert.equal(state.methods["pkg.New.Endpoint"].custom, true);

  // Docs span all API kinds — REST entries carry a protocol tag that
  // round-trips through persistence and the Lark JSON block.
  state = docs.upsertMethodAnnotation("GET /v1/users", {
    custom: true,
    protocol: "rest",
    description: "List users",
  });
  assert.equal(state.methods["GET /v1/users"].protocol, "rest");
  assert.equal(
    docs.parseDocsAnnotations(JSON.parse(JSON.stringify(state))).methods["GET /v1/users"].protocol,
    "rest",
  );
  // Unknown protocol values are dropped, not persisted blindly.
  const parsed = docs.parseDocsAnnotations({ methods: { x: { description: "d", protocol: "soap" } } });
  assert.equal(parsed.methods.x.protocol, undefined);

  // Reload from persistence — survives restarts.
  assert.deepEqual(docs.loadDocsAnnotations(), state);

  state = docs.deleteMethodAnnotation("pkg.Auth.Login");
  assert.equal(state.methods["pkg.Auth.Login"], undefined);
  assert.ok(state.methods["pkg.New.Endpoint"], "other entries untouched");

  // Emptying a non-custom annotation deletes it instead of keeping a husk.
  docs.upsertMethodAnnotation("pkg.A.B", { description: "x" });
  const emptied = docs.upsertMethodAnnotation("pkg.A.B", { description: "  " });
  assert.equal(emptied.methods["pkg.A.B"], undefined);
});

test("sync pulls the json block from Lark; push exports markdown with it", async () => {
  const docs = await loadDocsLarkModule();
  docs.saveDocsLarkUrl("https://team.larksuite.com/docx/abc");

  globalThis.__docsLarkFetch = async () => ({
    success: true,
    markdown: [
      "# Team API Docs",
      "```json",
      JSON.stringify({ methods: { "pkg.Auth.Login": { description: "from lark" } } }),
      "```",
    ].join("\n"),
  });
  const synced = await docs.syncDocsFromLark();
  assert.equal(synced.success, true);
  assert.equal(synced.methodCount, 1);
  assert.equal(docs.loadDocsAnnotations().methods["pkg.Auth.Login"].description, "from lark");

  // Wrong-shaped JSON must fail loudly, not wipe local data.
  globalThis.__docsLarkFetch = async () => ({ success: true, markdown: "```json\n[1,2]\n```" });
  const badShape = await docs.syncDocsFromLark();
  assert.equal(badShape.success, false);
  assert.equal(docs.loadDocsAnnotations().methods["pkg.Auth.Login"].description, "from lark");

  // Push regenerates the doc with a human list AND the machine json block.
  let pushedMarkdown = "";
  globalThis.__docsLarkUpdate = async ({ markdown }) => {
    pushedMarkdown = markdown;
    return { success: true };
  };
  docs.upsertMethodAnnotation("pkg.New.Endpoint", { custom: true, notes: "coming soon" });
  docs.upsertMethodAnnotation("GET /v1/users", { custom: true, protocol: "rest", description: "List users" });
  const pushed = await docs.pushDocsToLark();
  assert.equal(pushed.success, true);
  assert.match(pushedMarkdown, /## pkg\.Auth\.Login/);
  assert.match(pushedMarkdown, /## pkg\.New\.Endpoint \(custom\)/);
  assert.match(pushedMarkdown, /## \[rest\] GET \/v1\/users \(custom\)/);
  const block = pushedMarkdown.match(/```json\s*([\s\S]*?)```/);
  assert.ok(block, "push output keeps the sync-readable json block");
  const roundTrip = docs.parseDocsAnnotations(JSON.parse(block[1]));
  assert.equal(roundTrip.methods["pkg.New.Endpoint"].custom, true);
});

test("API Docs module is wired into Home and App", async () => {
  const home = await readFile(new URL("../src/components/home/HomePage.tsx", import.meta.url), "utf8");
  assert.match(home, /API Docs/);
  assert.match(home, /onSelectDocs/);

  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /ApiDocsPage/);
  assert.match(app, /docsOpen \?/);
  // Every module switch closes the docs view too.
  assert.match(app, /selectDocsFromHome/);
});

test("ApiDocsPage covers schema docs, try-it handoff, CRUD and Lark sync", async () => {
  const page = await readFile(
    new URL("../src/components/docs/ApiDocsPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /generateDefaultJson/);
  assert.match(page, /penguin:focus-method/);
  assert.match(page, /Try it/);
  assert.match(page, /AnnotationEditor/);
  assert.match(page, /upsertMethodAnnotation/);
  assert.match(page, /deleteMethodAnnotation/);
  assert.match(page, /Custom Docs/);
  assert.match(page, /pushDocsToLark/);
  assert.match(page, /syncDocsFromLark/);
});

test("docs-lark reuses the vault lark-cli pipeline instead of duplicating it", async () => {
  const source = await readFile(
    new URL("../src/components/docs/docs-lark.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /from "@\/components\/vault\/vault-lark"/);
  assert.doesNotMatch(source, /lark-cli docs/, "must not shell out on its own");

  const keys = await readFile(new URL("../src/lib/persistence-keys.ts", import.meta.url), "utf8");
  assert.match(keys, /penguin-docs-lark-url/);
  assert.match(keys, /penguin-docs-annotations/);
});
