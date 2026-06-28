// Jenkins tab sidebar. Two sections — Accounts (RAM users + optional
// TOTP) and Links (SLS bookmarks each bound to one account). Both
// support inline add via expanding form + per-row delete. Selecting a
// link calls onActivateLink with a synthetic BrowserShortcut so the
// existing webview pipeline picks it up.

import { useState, type FormEvent, type ReactElement } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Eraser,
  Plus,
  Star,
  Trash2,
  UserCircle2,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/lib/store";
import type {
  JenkinsAccount,
  JenkinsLink,
  BrowserShortcut,
} from "@/lib/store-types";

const JENKINS_LINK_PREFIX = "jenkins-link-";

export function isJenkinsLinkShortcutId(id: string): boolean {
  return id.startsWith(JENKINS_LINK_PREFIX);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// Build the virtual BrowserShortcut feeding the right-pane InlineWebview
// when the user picks an Jenkins link. Account is required: the whole
// point of the tab is one-click logged-in access.
export function jenkinsLinkToBrowserShortcut(
  link: JenkinsLink,
  account: JenkinsAccount,
): BrowserShortcut {
  return {
    id: link.id,
    label: link.label,
    url: link.url,
    baseKind: "jenkins",
    prefillUsername: account.username,
    prefillPassword: account.password,
    // All links bound to the same account share one WKWebsiteDataStore,
    // so logging in once works across every link the user has saved
    // for that account.
    // account.id already starts with "jenkins-acc-" — don't add
    // the prefix a second time or the data dir path gets doubled.
    dataKey: account.id,
    createdAt: link.createdAt,
  };
}

export interface JenkinsSidebarProps {
  // Set by BrowserPage when the user picks a link — it's just the link
  // id, the parent then derives the active BrowserShortcut from the
  // store and routes the webview accordingly.
  activeLinkId: string | null;
  onSelectLink: (linkId: string) => void;
  // Per-link row controls — wired from BrowserPage to keep behavior
  // identical to Vault/Argo shortcuts (auto-submit ⚡, clear cache 🧹,
  // duplicate 📋). Without these we'd have a separate, less capable
  // row UI for Jenkins/Jenkins — the user expects uniform behavior.
  autoSubmitGlobal: boolean;
  autoSubmitByLinkId: Record<string, boolean>;
  // Default ⚡ state: ON when the link has prefill data (which Jenkins
  // links always do — they carry the bound account's username/password).
  // BrowserPage owns the resolver so vault/argo/jenkins/jenkins share
  // the same effective-state semantics.
  isAutoSubmitEffective: (linkId: string) => boolean;
  onToggleAutoSubmit: (linkId: string) => void;
  onClearCache: (linkId: string) => void;
  onDuplicate: (linkId: string) => void;
  pendingClearLinkId: string | null;
}

export function JenkinsSidebar({
  activeLinkId,
  onSelectLink,
  autoSubmitGlobal,
  isAutoSubmitEffective,
  onToggleAutoSubmit,
  onClearCache,
  onDuplicate,
  pendingClearLinkId,
}: JenkinsSidebarProps): ReactElement {
  const accounts = useAppStore((s) => s.jenkins.accounts);
  const links = useAppStore((s) => s.jenkins.links);
  const addAccount = useAppStore((s) => s.addJenkinsAccount);
  const removeAccount = useAppStore((s) => s.removeJenkinsAccount);
  const addLink = useAppStore((s) => s.addJenkinsLink);
  const removeLink = useAppStore((s) => s.removeJenkinsLink);

  // Accounts panel auto-collapses once there's at least one account so
  // the user's eye lands on Links by default.
  const [accountsOpen, setAccountsOpen] = useState<boolean>(accounts.length === 0);
  const [addingAccount, setAddingAccount] = useState<boolean>(false);
  const [addingLink, setAddingLink] = useState<boolean>(false);

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-y-auto">
      {/* ===== Accounts ===== */}
      <section className="shrink-0">
        <header className="flex items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          <button
            type="button"
            onClick={() => setAccountsOpen((v) => !v)}
            className="flex items-center gap-1 hover:text-foreground"
          >
            {accountsOpen ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Accounts
            <span className="text-muted-foreground/60">({accounts.length})</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setAccountsOpen(true);
              setAddingAccount(true);
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground"
            title="Add Jenkins account"
            aria-label="Add account"
          >
            <Plus className="h-3 w-3" />
          </button>
        </header>
        {accountsOpen ? (
          <div className="flex flex-col gap-0.5 px-1 pb-2">
            {accounts.map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                onDelete={() => removeAccount(a.id)}
              />
            ))}
            {addingAccount ? (
              <InlineAddAccountForm
                onCancel={() => setAddingAccount(false)}
                onSave={(payload) => {
                  addAccount(payload);
                  setAddingAccount(false);
                }}
              />
            ) : accounts.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground/70">
                Add a RAM user (username + password + optional 2FA secret) to
                start linking SLS bookmarks.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <div className="mx-3 border-t border-border/60" />

      {/* ===== Links ===== */}
      <section className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          <span>Links ({links.length})</span>
          <button
            type="button"
            onClick={() => setAddingLink(true)}
            disabled={accounts.length === 0}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
            title={
              accounts.length === 0
                ? "Add an account first"
                : "Add SLS link"
            }
            aria-label="Add link"
          >
            <Plus className="h-3 w-3" />
          </button>
        </header>
        <div className="flex flex-col gap-0.5 px-1 pb-2">
          {links.map((l) => {
            const account = accounts.find((a) => a.id === l.accountId);
            return (
              <LinkRow
                key={l.id}
                link={l}
                accountLabel={account?.label ?? "(missing account)"}
                isActive={l.id === activeLinkId}
                autoSubmitGlobal={autoSubmitGlobal}
                autoSubmitEffective={isAutoSubmitEffective(l.id)}
                pendingClear={pendingClearLinkId === l.id}
                onClick={() => onSelectLink(l.id)}
                onToggleAutoSubmit={() => onToggleAutoSubmit(l.id)}
                onClearCache={() => onClearCache(l.id)}
                onDuplicate={() => onDuplicate(l.id)}
                onDelete={() => removeLink(l.id)}
              />
            );
          })}
          {addingLink ? (
            <InlineAddLinkForm
              accounts={accounts}
              onCancel={() => setAddingLink(false)}
              onSave={(payload) => {
                addLink(payload);
                setAddingLink(false);
              }}
            />
          ) : links.length === 0 && accounts.length > 0 ? (
            <p className="px-2 py-3 text-center text-[11px] text-muted-foreground/70">
              No links yet. Click + to add an SLS bookmark.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}

interface AccountRowProps {
  account: JenkinsAccount;
  onDelete: () => void;
}

function AccountRow({ account, onDelete }: AccountRowProps): ReactElement {
  return (
    <div className="group mx-1 flex items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50">
      <UserCircle2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground" title={account.label}>
          {account.label}
        </div>
        <div className="truncate text-[10px] text-muted-foreground/70" title={account.username}>
          {account.username}
          {account.totpSecret ? " · 2FA" : ""}
        </div>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
        title="Delete account (cascades its links)"
        aria-label="Delete account"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

interface LinkRowProps {
  link: JenkinsLink;
  accountLabel: string;
  isActive: boolean;
  autoSubmitGlobal: boolean;
  autoSubmitEffective: boolean;
  pendingClear: boolean;
  onClick: () => void;
  onToggleAutoSubmit: () => void;
  onClearCache: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

function LinkRow({
  link,
  accountLabel,
  isActive,
  autoSubmitGlobal,
  autoSubmitEffective,
  pendingClear,
  onClick,
  onToggleAutoSubmit,
  onClearCache,
  onDuplicate,
  onDelete,
}: LinkRowProps): ReactElement {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group mx-1 flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-xs transition-colors",
        isActive
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      <Star className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={link.url}>
          {link.label}
        </div>
        <div className="truncate text-[10px] text-muted-foreground/60">
          via {accountLabel}
        </div>
      </div>
      {/* Row action cluster — same shape as Vault/Argo shortcut rows
          (⚡ auto-submit · 🧹 clear cache · 📋 duplicate · 🗑 delete). */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleAutoSubmit();
        }}
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors",
          !autoSubmitGlobal
            ? "text-muted-foreground/25 hover:bg-muted hover:text-muted-foreground/50"
            : autoSubmitEffective
            ? "text-amber-500 hover:bg-amber-500/10"
            : "text-muted-foreground/50 hover:bg-muted hover:text-foreground",
        )}
        title={
          !autoSubmitGlobal
            ? `Auto Sign in is globally OFF (master switch at top). This link is set to: ${autoSubmitEffective ? "ON" : "OFF"}.`
            : autoSubmitEffective
            ? "Auto Sign in: ON — click to disable."
            : "Auto Sign in: OFF — click to enable."
        }
        aria-label="Toggle auto Sign in"
      >
        <Zap className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClearCache();
        }}
        disabled={pendingClear}
        className={cn(
          // Collapse secondary actions at rest so the link name keeps the
          // full row width (the narrow sidebar can't fit 4 buttons + a
          // readable label) — revealed on hover / when active. Pending
          // clear forces it visible so the in-flight pulse isn't hidden.
          isActive || pendingClear ? "flex" : "hidden group-hover:flex",
          "h-5 w-5 shrink-0 items-center justify-center rounded transition-colors",
          pendingClear
            ? "text-amber-500 animate-pulse"
            : "text-muted-foreground/50 hover:bg-muted hover:text-foreground",
        )}
        title={
          pendingClear
            ? "Clearing cache + cookies… page will reload."
            : "Clear this account's cookies + cache, then reload (affects every link bound to the same account)"
        }
        aria-label="Clear cache"
      >
        <Eraser className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate();
        }}
        className={cn(
          isActive ? "flex" : "hidden group-hover:flex",
          "h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground",
        )}
        title="Duplicate this link (same URL + account, new row — shares session via the account's data store)"
        aria-label="Duplicate link"
      >
        <Copy className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className={cn(
          isActive ? "flex" : "hidden group-hover:flex",
          "h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive",
        )}
        title="Remove link"
        aria-label="Remove link"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

interface InlineAddAccountFormProps {
  onCancel: () => void;
  onSave: (payload: { label: string; username: string; password: string; totpSecret?: string }) => void;
}

function InlineAddAccountForm({ onCancel, onSave }: InlineAddAccountFormProps): ReactElement {
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const l = label.trim();
    const u = username.trim();
    const p = password;
    if (l.length === 0 || u.length === 0 || p.length === 0) return;
    const totp = totpSecret.replace(/\s+/g, "");
    onSave({
      label: l,
      username: u,
      password: p,
      totpSecret: totp.length > 0 ? totp : undefined,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-1 mt-1 flex flex-col gap-1.5 rounded border border-border/60 bg-background/40 p-2"
    >
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label (e.g. shieng-prod)"
        className="h-7 rounded border border-border bg-background px-2 text-xs"
        autoFocus
      />
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        className="h-7 rounded border border-border bg-background px-2 text-xs"
        autoComplete="off"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        className="h-7 rounded border border-border bg-background px-2 text-xs"
        autoComplete="off"
      />
      <input
        type="password"
        value={totpSecret}
        onChange={(e) => setTotpSecret(e.target.value)}
        placeholder="2FA secret (base32, optional)"
        className="h-7 rounded border border-border bg-background px-2 text-[11px] font-mono"
        autoComplete="off"
      />
      <div className="flex gap-1.5">
        <button
          type="submit"
          className="flex-1 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-primary/20"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

interface InlineAddLinkFormProps {
  accounts: JenkinsAccount[];
  onCancel: () => void;
  onSave: (payload: { label: string; url: string; accountId: string }) => void;
}

function InlineAddLinkForm({ accounts, onCancel, onSave }: InlineAddLinkFormProps): ReactElement {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? "");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const l = label.trim();
    const u = url.trim();
    if (l.length === 0 || u.length === 0 || accountId.length === 0 || !isHttpUrl(u)) return;
    onSave({ label: l, url: u, accountId });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-1 mt-1 flex flex-col gap-1.5 rounded border border-border/60 bg-background/40 p-2"
    >
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Label (e.g. FPMS-NT QAT logs)"
        className="h-7 rounded border border-border bg-background px-2 text-xs"
        autoFocus
      />
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://sls.console.alibabacloud.com/…"
        className="h-7 rounded border border-border bg-background px-2 text-[11px] font-mono"
        autoComplete="off"
      />
      <select
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        className="h-7 rounded border border-border bg-background px-1 text-xs"
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
      <div className="flex gap-1.5">
        <button
          type="submit"
          className="flex-1 rounded border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-primary/20"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
