import {
  Calculator,
  Container,
  Database,
  DatabaseZap,
  LayoutDashboard,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export type WorkspaceModule = "home" | "api" | "redis" | "mongodb" | "docker" | "ot";

export interface WorkspaceModuleDefinition {
  id: WorkspaceModule;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
  accentClassName: string;
}

export const WORKSPACE_MODULES: WorkspaceModuleDefinition[] = [
  {
    id: "home",
    label: "Home",
    shortLabel: "Home",
    description: "Launch and switch between developer tools.",
    icon: LayoutDashboard,
    accentClassName: "bg-sky-500/15 text-sky-500",
  },
  {
    id: "api",
    label: "API",
    shortLabel: "API",
    description: "gRPC-Web, gRPC, and SDK request tools.",
    icon: Workflow,
    accentClassName: "bg-violet-500/15 text-violet-500",
  },
  {
    id: "redis",
    label: "Redis",
    shortLabel: "Redis",
    description: "Browse keys, inspect values, and debug cache behavior.",
    icon: DatabaseZap,
    accentClassName: "bg-rose-500/15 text-rose-500",
  },
  {
    id: "mongodb",
    label: "MongoDB",
    shortLabel: "Mongo",
    description: "Explore collections, documents, filters, and indexes.",
    icon: Database,
    accentClassName: "bg-emerald-500/15 text-emerald-500",
  },
  {
    id: "docker",
    label: "Docker",
    shortLabel: "Docker",
    description: "Inspect containers, logs, images, and runtime actions.",
    icon: Container,
    accentClassName: "bg-cyan-500/15 text-cyan-500",
  },
  {
    id: "ot",
    label: "OT",
    shortLabel: "OT",
    description: "Record overtime sessions, calculate hours, and estimate payout.",
    icon: Calculator,
    accentClassName: "bg-amber-500/15 text-amber-500",
  },
];

const WORKSPACE_MODULE_MAP = Object.fromEntries(
  WORKSPACE_MODULES.map((module) => [module.id, module]),
) as Record<WorkspaceModule, WorkspaceModuleDefinition>;

export function getWorkspaceModuleDefinition(module: WorkspaceModule): WorkspaceModuleDefinition {
  return WORKSPACE_MODULE_MAP[module];
}
