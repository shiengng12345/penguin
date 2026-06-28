import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

// Load sidecar.ts with @tauri-apps/plugin-shell swapped for a mock whose
// Command.create defers to globalThis.__sidecarMockCreate, so each test can
// script the shell's behavior and record spawns.
async function loadSidecarModule() {
  const source = await readFile(new URL("../src/lib/sidecar.ts", import.meta.url), "utf8");
  const mockSource = "export const Command = { create: (...args) => globalThis.__sidecarMockCreate(...args) };";
  const mockUrl = `data:text/javascript;base64,${Buffer.from(mockSource).toString("base64")}`;
  const patched = source.replace('"@tauri-apps/plugin-shell"', JSON.stringify(mockUrl));
  const { outputText } = ts.transpileModule(patched, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const encoded = Buffer.from(outputText).toString("base64");
  // Cache-bust per call so each test gets fresh module state.
  return import(`data:text/javascript;base64,${encoded}#${Math.random()}`);
}

// args is ["-c", script] for plain shells and ["-l", "-c", script] for login
// shells — the script is always last.
function shellScriptOf(args) {
  return args[args.length - 1];
}

// Emulates the plugin-shell Command surface used by sidecar.ts: execute()
// for path resolution, and spawn()/on()/stdout.on()/stderr.on()/kill() for
// script runs. The handler returns {stdout, stderr, code} or {hang: true}.
function mockShell(handler) {
  const calls = [];
  globalThis.__sidecarMockCreate = (name, args) => {
    const call = { name, args, script: shellScriptOf(args), killed: false };
    calls.push(call);
    const handlers = {};
    return {
      stdout: { on: (_ev, cb) => { handlers.stdout = cb; } },
      stderr: { on: (_ev, cb) => { handlers.stderr = cb; } },
      on: (ev, cb) => { handlers[ev] = cb; },
      execute: async () => {
        const r = handler(call) ?? {};
        return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.code ?? 0 };
      },
      spawn: async () => {
        const r = handler(call) ?? {};
        const child = {
          kill: async () => {
            call.killed = true;
            handlers.close?.({ code: null });
          },
        };
        if (!r.hang) {
          queueMicrotask(() => {
            if (r.stdout) handlers.stdout?.(r.stdout);
            if (r.stderr) handlers.stderr?.(r.stderr);
            handlers.close?.({ code: r.code ?? 0 });
          });
        }
        return child;
      },
    };
  };
  return calls;
}

test("getNodePath resolves via login shell once and caches", async () => {
  const sidecar = await loadSidecarModule();
  const calls = mockShell(() => ({ stdout: "/opt/homebrew/bin/node\n", code: 0 }));

  const first = await sidecar.getNodePath();
  const second = await sidecar.getNodePath();

  assert.equal(first, "/opt/homebrew/bin/node");
  assert.equal(second, "/opt/homebrew/bin/node");
  assert.equal(calls.length, 1, "second call must hit the cache, not spawn another login shell");
  assert.equal(calls[0].name, "node-path", "node resolution must use the dedicated capability command");
  assert.equal(calls[0].args[0], "-l", "resolution must run in a login shell");
});

test("concurrent getNodePath calls share one resolution", async () => {
  const sidecar = await loadSidecarModule();
  const calls = mockShell(() => ({ stdout: "/usr/local/bin/node\n", code: 0 }));

  const [a, b] = await Promise.all([sidecar.getNodePath(), sidecar.getNodePath()]);

  assert.equal(a, "/usr/local/bin/node");
  assert.equal(b, "/usr/local/bin/node");
  assert.equal(calls.length, 1);
});

test("runNodeScript uses fast non-login shell once node path is known", async () => {
  const sidecar = await loadSidecarModule();
  const calls = mockShell(({ args }) => {
    if (args[0] === "-l") return { stdout: "/opt/homebrew/bin/node\n", code: 0 };
    return { stdout: '{"ok":true}', code: 0 };
  });

  const result = await sidecar.runNodeScript("console.log('hi')");

  assert.equal(result.code, 0);
  assert.equal(result.stdout, '{"ok":true}');
  const runCall = calls[calls.length - 1];
  assert.equal(runCall.name, "node-eval", "fast sidecar runs must use the scoped node-eval command");
  assert.equal(runCall.args[0], "-c", "script run must avoid the login shell");
  assert.ok(
    runCall.script.includes('exec "/opt/homebrew/bin/node" -e'),
    "must exec the cached absolute node path so kill() reaches node itself",
  );
});

test("runNodeScript falls back to login shell when cached path is stale (exit 127)", async () => {
  const sidecar = await loadSidecarModule();
  const calls = mockShell(({ args, script }) => {
    if (args[0] === "-l" && script.includes("command -v node")) {
      return { stdout: "/stale/node\n", code: 0 };
    }
    if (args[0] === "-c") {
      return { stderr: "zsh: command not found: /stale/node", code: 127 };
    }
    // login-shell fallback run
    return { stdout: '{"recovered":true}', code: 0 };
  });

  const result = await sidecar.runNodeScript("console.log('hi')");

  assert.equal(result.code, 0);
  assert.equal(result.stdout, '{"recovered":true}');
  assert.equal(calls.length, 3, "resolve + fast attempt + login fallback");
  const fallback = calls[calls.length - 1];
  assert.equal(fallback.name, "node-eval-login", "fallback must use the scoped login sidecar command");
  assert.equal(fallback.args[0], "-l", "stale path must fall back to a login shell run");
  assert.ok(fallback.script.includes("exec node -e"), "fallback resolves node from PATH");
});

test("aborting runNodeScript kills the spawned node process", async () => {
  const sidecar = await loadSidecarModule();
  const calls = mockShell(({ args }) => {
    if (args[0] === "-l") return { stdout: "/opt/homebrew/bin/node\n", code: 0 };
    return { hang: true };
  });

  const controller = new AbortController();
  const pending = sidecar.runNodeScript("setInterval(() => {}, 1000)", controller.signal);
  await new Promise((r) => setTimeout(r, 10));
  controller.abort();

  await assert.rejects(pending, (err) => err.name === "AbortError");
  assert.equal(calls[calls.length - 1].killed, true, "abort must kill the child process");
});

test("NODE_PATH_SETUP is single-sourced from sidecar.ts", async () => {
  const sidecar = await loadSidecarModule();
  assert.ok(sidecar.NODE_PATH_SETUP.includes("nvm.sh"));
  assert.ok(sidecar.NODE_PATH_SETUP.includes("VOLTA_HOME"));

  for (const rel of ["../src/lib/package-manager.ts", "../src/components/vault/vault-lark.ts"]) {
    const consumer = await readFile(new URL(rel, import.meta.url), "utf8");
    assert.ok(
      !consumer.includes("const NODE_PATH_SETUP ="),
      `${rel} must import NODE_PATH_SETUP from sidecar.ts, not redefine it`,
    );
    assert.match(consumer, /NODE_PATH_SETUP.*from ["']@?\/?(lib\/)?sidecar["']|from ["']\.\/sidecar["']|@\/lib\/sidecar/);
  }
});

test("grpc-native and sdk clients run through the shared sidecar runner with abort support", async () => {
  for (const rel of ["../src/lib/grpc-native-client.ts", "../src/lib/sdk-client.ts"]) {
    const source = await readFile(new URL(rel, import.meta.url), "utf8");
    assert.ok(source.includes("runNodeScript"), `${rel} must use runNodeScript from sidecar.ts`);
    assert.ok(source.includes("signal?: AbortSignal"), `${rel} must accept an AbortSignal`);
    assert.ok(
      !source.includes('echo "${b64}"'),
      `${rel} must not roll its own base64-pipe runner`,
    );
  }

  // RequestPanel must actually pass its abort controller down.
  const panel = await readFile(new URL("../src/components/request/RequestPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /callGrpcNative\(\{[\s\S]*?\}, controller\.signal\)/);
  assert.match(panel, /callSdk\(\{[\s\S]*?\}, controller\.signal\)/);
});
