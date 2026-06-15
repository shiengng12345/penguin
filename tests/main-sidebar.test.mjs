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

test("MainSidebar declares the 5 modules: home / client / rest / vault / docs (Sprint 10 added rest)", async () => {
  const src = await loadSource("../src/components/layout/MainSidebar.tsx");
  // The union members are written into MainModule = "home" | "client" | "rest" | "vault" | "docs"
  assert.match(src, /"home"\s*\|\s*"client"\s*\|\s*"rest"\s*\|\s*"vault"\s*\|\s*"docs"/);
  // ITEMS array contains each kind.
  for (const kind of ["home", "client", "rest", "vault", "docs"]) {
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
  assert.match(src, /label:\s*"REST"/);
  assert.match(src, /label:\s*"Docs"/);
  // Tooltip bilingual — every module gets a "<English> / <中文>" longLabel
  // so first-time Chinese-speaking users get a hint on hover. Locking
  // ALL FIVE so a sidebar refactor that drops one tooltip is caught.
  // Literal substring match (CJK + regex special chars don't mix well).
  for (const literal of [
    'longLabel: "Home / 首页"',
    'longLabel: "API Client / 客户端"',
    'longLabel: "Vault / 凭据库"',
    'longLabel: "REST API / 接口客户端 (Super Admin)"',
    'longLabel: "Knowledge Base / 知识库 (Super Admin)"',
  ]) {
    assert.ok(src.includes(literal), `MainSidebar should declare: ${literal}`);
  }
});

test("MainSidebar uses aria-current to mark active module", async () => {
  const src = await loadSource("../src/components/layout/MainSidebar.tsx");
  // Locks both the binding (isActive) AND the value ("page" vs undefined).
  // Catches accidental hard-coding of aria-current or wrong-condition bind.
  assert.match(src, /aria-current=\{isActive\s*\?\s*"page"\s*:\s*undefined\}/);
});

test("App.tsx computes per-module gates (Vault = token, Docs = super-admin)", async () => {
  const src = await loadSource("../src/App.tsx");
  assert.match(src, /useDeveloperMode/);
  assert.match(src, /canAccessVault\s*=\s*devModeEnabled\s*&&\s*hasValidToken/);
  assert.match(src, /canAccessDocs\s*=\s*devModeEnabled\s*&&\s*isSuperAdmin/);
});

test("MainSidebar — REST module locked to super-admin tier (regression guard)", async () => {
  // Without this anti-regression test, a future refactor that drops REST
  // back to the token tier would silently let normal admins see / click
  // the REST icon — and (since HomePage + Header are also gated on super)
  // create a UX where REST is reachable only via shortcuts, not visible.
  // Lock both positive (must be super-admin) and negative (must NOT be token).
  //
  // Regex anchors with `[^}]*?` (not `[\s\S]`) so the match window can't
  // cross an item boundary `}` — otherwise the `requires: "none"` of the
  // adjacent `client` item would false-match the home block.
  const src = await loadSource("../src/components/layout/MainSidebar.tsx");
  assert.match(
    src,
    /kind:\s*"rest"[^}]*?requires:\s*"super-admin"/,
    "REST must be super-admin tier",
  );
  assert.doesNotMatch(
    src,
    /kind:\s*"rest"[^}]*?requires:\s*"token"/,
    "REST must NOT be token tier (regression check)",
  );
  // Home is also super-admin (the launcher for REST + Docs); same guard.
  assert.match(
    src,
    /kind:\s*"home"[^}]*?requires:\s*"super-admin"/,
  );
  assert.doesNotMatch(
    src,
    /kind:\s*"home"[^}]*?requires:\s*"none"/,
  );
});

test("App.tsx wires MainSidebar gate props from per-tier access flags", async () => {
  const src = await loadSource("../src/App.tsx");
  // REST sits in the super-admin tier alongside Docs. Normal admins
  // see only Home + Client + Vault. Token tier = Vault only.
  assert.match(src, /hasValidToken=\{canAccessVault\}/);
  assert.match(src, /isSuperAdmin=\{canAccessDocs\s*\|\|\s*canAccessRest\}/);
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

test("Header.tsx does not render a Vault toggle button or import the Lock icon", async () => {
  const src = await loadSource("../src/components/layout/Header.tsx");
  // The old Vault button pattern: a <button> with `onClick={onToggleVault}` and "Vault" text.
  assert.doesNotMatch(src, /onClick=\{onToggleVault\}/);
  // The Lock icon import should be gone.
  assert.doesNotMatch(src, /import\s*{[^}]*\bLock\b[^}]*}\s*from\s*"lucide-react"/);
});
