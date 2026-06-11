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
        docsKnowledgeBase: "penguin-docs-knowledge-base",
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

function sampleEndpoint(docs, overrides = {}) {
  return {
    ...docs.emptyEndpoint(),
    method: "GET",
    path: "/cpf/check",
    summary: "Check if CPF is impeded in SIGAP",
    section: "CPF & Document Check",
    overview: "Checks whether a CPF is restricted (IMPEDIDO) or not in SIGAP.",
    requestFields: [
      { name: "cpf", type: "string", required: true, description: "CPF number (only numbers)", example: "53477771842" },
    ],
    responseFields: [
      { name: "resultado", type: "string", description: "Result of the check", example: "NAO_IMPEDIDO" },
    ],
    requestExample: '{ "cpf": "53477771842" }',
    responseExample: '{ "resultado": "NAO_IMPEDIDO" }',
    notes: "Requires a valid Bearer Token.\nCPF must contain only 11 digits.",
    service: "SIGAP impedimentos",
    baseUrl: "https://hom-api.example.gov.br",
    rateLimit: "100 req/min",
    category: "KYC & Compliance",
    authentication: "Bearer Token",
    owner: "Platform Team",
    tags: ["cpf", "sigap"],
    ...overrides,
  };
}

test("knowledge base CRUD: collections and endpoints persist", async () => {
  const docs = await loadDocsLarkModule();

  let kb = docs.createCollection("KYC Service");
  assert.equal(kb.collections.length, 1);
  const collectionId = kb.collections[0].id;

  const ep = sampleEndpoint(docs);
  kb = docs.upsertEndpoint(collectionId, ep);
  assert.equal(kb.collections[0].endpoints.length, 1);
  assert.equal(kb.collections[0].endpoints[0].path, "/cpf/check");
  assert.equal(kb.collections[0].endpoints[0].requestFields[0].required, true);

  // Upsert by id updates in place.
  kb = docs.upsertEndpoint(collectionId, { ...ep, summary: "updated" });
  assert.equal(kb.collections[0].endpoints.length, 1);
  assert.equal(kb.collections[0].endpoints[0].summary, "updated");

  // Survives reload from persistence.
  assert.equal(docs.loadKnowledgeBase().collections[0].endpoints[0].summary, "updated");

  kb = docs.renameCollection(collectionId, "KYC Service v2");
  assert.equal(kb.collections[0].name, "KYC Service v2");

  kb = docs.deleteEndpoint(collectionId, ep.id);
  assert.equal(kb.collections[0].endpoints.length, 0);

  kb = docs.deleteCollection(collectionId);
  assert.equal(kb.collections.length, 0);
});

test("push exports readable markdown + machine block; pull round-trips", async () => {
  const docs = await loadDocsLarkModule();
  docs.saveDocsLarkUrl("https://casinoplus.sg.larksuite.com/docx/R8EwdtG1Io9S5MxTIuVlSIuZgVg");

  const kb = docs.createCollection("KYC Service");
  docs.upsertEndpoint(kb.collections[0].id, sampleEndpoint(docs));

  let pushedMarkdown = "";
  globalThis.__docsLarkUpdate = async ({ markdown }) => {
    pushedMarkdown = markdown;
    return { success: true };
  };
  const pushed = await docs.pushDocsToLark();
  assert.equal(pushed.success, true);
  assert.equal(pushed.endpointCount, 1);
  assert.match(pushedMarkdown, /## KYC Service/);
  assert.match(pushedMarkdown, /### \[GET\] \/cpf\/check/);
  assert.match(pushedMarkdown, /\| cpf \| string \| yes \|/);
  assert.match(pushedMarkdown, /#### Request example/);
  assert.match(pushedMarkdown, /- Requires a valid Bearer Token\./);

  // CRITICAL: example fences must not shadow the machine ```json block —
  // a pushed doc must pull back losslessly.
  globalThis.__docsLarkFetch = async () => ({ success: true, markdown: pushedMarkdown });
  globalThis.__docsKv = {
    "penguin-docs-lark-url": "https://casinoplus.sg.larksuite.com/docx/R8EwdtG1Io9S5MxTIuVlSIuZgVg",
  };
  const pulled = await docs.syncDocsFromLark();
  assert.equal(pulled.success, true, pulled.reason);
  const restored = docs.loadKnowledgeBase();
  assert.equal(restored.collections[0].name, "KYC Service");
  const restoredEp = restored.collections[0].endpoints[0];
  assert.equal(restoredEp.path, "/cpf/check");
  assert.equal(restoredEp.responseExample, '{ "resultado": "NAO_IMPEDIDO" }');
  assert.deepEqual(restoredEp.tags, ["cpf", "sigap"]);

  // Wrong-shaped JSON must fail loudly, not wipe local data.
  globalThis.__docsLarkFetch = async () => ({ success: true, markdown: "```json\n[1,2]\n```" });
  const badShape = await docs.syncDocsFromLark();
  assert.equal(badShape.success, false);
  assert.equal(docs.loadKnowledgeBase().collections.length, 1);
});

test("parseKnowledgeBase normalizes leniently but rejects wrong top-level shape", async () => {
  const docs = await loadDocsLarkModule();

  assert.equal(docs.parseKnowledgeBase({ foo: 1 }), null);
  assert.equal(docs.parseKnowledgeBase([1]), null);

  const kb = docs.parseKnowledgeBase({
    collections: [
      {
        name: "X",
        endpoints: [
          { path: "/a", method: "post" }, // lowercase method normalized
          { path: "" }, // dropped — no path
          { path: "/b", method: "SOAP" }, // unknown method → GET
        ],
      },
      { endpoints: [] }, // dropped — no name
    ],
  });
  assert.equal(kb.collections.length, 1);
  assert.equal(kb.collections[0].endpoints.length, 2);
  assert.equal(kb.collections[0].endpoints[0].method, "POST");
  assert.equal(kb.collections[0].endpoints[1].method, "GET");
});

test("Knowledge Base module is wired into Home and App", async () => {
  const home = await readFile(new URL("../src/components/home/HomePage.tsx", import.meta.url), "utf8");
  assert.match(home, /Knowledge Base/);
  assert.match(home, /onSelectDocs/);

  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /ApiDocsPage/);
  assert.match(app, /docsOpen \?/);
  assert.match(app, /selectDocsFromHome/);
});

test("page matches the Knowledge Base design: collections rail, sectioned list, detail, details rail — no request sending", async () => {
  const page = await readFile(
    new URL("../src/components/docs/ApiDocsPage.tsx", import.meta.url),
    "utf8",
  );
  // Layout pieces from the approved mock.
  assert.match(page, /New Collection/);
  assert.match(page, /New Endpoint/);
  assert.match(page, /Search endpoints/);
  assert.match(page, /Related Endpoints/);
  assert.match(page, /Rate Limit/);
  assert.match(page, /Authentication/);
  assert.match(page, /Last Updated/);
  assert.match(page, /MethodBadge/);
  assert.match(page, /FieldTableView/);
  assert.match(page, /FieldTableEditor/);
  // Copy-first store.
  assert.match(page, /CopyButton/);
  assert.match(page, /navigator\.clipboard\.writeText/);
  // Documentation only — never sends requests.
  assert.doesNotMatch(page, /callGrpcWeb|callGrpcNative|callSdk|callRest|proxyFetch/);
  // Lark sync present with the team doc pre-filled as default.
  assert.match(page, /pushDocsToLark/);
  assert.match(page, /syncDocsFromLark/);
  assert.match(page, /casinoplus\.sg\.larksuite\.com\/docx\/R8EwdtG1Io9S5MxTIuVlSIuZgVg/);
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
  assert.match(keys, /penguin-docs-knowledge-base/);
});
