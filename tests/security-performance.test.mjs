import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

async function loadSource(relPath) {
  return readFile(new URL(relPath, import.meta.url), "utf8");
}

test("generic app_kv commands never expose reserved secret keys", async () => {
  const db = await loadSource("../src-tauri/src/db.rs");
  const keychain = await loadSource("../src-tauri/src/rest/keychain.rs");
  const mcpAppDb = await loadSource("../packages/mcp/src/app-db.ts");

  assert.match(db, /const SENSITIVE_APP_VALUE_PREFIXES:/);
  assert.match(db, /fn is_sensitive_app_value_key\(/);
  assert.match(db, /"rest:secret:"/);
  assert.match(db, /"redis:secret:"/);
  assert.match(db, /pub\(crate\) fn app_value_set_internal\(/);
  assert.match(db, /pub\(crate\) fn app_value_get_internal\(/);
  assert.match(db, /pub\(crate\) fn app_value_delete_internal\(/);
  assert.match(db, /WHERE key NOT LIKE 'rest:secret:%'/);
  assert.match(db, /db_get_app_value[\s\S]*?reject_sensitive_app_value_key\(&key\)/);
  assert.match(db, /db_set_app_value[\s\S]*?reject_sensitive_app_value_key\(&key\)/);
  assert.match(db, /db_delete_app_value[\s\S]*?reject_sensitive_app_value_key\(&key\)/);
  assert.match(keychain, /app_value_set_internal/);
  assert.match(keychain, /app_value_get_internal/);
  assert.match(keychain, /app_value_delete_internal/);
  assert.doesNotMatch(keychain, /crate::db::db_set_app_value/);
  assert.doesNotMatch(keychain, /crate::db::db_get_app_value/);
  assert.match(mcpAppDb, /SENSITIVE_APP_VALUE_PREFIXES/);
  assert.match(mcpAppDb, /isSensitiveAppValueKey/);
  assert.match(mcpAppDb, /if \(key && !isSensitiveAppValueKey\(key\)\)/);
});

test("Tauri shell capability does not expose arbitrary zsh scripts", async () => {
  const capabilities = await loadSource("../src-tauri/capabilities/default.json");
  const sidecar = await loadSource("../src/lib/sidecar.ts");
  const packageManager = await loadSource("../src/lib/package-manager.ts");
  const grpcNative = await loadSource("../src/lib/grpc-native-client.ts");
  const vaultLark = await loadSource("../src/components/vault/vault-lark.ts");

  assert.doesNotMatch(capabilities, /\(\?s\)\.\+/);
  assert.doesNotMatch(capabilities, /"name":\s*"zsh"/);
  assert.doesNotMatch(capabilities, /"name":\s*"zsh-login"/);
  for (const commandName of [
    "node-path",
    "node-eval",
    "node-eval-login",
    "npm-package",
    "grpc-deps",
    "lark-fetch",
    "lark-update",
  ]) {
    assert.match(capabilities, new RegExp(`"name":\\s*"${commandName}"`));
  }

  assert.match(sidecar, /Command\.create\("node-path"/);
  assert.match(sidecar, /Command\.create\("node-eval"/);
  assert.match(sidecar, /Command\.create\("node-eval-login"/);
  assert.match(packageManager, /Command\.create\("npm-package"/);
  assert.match(grpcNative, /Command\.create\("grpc-deps"/);
  assert.match(vaultLark, /Command\.create\("lark-fetch"/);
  assert.match(vaultLark, /Command\.create\("lark-update"/);
});

test("HTTP proxy and REST sender stream responses through explicit byte caps", async () => {
  const proxy = await loadSource("../src-tauri/src/proxy.rs");
  const rest = await loadSource("../src-tauri/src/rest/commands.rs");
  const cargo = await loadSource("../src-tauri/Cargo.toml");

  assert.match(cargo, /reqwest = \{ version = "0\.12", features = \[[^\]]*"stream"/);
  assert.match(proxy, /const MAX_PROXY_RESPONSE_BYTES:/);
  assert.match(proxy, /const PROXY_TIMEOUT_SECS:/);
  assert.match(proxy, /\.timeout\(std::time::Duration::from_secs\(PROXY_TIMEOUT_SECS\)\)/);
  assert.match(proxy, /read_response_with_cap\(/);
  assert.match(proxy, /response\.chunk\(\)\.await/);
  assert.doesNotMatch(proxy, /response\.bytes\(\)\.await/);

  assert.match(rest, /read_response_with_cap\(/);
  assert.match(rest, /ResponseBytes/);
  assert.match(rest, /response\.chunk\(\)\.await/);
  assert.doesNotMatch(rest, /response\.bytes\(\)\.await/);
});

test("Redis Set paging passes cursor through Rust instead of restarting SSCAN", async () => {
  const commands = await loadSource("../src-tauri/src/redis/commands.rs");
  const setValue = await loadSource("../src/components/redis/values/RedisSetValue.tsx");

  assert.match(commands, /pub async fn redis_set_members\([\s\S]*?cursor:\s*u64/);
  assert.match(commands, /CustomCommand::new_static\("SSCAN"/);
  assert.match(commands, /cursor\.to_string\(\)/);
  assert.match(setValue, /cursor,\s*count:\s*100/);
});

test("Redis secrets and large values are not exposed through broad payloads", async () => {
  const connection = await loadSource("../src-tauri/src/redis/connection.rs");
  const commands = await loadSource("../src-tauri/src/redis/commands.rs");
  const types = await loadSource("../src/lib/redis-types.ts");
  const panel = await loadSource("../src/components/redis/RedisConnectionPanel.tsx");
  const lib = await loadSource("../src-tauri/src/lib.rs");

  assert.match(connection, /const REDIS_SECRET_PREFIX:/);
  assert.match(connection, /app_value_set_internal/);
  assert.match(connection, /app_value_get_internal/);
  assert.match(connection, /pub has_password:\s*bool/);
  assert.doesNotMatch(connection, /pub password:\s*String/);
  assert.doesNotMatch(types, /password:\s*string/);
  assert.match(types, /has_password:\s*boolean/);
  assert.match(commands, /pub async fn redis_connect_saved\(/);
  assert.match(lib, /redis::commands::redis_connect_saved/);
  assert.match(panel, /"redis_connect_saved"/);
  assert.doesNotMatch(panel, /c\.password/);

  assert.match(commands, /CustomCommand::new_static\("STRLEN"/);
  assert.match(commands, /CustomCommand::new_static\("GETRANGE"/);
  assert.doesNotMatch(commands, /c\.get\(&key\)/);
  assert.match(commands, /CustomCommand::new_static\("HSCAN"/);
  assert.doesNotMatch(commands, /hgetall\(&key\)/);
});

test("Tauri security config uses a real CSP instead of disabling it", async () => {
  const config = await loadSource("../src-tauri/tauri.conf.json");
  const capabilities = await loadSource("../src-tauri/capabilities/default.json");

  assert.doesNotMatch(config, /"csp":\s*null/);
  assert.match(config, /"csp":\s*"default-src 'self'/);
  assert.match(capabilities, /"args":\s*\[/);
  assert.doesNotMatch(capabilities, /"cmd": "\/bin\/zsh", "args": true/);
});

test("Browser link entry and native child webview only allow http(s) URLs", async () => {
  const jenkins = await loadSource("../src/components/browser/JenkinsSidebar.tsx");
  const inline = await loadSource("../src-tauri/src/inline_webview.rs");

  assert.match(jenkins, /isHttpUrl\(u\)/);
  assert.match(inline, /fn parse_http_webview_url/);
  assert.match(inline, /unsupported inline webview URL scheme/);
});

test("Package install backs off and retries on a lingering ETARGET (publish-race)", async () => {
  const pm = await loadSource("../src/lib/package-manager.ts");
  // Backoff schedule exists with at least two escalating waits.
  assert.match(pm, /ETARGET_RETRY_DELAYS_MS\s*=\s*\[/);
  assert.match(pm, /30_000/);
  assert.match(pm, /60_000/);
  // The retry loop must be gated on the stale/ETARGET detector — never an
  // unconditional retry that would loop on real failures (auth, network).
  assert.match(pm, /isLikelyStalePackument\(result\)\s*&&\s*attempt\s*<\s*ETARGET_RETRY_DELAYS_MS\.length/);
  // It must actually wait between retries.
  assert.match(pm, /await delay\(waitMs\)/);
});
