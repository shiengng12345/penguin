# 下载与发布（给人下载你的 app）

## 给用户下载（推荐）

你现在的 setup 最适合用 **GitHub Releases** 放 `.dmg`，然后用 **Tauri Updater** 让用户在 app 里面自动更新。

用户下载入口（你可以放在官网/README/群组置顶）：
- GitHub Pages 下载页（推荐给非技术用户）：https://shiengng12345.github.io/penguin/
- GitHub Releases（最新版本）：https://github.com/shiengng12345/penguin/releases/latest

## 发布新版本（你做的步骤）

1) 统一更新版本号（建议三个一起动）

```bash
pnpm set-version 1.3.1
```

会同步更新：
- `package.json`（前端会用来做 `__APP_VERSION__`）
- `src-tauri/tauri.conf.json`（Tauri bundle 版本号）
- `src-tauri/Cargo.toml`（Rust crate 版本号）

2) 提交 + 打 tag（tag 会触发 GitHub Actions build）

```bash
git add -A
git commit -m "release: v1.3.1"
git tag v1.3.1
git push origin main --tags
```

3) 去 GitHub Actions 等它跑完，然后去 Releases 把 draft release 点 **Publish**

发布后用户就能下载：
- `Penguin_aarch64.dmg` / `Penguin_x86_64.dmg`（安装包，稳定文件名，适合下载页直链）
- `latest.json`（给 Tauri updater 用）

## 提示（让用户更顺滑）

- 在下载页/README 写清楚：Apple Silicon（M1/M2/M3） vs Intel（x64）两个版本。
- 第一次打开 macOS 可能会挡（Gatekeeper），建议放一个“右键 Open / 系统设置允许”的截图说明。
