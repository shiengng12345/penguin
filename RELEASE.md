# Release

## Quick Flow

```bash
pnpm release:ship 1.4.2
git push origin main --tags
```

## What `release:ship` does

- Updates version in `package.json`
- Updates version in `src-tauri/tauri.conf.json`
- Updates version in `src-tauri/Cargo.toml`
- Creates commit: `release: v1.4.2`
- Creates tag: `v1.4.2`

## Before You Start

- Make sure `git status` is clean
- Pick a new version number like `1.4.2`

## After Push

- Wait for GitHub Actions to finish
- Confirm the GitHub Release is published
- Confirm `latest.json` is reachable:
  - `https://github.com/shiengng12345/penguin/releases/latest/download/latest.json`

## Verify Update

- Install the new `.dmg` if you want the app itself to show the new current version
- Use an older installed app to test `Check for Updates`

## Notes

- App `Current version` shows the version of the installed app bundle, not the repo version
- Tauri updater only sees published releases, not drafts
- If you only want to bump version without commit/tag, use:

```bash
pnpm set-version 1.4.2
```
