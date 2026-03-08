import { Command } from "@tauri-apps/plugin-shell";
import type { ResponseState, MetadataEntry } from "./store";

export interface SdkCallParams {
  url: string;
  serviceName: string;
  methodName: string;
  body: string;
  metadata: MetadataEntry[];
  packagesDir: string;
}

const SDK_SIDECAR_SCRIPT = `
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');

const sdkLogs = [];
const origLog = console.log;
const origWarn = console.warn;
const origInfo = console.info;
console.log = (...args) => { sdkLogs.push(['log', args.map(stringify).join(' ')]); };
console.warn = (...args) => { sdkLogs.push(['warn', args.map(stringify).join(' ')]); };
console.info = (...args) => { sdkLogs.push(['info', args.map(stringify).join(' ')]); };

function stringify(v) {
  if (v instanceof Error) return v.message + (v.stack ? '\\n' + v.stack : '');
  if (typeof v === 'object' && v !== null) return JSON.stringify(v);
  return String(v);
}

async function run() {
  const input = JSON.parse(process.argv[1]);
  const { url, serviceName, methodName, body, metadata, packagesDir } = input;

  const sdkEntry = path.join(packagesDir, 'node_modules', '@snsoft', 'js-sdk', 'dist', 'bundle.esm.js');
    if (!fs.existsSync(sdkEntry)) {
    process.stdout.write(JSON.stringify({ error: 'SDK not found at ' + sdkEntry, statusCode: 0, body: '', headers: {}, sdkLogs }) + '\\n');
    process.exit(0);
  }

  const meta = (metadata || []).filter(m => m.enabled && m.key).reduce((acc, m) => { acc[m.key] = m.value; return acc; }, {});
  const token = meta.Authorization?.replace(/^Bearer\\s+/i, '') || meta.token || meta.Token || '';
  const playerId = meta.playerId || meta.PlayerId || meta.eId || meta.EId || '';

  let env = 1;
  const urlLower = url.toLowerCase();
  if (urlLower.includes('platform88') || urlLower.includes('client8') || urlLower.includes('fpms88')) {
    env = 3;
  } else if (urlLower.includes('platform99') || urlLower.includes('client9') || urlLower.includes('fpms99')) {
    env = 2;
  } else if (urlLower.includes('platform10') || urlLower.includes('fpms10')) {
    env = 2;
  }

  const baseUrl = url.replace(/\\/?$/, '');
  let domain = '';
  try { domain = new URL(url).hostname; } catch (_) { domain = url.replace(/^https?:\\/\\//, '').replace(/[\\/:].*$/, ''); }

  let targetOrigin;
  try { targetOrigin = new URL(url).origin; } catch (_) { targetOrigin = baseUrl; }

  const origFetch = globalThis.fetch;
  globalThis.fetch = function(innerUrl, opts) {
    let urlStr = typeof innerUrl === 'string' ? innerUrl : innerUrl?.url || '';
    try {
      const parsed = new URL(urlStr);
      const host = parsed.hostname;
      if (host.includes('platform88') || host.includes('platform99') ||
          host.includes('platform10') || host.includes('fpms88') ||
          host.includes('fpms99') || host.includes('fpms10') ||
          host.includes('client8') || host.includes('client9') ||
          host.includes('casinoplus') || host.includes('fpms-nt')) {
        const rewritten = targetOrigin + parsed.pathname + parsed.search;
        sdkLogs.push(['fetch-rewrite', host + parsed.pathname + ' -> ' + rewritten]);
        return origFetch(rewritten, opts);
      }
    } catch (_) {}
    return origFetch(innerUrl, opts);
  };

  try {
    const sdkMod = await import(pathToFileURL(sdkEntry).href);
    const sdk = sdkMod.default || sdkMod;

    const GlobalConfig = sdk.GlobalConfig || sdkMod.GlobalConfig;
    const GC = GlobalConfig;
    if (GC && typeof GC.init === 'function') {
      await GC.init(
        {
          uniqueKey: 'pengvi-' + Date.now(),
          platformId: '50',
          deviceType: 1,
          isNT: true,
          initGrpc: true,
          initWebSocket: false,
          autoEId: false,
          autoAuthenticate: false,
          isDebug: false,
          enableLog: false,
          domain,
          playerInfo: {
            playerId: playerId || undefined,
            token: token || undefined,
          },
        },
        env,
        false
      );
    }

    if (token && GC?.setToken) GC.setToken(token);
    if (playerId && GC?.setPlayerId) GC.setPlayerId(playerId);

    const ServiceClass = sdk[serviceName] || sdkMod[serviceName];
    if (!ServiceClass) {
      process.stdout.write(JSON.stringify({ error: 'Service not found: ' + serviceName, statusCode: 0, body: '', headers: {}, sdkLogs }) + '\\n');
      process.exit(0);
    }

    let reqBody = {};
    try {
      reqBody = JSON.parse(body || '{}');
    } catch (_) {
      try {
        const fixed = (body || '{}')
          .replace(/([{,]\\s*)(\\w+)\\s*:/g, '$1"$2":')
          .replace(/'/g, '"');
        reqBody = JSON.parse(fixed);
      } catch (_2) {
        sdkLogs.push(['warn', 'Failed to parse request body: ' + body]);
      }
    }

    let result;
    let instance;
    try {
      instance = typeof ServiceClass === 'function' ? new ServiceClass() : ServiceClass;
    } catch (initErr) {
      process.stdout.write(JSON.stringify({ error: 'Failed to create service instance: ' + (initErr.message || initErr), statusCode: 0, body: '', headers: {}, sdkLogs }) + '\\n');
      process.exit(0);
    }

    const method = instance[methodName];
    if (typeof method !== 'function') {
      const available = Object.getOwnPropertyNames(instance).filter(k => typeof instance[k] === 'function' && !k.startsWith('_'));
      process.stdout.write(JSON.stringify({ error: 'Method not found: ' + methodName + '. Available: ' + available.join(', '), statusCode: 0, body: '', headers: {}, sdkLogs }) + '\\n');
      process.exit(0);
    }

    result = await method.call(instance, reqBody);

    const fullResult = result && typeof result === 'object' ? result : { data: result };
    const baseStatus = fullResult.baseResponse?.status || fullResult.status;
    const isError = baseStatus && baseStatus !== 'STATUS_SUCCESS' && baseStatus !== 200 && baseStatus !== '200';
    const statusCode = isError ? (fullResult.baseResponse?.status || fullResult.statusCode || 400) : 200;

    process.stdout.write(JSON.stringify({
      statusCode,
      body: JSON.stringify(fullResult),
      headers: {},
      sdkLogs,
      error: isError ? (fullResult.baseResponse?.message || fullResult.message || fullResult.error || '') : undefined,
    }) + '\\n');
  } catch (err) {
    const errObj = err && typeof err === 'object' ? err : { message: String(err) };
    const msg = errObj.message || errObj.msg || errObj.error || JSON.stringify(errObj);
    const code = errObj.status ?? errObj.statusCode ?? errObj.code ?? 0;
    process.stdout.write(JSON.stringify({ error: msg, statusCode: code, body: '', headers: {}, sdkLogs }) + '\\n');
  }
  process.exit(0);
}

run();
`;

export async function callSdk(params: SdkCallParams): Promise<ResponseState> {
  const startTime = performance.now();

  try {
    const request = {
      url: params.url,
      serviceName: params.serviceName,
      methodName: params.methodName,
      body: params.body,
      metadata: params.metadata,
      packagesDir: params.packagesDir,
    };

    const fullScript = `process.argv[1] = ${JSON.stringify(JSON.stringify(request))};\n${SDK_SIDECAR_SCRIPT}`;
    const b64 = btoa(unescape(encodeURIComponent(fullScript)));
    const cmd = Command.create("zsh-login", [
      "-l", "-c",
      `echo "${b64}" | base64 -d | node -`,
    ]);

    const output = await cmd.execute();
    const duration = performance.now() - startTime;

    if (output.code !== 0) {
      return {
        status: "ERROR",
        statusCode: 0,
        body: "",
        headers: {},
        duration: Math.round(duration),
        error: output.stderr || "Node sidecar process failed",
      };
    }

    const lines = output.stdout.trim().split("\n");
    let lastJson = "";
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith("{") && line.endsWith("}")) {
        lastJson = line;
        break;
      }
    }

    if (!lastJson) {
      return {
        status: "ERROR",
        statusCode: 0,
        body: output.stdout,
        headers: {},
        duration: Math.round(duration),
        error: "No JSON response from SDK sidecar",
      };
    }

    let result: {
      error?: string;
      statusCode?: number;
      body?: string;
      headers?: Record<string, string>;
      sdkLogs?: unknown[];
    };

    try {
      result = JSON.parse(lastJson);
    } catch {
      return {
        status: "ERROR",
        statusCode: 0,
        body: lastJson,
        headers: {},
        duration: Math.round(duration),
        error: "Invalid JSON in sidecar output",
      };
    }

    const headers: Record<string, string> = { ...(result.headers || {}) };
    if (result.sdkLogs && Array.isArray(result.sdkLogs)) {
      headers["x-sdk-logs"] = JSON.stringify(result.sdkLogs);
    }

    return {
      status: result.error ? `SDK ${result.statusCode ?? 0}` : "OK",
      statusCode: result.statusCode ?? 0,
      body: result.body ?? "",
      headers,
      duration: Math.round(duration),
      error: result.error,
    };
  } catch (error) {
    const duration = performance.now() - startTime;
    return {
      status: "ERROR",
      statusCode: 0,
      body: "",
      headers: {},
      duration: Math.round(duration),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
