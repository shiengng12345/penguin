// Vault-integrated Redis sidebar. Shows every project+env that has a
// credential with kind=cache (or baseKind=cache), grouped by project.
// Clicking an env row parses the credential value and calls redis_connect
// automatically — no manual host/port form needed.

import { invoke } from "@tauri-apps/api/core";
import { ChevronDown, ChevronRight, Database } from "lucide-react";
import { useCallback, useState, type ReactElement } from "react";
import { useAppStore } from "@/lib/store";
import { parseRedisCredValue } from "@/lib/redis-credential";
import type { ConnectResult } from "@/lib/redis-types";
import type { VaultProject, VaultEnv, VaultCredential } from "@/components/vault/types";
import { cn } from "@/lib/utils";

interface ConnectingState {
  projectId: string;
  envId: string;
}

interface RedisSidebarProps {
  activeKey: string | null;  // "projectId:envId"
  onConnected: (key: string) => void;
  onError: (msg: string) => void;
}

interface RedisEnvEntry {
  project: VaultProject;
  env: VaultEnv;
  cred: VaultCredential;
  key: string;  // "projectId:envId"
}

function getRedisEntries(projects: VaultProject[]): RedisEnvEntry[] {
  const entries: RedisEnvEntry[] = [];
  for (const project of projects) {
    for (const cred of project.credentials) {
      const isCache =
        cred.kind === "cache" ||
        project.kinds?.find((k) => k.id === cred.kind)?.baseKind === "cache";
      if (!isCache) continue;
      for (const env of project.environments) {
        const raw = cred.valueByEnv[env.id] ?? "";
        if (raw.trim().length === 0) continue;
        entries.push({
          project,
          env,
          cred,
          key: `${project.id}:${env.id}`,
        });
      }
    }
  }
  return entries;
}

export function RedisSidebar({
  activeKey,
  onConnected,
  onError,
}: RedisSidebarProps): ReactElement {
  const vaultProjects = useAppStore((s) => s.vaultProjects);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [connecting, setConnecting] = useState<ConnectingState | null>(null);

  const entries = getRedisEntries(vaultProjects);

  // Group by project
  const grouped = new Map<string, { project: VaultProject; rows: RedisEnvEntry[] }>();
  for (const e of entries) {
    const existing = grouped.get(e.project.id);
    if (existing !== undefined) {
      existing.rows.push(e);
    } else {
      grouped.set(e.project.id, { project: e.project, rows: [e] });
    }
  }

  const handleSelect = useCallback(
    async (entry: RedisEnvEntry) => {
      if (connecting !== null) return;
      const raw = entry.cred.valueByEnv[entry.env.id] ?? "";
      const cred = parseRedisCredValue(raw);
      if (cred === null) {
        onError(
          `Cannot parse Redis credential for ${entry.project.name} / ${entry.env.name}. ` +
            "Expected format: host:port||password, redis://..., or JSON {host,port,password,db}.",
        );
        return;
      }
      setConnecting({ projectId: entry.project.id, envId: entry.env.id });
      try {
        const result = await invoke<ConnectResult>("redis_connect", {
          host: cred.host,
          port: cred.port,
          password: cred.password,
          db: cred.db,
        });
        if (result.ok) {
          onConnected(entry.key);
        } else {
          onError(
            `Failed to connect to ${entry.project.name} / ${entry.env.name}: ${result.error ?? "unknown error"}`,
          );
        }
      } catch (e) {
        onError(String(e));
      } finally {
        setConnecting(null);
      }
    },
    [connecting, onConnected, onError],
  );

  if (entries.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Database className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-xs text-muted-foreground">
          No Redis credentials found.
        </p>
        <p className="text-[11px] text-muted-foreground/60">
          Add a credential with kind <strong>Cache / Redis</strong> to a Vault project, then come back here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto py-1">
      {[...grouped.entries()].map(([projectId, { project, rows }]) => {
        const isOpen = !collapsed.has(projectId);
        return (
          <div key={projectId}>
            {/* Project group header */}
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(projectId)) next.delete(projectId);
                  else next.add(projectId);
                  return next;
                })
              }
            >
              {isOpen ? (
                <ChevronDown className="h-3 w-3 shrink-0" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0" />
              )}
              <span className="truncate uppercase tracking-wide">{project.name}</span>
            </button>

            {/* Env rows */}
            {isOpen
              ? rows.map((entry) => {
                  const isActive = activeKey === entry.key;
                  const isConnecting =
                    connecting?.projectId === entry.project.id &&
                    connecting.envId === entry.env.id;
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      disabled={connecting !== null}
                      onClick={() => handleSelect(entry)}
                      className={cn(
                        "flex w-full items-center gap-2 px-4 py-1.5 text-xs transition-colors disabled:cursor-not-allowed",
                        isActive
                          ? "bg-primary/10 text-foreground"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          entry.env.color || "bg-muted-foreground/40",
                          isActive && "ring-1 ring-primary/50",
                        )}
                      />
                      <span className="flex-1 truncate text-left">
                        {entry.env.name}
                      </span>
                      {isConnecting ? (
                        <span className="shrink-0 text-[10px] text-primary animate-pulse">
                          Connecting…
                        </span>
                      ) : isActive ? (
                        <span className="shrink-0 text-[10px] text-emerald-400">●</span>
                      ) : null}
                    </button>
                  );
                })
              : null}
          </div>
        );
      })}
    </div>
  );
}
