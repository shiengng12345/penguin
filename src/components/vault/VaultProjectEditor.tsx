// Add / Edit project modal. Lets the user pick a project name AND fully
// customize the env list (id, display name, color). In Add mode the form
// seeds with QAT / UAT / PROD; in Edit mode it pre-populates from the
// existing project. Saving an Edit replaces the project's name + env list
// while preserving credentials.

import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logger } from "@/lib/logger";
import { requireSuperAdmin } from "@/lib/dev-mode-store";
import { useDeveloperMode } from "@/hooks/useDeveloperMode";
import { cn } from "@/lib/utils";
import { slugify, uniqueSlug } from "./vault-id-slug";
import type { VaultEnv, VaultProject } from "./types";

const LOG_SCOPE = "VaultProjectEditor";

export type ProjectEditorMode = "add" | "edit";

export interface VaultProjectEditorProps {
  open: boolean;
  mode: ProjectEditorMode;
  initialProject: VaultProject | null;
  existingProjectIds: readonly string[];
  onCancel: () => void;
  onSave: (project: VaultProject) => void;
}

interface ColorChoice {
  id: string;
  label: string;
  className: string;
}

const COLOR_CHOICES: readonly ColorChoice[] = [
  { id: "emerald", label: "Emerald", className: "bg-emerald-500" },
  { id: "amber", label: "Amber", className: "bg-amber-500" },
  { id: "sky", label: "Sky", className: "bg-sky-500" },
  { id: "rose", label: "Rose", className: "bg-rose-500" },
  { id: "violet", label: "Violet", className: "bg-violet-500" },
  { id: "cyan", label: "Cyan", className: "bg-cyan-500" },
  { id: "orange", label: "Orange", className: "bg-orange-500" },
  { id: "pink", label: "Pink", className: "bg-pink-500" },
  { id: "lime", label: "Lime", className: "bg-lime-500" },
  { id: "indigo", label: "Indigo", className: "bg-indigo-500" },
];

const DEFAULT_ADD_ENVS: VaultEnv[] = [
  { id: "QAT", name: "QAT", color: "bg-amber-500" },
  { id: "UAT", name: "UAT", color: "bg-sky-500" },
  { id: "PROD", name: "PROD", color: "bg-rose-500" },
];

// Stable React key for an env row that survives id renames mid-edit.
interface EnvRow {
  rowKey: string;
  id: string;
  name: string;
  color: string;
}

function rowsFromEnvs(envs: VaultEnv[]): EnvRow[] {
  return envs.map((env, index) => ({
    rowKey: `${env.id}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    id: env.id,
    name: env.name,
    color: env.color,
  }));
}

function deriveIdFromName(rawName: string): string {
  const cleaned = rawName.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "_");
  // Empty falls back to a generic placeholder so blank rows still have a key.
  if (cleaned.length === 0) return "ENV";
  return cleaned;
}

export function VaultProjectEditor(props: VaultProjectEditorProps) {
  const isEdit = props.mode === "edit";
  const seedProject = props.initialProject;
  const [name, setName] = useState<string>(seedProject?.name ?? "");
  const [envRows, setEnvRows] = useState<EnvRow[]>(() =>
    isEdit && seedProject !== null
      ? rowsFromEnvs(seedProject.environments)
      : rowsFromEnvs(DEFAULT_ADD_ENVS),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Drag-to-reorder is super-admin only — normal admins (token-tier) can
  // edit a project's name + add/remove envs but can't change row order.
  // Token-tier users don't even see the drag handle.
  const { isSuperAdmin } = useDeveloperMode();
  const canReorder = isSuperAdmin;
  // Index of the row currently being dragged. null when no drag in flight.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // Index the user is hovering over while dragging — drives the insertion
  // indicator. Resets on drop / dragend / mouse leaving the list.
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Map from row index → row element. Used to bbox-hit-test the cursor
  // during drag. Refs are sync — DOM lookup at the moment of the event.
  const rowElsRef = useRef<Map<number, HTMLDivElement>>(new Map());

  const registerRow = useCallback((index: number, el: HTMLDivElement | null): void => {
    if (el === null) {
      rowElsRef.current.delete(index);
    } else {
      rowElsRef.current.set(index, el);
    }
  }, []);

  // Pointer-event implementation — bypasses HTML5 DnD entirely. HTML5 DnD
  // is fragile inside the Tauri webview when row children include focusable
  // <input>/<select> elements: the inputs swallow the drop event before
  // our handler runs, even in capture phase. Pointer events go to whoever
  // we attach them to (window), so no child interference.
  const handlePointerDown = (index: number) => (e: React.PointerEvent): void => {
    if (!canReorder) return;
    e.preventDefault();
    setDragIndex(index);
    setDragOverIndex(index);

    // Find which row the cursor is currently over via bounding-box hit-test.
    const findIndexAt = (clientY: number): number | null => {
      for (const [idx, el] of rowElsRef.current.entries()) {
        const rect = el.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) return idx;
      }
      return null;
    };

    const handleMove = (ev: PointerEvent): void => {
      const targetIdx = findIndexAt(ev.clientY);
      if (targetIdx !== null) setDragOverIndex(targetIdx);
    };

    const handleUp = (ev: PointerEvent): void => {
      const targetIdx = findIndexAt(ev.clientY) ?? index;
      if (targetIdx !== index) {
        setEnvRows((prev) => {
          const next = prev.slice();
          const [moved] = next.splice(index, 1);
          next.splice(targetIdx, 0, moved);
          return next;
        });
      }
      setDragIndex(null);
      setDragOverIndex(null);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  };

  // The modal stays mounted in the tree (just toggled via `open`), so the
  // useState initializers only run once. Reset on open transitions + when
  // the project being edited changes — otherwise Edit reuses the stale Add-
  // mode seed and the user sees an empty form.
  useEffect(() => {
    const closed = !props.open;
    if (closed) return;
    if (isEdit && seedProject !== null) {
      setName(seedProject.name);
      setEnvRows(rowsFromEnvs(seedProject.environments));
    } else {
      setName("");
      setEnvRows(rowsFromEnvs(DEFAULT_ADD_ENVS));
    }
    setErrorMessage(null);
  }, [props.open, isEdit, seedProject]);

  const handleAddRow = (): void => {
    const nextColor = COLOR_CHOICES[envRows.length % COLOR_CHOICES.length];
    setEnvRows((prev) => [
      ...prev,
      {
        rowKey: `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        id: "",
        name: "",
        color: nextColor.className,
      },
    ]);
  };

  const handleRemoveRow = (rowKey: string): void => {
    setEnvRows((prev) => prev.filter((row) => row.rowKey !== rowKey));
  };

  const handleEditRow = (rowKey: string, patch: Partial<EnvRow>): void => {
    setEnvRows((prev) =>
      prev.map((row) => {
        const isTarget = row.rowKey === rowKey;
        if (!isTarget) return row;
        const next = { ...row, ...patch };
        // Auto-derive id from name as the user types — they can override the
        // id manually afterwards if needed.
        const nameChanged = typeof patch.name === "string";
        const idUntouched = patch.id === undefined;
        if (nameChanged && idUntouched) next.id = deriveIdFromName(patch.name!);
        return next;
      }),
    );
  };

  const handleSave = useCallback((): void => {
    logger.info(LOG_SCOPE, "handleSave — entry", { mode: props.mode });
    const isAuthorized = requireSuperAdmin();
    const notAuthorized = !isAuthorized;
    if (notAuthorized) {
      logger.warn(LOG_SCOPE, "handleSave — not authorized");
      setErrorMessage("Not authorized.");
      return;
    }
    const trimmedName = name.trim();
    const isNameEmpty = trimmedName.length === 0;
    if (isNameEmpty) {
      setErrorMessage("Project name is required.");
      return;
    }
    // Project must ship with at least one env — otherwise credentials cannot
    // store any values.
    const hasNoEnvs = envRows.length === 0;
    if (hasNoEnvs) {
      setErrorMessage("Add at least one environment.");
      return;
    }
    // Validate each row: name non-empty, id non-empty + unique within project.
    const seenIds = new Set<string>();
    const cleanedEnvs: VaultEnv[] = [];
    for (let index = 0; index < envRows.length; index += 1) {
      const row = envRows[index];
      const rowName = row.name.trim();
      const rowId = row.id.trim();
      const rowMissing = rowName.length === 0 || rowId.length === 0;
      if (rowMissing) {
        setErrorMessage(`Environment ${index + 1} needs both id and name.`);
        return;
      }
      const isDuplicate = seenIds.has(rowId);
      if (isDuplicate) {
        setErrorMessage(`Environment id "${rowId}" is duplicated.`);
        return;
      }
      seenIds.add(rowId);
      cleanedEnvs.push({ id: rowId, name: rowName, color: row.color });
    }

    const projectId = isEdit && seedProject !== null
      ? seedProject.id
      : uniqueSlug({ base: slugify({ name: trimmedName }), existingIds: props.existingProjectIds });
    const next: VaultProject = {
      id: projectId,
      name: trimmedName,
      environments: cleanedEnvs,
      credentials: seedProject?.credentials ?? [],
    };
    setErrorMessage(null);
    props.onSave(next);
    logger.info(LOG_SCOPE, "handleSave — exit", { projectId, envCount: cleanedEnvs.length });
  }, [envRows, isEdit, name, props, seedProject]);

  const handleCancel = useCallback((): void => {
    setName("");
    setEnvRows(rowsFromEnvs(DEFAULT_ADD_ENVS));
    setErrorMessage(null);
    props.onCancel();
  }, [props]);

  const isOpen = props.open;
  // Modal hidden — short-circuit before rendering DOM.
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={handleCancel} />
      <div
        className="relative z-50 w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground">
          {isEdit ? "Edit project" : "Add project"}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {isEdit
            ? "Credentials are preserved. Removed envs leave behind dead values."
            : "Pick a name, then customize the environment list (you can rename / add / remove later)."}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Newport"
              className="mt-1"
              autoFocus
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Environments</span>
              <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={handleAddRow}>
                <Plus className="h-3.5 w-3.5" />
                Add environment
              </Button>
            </div>
            <div className="mt-2 space-y-2">
              {envRows.map((row, index) => (
                <div
                  key={row.rowKey}
                  ref={(el) => registerRow(index, el)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border bg-muted/10 p-2 transition-colors",
                    dragIndex === index && "opacity-40",
                    dragOverIndex === index && dragIndex !== null && dragIndex !== index
                      ? "border-primary"
                      : "border-border",
                  )}
                >
                  {canReorder && (
                    <span
                      onPointerDown={handlePointerDown(index)}
                      className="flex shrink-0 touch-none select-none items-center justify-center text-muted-foreground/60 hover:text-foreground"
                      style={{ cursor: dragIndex === index ? "grabbing" : "grab" }}
                      title="Drag to reorder"
                      aria-label="Reorder environment"
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <span className={cn("inline-flex h-3 w-3 shrink-0 rounded-full", row.color)} />
                  <Input
                    value={row.name}
                    onChange={(e) => handleEditRow(row.rowKey, { name: e.target.value })}
                    placeholder="Display name"
                    className="h-8 flex-1"
                    autoComplete="off"
                  />
                  <Input
                    value={row.id}
                    onChange={(e) => handleEditRow(row.rowKey, { id: e.target.value.toUpperCase() })}
                    placeholder="ID"
                    className="h-8 w-20 font-mono text-[11px]"
                    autoComplete="off"
                  />
                  <select
                    value={row.color}
                    onChange={(e) => handleEditRow(row.rowKey, { color: e.target.value })}
                    className="h-8 w-24 rounded-md border border-input bg-card px-2 text-xs"
                  >
                    {COLOR_CHOICES.map((choice) => (
                      <option key={choice.id} value={choice.className}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleRemoveRow(row.rowKey)}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    aria-label={`Remove environment ${index + 1}`}
                    title="Remove environment"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {envRows.length === 0 ? (
                <p className="text-[10px] text-muted-foreground/70">
                  Click "Add environment" to create at least one.
                </p>
              ) : null}
            </div>
          </div>

          {errorMessage !== null && (
            <p className="text-xs text-destructive">{errorMessage}</p>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            {isEdit ? "Save changes" : "Add project"}
          </Button>
        </div>
      </div>
    </div>
  );
}
