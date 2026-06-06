import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Folder,
  ChevronDown,
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  GripVertical,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";
import type { VaultEnvId, VaultProject } from "./types";

const LOG_SCOPE = "VaultSidebar";
const SIDEBAR_WIDTH_CLASS = "w-60";

interface VaultSidebarProps {
  projects: VaultProject[];
  selectedProjectId: string;
  selectedEnvId: VaultEnvId;
  onSelectEnv: (envId: VaultEnvId) => void;
  onClose: () => void;
  onAddProject?: () => void;
  onSelectProject?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onEditProject?: (projectId: string) => void;
  // Superadmin only — receives the new ordered list of ids after a drop.
  onReorderProjects?: (orderedIds: readonly string[]) => void;
}

export function VaultSidebar({
  projects,
  selectedProjectId,
  selectedEnvId,
  onSelectEnv,
  onClose,
  onAddProject,
  onSelectProject,
  onDeleteProject,
  onEditProject,
  onReorderProjects,
}: VaultSidebarProps) {
  const { isSuperAdmin } = useDeveloperMode();
  const showAddProject = isSuperAdmin && onAddProject !== undefined;
  const showProjectMenu = isSuperAdmin && (onDeleteProject !== undefined || onEditProject !== undefined);
  const canReorder = isSuperAdmin && onReorderProjects !== undefined;

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const noMenuOpen = openMenuId === null;
    if (noMenuOpen) return;
    const handler = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      const isOutside = menuRef.current !== null && target !== null && !menuRef.current.contains(target);
      if (isOutside) setOpenMenuId(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenuId]);

  // 8px activation distance prevents accidental drags during simple clicks on
  // the project name or 3-dot menu.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    const noTarget = over === null || active.id === over.id;
    if (noTarget) return;
    const oldIndex = projects.findIndex((project) => project.id === active.id);
    const newIndex = projects.findIndex((project) => project.id === over.id);
    const isMissing = oldIndex === -1 || newIndex === -1;
    if (isMissing) return;
    const reordered = arrayMove(projects, oldIndex, newIndex);
    onReorderProjects?.(reordered.map((project) => project.id));
    logger.info(LOG_SCOPE, "handleDragEnd — reordered", { oldIndex, newIndex });
  };

  const handleEnvClick = (projectId: string, envId: VaultEnvId): void => {
    const isDifferentProject = projectId !== selectedProjectId;
    if (isDifferentProject && onSelectProject !== undefined) {
      onSelectProject(projectId);
    }
    onSelectEnv(envId);
  };

  return (
    <aside
      className={cn(
        SIDEBAR_WIDTH_CLASS,
        "flex shrink-0 flex-col border-r border-border bg-card",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          aria-label="Back / 返回"
          title="Back / 返回 (Esc)"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="text-sm font-semibold text-foreground">Penguin Vault</div>
      </div>

      <div className="mt-4 flex items-center justify-between px-4 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Projects</span>
        {showAddProject ? (
          <button
            type="button"
            onClick={onAddProject}
            className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            aria-label="Add project"
            title="Add project"
          >
            <Plus className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pt-1">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={projects.map((project) => project.id)} strategy={verticalListSortingStrategy}>
            {projects.map((project) => (
              <SortableProjectRow
                key={project.id}
                project={project}
                isActive={project.id === selectedProjectId}
                selectedEnvId={selectedEnvId}
                canReorder={canReorder}
                showProjectMenu={showProjectMenu}
                isMenuOpen={openMenuId === project.id}
                onMenuToggle={() => setOpenMenuId((prev) => (prev === project.id ? null : project.id))}
                menuRef={menuRef}
                onSelectProject={onSelectProject}
                onEditProject={onEditProject}
                onDeleteProject={onDeleteProject}
                onEnvClick={handleEnvClick}
                onMenuClose={() => setOpenMenuId(null)}
              />
            ))}
          </SortableContext>
        </DndContext>
      </div>
    </aside>
  );
}

interface SortableProjectRowProps {
  project: VaultProject;
  isActive: boolean;
  selectedEnvId: VaultEnvId;
  canReorder: boolean;
  showProjectMenu: boolean;
  isMenuOpen: boolean;
  onMenuToggle: () => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
  onSelectProject?: (projectId: string) => void;
  onEditProject?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onEnvClick: (projectId: string, envId: VaultEnvId) => void;
  onMenuClose: () => void;
}

function SortableProjectRow(props: SortableProjectRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.project.id, disabled: !props.canReorder });

  // dnd-kit drives the visual translation during drag + the smooth settle
  // animation on drop via the same transform/transition pair.
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="mb-1">
      <div className="group flex items-center gap-1 rounded-md px-2 py-1.5">
        {props.canReorder ? (
          <button
            type="button"
            className="flex h-5 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/60 hover:bg-muted/40 hover:text-foreground active:cursor-grabbing"
            aria-label="Drag to reorder"
            title="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3 w-3" />
          </button>
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <Folder
          className={cn(
            "h-3.5 w-3.5",
            props.isActive ? "text-primary" : "text-muted-foreground",
          )}
        />
        <button
          type="button"
          onClick={() => props.onSelectProject?.(props.project.id)}
          className={cn(
            "flex-1 truncate text-left text-xs",
            props.isActive ? "font-semibold text-foreground" : "text-foreground/80 hover:text-foreground",
          )}
        >
          {props.project.name}
        </button>
        {props.showProjectMenu ? (
          <ProjectMenu
            isOpen={props.isMenuOpen}
            onToggle={props.onMenuToggle}
            onEdit={props.onEditProject !== undefined ? () => { props.onMenuClose(); props.onEditProject!(props.project.id); } : undefined}
            onDelete={props.onDeleteProject !== undefined ? () => { props.onMenuClose(); props.onDeleteProject!(props.project.id); } : undefined}
            menuRef={props.menuRef}
          />
        ) : null}
      </div>
      <div className="ml-4 flex flex-col gap-0.5 border-l border-border pl-2">
        {props.project.environments.map((env) => {
          const isActiveEnv = props.isActive && env.id === props.selectedEnvId;
          return (
            <button
              key={env.id}
              type="button"
              onClick={() => props.onEnvClick(props.project.id, env.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 text-xs",
                isActiveEnv
                  ? "bg-primary/10 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
            >
              <span className={cn("h-2 w-2 shrink-0 rounded-full", env.color)} />
              <span className="flex-1 text-left">{env.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ProjectMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
}

function ProjectMenu(props: ProjectMenuProps) {
  return (
    <div className="relative" ref={props.isOpen ? props.menuRef : undefined}>
      <button
        type="button"
        onClick={props.onToggle}
        className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        aria-label="Project menu"
        title="Project menu"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {props.isOpen ? (
        <div className="absolute right-0 top-6 z-30 w-40 rounded-md border border-border bg-popover py-1 shadow-lg">
          {props.onEdit !== undefined ? (
            <button
              type="button"
              onClick={props.onEdit}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/50"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit project
            </button>
          ) : null}
          {props.onDelete !== undefined ? (
            <button
              type="button"
              onClick={props.onDelete}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete project
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
