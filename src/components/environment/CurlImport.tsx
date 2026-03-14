import { useState, useEffect } from "react";
import { useEnvironments } from "@/hooks/useEnvironments";
import { generateEnvId } from "@/lib/environment-store";
import { useAppStore, useActiveTab, type RequestTab } from "@/lib/store";
import type { Environment } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, Terminal, ArrowRight, Check, AlertCircle, Plus } from "lucide-react";

interface CurlImportProps {
  open: boolean;
  onClose: () => void;
}

interface ParsedCurl {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  suggestedEnvName: string | null;
}

const URL_PATTERNS: [RegExp, string][] = [
  [/fpms-nt\.platform88\.me/, "QAT1"],
  [/fpms-ntapi\.platform88\.me/, "QAT1-API"],
  [/fpms-nt\.platforma8\.me/, "UAT"],
  [/localhost/i, "LOCAL"],
  [/127\.0\.0\.1/, "LOCAL"],
  [/0\.0\.0\.0/, "LOCAL"],
  [/staging/i, "STAGING"],
  [/production/i, "PROD"],
  [/dev\./i, "DEV"],
  [/uat\./i, "UAT"],
  [/qat/i, "QAT"],
];

function extractQuoted(src: string, start: number): { value: string; end: number } | null {
  const ch = src[start];
  if (ch !== "'" && ch !== '"') return null;
  let i = start +1;
  let out = "";
  while (i < src.length) {
    if (src[i] === "\\") {
      out += src[i +1] ?? "";
      i += 2;
    } else if (src[i] === ch) {
      return { value: out, end: i +1 };
    } else {
      out += src[i];
      i++;
    }
  }
  return { value: out, end: i };
}

function extractToken(src: string, start: number): { value: string; end: number } {
  if (start < src.length && (src[start] === "'" || src[start] === '"')) {
    const q = extractQuoted(src, start);
    if (q) return q;
  }
  let i = start;
  while (i < src.length && src[i] !== " " && src[i] !== "\t") i++;
  return { value: src.slice(start, i), end: i };
}

function skipWs(src: string, i: number): number {
  while (i < src.length && (src[i] === " " || src[i] === "\t")) i++;
  return i;
}

function parseCurl(input: string): ParsedCurl | null {
  const normalized = input
    .trim()
    .replace(/\\\r?\n/g, " ")
    .replace(/[\r\n]+/g, " ");

  if (!normalized.toLowerCase().startsWith("curl")) return null;

  let method = "";
  let url = "";
  const headers: Record<string, string> = {};
  let body = "";

  let i = 4;
  while (i < normalized.length) {
    i = skipWs(normalized, i);
    if (i >= normalized.length) break;

    if (normalized[i] === "-") {
      if (normalized.startsWith("-X", i)) {
        i = skipWs(normalized, i +2);
        const tok = extractToken(normalized, i);
        method = tok.value.toUpperCase();
        i = tok.end;
      } else if (normalized.startsWith("-H", i) || normalized.startsWith("--header", i)) {
        i += normalized.startsWith("--header", i) ? 8 : 2;
        i = skipWs(normalized, i);
        const tok = extractToken(normalized, i);
        i = tok.end;
        const colonIdx = tok.value.indexOf(":");
        if (colonIdx > 0) {
          headers[tok.value.slice(0, colonIdx).trim()] = tok.value.slice(colonIdx +1).trim();
        }
      } else if (
        normalized.startsWith("-d", i) ||
        normalized.startsWith("--data-raw", i) ||
        normalized.startsWith("--data-binary", i) ||
        normalized.startsWith("--data", i)
      ) {
        const flagLen = normalized.startsWith("--data-raw", i) ? 10
          : normalized.startsWith("--data-binary", i) ? 13
          : normalized.startsWith("--data", i) ? 6
          : 2;
        i += flagLen;
        i = skipWs(normalized, i);
        if (i < normalized.length && normalized[i] === "$") i++;
        const tok = extractToken(normalized, i);
        body = tok.value;
        i = tok.end;
      } else {
        const tok = extractToken(normalized, i);
        i = tok.end;
        if (tok.value === "--compressed" || tok.value === "-k" || tok.value === "--insecure" || tok.value === "-s" || tok.value === "--silent" || tok.value === "-v" || tok.value === "--verbose" || tok.value === "-L" || tok.value === "--location") {
          continue;
        }
        if (tok.value.startsWith("-") && !tok.value.startsWith("--") && tok.value.length === 2) {
          i = skipWs(normalized, i);
          const valTok = extractToken(normalized, i);
          i = valTok.end;
        }
      }
    } else {
      const tok = extractToken(normalized, i);
      i = tok.end;
      if (!url && (tok.value.startsWith("http://") || tok.value.startsWith("https://"))) {
        url = tok.value;
      }
    }
  }

  if (!url) return null;
  if (!method) method = body ? "POST" : "GET";

  try {
    body = JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    // leave as-is
  }

  let suggestedEnvName: string | null = null;
  for (const [pattern, name] of URL_PATTERNS) {
    if (pattern.test(url)) {
      suggestedEnvName = name;
      break;
    }
  }

  return { url, method, headers, body, suggestedEnvName };
}

export function CurlImport({ open, onClose }: CurlImportProps) {
  const [curlInput, setCurlInput] = useState("");
  const [envName, setEnvName] = useState("");
  const [parsed, setParsed] = useState<ParsedCurl | null>(null);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(false);
  const { addEnvironment } = useEnvironments();
  const tab = useActiveTab();
  const { updateActiveTab } = useAppStore();

  useEffect(() => {
    if (!open) {
      setCurlInput("");
      setEnvName("");
      setParsed(null);
      setError("");
      setCreated(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const doParse = (text: string) => {
    setError("");
    setCreated(false);
    const result = parseCurl(text);
    if (!result) {
      if (text.trim()) setError("Could not parse cURL command. Make sure it starts with 'curl'.");
      setParsed(null);
      return;
    }
    setParsed(result);
    if (result.suggestedEnvName) setEnvName(result.suggestedEnvName);
    else setEnvName("");
  };

  const handleParse = () => doParse(curlInput);

  const handleTextChange = (text: string) => {
    setCurlInput(text);
    if (parsed) {
      setParsed(null);
      setError("");
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (pasted.trim().toLowerCase().startsWith("curl")) {
      e.preventDefault();
      setCurlInput(pasted);
      setTimeout(() => doParse(pasted), 0);
    }
  };

  const handleCreateEnv = () => {
    if (!parsed || !envName.trim()) return;
    const env: Environment = {
      id: generateEnvId(),
      name: envName.trim(),
      color: "blue",
      variables: [
        { key: "URL", value: parsed.url },
        ...(parsed.headers["Authorization"]
          ? [{ key: "TOKEN", value: parsed.headers["Authorization"].replace(/^Bearer\s+/i, "") }]
          : []),
      ],
    };
    addEnvironment(env);
    setCreated(true);
  };

  const buildPatch = (): Partial<RequestTab> => {
    if (!parsed) return {};
    const patch: Partial<RequestTab> = {};
    if (parsed.body) patch.requestBody = parsed.body;
    if (parsed.url) patch.targetUrl = parsed.url;

    const hdrs = Object.entries(parsed.headers)
      .filter(([k]) => k.toLowerCase() !== "content-type")
      .map(([key, value]) => ({ key, value, enabled: true }));
    if (hdrs.length > 0) patch.metadata = hdrs;

    try {
      const u = new URL(parsed.url);
      const pathParts = u.pathname.split("/").filter(Boolean);
      if (pathParts.length >= 2) {
        const methodName = pathParts[pathParts.length - 1];
        const state = useAppStore.getState();
        const allPkgs = [
          ...state.grpcWebPackages,
          ...state.grpcPackages,
          ...state.sdkPackages,
        ];
        for (const pkg of allPkgs) {
          for (const svc of pkg.services) {
            const m = svc.methods.find(
              (mm) => mm.name.toLowerCase() === methodName.toLowerCase()
            );
            if (m) {
              patch.selectedPackage = pkg.name;
              patch.selectedService = svc.fullName;
              patch.selectedMethod = m;
              break;
            }
          }
          if (patch.selectedMethod) break;
        }
        patch.targetUrl = `${u.protocol}//${u.host}`;
      }
    } catch {
      // URL parsing failed, keep the full URL
    }

    return patch;
  };

  const handleFillCurrent = () => {
    if (!parsed || !tab) return;
    updateActiveTab(buildPatch());
    onClose();
  };

  const handleFillNewTab = () => {
    if (!parsed) return;
    const { addTab } = useAppStore.getState();
    addTab();
    const patch = buildPatch();
    setTimeout(() => {
      useAppStore.getState().updateActiveTab(patch);
    }, 0);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-hidden rounded-lg border border-border bg-popover shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            Import from cURL
          </h2>
          <button onClick={onClose} className="rounded p-1.5 text-muted-foreground hover:bg-accent transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Paste cURL command
            </label>
            <textarea
              value={curlInput}
              onChange={(e) => handleTextChange(e.target.value)}
              onPaste={handlePaste}
              placeholder={`curl -X POST 'https://api.example.com/v1/service/method' \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer token' \\\n  -d '{"key": "value"}'`}
              className="w-full min-h-[120px] rounded-md border border-border bg-muted/30 p-3 font-mono text-xs resize-y focus:outline-none focus:border-primary"
              spellCheck={false}
              autoFocus
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          {!parsed && (
            <Button size="sm" onClick={handleParse} disabled={!curlInput.trim()} className="w-full h-8">
              <ArrowRight className="mr-1.5 h-3.5 w-3.5" />
              Parse
            </Button>
          )}

          {parsed && (
            <>
              <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Method</span>
                  <span className="font-mono font-medium text-foreground">{parsed.method}</span>
                </div>
                <div className="text-sm">
                  <span className="text-muted-foreground">URL</span>
                  <p className="mt-0.5 rounded-md border border-border bg-muted/30 px-2 py-1 font-mono text-xs text-foreground break-all">{parsed.url}</p>
                </div>
                {Object.keys(parsed.headers).length > 0 && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Headers</span>
                    <div className="mt-0.5 space-y-0.5">
                      {Object.entries(parsed.headers).map(([k, v]) => (
                        <p key={k} className="font-mono text-xs text-foreground break-all">
                          <span className="text-primary">{k}:</span> {v}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
                {parsed.body && (
                  <div className="text-sm">
                    <span className="text-muted-foreground">Body</span>
                    <pre className="mt-1 rounded-md border border-border bg-muted/30 p-2 font-mono text-xs text-foreground whitespace-pre-wrap break-words max-h-48 overflow-auto leading-relaxed">
                      {parsed.body}
                    </pre>
                  </div>
                )}
                {parsed.suggestedEnvName && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    Suggested environment: <span className="font-medium text-primary">{parsed.suggestedEnvName}</span>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Environment name (to save URL)
                  </label>
                  <Input
                    value={envName}
                    onChange={(e) => setEnvName(e.target.value)}
                    placeholder="e.g. QAT1, LOCAL"
                    className="h-8 text-sm"
                  />
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleFillCurrent}
                    className="flex-1 h-8"
                  >
                    <ArrowRight className="mr-1 h-3.5 w-3.5" />
                    Fill Current Tab
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleFillNewTab}
                    className="flex-1 h-8"
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Fill New Tab
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleCreateEnv}
                    disabled={!envName.trim() || created}
                    className="flex-1 h-8"
                  >
                    {created ? (
                      <>
                        <Check className="mr-1 h-3.5 w-3.5" />
                        Created
                      </>
                    ) : (
                      "Create Environment"
                    )}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/70">
                  Fill will set URL, headers, and body. If a matching method is found in installed packages, it will also be selected.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
