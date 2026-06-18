# Terminal Agents Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new super-admin-only `Terminal` module with a Warp-style tab rail, local PTY shell sessions, local CLI agent sessions, agent block feed, bottom prompt composer, lightweight run summaries, and guarded persistence.

**Architecture:** Add an isolated React module under `src/components/terminal` and a Rust PTY backend under `src-tauri/src/terminal`. Keep terminal execution out of `tauri-plugin-shell` capability JSON, use structured Tauri commands, and persist only metadata plus capped/redacted previews.

**Tech Stack:** React 19, TypeScript, Tauri 2, SQLite via existing `db.rs`, `@xterm/xterm@6.0.0`, `@xterm/addon-fit@0.11.0`, `portable-pty@0.9.0`, Node test runner, Rust tests.

---

## File Structure

- Create `src/components/terminal/TerminalPage.tsx`: module root, mode selection, selected tab state.
- Create `src/components/terminal/TerminalTabRail.tsx`: searchable tab list and create/kill actions.
- Create `src/components/terminal/TerminalTopMetaBar.tsx`: runtime, cwd, branch, change count, elapsed time, and action icons.
- Create `src/components/terminal/TerminalPane.tsx`: xterm wrapper and Tauri event bridge.
- Create `src/components/terminal/TerminalBlockFeed.tsx`: agent block transcript surface.
- Create `src/components/terminal/TerminalPromptComposer.tsx`: pinned prompt input for agent tabs.
- Create `src/components/terminal/RunHistoryPanel.tsx`: current/recent session summaries.
- Create `src/lib/terminal-types.ts`: frontend shared types.
- Create `src/lib/terminal-events.ts`: event names shared by terminal components.
- Create `src-tauri/src/terminal/mod.rs`: backend module entry.
- Create `src-tauri/src/terminal/commands.rs`: Tauri command handlers.
- Create `src-tauri/src/terminal/session.rs`: session state and validation.
- Create `src-tauri/src/terminal/pty.rs`: `portable-pty` wrapper.
- Create `src-tauri/src/terminal/redact.rs`: output preview redaction.
- Modify `package.json`: add xterm dependencies.
- Modify `src-tauri/Cargo.toml`: add `portable-pty`.
- Modify `src-tauri/src/lib.rs`: manage terminal state and register commands.
- Modify `src-tauri/src/db.rs`: add terminal session metadata table.
- Modify `src/App.tsx`: add `terminal` module state, gating, persistence.
- Modify `src/components/layout/MainSidebar.tsx`: add Terminal item.
- Modify `tests/main-sidebar.test.mjs`: lock module registration and gating.
- Create `tests/terminal-module.test.mjs`: source-assert frontend/backend contracts.

## Task 1: Lock Module Contract With Failing Tests

**Files:**
- Modify: `tests/main-sidebar.test.mjs`
- Create: `tests/terminal-module.test.mjs`

- [ ] **Step 1: Add failing MainSidebar assertions**

In `tests/main-sidebar.test.mjs`, update the module declaration test to include `terminal`:

```js
test("MainSidebar declares the modules: home / client / vault / browser / rest / docs / database / terminal", async () => {
  const src = await loadSource("../src/components/layout/MainSidebar.tsx");
  assert.match(src, /"home"\s*\|\s*"client"\s*\|\s*"rest"\s*\|\s*"vault"\s*\|\s*"docs"\s*\|\s*"browser"\s*\|\s*"database"\s*\|\s*"terminal"/);
  for (const kind of ["home", "client", "vault", "browser", "rest", "docs", "database", "terminal"]) {
    assert.match(src, new RegExp(`kind:\\s*"${kind}"`));
  }
});
```

Add the bilingual tooltip assertion:

```js
assert.ok(src.includes('longLabel: "Terminal / 终端 (Super Admin)"'));
```

Add the gate assertion:

```js
test("MainSidebar — Terminal module locked to super-admin tier", async () => {
  const src = await loadSource("../src/components/layout/MainSidebar.tsx");
  assert.match(src, /kind:\s*"terminal"[^}]*?requires:\s*"super-admin"/);
  assert.doesNotMatch(src, /kind:\s*"terminal"[^}]*?requires:\s*"token"/);
});
```

- [ ] **Step 2: Add failing terminal source contract tests**

Create `tests/terminal-module.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function loadSource(relPath) {
  return readFile(new URL(relPath, import.meta.url), "utf8");
}

test("Terminal frontend files exist and export expected components", async () => {
  const files = [
    ["../src/components/terminal/TerminalPage.tsx", /export function TerminalPage/],
    ["../src/components/terminal/TerminalTabRail.tsx", /export function TerminalTabRail/],
    ["../src/components/terminal/TerminalTopMetaBar.tsx", /export function TerminalTopMetaBar/],
    ["../src/components/terminal/TerminalPane.tsx", /export function TerminalPane/],
    ["../src/components/terminal/TerminalBlockFeed.tsx", /export function TerminalBlockFeed/],
    ["../src/components/terminal/TerminalPromptComposer.tsx", /export function TerminalPromptComposer/],
    ["../src/components/terminal/RunHistoryPanel.tsx", /export function RunHistoryPanel/],
  ];

  for (const [relPath, pattern] of files) {
    const src = await loadSource(relPath);
    assert.match(src, pattern, `${relPath} should export the expected component`);
  }
});

test("Terminal backend registers PTY commands without broad shell capability", async () => {
  const lib = await loadSource("../src-tauri/src/lib.rs");
  const commands = await loadSource("../src-tauri/src/terminal/commands.rs");
  const capability = await loadSource("../src-tauri/capabilities/default.json");

  for (const cmd of [
    "terminal_create_session",
    "terminal_write",
    "terminal_resize",
    "terminal_kill",
    "terminal_list_sessions",
    "terminal_start_agent",
  ]) {
    assert.match(lib, new RegExp(cmd));
    assert.match(commands, new RegExp(`pub async fn ${cmd}`));
  }

  assert.doesNotMatch(capability, /terminal-/);
  assert.doesNotMatch(capability, /"cmd":\s*"\/bin\/zsh"[\s\S]*?\(\?s\)\.\+/);
});

test("Terminal frontend uses xterm and Tauri invoke/event bridge", async () => {
  const pane = await loadSource("../src/components/terminal/TerminalPane.tsx");
  const page = await loadSource("../src/components/terminal/TerminalPage.tsx");
  const feed = await loadSource("../src/components/terminal/TerminalBlockFeed.tsx");
  const composer = await loadSource("../src/components/terminal/TerminalPromptComposer.tsx");
  const rail = await loadSource("../src/components/terminal/TerminalTabRail.tsx");

  assert.match(pane, /@xterm\/xterm/);
  assert.match(pane, /@xterm\/addon-fit/);
  assert.match(pane, /listen<.*TerminalOutputEvent/);
  assert.match(pane, /invoke\("terminal_write"/);
  assert.match(pane, /invoke\("terminal_resize"/);
  assert.match(page, /invoke\("terminal_create_session"/);
  assert.match(feed, /TerminalRunBlock/);
  assert.match(composer, /invoke\("terminal_start_agent"/);
  assert.match(rail, /placeholder="Search tabs/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
node --test tests/main-sidebar.test.mjs tests/terminal-module.test.mjs
```

Expected: fail because `terminal` module and terminal files do not exist yet.

## Task 2: Add Dependencies And Shared Types

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Create: `src/lib/terminal-types.ts`
- Create: `src/lib/terminal-events.ts`

- [ ] **Step 1: Add dependencies**

Run:

```bash
pnpm add @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0
```

Modify `src-tauri/Cargo.toml`:

```toml
portable-pty = "0.9.0"
```

- [ ] **Step 2: Add frontend event constants**

Create `src/lib/terminal-events.ts`:

```ts
export const TERMINAL_OUTPUT_EVENT = "terminal://output";
export const TERMINAL_EXIT_EVENT = "terminal://exit";
```

- [ ] **Step 3: Add shared frontend types**

Create `src/lib/terminal-types.ts`:

```ts
export type TerminalMode = "shell" | "agents" | "runs";

export type TerminalSessionKind = "shell" | "agent";

export type TerminalAgentProvider = "codex" | "claude" | "gemini" | "opencode";

export type TerminalSessionStatus = "running" | "exited" | "killed" | "failed";

export interface TerminalSessionInfo {
  id: string;
  kind: TerminalSessionKind;
  title: string;
  cwd: string;
  shell: string | null;
  agent_provider: TerminalAgentProvider | null;
  status: TerminalSessionStatus;
  created_at: string;
  updated_at: string;
  exit_code: number | null;
}

export interface TerminalOutputEvent {
  session_id: string;
  data: string;
}

export interface TerminalExitEvent {
  session_id: string;
  status: TerminalSessionStatus;
  exit_code: number | null;
}

export interface CreateTerminalSessionPayload {
  cwd: string;
  cols: number;
  rows: number;
}

export interface StartTerminalAgentPayload {
  cwd: string;
  provider: TerminalAgentProvider;
  cols: number;
  rows: number;
}
```

- [ ] **Step 4: Verify dependency lockfile updates**

Run:

```bash
pnpm install --lockfile-only
```

Expected: `pnpm-lock.yaml` includes `@xterm/xterm`, `@xterm/addon-fit`; `Cargo.lock` will update after the first cargo command.

## Task 3: Implement Rust PTY Backend

**Files:**
- Create: `src-tauri/src/terminal/mod.rs`
- Create: `src-tauri/src/terminal/commands.rs`
- Create: `src-tauri/src/terminal/session.rs`
- Create: `src-tauri/src/terminal/pty.rs`
- Create: `src-tauri/src/terminal/redact.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create module entry**

Create `src-tauri/src/terminal/mod.rs`:

```rust
pub mod commands;
pub mod pty;
pub mod redact;
pub mod session;
```

- [ ] **Step 2: Create session model and validation**

Create `src-tauri/src/terminal/session.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalSessionKind {
    Shell,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalSessionStatus {
    Running,
    Exited,
    Killed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSessionInfo {
    pub id: String,
    pub kind: TerminalSessionKind,
    pub title: String,
    pub cwd: String,
    pub shell: Option<String>,
    pub agent_provider: Option<String>,
    pub status: TerminalSessionStatus,
    pub created_at: String,
    pub updated_at: String,
    pub exit_code: Option<i32>,
}

pub struct TerminalSessionHandle {
    pub info: TerminalSessionInfo,
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub writer: Box<dyn std::io::Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send>,
}

#[derive(Default)]
pub struct TerminalState {
    pub sessions: Mutex<HashMap<String, TerminalSessionHandle>>,
}

pub fn validate_cwd(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("cwd is required".to_string());
    }
    let path = Path::new(trimmed);
    if !path.exists() {
        return Err(format!("cwd does not exist: {trimmed}"));
    }
    if !path.is_dir() {
        return Err(format!("cwd is not a directory: {trimmed}"));
    }
    path.canonicalize().map_err(|e| format!("failed to canonicalize cwd: {e}"))
}

pub fn shell_command() -> &'static str {
    "/bin/zsh"
}

pub fn agent_command(provider: &str) -> Result<&'static str, String> {
    match provider {
        "codex" => Ok("codex"),
        "claude" => Ok("claude"),
        "gemini" => Ok("gemini"),
        "opencode" => Ok("opencode"),
        _ => Err(format!("unsupported agent provider: {provider}")),
    }
}
```

- [ ] **Step 3: Create redaction helper**

Create `src-tauri/src/terminal/redact.rs`:

```rust
const MAX_PREVIEW_BYTES: usize = 8192;

pub fn cap_preview(input: &str) -> String {
    if input.len() <= MAX_PREVIEW_BYTES {
        return input.to_string();
    }
    let mut end = MAX_PREVIEW_BYTES;
    while !input.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}...[truncated]", &input[..end])
}

pub fn redact_preview(input: &str) -> String {
    let capped = cap_preview(input);
    capped
        .split_whitespace()
        .map(|token| {
            let lower = token.to_ascii_lowercase();
            if lower.contains("token=")
                || lower.contains("password=")
                || lower.contains("authorization:")
                || lower.starts_with("sk-")
            {
                "[redacted]"
            } else {
                token
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caps_preview_on_utf8_boundary() {
        let input = "你".repeat(5000);
        let preview = cap_preview(&input);
        assert!(preview.ends_with("...[truncated]"));
        assert!(preview.is_char_boundary(preview.len()));
    }

    #[test]
    fn redacts_common_secret_tokens() {
        let preview = redact_preview("Authorization: Bearer abc password=secret ok");
        assert!(preview.contains("[redacted]"));
        assert!(!preview.contains("password=secret"));
    }
}
```

- [ ] **Step 4: Create PTY spawn helper**

Create `src-tauri/src/terminal/pty.rs`:

```rust
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::path::Path;

pub struct SpawnedPty {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub reader: Box<dyn Read + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send>,
}

pub fn spawn_pty(
    command: &str,
    args: &[&str],
    cwd: &Path,
    cols: u16,
    rows: u16,
) -> Result<SpawnedPty, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open pty: {e}"))?;

    let mut cmd = CommandBuilder::new(command);
    cmd.cwd(cwd);
    for arg in args {
        cmd.arg(arg);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to spawn pty command: {e}"))?;
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to clone pty reader: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("failed to take pty writer: {e}"))?;

    Ok(SpawnedPty { master: pair.master, reader, writer, child })
}
```

- [ ] **Step 5: Create Tauri commands**

Create `src-tauri/src/terminal/commands.rs` with these public command signatures:

```rust
use super::pty::spawn_pty;
use super::session::{
    agent_command, shell_command, validate_cwd, TerminalSessionHandle, TerminalSessionInfo,
    TerminalSessionKind, TerminalSessionStatus, TerminalState,
};
use serde::Deserialize;
use std::io::{Read, Write};
use portable_pty::PtySize;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Deserialize)]
pub struct CreateTerminalSessionPayload {
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Deserialize)]
pub struct StartTerminalAgentPayload {
    pub cwd: String,
    pub provider: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, serde::Serialize, Clone)]
struct TerminalOutputEvent {
    session_id: String,
    data: String,
}

fn now_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn session_id() -> String {
    format!("term-{}", now_string())
}

fn spawn_reader_thread(app: AppHandle, session_id: String, mut reader: Box<dyn Read + Send>) {
    std::thread::spawn(move || {
        let mut buf = [0_u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(
                        "terminal://output",
                        TerminalOutputEvent { session_id: session_id.clone(), data },
                    );
                }
                Err(_) => break,
            }
        }
    });
}

pub async fn terminal_create_session(
    payload: CreateTerminalSessionPayload,
    state: State<'_, TerminalState>,
    app: AppHandle,
) -> Result<TerminalSessionInfo, String> {
    let cwd = validate_cwd(&payload.cwd)?;
    let id = session_id();
    let spawned = spawn_pty(shell_command(), &["-l"], &cwd, payload.cols, payload.rows)?;
    let info = TerminalSessionInfo {
        id: id.clone(),
        kind: TerminalSessionKind::Shell,
        title: cwd.file_name().and_then(|s| s.to_str()).unwrap_or("Shell").to_string(),
        cwd: cwd.to_string_lossy().to_string(),
        shell: Some(shell_command().to_string()),
        agent_provider: None,
        status: TerminalSessionStatus::Running,
        created_at: now_string(),
        updated_at: now_string(),
        exit_code: None,
    };
    spawn_reader_thread(app.clone(), id.clone(), spawned.reader);

    state.sessions.lock().map_err(|_| "terminal state poisoned".to_string())?.insert(
        id,
        TerminalSessionHandle {
            info: info.clone(),
            master: spawned.master,
            writer: spawned.writer,
            child: spawned.child,
        },
    );
    Ok(info)
}

pub async fn terminal_start_agent(
    payload: StartTerminalAgentPayload,
    state: State<'_, TerminalState>,
    app: AppHandle,
) -> Result<TerminalSessionInfo, String> {
    let cwd = validate_cwd(&payload.cwd)?;
    let command = agent_command(&payload.provider)?;
    let id = session_id();
    let spawned = spawn_pty(command, &[], &cwd, payload.cols, payload.rows)?;
    let now = now_string();
    let info = TerminalSessionInfo {
        id: id.clone(),
        kind: TerminalSessionKind::Agent,
        title: format!("{} · {}", payload.provider, cwd.file_name().and_then(|s| s.to_str()).unwrap_or("agent")),
        cwd: cwd.to_string_lossy().to_string(),
        shell: None,
        agent_provider: Some(payload.provider),
        status: TerminalSessionStatus::Running,
        created_at: now.clone(),
        updated_at: now,
        exit_code: None,
    };
    spawn_reader_thread(app.clone(), id.clone(), spawned.reader);
    state.sessions.lock().map_err(|_| "terminal state poisoned".to_string())?.insert(
        id,
        TerminalSessionHandle {
            info: info.clone(),
            master: spawned.master,
            writer: spawned.writer,
            child: spawned.child,
        },
    );
    Ok(info)
}

pub async fn terminal_write(
    session_id: String,
    data: String,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|_| "terminal state poisoned".to_string())?;
    let handle = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("terminal session not found: {session_id}"))?;
    handle.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
}

pub async fn terminal_resize(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, TerminalState>,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|_| "terminal state poisoned".to_string())?;
    let handle = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("terminal session not found: {session_id}"))?;
    handle
        .master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

pub async fn terminal_kill(
    session_id: String,
    state: State<'_, TerminalState>,
) -> Result<TerminalSessionInfo, String> {
    let mut sessions = state.sessions.lock().map_err(|_| "terminal state poisoned".to_string())?;
    let handle = sessions
        .get_mut(&session_id)
        .ok_or_else(|| format!("terminal session not found: {session_id}"))?;
    handle.child.kill().map_err(|e| e.to_string())?;
    handle.info.status = TerminalSessionStatus::Killed;
    handle.info.updated_at = now_string();
    Ok(handle.info.clone())
}

pub async fn terminal_list_sessions(
    state: State<'_, TerminalState>,
) -> Result<Vec<TerminalSessionInfo>, String> {
    let sessions = state.sessions.lock().map_err(|_| "terminal state poisoned".to_string())?;
    let mut rows: Vec<TerminalSessionInfo> = sessions.values().map(|h| h.info.clone()).collect();
    rows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(rows)
}
```

- [ ] **Step 6: Register backend module**

In `src-tauri/src/lib.rs`, add:

```rust
mod terminal;
```

In the builder chain, add:

```rust
.manage(terminal::session::TerminalState::default())
```

In `tauri::generate_handler!`, add:

```rust
terminal::commands::terminal_create_session,
terminal::commands::terminal_start_agent,
terminal::commands::terminal_write,
terminal::commands::terminal_resize,
terminal::commands::terminal_kill,
terminal::commands::terminal_list_sessions,
```

- [ ] **Step 7: Verify Rust compile points**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml terminal
```

Expected: compile errors only if `portable-pty` trait bounds or method names need small adjustment. Fix the exact compiler errors in `pty.rs` or `session.rs`, then rerun until terminal tests pass.

## Task 4: Build Warp-Style Terminal UI

**Files:**
- Create: `src/components/terminal/TerminalPage.tsx`
- Create: `src/components/terminal/TerminalTabRail.tsx`
- Create: `src/components/terminal/TerminalTopMetaBar.tsx`
- Create: `src/components/terminal/TerminalPane.tsx`
- Create: `src/components/terminal/TerminalBlockFeed.tsx`
- Create: `src/components/terminal/TerminalPromptComposer.tsx`
- Create: `src/components/terminal/RunHistoryPanel.tsx`

- [ ] **Step 1: Create TerminalPage**

Create `src/components/terminal/TerminalPage.tsx`:

```tsx
import { Bot, History, Plus, SquareTerminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TerminalMode, TerminalSessionInfo } from "@/lib/terminal-types";
import { TerminalBlockFeed } from "./TerminalBlockFeed";
import { TerminalPromptComposer } from "./TerminalPromptComposer";
import { TerminalTabRail } from "./TerminalTabRail";
import { TerminalTopMetaBar } from "./TerminalTopMetaBar";
import { RunHistoryPanel } from "./RunHistoryPanel";
import { TerminalPane } from "./TerminalPane";

const MODES: Array<{ id: TerminalMode; label: string; icon: typeof SquareTerminal }> = [
  { id: "shell", label: "Shell", icon: SquareTerminal },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "runs", label: "Runs", icon: History },
];

export function TerminalPage(): ReactElement {
  const [mode, setMode] = useState<TerminalMode>("agents");
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const refreshSessions = useCallback(async () => {
    const next = await invoke<TerminalSessionInfo[]>("terminal_list_sessions");
    setSessions(next);
    setActiveSessionId((current) => current ?? next[0]?.id ?? null);
  }, []);

  const createShell = useCallback(async () => {
    const cwd = "/Users/shieng/Desktop/Pengvi";
    const session = await invoke<TerminalSessionInfo>("terminal_create_session", {
      payload: { cwd, cols: 100, rows: 30 },
    });
    setSessions((current) => [session, ...current]);
    setActiveSessionId(session.id);
    setMode("shell");
  }, []);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  return (
    <section className="flex h-full min-h-0 bg-background">
      <TerminalTabRail
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelect={setActiveSessionId}
        onRefresh={refreshSessions}
        onCreateShell={createShell}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-4">
          <div className="flex items-center gap-1.5">
            {MODES.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setMode(item.id)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded border px-3 text-xs font-medium transition-colors",
                    mode === item.id
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </div>
          <Button size="sm" variant="outline" onClick={createShell}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Shell
          </Button>
        </header>

        <TerminalTopMetaBar session={activeSession} />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {mode === "shell" ? <TerminalPane session={activeSession} /> : null}
          {mode === "agents" ? (
            <>
              <TerminalBlockFeed session={activeSession} />
              <TerminalPromptComposer
                session={activeSession}
                cwd={activeSession?.cwd ?? "/Users/shieng/Desktop/Pengvi"}
                onCreated={(s) => {
                  setSessions((current) => [s, ...current]);
                  setActiveSessionId(s.id);
                }}
              />
            </>
          ) : null}
          {mode === "runs" ? <RunHistoryPanel sessions={sessions} onSelect={(id) => { setActiveSessionId(id); setMode("shell"); }} /> : null}
        </main>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Create TerminalPane**

Create `src/components/terminal/TerminalPane.tsx` with xterm mount, output listener, data writer, and resize:

```tsx
import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, type ReactElement } from "react";
import { TERMINAL_OUTPUT_EVENT } from "@/lib/terminal-events";
import type { TerminalOutputEvent, TerminalSessionInfo } from "@/lib/terminal-types";

export function TerminalPane({ session }: { session: TerminalSessionInfo | null }): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (hostRef.current === null || session === null) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "JetBrains Mono, SFMono-Regular, Menlo, monospace",
      fontSize: 12,
      theme: { background: "#09090b" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();
    terminalRef.current = term;

    const dataDisposable = term.onData((data) => {
      void invoke("terminal_write", { sessionId: session.id, data });
    });

    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      void invoke("terminal_resize", {
        sessionId: session.id,
        cols: term.cols,
        rows: term.rows,
      });
    });
    resizeObserver.observe(hostRef.current);

    let unlisten: (() => void) | null = null;
    void listen<TerminalOutputEvent>(TERMINAL_OUTPUT_EVENT, (event) => {
      if (event.payload.session_id === session.id) term.write(event.payload.data);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
      resizeObserver.disconnect();
      dataDisposable.dispose();
      term.dispose();
      terminalRef.current = null;
    };
  }, [session?.id]);

  if (session === null) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No terminal session</div>;
  }

  return <div ref={hostRef} className="h-full min-h-0 bg-[#09090b] p-2" />;
}
```

- [ ] **Step 3: Create tab rail, top meta bar, block feed, and composer**

Create `TerminalTabRail.tsx` with props from `TerminalPage`, rendering:

- a search input with placeholder `Search tabs...`
- a filter/settings icon button
- a plus icon button
- compact tab cards with title, cwd, git branch, kind, and status
- a kill button that calls:

```ts
await invoke("terminal_kill", { sessionId: session.id });
await onRefresh();
```

Create `TerminalTopMetaBar.tsx` showing:

- runtime/model label with default value `local`
- cwd
- git branch
- tab status
- elapsed time
- action icon buttons for attach, export, filter, and more

Create `TerminalBlockFeed.tsx` around a `TerminalRunBlock` type. V1 may keep blocks in frontend state while backend persistence stores only metadata and capped previews:

```ts
interface TerminalRunBlock {
  id: string;
  kind: "prompt" | "command" | "output" | "assistant";
  text: string;
  status: "running" | "done" | "failed";
  created_at: string;
}
```

Create `TerminalPromptComposer.tsx` as a pinned bottom input. If there is no active agent session, submit starts one:

```ts
const session = await invoke<TerminalSessionInfo>("terminal_start_agent", {
  payload: { cwd, provider: "codex", cols: 100, rows: 30 },
});
onCreated(session);
await invoke("terminal_write", {
  sessionId: session.id,
  data: `${prompt}\n`,
});
```

If there is an active agent session, submit sends the prompt as terminal input:

```ts
await invoke("terminal_write", {
  sessionId: session.id,
  data: `${prompt}\n`,
});
```

Create `RunHistoryPanel.tsx` as a table/list over `TerminalSessionInfo[]` with `title`, `kind`, `cwd`, `status`, and `updated_at`.

- [ ] **Step 4: Run frontend contract tests**

Run:

```bash
node --test tests/terminal-module.test.mjs
```

Expected: frontend file/export/source assertions pass; backend assertions still fail until App/lib wiring is complete.

## Task 5: Wire Terminal Into App Shell

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/layout/MainSidebar.tsx`
- Modify: `tests/main-sidebar.test.mjs`

- [ ] **Step 1: Add sidebar item**

In `src/components/layout/MainSidebar.tsx`, import `SquareTerminal`:

```ts
import { BookOpen, Compass, Database, Globe, Home, Lock, SquareTerminal, Zap } from "lucide-react";
```

Extend `MainModule`:

```ts
export type MainModule = "home" | "client" | "rest" | "vault" | "docs" | "browser" | "database" | "terminal";
```

Add item:

```ts
{ kind: "terminal", icon: SquareTerminal, label: "Terminal", longLabel: "Terminal / 终端 (Super Admin)", requires: "super-admin" },
```

- [ ] **Step 2: Add App state and routing**

In `src/App.tsx`, import:

```ts
import { TerminalPage } from "@/components/terminal/TerminalPage";
```

Add `"terminal"` to `VALID_MODULES`.

Add state:

```ts
const [terminalOpen, setTerminalOpen] = useState(initialModule === "terminal");
```

Update every module selector to close `terminalOpen` when selecting other modules. Add:

```ts
const selectTerminal = useCallback(() => {
  setHomeOpen(false);
  setVaultOpen(false);
  setDocsOpen(false);
  setRestOpen(false);
  setBrowserOpen(false);
  setDatabaseOpen(false);
  setTerminalOpen(true);
}, []);
```

Update `activeModule`:

```ts
: terminalOpen
? "terminal"
```

Add gate:

```ts
const canAccessTerminal = devModeEnabled && isSuperAdmin;
```

Add revoke guard:

```ts
if (terminalOpen && !canAccessTerminal) setTerminalOpen(false);
```

Update `handleModuleSelect`:

```ts
else if (m === "terminal") selectTerminal();
```

Render:

```tsx
{terminalOpen ? <TerminalPage /> : null}
```

Update `MainSidebar` prop:

```tsx
isSuperAdmin={canAccessDocs || canAccessRest || canAccessDatabase || canAccessTerminal}
```

- [ ] **Step 3: Run sidebar tests**

Run:

```bash
node --test tests/main-sidebar.test.mjs tests/terminal-module.test.mjs
```

Expected: module contract tests pass except backend command registration if it is not complete.

## Task 6: Add SQLite Metadata Persistence

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/terminal/commands.rs`

- [ ] **Step 1: Add metadata table migration**

In `src-tauri/src/db.rs`, add:

```sql
CREATE TABLE IF NOT EXISTS terminal_sessions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  cwd TEXT NOT NULL,
  shell TEXT,
  agent_provider TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  exit_code INTEGER
);
```

Add index:

```sql
CREATE INDEX IF NOT EXISTS idx_terminal_sessions_updated_at
  ON terminal_sessions(updated_at);
```

- [ ] **Step 2: Add internal persistence helpers**

In `db.rs`, add internal functions:

```rust
#[derive(Debug, Clone)]
pub(crate) struct TerminalSessionDbRecord {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub cwd: String,
    pub shell: Option<String>,
    pub agent_provider: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub exit_code: Option<i32>,
}

pub(crate) fn terminal_session_upsert_internal(record: &TerminalSessionDbRecord) -> Result<(), String> {
    let conn = open_product_db_shared()?;
    conn.execute(
        r#"
        INSERT INTO terminal_sessions (
            id, kind, title, cwd, shell, agent_provider, status, created_at, updated_at, exit_code
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(id) DO UPDATE SET
            kind = excluded.kind,
            title = excluded.title,
            cwd = excluded.cwd,
            shell = excluded.shell,
            agent_provider = excluded.agent_provider,
            status = excluded.status,
            updated_at = excluded.updated_at,
            exit_code = excluded.exit_code
        "#,
        params![
            record.id,
            record.kind,
            record.title,
            record.cwd,
            record.shell,
            record.agent_provider,
            record.status,
            record.created_at,
            record.updated_at,
            record.exit_code,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn terminal_sessions_list_internal(limit: i64) -> Result<Vec<TerminalSessionDbRecord>, String> {
    let conn = open_product_db_shared()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, kind, title, cwd, shell, agent_provider, status, created_at, updated_at, exit_code \
             FROM terminal_sessions ORDER BY updated_at DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok(TerminalSessionDbRecord {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                cwd: row.get(3)?,
                shell: row.get(4)?,
                agent_provider: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                exit_code: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
```

Place these helpers next to the existing app-level persistence helpers in `db.rs`.

- [ ] **Step 3: Persist create/kill/list metadata**

In `terminal_create_session` and `terminal_start_agent`, call the upsert helper after `TerminalSessionInfo` is built.

In `terminal_kill`, update status to `Killed` and persist.

In `terminal_list_sessions`, merge live in-memory sessions with SQLite metadata so a restart can show previous exited/killed sessions as `Runs` records.

- [ ] **Step 4: Add Rust metadata tests**

In the existing `db.rs` test module, add a test that inserts a terminal session and reads it back through the helper. Use a temp database pattern matching existing db tests.

- [ ] **Step 5: Run Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml terminal db
```

Expected: terminal backend and DB tests pass.

## Task 7: Full Verification And Runtime Check

**Files:**
- No source edits unless verification finds a concrete issue.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
node --test tests/main-sidebar.test.mjs tests/terminal-module.test.mjs
```

Expected: all targeted JS tests pass.

- [ ] **Step 2: Run TypeScript**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 3: Run Rust checks**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all Rust tests pass.

- [ ] **Step 4: Run production build**

Run:

```bash
pnpm build
```

Expected: build exits 0. Existing Vite chunk warnings are acceptable only if they match the current known chunk-size/dynamic-import warnings.

- [ ] **Step 5: Run full JS tests**

Run:

```bash
node --test tests/*.test.mjs
```

Expected: all JS tests pass.

- [ ] **Step 6: Start Tauri dev runtime**

Run:

```bash
pnpm tauri dev
```

Expected: Vite starts on `http://localhost:1430/`, Rust binary compiles, app opens, Terminal module appears for super-admin users, and a new shell session can run:

```bash
pwd
echo penguin-terminal-ok
```

Expected terminal output includes current cwd and `penguin-terminal-ok`.

## Task 8: Commit Boundary

**Files:**
- All files touched by Tasks 1-7.

- [ ] **Step 1: Inspect diff**

Run:

```bash
git diff -- src/components/terminal src/lib/terminal-types.ts src/lib/terminal-events.ts src-tauri/src/terminal src/App.tsx src/components/layout/MainSidebar.tsx tests/main-sidebar.test.mjs tests/terminal-module.test.mjs package.json pnpm-lock.yaml src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/db.rs
```

Expected: diff contains only Terminal module work.

- [ ] **Step 2: Commit**

Run:

```bash
git add src/components/terminal src/lib/terminal-types.ts src/lib/terminal-events.ts src-tauri/src/terminal src/App.tsx src/components/layout/MainSidebar.tsx tests/main-sidebar.test.mjs tests/terminal-module.test.mjs package.json pnpm-lock.yaml src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/db.rs
git commit -m "feat: add terminal agents module"
```

Expected: commit succeeds after verification.
