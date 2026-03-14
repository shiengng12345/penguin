import type { ProtoService, ProtoMethod } from "./store";

const SKIP_CLASSES = new Set(["Notify", "WebSocketManager", "GlobalConfig"]);

const CLASS_DECLARE_RE = /export\s+declare\s+class\s+(\w+)\s*\{/g;
const TRADITIONAL_METHOD_RE =
  /^\s*(?:async\s+)?(\w+)\s*\([^)]*\)\s*:\s*Promise<([^>]+)>/gm;
const ARROW_PROPERTY_RE =
  /^\s*(\w+)\s*:\s*\([^)]*\)\s*=>\s*Promise<([^>]+)>/gm;
const STATIC_METHOD_RE =
  /^\s*static\s+(?:async\s+)?(\w+)\s*\([^)]*\)\s*:\s*Promise<([^>]+)>/gm;

function extractRequestTypeFromParams(params: string): string {
  const match = params.match(/:\s*([\w.]+)/);
  return match ? match[1].trim() : "unknown";
}

function parseMethodsInClassBody(
  className: string,
  classBody: string
): ProtoMethod[] {
  const methods: ProtoMethod[] = [];
  const seen = new Set<string>();

  const addMethod = (name: string, requestType: string, responseType: string) => {
    if (name.startsWith("_") || name === "constructor") return;
    if (seen.has(name)) return;
    seen.add(name);
    methods.push({
      name,
      fullName: `${className}.${name}`,
      requestType,
      responseType,
      requestFields: [],
      responseFields: [],
    });
  };

  // Traditional: methodName(params): Promise<T>
  let m: RegExpExecArray | null;
  TRADITIONAL_METHOD_RE.lastIndex = 0;
  while ((m = TRADITIONAL_METHOD_RE.exec(classBody)) !== null) {
    const paramsMatch = m[0].match(/\(([^)]*)\)/);
    const paramStr = paramsMatch ? paramsMatch[1] : "";
    addMethod(m[1], extractRequestTypeFromParams(paramStr), m[2]);
  }

  // Arrow property: methodName: (params) => Promise<T> (main SDK pattern)
  ARROW_PROPERTY_RE.lastIndex = 0;
  while ((m = ARROW_PROPERTY_RE.exec(classBody)) !== null) {
    const paramsMatch = m[0].match(/\(([^)]*)\)/);
    const paramStr = paramsMatch ? paramsMatch[1] : "";
    addMethod(m[1], extractRequestTypeFromParams(paramStr), m[2]);
  }

  // Static methods
  STATIC_METHOD_RE.lastIndex = 0;
  while ((m = STATIC_METHOD_RE.exec(classBody)) !== null) {
    const paramsMatch = m[0].match(/\(([^)]*)\)/);
    const paramStr = paramsMatch ? paramsMatch[1] : "";
    addMethod(m[1], extractRequestTypeFromParams(paramStr), m[2]);
  }

  return methods;
}

function shouldSkipFile(name: string): boolean {
  if (name === "index.d.ts") return true;
  const parts = name.split("/");
  return parts.some(
    (p) => p === "interfaces" || p === "utils" || p === "enum"
  );
}

export function parseSdkDts(
  files: { name: string; content: string }[]
): ProtoService[] {
  const services: ProtoService[] = [];

  for (const file of files) {
    if (shouldSkipFile(file.name)) continue;

    const content = file.content;
    CLASS_DECLARE_RE.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = CLASS_DECLARE_RE.exec(content)) !== null) {
      const className = match[1];
      if (SKIP_CLASSES.has(className)) continue;

      const classStart = match.index +match[0].length;
      let depth = 1;
      let pos = classStart;
      while (pos < content.length && depth > 0) {
        const open = content.indexOf("{", pos);
        const close = content.indexOf("}", pos);
        if (close === -1) break;
        if (open !== -1 && open < close) {
          depth++;
          pos = open +1;
        } else {
          depth--;
          if (depth === 0) {
            const classBody = content.slice(classStart, close);
            const methods = parseMethodsInClassBody(className, classBody);
            if (methods.length > 0) {
              services.push({
                name: className,
                fullName: className,
                methods,
              });
            }
            break;
          }
          pos = close +1;
        }
      }
    }
  }

  return services;
}
