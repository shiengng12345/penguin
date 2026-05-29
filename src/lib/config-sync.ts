export type ConfigProtocol = "grpc-web" | "grpc" | "sdk" | "rest";

export interface ConfigEnvironment {
  name: string;
  color?: string;
  variables?: Record<string, string>;
}

export interface ConfigProtocolSection {
  environments?: ConfigEnvironment[];
  packages?: string[];
}

export type ConfigShape = Record<string, ConfigProtocolSection | undefined>;

export interface EnvVariable {
  key: string;
  value: string;
}

export interface Environment {
  id: string;
  name: string;
  color: string;
  variables: EnvVariable[];
}

export interface ConfigSyncConflict {
  name: string;
  local: Environment;
  remote: Environment;
}

export interface ConfigSyncResult {
  environments: Environment[];
  added: string[];
  skipped: string[];
  conflicts: ConfigSyncConflict[];
  changed: boolean;
}

export const REMOTE_CONFIG_URL =
  "https://raw.githubusercontent.com/shiengng12345/penguin/main/config/penguin.remote-config.json";

interface FetchLikeResponse {
  ok: boolean;
  status?: number;
  statusText?: string;
  text: () => Promise<string>;
}

type FetchLike = (url: string) => Promise<FetchLikeResponse>;

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

function slugify(value: string): string {
  return normalizeName(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "environment";
}

function variablesFromRecord(variables?: Record<string, string>): EnvVariable[] {
  return Object.entries(variables ?? {}).map(([key, value]) => ({ key, value }));
}

function variablesKey(variables: EnvVariable[]): string {
  return variables
    .map((entry) => [entry.key.trim(), entry.value] as const)
    .filter(([key]) => key.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}\u0000${value}`)
    .join("\u0001");
}

export function parseConfig(raw: string): ConfigShape {
  const parsed = JSON.parse(raw) as ConfigShape;
  return parsed && typeof parsed === "object" ? parsed : {};
}

export function configEnvsForProtocol(
  config: ConfigShape,
  protocol: ConfigProtocol,
): ConfigEnvironment[] {
  const environments = config[protocol]?.environments;
  return Array.isArray(environments) ? environments : [];
}

export function configEnvToEnvironment(
  cfg: ConfigEnvironment,
  protocol: ConfigProtocol,
): Environment {
  const name = cfg.name.trim();
  return {
    id: `remote-${protocol}-${slugify(name)}`,
    name,
    color: cfg.color ?? "green",
    variables: variablesFromRecord(cfg.variables),
  };
}

export function mergeConfigEnvironments(
  existing: Environment[],
  configEnvs: ConfigEnvironment[],
  protocol: ConfigProtocol,
): ConfigSyncResult {
  const environments = [...existing];
  const byName = new Map(existing.map((env) => [normalizeName(env.name), env]));
  const added: string[] = [];
  const skipped: string[] = [];
  const conflicts: ConfigSyncConflict[] = [];

  for (const cfg of configEnvs) {
    const remote = configEnvToEnvironment(cfg, protocol);
    const local = byName.get(normalizeName(remote.name));
    if (!local) {
      environments.push(remote);
      byName.set(normalizeName(remote.name), remote);
      added.push(remote.name);
      continue;
    }

    if (variablesKey(local.variables) === variablesKey(remote.variables)) {
      skipped.push(remote.name);
    } else {
      conflicts.push({ name: remote.name, local, remote });
    }
  }

  return {
    environments,
    added,
    skipped,
    conflicts,
    changed: added.length > 0,
  };
}

export async function fetchRemoteConfig(
  fetchImpl: FetchLike = globalThis.fetch,
  url = REMOTE_CONFIG_URL,
): Promise<ConfigShape> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    const status = response.status ? `HTTP ${response.status}` : "request failed";
    const statusText = response.statusText ? ` ${response.statusText}` : "";
    throw new Error(`Failed to pull latest config: ${status}${statusText}`);
  }
  return parseConfig(await response.text());
}
