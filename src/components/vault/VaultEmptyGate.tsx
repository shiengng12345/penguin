import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";

const LOG_SCOPE = "VaultEmptyGate";

// Listened to by App.tsx — clicking "Open Settings" inside the gate must
// bubble back up to App so the SettingsDialog opens. We use document (not
// window) to match the existing penguin:* event pattern (DEC #57 / #59).
export const PENGUIN_OPEN_SETTINGS_EVENT = "penguin:open-settings";
export const PENGUIN_GO_HOME_EVENT = "penguin:go-home";

// Two-level gate empty state. Rendered when Dev Mode is enabled but the user
// has not yet verified their token (DEC #56). Pushes them back to Settings
// via a CustomEvent rather than holding a prop drill from VaultPage.
export function VaultEmptyGate() {
  const handleOpenSettings = (): void => {
    logger.info(LOG_SCOPE, "handleOpenSettings — dispatching open-settings event");
    document.dispatchEvent(new CustomEvent(PENGUIN_OPEN_SETTINGS_EVENT));
    logger.info(LOG_SCOPE, "handleOpenSettings — dispatched");
  };

  return (
    <div className="flex flex-1 min-h-0 items-center justify-center p-8">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
          <Lock className="h-6 w-6 text-primary" />
        </div>
        <h2 className="text-base font-semibold text-foreground">Penguin Vault</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          请先在 Settings 验证 token / Verify token in Settings first
        </p>
        <Button className="mt-6" onClick={handleOpenSettings}>
          Open Settings
        </Button>
      </div>
    </div>
  );
}
