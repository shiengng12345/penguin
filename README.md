# Penguin

A modern desktop API client for **gRPC-Web**, **gRPC**, and **SDK** testing — built with Tauri 2, React 19, and Rust.

![macOS](https://img.shields.io/badge/macOS-aarch64%20%7C%20x86__64-blue)
![Tauri](https://img.shields.io/badge/Tauri-2-orange)
![React](https://img.shields.io/badge/React-19-61DAFB)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Architecture](#architecture)
- [Deployment & Releases](#deployment--releases)
- [Configuration](#configuration)
- [Keyboard Shortcuts](#keyboard-shortcuts)

---

## Features

### Multi-Protocol Support
- **gRPC-Web** — Browser-compatible gRPC via Connect-Web, proxied through Rust for CORS handling
- **gRPC (Native)** — Full native gRPC via Node.js sidecar process
- **SDK** — TypeScript SDK testing via ConnectRPC

### Package Management
- Install `@snsoft/*` npm packages directly from the app
- Auto-discovers `.proto` files and TypeScript definitions
- Packages stored locally at `~/.pengvi/{grpc-web,grpc,sdk}/`
- Service and method tree browser in the sidebar

### Environment Variables
- Per-protocol environments (LOCAL, DEV, STAGING, etc.)
- Variable interpolation in URLs and headers using `{{VAR}}` syntax
- Configurable via UI or `.pengvi.config.json`

### Request Builder
- JSON body editor with CodeMirror (autocomplete, linting, formatting)
- Metadata/header management with per-protocol defaults
- Auto-generated request body from proto definitions
- Copy as cURL, save requests, view request documentation

### History & Saved Requests
- Full request/response history with configurable max size (100–1000)
- Save, name, and reload frequently used requests
- Export/import all data (environments, saved requests, history, headers)

### Desktop Experience
- 6 themes: Dark, Light, Nord, Emerald, Rose, Violet
- Extensive keyboard shortcuts
- Command search (Cmd+F)
- Network diagnostics
- cURL import
- Interactive onboarding tutorial
- Bilingual UI (English / Chinese)
- In-app auto-updates from GitHub Releases

---

## Tech Stack

### Frontend
| Technology | Purpose |
|---|---|
| React 19 | UI framework |
| TypeScript 5 | Type safety |
| Vite 6 | Build tool and dev server |
| Tailwind CSS 4 | Styling |
| Zustand 5 | State management (persisted to localStorage) |
| CodeMirror 6 | JSON editor with autocomplete and linting |
| Lucide React | Icons |
| ConnectRPC | gRPC-Web and SDK protocol support |
| protobufjs | Proto file parsing |

### Backend (Rust)
| Crate | Purpose |
|---|---|
| Tauri 2 | Desktop app framework |
| tauri-plugin-shell | Shell commands (npm, node) |
| tauri-plugin-store | Persistent key-value storage |
| tauri-plugin-updater | In-app auto-updates |
| tauri-plugin-process | App restart after updates |
| reqwest | HTTP proxy for gRPC-Web (CORS bypass) |
| tokio | Async runtime |
| serde / serde_json | Serialization |
| glob | File pattern matching |
| dirs | OS directory resolution |
| base64 | Binary encoding for gRPC payloads |

### CI/CD
| Tool | Purpose |
|---|---|
| GitHub Actions | Automated build and release |
| softprops/action-gh-release | GitHub Release creation |
| Tauri updater | Signed update artifacts + `latest.json` |

---

## Project Structure

```
pengvi/
├── src/                          # Frontend (React + TypeScript)
│   ├── App.tsx                   # Root layout, shortcuts, dialogs
│   ├── main.tsx                  # Entry point
│   ├── index.css                 # Global styles + Tailwind
│   ├── components/
│   │   ├── environment/          # EnvManager, CurlImport
│   │   ├── history/              # HistoryPanel
│   │   ├── layout/               # Header, Sidebar, TabBar, UrlBar
│   │   ├── network/              # NetworkCheck
│   │   ├── onboarding/           # Welcome, Tutorial, InteractiveTutorial
│   │   ├── packages/             # PackageInstaller
│   │   ├── request/              # RequestPanel, ResponsePanel, RequestDocDialog
│   │   ├── saved/                # SavedRequestsPanel
│   │   ├── search/               # CommandSearch
│   │   ├── settings/             # SettingsDialog (themes, headers, updates)
│   │   ├── shortcuts/            # ShortcutCheatSheet
│   │   └── ui/                   # Shared components (button, input, dialog, etc.)
│   ├── hooks/                    # useClock, useEnvironments, useGreeting, usePackages
│   └── lib/                      # Core logic
│       ├── store.ts              # Zustand store (tabs, packages, envs, history)
│       ├── environment-store.ts  # Environment interpolation
│       ├── grpc-web-client.ts    # gRPC-Web via Connect-Web
│       ├── grpc-native-client.ts # Native gRPC via Node sidecar
│       ├── sdk-client.ts         # SDK protocol client
│       ├── sdk-parser.ts         # TypeScript definition parser
│       ├── proto-parser.ts       # Proto file parser
│       ├── package-loader.ts     # Package loading and discovery
│       ├── package-manager.ts    # npm package operations
│       ├── proxy-fetch.ts        # Rust HTTP proxy bridge
│       └── utils.ts              # Shared utilities
├── src-tauri/                    # Backend (Rust)
│   ├── src/lib.rs                # Tauri commands and plugin registration
│   ├── Cargo.toml                # Rust dependencies
│   ├── tauri.conf.json           # App config, bundle, updater settings
│   ├── capabilities/default.json # Permissions (shell, store, updater, process)
│   └── icons/                    # App icons (.icns, .ico, .png)
├── public/                       # Static assets
├── .github/workflows/build.yml   # CI/CD pipeline
├── .pengvi.config.json           # Default environments and packages
├── package.json                  # Node dependencies
├── vite.config.ts                # Vite configuration
└── tsconfig.json                 # TypeScript configuration
```

---

## Getting Started

### Prerequisites

- **Node.js** >= 22
- **pnpm** >= 9
- **Rust** (stable toolchain)
- **macOS** (aarch64 or x86_64)

### Development

```bash
# Install frontend dependencies
pnpm install

# Run in development mode (Vite + Tauri)
pnpm tauri dev
```

This starts the Vite dev server on `http://localhost:1420` and opens the Tauri window.

### Build

```bash
# Production build (creates .app and .dmg)
pnpm tauri build
```

Build artifacts are output to `src-tauri/target/release/bundle/`:
- `dmg/Penguin_x.x.x_aarch64.dmg` or `Penguin_x.x.x_x64.dmg`
- `macos/Penguin.app.tar.gz` (for auto-updater)
- `macos/Penguin.app.tar.gz.sig` (signature for update verification)

---

## Architecture

### Request Flow

```
User selects Package → Service → Method
         │
         ├─ gRPC-Web ──→ Connect-Web ──→ Rust HTTP Proxy ──→ gRPC-Web Server
         │
         ├─ gRPC ──────→ Node.js Sidecar (shell:spawn) ──→ gRPC Server
         │
         └─ SDK ───────→ JS Bundle (eval) ──→ Connect-Web ──→ Server
```

### Rust Backend Commands

| Command | Description |
|---|---|
| `ensure_packages_dir` | Creates `~/.pengvi/{protocol}/` with `package.json` |
| `get_packages_dir` | Returns the packages directory path |
| `list_installed_packages` | Discovers installed `@snsoft/*` packages, proto files, and TS definitions |
| `read_config` | Loads `.pengvi.config.json` from multiple fallback locations |
| `http_proxy` | Proxies HTTP requests through Rust (bypasses browser CORS) |
| `read_package_bundle` | Reads the JS bundle file for SDK packages |
| `clear_all_packages` | Removes all installed packages and resets `package.json` |

### State Management

Zustand store with localStorage persistence:

- **Tabs** — Multiple request tabs with independent protocol, URL, body, metadata, and response
- **Packages** — Per-protocol installed package lists with service/method trees
- **Environments** — Per-protocol environment variable sets with active selection
- **History** — Request/response log with configurable size limit
- **Saved Requests** — Named request snapshots for quick reuse
- **Default Headers** — Per-protocol header templates applied to all requests
- **UI State** — Theme, user name, tutorial progress, dialog visibility

---

## Deployment & Releases

### Overview

The app uses **GitHub Actions** to build macOS installers and **GitHub Releases** to distribute them. The Tauri updater plugin checks for new versions and updates the app in-place.

### How to Create a New Release

**Step 1: Bump the version**

Edit `src-tauri/tauri.conf.json`:

```json
"version": "1.3.0"
```

**Step 2: Commit and push**

```bash
git add -A
git commit -m "release: v1.3.0"
git push origin main
```

**Step 3: Tag and push**

```bash
git tag v1.3.0
git push origin v1.3.0
```

Pushing the tag triggers the CI workflow automatically.

**Step 4: Wait for the build**

Monitor progress at: https://github.com/shiengng12345/penguin/actions

The build takes approximately 10 minutes.

**Step 5: Publish the release**

Go to https://github.com/shiengng12345/penguin/releases, review the draft release, and click **Publish release**.

Once published, users running older versions will see the update in **Settings > App Updates**.

### CI/CD Pipeline

The workflow (`.github/workflows/build.yml`) runs two jobs:

**Build Job** (runs in parallel for each architecture):
1. Checks out the repo
2. Sets up pnpm 9, Node.js 22, and Rust stable
3. Installs frontend dependencies (`pnpm install --frozen-lockfile`)
4. Copies `.pengvi.config.json` to `~/.pengvi/config.json`
5. Builds the Tauri app with code signing (`TAURI_SIGNING_PRIVATE_KEY`)
6. Renames updater artifacts with arch suffix (e.g., `Penguin_aarch64.app.tar.gz`)
7. Uploads DMG, `.app.tar.gz`, and `.sig` as GitHub Actions artifacts

**Release Job** (runs after both builds complete):
1. Downloads all build artifacts
2. Generates `latest.json` with version, download URLs, and signatures for both architectures
3. Creates a draft GitHub Release with all files attached

### Auto-Update Flow

```
App starts → User clicks "Check for Updates" in Settings
    │
    ├─ Fetches latest.json from GitHub Releases
    │   └─ https://github.com/shiengng12345/penguin/releases/latest/download/latest.json
    │
    ├─ Compares version in latest.json with current app version
    │
    ├─ If newer → Shows "New version available" with Download button
    │   └─ Downloads .app.tar.gz, verifies signature, installs
    │
    └─ Shows "Restart" button → Relaunches the app with new version
```

### GitHub Secrets Required

| Secret | Description |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | Minisign private key for signing update artifacts |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password for the signing key |

### Release Assets

Each release contains:
- `Penguin_x.x.x_aarch64.dmg` — macOS Apple Silicon installer
- `Penguin_x.x.x_x64.dmg` — macOS Intel installer
- `Penguin_aarch64.app.tar.gz` — Apple Silicon updater bundle
- `Penguin_x86_64.app.tar.gz` — Intel updater bundle
- `*.app.tar.gz.sig` — Signatures for update verification
- `latest.json` — Update manifest for the Tauri updater

---

## Configuration

### `.pengvi.config.json`

The app reads its configuration from `.pengvi.config.json`, searched in this order:
1. `~/.pengvi/config.json`
2. Tauri resource directory
3. Current working directory
4. Executable directory
5. App bundle resources

The config defines default environments and packages per protocol:

```json
{
  "environments": {
    "grpc-web": [
      {
        "name": "LOCAL",
        "variables": [
          { "key": "URL", "value": "http://localhost:8080" },
          { "key": "TOKEN", "value": "" }
        ]
      }
    ]
  },
  "packages": {
    "grpc-web": ["@snsoft/player-grpc-web"],
    "grpc": ["@snsoft/player-grpc"],
    "sdk": ["@snsoft/player-js-sdk"]
  }
}
```

### Tauri Permissions

The app requests the following capabilities:
- **core:default** — Standard Tauri APIs
- **shell:allow-execute / shell:allow-spawn** — Run `npm`, `node`, `/bin/zsh`
- **shell:allow-open** — Open URLs in browser
- **store:default** — Persistent key-value storage
- **updater:default** — Check and install updates
- **process:allow-restart** — Restart app after update

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd + Enter` | Send request |
| `Cmd + N` | New tab |
| `Cmd + W` | Close tab |
| `Cmd + R` | Reset tab |
| `Cmd + F` | Command search |
| `Cmd + S` | Open package installer |
| `Cmd + Shift + S` | Save request |
| `Cmd + E` | Cycle protocol (gRPC-Web → gRPC → SDK) |
| `Cmd + H` | History |
| `Cmd + O` | Saved requests |
| `Cmd + D` | Request documentation |
| `Cmd + /` | Shortcut cheat sheet |
| `Cmd + I` | Network check |
| `Cmd + Shift + I` | cURL import |
| `Cmd + ,` | Settings |
