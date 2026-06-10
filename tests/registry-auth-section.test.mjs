import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const SECTION_URL = new URL(
  "../src/components/settings/RegistryAuthSection.tsx",
  import.meta.url,
);
const SETTINGS_DIALOG_URL = new URL(
  "../src/components/settings/SettingsDialog.tsx",
  import.meta.url,
);

test("RegistryAuthSection 组件文件存在并导出锁定组件", async () => {
  const source = await readFile(SECTION_URL, "utf8");
  assert.match(source, /export function RegistryAuthSection\(\)/);
});

test("RegistryAuthSection 挂载时读取 registry 状态", async () => {
  const source = await readFile(SECTION_URL, "utf8");
  assert.match(source, /invoke<ConfiguredStatus>\(\s*READ_STATUS_COMMAND\s*\)/);
  assert.match(source, /read_registry_npmrc_status/);
});

test("RegistryAuthSection 保存时写入 registry URL + 凭证", async () => {
  const source = await readFile(SECTION_URL, "utf8");
  assert.match(
    source,
    /invoke<WriteRegistryNpmrcResult>\(\s*WRITE_NPMRC_COMMAND,\s*\{\s*registryUrl:\s*trimmedUrl,\s*username,\s*password,?\s*\}\s*\)/,
  );
  assert.match(source, /write_registry_npmrc/);
});

test("RegistryAuthSection 暴露 Registry URL 字段", async () => {
  const source = await readFile(SECTION_URL, "utf8");
  assert.match(source, /const \[registryUrl, setRegistryUrl\] = useState/);
  assert.match(source, /handleRegistryUrlChange/);
  assert.match(source, /REGISTRY_URL_LABEL/);
});

test("RegistryAuthSection 状态类型包含 registry_url 字段", async () => {
  const source = await readFile(SECTION_URL, "utf8");
  assert.match(
    source,
    /type ConfiguredStatus = \{[^}]*registry_url:\s*string\s*\|\s*null[^}]*\}/,
  );
});

test("SettingsDialog 在 DeveloperModeSection 后挂载 RegistryAuthSection", async () => {
  const source = await readFile(SETTINGS_DIALOG_URL, "utf8");
  assert.match(source, /import\s*\{\s*RegistryAuthSection\s*\}/);
  assert.match(
    source,
    /<DeveloperModeSection\s*\/>\s*\n\s*<RegistryAuthSection\s*\/>/,
  );
});
