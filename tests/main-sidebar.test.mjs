// MainSidebar module switcher + Dev Mode gating (Sprint 8.3 + 8.4).
//
// Source-assertion: MainSidebar is a JSX component and depends on the
// React + lucide-react runtime, so we read its source as text and grep
// for the contract pieces. App-side wiring (useDeveloperMode → unlocked
// → redirect) lives in App.tsx and is asserted the same way.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function loadSource(relPath) {
  return readFile(new URL(relPath, import.meta.url), "utf8");
}

test("MainSidebar exports MainModule + MainSidebar component", async () => {
  const src = await loadSource("../src/components/layout/MainSidebar.tsx");
  assert.match(src, /export type MainModule\b/);
  assert.match(src, /export function MainSidebar\(/);
  assert.match(src, /export interface MainSidebarProps/);
});

test("MainSidebar declares the 4 modules: home / client / vault / docs", async () => {
  const src = await loadSource("../src/components/layout/MainSidebar.tsx");
  // The union members are written into MainModule = "home" | "client" | "vault" | "docs"
  assert.match(src, /"home"\s*\|\s*"client"\s*\|\s*"vault"\s*\|\s*"docs"/);
  // ITEMS array contains each kind.
  for (const kind of ["home", "client", "vault", "docs"]) {
    assert.match(src, new RegExp(`kind:\\s*"${kind}"`));
  }
});

test("MainSidebar requires `hasValidToken` + `isSuperAdmin` props (Sprint 8.5 three-tier)", async () => {
  const src = await loadSource("../src/components/layout/MainSidebar.tsx");
  assert.match(src, /hasValidToken:\s*boolean/);
  assert.match(src, /isSuperAdmin:\s*boolean/);
  // Destructured in the function signature.
  assert.match(
    src,
    /export function MainSidebar\({\s*active,\s*onSelect,\s*hasValidToken,\s*isSuperAdmin\s*}/,
  );
});

test("MainSidebar tags items with three-tier gating (none / token / super-admin)", async () => {
  const src = await loadSource("../src/components/layout/MainSidebar.tsx");
  // Home + Client require nothing.
  assert.match(src, /kind:\s*"home"[\s\S]*?requires:\s*"none"/);
  assert.match(src, /kind:\s*"client"[\s\S]*?requires:\s*"none"/);
  // Vault needs any dev token; Docs needs super-admin.
  assert.match(src, /kind:\s*"vault"[\s\S]*?requires:\s*"token"/);
  assert.match(src, /kind:\s*"docs"[\s\S]*?requires:\s*"super-admin"/);
});

test("MainSidebar filter handles all three gating tiers", async () => {
  const src = await loadSource("../src/components/layout/MainSidebar.tsx");
  // Filter must branch on each tier value and return the right prop.
  assert.match(src, /requires\s*===\s*"none"[\s\S]*?return true/);
  assert.match(src, /requires\s*===\s*"token"[\s\S]*?return hasValidToken/);
  assert.match(src, /requires\s*===\s*"super-admin"[\s\S]*?return isSuperAdmin/);
});

test("MainSidebar items include English label + bilingual tooltip", async () => {
  const src = await loadSource("../src/components/layout/MainSidebar.tsx");
  // Short labels under icon.
  assert.match(src, /label:\s*"Home"/);
  assert.match(src, /label:\s*"Client"/);
  assert.match(src, /label:\s*"Vault"/);
  assert.match(src, /label:\s*"Docs"/);
  // Tooltip bilingual.
  assert.match(src, /longLabel:\s*"Vault \/ 凭据库"/);
  assert.match(src, /longLabel:\s*"Knowledge Base \/ 知识库 \(Super Admin\)"/);
});

test("MainSidebar uses aria-current to mark active module", async () => {
  const src = await loadSource("../src/components/layout/MainSidebar.tsx");
  assert.match(src, /aria-current=/);
});

test("App.tsx computes per-module gates (Vault = token, Docs = super-admin)", async () => {
  const src = await loadSource("../src/App.tsx");
  assert.match(src, /useDeveloperMode/);
  assert.match(src, /canAccessVault\s*=\s*devModeEnabled\s*&&\s*hasValidToken/);
  assert.match(src, /canAccessDocs\s*=\s*devModeEnabled\s*&&\s*isSuperAdmin/);
});

test("App.tsx passes per-tier props to MainSidebar (gate wiring)", async () => {
  const src = await loadSource("../src/App.tsx");
  assert.match(src, /hasValidToken=\{canAccessVault\}/);
  assert.match(src, /isSuperAdmin=\{canAccessDocs\}/);
});

test("App.tsx redirects out of Vault when dev token revoked (regression)", async () => {
  const src = await loadSource("../src/App.tsx");
  // Effect body — Vault closes when canAccessVault drops, regardless of Docs.
  assert.match(
    src,
    /if\s*\(vaultOpen\s*&&\s*!canAccessVault\)\s*setVaultOpen\(false\);/,
  );
});

test("App.tsx redirects out of Docs when super-admin revoked (regression)", async () => {
  const src = await loadSource("../src/App.tsx");
  // Docs closes when canAccessDocs drops, regardless of Vault — independent gate.
  assert.match(
    src,
    /if\s*\(docsOpen\s*&&\s*!canAccessDocs\)\s*setDocsOpen\(false\);/,
  );
});

test("Dev token holder (token=true, super=false) sees Home + Client + Vault, NOT Docs", async () => {
  const src = await loadSource("../src/components/layout/MainSidebar.tsx");
  // The filter implements: none always; token if hasValidToken; super-admin if isSuperAdmin.
  // Build the gating table from the items + run filter mentally — assert the
  // four declarations carry the exact tier we expect.
  const expected = {
    home: "none",
    client: "none",
    vault: "token",
    docs: "super-admin",
  };
  for (const [kind, tier] of Object.entries(expected)) {
    const re = new RegExp(`kind:\\s*"${kind}"[\\s\\S]*?requires:\\s*"${tier}"`);
    assert.match(src, re, `${kind} should require ${tier}`);
  }
});

test("Header.tsx no longer renders the Vault button (Sprint 8.3 removed; sidebar replaces it)", async () => {
  const src = await loadSource("../src/components/layout/Header.tsx");
  // The old Vault button pattern: a <button> with `onClick={onToggleVault}` and "Vault" text.
  assert.doesNotMatch(src, /onClick=\{onToggleVault\}/);
  // The Lock icon import should be gone.
  assert.doesNotMatch(src, /import\s*{[^}]*\bLock\b[^}]*}\s*from\s*"lucide-react"/);
});
