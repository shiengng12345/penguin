// Regression guard for v1.10.1: packages.rs must mirror ~/.npmrc into the
// per-protocol package dir on EVERY ensure_packages_dir call, not just the
// first one.
//
// Symptom this guards against: a user rotates their registry credentials
// (or the team migrates to a new registry URL). `npm install` from terminal
// works (uses the fresh ~/.npmrc) but inside Pengvi it fails with
// ERR_SOCKET_TIMEOUT — Pengvi's cwd is ~/.penguin/<protocol>/ which has a
// stale .npmrc snapshot from before the rotation, and npm's config
// resolution walks UP from cwd so the project-local file shadows ~/.npmrc.
//
// The pre-1.10.1 code copied only `if !local_npmrc.exists()`, baking the
// snapshot forever. The fix compares contents and re-copies on drift.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function loadSource(relPath) {
  return readFile(new URL(relPath, import.meta.url), "utf8");
}

test("packages.rs — ensure_packages_dir mirrors ~/.npmrc on every call (no once-only guard)", async () => {
  const src = await loadSource("../src-tauri/src/packages.rs");

  // 1. Anti-pattern that caused the bug: the bare existence check guarding the
  //    copy. If this regex matches the file again it means someone reintroduced
  //    the once-only copy and credential rotations will silently break Pengvi
  //    installs while leaving terminal installs working.
  assert.doesNotMatch(
    src,
    /let local_npmrc = dir\.join\("\.npmrc"\);\s*\n\s*if !local_npmrc\.exists\(\) \{/,
    "packages.rs reintroduced the once-only .npmrc copy — credential rotations will leak as ERR_SOCKET_TIMEOUT",
  );

  // 2. The mirror logic was extracted into a testable helper function with
  //    explicit path args (so the Rust unit tests can drive it with scratch
  //    dirs instead of touching the user's real ~/.npmrc).
  assert.match(
    src,
    /pub\(crate\) fn mirror_npmrc\(global_npmrc: &Path, local_npmrc: &Path\)/,
  );

  // 3. The helper compares global vs local bytes before copying so the
  //    snapshot tracks ~/.npmrc updates without churning on benign calls.
  assert.match(src, /let global_bytes = fs::read\(global_npmrc\)\.ok\(\);/);
  assert.match(src, /let local_bytes = fs::read\(local_npmrc\)\.ok\(\);/);
  assert.match(src, /global_bytes\.is_some\(\) && global_bytes != local_bytes/);

  // 4. When ~/.npmrc is deleted but the snapshot lingers, drop the
  //    snapshot so npm falls back to defaults instead of stale state.
  assert.match(
    src,
    /else if local_npmrc\.exists\(\) \{[\s\S]{0,400}?fs::remove_file\(local_npmrc\)/,
  );

  // 5. ensure_packages_dir must actually call the helper (regression guard
  //    against someone deleting the call site while leaving the helper).
  assert.match(
    src,
    /mirror_npmrc\(&home\.join\("\.npmrc"\), &dir\.join\("\.npmrc"\)\)/,
  );
});
