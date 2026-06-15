// In-app Browser module. Left rail of pinned shortcuts + a single
// embedded webview to the right. Vault sends deeplinks here to open
// a specific URL with optional token prefill.
//
// Layout follows the workflow's verified geometry:
//   one InlineWebviewPanel with a toolbar slot, so the native webview's
//   bounds are GUARANTEED below the toolbar by CSS construction (the
//   measurement div is `position: absolute; top: 40; bottom: 0`).
//
// Cookies / sessions persist across restart via Tauri's
// WKWebSiteDataStore — we just keep the user's pinned URL list in
// app_kv via the store's browser slice.

import { ArrowLeft, Cloud, Compass, Copy, CornerDownRight, Eraser, Globe, KeyRound, LogIn, Plus, Search, ShieldCheck, Star, Trash2, Wrench, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  closeInlineWebview,
  evalInlineWebview,
  hideAllInlineWebviews,
  purgeAllInlineWebviewData,
} from "@/lib/inline-webview";
import { getPersistedValue, setPersistedValue } from "@/lib/app-persistence";
import { APP_VALUE_KEYS } from "@/lib/persistence-keys";
import type { TotpSnapshotEntry } from "@/components/browser/AuthenticatorContent";
import { JenkinsSidebar, jenkinsLinkToBrowserShortcut } from "./JenkinsSidebar";
import { AliyunSidebar, aliyunLinkToBrowserShortcut } from "@/components/browser/AliyunSidebar";

type BrowserTab = "web" | "vault" | "argocd" | "aliyun" | "jenkins";

// Resolve the effective auto-submit state for a shortcut. New default:
// any shortcut carrying prefill data (token / username+password) gets
// ⚡ ON automatically; the user can still opt OUT per-shortcut. The
// stored map carries BOTH true and false now — absence means "use the
// default". Without this, every duplicate / re-added Vault cred would
// silently start in OFF state and the user would have to re-toggle.
function hasAnyPrefill(s: BrowserShortcut): boolean {
  return s.prefillToken !== undefined || s.prefillUsername !== undefined;
}
function effectiveAutoSubmit(
  s: BrowserShortcut,
  map: Record<string, boolean>,
): boolean {
  const override = map[s.id];
  if (override !== undefined) return override;
  return hasAnyPrefill(s);
}
const VALID_TABS: ReadonlySet<BrowserTab> = new Set(["web", "vault", "argocd", "aliyun", "jenkins"]);
function loadInitialTab(): BrowserTab {
  const raw = getPersistedValue(APP_VALUE_KEYS.browserActiveTab);
  if (raw !== null && VALID_TABS.has(raw as BrowserTab)) return raw as BrowserTab;
  // New users land on Web — Chrome-like manual URL / search mode.
  return "web";
}

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/lib/store";
import type { BrowserShortcut } from "@/lib/store-types";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";
import { generateTotp } from "@/lib/totp";

import { InlineWebviewPanel } from "@/components/vault/InlineWebviewPanel";
import { InlineWebviewToolbar } from "@/components/vault/InlineWebviewToolbar";
import { installFindInWebview, openFindInWebview } from "@/lib/webview-find";
import type { VaultCredential, VaultEnv, VaultProject } from "@/components/vault/types";

// Web-renderable kinds — Vault module's INLINE_WEBVIEW_BASE_KINDS,
// duplicated here so the Browser picker only surfaces credentials that
// will actually render. database / cache / token won't.
const INLINE_WEBVIEW_BASE_KINDS = new Set(["vault", "argocd", "monitoring", "web"]);

// Resolve a credential's effective baseKind. Prefers the explicit
// VaultKindDef.baseKind from project.kinds — that's where user-created
// kinds get their renderable hint. Falls back to the raw kind id when
// it happens to match a built-in name (legacy / pre-Sprint-5 saves
// where the kindDef wasn't populated). Without this fallback the
// picker silently filters out perfectly-valid vault credentials.
function effectiveBaseKind(
  cred: VaultCredential,
  project: VaultProject,
): string | undefined {
  const def = project.kinds?.find((k) => k.id === cred.kind);
  if (def?.baseKind !== undefined) return def.baseKind;
  if (INLINE_WEBVIEW_BASE_KINDS.has(cred.kind)) return cred.kind;
  return undefined;
}

interface VaultShortcutPayload {
  url: string;
  label: string;
  prefillToken?: string;
  prefillUsername?: string;
  prefillPassword?: string;
  baseKind?: string;
  projectId?: string;
  envId?: string;
}

// Parse a paired credential value into username + password for the
// Argo sign-in prefill. Accepts two formats so the user can type
// whichever feels natural:
//   1. "username||password"  (pipe-pipe delimited; only `||` is reserved)
//   2. JSON `{"username":"...","password":"..."}`
// Returns null when the value matches neither shape — caller falls
// back to "open without prefill".
function parseLoginCredentialValue(
  raw: string,
): { username: string; password: string } | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // JSON path — preferred when value starts with `{`.
  if (trimmed.startsWith("{")) {
    try {
      const obj: unknown = JSON.parse(trimmed);
      if (typeof obj === "object" && obj !== null) {
        const u = (obj as { username?: unknown }).username;
        const p = (obj as { password?: unknown }).password;
        if (typeof u === "string" && typeof p === "string" && u.length > 0 && p.length > 0) {
          return { username: u, password: p };
        }
      }
    } catch {
      // fall through to delimiter parser
    }
  }
  // Delimiter path — split on the first occurrence of `||`.
  const idx = trimmed.indexOf("||");
  if (idx === -1) return null;
  const username = trimmed.slice(0, idx).trim();
  const password = trimmed.slice(idx + 2).trim();
  if (username.length === 0 || password.length === 0) return null;
  return { username, password };
}

// Find the first TOTP secret defined in the given project for the given
// env. Used by the autoSubmit prefill flow — when a Vault / ArgoCD
// sign-in page also requires an OTP, we look up a sibling totp
// credential in the same scope and inject its current 6-digit code.
//
// Lookup order:
//   1. Paired secret of a totp-kind credential (kind=token + isSensitive).
//   2. The totp credential's own value (single-field migration path).
// Returns the base32 secret string, or undefined when no totp exists.
function totpSecretForScope(
  projects: VaultProject[],
  projectId: string | undefined,
  envId: string | undefined,
): string | undefined {
  if (projectId === undefined || envId === undefined) return undefined;
  const project = projects.find((p) => p.id === projectId);
  if (project === undefined) return undefined;
  for (const cred of project.credentials) {
    if (cred.kind !== "totp") continue;
    const paired = project.credentials.find(
      (c) => c.pairedWith === cred.id || c.id === cred.pairedWith,
    );
    const secret = ((paired?.valueByEnv[envId] ?? cred.valueByEnv[envId]) ?? "").trim();
    if (secret.length > 0) return secret;
  }
  return undefined;
}

// Normalise a URL so trivial differences (trailing slash, casing of
// scheme + host, default-ish ports) don't block auto-match. We don't
// re-parse — a string compare is enough for the matching purpose.
function normalizeUrlForMatch(u: string): string {
  return u.trim().toLowerCase().replace(/\/+$/, "");
}

// Resolve the paired token for a Vault credential, both pairing
// directions. Mirrors the Vault module's per-credential helper.
function pairedTokenForCredential(
  cred: VaultCredential,
  project: VaultProject,
  envId: string,
): string | undefined {
  let paired: VaultCredential | undefined;
  if (cred.pairedWith !== undefined) {
    paired = project.credentials.find((c) => c.id === cred.pairedWith);
  }
  if (paired === undefined) {
    paired = project.credentials.find((c) => c.pairedWith === cred.id);
  }
  if (paired === undefined) return undefined;
  const token = (paired.valueByEnv[envId] ?? "").trim();
  return token.length > 0 ? token : undefined;
}

// Resolve username + password for an ArgoCD-style credential. The
// "argocd-server" template creates THREE credentials: URL (primary) +
// Username (paired, kind=generic, isSensitive=false) + Password
// (paired, kind=token, isSensitive=true). We discriminate by
// isSensitive so the lookup doesn't depend on the user's naming.
//
// Fallback for legacy / hand-crafted setups: if only ONE paired
// credential exists and its value contains `||` or JSON, we still
// parse it (see parseLoginCredentialValue).
function pairedUsernamePasswordForCredential(
  cred: VaultCredential,
  project: VaultProject,
  envId: string,
): { username: string; password: string } | null {
  const paired = project.credentials.filter(
    (c) => c.pairedWith === cred.id || c.id === cred.pairedWith,
  );
  // Two-credential path — preferred (created by argocd-server template).
  const passCred = paired.find((c) => c.isSensitive);
  const userCred =
    paired.find((c) => !c.isSensitive && c.id !== cred.id) ??
    paired.find((c) => c.kind === "generic");
  if (passCred !== undefined && userCred !== undefined && passCred.id !== userCred.id) {
    const username = (userCred.valueByEnv[envId] ?? "").trim();
    const password = (passCred.valueByEnv[envId] ?? "").trim();
    if (username.length > 0 && password.length > 0) {
      return { username, password };
    }
  }
  // Single-credential fallback — older hand-crafted data where the
  // user stuffed both fields into one paired credential as
  // "username||password" or a JSON object.
  if (paired.length === 1) {
    const raw = (paired[0].valueByEnv[envId] ?? "").trim();
    return parseLoginCredentialValue(raw);
  }
  return null;
}

// Build a full Browser shortcut payload from a (credential, project,
// env) triple. baseKind === "vault" pulls in the prefill token.
// Used by BOTH the auto-match on paste and the explicit "From Vault"
// picker so the two paths stay in lockstep.
function shortcutPayloadFromCredential(
  cred: VaultCredential,
  project: VaultProject,
  env: VaultEnv,
): VaultShortcutPayload {
  const baseKind = effectiveBaseKind(cred, project);
  const url = (cred.valueByEnv[env.id] ?? "").trim();
  const payload: VaultShortcutPayload = {
    url,
    label: `${cred.name} · ${project.name} / ${env.name}`,
    baseKind,
    projectId: project.id,
    envId: env.id,
  };
  if (baseKind === "vault") {
    payload.prefillToken = pairedTokenForCredential(cred, project, env.id);
  } else if (baseKind === "argocd") {
    // Argo: try the templated triple first (URL + Username + Password
    // as 3 paired credentials), fall back to a single paired
    // credential carrying "username||password" / JSON.
    const parsed = pairedUsernamePasswordForCredential(cred, project, env.id);
    if (parsed !== null) {
      payload.prefillUsername = parsed.username;
      payload.prefillPassword = parsed.password;
    }
  }
  return payload;
}

// (A) Auto-match: scan every project / env / credential for a value
// that normalises to the same string as the user's URL. First hit wins.
// Returns null when no match exists; caller falls back to a plain URL
// payload.
function findVaultMatchForUrl(
  url: string,
  vaultProjects: VaultProject[],
): VaultShortcutPayload | null {
  const target = normalizeUrlForMatch(url);
  for (const project of vaultProjects) {
    for (const cred of project.credentials) {
      for (const env of project.environments) {
        const credUrl = cred.valueByEnv[env.id];
        if (credUrl === undefined) continue;
        if (normalizeUrlForMatch(credUrl) !== target) continue;
        return shortcutPayloadFromCredential(cred, project, env);
      }
    }
  }
  return null;
}

// Soft-group key: just the projectId. Used to collapse all envs of one
// project under a single header (CP, NP, ZP, BP) — the per-row UI then
// shows the env-color dot + env name so user can tell QAT from UAT at
// a glance without expanding sections. "unscoped" lands shortcuts the
// user paste-added without a Vault context at the bottom.
const UNSCOPED_GROUP_KEY = "__unscoped__";

function groupKey(shortcut: BrowserShortcut): string {
  if (shortcut.projectId === undefined) return UNSCOPED_GROUP_KEY;
  return shortcut.projectId;
}

// Prefix used for derived (virtual) shortcuts auto-built from Vault
// inventory each render. Real persisted shortcuts use the random
// `shortcut-…` prefix from the store; the difference lets the UI hide
// the trash icon on virtual ones (deletion has to happen in the Vault
// module — the source of truth — not Browser).
const VAULT_DERIVED_PREFIX = "vault-";
function isVaultDerivedShortcut(s: BrowserShortcut): boolean {
  return s.id.startsWith(VAULT_DERIVED_PREFIX);
}

interface ShortcutGroup {
  key: string;
  projectId: string | null;
  shortcuts: BrowserShortcut[];
}

const LOG_SCOPE = "BrowserPage";

export interface BrowserPageProps {
  onClose: () => void;
}

export function BrowserPage(props: BrowserPageProps): ReactElement {
  const shortcuts = useAppStore((s) => s.browser.shortcuts);
  const activeShortcutId = useAppStore((s) => s.browser.activeShortcutId);
  const setActiveShortcut = useAppStore((s) => s.setActiveBrowserShortcut);
  const addShortcut = useAppStore((s) => s.addOrPromoteBrowserShortcut);
  const removeShortcut = useAppStore((s) => s.removeBrowserShortcut);
  const renameShortcut = useAppStore((s) => s.renameBrowserShortcut);
  const duplicateShortcut = useAppStore((s) => s.duplicateBrowserShortcut);
  const consumeDeeplink = useAppStore((s) => s.consumeBrowserDeeplink);
  const pendingDeeplink = useAppStore((s) => s.browser.pendingDeeplink);
  const autoSubmitMap = useAppStore((s) => s.browser.autoSubmitByShortcutId);
  const setAutoSubmit = useAppStore((s) => s.setBrowserShortcutAutoSubmit);
  const autoSubmitGlobal = useAppStore((s) => s.browser.autoSubmitGlobalEnabled);
  const setAutoSubmitGlobal = useAppStore((s) => s.setBrowserAutoSubmitGlobal);
  // Vault projects are the source of truth for project + env labels.
  // We only read names here — never mutate. Shortcuts that reference
  // a deleted project/env render with the raw id as a fallback label.
  const vaultProjects = useAppStore((s) => s.vaultProjects);

  const [draftUrl, setDraftUrl] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  // Brief shake / red-border flash when the user clicks "+" with an
  // empty input — gives the visual feedback that was missing before.
  const [inputFlash, setInputFlash] = useState<"ok" | "empty">("ok");
  const draftInputRef = useRef<HTMLInputElement | null>(null);
  // Authenticator (TOTP) popover — opens as a SEPARATE Tauri window
  // (Chrome's extension-popup model). Native WKWebView child views in
  // the main window always paint above HTML, so an inline overlay
  // can't sit above the embedded site; a top-level OS window dodges
  // that entirely. `authOpen` only mirrors the visible state of the
  // popover window so the KeyRound button can render its active state.
  const [authOpen, setAuthOpen] = useState(false);
  const authButtonRef = useRef<HTMLButtonElement | null>(null);
  const hasTotpCreds = useMemo(() => {
    for (const project of vaultProjects) {
      for (const cred of project.credentials) {
        if (cred.kind === "totp") return true;
      }
    }
    return false;
  }, [vaultProjects]);

  // Consume any deeplink request set by Vault (or any other module).
  // The store action returns the request and clears it atomically so a
  // remount of BrowserPage doesn't re-trigger.
  useEffect(() => {
    if (pendingDeeplink === null) return;
    const request = consumeDeeplink();
    if (request === null) return;
    const newId = addShortcut({
      label: request.label,
      url: request.url,
      prefillToken: request.prefillToken,
      prefillUsername: request.prefillUsername,
      prefillPassword: request.prefillPassword,
      baseKind: request.baseKind,
      projectId: request.projectId,
      envId: request.envId,
    });
    setActiveShortcut(newId);
  }, [pendingDeeplink, consumeDeeplink, addShortcut, setActiveShortcut]);

  // Vault-derived virtual shortcuts — auto-built each render from
  // every Vault + ArgoCD credential in the user's vault that has an
  // http(s) URL. Only those two baseKinds qualify (per user direction
  // — Monitoring / generic Web are NOT auto-mirrored). Synthetic id
  // is deterministic so React re-renders + webview labels stay stable
  // across mounts. Token / username / password are pulled live from
  // Vault, so changes in the Vault module flow through immediately.
  const vaultDerivedShortcuts = useMemo<BrowserShortcut[]>(() => {
    const AUTO_MIRROR_BASE_KINDS = new Set(["vault", "argocd"]);
    const out: BrowserShortcut[] = [];
    // Dedup key: same (project, env, normalized URL) collapses to a
    // single shortcut. If the user accidentally created two argocd
    // creds with the same endpoint (e.g. the Vault rename / re-add
    // race), Browser shouldn't show two identical rows.
    const seen = new Set<string>();
    for (const project of vaultProjects) {
      for (const env of project.environments) {
        for (const cred of project.credentials) {
          const baseKind = effectiveBaseKind(cred, project);
          if (baseKind === undefined || !AUTO_MIRROR_BASE_KINDS.has(baseKind)) continue;
          const v = (cred.valueByEnv[env.id] ?? "").trim();
          if (!/^https?:\/\//i.test(v)) continue;
          const dedupKey = `${project.id}|${env.id}|${v.toLowerCase().replace(/\/+$/, "")}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          const payload = shortcutPayloadFromCredential(cred, project, env);
          out.push({
            id: `${VAULT_DERIVED_PREFIX}${project.id}-${env.id}-${cred.id}`,
            label: payload.label,
            url: payload.url,
            prefillToken: payload.prefillToken,
            prefillUsername: payload.prefillUsername,
            prefillPassword: payload.prefillPassword,
            baseKind: payload.baseKind,
            projectId: payload.projectId,
            envId: payload.envId,
            // Order vault-derived entries before manual ones; use a
            // small constant rather than a time so the sort remains
            // stable across renders.
            createdAt: 0,
          });
        }
      }
    }
    return out;
  }, [vaultProjects]);

  // Sidebar collapse — when not pinned, the aside is narrow (~64px,
  // env-label only) and expands on hover. Pin toggle persists the
  // preferred width across reloads.
  const [sidebarPinned, setSidebarPinnedState] = useState<boolean>(() => {
    const raw = getPersistedValue(APP_VALUE_KEYS.browserSidebarPinned);
    return raw === "1" || raw === "true";
  });
  const setSidebarPinned = useCallback((v: boolean) => {
    setSidebarPinnedState(v);
    try {
      setPersistedValue(APP_VALUE_KEYS.browserSidebarPinned, v ? "1" : "0");
    } catch {
      /* best-effort */
    }
  }, []);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const sidebarExpanded = sidebarPinned || sidebarHovered;

  // Top-bar tab selector — partitions the sidebar by baseKind. Persisted
  // in app_kv so reloads land on the same view.
  const [activeTab, setActiveTabState] = useState<BrowserTab>(() => loadInitialTab());
  const setActiveTab = useCallback(
    (tab: BrowserTab) => {
      if (tab === activeTab) return;
      setActiveTabState(tab);
      try {
        setPersistedValue(APP_VALUE_KEYS.browserActiveTab, tab);
      } catch {
        /* best-effort */
      }
      // Reset selection on tab change. The active shortcut from the
      // outgoing tab is no longer in the filtered display list, so
      // keeping it as activeShortcutId would render a webview whose
      // shortcut metadata (URL, label) doesn't match the visible
      // sidebar — confusing AND the prior tab's webview keeps painting
      // until React tears down its panel. Clearing here lands the user
      // on the empty-state search bar of the new tab.
      setActiveShortcut(null);
      // Defense-in-depth: hide every native child webview so none can
      // bleed through the empty-state UI for the new tab.
      void hideAllInlineWebviews().catch((err) => {
        logger.warn(LOG_SCOPE, "hideAllInlineWebviews on tab change failed", err);
      });
    },
    [activeTab, setActiveShortcut],
  );

  // Final display list = vault-derived ∪ (manual-pasted whose URL
  // doesn't collide with anything derived). Manual entries that
  // duplicate a Vault URL get hidden — Vault is the source of truth.
  // Then filter by the active top-bar tab so each tab acts like a
  // dedicated view onto its slice of shortcuts.
  // Aliyun tab manages its own state outside Vault. Each link becomes a
  // virtual BrowserShortcut so the right-panel webview pipeline works
  // unchanged — the id encodes the underlying AliyunLink id and the
  // prefill data comes from the bound account.
  const aliyunAccounts = useAppStore((s) => s.aliyun.accounts);
  const aliyunLinks = useAppStore((s) => s.aliyun.links);
  const addAliyunLink = useAppStore((s) => s.addAliyunLink);
  const aliyunDerivedShortcuts = useMemo<BrowserShortcut[]>(() => {
    const accountById = new Map(aliyunAccounts.map((a) => [a.id, a] as const));
    const out: BrowserShortcut[] = [];
    for (const link of aliyunLinks) {
      const account = accountById.get(link.accountId);
      if (account === undefined) continue;
      out.push(aliyunLinkToBrowserShortcut(link, account));
    }
    return out;
  }, [aliyunAccounts, aliyunLinks]);

  // Same shape as aliyun — virtual shortcuts from Jenkins (link, account)
  // pairs. dataKey=`jenkins-acc-{id}` so all links of one account share login.
  const jenkinsAccounts = useAppStore((s) => s.jenkins.accounts);
  const jenkinsLinks = useAppStore((s) => s.jenkins.links);
  const addJenkinsLink = useAppStore((s) => s.addJenkinsLink);
  const jenkinsDerivedShortcuts = useMemo<BrowserShortcut[]>(() => {
    const accountById = new Map(jenkinsAccounts.map((a) => [a.id, a] as const));
    const out: BrowserShortcut[] = [];
    for (const link of jenkinsLinks) {
      const account = accountById.get(link.accountId);
      if (account === undefined) continue;
      out.push(jenkinsLinkToBrowserShortcut(link, account));
    }
    return out;
  }, [jenkinsAccounts, jenkinsLinks]);

  const displayShortcuts = useMemo<BrowserShortcut[]>(() => {
    const derivedUrls = new Set(
      vaultDerivedShortcuts.map((s) => s.url.trim().toLowerCase().replace(/\/+$/, "")),
    );
    const manualKept = shortcuts.filter((s) => {
      // Branches MUST come through — by design they share the URL
      // with their vault-derived parent; URL dedup would swallow
      // every duplicate the user creates.
      if (s.parentId !== undefined) return true;
      const urlNorm = s.url.trim().toLowerCase().replace(/\/+$/, "");
      return !derivedUrls.has(urlNorm);
    });
    const all = [
      ...vaultDerivedShortcuts,
      ...aliyunDerivedShortcuts,
      ...jenkinsDerivedShortcuts,
      ...manualKept,
    ];
    return all.filter((s) => {
      // Web tab is the "general manual entries" bucket — anything the
      // user paste-added without a Vault auto-match (baseKind=undefined)
      // OR explicitly tagged web (the new tagging scheme).
      if (activeTab === "web") {
        return s.baseKind === "web" || s.baseKind === undefined;
      }
      return s.baseKind === activeTab;
    });
  }, [vaultDerivedShortcuts, aliyunDerivedShortcuts, jenkinsDerivedShortcuts, shortcuts, activeTab]);

  const active = useMemo(
    () => displayShortcuts.find((s) => s.id === activeShortcutId) ?? null,
    [displayShortcuts, activeShortcutId],
  );

  // Build the grouped list. Stable order — only "Unscoped" is anchored
  // to the bottom; other groups in createdAt order (vault-derived
  // entries get cred-position-based ordering).
  const groups = useMemo<ShortcutGroup[]>(() => {
    const byKey = new Map<string, ShortcutGroup>();
    for (const s of displayShortcuts) {
      const key = groupKey(s);
      const existing = byKey.get(key);
      if (existing !== undefined) {
        existing.shortcuts.push(s);
        continue;
      }
      byKey.set(key, {
        key,
        projectId: s.projectId ?? null,
        shortcuts: [s],
      });
    }
    const list = Array.from(byKey.values());
    // Stable sort — user explicitly disliked the active-group-jumps-
    // to-top behaviour (made the list feel jittery when switching
    // between shortcuts). Only "Unscoped" is anchored to the bottom;
    // everything else stays in the order the groups were first added,
    // determined by the createdAt of their first member.
    list.sort((a, b) => {
      if (a.key === UNSCOPED_GROUP_KEY && b.key !== UNSCOPED_GROUP_KEY) return 1;
      if (b.key === UNSCOPED_GROUP_KEY && a.key !== UNSCOPED_GROUP_KEY) return -1;
      return a.shortcuts[0].createdAt - b.shortcuts[0].createdAt;
    });
    return list;
  }, [displayShortcuts]);

  // Resolve a group's display label — now just the project name (envs
  // appear inline on each row via a colored dot + abbreviation). The
  // group header has no env color because multiple envs share the
  // group; the dots inside differentiate them.
  const groupHeaderLabel = useCallback(
    (group: ShortcutGroup): { label: string; color: string | null } => {
      if (group.key === UNSCOPED_GROUP_KEY) return { label: "Unscoped", color: null };
      const project = vaultProjects.find((p) => p.id === group.projectId);
      if (project === undefined) {
        return { label: group.projectId ?? "?", color: null };
      }
      return { label: project.name, color: null };
    },
    [vaultProjects],
  );

  // Resolve env color + name for a single shortcut — used by the per-row
  // dot + label since the group header no longer includes env info.
  const envInfoForShortcut = useCallback(
    (s: BrowserShortcut): { name: string; color: string | null } => {
      if (s.projectId === undefined || s.envId === undefined) return { name: "", color: null };
      const project = vaultProjects.find((p) => p.id === s.projectId);
      const env = project?.environments.find((e) => e.id === s.envId);
      return { name: env?.name ?? s.envId, color: env?.color ?? null };
    },
    [vaultProjects],
  );

  const handleAddFromInput = useCallback(() => {
    const trimmed = draftUrl.trim();
    if (trimmed.length === 0) {
      // Empty-state UX: rather than silently no-op'ing (which read as
      // "button broken"), focus the input and flash its border red for
      // a beat so the user knows where to type.
      setInputFlash("empty");
      draftInputRef.current?.focus();
      window.setTimeout(() => setInputFlash("ok"), 600);
      return;
    }
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    // (A) Auto-match the URL against every Vault credential so a
    // paste-added shortcut still picks up project / env metadata and
    // a paired token if the URL is a known Vault endpoint. Falls
    // through to a plain URL payload otherwise.
    const vaultMatch = findVaultMatchForUrl(url, vaultProjects);
    const payload: VaultShortcutPayload = vaultMatch ?? {
      url,
      label: (() => {
        try {
          return new URL(url).host;
        } catch {
          return trimmed.slice(0, 32);
        }
      })(),
      // Tag as "web" so the new Web tab shows the manual entry. Vault
      // auto-matches keep their own baseKind (vault / argocd) so they
      // appear under those tabs instead.
      baseKind: "web",
    };
    const id = addShortcut(payload);
    // If the user pasted into the sidebar while on a non-web tab, jump
    // to the Web tab so they actually see what they just added.
    if (vaultMatch === null && activeTab !== "web") {
      setActiveTab("web");
    }
    setActiveShortcut(id);
    setDraftUrl("");
  }, [draftUrl, addShortcut, setActiveShortcut, vaultProjects, activeTab, setActiveTab]);


  // Empty-state search bar (centered, Chrome-style). Accepts BOTH URLs
  // and free-text search queries; the latter route to Google. Heuristic:
  // contains a dot or `://` AND no whitespace → treat as URL; otherwise
  // → search query.
  const [searchDraft, setSearchDraft] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const handleEmptyStateGo = useCallback(() => {
    const trimmed = searchDraft.trim();
    if (trimmed.length === 0) {
      searchInputRef.current?.focus();
      return;
    }
    const looksLikeUrl =
      /^https?:\/\//i.test(trimmed) ||
      (/^[^\s]+\.[^\s]+$/.test(trimmed) && !/\s/.test(trimmed));
    const url = looksLikeUrl
      ? /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`
      : `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
    const vaultMatch = looksLikeUrl ? findVaultMatchForUrl(url, vaultProjects) : null;
    const payload: VaultShortcutPayload = vaultMatch ?? {
      url,
      label: looksLikeUrl
        ? (() => {
            try {
              return new URL(url).host;
            } catch {
              return trimmed.slice(0, 32);
            }
          })()
        : `Search · ${trimmed.slice(0, 32)}`,
      baseKind: "web",
    };
    const id = addShortcut(payload);
    if (vaultMatch === null && activeTab !== "web") {
      setActiveTab("web");
    }
    setActiveShortcut(id);
    setSearchDraft("");
  }, [searchDraft, addShortcut, setActiveShortcut, vaultProjects, activeTab, setActiveTab]);

  const handleOpenExternal = useCallback(async (url: string): Promise<void> => {
    try {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
    } catch (error) {
      logger.error(LOG_SCOPE, "openExternal failed", error);
    }
  }, []);

  // Each shortcut gets its own webview label so cookies + nav stack
  // per shortcut are independent. MUST start with "inline-" so the
  // App-level `closeAllInlineWebviews` guard (which filters by that
  // prefix) catches it when the user leaves the Browser module —
  // otherwise the webview persists and bleeds into Client / REST etc.
  const webviewLabel = active === null ? null : `inline-browser-${active.id}`;

  // Cmd+F / Ctrl+F → open the in-page Find bar. Two coverage paths:
  //   (1) host-window keydown — fires when Penguin chrome has focus
  //   (2) page-side keydown installed via injection — fires when focus
  //       is inside the webview (the common case once the user clicks
  //       into the page)
  // The page-side listener is re-installed on a single delayed
  // checkpoint (1500ms). Most SPAs have hydrated by then; tighter
  // timers risked racing the webview's create path. Bootstrap is
  // idempotent — second install on the same document is a no-op.
  useEffect(() => {
    if (webviewLabel === null) return;
    const label = webviewLabel;
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        void openFindInWebview(label).catch((err) => {
          logger.warn(LOG_SCOPE, "openFindInWebview failed", err);
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    // Two checkpoints: 1500ms catches most SPAs; 4000ms catches slow
    // Java-rendered pages (Jenkins, some Aliyun consoles) that replace
    // the document after the first injection window.
    const t1 = window.setTimeout(() => {
      void installFindInWebview(label).catch(() => {});
    }, 1500);
    const t2 = window.setTimeout(() => {
      void installFindInWebview(label).catch(() => {});
    }, 4000);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [webviewLabel]);

  // Force-reload nonce — bumped by Shift+click on the toolbar Reload
  // button. Used as part of the InlineWebviewPanel's `key` so React
  // unmounts the old panel (cleanup hides/parks the dead webview) and
  // mounts a fresh one. Combined with closeInlineWebview() before the
  // bump, this destroys the wedged WKWebView and re-creates a fresh
  // one — recovery for stuck pages where `webview.reload()` would
  // route through the page's own (frozen) JS context and never run.
  // General "wipe everything" confirm — two-step click. First click
  // sets confirmingPurge for 3s; second click within the window
  // triggers the actual purge. Auto-cancels via setTimeout so the
  // button doesn't sit in a "danger zone" indefinitely.
  const [confirmingPurge, setConfirmingPurge] = useState(false);
  useEffect(() => {
    if (!confirmingPurge) return;
    const t = window.setTimeout(() => setConfirmingPurge(false), 3000);
    return () => window.clearTimeout(t);
  }, [confirmingPurge]);
  const handleGeneralClearCache = useCallback(() => {
    if (!confirmingPurge) {
      setConfirmingPurge(true);
      return;
    }
    setConfirmingPurge(false);
    void purgeAllInlineWebviewData()
      .catch((err) => logger.error(LOG_SCOPE, "purge all failed", err))
      .finally(() => {
        // Full main-webview reload — clears any in-memory React state
        // that might still reference the killed webviews. Active
        // module + persisted data all survive the reload via app_kv.
        window.location.reload();
      });
  }, [confirmingPurge]);

  const [forceReloadNonce, setForceReloadNonce] = useState(0);
  const handleForceReload = useCallback(() => {
    if (webviewLabel === null) return;
    void closeInlineWebview(webviewLabel).catch(() => {
      /* best-effort — proceed to remount regardless */
    });
    setForceReloadNonce((n) => n + 1);
  }, [webviewLabel]);

  // --- Per-shortcut clear cache ---
  // Click the Eraser button next to ⚡ on a row → that shortcut becomes
  // active AND queues a "clear data + force-recreate" pass. The
  // pending-id approach handles both cases uniformly:
  //   - Shortcut already active: effect below fires next render, runs
  //     clear, bumps remount nonce, clears the pending flag.
  //   - Shortcut not active: setActiveShortcut(id) triggers a re-render
  //     where active.id === pending. Webview mounts; we wait ~1.8s for
  //     the page to settle (origin context exists by then) before
  //     injecting the wipe JS, then force-recreate.
  const [pendingClearShortcutId, setPendingClearShortcutId] = useState<string | null>(null);
  const handleClearCache = useCallback(
    (shortcutId: string) => {
      setPendingClearShortcutId(shortcutId);
      if (activeShortcutId !== shortcutId) {
        setActiveShortcut(shortcutId);
      }
    },
    [activeShortcutId, setActiveShortcut],
  );
  useEffect(() => {
    if (pendingClearShortcutId === null) return;
    if (active === null || active.id !== pendingClearShortcutId) return;
    if (webviewLabel === null) return;
    const label = webviewLabel;
    // Wipe cookies / localStorage / sessionStorage / Cache API / IDB
    // for the current page's origin. Each step is wrapped so a single
    // failure (e.g. SecurityError on cross-origin frames) doesn't
    // abort the rest.
    const clearScript = `(function(){
  try {
    var cookies = (document.cookie || '').split(';');
    var host = location.hostname;
    var domains = [host, '.' + host];
    var stripped = host.replace(/^[^.]+\\./, '');
    if (stripped !== host) { domains.push(stripped, '.' + stripped); }
    for (var i = 0; i < cookies.length; i++) {
      var name = (cookies[i] || '').split('=')[0].trim();
      if (!name) continue;
      for (var d = 0; d < domains.length; d++) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=' + domains[d] + ';';
      }
      document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/;';
    }
  } catch(e) { console.warn('[penguin] clearCache cookies:', e); }
  try { window['local'+'Storage'].clear(); } catch(e) { console.warn('[penguin] clearCache lsCleared:', e); }
  try { sessionStorage.clear(); } catch(e) { console.warn('[penguin] clearCache sessionStorage:', e); }
  try {
    if (window.caches && caches.keys) {
      caches.keys().then(function(keys){ keys.forEach(function(k){ caches.delete(k); }); });
    }
  } catch(e) { console.warn('[penguin] clearCache caches:', e); }
  try {
    if (indexedDB && indexedDB.databases) {
      indexedDB.databases().then(function(dbs){
        (dbs || []).forEach(function(db){ if (db && db.name) indexedDB.deleteDatabase(db.name); });
      });
    }
  } catch(e) { console.warn('[penguin] clearCache indexedDB:', e); }
  console.log('[penguin] cache cleared for ' + location.origin);
})();`;
    // Give the page ~1.8s to settle so localStorage / indexedDB exist
    // in the right origin context — clearing too early would either
    // run on about:blank or fail with SecurityError on the still-
    // loading frame.
    const timer = window.setTimeout(() => {
      evalInlineWebview(label, clearScript)
        .catch((err) => logger.warn(LOG_SCOPE, "clear cache eval failed", err))
        .finally(() => {
          // Force-recreate the webview to flush in-process state
          // (memory cache, dead service workers, frozen JS context).
          void closeInlineWebview(label).catch((err) => {
            logger.warn(LOG_SCOPE, "clear-cache close failed", err);
          });
          setForceReloadNonce((n) => n + 1);
          setPendingClearShortcutId(null);
        });
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [pendingClearShortcutId, active, webviewLabel]);

  // --- Authenticator popover wiring ---
  // Reuse the BrowserPage's existing scope-resolution: build a flat
  // snapshot of every (project, env, totp credential) tuple, with the
  // `matchesActiveScope` flag set so the popover can re-sort without
  // re-reading the store. Hosted here (after active is defined) so the
  // useCallback's deps array can reference it without hitting TDZ.
  const buildTotpSnapshot = useCallback((): TotpSnapshotEntry[] => {
    const out: TotpSnapshotEntry[] = [];
    const activeProjectId = active?.projectId;
    const activeEnvId = active?.envId;
    // Source 1 — Vault TOTP credentials (kind=totp, paired with secret).
    for (const project of vaultProjects) {
      for (const cred of project.credentials) {
        if (cred.kind !== "totp") continue;
        const paired = project.credentials.find(
          (c) => c.pairedWith === cred.id || c.id === cred.pairedWith,
        );
        for (const env of project.environments) {
          const secret = ((paired?.valueByEnv[env.id] ?? cred.valueByEnv[env.id]) ?? "").trim();
          if (secret.length === 0) continue;
          out.push({
            id: `vault-${project.id}-${env.id}-${cred.id}`,
            source: "vault",
            title: cred.name,
            account: `${project.name} · ${env.name}`,
            secret,
            projectId: project.id,
            envId: env.id,
            contextLabel: `${project.name} / ${env.name}`,
            envColor: env.color,
            matchesActiveScope:
              activeProjectId !== undefined &&
              activeEnvId !== undefined &&
              project.id === activeProjectId &&
              env.id === activeEnvId,
          });
        }
      }
    }
    // Source 2 — Aliyun accounts with a 2FA secret. Independent from
    // Vault; lives in the Aliyun tab store. Title is "Aliyun" so the
    // popover groups them visually under one service name (matches the
    // reference Chrome Authenticator style).
    for (const account of aliyunAccounts) {
      const secret = (account.totpSecret ?? "").trim();
      if (secret.length === 0) continue;
      out.push({
        id: `aliyun-${account.id}`,
        source: "aliyun",
        title: "Aliyun",
        account: account.label.length > 0 ? account.label : account.username,
        secret,
        contextLabel: "Aliyun",
        matchesActiveScope: false,
      });
    }
    // Source 3 — Jenkins accounts with a 2FA secret. Mirrors Aliyun.
    for (const account of jenkinsAccounts) {
      const secret = (account.totpSecret ?? "").trim();
      if (secret.length === 0) continue;
      out.push({
        id: `jenkins-${account.id}`,
        source: "jenkins",
        title: "Jenkins",
        account: account.label.length > 0 ? account.label : account.username,
        secret,
        contextLabel: "Jenkins",
        matchesActiveScope: false,
      });
    }
    out.sort((a, b) => {
      if (a.matchesActiveScope !== b.matchesActiveScope) return a.matchesActiveScope ? -1 : 1;
      const t = a.title.localeCompare(b.title);
      if (t !== 0) return t;
      return a.account.localeCompare(b.account);
    });
    return out;
  }, [vaultProjects, aliyunAccounts, jenkinsAccounts, active]);

  const toggleAuth = useCallback(async () => {
    if (authOpen) {
      await invoke("auth_popover_close").catch((err) => {
        logger.warn(LOG_SCOPE, "auth_popover_close failed", err);
      });
      setAuthOpen(false);
      return;
    }
    const rect = authButtonRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    // Translate button rect from browser-window coords to physical
    // screen coords using the main Tauri window's outer position.
    // Without this the popover anchors to screen origin (top-left of
    // monitor) instead of below the button.
    const win = getCurrentWindow();
    const winPos = await win.outerPosition().catch(() => null);
    const winScale = await win.scaleFactor().catch(() => 1);
    const winX = winPos !== null ? winPos.x / winScale : 0;
    const winY = winPos !== null ? winPos.y / winScale : 0;
    const popoverWidth = 380;
    const anchorX = winX + rect.right - popoverWidth;
    const anchorY = winY + rect.bottom + 8;
    try {
      await invoke("auth_popover_open", {
        snapshot: {
          entries: buildTotpSnapshot(),
          activeWebviewLabel: webviewLabel,
        },
        anchorX,
        anchorY,
      });
      setAuthOpen(true);
    } catch (err) {
      logger.error(LOG_SCOPE, "auth_popover_open failed", err);
    }
  }, [authOpen, buildTotpSnapshot, webviewLabel]);

  // Flip the KeyRound button's active state back when the popover
  // window closes (Esc / blur / X). Rust emits the app-wide event
  // from auth_popover.rs's WindowEvent::Destroyed handler — per-window
  // lifecycle events don't reach this listener otherwise.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("auth-popover-closed", () => {
      setAuthOpen(false);
    }).then((un) => {
      unlisten = un;
    });
    return () => {
      if (unlisten !== undefined) unlisten();
    };
  }, []);

  // Pre-compute a TOTP code for the active shortcut when (a) autoSubmit
  // is on AND (b) a totp credential exists in the same Vault scope. The
  // code is embedded in the prefill script, so we sample it just before
  // the script is rebuilt + re-injected. Re-rolled every 5s so a long-
  // open page picks up a fresh code on its next reload / re-prefill.
  const [autoSubmitOtp, setAutoSubmitOtp] = useState<string | null>(null);
  useEffect(() => {
    if (active === null || !autoSubmitGlobal || !effectiveAutoSubmit(active, autoSubmitMap)) {
      setAutoSubmitOtp(null);
      return;
    }
    const secret = totpSecretForScope(vaultProjects, active.projectId, active.envId);
    if (secret === undefined) {
      setAutoSubmitOtp(null);
      return;
    }
    let cancelled = false;
    async function refresh() {
      try {
        const result = await generateTotp(secret as string);
        if (!cancelled) setAutoSubmitOtp(result.code);
      } catch {
        if (!cancelled) setAutoSubmitOtp(null);
      }
    }
    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active, autoSubmitGlobal, autoSubmitMap, vaultProjects]);

  // Prefill script: only built for shortcuts that came from a Vault
  // credential (carry a token). Polls for the Token input and sets it
  // via the native HTMLInputElement value setter so Ember's two-way
  // binding picks it up. Auto-clicks "Sign in" only when the user has
  // opted in for this specific shortcut.
  const prefillScript = useMemo<string | undefined>(() => {
    if (active === null) return undefined;
    const wantsAutoSubmit =
      autoSubmitGlobal && effectiveAutoSubmit(active, autoSubmitMap);
    // 200ms after the prefill apply gives React / Redux Form / Ember a
    // tick to react to the input + change events — otherwise the
    // submit button may still be disabled when we click it. When a
    // matching TOTP credential exists in the same Vault scope we
    // inject the OTP first (with a small inner delay so the OTP
    // field's own validation pass completes), then click submit.
    const safeOtp = autoSubmitOtp === null ? null : JSON.stringify(autoSubmitOtp);
    const clickSubmitJs = `
  var btns=document.querySelectorAll('button[type="submit"],button,input[type="submit"]');
  for(var i=0;i<btns.length;i++){
    var b=btns[i];
    if(b.offsetParent===null) continue;
    if(b.disabled) continue;
    var t=((b.textContent||b.value||'')+'').trim().toLowerCase();
    if(b.type==='submit'||t.indexOf('sign in')>=0||t.indexOf('log in')>=0||t.indexOf('login')>=0){
      console.log('[penguin] auto-submit clicking',t);
      b.click();
      return;
    }
  }
  console.log('[penguin] auto-submit: no visible submit button');`;
    const fillOtpJs = safeOtp === null ? "" : `
  var otpSel=[
    'input[autocomplete="one-time-code"]',
    'input[name="otp"]',
    'input[name="code"]',
    'input[name="token"]',
    'input[name="mfa"]',
    'input[name="2fa"]',
    'input[inputmode="numeric"]',
    'input[type="tel"]'
  ];
  var otpInput=null;
  for(var oi=0;oi<otpSel.length;oi++){
    var on=document.querySelectorAll(otpSel[oi]);
    for(var oj=0;oj<on.length;oj++){
      var oe=on[oj];
      if(oe.offsetParent===null) continue;
      if(oe.disabled||oe.readOnly) continue;
      otpInput=oe; break;
    }
    if(otpInput!==null) break;
  }
  if(otpInput!==null){
    var od=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');
    if(od&&od.set){od.set.call(otpInput,${safeOtp});} else {otpInput.value=${safeOtp};}
    otpInput.dispatchEvent(new Event('input',{bubbles:true}));
    otpInput.dispatchEvent(new Event('change',{bubbles:true}));
    console.log('[penguin] auto-submit: OTP injected');
  } else {
    console.log('[penguin] auto-submit: no OTP input found, skipping');
  }`;
    const autoSubmitTail = wantsAutoSubmit
      ? `setTimeout(function(){${fillOtpJs}
  setTimeout(function(){${clickSubmitJs}
  },150);
},200);`
      : "";
    // ArgoCD username + password sign-in form. Polls for both
    // username and password inputs, sets each via the native value
    // setter, dispatches input + change so React / Redux based
    // forms (Argo uses Redux Form) pick the change up. Does NOT
    // auto-click "Sign in".
    if (
      (active.baseKind === "argocd" ||
        active.baseKind === "aliyun" ||
        active.baseKind === "jenkins") &&
      active.prefillUsername !== undefined &&
      active.prefillPassword !== undefined
    ) {
      const safeUsername = JSON.stringify(active.prefillUsername);
      const safePassword = JSON.stringify(active.prefillPassword);
      return `(function(u,p){
  console.log('[penguin] argo prefill script loaded');
  // Idempotence guard — InlineWebviewPanel injects this script at
  // 200ms / 1500ms / 4000ms checkpoints to catch slow-mounting SPAs.
  // Once we've successfully filled the form (and possibly auto-clicked
  // Sign in), subsequent runs would re-fill + re-submit, causing
  // duplicate login warnings on Vault.
  if(window.__penguinPrefillDone){console.log('[penguin] argo prefill: skip (already done)');return;}
  var tries=0, max=150;
  // Selectors ordered by specificity. Argo can ship with either
  // standard name= attributes OR Angular reactive forms (formControlName).
  // The final fallback walks every visible non-password input and picks
  // the first one that isnt a hidden / readonly / search input.
  var userSel=[
    'input[name="j_username"]',
    'input[name="username"]',
    'input[name="user"]',
    'input[name="login"]',
    'input[formcontrolname="username"]',
    'input[formcontrolname="login"]',
    'input[autocomplete="username"]',
    'input[autocomplete="email"]',
    'input[type="email"]:not([readonly])'
  ];
  var passSel=[
    'input[name="j_password"]',
    'input[name="password"]',
    'input[formcontrolname="password"]',
    'input[autocomplete="current-password"]',
    'input[autocomplete="new-password"]',
    'input[type="password"]:not([readonly])'
  ];
  function isVisible(el){
    if(el.offsetParent===null) return false;
    if(el.disabled||el.readOnly) return false;
    if((el.type||'').toLowerCase()==='hidden') return false;
    var r=el.getBoundingClientRect();
    return r.width>0 && r.height>0;
  }
  function findVisible(selectors){
    for(var si=0;si<selectors.length;si++){
      var nodes=document.querySelectorAll(selectors[si]);
      for(var i=0;i<nodes.length;i++){
        if(isVisible(nodes[i])) return nodes[i];
      }
    }
    return null;
  }
  // Last-resort fallback when none of the named selectors hit. Walks
  // every <input> in DOM order and picks the first visible non-password
  // textual input as the username field. Most login forms put username
  // before password in the source, so DOM order works as a reliable
  // tiebreaker. The password fallback is similarly DOM-order on
  // type=password.
  function fallbackPair(){
    var all=document.querySelectorAll('input');
    var firstText=null, firstPass=null;
    for(var i=0;i<all.length;i++){
      var el=all[i];
      if(!isVisible(el)) continue;
      var t=(el.type||'text').toLowerCase();
      if(t==='password' && firstPass===null){ firstPass=el; continue; }
      if((t==='text'||t==='email'||t==='') && firstText===null){ firstText=el; }
    }
    return {user:firstText, pass:firstPass};
  }
  function setVal(el,v){
    var d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');
    if(d&&d.set){d.set.call(el,v);} else {el.value=v;}
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  var iv=setInterval(function(){
    tries++;
    if(tries>max){console.log('[penguin] argo prefill gave up after '+tries+' tries');clearInterval(iv);return;}
    // Re-check the flag every tick — a sibling IIFE (from the 1500ms /
    // 4000ms re-eval checkpoint) may have raced past the entry guard
    // and started its own setInterval. The first one to find the form
    // sets the flag; the loser sees it on the next tick and exits
    // without re-submitting. Stops the duplicate-login warning toast.
    if(window.__penguinPrefillDone){clearInterval(iv);return;}
    var userInput=findVisible(userSel);
    var passInput=findVisible(passSel);
    if(userInput===null||passInput===null){
      // Try the DOM-order fallback when named selectors missed both.
      var fb=fallbackPair();
      if(userInput===null) userInput=fb.user;
      if(passInput===null) passInput=fb.pass;
    }
    if(userInput===null||passInput===null) return;
    window.__penguinPrefillDone=true;
    setVal(userInput,u);
    setVal(passInput,p);
    userInput.focus();
    // Diagnostic log — only emits the input tagName + name attribute to
    // avoid leaking the filled-in password value (outerHTML of a filled
    // <input> reflects the value in some Chromium builds).
    console.log('[penguin] argo prefill applied after '+tries+' tries (user='+(userInput.tagName+'['+(userInput.getAttribute('name')||'?')+']')+', pass='+(passInput.tagName+'['+(passInput.getAttribute('name')||'?')+']')+')');
    ${autoSubmitTail}
    clearInterval(iv);
  },200);
})(${safeUsername},${safePassword});`;
    }
    if (active.prefillToken === undefined) return undefined;
    if (active.baseKind !== "vault") return undefined;
    const safeToken = JSON.stringify(active.prefillToken);
    // Robust Vault Token prefill — runs INSIDE the embedded webview.
    // - Priority order: vault-specific selectors first (data-test-token-input
    //   used by Vault 1.20+ Ember UI, then name=token, then id=token,
    //   then any visible password input as last-resort).
    // - Polls for 30s (150 tries × 200ms) since Vault Ember can take a
    //   while to mount, especially on cold sign-in.
    // - Uses the native HTMLInputElement value setter so Ember's two-way
    //   binding sees the change.
    // - console.log breadcrumbs so a user inspecting the EMBEDDED webview's
    //   DevTools can see whether the script ran. Logs are visible only in
    //   the child webview's own console, not Penguin's main devtools.
    return `(function(t){
  console.log('[penguin] token prefill script loaded');
  // Idempotence guard — see argo prefill comment for the same.
  if(window.__penguinPrefillDone){console.log('[penguin] token prefill: skip (already done)');return;}
  var tries=0, max=150;
  var selectors=[
    'input[data-test-token-input]',
    'input[name="token"]',
    'input#token',
    'input[type="password"]'
  ];
  var iv=setInterval(function(){
    tries++;
    if(tries>max){console.log('[penguin] token prefill gave up after '+tries+' tries');clearInterval(iv);return;}
    // Per-tick guard — see argo prefill comment for the same race.
    if(window.__penguinPrefillDone){clearInterval(iv);return;}
    var input=null, hitSelector=null;
    for(var si=0;si<selectors.length;si++){
      var nodes=document.querySelectorAll(selectors[si]);
      for(var i=0;i<nodes.length;i++){
        var el=nodes[i];
        if(el.offsetParent===null) continue;
        input=el; hitSelector=selectors[si]; break;
      }
      if(input!==null) break;
    }
    if(input===null) return;
    window.__penguinPrefillDone=true;
    console.log('[penguin] token field found via '+hitSelector+' after '+tries+' tries');
    var d=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value');
    if(d&&d.set){d.set.call(input,t);} else {input.value=t;}
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    input.focus();
    console.log('[penguin] token prefill applied');
    ${autoSubmitTail}
    clearInterval(iv);
  },200);
})(${safeToken});`;
  }, [active, autoSubmitGlobal, autoSubmitMap, autoSubmitOtp]);

  return (
    <section className="flex flex-1 min-h-0 min-w-0 flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-6 py-3">
        {/* Top-bar tabs — each filters the sidebar to shortcuts whose
            baseKind matches. Aliyun has no shortcuts yet (URLs come
            later); selecting it just shows an empty list. */}
        <div className="flex items-center gap-1.5">
          <TabButton
            active={activeTab === "web"}
            onClick={() => setActiveTab("web")}
            icon={<Globe className="h-3.5 w-3.5 text-emerald-400" />}
            label="Web"
          />
          <TabButton
            active={activeTab === "vault"}
            onClick={() => setActiveTab("vault")}
            icon={<ShieldCheck className="h-3.5 w-3.5 text-amber-500" />}
            label="Vault"
          />
          <TabButton
            active={activeTab === "argocd"}
            onClick={() => setActiveTab("argocd")}
            icon={<LogIn className="h-3.5 w-3.5 text-sky-400" />}
            label="Argo"
          />
          <TabButton
            active={activeTab === "aliyun"}
            onClick={() => setActiveTab("aliyun")}
            icon={<Cloud className="h-3.5 w-3.5 text-orange-500" />}
            label="Aliyun"
          />
          <TabButton
            active={activeTab === "jenkins"}
            onClick={() => setActiveTab("jenkins")}
            icon={<Wrench className="h-3.5 w-3.5 text-rose-400" />}
            label="Jenkins"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleGeneralClearCache}
            title={
              confirmingPurge
                ? "Click again to confirm — wipes cookies + storage for EVERY shortcut and reloads the app."
                : "Clear cookies + cache for all shortcuts (logs out everywhere)"
            }
            aria-label="Clear all browser data"
            className={cn(
              "flex items-center gap-1.5 rounded border px-2 h-8 text-xs font-medium transition-colors",
              confirmingPurge
                ? "border-destructive/60 bg-destructive/15 text-destructive animate-pulse"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Eraser className="h-3.5 w-3.5" />
            {confirmingPurge ? "Confirm?" : null}
          </button>
          <button
            ref={authButtonRef}
            type="button"
            onClick={toggleAuth}
            title={
              hasTotpCreds
                ? "Authenticator (TOTP)"
                : "No TOTP credentials yet — add one in Vault"
            }
            aria-label="Open authenticator"
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded border border-border transition-colors",
              authOpen
                ? "border-primary/40 bg-primary/10 text-foreground"
                : hasTotpCreds
                ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                : "text-muted-foreground/40",
            )}
          >
            <KeyRound className="h-4 w-4" />
          </button>
          <Button variant="outline" size="sm" onClick={props.onClose} className="gap-1">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          onMouseEnter={() => setSidebarHovered(true)}
          onMouseLeave={() => setSidebarHovered(false)}
          className={cn(
            "flex shrink-0 flex-col border-r border-border/60 bg-muted/20 transition-[width] duration-200 ease-out",
            sidebarExpanded ? "w-44" : "w-16",
          )}
        >
          {/* Pin toggle — when pinned, sidebar stays expanded even after
              the mouse leaves. Visible in both states; the icon flips. */}
          <div className="flex shrink-0 items-center justify-end border-b border-border/60 px-1.5 py-1">
            <button
              type="button"
              onClick={() => setSidebarPinned(!sidebarPinned)}
              title={sidebarPinned ? "Unpin sidebar — collapse on mouse leave" : "Pin sidebar — keep expanded"}
              aria-label={sidebarPinned ? "Unpin sidebar" : "Pin sidebar"}
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                sidebarPinned ? "bg-primary/15 text-foreground" : "",
              )}
            >
              {sidebarPinned ? (
                <CornerDownRight className="h-3 w-3 -scale-x-100" />
              ) : (
                <CornerDownRight className="h-3 w-3" />
              )}
            </button>
          </div>
          {!sidebarExpanded ? (
            /* Compact rail — vertical list of [dot/icon, short label].
               Vault/Argo entries show env color dot + env name (≤4 chars).
               Aliyun/Jenkins entries show a brand-colored dot + link label
               (≤5 chars) since they carry no Vault env metadata. */
            <div className="flex-1 overflow-y-auto overflow-x-hidden px-0.5 py-1">
              {displayShortcuts.map((s) => {
                const isActive = s.id === activeShortcutId;
                const env = vaultProjects
                  .find((p) => p.id === s.projectId)
                  ?.environments.find((e) => e.id === s.envId);
                const dotColor = env?.color
                  ?? (s.baseKind === "aliyun" ? "bg-orange-500"
                    : s.baseKind === "jenkins" ? "bg-rose-400"
                    : null);
                const label = (env?.name ?? s.label).slice(0, 5);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveShortcut(s.id)}
                    title={s.label}
                    className={cn(
                      "flex w-full flex-col items-center gap-0.5 rounded px-1 py-1.5 text-[10px] transition-colors",
                      isActive
                        ? "bg-primary/15 text-foreground"
                        : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                    )}
                  >
                    {dotColor !== null ? (
                      <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                    )}
                    <span className="truncate font-medium">{label}</span>
                  </button>
                );
              })}
            </div>
          ) : (
          <>
          {/* Master switch — Auto Sign in (AND-gates every per-shortcut
              ⚡ flag). Off = prefill still happens, but no submit click. */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
            <label
              htmlFor="browser-auto-submit-global"
              className="flex min-w-0 cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground"
              title="When off, no shortcut auto-clicks Sign in even if its ⚡ is on. Off lets you intervene during a flaky sign-in."
            >
              <Zap
                className={cn(
                  "h-3 w-3 shrink-0",
                  autoSubmitGlobal ? "text-amber-500" : "text-muted-foreground/40",
                )}
              />
              <span className="truncate">Auto Sign in</span>
            </label>
            <button
              id="browser-auto-submit-global"
              type="button"
              role="switch"
              aria-checked={autoSubmitGlobal}
              onClick={() => setAutoSubmitGlobal(!autoSubmitGlobal)}
              className={cn(
                "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors",
                autoSubmitGlobal ? "bg-amber-500" : "bg-muted-foreground/30",
              )}
              title={autoSubmitGlobal ? "Turn OFF auto-submit globally" : "Turn ON auto-submit globally"}
            >
              <span
                className={cn(
                  "inline-block h-3 w-3 transform rounded-full bg-background transition-transform",
                  autoSubmitGlobal ? "translate-x-3.5" : "translate-x-0.5",
                )}
              />
            </button>
          </div>
          {activeTab === "aliyun" ? (
            <AliyunSidebar
              activeLinkId={activeShortcutId}
              onSelectLink={(linkId) => setActiveShortcut(linkId)}
              autoSubmitGlobal={autoSubmitGlobal}
              autoSubmitByLinkId={autoSubmitMap}
              isAutoSubmitEffective={(linkId) => {
                const s = aliyunDerivedShortcuts.find((x) => x.id === linkId);
                return s === undefined ? false : effectiveAutoSubmit(s, autoSubmitMap);
              }}
              onToggleAutoSubmit={(linkId) => {
                const s = aliyunDerivedShortcuts.find((x) => x.id === linkId);
                if (s === undefined) return;
                setAutoSubmit(s.id, !effectiveAutoSubmit(s, autoSubmitMap));
              }}
              onClearCache={(linkId) => handleClearCache(linkId)}
              onDuplicate={(linkId) => {
                const src = aliyunLinks.find((l) => l.id === linkId);
                if (src === undefined) return;
                addAliyunLink({
                  label: `${src.label} (copy)`,
                  url: src.url,
                  accountId: src.accountId,
                });
              }}
              pendingClearLinkId={pendingClearShortcutId}
            />
          ) : activeTab === "jenkins" ? (
            <JenkinsSidebar
              activeLinkId={activeShortcutId}
              onSelectLink={(linkId) => setActiveShortcut(linkId)}
              autoSubmitGlobal={autoSubmitGlobal}
              autoSubmitByLinkId={autoSubmitMap}
              isAutoSubmitEffective={(linkId) => {
                const s = jenkinsDerivedShortcuts.find((x) => x.id === linkId);
                return s === undefined ? false : effectiveAutoSubmit(s, autoSubmitMap);
              }}
              onToggleAutoSubmit={(linkId) => {
                const s = jenkinsDerivedShortcuts.find((x) => x.id === linkId);
                if (s === undefined) return;
                setAutoSubmit(s.id, !effectiveAutoSubmit(s, autoSubmitMap));
              }}
              onClearCache={(linkId) => handleClearCache(linkId)}
              onDuplicate={(linkId) => {
                const src = jenkinsLinks.find((l) => l.id === linkId);
                if (src === undefined) return;
                addJenkinsLink({
                  label: `${src.label} (copy)`,
                  url: src.url,
                  accountId: src.accountId,
                });
              }}
              pendingClearLinkId={pendingClearShortcutId}
            />
          ) : (
          <>
          <div className="flex shrink-0 flex-col gap-1.5 border-b border-border/60 px-3 py-2">
            <div className="flex items-center gap-2">
              <Input
                ref={draftInputRef}
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddFromInput();
                  }
                }}
                placeholder="Paste URL & press Enter"
                className={cn(
                  "h-8 text-xs transition-colors",
                  inputFlash === "empty" ? "border-destructive ring-1 ring-destructive/40" : "",
                )}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={handleAddFromInput}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Pin URL"
                aria-label="Pin URL"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto py-1">
            {displayShortcuts.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No shortcuts yet. Add a Vault credential with an http(s) URL
                — it will appear here automatically. You can also paste a URL
                above.
              </p>
            ) : null}
            {groups.map((group) => {
              const header = groupHeaderLabel(group);
              const isActiveGroup = active !== null && groupKey(active) === group.key;
              return (
                <section key={group.key} className="mt-2 first:mt-0">
                  <header
                    className={cn(
                      "mx-1 flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider",
                      isActiveGroup
                        ? "text-foreground/80"
                        : "text-muted-foreground/70",
                    )}
                  >
                    {header.color !== null ? (
                      <span className={cn("h-1.5 w-1.5 rounded-full", header.color)} />
                    ) : null}
                    <span className="truncate">{header.label}</span>
                  </header>
                  <ul>
                    {(() => {
                      // Re-order shortcuts within the group so each
                      // branch (parentId set) appears immediately after
                      // its parent. Top-level shortcuts retain their
                      // createdAt order; branches sort by createdAt
                      // among siblings.
                      const branchesByParent = new Map<string, BrowserShortcut[]>();
                      const topLevel: BrowserShortcut[] = [];
                      for (const s of group.shortcuts) {
                        if (s.parentId !== undefined) {
                          const arr = branchesByParent.get(s.parentId) ?? [];
                          arr.push(s);
                          branchesByParent.set(s.parentId, arr);
                          continue;
                        }
                        topLevel.push(s);
                      }
                      for (const arr of branchesByParent.values()) {
                        arr.sort((a, b) => a.createdAt - b.createdAt);
                      }
                      const ordered: BrowserShortcut[] = [];
                      for (const parent of topLevel) {
                        ordered.push(parent);
                        const branches = branchesByParent.get(parent.id);
                        if (branches !== undefined) ordered.push(...branches);
                      }
                      // Orphaned branches (parent disappeared) fall to
                      // the end so the user can still see + remove them.
                      const orphanIds = new Set(topLevel.map((s) => s.id));
                      for (const [parentId, arr] of branchesByParent) {
                        if (!orphanIds.has(parentId)) ordered.push(...arr);
                      }
                      return ordered;
                    })().map((s) => {
                      const isActive = s.id === activeShortcutId;
                      const isRenaming = renamingId === s.id;
                      const envInfo = envInfoForShortcut(s);
                      const isBranch = s.parentId !== undefined;
                      // Row label is now just the env name (QAT / UAT /
                      // etc.) — tab provides the cred kind, group
                      // header provides the project, so the original
                      // "Vault · CP / QAT" was three redundancies
                      // stacked. Branches use their full label since
                      // it carries the "(2)" / "(3)" suffix that
                      // disambiguates from the parent.
                      const rowLabel = isBranch
                        ? s.label
                        : envInfo.name !== ""
                        ? envInfo.name
                        : s.label;
                      return (
                        <li
                          key={s.id}
                          // Whole row is clickable now — previously only
                          // the inner label <button> was, so clicks on
                          // the star / env dot / surrounding whitespace
                          // were swallowed and the user thought the row
                          // "needed 2-3 tries". Action buttons (Zap /
                          // Eraser / Copy / Trash) stopPropagation so
                          // they don't double-fire.
                          onClick={() => {
                            if (renamingId !== s.id) setActiveShortcut(s.id);
                          }}
                          className={cn(
                            "group mx-1 flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors",
                            isBranch && "ml-4",
                            isActive
                              ? "bg-primary/10 text-foreground"
                              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                          )}
                        >
                          {isBranch ? (
                            <CornerDownRight
                              className="h-3 w-3 shrink-0 text-muted-foreground/40"
                              aria-hidden="true"
                            />
                          ) : (
                            <Star
                              className={cn(
                                "h-3.5 w-3.5 shrink-0",
                                s.prefillToken !== undefined ||
                                  s.prefillUsername !== undefined
                                  ? "text-amber-500"
                                  : "text-muted-foreground/60",
                              )}
                            />
                          )}
                          {envInfo.color !== null ? (
                            <span
                              className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full",
                                envInfo.color,
                              )}
                              title={envInfo.name}
                            />
                          ) : null}
                          {isRenaming ? (
                            <input
                              autoFocus
                              defaultValue={s.label}
                              onBlur={(e) => {
                                renameShortcut(s.id, e.currentTarget.value);
                                setRenamingId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  renameShortcut(s.id, e.currentTarget.value);
                                  setRenamingId(null);
                                } else if (e.key === "Escape") {
                                  setRenamingId(null);
                                }
                              }}
                              className="min-w-0 flex-1 truncate rounded border border-border bg-background px-1 py-0.5 font-mono text-xs text-foreground"
                            />
                          ) : (
                            <span
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setRenamingId(s.id);
                              }}
                              className="min-w-0 flex-1 truncate text-left"
                              title={s.label}
                            >
                              {rowLabel}
                            </span>
                          )}
                          {s.prefillToken !== undefined ||
                          s.prefillUsername !== undefined ? (() => {
                            const effective = effectiveAutoSubmit(s, autoSubmitMap);
                            return (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAutoSubmit(s.id, !effective);
                                }}
                                className={cn(
                                  "flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors",
                                  // Three states: master OFF → muted regardless;
                                  // master ON + per-shortcut ON → amber active;
                                  // master ON + per-shortcut OFF → faded.
                                  !autoSubmitGlobal
                                    ? "text-muted-foreground/25 hover:bg-muted hover:text-muted-foreground/50"
                                    : effective
                                    ? "text-amber-500 hover:bg-amber-500/10"
                                    : "text-muted-foreground/50 hover:bg-muted hover:text-foreground",
                                )}
                                title={
                                  !autoSubmitGlobal
                                    ? `Auto Sign in is globally OFF (master switch at top). This shortcut is set to: ${effective ? "ON" : "OFF"} — flip the master to take effect.`
                                    : effective
                                    ? "Auto Sign in: ON — click to disable. WARNING: failed login attempts may lock the account."
                                    : "Auto Sign in: OFF — click to enable. Will click the Sign in button after prefill."
                                }
                                aria-label="Toggle auto Sign in"
                              >
                                <Zap className="h-3 w-3" />
                              </button>
                            );
                          })() : null}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleClearCache(s.id);
                            }}
                            disabled={pendingClearShortcutId === s.id}
                            className={cn(
                              "flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors",
                              pendingClearShortcutId === s.id
                                ? "text-amber-500 animate-pulse"
                                : "text-muted-foreground/50 hover:bg-muted hover:text-foreground",
                            )}
                            title={
                              pendingClearShortcutId === s.id
                                ? "Clearing cache + cookies… page will reload."
                                : "Clear this shortcut's cookies + cache, then reload"
                            }
                            aria-label="Clear cache for this shortcut"
                          >
                            <Eraser className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              duplicateShortcut(s);
                            }}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground"
                            title="Duplicate this shortcut as an isolated branch (its own cookies / session)"
                            aria-label="Duplicate shortcut"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                          {isVaultDerivedShortcut(s) ? null : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeShortcut(s.id);
                              }}
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                              title="Remove shortcut"
                              aria-label="Remove shortcut"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
          </>
          )}
          </>
          )}
        </aside>

        {active === null || webviewLabel === null ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-sm text-muted-foreground">
            <Compass className="h-10 w-10 text-muted-foreground/50" />
            <div className="flex w-full max-w-2xl items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-4 py-2.5 shadow-sm transition-colors focus-within:border-primary/50 focus-within:bg-background">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground/70" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleEmptyStateGo();
                  }
                }}
                placeholder="Search Google or paste a URL"
                spellCheck={false}
                autoComplete="off"
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleEmptyStateGo}
                disabled={searchDraft.trim().length === 0}
                className="flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-foreground hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                title="Search Google or open this URL"
              >
                <Search className="h-3 w-3" />
                Go
              </button>
            </div>
            <p className="text-xs text-muted-foreground/60">
              Pick a shortcut on the left, or open one from a Vault credential card.
            </p>
          </div>
        ) : (
          // No padding reserve — the Authenticator opens in its own
          // top-level Tauri window now, so the embedded webview can
          // keep using the full available width regardless of popover
          // state.
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <InlineWebviewPanel
              key={`${webviewLabel}-${forceReloadNonce}`}
              label={webviewLabel}
              url={active.url}
              prefillScript={prefillScript}
              // dataKey resolution:
              //   - explicit override (aliyun/jenkins virtual shortcuts
              //     set this to "aliyun-acc-X" / "jenkins-acc-X" so all
              //     links of one account share login)
              //   - else parent's id for branches (duplicate window of
              //     the same account)
              //   - else this shortcut's own id (every root shortcut
              //     gets its own isolated session — different envs on
              //     the same domain no longer leak login state)
              dataKey={active.dataKey ?? active.parentId ?? active.id}
              toolbar={
                <InlineWebviewToolbar
                  label={webviewLabel}
                  url={active.url}
                  onOpenExternal={handleOpenExternal}
                  onRequestClose={() => setActiveShortcut(null)}
                  prefillScript={prefillScript}
                  onForceReload={handleForceReload}
                />
              }
            />
          </div>
        )}
      </div>
    </section>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: ReactElement;
  label: string;
}

function TabButton({ active, onClick, icon, label }: TabButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Show ${label} shortcuts`}
      className={cn(
        // Fixed h-8 so the header's intrinsic height matches the right-
        // side Back button (size="sm" Button → h-8) — without this the
        // taller TabButtons would push the header below the border-b
        // divider line.
        "flex h-8 items-center gap-1.5 rounded border px-3 text-xs font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

