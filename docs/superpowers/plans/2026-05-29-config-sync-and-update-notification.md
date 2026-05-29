# Config Sync And Update Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build safe remote environment config sync first, then add release update notification.

**Architecture:** Keep bundled config as offline fallback, add a separate GitHub-hosted remote config file, and merge remote environments into local storage without overwriting user-owned environments. Update notification is separate and wraps the existing Tauri updater plugin with non-blocking UI.

**Tech Stack:** React 19, Zustand/localStorage, Tauri 2, `@tauri-apps/plugin-updater`, Node `node:test`, TypeScript.

## Owner-Only Config Direction

- Public defaults live in `config/penguin.remote-config.json` and are safe for every user.
- Owner-only presets should stay local/private, for example in `~/.penguin/config.json` or localStorage, and must not be committed to the public GitHub repo.
- Safe merge preserves owner-only local entries because remote removal never deletes local config and same-name conflicts keep the local version.
- If owner-only features need real access control instead of convenience toggles, use signed config or backend/account validation; client-side config alone is not secure.

---

## Release Split

- `v1.6.8`: Pull Latest Config.
- `v1.6.9`: Update Notification.

## Task 1: Safe Config Merge Core

**Files:**
- Create: `src/lib/config-sync.ts`
- Test: `tests/config-sync.test.mjs`

- [ ] Write failing tests for safe merge:
  - remote env is added when local list does not contain the name.
  - local env is preserved when remote has the same name.
  - same-name but different variables is reported as a conflict.
  - remote removal never deletes local env.
- [ ] Run `node --test tests/config-sync.test.mjs` and confirm the tests fail because `src/lib/config-sync.ts` does not exist.
- [ ] Implement `parseConfig`, `configEnvsForProtocol`, `mergeConfigEnvironments`, and `fetchRemoteConfig`.
- [ ] Run `node --test tests/config-sync.test.mjs` and confirm pass.

## Task 2: Startup Config Sync Uses Safe Merge

**Files:**
- Modify: `src/hooks/useEnvironments.ts`
- Test: `tests/config-sync.test.mjs`

- [ ] Add a source test that fails if `useEnvironments.ts` manually overwrites config env variables instead of calling `mergeConfigEnvironments`.
- [ ] Replace startup config sync merge with `mergeConfigEnvironments`.
- [ ] Run `node --test tests/config-sync.test.mjs`.

## Task 3: Remote Config File

**Files:**
- Create: `config/penguin.remote-config.json`
- Modify: `.penguin.config.json` only if bundled fallback must match current defaults.

- [ ] Copy the current safe defaults into `config/penguin.remote-config.json`.
- [ ] Add a test that parses the remote config file and rejects old `QAT1/QAT2/QAT3/UAT1/UAT2/UAT3/UAT-STABLE` names.
- [ ] Run `node --test tests/config-sync.test.mjs`.

## Task 4: Pull Latest Config Button

**Files:**
- Modify: `src/components/environment/EnvManager.tsx`
- Test: `tests/config-sync.test.mjs`

- [ ] Add a source test proving `EnvManager` renders `Pull Latest Config` and calls `fetchRemoteConfig`.
- [ ] Add button state: idle, loading, success summary, error.
- [ ] On click, fetch remote config and safe-merge only the selected protocol.
- [ ] Persist merged envs to localStorage.
- [ ] Run targeted tests.

## Task 5: Verification And Release v1.6.8

- [ ] Run `node --test tests/*.test.mjs`.
- [ ] Run `pnpm exec tsc -p tsconfig.json --noEmit --pretty false`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Run `pnpm build`.
- [ ] Bump version to `1.6.8`, commit, tag, push, and verify GitHub release.

## Task 6: Update Notification

**Files:**
- Create: `src/lib/updater.ts`
- Create: `src/components/update/UpdatePrompt.tsx`
- Modify: `src/App.tsx`
- Test: `tests/update-notification.test.mjs`

- [ ] Wrap `@tauri-apps/plugin-updater` in a helper that returns `null` when updater is unavailable.
- [ ] Add skipped-version localStorage handling.
- [ ] Render a non-blocking prompt with `Download & Install`, `Later`, and `View Release`.
- [ ] Verify dev/browser mode does not crash.
- [ ] Release as `v1.6.9`.
