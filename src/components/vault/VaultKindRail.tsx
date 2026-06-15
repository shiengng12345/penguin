// Sprint 5 — middle category column with full CRUD + drag parity
// with the Projects sidebar.
//
// User direction: "Kinds 跟 Projects 一模一样，可以 drag 可以 CRUD".
// So the rail now reads `project.kinds` (a user-managed list) instead
// of a hardcoded enum, and exposes Add / Rename / Delete / Reorder
// handlers up to VaultPage.
//
// Layout mirrors VaultSidebar:
//   [h-14 header bar — matches "Penguin Vault" header height + style]
//   [PROJECTS-style "KINDS" label row with + button (super-admin only)]
//   [All (pseudo, no menu)]
//   [SortableKindRow * N — drag handle | icon | label | 3-dot menu]

import { useEffect, useRef, useState } from "react";
import { GripVertical, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
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
import { VaultBrandIcon } from "./VaultBrandIcon";
import type { VaultBuiltinKindId, VaultKindDef } from "./types";

export type VaultKindSelection = string | "all";

// Width tokens consumed by the ResizableColumn wrapper at the call
// site (VaultPage). The rail itself fills the wrapper height/width.
export const VAULT_KIND_RAIL_DEFAULT_WIDTH = 176; // matches the old w-44
export const VAULT_KIND_RAIL_MIN_WIDTH = 140;
export const VAULT_KIND_RAIL_MAX_WIDTH = 320;
export const VAULT_KIND_RAIL_PERSIST_KEY = "penguin-vault-kind-rail-width";

interface VaultKindRailProps {
  kinds: VaultKindDef[];
  // kindId → group count (HEAD-kind). Drives badges + the
  // "show only kinds with credentials" filter.
  counts: Partial<Record<string, number>>;
  // Total group count across all kinds.
  allCount: number;
  selectedKind: VaultKindSelection;
  onSelectKind: (kind: VaultKindSelection) => void;
  // CRUD — undefined when the caller doesn't authorize the action
  // (e.g. non-super-admin viewer). The UI hides the corresponding
  // affordance when the handler is missing.
  onAddKind?: (label: string) => void;
  onRenameKind?: (id: string, label: string) => void;
  onDeleteKind?: (id: string) => void;
  onReorderKinds?: (orderedIds: string[]) => void;
}

export function VaultKindRail({
  kinds,
  counts,
  allCount,
  selectedKind,
  onSelectKind,
  onAddKind,
  onRenameKind,
  onDeleteKind,
  onReorderKinds,
}: VaultKindRailProps) {
  // Hide rows whose kind has 0 credentials AND was not created by the
  // user (i.e. it's a built-in default). User-created kinds with 0
  // credentials stay visible so the user can see what they just
  // created. Detection: user-created ids are nanoid-like; built-ins
  // match BUILTIN_KIND_IDS values exactly. Simpler heuristic: hide if
  // count is 0 AND baseKind is set (i.e. it's a built-in).
  // Actually for now show every kind in the list to match user
  // intent ("一模一样" — Projects shows every project including empty
  // ones). User can delete unused kinds via the 3-dot menu.
  const visibleKinds = kinds;

  const [addingNew, setAddingNew] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Close the open 3-dot menu on any outside click. Matches
  // VaultSidebar's ProjectMenu behavior.
  useEffect(() => {
    if (openMenuId === null) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openMenuId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = visibleKinds.map((k) => k.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    onReorderKinds?.(next);
  };

  const canReorder = onReorderKinds !== undefined;
  const showMenu = onRenameKind !== undefined || onDeleteKind !== undefined;

  return (
    // Right border (border-r) dropped per user direction ("我是说直
    // 的线拿掉，不是横的线") — the vertical divider between the kind
    // rail and the main panel was visually noisy; the column's
    // background + the main panel's content already imply the
    // boundary.
    <aside className="flex h-full w-full flex-col bg-card">
      {/* Same flex shell + paddings as VaultSidebar's header so the
          height + horizontal rhythm line up. Horizontal divider
          (border-b) restored — it's the one that gives the column
          its top-section structure. Text removed per earlier
          direction ("拿掉字"). */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <div className="h-8 w-8 shrink-0" aria-hidden="true" />
      </div>

      {/* Section label row — empty label per user direction, only the
          + button stays. mt-4 + px-4 + h-5 button preserved so the
          position matches VaultSidebar's PROJECTS row. */}
      <div className="mt-4 flex items-center justify-end px-4">
        {onAddKind !== undefined ? (
          <button
            type="button"
            onClick={() => {
              setAddingNew(true);
              setOpenMenuId(null);
            }}
            className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            aria-label="Add kind"
            title="Add kind"
          >
            <Plus className="h-3 w-3" />
          </button>
        ) : null}
      </div>

      <div className="flex-1 overflow-y-auto px-3 pt-1">
        {/* "All" pseudo-row — always at the top, non-draggable, no
            menu. Selecting it shows credentials across every kind. */}
        <AllRow
          isActive={selectedKind === "all"}
          count={allCount}
          onClick={() => onSelectKind("all")}
        />

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={visibleKinds.map((k) => k.id)}
            strategy={verticalListSortingStrategy}
          >
            {visibleKinds.map((kind) => (
              <SortableKindRow
                key={kind.id}
                kind={kind}
                isActive={selectedKind === kind.id}
                count={counts[kind.id] ?? 0}
                canReorder={canReorder}
                showMenu={showMenu}
                isMenuOpen={openMenuId === kind.id}
                isRenaming={renamingId === kind.id}
                onSelectKind={onSelectKind}
                onMenuToggle={() =>
                  setOpenMenuId((prev) => (prev === kind.id ? null : kind.id))
                }
                onStartRename={() => {
                  setRenamingId(kind.id);
                  setOpenMenuId(null);
                }}
                onCancelRename={() => setRenamingId(null)}
                onCommitRename={(label) => {
                  setRenamingId(null);
                  const trimmed = label.trim();
                  if (trimmed && trimmed !== kind.label) {
                    onRenameKind?.(kind.id, trimmed);
                  }
                }}
                onDelete={
                  onDeleteKind !== undefined
                    ? () => {
                        setOpenMenuId(null);
                        onDeleteKind(kind.id);
                      }
                    : undefined
                }
                menuRef={menuRef}
              />
            ))}
          </SortableContext>
        </DndContext>

        {/* Inline "add new kind" row — appears at the bottom when the
            user clicks +. Esc cancels; Enter commits. */}
        {addingNew ? (
          <InlineEditRow
            placeholder="New kind label"
            onCommit={(label) => {
              const trimmed = label.trim();
              setAddingNew(false);
              if (trimmed && onAddKind !== undefined) onAddKind(trimmed);
            }}
            onCancel={() => setAddingNew(false)}
          />
        ) : null}
      </div>
    </aside>
  );
}

function AllRow({
  isActive,
  count,
  onClick,
}: {
  isActive: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <div className="mb-1">
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-2 py-1.5",
          isActive ? "bg-primary/10" : "hover:bg-muted/40",
        )}
      >
        {/* Spacer where the drag handle lives on real rows — keeps
            the icon column aligned with the rows below. */}
        <span className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span
          className="h-3.5 w-3.5 shrink-0 rounded-full border border-muted-foreground/40"
          aria-hidden="true"
        />
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "flex-1 truncate text-left text-xs",
            isActive ? "font-semibold text-foreground" : "text-foreground/80 hover:text-foreground",
          )}
        >
          All
        </button>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] tabular-nums",
            isActive
              ? "bg-primary/15 text-primary"
              : "bg-muted/40 text-muted-foreground",
          )}
        >
          {count}
        </span>
      </div>
    </div>
  );
}

interface SortableKindRowProps {
  kind: VaultKindDef;
  isActive: boolean;
  count: number;
  canReorder: boolean;
  showMenu: boolean;
  isMenuOpen: boolean;
  isRenaming: boolean;
  onSelectKind: (kind: VaultKindSelection) => void;
  onMenuToggle: () => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onCommitRename: (label: string) => void;
  onDelete?: () => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
}

function SortableKindRow(props: SortableKindRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: props.kind.id, disabled: !props.canReorder });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="mb-1">
      <div
        className={cn(
          "group flex items-center gap-1 rounded-md px-2 py-1.5",
          props.isActive ? "bg-primary/10" : "hover:bg-muted/40",
        )}
      >
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
          <span className="h-5 w-5 shrink-0" aria-hidden="true" />
        )}
        <KindIcon kind={props.kind} isActive={props.isActive} />
        {props.isRenaming ? (
          <InlineEditRow
            initialValue={props.kind.label}
            placeholder="Kind label"
            onCommit={props.onCommitRename}
            onCancel={props.onCancelRename}
            inline
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => props.onSelectKind(props.kind.id)}
              className={cn(
                "flex-1 truncate text-left text-xs",
                props.isActive
                  ? "font-semibold text-foreground"
                  : "text-foreground/80 hover:text-foreground",
              )}
            >
              {props.kind.label}
            </button>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] tabular-nums",
                props.isActive
                  ? "bg-primary/15 text-primary"
                  : "bg-muted/40 text-muted-foreground",
              )}
            >
              {props.count}
            </span>
            {props.showMenu ? (
              <KindMenu
                isOpen={props.isMenuOpen}
                onToggle={props.onMenuToggle}
                onRename={props.onStartRename}
                onDelete={props.onDelete}
                menuRef={props.menuRef}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function KindIcon({ kind, isActive }: { kind: VaultKindDef; isActive: boolean }) {
  // Use the kind's optional baseKind for the brand SVG; user-created
  // kinds without a baseKind fall through to the generic padlock.
  const iconId: VaultBuiltinKindId = kind.baseKind ?? "generic";
  return (
    <VaultBrandIcon
      kind={iconId}
      className={cn(
        "h-3.5 w-3.5 shrink-0",
        isActive ? "text-primary" : "text-muted-foreground",
      )}
    />
  );
}

interface KindMenuProps {
  isOpen: boolean;
  onToggle: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  menuRef: React.RefObject<HTMLDivElement | null>;
}

function KindMenu(props: KindMenuProps) {
  return (
    <div className="relative" ref={props.isOpen ? props.menuRef : undefined}>
      <button
        type="button"
        onClick={props.onToggle}
        className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        aria-label="Kind menu"
        title="Kind menu"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {props.isOpen ? (
        <div className="absolute right-0 top-6 z-30 w-40 rounded-md border border-border bg-popover py-1 shadow-lg">
          {props.onRename !== undefined ? (
            <button
              type="button"
              onClick={props.onRename}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted/50"
            >
              <Pencil className="h-3.5 w-3.5" />
              Rename kind
            </button>
          ) : null}
          {props.onDelete !== undefined ? (
            <button
              type="button"
              onClick={props.onDelete}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete kind
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Tiny inline edit row — Enter commits, Esc cancels, auto-focus on
// mount. Used for both "+ add" (initialValue empty) and "rename"
// (initialValue = current label) flows.
function InlineEditRow({
  initialValue = "",
  placeholder,
  onCommit,
  onCancel,
  inline = false,
}: {
  initialValue?: string;
  placeholder: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  // When inline=true, render only the input + skip the wrapper
  // padding/icons so the row stays compact inside a SortableKindRow.
  inline?: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const input = (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => onCommit(value)}
      placeholder={placeholder}
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      className="h-6 flex-1 rounded border border-border bg-background px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/40"
    />
  );
  if (inline) return input;
  return (
    <div className="mb-1 flex items-center gap-1 rounded-md px-2 py-1.5">
      <span className="h-5 w-5 shrink-0" aria-hidden="true" />
      <span
        className="h-3.5 w-3.5 shrink-0 rounded-sm border border-dashed border-muted-foreground/40"
        aria-hidden="true"
      />
      {input}
    </div>
  );
}
