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
- Start a shell session in a chosen working directory.
- See local sessions in a vertical session rail with status, cwd, and created time.
- Interact with a real terminal pane.
- Resize terminal panes without breaking the PTY.
- Kill a running session.
- Start a local CLI agent session using a configured command such as `codex`, `claude`, `gemini`, or `opencode`.
- View a lightweight `Runs` list that summarizes current and recent sessions.

The module should use top-level mode buttons, matching the pattern used by `Browser` and `Database`:

- `Shell`
- `Agents`
- `Runs`

## Out Of Scope For V1

- Cloud agent orchestration.
- Slack, Linear, GitHub, or webhook triggers.
- Team sharing.
- Full Warp-style shell integration blocks for every command.
- Interactive code review panels.
- Automatic Vault secret injection.
- Remote SSH sessions.
- Persistent full terminal transcripts.
- Replacing the system terminal app.

## UX Model

The V1 layout is a dense workbench, not a marketing page:

- Left: session rail, similar in density to existing Penguin sidebars.
- Top: mode buttons and session actions.
- Center: xterm terminal pane.
- Right: collapsible inspector with session metadata and agent launch controls.
- Bottom/status area: reuse existing app status language where practical.

No nested card layout is needed. The terminal should occupy the main work surface.

## Architecture

Frontend:

- `src/components/terminal/TerminalPage.tsx` owns module state and mode selection.
- `TerminalSessionRail.tsx` lists sessions.
- `TerminalPane.tsx` wraps xterm.
- `AgentLauncher.tsx` starts local CLI agent sessions.
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

1. User clicks `Terminal`.
2. React calls `terminal_create_session`.
3. Rust creates a PTY session and returns `TerminalSessionInfo`.
4. Rust streams PTY output to the frontend with Tauri events.
5. `TerminalPane` writes output into xterm.
6. User input is sent through `terminal_write`.
7. Resize calls `terminal_resize`.
8. Kill calls `terminal_kill`, then the session rail updates.

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

- Add command blocks for structured command/output grouping.
- Add git diff review after agent runs.
- Add context picker from Browser, Database, REST, Vault, and Docs.
- Add safe secret handles from Vault.
- Add resumable agent run summaries.
- Add remote sessions only after local PTY behavior is stable.
