// Native child WebView2 / WKWebView embed with an HTML toolbar slot.
// Geometry is the load-bearing detail here: the native webview must receive
// the exact rect of the content area below the toolbar, because native
// subviews paint above HTML when their frames overlap.
//
// Why native child webview (not iframe):
//   - Enterprise Vault / ArgoCD almost always send X-Frame-Options: DENY
//     or CSP frame-ancestors 'none' — iframe ships a blank page.
//   - Native subview runs in its own OS process → Vault's heavy JS
//     can't stall Penguin's React main thread.
//
// Z-order caveat: native subviews always paint above HTML. When any
// Radix dialog / select / menu with [data-state="open"] is in the DOM,
// we hide the webview so the overlay isn't visually swallowed.

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import {
  evalInlineWebview,
  openInlineWebview,
  setInlineWebviewBounds,
  setInlineWebviewVisible,
  type InlineWebviewBounds,
} from "@/lib/inline-webview";
import { logger } from "@/lib/logger";

const LOG_SCOPE = "InlineWebviewPanel";
const TOOLBAR_HEIGHT_DEFAULT = 40;

export interface InlineWebviewPanelProps {
  // Unique per project + env + kind. Caller is responsible for keeping
  // it stable across remounts so cookies + nav history survive.
  label: string;
  // Initial URL. Subsequent prop changes call navigate() instead of
  // recreating the webview, again preserving session state.
  url: string;
  // Optional one-shot JS injected into the child webview's main world
  // shortly after open. Used by VaultMainPanel to auto-fill Vault's
  // Token sign-in field. The script must self-bound its own retry
  // logic; we do not pre-process it. Never logged.
  prefillScript?: string;
  // Toolbar rendered as the first flex child. The native webview is bounded
  // to the second flex child, not to this outer wrapper.
  toolbar?: ReactNode;
  toolbarHeight?: number;
  // Persistent data-store key. Webviews sharing the same dataKey share
  // cookies / localStorage / IndexedDB / cache. See openInlineWebview
  // for the full key convention.
  dataKey?: string | null;
}

// Empirical macOS WKWebView inset offset. The native subview was
// observed painting roughly 30px ABOVE its declared `setFrame` y when
// embedded as a child of Tauri's main window — covering an HTML
// toolbar that sat just above the declared bounds. Adding this offset
// to bounds.y in JS shifts the webview down by the same amount, so
// the toolbar's full height becomes visible. The same delta is
// subtracted from height so the webview's bottom edge still lands
// inside the panel.
const MACOS_WEBVIEW_TOP_INSET_PX = 35;

function boundsFromRect(rect: DOMRectReadOnly): InlineWebviewBounds {
  return {
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top + MACOS_WEBVIEW_TOP_INSET_PX)),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height - MACOS_WEBVIEW_TOP_INSET_PX)),
  };
}

function measureElementBounds(el: HTMLDivElement | null): InlineWebviewBounds | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return boundsFromRect(rect);
}

// rAF-throttled bounds publisher. It observes and measures the same content
// element the open path uses, so native frame updates stay consistent with
// the initial mount. Skips while `suspendSyncRef.current === true` — used
// during the loading grace window so the offscreen-parked webview doesn't
// get yanked back over the loading overlay.
function useThrottledBoundsSync(
  label: string,
  contentRef: React.RefObject<HTMLDivElement | null>,
  suspendSyncRef: React.RefObject<boolean>,
): void {
  const rafRef = useRef<number | null>(null);
  const lastBoundsRef = useRef<InlineWebviewBounds | null>(null);

  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;

    const measureAndSync = (): void => {
      rafRef.current = null;
      if (suspendSyncRef.current) return;
      const next = measureElementBounds(contentRef.current);
      if (next === null) return;
      const last = lastBoundsRef.current;
      const unchanged =
        last !== null &&
        last.x === next.x &&
        last.y === next.y &&
        last.width === next.width &&
        last.height === next.height;
      if (unchanged) return;
      lastBoundsRef.current = next;
      setInlineWebviewBounds(label, next).catch((err) => {
        logger.warn(LOG_SCOPE, "setInlineWebviewBounds failed", err);
      });
    };

    const schedule = (): void => {
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(measureAndSync);
    };

    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(contentEl);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    schedule();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [label, contentRef, suspendSyncRef]);
}

// Hide-when-any-floating-UI-is-open guard. Native child webviews paint
// above HTML, so ANY floating overlay (dialog, dropdown, select,
// popover, tooltip) would be visually swallowed by the webview.
const FLOATING_OPEN_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
  '[role="tooltip"][data-state="open"]',
].join(",");

// Tracks whether any floating Radix overlay is currently open. We use
// this in the consolidated visibility effect so the webview is hidden
// while a modal is open OR while the page is still loading — the
// latter lets the HTML loading overlay (the panel's own placeholder)
// actually paint through without being covered by the native subview.
function useFloatingOverlayOpen(): boolean {
  const [modalOpen, setModalOpen] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const checkAnyOpen = (): boolean =>
      document.querySelector(FLOATING_OPEN_SELECTOR) !== null;
    const update = (): void => setModalOpen(checkAnyOpen());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
      childList: true,
    });
    return () => observer.disconnect();
  }, []);
  return modalOpen;
}

// Parse out a friendly hostname from a URL for the loading caption.
// Falls back to a slice of the raw URL when URL parsing throws.
function hostnameFor(url: string): string {
  try {
    return new URL(url).host || url.slice(0, 48);
  } catch {
    return url.slice(0, 48);
  }
}

export function InlineWebviewPanel(props: InlineWebviewPanelProps): ReactElement {
  // The content ref is the source of truth for native bounds. It is the flex
  // child below the HTML toolbar; measuring it directly avoids duplicating
  // toolbar height in JS and prevents native/HTML overlap.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const toolbarHeight = props.toolbarHeight ?? TOOLBAR_HEIGHT_DEFAULT;
  const hasToolbar = props.toolbar !== undefined;

  // Hard ceiling on the load overlay. Rust normally emits a real
  // page-load-Finished event via on_page_load — we transition off
  // isLoading the moment it arrives. This timeout is the fallback for
  // pathological cases (page never reaches Finished, navigation
  // hijacked by an OS-level prompt, etc.).
  const LOAD_FALLBACK_MS = 6000;

  // Bounds we park the native subview at while the HTML loading
  // overlay is showing. macOS WKWebView's `hide()` is unreliable —
  // empirically the page still paints over our HTML. Moving the
  // subview way offscreen guarantees the user sees the overlay.
  const OFFSCREEN_BOUNDS: InlineWebviewBounds = { x: -20000, y: -20000, width: 1, height: 1 };

  // Suspend the throttled sync while we're parking the webview
  // offscreen, otherwise its ResizeObserver fires when the page first
  // lays out and immediately pulls the webview back over the overlay.
  const suspendSyncRef = useRef<boolean>(false);

  // First-mount: open the webview offscreen so the HTML loading
  // overlay paints uncovered, then move to real bounds + reveal when
  // Rust's on_page_load fires Finished (or after LOAD_FALLBACK_MS).
  useEffect(() => {
    let cancelled = false;
    let revealed = false;
    setIsLoading(true);
    suspendSyncRef.current = true;
    const measure = (): InlineWebviewBounds | null => {
      const el = containerRef.current;
      if (!el) return null;
      return boundsFromRect(el.getBoundingClientRect());
    };
    const reveal = (): void => {
      if (cancelled || revealed) return;
      revealed = true;
      const fresh = measure();
      suspendSyncRef.current = false;
      if (fresh !== null) {
        setInlineWebviewBounds(props.label, fresh).catch((err) => {
          logger.warn(LOG_SCOPE, "reveal setInlineWebviewBounds failed", err);
        });
      }
      setIsLoading(false);
    };
    // Attach the Tauri page-load listener BEFORE issuing open, so any
    // emit that fires before our .then() arrives is captured. The
    // listener only triggers reveal when the label matches and the
    // event is Finished.
    let unlistenFn: UnlistenFn | undefined;
    void listen<{ label: string; event: string; url: string }>(
      "inline-webview-page-load",
      (event) => {
        if (cancelled) return;
        const payload = event.payload;
        if (payload.label !== props.label) return;
        if (payload.event !== "Finished") return;
        reveal();
      },
    ).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlistenFn = fn;
    });
    // Fallback — if the Finished event never fires, force-reveal
    // after the ceiling so the user isn't stuck on the overlay.
    const fallbackId = window.setTimeout(() => {
      logger.warn(LOG_SCOPE, "page-load Finished event timed out, force-revealing");
      reveal();
    }, LOAD_FALLBACK_MS);

    // Two rAFs — one to commit layout, one to let any late style
    // application settle before reading the content rect.
    window.requestAnimationFrame(() => {
      if (cancelled) return;
      window.requestAnimationFrame(() => {
        if (cancelled) return;
        const realBounds = measure();
        if (realBounds === null) return;
        // Open OFFSCREEN — webview is created at the offscreen rect
        // so it never paints over the overlay even for one frame.
        // `realBounds` was captured for the later reveal but reveal()
        // re-measures fresh in case layout shifted in the meantime.
        void realBounds;
        openInlineWebview(props.label, props.url, OFFSCREEN_BOUNDS, props.dataKey)
          .then(() => {
            if (cancelled) return;
            if (props.prefillScript !== undefined) {
              const script = props.prefillScript;
              // Re-eval at multiple checkpoints. The first eval can
              // land on about:blank or a partially-parsed document
              // that the real page replaces moments later, taking our
              // injected setInterval with it. Re-evaluating at 1.5s
              // and 4s catches the common page-ready windows for
              // Vault Ember and most other SPAs.
              const checkpoints = [200, 1500, 4000];
              for (const delay of checkpoints) {
                window.setTimeout(() => {
                  if (cancelled) return;
                  evalInlineWebview(props.label, script).catch((err) => {
                    logger.warn(LOG_SCOPE, "prefill eval failed", err);
                  });
                }, delay);
              }
            }
          })
          .catch((err) => {
            if (cancelled) return;
            logger.error(LOG_SCOPE, "openInlineWebview failed", err);
            setIsLoading(false);
          });
      });
    });
    return () => {
      cancelled = true;
      window.clearTimeout(fallbackId);
      if (unlistenFn !== undefined) unlistenFn();
      const offscreen: InlineWebviewBounds = { x: -10000, y: -10000, width: 1, height: 1 };
      setInlineWebviewVisible(props.label, false).catch((err) => {
        logger.warn(LOG_SCOPE, "hide-on-unmount failed", err);
      });
      setInlineWebviewBounds(props.label, offscreen).catch((err) => {
        logger.warn(LOG_SCOPE, "offscreen-on-unmount failed", err);
      });
    };
    // Intentionally only on label change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.label]);

  useThrottledBoundsSync(props.label, containerRef, suspendSyncRef);
  // Single visibility source — webview is visible only when no floating
  // overlay is open AND the page has had time to load. Hiding during
  // load lets the HTML overlay paint through (native subviews always
  // paint above HTML; can't show overlay otherwise).
  const modalOpen = useFloatingOverlayOpen();
  useEffect(() => {
    const shouldShow = !modalOpen && !isLoading;
    setInlineWebviewVisible(props.label, shouldShow).catch((err) => {
      logger.warn(LOG_SCOPE, "setInlineWebviewVisible failed", err);
    });
  }, [props.label, modalOpen, isLoading]);

  return (
    // Geometry contract:
    //   toolbar: real flex child, fixed height, HTML-only.
    //   content: real flex child below toolbar; this rect is sent to native.
    // Because WKWebView paints above HTML, never send the outer wrapper rect.
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: "1 1 0%",
        minHeight: 0,
        backgroundColor: "var(--color-background, #0a0a0a)",
      }}
    >
      {hasToolbar && (
        <div
          style={{
            flexShrink: 0,
            height: toolbarHeight,
            backgroundColor: "transparent",
          }}
        >
          {props.toolbar}
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          position: "relative",
          flexGrow: 1,
          minHeight: 0,
          backgroundColor: "var(--color-background, #0a0a0a)",
        }}
      >
        {isLoading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 18,
              // Match the InlineWebviewToolbar's slate tone so the
              // loading band feels like a continuation of the chrome
              // above it instead of a separate pure-black panel.
              backgroundColor: "#1f2530",
              color: "#e5e7eb",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#e5e7eb" }}>
                Loading…
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  color: "#9aa5b8",
                  maxWidth: 360,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {hostnameFor(props.url)}
              </span>
            </div>
            {/* Indeterminate progress bar — sliding gradient strip. */}
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                height: 2,
                overflow: "hidden",
                backgroundColor: "rgba(255,255,255,0.04)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  height: "100%",
                  width: "30%",
                  background: "linear-gradient(90deg, transparent, #5b8def, transparent)",
                  animation: "penguin-progress 1.4s ease-in-out infinite",
                }}
              />
            </div>
            <style>{
              "@keyframes penguin-progress { 0% { left: -30%; } 100% { left: 100%; } }"
            }</style>
          </div>
        )}
      </div>
    </div>
  );
}
