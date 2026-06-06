import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const HOOK_URL = new URL("../src/hooks/useDeveloperMode.ts", import.meta.url);
const SECTION_URL = new URL(
  "../src/components/settings/DeveloperModeSection.tsx",
  import.meta.url,
);
const HEADER_URL = new URL("../src/components/layout/Header.tsx", import.meta.url);
const VAULT_URL = new URL("../src/components/vault/VaultPage.tsx", import.meta.url);
const STORE_URL = new URL("../src/lib/dev-mode-store.ts", import.meta.url);

test("useDeveloperMode hook file exists and exports the locked function", async () => {
  const source = await readFile(HOOK_URL, "utf8");
  assert.match(source, /export function useDeveloperMode\(\)/);
});

test("useDeveloperMode return shape is contract-locked (incl. isSuperAdmin)", async () => {
  const source = await readFile(HOOK_URL, "utf8");
  assert.match(
    source,
    /return\s*\{[^}]*enabled[^}]*hasValidToken[^}]*isSuperAdmin[^}]*\}/,
  );
});

test("useDeveloperMode is self-consumed at DeveloperModeSection, Header, and VaultPage", async () => {
  const section = await readFile(SECTION_URL, "utf8");
  const header = await readFile(HEADER_URL, "utf8");
  const vault = await readFile(VAULT_URL, "utf8");
  assert.match(section, /import\s*\{[^}]*useDeveloperMode[^}]*\}/);
  assert.match(header, /import\s*\{[^}]*useDeveloperMode[^}]*\}/);
  assert.match(vault, /import\s*\{[^}]*useDeveloperMode[^}]*\}/);
});

test("dev-mode-store exports requireSuperAdmin (Sprint 3 DEC #75)", async () => {
  const source = await readFile(STORE_URL, "utf8");
  assert.match(source, /export function requireSuperAdmin\(\)\s*:\s*boolean/);
});
