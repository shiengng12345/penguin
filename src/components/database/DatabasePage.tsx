import { Server, Zap } from "lucide-react";
import { useState, type ReactElement } from "react";
import { RedisPage } from "@/components/redis/RedisPage";
import { RedisRdmShell } from "@/components/redis/RedisRdmShell";
import { cn } from "@/lib/utils";

type DatabaseType = "redis" | "prototype";

const DATABASE_TYPES: Array<{
  id: DatabaseType;
  label: string;
  description: string;
  icon: ReactElement;
}> = [
  {
    id: "redis",
    label: "Redis",
    description: "Key-value browser",
    icon: <Server className="h-3.5 w-3.5 text-red-400" />,
  },
  {
    id: "prototype",
    label: "RDM 原型",
    description: "多连接 + MONITOR 地基 spike",
    icon: <Zap className="h-3.5 w-3.5 text-amber-400" />,
  },
];

export interface DatabasePageProps {
  onClose: () => void;
}

export function DatabasePage({ onClose }: DatabasePageProps): ReactElement {
  const [activeType, setActiveType] = useState<DatabaseType>("redis");

  return (
    <section className="flex h-full flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-6 py-3">
        <div className="flex items-center gap-1.5">
          {DATABASE_TYPES.map((type) => (
            <DatabaseTypeButton
              key={type.id}
              active={activeType === type.id}
              onClick={() => setActiveType(type.id)}
              icon={type.icon}
              label={type.label}
              description={type.description}
            />
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {activeType === "redis" ? <RedisPage onClose={onClose} /> : null}
        {activeType === "prototype" ? <RedisRdmShell /> : null}
      </div>
    </section>
  );
}

interface DatabaseTypeButtonProps {
  active: boolean;
  onClick: () => void;
  icon: ReactElement;
  label: string;
  description: string;
}

function DatabaseTypeButton({
  active,
  onClick,
  icon,
  label,
  description,
}: DatabaseTypeButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      title={description}
      aria-pressed={active}
      className={cn(
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
