// Find-in-page that lives INSIDE the inline WKWebView — the bar's
// HTML is injected directly into the page's DOM so it visually overlays
// the page (Chrome-style), not in a separate Tauri row above the
// webview. We can't HTML-overlay a WKWebView from the host because the
// native child always paints above any host HTML.
//
// One full bootstrap is injected on first call; subsequent calls just
// toggle visibility / re-focus. Everything self-contained — including
// the input, ↑/↓/✕ buttons, Cmd+F / Esc / Enter / Shift+Enter
// keybinds, highlight + scroll logic.
//
// Match semantics — multi-token AND fuzzy:
//   * single token "auth"        → all "auth" substrings (case-insens)
//   * multi-token "user login"   → text node must contain BOTH; each
//                                  occurrence of each token is marked
//   * empty / whitespace-only    → cleared, no marks
//
// Skips <script>/<style>/<noscript>/<input>/<textarea>/<select>/
// contenteditable subtrees. Max 500 marks per find to keep huge pages
// snappy.

import { evalInlineWebview } from "./inline-webview";

const FIND_BOOTSTRAP = `
(function () {
  // Idempotent: a second install on the same document is a no-op.
  // Whether to open the bar is the caller's call — host appends a
  // trailing .open() when the user invokes Cmd+F from the chrome.
  if (window.__penguinFind) return;

  const HOST_ID = "__penguin-find-host";
  const MARK_CLASS = "penguin-find-mark";
  const ACTIVE_CLASS = "penguin-find-active";
  const STYLE_ID = "__penguin-find-style";
  const MAX_MATCHES = 500;
  const state = { matches: [], current: -1, query: "" };

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "mark." + MARK_CLASS + " {",
      "  background: #fef08a !important;",
      "  color: #18181b !important;",
      "  padding: 0 !important;",
      "  border-radius: 2px !important;",
      "}",
      "mark." + MARK_CLASS + "." + ACTIVE_CLASS + " {",
      "  background: #fb923c !important;",
      "  outline: 2px solid #ea580c !important;",
      "}",
      "#" + HOST_ID + " {",
      "  position: fixed !important;",
      "  top: 8px !important;",
      "  right: 12px !important;",
      "  z-index: 2147483647 !important;",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  gap: 6px !important;",
      "  padding: 6px 8px !important;",
      "  background: #ffffff !important;",
      "  color: #18181b !important;",
      "  border: 1px solid #d4d4d8 !important;",
      "  border-radius: 8px !important;",
      "  box-shadow: 0 6px 24px rgba(0,0,0,0.18) !important;",
      "  font: 12px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif !important;",
      "  width: 360px !important;",
      "  max-width: calc(100vw - 24px) !important;",
      "  pointer-events: auto !important;",
      "}",
      "#" + HOST_ID + " input {",
      "  flex: 1 1 auto !important;",
      "  min-width: 0 !important;",
      "  border: none !important;",
      "  outline: none !important;",
      "  background: transparent !important;",
      "  color: #18181b !important;",
      "  font: inherit !important;",
      "  padding: 2px 4px !important;",
      "}",
      "#" + HOST_ID + " button {",
      "  flex: 0 0 auto !important;",
      "  width: 22px !important;",
      "  height: 22px !important;",
      "  border: none !important;",
      "  background: transparent !important;",
      "  color: #52525b !important;",
      "  cursor: pointer !important;",
      "  border-radius: 4px !important;",
      "  display: flex !important;",
      "  align-items: center !important;",
      "  justify-content: center !important;",
      "  padding: 0 !important;",
      "}",
      "#" + HOST_ID + " button:hover {",
      "  background: #f4f4f5 !important;",
      "  color: #18181b !important;",
      "}",
      "#" + HOST_ID + " button:disabled {",
      "  opacity: 0.4 !important;",
      "  cursor: default !important;",
      "}",
      "#" + HOST_ID + " .count {",
      "  flex: 0 0 auto !important;",
      "  color: #71717a !important;",
      "  font-variant-numeric: tabular-nums !important;",
      "  white-space: nowrap !important;",
      "  padding: 0 4px !important;",
      "}",
      "@media (prefers-color-scheme: dark) {",
      "  #" + HOST_ID + " {",
      "    background: #18181b !important;",
      "    color: #fafafa !important;",
      "    border-color: #3f3f46 !important;",
      "  }",
      "  #" + HOST_ID + " input { color: #fafafa !important; }",
      "  #" + HOST_ID + " button { color: #a1a1aa !important; }",
      "  #" + HOST_ID + " button:hover { background: #27272a !important; color: #fafafa !important; }",
      "  #" + HOST_ID + " .count { color: #a1a1aa !important; }",
      "}",
    ].join("\\n");
    (document.head || document.documentElement).appendChild(style);
  }

  function shouldSkip(node) {
    let n = node.parentNode;
    while (n && n !== document.body) {
      if (!n.tagName) { n = n.parentNode; continue; }
      // Never recurse into the find bar itself — would loop forever.
      if (n.id === HOST_ID) return true;
      const tag = n.tagName.toUpperCase();
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" ||
          tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" ||
          tag === "OPTION") return true;
      if (n.isContentEditable) return true;
      n = n.parentNode;
    }
    return false;
  }

  function clearMarks() {
    const marks = document.querySelectorAll("mark." + MARK_CLASS);
    marks.forEach(function (m) {
      const parent = m.parentNode;
      if (!parent) return;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    });
    state.matches = [];
    state.current = -1;
    updateCount();
  }

  function escapeRegex(s) {
    return s.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");
  }

  // Per-token char-in-order fuzzy match within a text node.
  //   query "pyer" → finds the span "player" (p…y…e…r in order)
  //   query "log"  → finds "log", "logging", "logout"
  // Constraint: the matched span MUST NOT cross whitespace. Otherwise
  // "pyer" would match across "pay your error" and noise the page.
  // Each successful match advances past the matched span (no nested
  // overlapping matches starting at the same prefix).
  function fuzzyRangesForToken(lower, tok) {
    const ranges = [];
    if (!tok) return ranges;
    let i = 0;
    while (i < lower.length) {
      if (lower[i] !== tok[0]) { i++; continue; }
      let textIdx = i;
      let qIdx = 0;
      let endIdx = -1;
      while (textIdx < lower.length && qIdx < tok.length) {
        const c = lower[textIdx];
        if (c === tok[qIdx]) {
          qIdx++;
          if (qIdx === tok.length) { endIdx = textIdx; break; }
        } else if (c === " " || c === "\\t" || c === "\\n" || c === "\\r") {
          break;
        }
        textIdx++;
      }
      if (endIdx >= 0) {
        ranges.push({ start: i, end: endIdx + 1 });
        i = endIdx + 1;
      } else {
        i++;
      }
    }
    return ranges;
  }

  // A text node matches when EVERY token has at least one fuzzy hit
  // inside it. The collected ranges (across tokens) are then sorted +
  // merged so we never wrap nested marks.
  function findRanges(text, tokens) {
    const lower = text.toLowerCase();
    const collected = [];
    for (let t = 0; t < tokens.length; t++) {
      const r = fuzzyRangesForToken(lower, tokens[t]);
      if (r.length === 0) return null;
      for (let j = 0; j < r.length; j++) collected.push(r[j]);
    }
    if (collected.length === 0) return null;
    collected.sort(function (a, b) { return a.start - b.start; });
    const merged = [collected[0]];
    for (let i = 1; i < collected.length; i++) {
      const last = merged[merged.length - 1];
      if (collected[i].start <= last.end) {
        if (collected[i].end > last.end) last.end = collected[i].end;
      } else {
        merged.push(collected[i]);
      }
    }
    return merged;
  }

  function highlight(query) {
    clearMarks();
    state.query = query;
    if (!query) { updateCount(); return; }
    const tokens = query
      .toLowerCase()
      .split(/\\s+/)
      .filter(function (t) { return t.length > 0; });
    if (tokens.length === 0) { updateCount(); return; }

    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function (n) {
          if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (shouldSkip(n)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      },
    );
    const targets = [];
    let node;
    while ((node = walker.nextNode())) targets.push(node);

    const newMarks = [];
    for (let i = 0; i < targets.length && newMarks.length < MAX_MATCHES; i++) {
      const tn = targets[i];
      const text = tn.nodeValue;
      const ranges = findRanges(text, tokens);
      if (!ranges) continue;
      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (let j = 0; j < ranges.length; j++) {
        const r = ranges[j];
        if (r.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, r.start)));
        const mark = document.createElement("mark");
        mark.className = MARK_CLASS;
        mark.textContent = text.slice(r.start, r.end);
        frag.appendChild(mark);
        newMarks.push(mark);
        cursor = r.end;
        if (newMarks.length >= MAX_MATCHES) break;
      }
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      if (tn.parentNode) tn.parentNode.replaceChild(frag, tn);
    }

    state.matches = newMarks;
    if (newMarks.length > 0) setActive(0);
    else updateCount();
  }

  function setActive(idx) {
    if (state.matches.length === 0) { state.current = -1; updateCount(); return; }
    if (state.current >= 0 && state.matches[state.current]) {
      state.matches[state.current].classList.remove(ACTIVE_CLASS);
    }
    let i = idx;
    if (i < 0) i = state.matches.length - 1;
    if (i >= state.matches.length) i = 0;
    state.current = i;
    const m = state.matches[i];
    m.classList.add(ACTIVE_CLASS);
    try { m.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {}
    updateCount();
  }

  function updateCount() {
    const el = document.getElementById(HOST_ID);
    if (!el) return;
    const c = el.querySelector(".count");
    if (!c) return;
    if (state.matches.length === 0) {
      c.textContent = state.query ? "0/0" : "";
    } else {
      c.textContent = (state.current + 1) + "/" + state.matches.length;
    }
  }

  function buildBar() {
    ensureStyle();
    if (document.getElementById(HOST_ID)) return;
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.setAttribute("role", "search");
    host.innerHTML = [
      '<input type="text" placeholder="Find — fuzzy (pyer matches player); space = multi-token AND" />',
      '<span class="count"></span>',
      '<button type="button" data-act="prev" title="Previous (Shift+Enter)" aria-label="Previous">',
      '  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>',
      '</button>',
      '<button type="button" data-act="next" title="Next (Enter)" aria-label="Next">',
      '  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
      '</button>',
      '<button type="button" data-act="close" title="Close (Esc)" aria-label="Close">',
      '  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
      '</button>',
    ].join("");

    const input = host.querySelector("input");
    let debounce = null;
    input.addEventListener("input", function () {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(function () { highlight(input.value); }, 120);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) setActive(state.current - 1);
        else setActive(state.current + 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    });

    host.addEventListener("click", function (e) {
      const btn = e.target && e.target.closest && e.target.closest("button");
      if (!btn) return;
      const act = btn.getAttribute("data-act");
      if (act === "next") setActive(state.current + 1);
      else if (act === "prev") setActive(state.current - 1);
      else if (act === "close") close();
    });

    (document.body || document.documentElement).appendChild(host);
  }

  function open() {
    buildBar();
    const host = document.getElementById(HOST_ID);
    if (!host) return;
    host.style.display = "flex";
    const input = host.querySelector("input");
    if (input) { input.focus(); input.select(); }
  }

  function close() {
    clearMarks();
    state.query = "";
    const host = document.getElementById(HOST_ID);
    if (host) host.remove();
  }

  // Webview-internal Cmd+F / Ctrl+F. If user focus is inside the page
  // rather than the host Penguin chrome, this is the only path that
  // catches the shortcut.
  document.addEventListener("keydown", function (e) {
    const isF = e.key === "f" || e.key === "F";
    if (isF && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      open();
    }
  }, true);

  window.__penguinFind = { open: open, close: close, next: function () { setActive(state.current + 1); }, prev: function () { setActive(state.current - 1); } };
})();
`;

// Install only — no UI surfaced until the user actually presses Cmd+F
// inside the page. Safe to call multiple times (top guard short-circuits).
export async function installFindInWebview(label: string): Promise<void> {
  await evalInlineWebview(label, FIND_BOOTSTRAP);
}

// Host-triggered open — bootstraps the listener if not already, then
// opens the bar. The host listener path catches Cmd+F when the user's
// focus is on the Penguin chrome rather than inside the webview itself.
export async function openFindInWebview(label: string): Promise<void> {
  await evalInlineWebview(
    label,
    FIND_BOOTSTRAP + `;window.__penguinFind && window.__penguinFind.open();`,
  );
}

export async function closeFindInWebview(label: string): Promise<void> {
  await evalInlineWebview(
    label,
    `window.__penguinFind && window.__penguinFind.close();`,
  );
}
