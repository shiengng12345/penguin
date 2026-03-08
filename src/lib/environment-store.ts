import type { Environment } from "./store";

export function interpolate(
  template: string,
  env: Environment | null
): string {
  if (!env) return template;

  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const variable = env.variables.find(
      (v) => v.key.toLowerCase() === key.toLowerCase()
    );
    return variable?.value ?? `{{${key}}}`;
  });
}

export function generateEnvId(): string {
  return `env_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const DEFAULT_ENVIRONMENTS: Environment[] = [
  {
    id: generateEnvId(),
    name: "LOCAL",
    color: "green",
    variables: [
      { key: "URL", value: "http://localhost:8080" },
      { key: "TOKEN", value: "" },
    ],
  },
];
