import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getWorkspaceModuleDefinition,
  type WorkspaceModule,
} from "@/lib/workspace-modules";

type PlannedToolModule = Exclude<WorkspaceModule, "home" | "api" | "ot">;

const MODULE_PLANS: Record<
  PlannedToolModule,
  {
    summary: string;
    focus: string[];
    nextPhase: string[];
    workflowValue: string;
  }
> = {
  redis: {
    summary: "A Redis workspace should make cache inspection fast: search keys, inspect values, check TTL, and compare what changed after an API call.",
    focus: [
      "Connection profiles per environment",
      "Key browser with type and TTL indicators",
      "Value inspector for string, hash, list, set, and JSON-like payloads",
    ],
    nextPhase: [
      "Read-first explorer",
      "Inline delete / expire / refresh actions",
      "API-to-cache debugging flow",
    ],
    workflowValue: "After sending a request in API, jump straight into Redis to confirm cache keys or invalidation behavior.",
  },
  mongodb: {
    summary: "A MongoDB workspace should focus on collection exploration, readable documents, and quick verification after backend mutations.",
    focus: [
      "Saved connections and database tree",
      "Collection explorer with filters, sort, and limit",
      "Document viewer with raw JSON and field inspector",
    ],
    nextPhase: [
      "Read-only first pass",
      "Simple find/query builder",
      "Compare documents before and after API operations",
    ],
    workflowValue: "Run an API request and immediately verify whether the expected MongoDB document was created or updated.",
  },
  docker: {
    summary: "A Docker workspace should begin as an operations explorer, not a full Docker Desktop clone. The first value is visibility and basic runtime actions.",
    focus: [
      "Container list with status and ports",
      "Logs viewer with follow and copy",
      "Start, stop, restart, and inspect actions",
    ],
    nextPhase: [
      "Images and volumes later",
      "Context / socket selection",
      "Logs beside API requests while debugging",
    ],
    workflowValue: "Keep service logs open while exercising APIs so backend issues can be traced without switching apps.",
  },
};

interface ToolWorkspacePanelProps {
  module: PlannedToolModule;
  onOpenModule: (module: WorkspaceModule) => void;
}

export function ToolWorkspacePanel({
  module,
  onOpenModule,
}: ToolWorkspacePanelProps) {
  const definition = getWorkspaceModuleDefinition(module);
  const plan = MODULE_PLANS[module];
  const Icon = definition.icon;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-3xl">
              <div className="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                Module foundation
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl", definition.accentClassName)}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold text-foreground">{definition.label}</h1>
                  <p className="text-sm text-muted-foreground">{definition.description}</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                {plan.summary}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onOpenModule("api")}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:border-primary/40"
            >
              Open API workspace
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-foreground">Core scope</h2>
            <div className="mt-4 space-y-3">
              {plan.focus.map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm text-foreground"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-foreground">Next implementation pass</h2>
            <div className="mt-4 space-y-3">
              {plan.nextPhase.map((item) => (
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

        <section className="rounded-3xl border border-border bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-foreground">Why this module belongs in Penguin</h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {plan.workflowValue}
          </p>
        </section>
      </div>
    </div>
  );
}
