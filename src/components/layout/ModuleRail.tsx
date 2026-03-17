import { cn } from "@/lib/utils";
import {
  WORKSPACE_MODULES,
  type WorkspaceModule,
} from "@/lib/workspace-modules";

interface ModuleRailProps {
  activeModule: WorkspaceModule;
  onOpenModule: (module: WorkspaceModule) => void;
}

export function ModuleRail({ activeModule, onOpenModule }: ModuleRailProps) {
  return (
    <aside className="flex w-20 shrink-0 flex-col items-center border-r border-border bg-card/60 py-3">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-sm font-semibold text-primary">
        P
      </div>

      <div className="flex flex-1 flex-col gap-2">
        {WORKSPACE_MODULES.map((module) => {
          const Icon = module.icon;
          const isActive = module.id === activeModule;

          return (
            <button
              key={module.id}
              type="button"
              onClick={() => onOpenModule(module.id)}
              className={cn(
                "group flex w-16 flex-col items-center gap-1.5 rounded-2xl px-2 py-2 text-[11px] transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
              title={`${module.label} — ${module.description}`}
            >
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-xl transition-colors",
                  isActive ? module.accentClassName : "bg-muted/50 text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="leading-none">{module.shortLabel}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

