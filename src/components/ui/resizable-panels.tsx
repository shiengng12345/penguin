import { useState, useRef, useCallback, type ReactNode } from "react";
import { getPersistedValue, setPersistedValue } from "@/lib/app-persistence";
import { cn } from "@/lib/utils";

interface ResizablePanelsProps {
  left: ReactNode;
  right: ReactNode;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  // When set, the ratio after each drag is persisted to app_kv under this
  // key, and the initial ratio reads from the same key. Lets a user's
  // preferred split survive reloads + tab switches per-context. Without
  // a persistKey the split resets to defaultRatio every mount (legacy
  // behavior for callers that don't need persistence).
  persistKey?: string;
}

function clampRatio(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return Math.min(max, Math.max(min, 0.5));
  return Math.min(max, Math.max(min, value));
}

function loadPersistedRatio(
  persistKey: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!persistKey) return fallback;
  const raw = getPersistedValue(persistKey);
  if (raw === null || raw === undefined) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) return fallback;
  return clampRatio(parsed, min, max);
}

export function ResizablePanels({
  left,
  right,
  defaultRatio = 0.5,
  minRatio = 0.2,
  maxRatio = 0.8,
  persistKey,
}: ResizablePanelsProps) {
  // Lazy initial — read from app_kv exactly once on mount, otherwise default.
  const [ratio, setRatio] = useState<number>(() =>
    loadPersistedRatio(persistKey, defaultRatio, minRatio, maxRatio),
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  // Track the latest ratio during a drag so onUp can persist without
  // racing the setState commit (state is async; ref is sync).
  const latestRatio = useRef<number>(ratio);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const newRatio = clampRatio(x / rect.width, minRatio, maxRatio);
        latestRatio.current = newRatio;
        setRatio(newRatio);
      };

      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        // Persist only at drag-end — avoids a write per mousemove tick.
        if (persistKey) {
          setPersistedValue(persistKey, String(latestRatio.current));
        }
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [minRatio, maxRatio, persistKey],
  );

  return (
    // min-w-0 on the container is non-negotiable: without it, any child
    // with intrinsic min-width (a code editor, a long Input, a wide
    // response body) pushes the container wider than its flex parent,
    // and the explicit `width: ratio%` is then computed against that
    // inflated width — visually shrinking the other side every time
    // content with min-width lands in one pane (e.g. after Send).
    <div ref={containerRef} className="flex flex-1 min-h-0 min-w-0 relative">
      <div style={{ width: `${ratio * 100}%` }} className="flex min-w-0 min-h-0">
        {left}
      </div>
      <div
        className={cn(
          "w-1 shrink-0 cursor-col-resize relative z-10",
          "bg-border hover:bg-primary/40 active:bg-primary/60 transition-colors",
          "after:absolute after:inset-y-0 after:-left-1 after:-right-1"
        )}
        onMouseDown={onMouseDown}
      />
      <div style={{ width: `${(1 - ratio) * 100}%` }} className="flex min-w-0 min-h-0">
        {right}
      </div>
    </div>
  );
}
