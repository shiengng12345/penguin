// In-app error log inspector. Opened from the StatusBar; reads the
// whole capped error_log table on mount (≤1000 rows, ~1MB worst case)
// and pipelines load → filter → fuzzy search → paginate entirely in
// memory so every keystroke is snappy.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import {
  AlertTriangle,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Copy,
  Square,
  Trash2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  clearErrorLogInDatabase,
  listErrorLogFromDatabase,
  type ErrorLogEntry,
} from "@/lib/penguin-db";
import { writeClipboard } from "@/lib/clipboard";
import {
  emitErrorLogChanged,
  subscribeErrorLogChanged,
} from "@/lib/error-log-events";
import {
  formatErrorLogAsJson,
  formatErrorLogAsMarkdown,
} from "@/lib/error-log-format";

const PAGE_SIZE = 50;
type SourceFilter = "all" | "fe" | "be";
type SeverityFilter = "all" | "error" | "warn";

interface ErrorLogDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ErrorLogDialog({ open, onClose }: ErrorLogDialogProps) {
  const [entries, setEntries] = useState<ErrorLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [rawSearch, setRawSearch] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [toast, setToast] = useState<string | null>(null);

  // 200ms debounce for the search input — avoids re-running fuse on
  // every keystroke when the table is at the cap.
  useEffect(() => {
    const t = setTimeout(() => setSearch(rawSearch.trim()), 200);
    return () => clearTimeout(t);
  }, [rawSearch]);

  // Reload from SQLite when the dialog opens. Also re-load whenever a
  // new entry lands (so leaving the dialog open during a crash shows
  // the new row).
  const reload = useCallback(async () => {
    setLoading(true);
    const rows = await listErrorLogFromDatabase();
    setEntries(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    void reload();
  }, [open, reload]);

  useEffect(() => {
    if (!open) return;
    const unsub = subscribeErrorLogChanged(() => {
      void reload();
    });
    return unsub;
  }, [open, reload]);

  // Reset pagination + selection when filter / search changes — keeps
  // the user from staring at "page 5 of 1".
  useEffect(() => {
    setPage(1);
  }, [sourceFilter, severityFilter, search]);

  // Filter pipeline — source + severity chips.
  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
      if (severityFilter !== "all" && e.severity !== severityFilter) return false;
      return true;
    });
  }, [entries, sourceFilter, severityFilter]);

  // Fuse instance — rebuilt only when the filtered set changes.
  const fuse = useMemo(() => {
    return new Fuse(filtered, {
      keys: ["message", "scope", "source", "severity", "details"],
      threshold: 0.4,
      ignoreLocation: true,
      includeScore: false,
    });
  }, [filtered]);

  const searched = useMemo(() => {
    if (search.length === 0) return filtered;
    return fuse.search(search).map((r) => r.item);
  }, [search, filtered, fuse]);

  // Pagination on the searched set.
  const totalPages = Math.max(1, Math.ceil(searched.length / PAGE_SIZE));
  const pageClamped = Math.min(Math.max(1, page), totalPages);
  const pageStart = (pageClamped - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, searched.length);
  const pageRows = useMemo(
    () => searched.slice(pageStart, pageEnd),
    [searched, pageStart, pageEnd],
  );

  // Selection — cross-page; persists through filter / search /
  // pagination changes. Cleared only via the explicit "Clear selection"
  // button.
  const pageAllSelected =
    pageRows.length > 0 && pageRows.every((r) => selectedIds.has(r.id));
  const pageSomeSelected =
    pageRows.some((r) => selectedIds.has(r.id)) && !pageAllSelected;

  const togglePageAll = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (pageAllSelected) {
        for (const r of pageRows) next.delete(r.id);
      } else {
        for (const r of pageRows) next.add(r.id);
      }
      return next;
    });
  }, [pageAllSelected, pageRows]);

  const toggleRow = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  }, []);

  // Copy currently-selected rows in the order they appear in the
  // source `entries` array (newest first, matches table order).
  const selectedEntriesOrdered = useMemo(() => {
    return entries.filter((e) => selectedIds.has(e.id));
  }, [entries, selectedIds]);

  const copyJson = useCallback(async () => {
    if (selectedEntriesOrdered.length === 0) return;
    const text = formatErrorLogAsJson(selectedEntriesOrdered);
    try {
      await writeClipboard(text);
      showToast(`Copied ${selectedEntriesOrdered.length} entries as JSON`);
    } catch {
      showToast("Clipboard write failed");
    }
  }, [selectedEntriesOrdered, showToast]);

  const copyMarkdown = useCallback(async () => {
    if (selectedEntriesOrdered.length === 0) return;
    const text = formatErrorLogAsMarkdown(selectedEntriesOrdered);
    try {
      await writeClipboard(text);
      showToast(`Copied ${selectedEntriesOrdered.length} entries as Markdown`);
    } catch {
      showToast("Clipboard write failed");
    }
  }, [selectedEntriesOrdered, showToast]);

  const [confirmClear, setConfirmClear] = useState(false);
  const clearAll = useCallback(async () => {
    await clearErrorLogInDatabase();
    setEntries([]);
    setSelectedIds(new Set());
    setExpandedIds(new Set());
    setConfirmClear(false);
    emitErrorLogChanged();
    showToast("Error log cleared");
  }, [showToast]);

  // Auto-focus search input on open.
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => searchRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
        onClose={onClose}
        className="max-w-4xl w-[90vw] max-h-[85vh] flex flex-col"
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Error Log
              <span className="text-xs font-normal text-muted-foreground">
                {entries.length} total
              </span>
            </DialogTitle>
            <div className="flex items-center gap-2">
              {confirmClear ? (
                <>
                  <span className="text-xs text-muted-foreground">Clear all?</span>
                  <button
                    type="button"
                    onClick={clearAll}
                    className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive hover:bg-destructive/20"
                  >
                    Yes, clear
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    className="rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  disabled={entries.length === 0}
                  className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-3 w-3" />
                  Clear All
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </DialogHeader>

        {/* Filter chips */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
          <FilterChipGroup
            label="Source"
            options={[
              { v: "all", l: "All" },
              { v: "fe", l: "FE" },
              { v: "be", l: "BE" },
            ]}
            value={sourceFilter}
            onChange={(v) => setSourceFilter(v as SourceFilter)}
          />
          <span className="h-4 w-px bg-border" />
          <FilterChipGroup
            label="Severity"
            options={[
              { v: "all", l: "All" },
              { v: "error", l: "Errors" },
              { v: "warn", l: "Warnings" },
            ]}
            value={severityFilter}
            onChange={(v) => setSeverityFilter(v as SeverityFilter)}
          />
          <div className="ml-auto flex items-center gap-2">
            <input
              ref={searchRef}
              type="search"
              value={rawSearch}
              onChange={(e) => setRawSearch(e.target.value)}
              placeholder="Fuzzy search message, scope, details…"
              className="h-8 w-72 rounded border border-border bg-background px-2 text-xs"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        </div>

        {/* Selection toolbar */}
        {selectedIds.size > 0 ? (
          <div className="flex items-center gap-2 rounded bg-primary/5 px-3 py-2 text-xs">
            <span className="font-medium">{selectedIds.size} selected</span>
            <button
              type="button"
              onClick={copyJson}
              className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 hover:bg-muted"
            >
              <Copy className="h-3 w-3" />
              Copy as JSON
            </button>
            <button
              type="button"
              onClick={copyMarkdown}
              className="flex items-center gap-1 rounded border border-border bg-background px-2 py-1 hover:bg-muted"
            >
              <Copy className="h-3 w-3" />
              Copy as Markdown
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto rounded border border-border px-2 py-1 text-muted-foreground hover:bg-muted"
            >
              Clear selection
            </button>
          </div>
        ) : null}

        {/* Table */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-popover">
              <tr className="border-b border-border/60 text-left text-muted-foreground">
                <th className="px-2 py-2 w-8">
                  <button
                    type="button"
                    onClick={togglePageAll}
                    aria-label="Select all on this page"
                    className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                  >
                    {pageAllSelected ? (
                      <CheckSquare className="h-4 w-4 text-primary" />
                    ) : pageSomeSelected ? (
                      <CheckSquare className="h-4 w-4 text-primary/60" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                  </button>
                </th>
                <th className="px-2 py-2 w-6" />
                <th className="px-2 py-2 w-40">Time</th>
                <th className="px-2 py-2 w-12">Src</th>
                <th className="px-2 py-2 w-16">Sev</th>
                <th className="px-2 py-2 w-40">Scope</th>
                <th className="px-2 py-2">Message</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : pageRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    {entries.length === 0 ? "No errors yet ✨" : "No matches"}
                  </td>
                </tr>
              ) : (
                pageRows.map((e) => {
                  const expanded = expandedIds.has(e.id);
                  const selected = selectedIds.has(e.id);
                  return (
                    <ErrorLogRow
                      key={e.id}
                      entry={e}
                      expanded={expanded}
                      selected={selected}
                      onToggleSelect={() => toggleRow(e.id)}
                      onToggleExpand={() => toggleExpand(e.id)}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 pt-2 text-xs">
          <span className="text-muted-foreground">
            {searched.length === 0
              ? "0 of 0"
              : `${pageStart + 1}–${pageEnd} of ${searched.length}`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={pageClamped <= 1}
              className="rounded border border-border px-2 py-1 disabled:opacity-40"
            >
              ◀ Prev
            </button>
            <span className="px-2 text-muted-foreground">
              Page {pageClamped} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={pageClamped >= totalPages}
              className="rounded border border-border px-2 py-1 disabled:opacity-40"
            >
              Next ▶
            </button>
          </div>
        </div>

        {/* Toast */}
        {toast !== null ? (
          <div className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded bg-foreground/90 px-3 py-1.5 text-xs text-background shadow-lg">
            {toast}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

interface FilterChipGroupProps {
  label: string;
  options: { v: string; l: string }[];
  value: string;
  onChange: (v: string) => void;
}

function FilterChipGroup({ label, options, value, onChange }: FilterChipGroupProps) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground">{label}:</span>
      {options.map((opt) => (
        <button
          key={opt.v}
          type="button"
          onClick={() => onChange(opt.v)}
          className={cn(
            "rounded border px-2 py-0.5 text-[11px] transition-colors",
            value === opt.v
              ? "border-primary/40 bg-primary/10 text-foreground"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          {opt.l}
        </button>
      ))}
    </div>
  );
}

interface ErrorLogRowProps {
  entry: ErrorLogEntry;
  expanded: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
}

function ErrorLogRow({
  entry,
  expanded,
  selected,
  onToggleSelect,
  onToggleExpand,
}: ErrorLogRowProps) {
  const severityColor = entry.severity === "error" ? "text-red-500" : "text-amber-500";
  const sourceBg =
    entry.source === "be" ? "bg-purple-500/10 text-purple-300" : "bg-sky-500/10 text-sky-300";
  return (
    <>
      <tr
        className={cn(
          "border-b border-border/30 align-top hover:bg-muted/30",
          selected ? "bg-primary/5" : "",
        )}
      >
        <td className="px-2 py-1.5">
          <button
            type="button"
            onClick={onToggleSelect}
            className="flex h-4 w-4 items-center justify-center"
            aria-label={selected ? "Deselect row" : "Select row"}
          >
            {selected ? (
              <CheckSquare className="h-4 w-4 text-primary" />
            ) : (
              <Square className="h-4 w-4 text-muted-foreground/60" />
            )}
          </button>
        </td>
        <td className="px-2 py-1.5">
          {entry.details !== null && entry.details.length > 0 ? (
            <button
              type="button"
              onClick={onToggleExpand}
              className="flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label={expanded ? "Collapse details" : "Expand details"}
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          ) : null}
        </td>
        <td className="px-2 py-1.5 font-mono tabular-nums text-muted-foreground">
          {new Date(entry.timestamp).toLocaleString()}
        </td>
        <td className="px-2 py-1.5">
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", sourceBg)}>
            {entry.source}
          </span>
        </td>
        <td className={cn("px-2 py-1.5 text-[11px] font-semibold uppercase", severityColor)}>
          {entry.severity}
        </td>
        <td className="px-2 py-1.5 text-muted-foreground truncate max-w-[10rem]">
          {entry.scope ?? "—"}
        </td>
        <td className="px-2 py-1.5">
          <span className="line-clamp-2 break-words text-foreground">{entry.message}</span>
        </td>
      </tr>
      {expanded && entry.details !== null && entry.details.length > 0 ? (
        <tr className="border-b border-border/30 bg-muted/10">
          <td colSpan={7} className="px-3 py-2">
            <pre className="whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[11px] text-muted-foreground">
              {formatDetails(entry.details)}
            </pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function formatDetails(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
