# Penguin — gRPC & SDK Desktop Client

# Penguin — gRPC 与 SDK 桌面客户端

---

## 1. Product Overview / 产品概述

**Penguin** is a cross-platform desktop application for testing and debugging **gRPC**, **gRPC-Web**, and **SDK** APIs. Think of it as a Postman-like client purpose-built for protobuf-based services and JavaScript SDK functions.

**Penguin** 是一个跨平台桌面应用，用于测试和调试 **gRPC**、**gRPC-Web** 和 **SDK** API。可以把它理解为专为 protobuf 服务和 JavaScript SDK 函数打造的类 Postman 客户端。

### Key Features / 核心功能

| Feature / 功能 | Description / 描述 |
|---|---|
| **Three Protocol Tabs** / 三协议切换 | gRPC-Web, gRPC (native), SDK — switch with `Cmd+E` / 用 `Cmd+E` 切换 |
| **Dynamic Package Install** / 动态包安装 | Install `@snsoft/*` npm packages directly in-app / 在应用内直接安装 npm 包 |
| **Proto File Discovery** / Proto 文件发现 | Auto-discovers `.proto` files and ConnectRPC definitions from installed packages / 自动发现已安装包中的 proto 和 ConnectRPC 定义 |
| **SDK Function Discovery** / SDK 函数发现 | Parses `.d.ts` files from `@snsoft/js-sdk` to discover service methods / 解析 `.d.ts` 文件以发现 SDK 服务方法 |
| **Multi-Environment** / 多环境管理 | Per-protocol environments with variable interpolation (`{{URL}}`, `{{TOKEN}}`) / 每个协议独立环境，支持变量插值 |
| **Preset Config** / 预设配置 | `.pengvi.config.json` presets environments and packages per protocol / 通过配置文件预设各协议的环境和包 |
| **Fuzzy Search** / 模糊搜索 | `Cmd+F` global search with fuzzy matching and wildcard (`*`) support / 全局模糊搜索，支持通配符 |
| **Multi-Tab** / 多标签页 | Multiple request tabs with independent state / 多标签页，每个标签独立状态 |
| **Multi-Theme** / 多主题 | 10+ themes including dark, light, and colorful options / 10+ 主题选择 |
| **Live Clock** / 实时时钟 | 12-hour format clock with lunch-time penguin reminder at 12:30 PM / 12 小时制时钟，12:30 午餐提醒 |
| **Personalized Greetings** / 个性化问候 | Dynamic hourly greetings with Malaysian Chinese flavor / 每小时轮换的个性化问候语 |

---

## 2. Tech Stack / 技术栈

### Frontend / 前端

| Technology / 技术 | Purpose / 用途 |
|---|---|
| **React 19** | UI framework / UI 框架 |
| **TypeScript 5** | Type-safe development / 类型安全开发 |
| **Vite 6** | Build tool & dev server / 构建工具和开发服务器 |
| **Tailwind CSS v4** | Utility-first styling / 工具类优先的 CSS 框架 |
| **shadcn/ui** | Component library (customized) / 组件库（自定义） |
| **Zustand 5** | Global state management / 全局状态管理 |
| **protobufjs 7** | Dynamic proto file parsing / 动态 proto 文件解析 |
| **@connectrpc/connect** | gRPC-Web client / gRPC-Web 客户端 |
| **Lucide React** | Icon library / 图标库 |

### Backend / 后端

| Technology / 技术 | Purpose / 用途 |
|---|---|
| **Tauri 2** | Desktop app framework (Rust core) / 桌面应用框架（Rust 核心） |
| **Rust** | Native backend: file I/O, HTTP proxy, package management / 原生后端 |
| **reqwest** | HTTP proxy for gRPC-Web calls / gRPC-Web 的 HTTP 代理 |
| **tauri-plugin-shell** | Spawn npm/node processes / 生成 npm/node 子进程 |
| **tauri-plugin-store** | Persistent key-value storage / 持久化键值存储 |
| **Node.js (sidecar)** | Runtime for native gRPC and SDK calls / 原生 gRPC 和 SDK 调用的运行时 |
| **@grpc/grpc-js** | Native gRPC client (auto-installed) / 原生 gRPC 客户端（自动安装） |
| **@grpc/proto-loader** | Proto file loader for native gRPC / 原生 gRPC 的 proto 文件加载器 |

### Build & Deploy / 构建与部署

| Technology / 技术 | Purpose / 用途 |
|---|---|
| **pnpm** | Package manager / 包管理器 |
| **GitHub Actions** | CI/CD for multi-platform builds / 多平台构建 CI/CD |

---

## 3. Prerequisites / 前置要求

- **Node.js** >= 18 (recommend using nvm)
- **pnpm** >= 9
- **Rust** (install via [rustup.rs](https://rustup.rs))
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Windows**: Visual Studio C++ Build Tools

---

## 4. Getting Started / 快速开始

### Install Dependencies / 安装依赖

```bash
pnpm install
```

### Development Mode / 开发模式

```bash
pnpm tauri dev
```

This starts the Vite dev server on `http://localhost:1420` and launches the Tauri window with hot reload.

这会在 `http://localhost:1420` 启动 Vite 开发服务器，并打开带有热重载的 Tauri 窗口。

### Build for Production / 生产构建

```bash
pnpm tauri build
```

Output location / 输出位置:
- **macOS**: `src-tauri/target/release/bundle/dmg/` (`.dmg`) and `macos/` (`.app`)
- **Windows**: `src-tauri/target/release/bundle/msi/` (`.msi`) and `nsis/` (`.exe`)

---

## 5. How to Use / 使用说明

### 5.1 First Launch / 首次启动

1. The **Welcome Page** appears asking for your name / 欢迎页面会要求输入名字
2. Enter your name and click **Get Started** / 输入名字并点击开始
3. Your name is used for personalized greetings / 名字用于个性化问候

### 5.2 Installing Packages / 安装包

1. Press `Cmd+S` or click the **+** button in the sidebar / 按 `Cmd+S` 或点击侧边栏 **+** 按钮
2. Enter the full package spec / 输入完整的包规格:
   - gRPC-Web: `@snsoft/player-grpc-web@1.0.0-20260308022108`
   - gRPC: `@snsoft/player-grpc@1.0.0-20260308022108`
   - SDK: `@snsoft/js-sdk@1.0.0-2026-03-05T06-26-26-341Z`
3. Press **Enter** or click **Install** / 按回车或点击安装
4. The protocol is auto-detected from the package name / 协议从包名自动检测

### 5.3 Making API Calls / 发起 API 调用

1. **Select an environment** from the dropdown in the header / 从头部下拉选择环境
2. **Expand a package** in the sidebar → click a **service** → click a **method** / 展开包 → 点击服务 → 点击方法
3. The URL auto-fills with `{{URL}}` (resolved from environment) / URL 自动填充为 `{{URL}}`（从环境变量解析）
4. The request body auto-populates with default JSON from the proto definition / 请求体自动填充 proto 定义的默认 JSON
5. Edit headers and body as needed / 根据需要编辑请求头和请求体
6. Press `Cmd+Enter` or click **Send** / 按 `Cmd+Enter` 或点击发送
7. Response appears in the right panel with status, duration, headers, and body / 响应在右侧面板显示

### 5.4 Environment Variables / 环境变量

Environments support variable interpolation using `{{VARIABLE_NAME}}` syntax:

环境支持使用 `{{变量名}}` 语法进行变量插值：

- `{{URL}}` → resolves to the environment's URL value / 解析为环境的 URL 值
- `{{TOKEN}}` → resolves to the environment's TOKEN value / 解析为环境的 TOKEN 值

You can use variables in the URL bar, request headers, and request body.

可以在 URL 栏、请求头和请求体中使用变量。

### 5.5 Protocol Switching / 协议切换

- Press `Cmd+E` to cycle through **gRPC-Web → gRPC → SDK** / 按 `Cmd+E` 循环切换协议
- If the current method exists in the target protocol, it auto-selects it / 如果当前方法在目标协议中存在，会自动选中

### 5.6 Search / 搜索

- Press `Cmd+F` to open the global search / 按 `Cmd+F` 打开全局搜索
- **Fuzzy matching**: type partial text like `getPlayerFrieLi` to find `GetPlayerFriendList` / 模糊匹配：输入部分文字即可搜索
- **Wildcard**: use `*` for glob patterns like `Get*Friend*` / 通配符：使用 `*` 进行模式匹配
- Press **Tab** to cycle protocol filters (All / gRPC-Web / gRPC / SDK) / 按 Tab 切换协议过滤
- Press **Enter** to select and auto-navigate to the method in the sidebar / 按回车选择并自动定位到侧边栏

### 5.7 Settings / 设置

Click the **gear icon** (⚙) in the header to open Settings:

点击头部的齿轮图标打开设置：

- **Clear Cache / 清除缓存**: Wipes all installed packages, localStorage, and restarts the app (shows welcome page) / 清除所有包、本地存储并重启应用
- **Manage Environments / 管理环境**: Add, edit, or delete environments and their variables / 添加、编辑或删除环境及其变量

---

## 6. Keyboard Shortcuts / 快捷键

| Shortcut / 快捷键 | Action / 操作 |
|---|---|
| `Cmd+Enter` | Send request / 发送请求 |
| `Cmd+F` | Open global search / 打开全局搜索 |
| `Cmd+N` | New tab / 新建标签页 |
| `Cmd+W` | Close tab (reset if last tab) / 关闭标签页（最后一个则重置） |
| `Cmd+R` | Refresh packages & reset current tab / 刷新包并重置当前标签 |
| `Cmd+S` | Open package installer / 打开包安装器 |
| `Cmd+E` | Cycle protocol (gRPC-Web → gRPC → SDK) / 切换协议 |

> On Windows, use `Ctrl` instead of `Cmd`.
>
> Windows 上使用 `Ctrl` 代替 `Cmd`。

---

## 7. Configuration File / 配置文件

### `.pengvi.config.json`

This file lives in the project root and presets environments and auto-install packages per protocol. It is the **source of truth** for environments — changes here are reflected on app startup.

此文件位于项目根目录，用于预设各协议的环境和自动安装包。它是环境的**唯一数据源** — 修改后在应用启动时生效。

### Structure / 结构

```json
{
  "grpc": {
    "environments": [
      {
        "name": "player-local",
        "color": "blue",
        "variables": {
          "URL": "http://0.0.0.0:5000",
          "TOKEN": ""
        }
      }
    ],
    "packages": []
  },
  "grpc-web": {
    "environments": [
      {
        "name": "QAT1",
        "color": "blue",
        "variables": {
          "URL": "https://fpms-nt.platform88.me",
          "TOKEN": ""
        }
      }
    ],
    "packages": []
  },
  "sdk": {
    "environments": [
      {
        "name": "UAT-STABLE",
        "color": "purple",
        "variables": {
          "URL": "https://fpms-nt-st.platform99.me",
          "TOKEN": ""
        }
      }
    ],
    "packages": []
  }
}
```

### Fields / 字段说明

| Field / 字段 | Type / 类型 | Description / 描述 |
|---|---|---|
| `environments` | Array | List of environment presets / 环境预设列表 |
| `environments[].name` | String | Display name / 显示名称 |
| `environments[].color` | String | Color indicator: `green`, `blue`, `amber`, `purple`, `red` / 颜色标识 |
| `environments[].variables` | Object | Key-value pairs for `{{VAR}}` interpolation / 用于变量插值的键值对 |
| `packages` | Array | Package specs to auto-install on first launch / 首次启动时自动安装的包 |

### Config Lookup Order / 配置查找顺序

The app searches for the config file in this order / 应用按以下顺序查找配置文件:

1. `~/.pengvi/config.json` (user-level / 用户级别)
2. Bundled resource (inside `.app` / 内置资源)
3. Current working directory / 当前工作目录
4. `http://localhost:1420/.pengvi.config.json` (dev server fallback / 开发服务器回退)

---

## 8. Architecture / 架构

### Directory Structure / 目录结构

```
Pengvi/
├── .pengvi.config.json          # Environment & package presets / 环境与包预设
├── public/
│   └── penguin.png              # App logo / 应用 Logo
├── src/
│   ├── App.tsx                  # Main app layout & keyboard shortcuts / 主布局和快捷键
│   ├── main.tsx                 # Entry point: version check, cache clear / 入口点
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.tsx       # Header: greeting, clock, env selector, theme / 头部
│   │   │   ├── Sidebar.tsx      # Package/service/method tree view / 侧边栏树状视图
│   │   │   ├── TabBar.tsx       # Multi-tab management / 多标签管理
│   │   │   └── UrlBar.tsx       # URL input with variable resolution / URL 输入栏
│   │   ├── request/
│   │   │   ├── RequestPanel.tsx # Headers + body editor, send logic / 请求编辑器
│   │   │   └── ResponsePanel.tsx# Response viewer / 响应查看器
│   │   ├── packages/
│   │   │   └── PackageInstaller.tsx # Package install dialog / 包安装对话框
│   │   ├── environment/
│   │   │   └── EnvManager.tsx   # Environment CRUD dialog / 环境管理对话框
│   │   ├── settings/
│   │   │   └── SettingsDialog.tsx# Settings: clear cache, env manager / 设置
│   │   ├── search/
│   │   │   └── CommandSearch.tsx # Global fuzzy search (Cmd+F) / 全局模糊搜索
│   │   └── onboarding/
│   │       ├── Welcome.tsx      # First-launch username prompt / 首次启动用户名输入
│   │       └── Tutorial.tsx     # Onboarding tutorial / 新手教程
│   ├── hooks/
│   │   ├── useEnvironments.ts   # Per-protocol environment state / 每协议环境状态
│   │   ├── usePackages.ts       # Package install/uninstall/list / 包管理
│   │   ├── useGreeting.ts       # Hourly rotating greetings / 每小时轮换问候
│   │   └── useClock.ts          # Live 12h clock + lunch reminder / 时钟和午餐提醒
│   └── lib/
│       ├── store.ts             # Zustand global store / 全局状态
│       ├── grpc-web-client.ts   # gRPC-Web call logic / gRPC-Web 调用逻辑
│       ├── grpc-native-client.ts# Native gRPC via Node.js sidecar / 原生 gRPC
│       ├── sdk-client.ts        # SDK call via Node.js sidecar / SDK 调用
│       ├── package-manager.ts   # npm install/uninstall wrapper / npm 安装卸载封装
│       ├── proto-parser.ts      # Proto file → service/method parser / Proto 解析
│       ├── sdk-parser.ts        # .d.ts → SDK method parser / SDK 方法解析
│       ├── environment-store.ts # Variable interpolation logic / 变量插值逻辑
│       └── utils.ts             # Utility functions (cn, etc.) / 工具函数
├── src-tauri/
│   ├── src/lib.rs               # Rust backend: commands, HTTP proxy / Rust 后端
│   ├── tauri.conf.json          # Tauri config: window, bundle, icons / Tauri 配置
│   ├── capabilities/default.json# Shell permissions for npm/node / Shell 权限
│   └── icons/                   # App icons (icns, ico, png) / 应用图标
└── .github/
    └── workflows/build.yml      # CI: build macOS + Windows / CI 构建
```

### Protocol Flow / 协议流程

#### gRPC-Web

```
Browser → RequestPanel → grpc-web-client.ts → ConnectRPC → Rust HTTP Proxy → gRPC-Web Server
```

- Uses `@connectrpc/connect-web` with protobufjs for serialization
- Rust backend proxies HTTP requests to bypass CORS
- Response: strips `_`-prefixed protobuf internal keys

#### gRPC (Native)

```
Browser → RequestPanel → grpc-native-client.ts → zsh → Node.js sidecar → @grpc/grpc-js → gRPC Server
```

- Node.js sidecar script is base64-encoded and piped to `node -`
- Auto-installs `@grpc/grpc-js` and `@grpc/proto-loader` on first call
- Proto files discovered from installed `@snsoft/*` packages

#### SDK

```
Browser → RequestPanel → sdk-client.ts → zsh → Node.js sidecar → @snsoft/js-sdk → HTTP API
```

- Discovers service classes from `.d.ts` files
- Node.js sidecar initializes SDK with `GlobalConfig.init()` and fetch interceptor
- Environment detection from URL pattern (QAT/UAT/production)

### Package Storage / 包存储

All packages are installed to `~/.pengvi/` with separate directories per protocol:

所有包安装在 `~/.pengvi/` 下，按协议分目录：

```
~/.pengvi/
├── grpc-web/
│   ├── package.json
│   ├── .npmrc              # Auto-copied from ~/.npmrc / 自动从 ~/.npmrc 复制
│   └── node_modules/
├── grpc/
│   ├── package.json
│   ├── .npmrc
│   └── node_modules/
└── sdk/
    ├── package.json
    ├── .npmrc
    └── node_modules/
```

---

## 9. Build & Release / 构建与发布

### Local Build / 本地构建

```bash
pnpm tauri build
```

### CI/CD (GitHub Actions)

Tag a release to trigger automated builds / 打标签触发自动构建:

```bash
git tag v1.0.0
git push --tags
```

This builds for:
- macOS ARM (Apple Silicon) — `.dmg`
- macOS Intel (x86_64) — `.dmg`
- Windows — `.exe` / `.msi`

A draft GitHub Release is created with all installers attached.

---

## 10. Version Management / 版本管理

When the app version changes (in `package.json`), the first launch will:

当应用版本变更时（在 `package.json` 中），首次启动会：

1. Clear all installed packages / 清除所有已安装的包
2. Preserve username, theme, and environment selections / 保留用户名、主题和环境选择
3. Re-sync environments from `.pengvi.config.json` / 从配置文件重新同步环境

To force a full reset, use **Settings → Clear Cache** which wipes everything and restarts.

要强制完全重置，使用 **设置 → 清除缓存**，会清除所有数据并重启。

---

## 11. Troubleshooting / 常见问题

| Issue / 问题 | Solution / 解决方案 |
|---|---|
| Package install hangs / 包安装卡住 | Check `~/.npmrc` has correct registry config / 检查 `.npmrc` 是否配置了正确的仓库 |
| "No such file or directory" on gRPC call / gRPC 调用报文件未找到 | `@grpc/grpc-js` auto-installs on first call; ensure Node.js is available / 首次调用会自动安装，确保 Node.js 可用 |
| Port 1420 already in use / 端口 1420 被占用 | Run `lsof -ti :1420 \| xargs kill -9` / 执行该命令释放端口 |
| Environments not loading / 环境未加载 | Check `.pengvi.config.json` exists and is valid JSON / 检查配置文件是否存在且为有效 JSON |
| Built app can't find npm / 构建后的应用找不到 npm | Ensure Node.js/npm is in your shell PATH (nvm users: check `~/.zshrc`) / 确保 npm 在 PATH 中 |
| `_cloudflareEnabled` in response / 响应中有下划线字段 | Auto-stripped; if persisting, try `Cmd+R` to refresh / 自动剔除；如仍存在，按 `Cmd+R` 刷新 |
