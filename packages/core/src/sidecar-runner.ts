// Abstraction over how the host runs a Node.js sidecar script. Penguin desktop
// implements this with @tauri-apps/plugin-shell Command (`zsh-login -l -c`),
// Node consumers (MCP server, CLI, CI) implement with child_process.spawn.
// Core never reaches for either directly — that keeps the protocol clients
// usable in both environments without polyfills.

export interface SidecarOutput {
  stdout: string;
  stderr: string;
  code: number;
}

// Receives the full Node.js script (with input already prepended) and runs it
// in a fresh process. Caller is expected to use `node -` with the script
// streamed in via stdin (the existing Penguin pattern), or any equivalent.
export type SidecarRunner = (script: string) => Promise<SidecarOutput>;
