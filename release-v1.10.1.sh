#!/usr/bin/env bash
# release-v1.10.1.sh
#
# Prepares a clean v1.10.1 release commit containing ONLY the npmrc mirror
# fix + the version bumps. Stashes all other in-progress work (Sprint 10
# REST module + Postman dialog + module-aware shortcuts) so it cannot
# accidentally leak into the release commit.
#
# What this script DOES (all reversible):
#   1. Stages the 6 release files (fix + tests + version bumps)
#   2. Stashes everything else (REST module + shortcut work) — `git stash`
#      is fully reversible via `git stash pop`
#   3. Runs both layers of tests (cargo unit tests for mirror behavior +
#      node source-assertion test for the anti-pattern guard)
#   4. Prints the staged diff for you to eyeball
#   5. PRINTS the commit + tag + push commands — does NOT execute them
#
# What this script DOES NOT do:
#   * Never runs `git commit` / `git tag` / `git push` — those are yours
#   * Never modifies any source file — only stages / stashes
#
# Failure recovery: on any error, the stash is automatically popped so your
# working tree returns to its pre-script state.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# ---------- Pre-flight ----------
echo "── Pre-flight checks ──"

if ! git diff --cached --quiet; then
  echo "❌ ERROR: There are already staged changes."
  echo "   Run 'git restore --staged .' first, then re-run this script."
  exit 1
fi

EXPECTED_FILES=(
  "src-tauri/src/packages.rs"
  "tests/packages-npmrc-mirror.test.mjs"
  "package.json"
  "src-tauri/Cargo.toml"
  "src-tauri/Cargo.lock"
  "src-tauri/tauri.conf.json"
)

for f in "${EXPECTED_FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "❌ ERROR: Release file missing: $f"
    exit 1
  fi
done

# Sanity: package.json must report the new version. Catch the case where the
# user forgot to bump it locally or already committed v1.10.1 and is re-running.
if ! grep -q '"version": "1.10.1"' package.json; then
  echo "❌ ERROR: package.json does not show version 1.10.1 (already committed? or not bumped?)"
  exit 1
fi
if ! grep -q '^version = "1.10.1"' src-tauri/Cargo.toml; then
  echo "❌ ERROR: src-tauri/Cargo.toml does not show version 1.10.1"
  exit 1
fi
if ! grep -q '"version": "1.10.1"' src-tauri/tauri.conf.json; then
  echo "❌ ERROR: src-tauri/tauri.conf.json does not show version 1.10.1"
  exit 1
fi

echo "✓ pre-flight OK"
echo ""

# ---------- 1. Stage the 6 release files ----------
echo "── 1. Staging 6 release files ──"
git add "${EXPECTED_FILES[@]}"
git diff --cached --stat
echo ""

# ---------- 2. Stash everything else ----------
echo "── 2. Stashing in-progress work (REST module + dialog + shortcuts) ──"
STASH_MSG="REST module + dialog + shortcuts (post-v1.10.1) [auto by release-v1.10.1.sh]"

# Only stash if there's actually something to set aside.
NEED_STASH=0
if [[ -n "$(git status --porcelain | grep -E '^( M|MM|.M|\?\?)' || true)" ]]; then
  NEED_STASH=1
fi

if [[ $NEED_STASH -eq 1 ]]; then
  git stash push -u --keep-index -m "$STASH_MSG"
  STASH_CREATED=1
else
  echo "(nothing else to stash)"
  STASH_CREATED=0
fi

# Trap: if anything below fails, restore the stash so the user's working tree
# returns to exactly the state they were in before running this script.
restore_on_failure() {
  local code=$?
  if [[ $code -ne 0 && $STASH_CREATED -eq 1 ]]; then
    echo ""
    echo "⚠️  Script failed (exit $code). Restoring stashed REST work..."
    git reset HEAD --quiet
    git stash pop --quiet 2>/dev/null || echo "   (stash pop failed — check 'git stash list')"
  fi
}
trap restore_on_failure EXIT

echo ""

# ---------- 3. Verify working tree is clean v1.10.1 ----------
echo "── 3. Working tree should now show ONLY the 6 release files ──"
git status --short
echo ""

# ---------- 4. Run both test layers ----------
echo "── 4. Rust behavioral unit tests (mirror_npmrc, 5 cases) ──"
( cd src-tauri && cargo test --lib packages:: 2>&1 | tail -12 )
echo ""

echo "── 5. Node source-assertion test (anti-pattern guard) ──"
node --test tests/packages-npmrc-mirror.test.mjs 2>&1 | tail -10
echo ""

# ---------- 6. Print commit + tag + push commands ----------
echo "──────────────────────────────────────────────────────────────────────"
echo "✅ Working tree is clean v1.10.1. All tests pass."
echo ""
echo "Eyeball the diff above. If it looks right, run these commands MANUALLY:"
echo "──────────────────────────────────────────────────────────────────────"
cat <<'CMDS'

git commit -m "$(cat <<'EOF'
fix(packages): always mirror ~/.npmrc to per-protocol dir

Pengvi cached ~/.npmrc into ~/.penguin/<protocol>/.npmrc on first install
and never refreshed it. When users rotated registry credentials, terminal
npm install used the fresh ~/.npmrc while Pengvi-spawned npm kept hitting
the stale snapshot — symptom: ERR_SOCKET_TIMEOUT only inside Pengvi.

Now mirror on every ensure_packages_dir call when contents drift, and
drop the snapshot when ~/.npmrc is removed. 5 Rust unit tests cover the
behavior (copy-on-missing / refresh-on-rotation / noop-when-equal /
delete-when-global-removed / noop-when-neither).

Release: v1.10.1
EOF
)"

git tag v1.10.1
git push origin main
git push origin v1.10.1

# After CI is green, restore the REST work:
git stash pop

CMDS
echo "──────────────────────────────────────────────────────────────────────"
echo ""
echo "Aborting before commit? Run: git restore --staged . && git stash pop"

# Successful exit — clear the trap so the user keeps the staged state.
trap - EXIT
