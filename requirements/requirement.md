# Pengvi -- Product Requirements / 产品需求文档

## Overview / 概述

**Pengvi** is a Tauri 2 desktop application for calling gRPC and gRPC-Web APIs, similar to Postman but purpose-built for Protocol Buffers.

**Pengvi** 是一个基于 Tauri 2 的桌面应用，用于调用 gRPC 和 gRPC-Web API，类似 Postman，但专为 Protocol Buffers 设计。

---

## Tech Stack / 技术栈

| Component / 组件 | Technology / 技术 |
|---|---|
| Runtime / 运行时 | Tauri 2 (Rust backend +webview frontend / Rust 后端 +webview 前端) |
| Frontend / 前端 | React 19, TypeScript, Vite, shadcn/ui, Tailwind CSS v4 |
| Proto Parsing / Proto 解析 | protobufjs (dynamic runtime parsing / 动态运行时解析) |
| gRPC-Web | @connectrpc/connect-web (browser transport / 浏览器传输层) |
| gRPC Native / 原生 gRPC | @connectrpc/connect-node via Node.js sidecar (HTTP/2) |
| Persistence / 持久化 | tauri-plugin-store |
| Package Manager / 包管理器 | pnpm |

---

## Core Features / 核心功能

### 1. Package Management / 包管理

- Users install npm packages directly in the app (e.g., `@snsoft/player-grpc@1.0.0-20260306172848`)
- 用户直接在应用内安装 npm 包（例如 `@snsoft/player-grpc@1.0.0-20260306172848`）

- Packages are installed to an isolated directory (`~/.pengvi/packages/`)
- 包安装到隔离目录（`~/.pengvi/packages/`）

- Support multiple packages simultaneously
- 支持同时管理多个包

- Update or remove packages from the UI
- 可在界面上更新或删除包

- No pre-installation required -- the app handles everything
- 无需预安装任何东西，应用自行处理所有依赖

### 2. Proto Discovery & Service Explorer / Proto 发现与服务浏览

- After package installation, scan `dist/protos/*.proto` for proto files
- 安装包后，扫描 `dist/protos/*.proto` 查找 proto 文件

- Dynamically parse proto files at runtime using protobufjs
- 使用 protobufjs 在运行时动态解析 proto 文件

- Display a tree view: Package > Service > Method
- 以树形视图展示：包 > 服务 > 方法

- Extract request/response message schemas and generate empty JSON templates
- 提取请求/响应消息结构，并生成空白 JSON 模板

### 3. Protocol Tabs / 协议选项卡

Two tabs for different transport protocols:
两个选项卡对应不同传输协议：

| Tab / 选项卡 | Transport / 传输方式 | Description / 描述 |
|---|---|---|
| gRPC-Web | `@connectrpc/connect-web` | Browser context, HTTP/1.1 / 浏览器上下文，HTTP/1.1 |
| gRPC | `@connectrpc/connect-node` (sidecar) | Native HTTP/2, bidirectional streaming / 原生 HTTP/2，双向流 |

### 4. Environment Management / 环境管理

- Create/edit/delete named environments (e.g., LOCAL, QAT1, UAT, PROD)
- 创建/编辑/删除命名环境（例如 LOCAL、QAT1、UAT、PROD）

- Each environment stores key-value variables (e.g., `URL = localhost:50051`)
- 每个环境存储键值对变量（例如 `URL = localhost:50051`）

- Variable interpolation using `{{ VARIABLE }}` syntax in URLs, metadata, and request bodies
- 在 URL、元数据和请求体中使用 `{{ VARIABLE }}` 语法进行变量插值

- Quick-switch between environments via a dropdown selector
- 通过下拉菜单快速切换环境

### 5. Request/Response Interface / 请求/响应界面

- **Request Panel / 请求面板**: target URL (with env interpolation), metadata headers, JSON body editor
- **请求面板**：目标 URL（支持环境变量插值）、元数据头、JSON 请求体编辑器

- **Response Panel / 响应面板**: status code, formatted JSON response body, timing, response headers
- **响应面板**：状态码、格式化 JSON 响应体、耗时、响应头

---

## Package Structure (Reference) / 包结构（参考）

Packages like `@snsoft/player-grpc` contain:
`@snsoft/player-grpc` 等包包含以下结构：

```
dist/
  protos/            # .proto source files / .proto 源文件 (27 files)
    player.proto
    common.proto
    frontend-player.proto
    ...
  bundle.esm.js      # Pre-compiled ConnectRPC service definitions / 预编译的 ConnectRPC 服务定义
  bundle.cjs
  index.d.ts          # TypeScript type exports / TypeScript 类型导出
  getProtoPath.d.ts   # Helper to locate proto directory / 定位 proto 目录的辅助函数
```

Dependencies / 依赖: `@bufbuild/protobuf`, `@connectrpc/connect`, `@connectrpc/connect-web`

---

## Architecture / 架构

```
┌─────────────────────────────────────────────────────────┐
│  Tauri App                                              │
│                                                         │
│  ┌─────────────────────────────────────────────┐        │
│  │  React Frontend / React 前端                 │        │
│  │  - shadcn/ui Interface / 界面                │        │
│  │  - Proto Parser / Proto 解析器               │        │
│  │  - Environment Manager / 环境管理器          │        │
│  │  - Request Builder / 请求构建器              │        │
│  │                                              │        │
│  │  gRPC-Web tab → @connectrpc/connect-web      │        │
│  └──────────────────────┬───────────────────────┘        │
│                         │ IPC                            │
│  ┌──────────────────────┴───────────────────────┐        │
│  │  Rust Backend / Rust 后端                     │        │
│  │  - File System Access / 文件系统访问          │        │
│  │  - Config Store / 配置存储                    │        │
│  └──────────────────────┬───────────────────────┘        │
│                         │ sidecar                        │
│  ┌──────────────────────┴───────────────────────┐        │
│  │  Node.js Sidecar / Node.js 侧车进程          │        │
│  │  - gRPC Client / gRPC 客户端                  │        │
│  │    (@connectrpc/connect-node, HTTP/2)         │        │
│  │  - Package Installer / 包安装器               │        │
│  │    (npm install in ~/.pengvi/packages/)        │        │
│  └───────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

---

## Scope / 范围

| Phase / 阶段 | Features / 功能 |
|---|---|
| **Phase 1 (Current / 当前)** | gRPC and gRPC-Web support / gRPC 和 gRPC-Web 支持 |
| **Phase 2 (Future / 未来)** | REST API, GraphQL, WebSocket support / REST API、GraphQL、WebSocket 支持 |
