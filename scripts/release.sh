#!/usr/bin/env bash
# Unified release script. Usage: scripts/release.sh <version> [commit message]
#
#   scripts/release.sh 1.8.2
#   scripts/release.sh 1.8.2 "release: v1.8.2 — fix sidecar timeout"
#
# Stops at each gate so you can abort. Replaces the one-off
# release-vX.Y.Z.sh scripts: stage your feature commits yourself first;
# this script only handles version bump → verify → commit → tag → push.
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: scripts/release.sh <version> [commit message]" >&2
  exit 1
fi
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid version: $VERSION" >&2
  exit 1
fi

MESSAGE="${2:-release: v$VERSION}"
TAG="v$VERSION"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG already exists. Aborting." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "⚠️  Working tree is not clean. Commit or stash feature changes first;"
  echo "    this script should only commit the version bump."
  git status --short
  read -r -p "Press ENTER to continue anyway, or Ctrl-C to abort: " _
fi

echo "▶ Step 1/4 — bump version to $VERSION"
node scripts/set-version.mjs "$VERSION"
# Keep Cargo.lock in sync with Cargo.toml so CI's frozen build doesn't drift.
cargo update --manifest-path src-tauri/Cargo.toml --workspace --quiet || true

echo
echo "▶ Step 2/4 — verify (JS tests + typecheck)"
pnpm test
pnpm typecheck

echo
echo "✅ Verification passed. Next: commit the version bump."
read -r -p "Press ENTER to commit, or Ctrl-C to abort: " _

git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "$MESSAGE"

echo
echo "▶ Step 3/4 — push commit to origin/main"
read -r -p "Press ENTER to push, or Ctrl-C to abort: " _
git push origin main

echo
echo "▶ Step 4/4 — tag $TAG + push tag (triggers CI build + GitHub release)"
read -r -p "Press ENTER to tag + push, or Ctrl-C to abort (irreversible after this): " _
git tag "$TAG"
git push origin "$TAG"

echo
echo "🎉 $TAG tagged + pushed."
echo "Build progress: https://github.com/shiengng12345/penguin/actions"
echo "Takes ~10 min. After build, edit release notes at:"
echo "  https://github.com/shiengng12345/penguin/releases"
