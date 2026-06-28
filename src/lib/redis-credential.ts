// Parse a Vault credential value (kind=cache / baseKind=cache) into
// the fields redis_connect needs. Supports three storage formats:
//
//   1. JSON:   {"host":"...","port":6379,"password":"...","db":0}
//   2. URI:    redis://[:password@]host[:port][/db]
//   3. Delimited: host:port||password  (same pattern as ArgoCD)
//   4. Bare:   host:port  (no password)

export interface RedisCred {
  host: string;
  port: number;
  password: string;
  db: number;
}

export function parseRedisCredValue(raw: string): RedisCred | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // 1. JSON
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      const host = typeof obj.host === "string" ? obj.host : null;
      if (host !== null && host.length > 0) {
        return {
          host,
          port: typeof obj.port === "number" ? obj.port : 6379,
          password: typeof obj.password === "string" ? obj.password : "",
          db: typeof obj.db === "number" ? obj.db : 0,
        };
      }
    } catch {
      // fall through
    }
  }

  // 2. Redis URI: redis://[:password@]host[:port][/db]
  if (trimmed.startsWith("redis://")) {
    try {
      const url = new URL(trimmed);
      return {
        host: url.hostname || "127.0.0.1",
        port: url.port ? parseInt(url.port, 10) : 6379,
        password: url.password ?? "",
        db: url.pathname && url.pathname.length > 1
          ? parseInt(url.pathname.slice(1), 10) || 0
          : 0,
      };
    } catch {
      // fall through
    }
  }

  // 3. Delimited: host:port||password
  const pipeIdx = trimmed.indexOf("||");
  if (pipeIdx !== -1) {
    const left = trimmed.slice(0, pipeIdx).trim();
    const password = trimmed.slice(pipeIdx + 2).trim();
    const parsed = parseHostPort(left);
    if (parsed !== null) return { ...parsed, password, db: 0 };
  }

  // 4. Bare: host:port  (no password)
  const parsed = parseHostPort(trimmed);
  if (parsed !== null) return { ...parsed, password: "", db: 0 };

  return null;
}

function parseHostPort(s: string): { host: string; port: number } | null {
  const lastColon = s.lastIndexOf(":");
  if (lastColon <= 0) {
    // no colon — treat whole string as host, default port
    if (s.length > 0) return { host: s, port: 6379 };
    return null;
  }
  const host = s.slice(0, lastColon).trim();
  const portStr = s.slice(lastColon + 1).trim();
  const port = parseInt(portStr, 10);
  if (host.length === 0 || isNaN(port)) return null;
  return { host, port };
}
