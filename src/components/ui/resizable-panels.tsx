import { useState, useRef, useCallback, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ResizablePanelsProps {
  left: ReactNode;
  right: ReactNode;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
}

export function ResizablePanels({
  left,
  right,
  defaultRatio = 0.5,
  minRatio = 0.2,
  maxRatio = 0.8,
}: ResizablePanelsProps) {
  const [ratio, setRatio] = useState(defaultRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const newRatio = Math.min(maxRatio, Math.max(minRatio, x / rect.width));
        setRatio(newRatio);
      };

      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [minRatio, maxRatio]
  );

  return (
    <div ref={containerRef} className="flex flex-1 min-h-0 relative">
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
