import { useEffect } from "react";
import { Keyboard, X } from "lucide-react";
import type { MainModule } from "@/components/layout/MainSidebar";

interface ShortcutCheatSheetProps {
  open: boolean;
  onClose: () => void;
  // Drives which module-specific section is shown. The cheat sheet always
  // lists the Universal block; the module block follows whatever the user
  // is currently looking at so REST users don't see gRPC's Cmd+P / Cmd+E.
  activeModule?: MainModule;
}

interface ShortcutItem {
  keys: string;
  description: string;
}
interface ShortcutCategory {
  category: string;
  items: ShortcutItem[];
}

// Universal shortcuts — work regardless of which module is in focus.
const UNIVERSAL: ShortcutCategory[] = [
  {
    category: "Universal",
    items: [
      { keys: "⌘ + /", description: "Keyboard shortcuts (this)" },
      { keys: "⌘ + I", description: "Network check & speed test" },
      { keys: "⌘ + Shift + I", description: "Import from cURL" },
    ],
  },
];

const CLIENT_SHORTCUTS: ShortcutCategory[] = [
  {
    category: "Request (gRPC)",
    items: [
      { keys: "⌘ + Enter", description: "Send request" },
      { keys: "Esc", description: "Cancel in-flight request" },
      { keys: "⌘ + Shift + S", description: "Save current request" },
      { keys: "⌘ + D", description: "Request as documentation" },
      { keys: "⌘ + P", description: "View proto definitions" },
      { keys: "⌘ + E", description: "Cycle protocol (gRPC-Web → gRPC → JS-SDK)" },
    ],
  },
  {
    category: "Navigation (gRPC)",
    items: [
      { keys: "⌘ + F", description: "Search methods / services" },
      { keys: "⌘ + H", description: "Request history" },
      { keys: "⌘ + O", description: "Open saved requests" },
    ],
  },
  {
    category: "Tabs (gRPC)",
    items: [
      { keys: "⌘ + N", description: "New tab" },
      { keys: "⌘ + W", description: "Close tab" },
      { keys: "⌘ + R", description: "Reset tab (clear method, body, response)" },
    ],
  },
  {
    category: "Packages (gRPC)",
    items: [{ keys: "⌘ + S", description: "Open package installer" }],
  },
];

const REST_SHORTCUTS: ShortcutCategory[] = [
  {
    category: "Request (REST)",
    items: [
      { keys: "⌘ + Enter", description: "Send request" },
      { keys: "Enter", description: "Send (when URL bar is focused)" },
      { keys: "⌘ + S", description: "Save request" },
      { keys: "⌘ + L", description: "Focus URL bar" },
    ],
  },
  {
    category: "Tabs (REST)",
    items: [
      { keys: "⌘ + N", description: "New request (cascade: project → collection → request)" },
      { keys: "⌘ + T", description: "New request (alias of ⌘N)" },
      { keys: "⌘ + W", description: "Close active tab" },
    ],
  },
  {
    category: "Navigation (REST)",
    items: [
      { keys: "⌘ + F", description: "Focus sidebar search" },
      { keys: "Esc", description: "Close REST module (back to Home)" },
    ],
  },
];

const VAULT_SHORTCUTS: ShortcutCategory[] = [
  {
    category: "Vault",
    items: [{ keys: "Esc", description: "Close Vault" }],
  },
];

const DOCS_SHORTCUTS: ShortcutCategory[] = [
  {
    category: "Docs",
    items: [{ keys: "Esc", description: "Close Docs" }],
  },
];

function moduleSections(module: MainModule | undefined): ShortcutCategory[] {
  switch (module) {
    case "rest":
      return REST_SHORTCUTS;
    case "vault":
      return VAULT_SHORTCUTS;
    case "docs":
      return DOCS_SHORTCUTS;
    case "client":
    default:
      return CLIENT_SHORTCUTS;
  }
}

export function ShortcutCheatSheet({ open, onClose, activeModule }: ShortcutCheatSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const sections = [...UNIVERSAL, ...moduleSections(activeModule)];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-labelledby="shortcut-cheatsheet-title"
        className="relative z-50 w-full max-w-2xl rounded-lg border border-border bg-popover shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2
            id="shortcut-cheatsheet-title"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <Keyboard className="h-4 w-4 shrink-0 text-muted-foreground" />
            Keyboard Shortcuts
            {activeModule && (
              <span className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                · {activeModule}
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[70vh]">
          <table className="w-full text-sm border border-border rounded-md overflow-hidden">
            {sections.map(({ category, items }) => (
              <tbody key={category}>
                <tr>
                  <td
                    colSpan={2}
                    className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-3 py-2 bg-muted/40 border-b border-border"
                  >
                    {category}
                  </td>
                </tr>
                {items.map(({ keys, description }) => (
                  <tr key={keys} className="border-b border-border last:border-b-0">
                    <td className="py-2 px-3 w-[170px] border-r border-border">
                      <kbd className="inline-block font-mono rounded bg-muted px-2 py-0.5 text-[11px] text-center min-w-[60px]">
                        {keys}
                      </kbd>
                    </td>
                    <td className="py-2 px-3 text-foreground">{description}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>
    </div>
  );
}
