# Pengvi — Product & Technical Overview
# Pengvi — 产品与技术概览

> Version 1.4.2 · macOS · MIT License

---

## What Is It? / 这是什么？

Pengvi (product name: **Penguin**) is a desktop API client for testing **gRPC**, **gRPC-Web**, and **JavaScript SDK** services. It's purpose-built for teams that work with Protocol Buffers and `@snsoft/*` npm packages — think Postman, but for gRPC-first microservices with built-in package management and environment switching.

Pengvi（产品名：**Penguin**）是一款专为测试 **gRPC**、**gRPC-Web** 和 **JavaScript SDK** 服务而设计的桌面 API 客户端。专为使用 Protocol Buffers 和 `@snsoft/*` npm 包的团队打造——可以理解为面向 gRPC 优先微服务的 Postman，内置包管理和环境切换功能。

---

## Tech Stack / 技术栈

| Layer / 层级 | Technology / 技术 |
|---|---|
| UI | React 19, TypeScript 5.7, Tailwind CSS 4, CodeMirror 6 |
| State / 状态管理 | Zustand 5（持久化至 localStorage） |
| gRPC-Web | @connectrpc/connect-web 1.5 + protobufjs 7 |
| gRPC Native / 原生 gRPC | Node.js sidecar via Tauri shell（HTTP/2，支持双向流） |
| SDK | Node.js sidecar + 动态 `.d.ts` 解析 |
| Desktop / 桌面框架 | Tauri 2（Rust + webview） |
| Rust 依赖 | reqwest（HTTP 代理）、tokio、serde、glob、dirs |
| Build / 构建 | Vite 6, pnpm 9, GitHub Actions |
| Platforms / 平台 | macOS（aarch64 + x86_64） |

---

## Key Features / 核心功能

### Multi-Protocol Support / 多协议支持
- **gRPC-Web** — 通过 ConnectRPC，经 Rust 后端代理（解决 CORS 问题）
- **gRPC Native / 原生 gRPC** — 经 Node.js sidecar 实现全 HTTP/2，支持流式传输
- **SDK** — 经 Node.js sidecar 进行 TypeScript SDK 测试，动态发现 `.d.ts`
- `Cmd+E` 可循环切换协议，自动匹配跨协议的对应方法

### Package Management / 包管理
- 直接在应用内安装 `@snsoft/*` npm 包
- 自动发现 `.proto` 文件和 TypeScript 类型定义
- 包存储路径：`~/.pengvi/{grpc-web,grpc,sdk}/`
- 侧边栏服务与方法树形浏览器
- 可在 UI 中更新或删除包

### Environment Management / 环境管理
- 每个协议独立配置环境（LOCAL、DEV、QAT1-6、UAT1-3、STAGING、PROD 等）
- 在 URL、请求头、请求体中使用 `{{VAR}}` 语法插值
- 每个环境配有独立颜色标识，便于快速识别
- 支持通过 `.pengvi.config.json` 或应用内 UI 配置

### Request Builder / 请求构建器
- CodeMirror JSON 编辑器（语法高亮、lint 检查、自动补全）
- 根据 proto 定义自动生成请求体模板
- 多标签页，每个标签页独立状态
- 每个协议独立管理元数据/请求头
- 一键复制为 cURL

### History & Saved Requests / 历史记录与保存请求
- 完整请求/响应历史（状态码、响应体、请求头、耗时、时间戳）
- 历史记录条数可配置（100–1000 条）
- 保存、命名、快速重新加载常用请求
- 支持导出/导入全部数据（环境、保存请求、历史、默认请求头）

### Desktop Experience / 桌面体验
- 10+ 主题（Dark、Light、Nord、Emerald、Rose、Violet 等）
- 20+ 键盘快捷键
- `Cmd+F` 命令面板，支持跨所有方法的模糊搜索
- `Cmd+Shift+I` 导入 cURL 命令
- `Cmd+D` 请求文档（proto schema 详情）
- 交互式新手引导教程
- 双语 UI（英文 + 简体中文）
- 基于 GitHub Releases 的应用内自动更新
- 基于时间的个性化问候语，午餐时间企鹅提醒（12:30）

---

## App Layout / 应用布局

```
┌────────────────────────────────────────────────────────────────┐
│  Header 顶栏：问候语 · 时钟 · 环境选择 · 设置 · 主题          │
├──────────┬────────────────────────┬───────────────────────────┤
│          │  REQUEST PANEL 请求面板 │  RESPONSE PANEL 响应面板  │
│ Sidebar  │  URL 栏                │  状态码                   │
│ 侧边栏   │  元数据/请求头          │  响应头                   │
│（服务树）│  请求体编辑器           │  JSON 响应体（格式化）     │
│          │  发送按钮              │  耗时 · 大小               │
├──────────┴────────────────────────┴───────────────────────────┤
│  Tab Bar 标签栏（多标签页，支持重排序和关闭）                   │
└────────────────────────────────────────────────────────────────┘
```

**弹窗/面板列表：** 包安装器 · 环境管理器 · 设置 · 命令搜索 · 历史记录 · 保存请求 · 请求文档 · 网络检查 · cURL 导入 · Proto 查看器 · 快捷键速查表 · 交互式教程

---

## Project Structure / 项目结构

```
Pengvi/
├── src/
│   ├── App.tsx                   # 根布局、快捷键、弹窗管理
│   ├── main.tsx                  # 入口、版本检查、缓存清理
│   ├── components/
│   │   ├── environment/          # 环境管理器、cURL 导入
│   │   ├── history/              # 历史记录面板
│   │   ├── layout/               # 顶栏、侧边栏、标签栏、URL 栏
│   │   ├── network/              # 网络检查
│   │   ├── onboarding/           # 欢迎页、教程、交互式引导
│   │   ├── packages/             # 包安装器
│   │   ├── request/              # 请求面板、响应面板、Proto 查看器
│   │   ├── saved/                # 保存请求面板
│   │   ├── search/               # 命令搜索
│   │   ├── settings/             # 设置弹窗
│   │   └── ui/                   # 共享 UI 基础组件
│   ├── hooks/
│   │   ├── useClock.ts           # 12 小时时钟 + 午餐提醒
│   │   ├── useEnvironments.ts    # 环境状态 & 变量插值
│   │   ├── useGreeting.ts        # 基于时间的问候语
│   │   └── usePackages.ts        # 包的安装/卸载/列表
│   └── lib/
│       ├── store.ts              # Zustand 全局状态（持久化）
│       ├── grpc-web-client.ts    # ConnectRPC gRPC-Web 处理器
│       ├── grpc-native-client.ts # Node.js sidecar gRPC 处理器
│       ├── sdk-client.ts         # SDK 协议处理器
│       ├── sdk-parser.ts         # .d.ts 文件解析器
│       ├── proto-parser.ts       # protobufjs proto 文件解析器
│       ├── package-loader.ts     # 包发现
│       ├── package-manager.ts    # npm 安装/卸载（Tauri → Rust）
│       └── proxy-fetch.ts        # Rust HTTP 代理桥接
├── src-tauri/
│   ├── src/lib.rs                # Tauri 命令注册 + 插件注册
│   ├── Cargo.toml                # Rust 依赖
│   ├── tauri.conf.json           # 应用配置，窗口大小（1280×800）
│   └── capabilities/default.json # 权限配置
├── .pengvi.config.json           # 每协议的默认环境 + 包配置
├── enhancement/enhancementv1.md  # 路线图（v2+）
├── requirements/
│   ├── requirement.md            # 产品需求文档（双语）
│   └── DOCUMENTATION.md          # 完整用户文档（双语）
└── docs/                         # 文档网站（下载页、教程、文档）
```

---

## Request Flow / 请求流程

**gRPC-Web：**
```
用户 → RequestPanel → grpc-web-client.ts → @connectrpc/connect-web
     → Rust HTTP 代理 (reqwest) → gRPC-Web 服务器
```

**gRPC Native / 原生 gRPC：**
```
用户 → RequestPanel → grpc-native-client.ts → Tauri shell:spawn
     → Node.js sidecar → @grpc/grpc-js → gRPC 服务器 (HTTP/2)
```

**SDK：**
```
用户 → RequestPanel → sdk-client.ts → Tauri shell:spawn
     → Node.js sidecar → @snsoft/js-sdk (eval) → HTTP API
```

---

## Rust Backend Commands / Rust 后端命令（IPC）

| 命令 | 功能 |
|---|---|
| `ensure_packages_dir` | 创建 `~/.pengvi/{protocol}/package.json` |
| `get_packages_dir` | 返回包目录路径 |
| `list_installed_packages` | 发现已安装的 @snsoft 包、proto 文件、TS 类型 |
| `read_config` | 加载 `.pengvi.config.json` |
| `http_proxy` | 代理 HTTP 请求（CORS 绕过） |
| `read_package_bundle` | 读取 SDK 包的 JS bundle 文件 |
| `clear_all_packages` | 清除所有包并重置 package.json |

---

## Keyboard Shortcuts / 键盘快捷键

| 快捷键 | 功能 |
|---|---|
| `Cmd+Enter` | 发送请求 |
| `Cmd+N` | 新建标签页 |
| `Cmd+W` | 关闭标签页 |
| `Cmd+E` | 切换协议 |
| `Cmd+F` | 命令搜索 |
| `Cmd+S` | 包安装器 |
| `Cmd+Shift+S` | 保存请求 |
| `Cmd+H` | 历史记录面板 |
| `Cmd+O` | 保存请求面板 |
| `Cmd+D` | 请求文档 |
| `Cmd+I` | 网络检查 |
| `Cmd+Shift+I` | 导入 cURL |
| `Cmd+/` | 快捷键速查表 |
| `Cmd+,` | 设置 |
| `Cmd++` / `Cmd+-` | 字体大小调节 |
| `Esc` | 取消请求 / 关闭弹窗 |

---

## Build & Run / 构建与运行

```bash
# 安装依赖
pnpm install

# 开发模式（热重载）
pnpm tauri dev

# 生产构建
pnpm tauri build
# 输出：src-tauri/target/release/bundle/dmg/Penguin_*.dmg

# 更新版本号
node scripts/set-version.mjs
```

---

## Release & CI/CD / 发版与持续集成

1. 修改 `src-tauri/tauri.conf.json` 中的版本号
2. `git commit -m "release: vX.Y.Z"` → `git tag vX.Y.Z` → `git push origin vX.Y.Z`
3. GitHub Actions 自动构建（约 10 分钟），同时构建两种架构
4. 在 GitHub 上发布草稿 Release

**发布产物：**
- `Penguin_x.x.x_aarch64.dmg` — Apple Silicon 安装包
- `Penguin_x.x.x_x64.dmg` — Intel 安装包
- `*.app.tar.gz` + `.sig` — 自动更新包 + 签名
- `latest.json` — 更新清单

**自动更新流程：** 应用启动后在 `Cmd+,` 中检查更新 → 对比版本号 → 下载并验证签名 → 重启应用。

---

## Configuration / 配置文件 (`.pengvi.config.json`)

```json
{
  "grpc": {
    "environments": [
      { "name": "LOCAL", "color": "#22c55e", "variables": { "HOST": "localhost:50051" } }
    ],
    "packages": []
  },
  "grpc-web": { "environments": [...], "packages": [] },
  "sdk": { "environments": [...], "packages": [] }
}
```

加载顺序：`~/.pengvi/config.json` → Tauri 资源目录 → 当前工作目录 → 可执行文件目录。

---

## Roadmap / 路线图 (v2+)

来源：`enhancement/enhancementv1.md`

- 历史记录中保存完整响应体
- 响应体内搜索（`Cmd+G`）
- 批量请求执行器（`Cmd+B`）
- 标签页拖拽排序
- 请求取消（进行中）
- Proto 文件查看器（进行中）
- 大响应体懒渲染（进行中）
- 企鹅加载动画
- Konami 码彩蛋
- 多窗口 / 标签页分离
- 基于角色的预设（QA、后端开发、前端开发）
- 智能粘贴（自动识别 JSON / URL / cURL / player ID）
- 马来西亚节日问候（春节、开斋节、屠妖节、独立日）
