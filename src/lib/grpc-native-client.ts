import { Command } from "@tauri-apps/plugin-shell";
import type { ResponseState, MetadataEntry } from "./store";
import { ensurePackagesDir } from "./package-manager";

interface GrpcNativeCallParams {
  url: string;
  servicePath: string;
  body: string;
  metadata: MetadataEntry[];
  packagesDir: string;
}

let depsInstalled = false;

async function ensureGrpcDeps(): Promise<void> {
  if (depsInstalled) return;

  const dir = await ensurePackagesDir("grpc");
  const check = Command.create("zsh-login", [
    "-l", "-c",
    `cd ${JSON.stringify(dir)} && npm ls @grpc/grpc-js --json`,
  ]);
  const out = await check.execute();
  const needsInstall =
    out.code !== 0 || !out.stdout.includes("@grpc/grpc-js");

  if (needsInstall) {
    const install = Command.create("zsh-login", [
      "-l", "-c",
      `cd ${JSON.stringify(dir)} && npm install --save --prefer-offline --no-audit --no-fund @grpc/grpc-js @grpc/proto-loader`,
    ]);
    await install.execute();
  }
  depsInstalled = true;
}

export async function callGrpcNative(
  params: GrpcNativeCallParams
): Promise<ResponseState> {
  const startTime = performance.now();

  try {
    await ensureGrpcDeps();

    const { url, servicePath, body, metadata, packagesDir } = params;

    const parts = servicePath.replace(/^\//, "").split("/");
    const typeName = parts.length >= 3
      ? parts.slice(1, -1).join(".")
      : parts.slice(0, -1).join(".");
    const methodName = parts[parts.length - 1];

    const enabledMeta = metadata
      .filter((m) => m.enabled && m.key.trim())
      .reduce((acc, m) => {
        acc[m.key] = m.value;
        return acc;
      }, {} as Record<string, string>);

    const request = {
      url,
      typeName,
      methodName,
      body,
      metadata: enabledMeta,
      packagesDir,
    };

    const fullScript = `process.argv[1] = ${JSON.stringify(JSON.stringify(request))};\n${SIDECAR_SCRIPT}`;
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

    try {
      const result = JSON.parse(output.stdout);
      return {
        status: result.error ? `gRPC ${result.statusCode}` : "OK",
        statusCode: result.statusCode ?? 0,
        body:
          typeof result.body === "string"
            ? result.body
            : JSON.stringify(result.body, null, 2),
        headers: result.headers ?? {},
        duration: Math.round(duration),
        error: result.error,
      };
    } catch {
      return {
        status: "OK",
        statusCode: 200,
        body: output.stdout,
        headers: {},
        duration: Math.round(duration),
      };
    }
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

const SIDECAR_SCRIPT = `
const path = require('path');
const fs = require('fs');
const input = JSON.parse(process.argv[1]);

const modulePath = path.join(input.packagesDir, 'node_modules');
module.paths.unshift(modulePath);

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

const target = input.url.replace(/^https?:\\/\\//, '');
const useTls = input.url.startsWith('https://');

const nodeModules = path.join(input.packagesDir, 'node_modules');
const pkgJson = JSON.parse(fs.readFileSync(path.join(input.packagesDir, 'package.json'), 'utf-8'));
const userDeps = Object.keys(pkgJson.dependencies || {}).filter(d => !d.startsWith('@grpc/'));

function findProtos(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findProtos(full));
    else if (entry.name.endsWith('.proto')) results.push(full);
  }
  return results;
}

const allProtos = [];
const allIncludeDirs = new Set();
for (const dep of userDeps) {
  const pkgProtoDir = path.join(nodeModules, dep, 'dist', 'protos');
  const found = findProtos(pkgProtoDir);
  for (const p of found) {
    allProtos.push(p);
    allIncludeDirs.add(path.dirname(p));
  }
}

if (allProtos.length === 0) {
  console.log(JSON.stringify({ error: 'No .proto files found for packages: ' + userDeps.join(', '), statusCode: 0, body: '', headers: {} }));
  process.exit(0);
}

// Find which proto file(s) define the target service to avoid duplicate symbol errors
const svcShortName = input.typeName.split('.').pop();
const matchingProtos = allProtos.filter(p => {
  try {
    const content = fs.readFileSync(p, 'utf-8');
    return content.includes('service ' + svcShortName);
  } catch { return false; }
});

const protosToLoad = matchingProtos.length > 0 ? matchingProtos : allProtos;

let packageDef;
try {
  packageDef = protoLoader.loadSync(protosToLoad, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true,
    includeDirs: [...allIncludeDirs],
  });
} catch (loadErr) {
  // Fallback: load one proto at a time and merge, skipping duplicates
  packageDef = {};
  for (const proto of protosToLoad) {
    try {
      const single = protoLoader.loadSync([proto], {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: false,
        oneofs: true,
        includeDirs: [...allIncludeDirs],
      });
      for (const [k, v] of Object.entries(single)) {
        if (!packageDef[k]) packageDef[k] = v;
      }
    } catch { /* skip proto files that conflict */ }
  }
}

const grpcObj = grpc.loadPackageDefinition(packageDef);

function findService(obj, typeName) {
  const parts = typeName.split('.');
  let current = obj;
  for (const p of parts) {
    if (!current || !current[p]) return null;
    current = current[p];
  }
  return current;
}

const ServiceClass = findService(grpcObj, input.typeName);
if (!ServiceClass || !ServiceClass.service) {
  console.log(JSON.stringify({ error: 'Service not found: ' + input.typeName, statusCode: 0, body: '', headers: {} }));
  process.exit(0);
}

const creds = useTls
  ? grpc.credentials.createSsl()
  : grpc.credentials.createInsecure();

const client = new ServiceClass(target, creds);

const meta = new grpc.Metadata();
for (const [k, v] of Object.entries(input.metadata || {})) {
  if (k && v) meta.set(k, v);
}

let reqBody;
try {
  reqBody = JSON.parse(input.body);
} catch {
  reqBody = {};
}

const method = client[input.methodName];
if (!method) {
  console.log(JSON.stringify({ error: 'Method not found: ' + input.methodName + '. Available: ' + Object.keys(ServiceClass.service).join(', '), statusCode: 0, body: '', headers: {} }));
  client.close();
  process.exit(0);
}

const deadline = new Date();
deadline.setSeconds(deadline.getSeconds() + 30);

method.call(client, reqBody, meta, { deadline }, (err, response) => {
  if (err) {
    console.log(JSON.stringify({
      error: err.message || err.details,
      statusCode: err.code || 0,
      body: JSON.stringify({ code: err.code, details: err.details, metadata: err.metadata?.toJSON() }, null, 2),
      headers: err.metadata ? err.metadata.toJSON() : {},
    }));
  } else {
    console.log(JSON.stringify({
      statusCode: 0,
      body: JSON.stringify(response, null, 2),
      headers: {},
    }));
  }
  client.close();
  process.exit(0);
});
`;
