// Source-assertion tests for VaultProjectEditor — covers the
// drag-to-reorder feature added post-Phase-10D per user request.
//
// Drag-reorder is super-admin only — token-tier admins (who CAN open the
// Vault and edit project name + add/remove envs) must NOT see the drag
// handle and must NOT be able to drag rows.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function loadSource(relPath) {
  return readFile(new URL(relPath, import.meta.url), "utf8");
}

test("VaultProjectEditor — drag-to-reorder gated behind isSuperAdmin", async () => {
  const src = await loadSource("../src/components/vault/VaultProjectEditor.tsx");

  // Reads isSuperAdmin from the same hook everything else in the app uses
  // (single source of truth for tier).
  assert.match(src, /import \{ useDeveloperMode \} from "@\/hooks\/useDeveloperMode"/);
  assert.match(src, /const \{ isSuperAdmin \} = useDeveloperMode\(\);/);

  // canReorder = isSuperAdmin — gate all reorder affordances + handlers
  // on this single derived flag.
  assert.match(src, /const canReorder = isSuperAdmin;/);

  // The pointer-down handler short-circuits when !canReorder so a non-
  // super who bypasses the UI hidden handle can't initiate a drag via
  // dev tools.
  assert.match(src, /handlePointerDown[\s\S]{0,300}?if \(!canReorder\) return;/);

  // The grip handle <span> is conditionally rendered — invisible to
  // non-super so they don't see an affordance they can't use.
  assert.match(src, /\{canReorder && \([\s\S]{0,800}?<GripVertical/);
});

test("VaultProjectEditor — pointer-event drag (bypasses HTML5 DnD which Input children swallow)", async () => {
  // HTML5 drag/drop in Tauri WKWebView fails when row children include
  // focusable <input>/<select> — they swallow drop events. We use
  // pointerdown + window pointermove/up + bbox hit-testing instead.
  const src = await loadSource("../src/components/vault/VaultProjectEditor.tsx");
  // Pointer-down on the GripVertical handle starts the drag.
  assert.match(src, /onPointerDown=\{handlePointerDown\(index\)\}/);
  // Window-level pointermove + pointerup so the drag is captured even
  // when the cursor wanders over an input child.
  assert.match(src, /window\.addEventListener\("pointermove"/);
  assert.match(src, /window\.addEventListener\("pointerup"/);
  assert.match(src, /window\.addEventListener\("pointercancel"/);
  // Bounding-box hit test — row index resolved from cursor Y position.
  assert.match(src, /findIndexAt\(/);
  assert.match(src, /el\.getBoundingClientRect\(\)/);
  // No HTML5 DnD properties on rows — those were the buggy path.
  assert.doesNotMatch(src, /onDragStart=/);
  assert.doesNotMatch(src, /onDragOverCapture=/);
  assert.doesNotMatch(src, /onDropCapture=/);
});

test("VaultProjectEditor — reorder uses splice + restores cursor + selection on drop", async () => {
  const src = await loadSource("../src/components/vault/VaultProjectEditor.tsx");
  // Reorder algorithm: cut from source index, insert at target index.
  assert.match(src, /next\.splice\(index, 1\)/);
  assert.match(src, /next\.splice\(targetIdx, 0, moved\)/);
  // Drag visuals: dimmed dragging row + outlined drop target.
  assert.match(src, /dragIndex === index && "opacity-40"/);
  assert.match(src, /dragOverIndex === index && dragIndex !== null && dragIndex !== index/);
  // Cursor + select reset on pointerup so the body returns to normal.
  assert.match(src, /document\.body\.style\.cursor = ""/);
  assert.match(src, /document\.body\.style\.userSelect = ""/);
});
