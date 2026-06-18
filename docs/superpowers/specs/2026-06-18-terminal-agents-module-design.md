# Terminal Agents Module Design

## Goal

Add a new first-class Penguin module named `Terminal` that gives the app a local terminal and agent workbench surface. The module should feel adjacent to Warp's terminal-plus-agent workflow, but it must fit Penguin's existing desktop architecture, permission model, and internal-tool focus.

## Approved Direction

- Product shape: a new `Terminal` module in the main left rail.
- V1 scope: local terminal sessions, local CLI agent sessions, session metadata, resize/kill, and a clean workbench UI.
- Runtime shape: React UI plus a Rust PTY backend.
- Security shape: do not reopen arbitrary `tauri-plugin-shell` execution. Terminal sessions run through an explicit PTY command API that is gated to super-admin users.
- Inspiration boundary: use Warp as product inspiration only. Do not copy Warp source code, assets, or proprietary visual details into Penguin.

## Product Scope

Users can:

- Open `Terminal` from the main module rail.
- Search, filter, create, and switch tabs from a Warp-style left tab rail.
- See each tab as a compact card with title, cwd, git branch, kind, and status.
- Start a shell session in a chosen working directory.
- Interact with a real terminal pane.
- Resize terminal panes without breaking the PTY.
- Kill a running session.
- Start a local CLI agent session using a configured command such as `codex`, `claude`, `gemini`, or `opencode`.
- See agent work as a block feed: command/run block, output block, assistant response, and elapsed-time divider.
- Submit the next prompt from a bottom composer that stays pinned under the block feed.
- View current and recent runs from a lightweight `Runs` surface.

The module should use top-level mode buttons, matching the pattern used by `Browser` and `Database`:

- `Shell`
- `Agents`
- `Runs`

## Out Of Scope For V1

- Cloud agent orchestration.
- Slack, Linear, GitHub, or webhook triggers.
- Team sharing.
- Full Warp-style shell integration blocks for every shell command.
- Interactive code review panels.
- Automatic Vault secret injection.
- Remote SSH sessions.
- Persistent full terminal transcripts.
- Replacing the system terminal app.

## UX Model

The V1 layout should follow the actual Warp-like UI reference:

- Left: tab rail with search input, filter/settings icon, plus button, and compact tab cards.
- Main top: a meta bar showing runtime/model, cwd, git branch, change count, and elapsed time.
- Main center: block feed for agent tabs; xterm pane for raw shell tabs.
- Main right/top actions: attach context, export/download, filter, and overflow menu as icon buttons with tooltips.
- Main bottom: prompt composer for agent tabs, pinned to the bottom.

No nested card layout is needed. The terminal should occupy the main work surface.

## Architecture

Frontend:

- `src/components/terminal/TerminalPage.tsx` owns module state and mode selection.
- `TerminalTabRail.tsx` lists, filters, and creates tabs.
- `TerminalTopMetaBar.tsx` renders runtime, cwd, branch, change count, and elapsed time.
- `TerminalPane.tsx` wraps xterm.
- `TerminalBlockFeed.tsx` renders agent transcript blocks.
- `TerminalPromptComposer.tsx` submits the next agent prompt.
- `RunHistoryPanel.tsx` shows current/recent session summaries.
- `src/lib/terminal-types.ts` carries shared frontend types.
- `src/lib/terminal-events.ts` carries Tauri event names.

Backend:

- `src-tauri/src/terminal/mod.rs` registers the module.
- `commands.rs` exposes Tauri commands.
- `session.rs` owns session state and lifecycle.
- `pty.rs` wraps `portable-pty`.
- `redact.rs` centralizes lightweight secret redaction for logs and summaries.

Persistence:

- Session metadata lives in SQLite.
- Full terminal output does not persist by default in V1.
- Optional output preview is capped and redacted before persistence.

## Data Flow

Shell session flow:

1. User clicks `Terminal`.
2. User creates a shell tab from the left rail plus button.
3. React calls `terminal_create_session`.
4. Rust creates a PTY session and returns `TerminalSessionInfo`.
5. Rust streams PTY output to the frontend with Tauri events.
6. `TerminalPane` writes output into xterm.
7. User input is sent through `terminal_write`.
8. Resize calls `terminal_resize`.
9. Kill calls `terminal_kill`, then the tab rail updates.

Agent tab flow:

1. User opens the `Agents` mode, which is the default first view for the Terminal module.
2. `TerminalBlockFeed` shows the existing transcript for the tab.
3. `TerminalPromptComposer` starts a new agent with `terminal_start_agent` when no agent session exists, then writes the submitted prompt to that session.
4. For an existing agent session, `TerminalPromptComposer` sends follow-up prompt text through `terminal_write`.
5. PTY output is appended to the active run block.
6. The run block records status, duration, cwd, and capped/redacted output preview.

Agent sessions use the same PTY flow, but the spawn command is a named local CLI command instead of a shell.

## Security Model

Terminal module access requires super-admin, matching the current `REST`, `Docs`, `Browser`, and `Database` tier.

The PTY backend accepts structured payloads:

- `cwd`
- `kind`
- `agent_provider`
- `cols`
- `rows`

The frontend does not pass arbitrary shell scripts to Tauri capability JSON. The backend validates:

- `cwd` must exist and be a directory.
- shell name must be from a local allowlist.
- agent provider must be from a local allowlist.
- output preview is size-capped.
- previews are redacted before persistence.

V1 does not inject Vault secrets into sessions. Future secret use must pass handles and explicit user confirmation.

## Dependencies

Frontend:

- `@xterm/xterm@6.0.0`
- `@xterm/addon-fit@0.11.0`

Backend:

- `portable-pty@0.9.0`

These were checked against current package registries on 2026-06-18.

## Testing

Minimum V1 verification:

- Source tests for module registration and gating.
- Source tests for frontend command contracts.
- Rust unit tests for session validation, redaction, and session metadata.
- TypeScript check.
- Cargo tests.
- Production build.
- Runtime check with `pnpm tauri dev`.

## Future Phases

After V1 is stable:

- Add shell command blocks for structured command/output grouping.
- Add git diff review after agent runs.
- Add context picker from Browser, Database, REST, Vault, and Docs.
- Add safe secret handles from Vault.
- Add resumable agent run summaries.
- Add remote sessions only after local PTY behavior is stable.
