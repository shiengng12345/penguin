// Toolbar for the embedded Vault / Argo webview. Lives in HTML, ABOVE
// the InlineWebviewPanel — separating these two means the native child
// webview's bounds can never accidentally include the toolbar region.
// (Earlier the toolbar was inside the panel and a layout-cascade race
// caused the webview to paint over the toolbar on first mount.)

import { ArrowLeft, ArrowRight, ExternalLink, RotateCcw, X } from "lucide-react";
import { useCallback, useState, type CSSProperties, type ReactElement } from "react";

import {
  closeInlineWebview,
  evalInlineWebview,
  inlineWebviewBack,
  inlineWebviewForward,
  reloadInlineWebview,
} from "@/lib/inline-webview";
import { logger } from "@/lib/logger";

const LOG_SCOPE = "InlineWebviewToolbar";

// Inline-style fallback for the icon buttons. Same reasoning as the
// toolbar root: a newly-created file can be missed by Tailwind v4's
// Vite scan until restart, so hard-coding the dimensions guarantees
// the buttons aren't 0×0.
const ICON_BUTTON_STYLE: CSSProperties = {
  height: 28,
  width: 28,
  flexShrink: 0,
  color: "#e5e7eb",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 4,
  padding: 0,
};

export interface InlineWebviewToolbarProps {
  label: string;
  url: string;
  onRequestClose?: () => void;
  onOpenExternal?: (url: string) => void;
  // Re-injected after every reload (Vault sign-in form resets). Never logged.
  prefillScript?: string;
  // Shift+click on Reload — destroys + re-creates the webview so a
  // wedged page (frozen JS context, dead service worker, etc.) can
  // recover. Provided by the parent because remount-via-key has to
  // happen above the InlineWebviewPanel.
  onForceReload?: () => void;
}

export function InlineWebviewToolbar(props: InlineWebviewToolbarProps): ReactElement {
  // Cosmetic only — drives the rotating refresh icon. The native
  // webview doesn't surface load-finished events to JS yet, so we
  // approximate with a 400ms timer.
  const [isReloading, setIsReloading] = useState(false);

  const handleBack = useCallback(() => {
    inlineWebviewBack(props.label).catch((err) => logger.warn(LOG_SCOPE, "back failed", err));
  }, [props.label]);

  const handleForward = useCallback(() => {
    inlineWebviewForward(props.label).catch((err) => logger.warn(LOG_SCOPE, "forward failed", err));
  }, [props.label]);

  const handleReload = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      // Shift-click: destroy + recreate the webview entirely. Used when
      // the page's JS context is wedged and a normal webview.reload()
      // (which goes through the page's own event loop) wouldn't take.
      if (event.shiftKey && props.onForceReload !== undefined) {
        props.onForceReload();
        return;
      }
      setIsReloading(true);
      reloadInlineWebview(props.label)
        .catch((err) => logger.warn(LOG_SCOPE, "reload failed", err))
        .finally(() => {
          window.setTimeout(() => setIsReloading(false), 400);
          if (props.prefillScript !== undefined) {
            const script = props.prefillScript;
            window.setTimeout(() => {
              evalInlineWebview(props.label, script).catch((err) => {
                logger.warn(LOG_SCOPE, "prefill re-eval after reload failed", err);
              });
            }, 300);
          }
        });
    },
    [props.label, props.prefillScript, props.onForceReload],
  );

  const handleClose = useCallback(() => {
    // Destroy, don't hide — see the long note in InlineWebviewPanel's
    // unmount cleanup. Cookies persist via Tauri's filesystem-backed
    // data store, so reopening shortly after still finds the user
    // signed in.
    closeInlineWebview(props.label)
      .catch((err) => logger.warn(LOG_SCOPE, "close-on-close failed", err))
      .finally(() => {
        props.onRequestClose?.();
      });
  }, [props.label, props.onRequestClose]);

  const handleOpenExternal = useCallback(() => {
    props.onOpenExternal?.(props.url);
  }, [props.onOpenExternal, props.url]);

  return (
    // CRITICAL: dimensions + background go through inline style, NOT
    // Tailwind. Tailwind v4 (via Vite) scans source files for utility
    // class usage; a newly-created file is sometimes not picked up
    // until a full dev-server restart, which means `h-10` / `bg-card`
    // resolve to no CSS at all and the toolbar collapses to 0 px (the
    // exact symptom the user reported across multiple iterations).
    // Hard-coding via style={...} makes the toolbar visible regardless
    // of Tailwind's scan state — Tailwind classes still handle the
    // rest (flex/gap/border-radius/etc.).
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingLeft: 10,
        paddingRight: 8,
        overflow: "hidden",
        height: 40,
        flexShrink: 0,
        // Slate elevation — clearly distinct from both bg-background
        // (#0a0a0a) and bg-card (#1a1a1a) so the toolbar reads as a
        // separate band, while still feeling at home with the rest
        // of the Penguin chrome.
        backgroundColor: "#1f2530",
        borderTop: "1px solid #2a3140",
        borderBottom: "1px solid #2a3140",
        color: "#e5e7eb",
      }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "#9aa5b8",
          marginRight: 6,
          flexShrink: 0,
        }}
      >
        Penguin
      </span>
      <button
        type="button"
        onClick={handleBack}
        className="flex items-center justify-center rounded"
        style={ICON_BUTTON_STYLE}
        title="Back"
        aria-label="Back"
      >
        <ArrowLeft width={16} height={16} />
      </button>
      <button
        type="button"
        onClick={handleForward}
        className="flex items-center justify-center rounded"
        style={ICON_BUTTON_STYLE}
        title="Forward"
        aria-label="Forward"
      >
        <ArrowRight width={16} height={16} />
      </button>
      <button
        type="button"
        onClick={handleReload}
        className="flex items-center justify-center rounded"
        style={ICON_BUTTON_STYLE}
        title="Reload (Shift+click = force-recreate the webview when stuck)"
        aria-label="Reload"
      >
        <RotateCcw
          width={16}
          height={16}
          className={isReloading ? "animate-spin" : undefined}
        />
      </button>
      <div
        className="truncate font-mono"
        style={{
          marginLeft: 4,
          marginRight: 4,
          flex: "1 1 0%",
          minWidth: 0,
          border: "1px solid #4a5060",
          backgroundColor: "#1a1d24",
          color: "#e5e7eb",
          padding: "4px 8px",
          fontSize: 12,
          borderRadius: 4,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {props.url}
      </div>
      {props.onOpenExternal !== undefined && (
        <button
          type="button"
          onClick={handleOpenExternal}
          className="flex items-center justify-center rounded"
          style={ICON_BUTTON_STYLE}
          title="Open in system browser"
          aria-label="Open in system browser"
        >
          <ExternalLink width={16} height={16} />
        </button>
      )}
      <button
        type="button"
        onClick={handleClose}
        className="flex items-center justify-center rounded"
        style={ICON_BUTTON_STYLE}
        title="Close inline view"
        aria-label="Close inline view"
      >
        <X width={16} height={16} />
      </button>
    </div>
  );
}
