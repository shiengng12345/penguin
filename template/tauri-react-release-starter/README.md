# Tauri React Release Starter

Copy this folder to a new location, rename it, and bootstrap it with your own app details.

## Stack

- Tauri 2
- React 19
- Vite 6
- TypeScript
- Tailwind CSS 4
- GitHub Actions release flow with updater artifacts

## Quick Start

```bash
cp -R tauri-react-release-starter ~/Desktop/my-new-app
cd ~/Desktop/my-new-app
node scripts/init-template.mjs \
  --app-name "Acme Desk" \
  --package-name acme-desk \
  --identifier com.acme.desk \
  --description "Desktop control plane for Acme" \
  --repo-owner your-github-user \
  --repo-name acme-desk
pnpm install
pnpm tauri dev
```

## What `init-template` updates

- `package.json`
- `src/App.tsx`
- `src/lib/external-links.ts`
- `src/lib/theme.ts`
- `src-tauri/Cargo.toml`
- `src-tauri/src/main.rs`
- `src-tauri/tauri.conf.json`
- `.github/workflows/build.yml`

## Local Commands

```bash
pnpm tauri dev
pnpm tauri build
pnpm desktop:dev
pnpm desktop:build
```

- `pnpm tauri dev` starts the desktop app in development mode
- `pnpm tauri build` creates the production app bundle and updater artifacts
- `pnpm desktop:dev` is a shorter alias for `pnpm tauri dev`
- `pnpm desktop:build` is a shorter alias for `pnpm tauri build`

## Release Setup

1. Generate an updater key pair.
2. Put your private key in GitHub secret `TAURI_SIGNING_PRIVATE_KEY`.
3. Put the private key password in GitHub secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. Replace the updater public key in `src-tauri/tauri.conf.json`.
5. Release with:

```bash
pnpm release:ship 0.1.0
git push origin main --tags
```

## Notes

- `src-tauri/icons/` currently contains placeholder icons copied from this repo. Replace them before shipping.
- GitHub release automation publishes macOS `aarch64` and `x86_64` builds and generates `latest.json`.
- `Current version` in the app shows the installed app bundle version, not the repo version.
