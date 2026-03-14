import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useActiveTab, type FieldInfo } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { X, Code2, ArrowLeft, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProtoViewerProps {
  open: boolean;
  onClose: () => void;
}

interface MessageDef {
  name: string;
  kind: "message" | "enum";
  lines: ProtoLine[];
}

interface ProtoLine {
  indent: number;
  segments: ProtoSegment[];
}

interface ProtoSegment {
  text: string;
  type: "keyword" | "type" | "field" | "number" | "punct" | "comment" | "enum-value" | "link";
  linkTarget?: string;
}

function fieldsToMessageDefs(
  typeName: string,
  fields: FieldInfo[],
  collected: Map<string, MessageDef>
): MessageDef {
  const lines: ProtoLine[] = [];
  lines.push({
    indent: 0,
    segments: [
      { text: "message ", type: "keyword" },
      { text: typeName, type: "type" },
      { text: " {", type: "punct" },
    ],
  });

  fields.forEach((f, i) => {
    const num = i + 1;
    const segs: ProtoSegment[] = [];

    if (f.repeated) segs.push({ text: "repeated ", type: "keyword" });
    else if (f.optional) segs.push({ text: "optional ", type: "keyword" });

    if (f.enumValues && f.enumValues.length > 0) {
      const enumName = f.name.charAt(0).toUpperCase() + f.name.slice(1);
      segs.push({ text: enumName, type: "link", linkTarget: enumName });
      segs.push({ text: " " + f.name, type: "field" });
      segs.push({ text: ` = ${num};`, type: "number" });

      const enumLines: ProtoLine[] = [];
      enumLines.push({
        indent: 0,
        segments: [
          { text: "enum ", type: "keyword" },
          { text: enumName, type: "type" },
          { text: " {", type: "punct" },
        ],
      });
      f.enumValues.forEach((ev, ei) => {
        enumLines.push({
          indent: 1,
          segments: [
            { text: ev, type: "enum-value" },
            { text: ` = ${ei};`, type: "number" },
          ],
        });
      });
      enumLines.push({ indent: 0, segments: [{ text: "}", type: "punct" }] });
      collected.set(enumName, { name: enumName, kind: "enum", lines: enumLines });
    } else if (f.fields && f.fields.length > 0) {
      const nestedName = f.type || f.name.charAt(0).toUpperCase() + f.name.slice(1);
      segs.push({ text: nestedName, type: "link", linkTarget: nestedName });
      segs.push({ text: " " + f.name, type: "field" });
      segs.push({ text: ` = ${num};`, type: "number" });
      if (!collected.has(nestedName)) {
        collected.set(nestedName, fieldsToMessageDefs(nestedName, f.fields, collected));
      }
    } else {
      segs.push({ text: f.type, type: "type" });
      segs.push({ text: " " + f.name, type: "field" });
      segs.push({ text: ` = ${num};`, type: "number" });
    }

    lines.push({ indent: 1, segments: segs });
  });

  lines.push({ indent: 0, segments: [{ text: "}", type: "punct" }] });
  return { name: typeName, kind: "message", lines };
}

const SEGMENT_COLORS: Record<ProtoSegment["type"], string> = {
  keyword: "text-violet-400",
  type: "text-sky-400",
  field: "text-foreground",
  number: "text-rose-300",
  punct: "text-slate-500",
  comment: "text-slate-500 italic",
  "enum-value": "text-amber-400",
  link: "text-sky-400 underline decoration-dotted cursor-pointer hover:text-sky-300",
};

const SEGMENT_COLORS_LIGHT: Record<ProtoSegment["type"], string> = {
  keyword: "text-violet-600",
  type: "text-sky-700",
  field: "text-foreground",
  number: "text-rose-600",
  punct: "text-slate-400",
  comment: "text-slate-500 italic",
  "enum-value": "text-amber-600",
  link: "text-sky-700 underline decoration-dotted cursor-pointer hover:text-sky-600",
};

export function ProtoViewer({ open, onClose }: ProtoViewerProps) {
  const tab = useActiveTab();
  const [activeView, setActiveView] = useState<"request" | "response">("request");
  const [navStack, setNavStack] = useState<string[]>([]);
  const [focusedDef, setFocusedDef] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const isDark =
    typeof document !== "undefined"
      ? document.documentElement.getAttribute("data-theme") !== "light"
      : true;
  const colors = isDark ? SEGMENT_COLORS : SEGMENT_COLORS_LIGHT;

  const { allDefs: requestDefs, rootName: reqRoot } = useMemo(() => {
    if (!tab?.selectedMethod?.requestFields) return { allDefs: new Map<string, MessageDef>(), rootName: "" };
    const collected = new Map<string, MessageDef>();
    const root = fieldsToMessageDefs(tab.selectedMethod.requestType, tab.selectedMethod.requestFields, collected);
    collected.set(root.name, root);
    return { allDefs: collected, rootName: root.name };
  }, [tab?.selectedMethod]);

  const { allDefs: responseDefs, rootName: resRoot } = useMemo(() => {
    if (!tab?.selectedMethod?.responseFields) return { allDefs: new Map<string, MessageDef>(), rootName: "" };
    const collected = new Map<string, MessageDef>();
    const root = fieldsToMessageDefs(tab.selectedMethod.responseType, tab.selectedMethod.responseFields, collected);
    collected.set(root.name, root);
    return { allDefs: collected, rootName: root.name };
  }, [tab?.selectedMethod]);

  const currentDefs = activeView === "request" ? requestDefs : responseDefs;
  const currentRoot = activeView === "request" ? reqRoot : resRoot;

  const displayDef = focusedDef && currentDefs.has(focusedDef)
    ? currentDefs.get(focusedDef)!
    : currentDefs.get(currentRoot);

  useEffect(() => {
    setNavStack([]);
    setFocusedDef(null);
  }, [activeView]);

  useEffect(() => {
    if (!open) {
      setNavStack([]);
      setFocusedDef(null);
      setActiveView("request");
    }
  }, [open]);

  const handleNavigate = useCallback((target: string) => {
    if (currentDefs.has(target)) {
      setNavStack((s) => [...s, focusedDef ?? currentRoot]);
      setFocusedDef(target);
      contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [currentDefs, focusedDef, currentRoot]);

  const handleBack = useCallback(() => {
    const prev = navStack[navStack.length - 1];
    setNavStack((s) => s.slice(0, -1));
    setFocusedDef(prev === currentRoot ? null : prev);
  }, [navStack, currentRoot]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (navStack.length > 0) handleBack();
        else onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, navStack, handleBack]);

  if (!open || !tab?.selectedMethod) return null;

  const allDefsArr = Array.from(currentDefs.values());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        className="relative z-50 w-full max-w-2xl max-h-[85vh] rounded-lg border border-border bg-popover shadow-xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-card shrink-0">
          <div className="flex items-center gap-2">
            <Code2 className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Proto Viewer</span>
            {focusedDef && (
              <span className="text-xs text-muted-foreground font-mono">
                — {focusedDef}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {navStack.length > 0 && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleBack}>
                <ArrowLeft className="mr-1 h-3.5 w-3.5" />
                Back
              </Button>
            )}
            <button
              onClick={onClose}
              className="h-7 w-7 rounded flex items-center justify-center hover:bg-accent text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex border-b border-border bg-muted/20 shrink-0">
          <button
            className={cn(
              "flex-1 px-4 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5",
              activeView === "request"
                ? "text-primary border-b-2 border-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setActiveView("request")}
          >
            <ArrowUpRight className="h-3 w-3" />
            Request — {tab.selectedMethod.requestType}
          </button>
          <button
            className={cn(
              "flex-1 px-4 py-2 text-xs font-medium transition-colors flex items-center justify-center gap-1.5",
              activeView === "response"
                ? "text-primary border-b-2 border-primary bg-primary/5"
                : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setActiveView("response")}
          >
            <ArrowDownRight className="h-3 w-3" />
            Response — {tab.selectedMethod.responseType}
          </button>
        </div>

        <div ref={contentRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {!focusedDef ? (
            allDefsArr.map((def) => (
              <div key={def.name} className="rounded-md border border-border overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {def.kind === "enum" ? "enum" : "message"} — {def.name}
                  </span>
                </div>
                <pre className="p-3 font-mono text-xs leading-relaxed">
                  {def.lines.map((line, li) => (
                    <div key={li} style={{ paddingLeft: line.indent * 16 }}>
                      {line.segments.map((seg, si) => (
                        seg.type === "link" ? (
                          <span
                            key={si}
                            className={colors[seg.type]}
                            onClick={() => seg.linkTarget && handleNavigate(seg.linkTarget)}
                          >
                            {seg.text}
                          </span>
                        ) : (
                          <span key={si} className={colors[seg.type]}>{seg.text}</span>
                        )
                      ))}
                    </div>
                  ))}
                </pre>
              </div>
            ))
          ) : (
            displayDef && (
              <div className="rounded-md border border-border overflow-hidden">
                <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {displayDef.kind === "enum" ? "enum" : "message"} — {displayDef.name}
                  </span>
                </div>
                <pre className="p-3 font-mono text-xs leading-relaxed">
                  {displayDef.lines.map((line, li) => (
                    <div key={li} style={{ paddingLeft: line.indent * 16 }}>
                      {line.segments.map((seg, si) => (
                        seg.type === "link" ? (
                          <span
                            key={si}
                            className={colors[seg.type]}
                            onClick={() => seg.linkTarget && handleNavigate(seg.linkTarget)}
                          >
                            {seg.text}
                          </span>
                        ) : (
                          <span key={si} className={colors[seg.type]}>{seg.text}</span>
                        )
                      ))}
                    </div>
                  ))}
                </pre>
              </div>
            )
          )}

          {allDefsArr.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Code2 className="h-8 w-8 opacity-30 mb-3" />
              <p className="text-sm">No proto schema available</p>
              <p className="text-xs mt-1">Install a package to see proto definitions</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
