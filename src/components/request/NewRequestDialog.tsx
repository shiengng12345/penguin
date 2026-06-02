import { useEffect, useRef } from "react";
import {
  Box,
  Braces,
  Network,
  Server,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useAppStore,
  type VisibleProtocolTab,
} from "@/lib/store";
import { cn } from "@/lib/utils";

interface NewRequestDialogProps {
  open: boolean;
  onClose: () => void;
}

interface RequestOption {
  protocol: VisibleProtocolTab;
  label: string;
  title: string;
  description: string;
  icon: LucideIcon;
  accent: string;
}

const REQUEST_OPTIONS: RequestOption[] = [
  {
    protocol: "grpc-web",
    label: "gRPC-Web",
    title: "gRPC-Web Request",
    description: "Use Connect-RPC over fetch through Penguin's proxy.",
    icon: Braces,
    accent: "text-green-500 border-green-500/40 bg-green-500/10",
  },
  {
    protocol: "grpc",
    label: "gRPC",
    title: "Native gRPC Request",
    description: "Run unary calls through the local Node sidecar.",
    icon: Server,
    accent: "text-blue-500 border-blue-500/40 bg-blue-500/10",
  },
  {
    protocol: "sdk",
    label: "JS-SDK",
    title: "JS-SDK Request",
    description: "Invoke @snsoft/js-sdk methods with the same env headers.",
    icon: Box,
    accent: "text-purple-500 border-purple-500/40 bg-purple-500/10",
  },
];

export function NewRequestDialog({ open, onClose }: NewRequestDialogProps) {
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => firstButtonRef.current?.focus(), 0);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const createRequest = (option: RequestOption) => {
    useAppStore.getState().addTab(option.protocol);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-request-title"
        className="relative z-50 w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-popover shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-primary" />
            <h2 id="new-request-title" className="text-sm font-semibold text-foreground">
              New Request / 新建请求
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
          {REQUEST_OPTIONS.map((option, index) => {
            const Icon = option.icon;
            return (
              <button
                key={option.protocol}
                ref={index === 0 ? firstButtonRef : undefined}
                type="button"
                aria-label={option.title}
                title={option.title}
                onClick={() => createRequest(option)}
                className={cn(
                  "group flex min-h-32 flex-col items-center justify-center rounded-md border border-border bg-background/60 p-3 text-center transition-colors",
                  "hover:border-primary/60 hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring",
                )}
              >
                <span className={cn(
                  "mb-3 flex h-10 w-10 items-center justify-center rounded-md border",
                  option.accent,
                )}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-xs font-semibold text-foreground">
                  {option.label}
                </span>
                <span className="mt-1 text-[10px] leading-snug text-muted-foreground">
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
