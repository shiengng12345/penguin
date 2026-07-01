# Penguin Runtime — 架构设计文档 / Architecture Design

> 定位 / Positioning: **Penguin 应用内的一个新 workspace 模块**(与 `request`/`rest`/`redis`/`database`/`vault` 并列),而非独立 app。
> 目标 / Goal: 在五年内让开发者**主动选择它而不是 Docker Desktop / OrbStack**——最快、最轻、最native、最愉悦的 macOS 开发者运行时。
> Status: Design v0.1 · macOS (Apple Silicon first) · 2026-06

---

## 0. 设计立场 / Design Stance

这份文档不是把 OrbStack/Docker Desktop 抄一遍,而是从 macOS 的现代能力(Virtualization.framework、VirtioFS、vsock、APFS clone、内存气球)出发反推架构。每个组件都要回答一个问题:**「它为什么必须存在?能不能去掉?」**

四条不可妥协的原则:

1. **Native-first** — 虚拟化用 Apple Virtualization Framework(Vz),不用 QEMU/HVF 自研 hypervisor。
2. **Memory-first** — 单 VM 共享内核 + 内存气球 + 懒启动 + 空闲挂起,目标空闲 RSS < OrbStack。
3. **Invisible** — 用户永远不需要理解 VM / Linux / 网络。`docker run` 之外不需要学任何新概念。
4. **每个进程都要被审判** — 只允许**一个**常驻后台进程(`penguind`),且它是懒加载的。

**与现有 Penguin 的关系**:Runtime 是一个新 workspace。它复用 Penguin 已有的:Tauri 外壳、窗口、`tauri-plugin-updater` 自动更新、`app_kv` SQLite、`SqliteKeychain` 密钥模型、UI 组件库、`CancellationToken` 后台任务范式、`inline_webview` 内嵌 webview。它新增:一个 Rust 后台守护进程、一层 Swift Vz 封装、一个 Linux guest agent。

---

## 1. 高层架构 / High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Penguin GUI (现有 Tauri app, 临时进程 / ephemeral)                     │
│  ┌────────────┬───────────┬───────────┬──────────────────────────┐   │
│  │ gRPC ws    │ REST ws   │ Redis ws  │  ★ Runtime workspace (新)  │   │
│  └────────────┴───────────┴───────────┴──────────────────────────┘   │
│         React 19 ──invoke/event──▶ Tauri Rust 核心(命令薄代理)         │
└───────────────────────────────────│──────────────────────────────────┘
                                     │  UDS (JSON-RPC, framed)
                                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│  penguind  ── 唯一常驻后台 / the only persistent backend (Rust + 内嵌  │
│              Swift libPenguinVZ),懒加载,空闲自退 ★                     │
│  ┌──────────────┬───────────────┬──────────────┬───────────────────┐ │
│  │ Runtime 注册表│ Docker API 服务│ 端口转发+DNS  │ Swift Vz 控制层    │ │
│  │ (state mgr)  │ /var/run/      │ (tokio proxy)│ libPenguinVZ.a    │ │
│  │              │ docker.sock    │              │ (Virtualization)  │ │
│  └──────────────┴───────────────┴──────────────┴─────────┬─────────┘ │
└───────────────────────────────────────────────────────────│──────────┘
        ▲ Docker API (docker CLI / Compose / testcontainers)  │ Vz API
        │                                                      ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Vz Linux VM(每个 runtime 一个 / one VM per runtime)                  │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ penguin-agent = PID 1(自研 init,Rust)                          │  │
│  │   ├─ vsock 控制通道 ◀──── virtio-vsock ────▶ penguind            │  │
│  │   ├─ containerd + runc(OCI 容器)                               │  │
│  │   ├─ 监听端口上报 / port-listen reporter                         │  │
│  │   └─ 资源 stats 上报                                              │  │
│  │  容器 1   容器 2   容器 3 …(namespaces + cgroups,共享内核)       │  │
│  └────────────────────────────────────────────────────────────────┘  │
│  设备: virtio-net(NAT) · VirtioFS(共享目录) · vsock · 气球 · 串口    │
└──────────────────────────────────────────────────────────────────────┘
```

**一句话**:GUI 和 `docker` CLI 都只是 `penguind` 的瘦客户端;`penguind` 拥有所有 VM;每个 VM 里跑一个自研 init + containerd;主机和 guest 之间走 vsock,不依赖网络。

---

## 2. 内部模块 / Internal Modules

| 模块 | 语言 | 进程 | 职责 |
|---|---|---|---|
| Runtime workspace UI | React/TS | GUI | 容器/镜像/卷/日志/资源面板,runtime 切换 |
| `runtime` Tauri 命令 | Rust | GUI | 把 UI 的 `invoke` 转成对 `penguind` 的 UDS 调用 + 转发事件 |
| `penguind` 守护 | Rust | 常驻★ | 编排核心、Docker API、网络、vsock、Vz 控制入口 |
| `libPenguinVZ` | Swift | (链入 penguind) | Virtualization.framework 封装,VM 生命周期 |
| `penguin-agent` | Rust | guest PID 1 | guest init、containerd 驱动、端口/stats 上报 |
| `penguin-proto` | Rust | 共享 | 主机↔guest、GUI↔penguind 的协议类型(serde) |
| `docker` shim | Rust | CLI | 极薄,把 socket 指向我们的 `docker.sock` |

**判定**:为什么需要 `penguind` 这个常驻进程?因为 `docker run -d` 起的服务必须在用户关闭 GUI 后继续运行,Vz VM 也必须脱离 GUI 生命周期存活。这是**唯一**被允许的常驻进程,且它懒加载(socket-activated LaunchAgent),最后一个 VM 停止且无 keepalive 时自行退出。我们额外提供 **Lite 模式**:不装守护进程,VM 绑定 GUI 生命周期,关窗时 `save-state`、开窗时 `restore`——给追求零后台占用的用户。

---

## 3. 进程模型 / Process Model

```
launchd ──(socket activation /var/run/docker.sock & ~/.penguin/run/penguind.sock)──▶ penguind
                                                                                       │
   GUI (Tauri) ──client──┐                                                             │
   docker CLI  ──client──┼──▶ penguind ──Vz(in-process, Swift run-loop thread)──▶ VM(s)
   Compose     ──client──┘                                                    │
                                                                              └─ vsock ─▶ penguin-agent (PID 1) ─▶ containerd ─▶ containers
```

- **GUI**:0~1 个,临时。崩溃/退出不影响 VM。
- **`penguind`**:0~1 个。懒启动(首次 `docker`/打开 Runtime workspace 时由 launchd 拉起),空闲退出。
- **Vz VM**:Vz 的 VM 在**进程内**运行于 dispatch queue(不是独立进程),由 `libPenguinVZ` 在 `penguind` 内的专用 run-loop 线程驱动。N 个 runtime = N 个 VM 对象,同一进程。
- **guest 内**:`penguin-agent` 是 PID 1(无 systemd),containerd 由它拉起,容器是 Linux 进程。

**对比**:Docker Desktop 跑一个重 Electron + 多个 helper + 一个 Linux VM;我们是「临时 GUI + 一个懒守护 + 一个共享 VM」。空闲时只有 `penguind`(目标 < 30MB RSS,无 VM 时)。

---

## 4. VM 生命周期 / VM Lifecycle

状态机(由 `penguind` 的 Runtime 注册表持有,Swift 侧执行):

```
Absent ──create──▶ Stopped ──start/restore──▶ Running ──pause/save──▶ Suspended
   ▲                  │  ▲                        │   │                    │
   └──────delete──────┘  └────────stop───────────┘   └──restore──────────┘
```

| 操作 | Vz 调用 | 性能目标 |
|---|---|---|
| **cold boot** | `VZLinuxBootLoader` 直接引导自定义内核 + 最小 initramfs(无 firmware/bootloader) | 内核到 agent ready **< 800ms** |
| **golden restore** | `restoreMachineStateFrom`(预制「就绪快照」) | **< 300ms** 到可跑容器 |
| **suspend** | `pause()` + `saveMachineStateTo(url)` | < 500ms |
| **resume** | `restoreMachineStateFrom(url)` + `resume()` | < 300ms |
| **stop** | agent 收 vsock `shutdown` → `stop()` | 优雅 < 2s |

**启动优化**:
1. **自定义最小内核**:只编进 virtio(net/fs/vsock/balloon/console)、overlayfs、cgroup v2、需要的 netfilter;无模块、无 initrd 解压开销(initramfs 直接是 agent)。
2. **agent 即 init**:跳过 systemd(省 1~3s + 数十 MB)。PID 1 直接挂载、起 containerd、开 vsock。
3. **golden snapshot 预热**:首次创建 runtime 后保存一份「已 ready」状态;以后默认 `restore` 而非 cold boot → 首个容器近乎瞬时。
4. **懒创建**:没跑容器就没有 VM。`docker run` 第一次触发 VM `restore`。

**对比**:用完整发行版 + systemd 启动需数秒、内存基线高;自定义 init 把基线压到「内核 + agent + containerd」。

---

## 5. 容器生命周期 / Container Lifecycle

容器**不是** VM——是共享 VM 内核里的 Linux 进程(namespaces + cgroups v2)。

```
docker run nginx
  │  (Docker API: POST /containers/create + /start)
  ▼
penguind Docker-API 服务 ──翻译──▶ penguin-proto::ContainerCreate
  │  vsock
  ▼
penguin-agent ──▶ containerd(镜像已在 guest 磁盘) ──▶ runc ──▶ 容器进程
  │
  ├─ 监听端口被 agent 检测(轮询 /proc 或 netlink sock_diag)→ 上报 penguind → 自动端口转发
  ├─ stdout/stderr → containerd 日志 → vsock 流 → penguind → GUI/CLI
  └─ stats(cgroup) → vsock → GUI 资源面板
```

**镜像引擎抉择(关键)**:
- ✅ **guest 内复用 containerd + 自研 `penguin-agent` 驱动**。理由:OCI 镜像拉取、overlayfs snapshotter、layer 缓存是「已解决的难题」,自研无产品价值;guest 内部对用户**完全不可见**,复用它不构成「克隆 Docker Desktop」(产品层我们提供全新 UX)。
- ❌ 从零写 OCI runtime:范围爆炸,零差异化。
- 🔭 长期可选:用我们自己的轻量 supervisor 替换 containerd 的高层 daemon,但保留 `runc` + snapshotter。

**Docker CLI / Compose 兼容策略(护城河)**:
`penguind` 实现 **Docker Engine API**(REST over UDS)的有用子集,并把 socket 暴露为 `/var/run/docker.sock`。于是:
- `docker` CLI、**Compose v2**(它本身只是 Docker API 客户端)、testcontainers、IDE 集成、CI 工具**全部零改动可用**。
- 我们只需翻译 API 调用为 `penguin-proto` 的 vsock 指令。
- 这比自创 CLI 强太多:**兼容性=采用率**。

---

## 6. 网络 / Networking

目标:**用户永远不配端口**。

- **VM 上网**:`VZNATNetworkDeviceAttachment`(virtio-net + Vz 内建 NAT),guest 直接出网。
- **自动端口转发**:`penguin-agent` 监测 guest 内 `LISTEN` 套接字(sock_diag/netlink),把 `(容器, 端口)` 经 vsock 上报;`penguind` 用 tokio 用户态代理把 `127.0.0.1:PORT` ↔ guest 容器自动打通。容器一 `EXPOSE` 并监听,主机立刻可访问,**零 `-p` 配置**(也兼容显式 `-p`)。
- **域名直达**(OrbStack 式魔法,M4+):主机起一个 DNS resolver,把 `<容器名>.penguin.test` 解析到 guest 内 IP,并加一条到 VM 子网的路由 → 浏览器直接 `http://web.penguin.test`,无需端口。
- **多 runtime 隔离**:每个 VM 一个 NAT 子网,互不可见,除非显式连接。

**对比**:vmnet(需要更高权限/helper)vs Vz NAT(进程内、零权限)→ 默认 Vz NAT;域名直达需要一条路由(用 `vmnet` shared 模式或主机路由表),作为可选增强。slirp/gVisor netstack 纯用户态但吞吐低,不选作默认。

---

## 7. 存储 / Storage

```
主机 APFS                         guest
~/.penguin/runtimes/<name>/
  ├─ disk.img  (sparse/ASIF) ───▶ /dev/vda → ext4/xfs
  │     └─ containerd overlayfs: 镜像层 + 容器可写层 + 命名卷
  ├─ state.vzvmstate  (suspend/resume 内存状态)
  └─ snapshots/  (APFS clone of disk.img)
```

- **guest 磁盘**:`VZDiskImageStorageDeviceAttachment`。优先 **ASIF 稀疏格式**(macOS 15+,APFS 原生稀疏,trim 回收快);回退 raw sparse。镜像、卷都在这块盘上,由 containerd 管理。
- **命名卷 / volumes**:就是 guest 文件系统里的目录,由 containerd/agent 管理;主机不直接持有,避免双写一致性问题。
- **镜像管理**:走 containerd content store;GUI 提供镜像列表/删除/prune/磁盘占用可视化。
- **快照 / Snapshots**:对 `disk.img` 做 **APFS clone**(`clonefile(2)`,瞬时 + copy-on-write,几乎零额外空间)。比 qcow2 内部快照轻。
- **磁盘回收**:guest `fstrim` + ASIF 稀疏回收,把删掉的层空间还给 APFS。

**对比**:ASIF(新、稀疏好、需 macOS 15)> raw sparse(通用)> qcow2(要自管理格式,无必要)。APFS clone 做快照 > Vz save-state 做快照(后者含内存,更重,留给 suspend/resume)。

---

## 8. 共享文件系统 / Shared Filesystem

- **默认:VirtioFS**(`VZVirtioFileSystemDeviceConfiguration` + `VZSharedDirectory`)。接近原生的共享目录,远快于 9p/osxfs。bind mount(`docker run -v $PWD:/app`)直接映射成 VirtioFS 共享,**无需 rsync/mutagen**。
- **元数据密集场景的快路径**(node_modules、海量小文件):VirtioFS 在 metadata-heavy 工作负载仍有开销。提供可选 `penguin-sync`:主机 FSEvents 监听 → vsock 增量同步到 guest 本地盘(读写都在 guest 侧,极快),适合 hot-reload 开发。用户按目录选择「直挂(强一致)」或「同步(高性能)」。
- **权限/uid 映射**:VirtioFS 处理 uid/gid 转译,避免 root-owned 文件污染主机。

**对比**:VirtioFS(默认,Apple 原生)> NFS(要起服务、配置烦)> 9p(慢)> 纯 rsync/mutagen(延迟、状态复杂,仅作快路径补充)。

---

## 9. 性能优化 / Performance

| 维度 | 手段 |
|---|---|
| 启动 | 自定义内核 + agent-as-init + golden-snapshot restore + 懒创建 |
| 容器启动 | 单 VM 共享内核,容器=进程,无 per-container boot;镜像层缓存在 guest 盘 |
| 文件 IO | VirtioFS 直挂;热路径用同步盘 |
| 网络 | virtio-net + Vz NAT;用户态转发仅对显式端口,直达走路由 |
| 控制面延迟 | vsock(非 TCP,无网络栈往返);协议用 bincode/postcard 紧凑编码 |
| GUI | 复用现有 Tauri webview,Runtime 只加 React 组件;大列表(容器/镜像)用现有 `@tanstack/react-virtual` |
| 日志/stats 流 | vsock 流式 + 背压;GUI 端节流渲染,沿用 redis stats 的 `CancellationToken` 范式 |

---

## 10. 内存优化 / Memory

| 手段 | 说明 |
|---|---|
| **单共享 VM** | 所有容器共享一个内核基线,而非 VM-per-container 的 N×基线 |
| **内存气球** | `VZVirtioTraditionalMemoryBalloonDeviceConfiguration`:VM 配高 max,空闲时 balloon 把 RAM 还给主机;按需再要回 |
| **懒启动** | 无容器 = 无 VM = 仅 `penguind`(目标 < 30MB) |
| **空闲自动挂起** | VM 空闲 N 分钟 → `save-state` → 释放全部 guest RAM;下次访问 `restore` |
| **agent-as-init** | 省掉 systemd 的常驻内存 |
| **守护进程懒退出** | 最后一个 VM 停且无 keepalive → `penguind` 退出 |

**对比**:VM-per-container(Firecracker 式)隔离最强但内存随容器数线性增长,不适合开发机;共享 VM + 气球是「轻」的关键,所以默认共享 VM,VM-per-runtime 仅在用户要强隔离时。

---

## 11. 安全模型 / Security

- **Vz 权限**:`com.apple.security.virtualization` entitlement;Hardened Runtime;`penguind` 与 GUI 都签名 + 公证(沿用现有 CI 流程)。
- **进程隔离**:`penguind` 不以 root 运行;特权操作(路由、低端口转发)经一个最小的、经过审计的 privileged helper(仅在需要时),其余全用户态。
- **容器隔离**:guest 内 Linux namespaces + cgroups v2 + seccomp(containerd 默认 profile);跨 runtime 用独立 VM,内核级隔离。
- **主机↔guest 通道**:仅 vsock,guest 无法访问主机任意服务;Docker socket UDS 权限限本用户。
- **Registry 认证**:**复用 `SqliteKeychain`**(`app_kv` SQLite,与 REST 模块一致,不用 OS keychain——与团队既定存储模型一致)。镜像拉取时 `penguind` 解密 → 经 vsock 注入 guest 的 containerd 拉取,凭据不落 guest 盘。
- **供应链**:内核、initramfs、agent 由我们构建并签名;镜像签名校验(cosign,future)。

---

## 12. 目录结构 / Folder Structure(新增部分)

```
Penguin/
├─ src/
│  └─ components/
│     └─ runtime/                 ★ 新 workspace UI
│        ├─ RuntimeWorkspace.tsx  # 入口,runtime 选择器
│        ├─ containers/           # 容器列表/详情/创建
│        ├─ images/               # 镜像管理
│        ├─ volumes/              # 卷管理
│        ├─ logs/                 # 日志查看(xterm 复用)
│        ├─ stats/                # 资源监控(AreaChart 复用)
│        ├─ compose/              # Compose 项目视图
│        └─ settings/             # runtime 资源/网络/共享目录
├─ src/lib/
│  └─ runtime-client.ts           # invoke 封装 + 事件订阅
├─ src-tauri/
│  ├─ src/runtime/                ★ Tauri 命令薄代理
│  │  ├─ mod.rs                   # RuntimeState + 注册
│  │  └─ commands.rs              # runtime_* 命令 → UDS to penguind
│  └─ crates/                     ★ 新 cargo workspace
│     ├─ penguind/                # 常驻后台二进制
│     ├─ penguin-runtime-core/    # 编排、状态机、注册表
│     ├─ penguin-vmm/             # Swift Vz 层的 Rust 侧 FFI 绑定
│     ├─ penguin-docker-api/      # Docker Engine API 兼容服务
│     ├─ penguin-vsock/           # 主机侧 vsock 传输
│     ├─ penguin-net/             # 端口转发 + DNS
│     ├─ penguin-fs/              # VirtioFS 配置 + 可选同步
│     ├─ penguin-agent/           # guest init/agent(target: linux/aarch64)
│     └─ penguin-proto/           # 共享协议类型
├─ swift/
│  └─ PenguinVZ/                  ★ Swift Vz 封装 → libPenguinVZ.a
│     ├─ Package.swift
│     ├─ Sources/PenguinVZ/
│     │  ├─ VMConfig.swift        # 配置构建器
│     │  ├─ VMLifecycle.swift     # start/stop/pause/save/restore
│     │  ├─ VMDevices.swift       # net/fs/vsock/balloon/console
│     │  ├─ Supervisor.swift      # 多 VM 注册、run-loop 线程
│     │  └─ Bridge.swift          # @_cdecl C ABI 导出给 Rust
│     └─ include/penguin_vz.h     # C 头给 bindgen
├─ guest/                         ★ guest 构建产物
│  ├─ kernel/                     # 自定义内核配置 + 构建脚本
│  ├─ initramfs/                  # agent + containerd + runc 打包
│  └─ build.sh
└─ requirements/penguin-runtime/  # 本文档
```

---

## 13. Rust crate 结构 / Rust Crate Structure

新建 `src-tauri/crates/*` cargo workspace。依赖方向(无环):

```
penguin-proto  ◀── 所有 crate 共享(serde 类型,no_std 友好)
     ▲
penguin-vsock ──▶ penguin-proto
penguin-vmm   ──▶ (FFI) libPenguinVZ
penguin-net   ──▶ penguin-proto
penguin-fs    ──▶ penguin-proto
penguin-docker-api ──▶ penguin-proto
     ▲
penguin-runtime-core ──▶ {vmm, vsock, net, fs, docker-api, proto}
     ▲
penguind (bin) ──▶ runtime-core
penguin-agent (bin, linux) ──▶ {proto, vsock(guest 侧)}

src-tauri 的 penguin crate 的 runtime 模块 ──▶ 仅通过 UDS 调 penguind(不直接依赖 vmm/Vz)
```

| crate | 关键依赖 | 说明 |
|---|---|---|
| `penguin-proto` | serde, postcard | 版本化协议,主机/guest/GUI 三方共享 |
| `penguin-vsock` | tokio-vsock | 框架化消息 + 多路复用流(日志/stats) |
| `penguin-vmm` | objc2 或 FFI to Swift | 默认走 **Swift FFI**(见 §14);objc2 直绑为备选 |
| `penguin-docker-api` | axum/hyper, hyperlocal | UDS 上的 Docker Engine API 子集 |
| `penguin-net` | tokio, hickory-dns | 端口转发代理 + `.penguin.test` 解析 |
| `penguin-fs` | notify | FSEvents → 同步快路径 |
| `penguin-runtime-core` | tokio | 状态机、runtime 注册表、编排 |
| `penguind` | tokio, clap | 守护:UDS server、launchd 集成、生命周期 |
| `penguin-agent` | tokio(linux) | PID1 init、containerd gRPC 客户端、上报器 |

**为什么 Tauri crate 不直接链 Vz**:让 GUI 进程与 Vz/entitlement 解耦,GUI 崩溃不带走 VM;`penguind` 是唯一持有 Vz 的进程。

---

## 14. Swift 模块 / Swift Modules

**抉择:Vz 怎么从 Rust 调?** 三选一:

| 方案 | 优 | 劣 | 结论 |
|---|---|---|---|
| A. `objc2` + `objc2-virtualization` 直绑 | 单语言,无 Swift | 绑定滞后 Apple API;run-loop/dispatch queue 管理冗长;Vz 回调桥接繁琐 | 备选 |
| B. **Swift 静态库 + C ABI(`@_cdecl`),链入 penguind** | 用地道 Swift 写 Vz;**单进程**;符合「Swift 仅在必需时」 | swiftc↔cargo 链接构建复杂;跨 FFI 管理线程 | ✅ **采用** |
| C. 独立 Swift 守护进程 + IPC | run-loop 天然;职责清晰 | **多一个进程**,违反原则;Rust↔Swift 又要一层 IPC | 否 |

**采用 B**:`libPenguinVZ.a` 用 `@_cdecl` 导出 C 函数(`pvz_create`、`pvz_start`、`pvz_save`、`pvz_restore`、回调注册等),`penguin-vmm` 用 bindgen 生成绑定。Vz 要求 run loop —— Swift 侧在 `penguind` 内开一条专用线程跑 `CFRunLoop`/`dispatch_main`,所有 Vz 对象绑定到该队列;Rust 通过线程安全的命令 channel 投递操作,结果/事件经回调回传。

Swift 模块拆分见 §12 `swift/PenguinVZ/`。`Bridge.swift` 是唯一的 FFI 边界(其余 Swift 不暴露 C ABI),便于审计。

---

## 15. IPC 设计 / IPC Design

四个边界,各自选最合适的传输:

| 边界 | 传输 | 编码 | 模式 |
|---|---|---|---|
| ① React ↔ Tauri 核心 | Tauri `invoke` / `emit` | JSON | 复用现有范式(同 redis):命令 + 事件流 |
| ② Tauri 核心 ↔ `penguind` | **UDS**(`~/.penguin/run/penguind.sock`) | JSON-RPC(framed) | 请求/响应 + 服务端推送事件 |
| ③ `penguind` ↔ Swift Vz | 进程内 FFI + 命令 channel | C ABI / 回调 | 单向命令 + 回调事件 |
| ④ `penguind` ↔ guest agent | **virtio-vsock** | postcard(bincode 类) | 多路复用:控制 RPC + 日志流 + stats 流 |
| ⑤ docker CLI/Compose ↔ `penguind` | **UDS** `/var/run/docker.sock` | Docker Engine API(HTTP/JSON) | 标准 Docker 协议 |

**事件流**:VM 状态变化、容器生命周期、端口被监听、日志、资源 stats,统一从 agent → vsock → `penguind` → (UDS event) → Tauri 核心 → (`emit`) → React。背压在 vsock 层做(有界 channel),GUI 端节流。

**协议版本化**:`penguin-proto` 带 `version` 字段,守护与 agent 握手时协商,支持 agent 热升级而不破坏旧 GUI。

---

## 16. 未来:插件系统 / Future Plugin System

- **宿主插件 = WASM**(wasmtime,WASI):第三方在 `penguind` 内安全运行,通过 capability 化的 host API 扩展(自定义镜像源、日志处理器、网络策略)。WASM 给沙箱 + 跨架构 + 无崩溃风险。
- **guest 侧扩展 = OCI hooks**:容器创建/启动钩子,复用 OCI 标准。
- **插件分发**:复用 Penguin 现有的 `@snsoft/*` npm 包管理思路 + registry —— 插件也走包管理 UI 安装,统一体验。
- 对比:WASM 插件 > 动态库插件(崩溃/ABI 风险)> 子进程插件(重)。

## 17. 未来:扩展 API / Future Extension API

- **稳定的 JSON-RPC 扩展 API**(over UDS),与内部协议解耦、单独版本化:第三方工具(IDE 插件、CLI)可查询/订阅 runtime、容器、事件。
- **Kubernetes(future)**:guest 内装 **k3s**(单 VM 轻量 k8s),`penguind` 自动合并 kubeconfig,端口转发/域名直达复用 §6。`kubectl` 零配置可用——和 Docker API 同一套「兼容=采用」策略。
- **声明式 runtime**:`penguin.toml` 描述 runtime(资源、共享目录、预拉镜像),可纳入版本控制,团队一键复现环境。

---

## 18. 开发路线图 / Roadmap(MVP → 生产)

> 估时按 1~2 名熟练工程师计;Apple Silicon 优先,Intel 后补。

### M0 — Vz 可行性 Spike(1~2 周)
- **目标**:验证 Swift FFI 方案能从 Rust 启动一个 Vz Linux VM 并拿到串口输出。
- **交付**:`libPenguinVZ` 最小版(create/start/console);Rust 调通;能 boot 一个现成 Linux 内核到 shell。
- **风险**:entitlement/签名在开发期配置;FFI run-loop 线程模型踩坑。
- **顺序**:**最先做**——这是整个项目的技术前提,失败则需回退 objc2 方案。

### M1 — 自定义 guest + agent-as-init(2~3 周)
- **目标**:自定义最小内核 + initramfs,`penguin-agent` 作为 PID 1,vsock 通。
- **交付**:`guest/` 构建链;agent 起 vsock,主机能发 RPC;cold boot < 1s。
- **风险**:内核裁剪过度导致缺驱动;vsock 在 Vz 上的细节。
- **顺序**:M0 之后,容器之前。

### M2 — 单容器跑起来(3~4 周)
- **目标**:guest 内 containerd + runc;经 vsock `docker run` 一个容器并看到日志。
- **交付**:`penguin-agent` 驱动 containerd;镜像拉取(匿名 registry);日志流;`penguin-proto` 容器协议。
- **风险**:containerd 在最小 guest 的依赖;snapshotter/overlayfs 配置。
- **顺序**:核心里程碑,先于任何兼容层。

### M3 — Docker API 兼容 + CLI/Compose(3~4 周)
- **目标**:`docker` 与 **Compose** 零改动可用。
- **交付**:`penguin-docker-api` 实现 images/containers/exec/logs/networks/volumes 子集;`/var/run/docker.sock`;`penguind` 守护 + launchd socket activation。
- **风险**:Docker API 表面广,需聚焦高频端点;Compose 隐式依赖某些字段。
- **顺序**:M2 后立即——这是采用率的关键护城河。

### M4 — 自动网络 + 共享文件(3~4 周)
- **目标**:自动端口转发 + VirtioFS bind mount,体验「零配置」。
- **交付**:`penguin-net`(监听上报→自动转发)+ `.penguin.test` DNS;`penguin-fs` VirtioFS 共享;`-v` bind mount 直挂。
- **风险**:端口转发的边界(IPv6、UDP);VirtioFS uid 映射;域名直达需路由权限。
- **顺序**:M3 后,这是「invisible」体验的核心。

### M5 — Runtime workspace UI + 卷/镜像管理(3~4 周)
- **目标**:GUI 里完整可视化操作,不碰命令行也能用。
- **交付**:`src/components/runtime/`;容器/镜像/卷/日志(xterm)/stats(AreaChart 复用);Compose 项目视图;registry 认证复用 `SqliteKeychain`。
- **风险**:大列表性能(用 react-virtual);事件流节流。
- **顺序**:M4 后,把后端能力暴露给非 CLI 用户。

### M6 — 性能/内存:挂起恢复 + 快照 + 气球 + golden snapshot(3~4 周)
- **目标**:达到「轻」的指标,超越竞品空闲占用。
- **交付**:suspend/resume(save/restore state);APFS clone 快照;内存气球;空闲自动挂起 + 守护懒退出;golden-snapshot 预热。
- **风险**:save/restore 跨 macOS 版本兼容;气球回收时机调优。
- **顺序**:核心功能稳定后做,是差异化卖点。

### M7 — 多 runtime + registry 认证 + 自动更新整合(2~3 周)
- **目标**:多隔离 runtime;私有 registry;接入 Penguin 既有更新流程。
- **交付**:VM-per-runtime 注册表与切换;私有 registry 凭据(SqliteKeychain);agent/内核随 app 经 `tauri-plugin-updater` 更新 + 协议版本协商。
- **风险**:多 VM 资源管理;guest 组件升级的原子性/回滚。
- **顺序**:GA 前。

### M8 — 打磨 + GA(3~4 周)
- **目标**:稳定性、错误处理、文档、双语 UI、公证、卸载干净。
- **交付**:崩溃恢复、孤儿 VM 清理、诊断面板(`penguin doctor`)、Lite 模式开关、Intel 支持验证、文档站更新。
- **风险**:长尾兼容(testcontainers、CI 镜像、各类 Compose 文件)。
- **顺序**:发布前最后冲刺。

### 后 GA(future)
- **K8s**:k3s + 自动 kubeconfig(2~3 周)。
- **域名直达增强、`penguin.toml` 声明式 runtime**。
- **WASM 插件系统 + 扩展 API**。
- **同步快路径 `penguin-sync`**(node_modules 等)。

**累计 MVP→GA 估时**:约 **22~30 周**(单人偏上限,双人偏下限)。建议严格按 M0→M8 顺序,因为每个里程碑都是后一个的硬前提(Vz→guest→容器→兼容→网络→UI→性能)。

---

## 19. 关键决策速查 / Decision Log

| 决策 | 选择 | 否决项 | 理由 |
|---|---|---|---|
| 虚拟化 | Apple Vz | QEMU/自研 hypervisor | native、零授权摩擦、Apple 维护 |
| Vz 绑定 | Swift 静态库 FFI | objc2 直绑 / 独立 Swift 进程 | 单进程 + 地道 Swift + 可审计边界 |
| VM 拓扑 | 每 runtime 一 VM,默认单 VM | VM-per-container | 共享内核更轻,隔离按需 |
| guest 引擎 | 复用 containerd + 自研 agent | 自写 OCI runtime | 不可见、无差异化,复用更稳 |
| CLI 兼容 | 实现 Docker API socket | 自创 CLI | 兼容=采用,Compose 免费 |
| 共享文件 | VirtioFS 默认 + 可选同步 | 9p / NFS / 纯 mutagen | Apple 原生最快 |
| 网络 | Vz NAT + 自动转发 + 域名直达 | vmnet 默认 / slirp | 零权限 + 零配置 |
| 快照 | APFS clone(磁盘)+ Vz save(内存) | qcow2 内部快照 | clonefile 瞬时零空间 |
| 内存 | 单 VM + 气球 + 懒启动 + 空闲挂起 | 常驻满配 VM | 这是「轻」的全部来源 |
| 密钥 | SqliteKeychain(复用) | OS keychain | 与团队既定模型一致、无 keychain 提示循环 |
| 后台进程 | 唯一懒守护 `penguind` + Lite 模式 | 多 helper / 重 daemon | 每个进程都要被审判 |

---

*本设计可被挑战。任何「因为 Docker/OrbStack 这么做」都不是理由——只有「在 macOS 上这是最快/最轻/最简单」才是。*
