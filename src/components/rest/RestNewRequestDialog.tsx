// Sprint 10 Phase 10A.9 — "New Request" dialog for the REST module.
//
// Triggered by ⌘N / ⌘T or the workspace header "+ New" button when REST
// module is active. Per user feedback ("Method 快速选择面板"):
//   - 7-button method grid (GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS)
//   - Clicking a method immediately creates the request + opens it in a tab
//   - Above the grid: collection picker with inline "+ New collection..." entry
//   - No name/URL fields here — user fills those in the tab editor afterwards
//
// Edge cases:
//   - No project selected: body shows "create a project first" hint; methods
//     disabled. Sidebar owns project creation.
//   - Project selected, no collections: picker auto-jumps to inline create.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RestCollection, RestMethod } from "./rest-types";

interface MethodSpec {
  value: RestMethod;
  colorClass: string;
}

// Standard HTTP verbs Postman exposes by default. Ordered to match user mock.
const METHODS: MethodSpec[] = [
  { value: "GET", colorClass: "text-emerald-600 dark:text-emerald-400" },
  { value: "POST", colorClass: "text-amber-600 dark:text-amber-400" },
  { value: "PUT", colorClass: "text-blue-600 dark:text-blue-400" },
  { value: "PATCH", colorClass: "text-violet-600 dark:text-violet-400" },
  { value: "DELETE", colorClass: "text-red-600 dark:text-red-400" },
  { value: "HEAD", colorClass: "text-cyan-600 dark:text-cyan-400" },
  { value: "OPTIONS", colorClass: "text-slate-600 dark:text-slate-400" },
];

export interface RestNewRequestDialogProps {
  open: boolean;
  onClose: () => void;
  // Collections visible under the current project + env scope (RestPage filters
  // these before passing). Empty array is legal — dialog drops into inline-create.
  collections: RestCollection[];
  // Sidebar's currently-selected collection, if any. Pre-selects the picker
  // so most ⌘N flows are one click.
  defaultCollectionId: string | null;
  // True when the user has a project selected. When false, the dialog shows
  // an inline project-create form — user no longer has to leave for the
  // sidebar to bootstrap their workspace.
  hasProject: boolean;
  // Picks a method → RestPage creates the record + opens the tab + closes us.
  onCreate: (params: { method: RestMethod; collectionId: string }) => void;
  // Returns the newly-created collection's id so we can auto-select it.
  onCreateCollection: (name: string) => string;
  // Inline project creation: RestPage creates the project + sets it active.
  // The dialog stays open and cascades into collection-create (since the
  // brand-new project has zero collections).
  onCreateProject: (name: string) => void;
}

const CREATE_SENTINEL = "__create__";

export function RestNewRequestDialog(props: RestNewRequestDialogProps) {
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [creatingCollection, setCreatingCollection] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  // Inline project-create input (only used when !hasProject).
  const [newProjectName, setNewProjectName] = useState("");

  // Reset / preselect on every open. Auto-jump into inline-create when there
  // are zero collections under the current scope. Also re-fires when hasProject
  // flips false→true (user just created a project inline) — collections will
  // still be empty so this drops us straight into collection-create mode.
  useEffect(() => {
    if (!props.open) return;
    setNewCollectionName("");
    setNewProjectName("");
    if (props.collections.length === 0) {
      setCollectionId(null);
      setCreatingCollection(props.hasProject);
    } else {
      const fallback = props.defaultCollectionId ?? props.collections[0].id;
      setCollectionId(fallback);
      setCreatingCollection(false);
    }
  }, [props.open, props.defaultCollectionId, props.collections, props.hasProject]);

  // Local Esc — does not propagate to the page-level Esc (which would close the
  // whole REST module).
  useEffect(() => {
    if (!props.open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        props.onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [props.open, props.onClose]);

  if (!props.open) return null;

  const commitCollection = () => {
    const name = newCollectionName.trim();
    if (!name) return;
    const id = props.onCreateCollection(name);
    setCollectionId(id);
    setCreatingCollection(false);
    setNewCollectionName("");
  };

  const commitProject = () => {
    const name = newProjectName.trim();
    if (!name) return;
    // RestPage flips selectedProjectId. Our open-effect re-fires on hasProject
    // change and lands us in collection-create mode automatically.
    props.onCreateProject(name);
    setNewProjectName("");
  };

  const pickMethod = (m: RestMethod) => {
    if (!collectionId) return;
    props.onCreate({ method: m, collectionId });
  };

  const methodsEnabled = props.hasProject && !!collectionId;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={props.onClose}
      />
      <div
        role="dialog"
        aria-labelledby="rest-new-request-title"
        className="relative z-50 w-full max-w-md rounded-lg border border-border bg-popover shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="rest-new-request-title" className="text-sm font-semibold">
            New Request
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!props.hasProject ? (
          // Step 1 of the inline-bootstrap cascade: no project → ask for one
          // right here. Once committed, hasProject flips true and the open-
          // effect drops us into collection-create.
          <div className="space-y-3 p-4">
            <p className="text-xs text-muted-foreground">
              You don&apos;t have any projects yet. Create one to start.
            </p>
            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Project name
              </label>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitProject();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      props.onClose();
                    }
                  }}
                  placeholder="e.g. Brazil API"
                  className="h-8 flex-1 text-xs"
                />
                <Button
                  size="sm"
                  onClick={commitProject}
                  disabled={!newProjectName.trim()}
                  className="h-8 text-xs"
                >
                  Create
                </Button>
              </div>
              <p className="pt-1 text-[10px] text-muted-foreground">
                You&apos;ll pick a method right after.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-4">
            {/* Collection picker — native select for simplicity, inline-create for empty / + New */}
            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Save to
              </label>
              {creatingCollection ? (
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    value={newCollectionName}
                    onChange={(e) => setNewCollectionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitCollection();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        if (props.collections.length > 0) {
                          setCreatingCollection(false);
                          setCollectionId(props.collections[0].id);
                        } else {
                          props.onClose();
                        }
                      }
                    }}
                    placeholder="New collection name"
                    className="h-8 flex-1 text-xs"
                  />
                  <Button
                    size="sm"
                    onClick={commitCollection}
                    disabled={!newCollectionName.trim()}
                    className="h-8 text-xs"
                  >
                    Create
                  </Button>
                </div>
              ) : (
                <select
                  value={collectionId ?? ""}
                  onChange={(e) => {
                    if (e.target.value === CREATE_SENTINEL) {
                      setCreatingCollection(true);
                      return;
                    }
                    setCollectionId(e.target.value || null);
                  }}
                  className="h-8 w-full rounded border border-input bg-background px-2 text-xs"
                >
                  {props.collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value={CREATE_SENTINEL}>+ New collection...</option>
                </select>
              )}
            </div>

            {/* Method grid — click to create */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Click a method to create the tab
              </label>
              <div className="grid grid-cols-3 gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => pickMethod(m.value)}
                    disabled={!methodsEnabled}
                    className={cn(
                      "rounded border border-border bg-background px-3 py-2 text-center font-mono text-xs font-semibold transition-colors",
                      m.colorClass,
                      !methodsEnabled && "cursor-not-allowed opacity-40",
                      methodsEnabled &&
                        "hover:border-primary hover:bg-accent",
                    )}
                  >
                    {m.value}
                  </button>
                ))}
              </div>
              {!methodsEnabled && props.hasProject && (
                <p className="pt-1 text-[10px] text-muted-foreground">
                  Pick or create a collection above first.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={props.onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
