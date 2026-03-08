import { useState, useEffect, useRef } from "react";
import {
  useAppStore,
  type ProtocolTab,
  type ProtoMethod,
  type InstalledPackage,
} from "@/lib/store";
import { generateDefaultJson } from "@/lib/proto-parser";
import { Input } from "@/components/ui/input";
import { Globe, Server, Box, Search } from "lucide-react";
import { cn } from "@/lib/utils";

const PROTOCOL_BADGES: Record<
  ProtocolTab,
  { label: string; icon: typeof Globe; className: string }
> = {
  "grpc-web": {
    label: "gRPC-Web",
    icon: Globe,
    className: "bg-green-500/20 text-green-600 dark:text-green-400",
  },
  grpc: {
    label: "gRPC",
    icon: Server,
    className: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
  },
  sdk: {
    label: "SDK",
    icon: Box,
    className: "bg-purple-500/20 text-purple-600 dark:text-purple-400",
  },
};

interface SearchResult {
  method: ProtoMethod;
  packageName: string;
  serviceName: string;
  protocol: ProtocolTab;
}

interface CommandSearchProps {
  open: boolean;
  onClose: () => void;
}

export function CommandSearch({ open, onClose }: CommandSearchProps) {
  const { tabs, activeTabId, setActiveTab, updateActiveTab } = useAppStore();
  const grpcWebPackages = useAppStore((s) => s.grpcWebPackages);
  const grpcPackages = useAppStore((s) => s.grpcPackages);
  const sdkPackages = useAppStore((s) => s.sdkPackages);

  const [query, setQuery] = useState("");
  const [protocolFilter, setProtocolFilter] = useState<ProtocolTab | "all">("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const packagesByProtocol: Record<ProtocolTab, InstalledPackage[]> = {
    "grpc-web": grpcWebPackages,
    grpc: grpcPackages,
    sdk: sdkPackages,
  };

  const allResults = ((): SearchResult[] => {
    const results: SearchResult[] = [];
    const protocols: ProtocolTab[] = ["grpc-web", "grpc", "sdk"];

    for (const protocol of protocols) {
      if (protocolFilter !== "all" && protocolFilter !== protocol) continue;

      const pkgs = packagesByProtocol[protocol];
      for (const pkg of pkgs) {
        for (const svc of pkg.services) {
          for (const method of svc.methods) {
            results.push({
              method,
              packageName: pkg.name,
              serviceName: svc.fullName,
              protocol,
            });
          }
        }
      }
    }

    return results;
  })();

  const filteredResults = (() => {
    const q = query.trim();
    if (!q) return allResults;

    if (q.includes("*")) {
      const pattern = new RegExp(
        "^" +
          q
            .split("*")
            .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*") +
          "$",
        "i"
      );
      return allResults.filter(
        (r) =>
          pattern.test(r.method.name) ||
          pattern.test(r.serviceName) ||
          pattern.test(r.packageName)
      );
    }

    const fuzzyMatch = (text: string, pattern: string): number => {
      const t = text.toLowerCase();
      const p = pattern.toLowerCase();
      let ti = 0;
      let pi = 0;
      let score = 0;
      let consecutive = 0;
      while (ti < t.length && pi < p.length) {
        if (t[ti] === p[pi]) {
          consecutive++;
          score += consecutive;
          if (ti === pi) score += 2;
          pi++;
        } else {
          consecutive = 0;
        }
        ti++;
      }
      return pi === p.length ? score : -1;
    };

    return allResults
      .map((r) => {
        const mScore = fuzzyMatch(r.method.name, q);
        const sScore = fuzzyMatch(r.serviceName, q);
        const pScore = fuzzyMatch(r.packageName, q);
        const best = Math.max(mScore, sScore, pScore);
        return { result: r, score: best };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.result);
  })();

  const cycleProtocolFilter = () => {
    const order: (ProtocolTab | "all")[] = ["all", "grpc-web", "grpc", "sdk"];
    const idx = order.indexOf(protocolFilter);
    setProtocolFilter(order[(idx + 1) % order.length]);
  };

  const selectResult = (result: SearchResult) => {
    if (!activeTabId) return;

    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    const body =
      result.method.requestFields && result.method.requestFields.length > 0
        ? JSON.stringify(generateDefaultJson(result.method.requestFields), null, 2)
        : "{}";
    setActiveTab(activeTabId);
    updateActiveTab({
      protocolTab: result.protocol,
      selectedPackage: result.packageName,
      selectedService: result.serviceName,
      selectedMethod: result.method,
      requestBody: body,
    });
    document.dispatchEvent(new CustomEvent("pengvi:focus-method", {
      detail: { packageName: result.packageName, serviceName: result.serviceName },
    }));
    onClose();
  };

  useEffect(() => {
    if (open) {
      setQuery("");
      setProtocolFilter("all");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, protocolFilter]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        e.preventDefault();
        cycleProtocolFilter();
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filteredResults.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && filteredResults[selectedIndex]) {
        e.preventDefault();
        selectResult(filteredResults[selectedIndex]);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, filteredResults, selectedIndex]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        className="relative z-50 w-full max-w-xl rounded-lg border border-border bg-popover shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border p-2">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search methods (* wildcard) / 搜索方法"
            className="border-0 bg-transparent focus-visible:ring-0"
          />
        </div>

        <div className="flex gap-1 border-b border-border px-2 py-1">
          {(["all", "grpc-web", "grpc", "sdk"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProtocolFilter(p)}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                protocolFilter === p
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              {p === "all" ? "All" : PROTOCOL_BADGES[p].label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-muted-foreground">
            Tab to cycle
          </span>
        </div>

        <div
          ref={listRef}
          className="max-h-64 overflow-y-auto p-1"
        >
          {filteredResults.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No results / 无结果
            </div>
          ) : (
            filteredResults.map((r, i) => {
              const badge = PROTOCOL_BADGES[r.protocol];
              const Icon = badge.icon;
              return (
                <button
                  key={`${r.packageName}-${r.method.fullName}`}
                  type="button"
                  onClick={() => selectResult(r)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
                    i === selectedIndex ? "bg-accent" : "hover:bg-accent/50"
                  )}
                >
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium shrink-0",
                      badge.className
                    )}
                  >
                    <Icon className="h-2.5 w-2.5" />
                    {badge.label}
                  </span>
                  <span className="truncate font-mono text-xs text-foreground">
                    {r.method.name}
                  </span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {r.serviceName}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
