import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  WORKSPACE_MODULES,
  type WorkspaceModule,
} from "@/lib/workspace-modules";

const CROSS_TOOL_WORKFLOWS = [
  "Send an API request, then inspect Redis keys and MongoDB documents in the same app session.",
  "Keep Docker logs open beside API requests while you reproduce backend issues.",
  "Use one workspace for dev, staging, and prod connections across every tool module.",
];

const FOUNDATION_ITEMS = [
  "Module navigation and workspace tabs",
  "API stays fully functional under the new shell",
  "Redis, MongoDB, and Docker get dedicated entry points for next-phase implementation",
];

interface HomeWorkspaceProps {
  onOpenModule: (module: WorkspaceModule) => void;
}

export function HomeWorkspace({ onOpenModule }: HomeWorkspaceProps) {
  const featureModules = WORKSPACE_MODULES.filter((module) => module.id !== "home");

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <div className="max-w-3xl">
            <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              Developer workspace foundation
            </div>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
              One app, multiple backend tools
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Penguin can grow from an API client into a general developer workspace.
              The right structure is module-based: API, Redis, MongoDB, Docker, and more
              without turning the app into one giant screen.
            </p>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-4">
            {featureModules.map((module) => {
              const Icon = module.icon;

              return (
                <button
                  key={module.id}
                  type="button"
                  onClick={() => onOpenModule(module.id)}
                  className="rounded-2xl border border-border bg-background/70 p-4 text-left transition hover:border-primary/30 hover:bg-background"
                >
                  <div className={cn("flex h-10 w-10 items-center justify-center rounded-2xl", module.accentClassName)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="mt-4">
                    <h2 className="text-base font-semibold text-foreground">{module.label}</h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {module.description}
                    </p>
                  </div>
                  <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                    Open module
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-foreground">Cross-tool workflows</h2>
            <div className="mt-4 space-y-3">
              {CROSS_TOOL_WORKFLOWS.map((item, index) => (
                <div
                  key={item}
                  className="flex items-start gap-3 rounded-2xl border border-border bg-background/70 px-4 py-3"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {index + 1}
                  </div>
                  <p className="text-sm leading-6 text-foreground">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-foreground">What starts now</h2>
            <div className="mt-4 space-y-3">
              {FOUNDATION_ITEMS.map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm text-foreground"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

