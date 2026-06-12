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
        docsLastSyncedHash: "penguin-docs-last-synced-hash",
      };
    `,
    "@/components/vault/vault-lark": `
      export const runLarkFetch = (...args) => globalThis.__docsLarkFetch(...args);
      export const runLarkUpdate = (...args) => globalThis.__docsLarkUpdate(...args);
      export const validateLarkUrl = ({ url }) =>
        url && url.trim().length > 0
          ? { success: true }
          : { success: false, reason: "empty" };
    `,
    "@/lib/dev-mode-store": "export const requireSuperAdmin = () => true;",
    "@/components/vault/vault-push": `
      export const sha256Hex = async ({ text }) => {
        const { createHash } = await import("node:crypto");
        return createHash("sha256").update(text).digest("hex");
      };
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

  // Push now pre-fetches remote for the SHA-256 conflict check (Sprint 8 B4).
  // First push has no expected hash on disk, so any pre-fetch response works.
  globalThis.__docsLarkFetch = async () => ({ success: true, markdown: "" });
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

test("fence-collision: user examples with ```json fences don't shadow the machine block (Sprint 8 B5/B8)", async () => {
  const docs = await loadDocsLarkModule();
  docs.saveDocsLarkUrl("https://team.larksuite.com/docx/Test");

  // User authors examples and notes containing literal ```json fences — these
  // would shadow the machine block under the legacy `match first ```json`
  // parser. Sentinel-anchored extractor (B5) must ignore them.
  const tricky = sampleEndpoint(docs, {
    path: "/with-fence",
    requestExample: '```json\n{ "fake": "machine block" }\n```',
    responseExample: '```json\n{ "also": "fake" }\n```',
    notes: 'Hostile inline json:\n```json\n{ "hostile": true }\n```',
  });
  const kb = docs.createCollection("Tricky");
  docs.upsertEndpoint(kb.collections[0].id, tricky);

  globalThis.__docsLarkFetch = async () => ({ success: true, markdown: "" });
  let pushedMarkdown = "";
  globalThis.__docsLarkUpdate = async ({ markdown }) => {
    pushedMarkdown = markdown;
    return { success: true };
  };
  const pushed = await docs.pushDocsToLark();
  assert.equal(pushed.success, true, pushed.reason);

  // Sentinel must be present in pushed markdown so future pulls anchor to it
  // even if the user later hand-edits the doc and adds another ```json fence.
  assert.match(pushedMarkdown, /<!-- penguin:kb:begin v1 -->/);
  assert.match(pushedMarkdown, /<!-- penguin:kb:end -->/);

  // Round-trip: the parser must extract the REAL machine block, not the
  // fake "machine block" or "hostile" payloads inside the user's examples.
  globalThis.__docsLarkFetch = async () => ({ success: true, markdown: pushedMarkdown });
  const pulled = await docs.syncDocsFromLark();
  assert.equal(pulled.success, true, pulled.reason);
  const restored = docs.loadKnowledgeBase();
  const restoredEp = restored.collections[0].endpoints[0];
  assert.equal(restoredEp.path, "/with-fence");
  assert.equal(restoredEp.requestExample, '```json\n{ "fake": "machine block" }\n```');
  assert.equal(restoredEp.notes, 'Hostile inline json:\n```json\n{ "hostile": true }\n```');
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

test("page matches the Knowledge Base design (Sprint 8.2 numbered-section editor)", async () => {
  const page = await readFile(
    new URL("../src/components/docs/ApiDocsPage.tsx", import.meta.url),
    "utf8",
  );
  // Layout pieces from the approved Sprint 8.2 mock.
  assert.match(page, /New Collection/);
  assert.match(page, /New Endpoint/);
  assert.match(page, /Search endpoints/);
  assert.match(page, /MethodBadge/);
  // Numbered sections 1-7 with the Section helper component.
  assert.match(page, /function Section\(/);
  assert.match(page, /HeadersTableEditor/);
  assert.match(page, /number=\{1\}/);
  assert.match(page, /number=\{7\}/);
  // JSON body editors are lazy-loaded (CodeMirror chunk).
  assert.match(page, /LazyJsonEditor/);
  // Copy-first store.
  assert.match(page, /CopyButton/);
  assert.match(page, /navigator\.clipboard\.writeText/);
  // Documentation only — never sends requests.
  assert.doesNotMatch(page, /callGrpcWeb|callGrpcNative|callSdk|callRest|proxyFetch/);
  // Lark sync present, no hardcoded team URL (removed in Sprint 8 B6).
  assert.match(page, /pushDocsToLark/);
  assert.match(page, /syncDocsFromLark/);
  assert.doesNotMatch(page, /casinoplus\.sg\.larksuite\.com\/docx\/R8EwdtG1Io9S5MxTIuVlSIuZgVg/);
  // Push button is gated by isSuperAdmin (Sprint 8 B1).
  assert.match(page, /isSuperAdmin && \(/);
  // Delete actions route through confirm modal (Sprint 8 B7).
  assert.match(page, /VaultConfirmModal/);
  // Curl import autofill (Sprint 8.1).
  assert.match(page, /applyCurlToDraft/);
  // Sprint 8.2 dropped the right-rail Details + Related (full-width detail).
  assert.doesNotMatch(page, /Related Endpoints/);
  assert.doesNotMatch(page, /FieldTableEditor/);
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

// ---------------------------------------------------------------------------
// Sprint 8.2 backward-compat migration shims — parseEndpoint must surface
// legacy endpoint shape (authentication / overview+notes / requestExample /
// responseExample / no title) through the new primary fields without dropping
// the originals.
// ---------------------------------------------------------------------------

function parseLegacyEndpoint(docs, legacy) {
  const kb = docs.parseKnowledgeBase({
    collections: [{ name: "Legacy", endpoints: [legacy] }],
  });
  assert.ok(kb, "parseKnowledgeBase returned null");
  assert.equal(kb.collections.length, 1);
  assert.equal(kb.collections[0].endpoints.length, 1);
  return kb.collections[0].endpoints[0];
}

test("parseEndpoint migrates legacy authentication string into headers row", async () => {
  const docs = await loadDocsLarkModule();
  const ep = parseLegacyEndpoint(docs, {
    method: "GET",
    path: "/legacy/auth",
    authentication: "Bearer Token",
  });
  assert.ok(Array.isArray(ep.headers), "headers must be an array");
  assert.equal(ep.headers.length, 1);
  assert.equal(ep.headers[0].key, "Authorization");
  assert.equal(ep.headers[0].value, "Bearer Token");
  // Original legacy field is preserved for round-trip.
  assert.equal(ep.authentication, "Bearer Token");
});

test("parseEndpoint joins legacy overview + notes into description with \\n\\n", async () => {
  const docs = await loadDocsLarkModule();
  const ep = parseLegacyEndpoint(docs, {
    method: "POST",
    path: "/legacy/both",
    overview: "Checks the thing.",
    notes: "Must be authenticated.",
  });
  assert.equal(ep.description, "Checks the thing.\n\nMust be authenticated.");
  assert.equal(ep.overview, "Checks the thing.");
  assert.equal(ep.notes, "Must be authenticated.");
});

test("parseEndpoint falls back to overview alone when notes missing", async () => {
  const docs = await loadDocsLarkModule();
  const ep = parseLegacyEndpoint(docs, {
    method: "GET",
    path: "/legacy/overview-only",
    overview: "Just an overview.",
  });
  assert.equal(ep.description, "Just an overview.");
});

test("parseEndpoint falls back to notes alone when overview missing", async () => {
  const docs = await loadDocsLarkModule();
  const ep = parseLegacyEndpoint(docs, {
    method: "GET",
    path: "/legacy/notes-only",
    notes: "Only notes here.",
  });
  assert.equal(ep.description, "Only notes here.");
});

test("parseEndpoint surfaces legacy requestExample as requestBody", async () => {
  const docs = await loadDocsLarkModule();
  const ep = parseLegacyEndpoint(docs, {
    method: "POST",
    path: "/legacy/req-example",
    requestExample: '{ "cpf": "53477771842" }',
  });
  assert.equal(ep.requestBody, '{ "cpf": "53477771842" }');
  assert.equal(ep.requestExample, '{ "cpf": "53477771842" }');
});

test("parseEndpoint surfaces legacy responseExample as responseBody", async () => {
  const docs = await loadDocsLarkModule();
  const ep = parseLegacyEndpoint(docs, {
    method: "GET",
    path: "/legacy/res-example",
    responseExample: '{ "resultado": "NAO_IMPEDIDO" }',
  });
  assert.equal(ep.responseBody, '{ "resultado": "NAO_IMPEDIDO" }');
  assert.equal(ep.responseExample, '{ "resultado": "NAO_IMPEDIDO" }');
});

test("parseEndpoint synthesizes title as 'METHOD /path' when title and summary missing", async () => {
  const docs = await loadDocsLarkModule();
  const ep = parseLegacyEndpoint(docs, {
    method: "DELETE",
    path: "/legacy/no-title",
  });
  assert.equal(ep.title, "DELETE /legacy/no-title");
});

test("parseEndpoint uses explicit headers array verbatim and ignores legacy authentication", async () => {
  const docs = await loadDocsLarkModule();
  const ep = parseLegacyEndpoint(docs, {
    method: "GET",
    path: "/legacy/headers-win",
    authentication: "Bearer SHOULD-NOT-APPEAR",
    headers: [
      { key: "X-Api-Key", value: "abc123" },
      { key: "Accept", value: "application/json" },
    ],
  });
  assert.equal(ep.headers.length, 2);
  assert.equal(ep.headers[0].key, "X-Api-Key");
  assert.equal(ep.headers[0].value, "abc123");
  assert.equal(ep.headers[1].key, "Accept");
  // Legacy authentication string is NOT injected as an Authorization row.
  assert.equal(
    ep.headers.find((h) => h.key === "Authorization"),
    undefined,
  );
});

test("emptyEndpoint() defaults requestBody and responseBody to '{}' (Sprint 8.2)", async () => {
  const docs = await loadDocsLarkModule();
  const ep = docs.emptyEndpoint();
  assert.equal(ep.requestBody, "{}");
  assert.equal(ep.responseBody, "{}");
});
