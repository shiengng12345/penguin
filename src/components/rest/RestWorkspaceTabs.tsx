// Sprint 10 Phase 10A.7 — Postman-style request tab bar (top of workspace).

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RestRequestRecord } from "./rest-types";

const METHOD_COLORS: Record<string, string> = {
  GET: "text-emerald-600 dark:text-emerald-400",
  POST: "text-orange-500 dark:text-orange-400",
  PUT: "text-amber-600 dark:text-amber-400",
  PATCH: "text-violet-600 dark:text-violet-400",
  DELETE: "text-red-500 dark:text-red-400",
  HEAD: "text-sky-500 dark:text-sky-400",
  OPTIONS: "text-fuchsia-500 dark:text-fuchsia-400",
};

export interface RestWorkspaceTabsProps {
  tabs: RestRequestRecord[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

export function RestWorkspaceTabs({ tabs, activeTabId, onSelect, onClose }: RestWorkspaceTabsProps) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-card/20 px-1">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onSelect(tab.id)}
            className={cn(
              "group flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-1.5 text-xs transition-colors",
              isActive
                ? "border-primary bg-background text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent/30 hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "shrink-0 font-mono text-[9px] font-bold",
                METHOD_COLORS[tab.method] ?? "text-muted-foreground",
              )}
            >
              {tab.method}
            </span>
            <span className="max-w-[140px] truncate">{tab.name}</span>
            <span
              className="ml-1 text-muted-foreground/60 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              role="button"
              tabIndex={0}
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
            >
              <X className="h-3 w-3" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
