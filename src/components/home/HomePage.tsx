import { BookOpen, Globe, Lock, Send } from "lucide-react";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";

const LOG_SCOPE = "HomePage";

interface HomePageProps {
  onSelectApiClient: () => void;
  onSelectVault: () => void;
  onSelectDocs: () => void;
  onSelectRest: () => void;
}

interface ModuleCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  badge?: string;
  locked?: boolean;
  lockedHint?: string;
  onClick: () => void;
}

// Module launcher landing page. Reached by clicking the Penguin avatar in
// the Header. Tier gating mirrors MainSidebar so the cards stay in sync
// with what's actually clickable from the rail:
//   - Client: always available
//   - Vault: token tier (dev mode on + valid token)
//   - REST + Knowledge Base: super-admin tier
export function HomePage(props: HomePageProps) {
  const { enabled, hasValidToken, isSuperAdmin } = useDeveloperMode();
  const isVaultUnlocked = enabled && hasValidToken;
  const isSuperUnlocked = enabled && isSuperAdmin;

  const handleSelectApiClient = (): void => {
    logger.info(LOG_SCOPE, "handleSelectApiClient — entry");
    props.onSelectApiClient();
    logger.info(LOG_SCOPE, "handleSelectApiClient — exit");
  };

  const handleSelectVault = (): void => {
    if (!isVaultUnlocked) {
      logger.warn(LOG_SCOPE, "handleSelectVault — locked");
      return;
    }
    props.onSelectVault();
  };

  const handleSelectDocs = (): void => {
    if (!isSuperUnlocked) {
      logger.warn(LOG_SCOPE, "handleSelectDocs — locked (super-admin required)");
      return;
    }
    props.onSelectDocs();
  };

  const handleSelectRest = (): void => {
    if (!isSuperUnlocked) {
      logger.warn(LOG_SCOPE, "handleSelectRest — locked (super-admin required)");
      return;
    }
    props.onSelectRest();
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col items-center justify-center bg-background px-8 py-12">
      <div className="mb-10 flex flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <img src="/penguin.png" alt="Penguin" className="h-10" draggable={false} />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">Penguin</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          选择一个 module 开始 / Choose a module to start
        </p>
      </div>

      <div className="grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2">
        <ModuleCard
          title="API Client"
          description="gRPC-Web · gRPC · SDK — 发送请求 / 调试 / 保存"
          icon={<Globe className="h-6 w-6" />}
          badge="Default"
          onClick={handleSelectApiClient}
        />
        <ModuleCard
          title="Vault"
          description="凭据管理：从 Lark 文档同步 · 复制 · CRUD"
          icon={<Lock className="h-6 w-6" />}
          locked={!isVaultUnlocked}
          lockedHint="需要 Developer Mode 已开启 + token 已验证"
          onClick={handleSelectVault}
        />
        <ModuleCard
          title="REST"
          description="REST API 客户端：collections / 环境 / Postman-style import（super-admin）"
          icon={<Send className="h-6 w-6" />}
          locked={!isSuperUnlocked}
          lockedHint="需要 super-admin token"
          onClick={handleSelectRest}
        />
        <ModuleCard
          title="Knowledge Base"
          description="API 文档：集合 / 端点 / 参数表 / 示例 · Lark 同步（super-admin）"
          icon={<BookOpen className="h-6 w-6" />}
          locked={!isSuperUnlocked}
          lockedHint="需要 super-admin token"
          onClick={handleSelectDocs}
        />
      </div>
    </div>
  );
}

// Single module tile. Locked cards render dimmed + non-interactive and show
// the lockedHint as title text on hover.
function ModuleCard(props: ModuleCardProps) {
  const isLocked = props.locked === true;
  const isInteractive = !isLocked;

  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={isLocked}
      title={isLocked ? props.lockedHint ?? "Locked" : props.title}
      className={cn(
        "group flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-5 text-left transition-colors",
        isInteractive ? "hover:border-primary/50 hover:bg-card/80" : "cursor-not-allowed opacity-50",
      )}
    >
      <div
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-xl",
          isInteractive ? "bg-primary/10 text-primary" : "bg-muted/40 text-muted-foreground",
        )}
      >
        {props.icon}
      </div>
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-foreground">{props.title}</h3>
        {props.badge !== undefined ? (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
            {props.badge}
          </span>
        ) : null}
        {isLocked ? (
          <span className="rounded-full bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            Locked
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{props.description}</p>
    </button>
  );
}
