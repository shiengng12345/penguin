// Add / Edit credential modal — REDESIGNED.
//
// Add mode: user first picks a TEMPLATE (Vault Server / Service with Auth /
// Link / Database / Cache / Custom). The template decides which named fields
// the form shows (URL, Token, Username, Password, Host, etc.). Saving an
// N-field template creates N credentials in one shot, auto-pairing them via
// `pairedWith` so the rendered card collapses to a single multi-field tile.
//
// Edit mode: skips the template picker entirely — user edits one credential
// at a time. id + isSensitive are locked.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck,
  LogIn,
  Link2,
  Database,
  Zap,
  Settings,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logger } from "@/lib/logger";
import { requireSuperAdmin } from "@/lib/dev-mode-store";
import { cn } from "@/lib/utils";
import type {
  VaultCredential,
  VaultCredentialKind,
  VaultEnv,
  VaultEnvId,
} from "./types";
import { slugify, uniqueSlug } from "./vault-id-slug";

const LOG_SCOPE = "VaultCredentialEditor";

const KIND_OPTIONS: readonly VaultCredentialKind[] = [
  "link",
  "token",
  "database",
  "cache",
  "generic",
  "vault",
  "argocd",
  "monitoring",
  "web",
  "api",
  "login",
];

export type CredentialEditorMode = "add" | "edit";

export interface VaultCredentialEditorProps {
  open: boolean;
  mode: CredentialEditorMode;
  initialCredential: VaultCredential | null;
  environments: VaultEnv[];
  // Sprint 4 — ids scoped to the project (no more categories). Editor passes
  // these to the slug helper for collision detection.
  existingIdsInProject: readonly string[];
  // Sibling credentials in the same project — populate the "Paired with"
  // dropdown in the Custom template.
  siblingCredentials: readonly VaultCredential[];
  onCancel: () => void;
  // Add can emit multiple credentials at once (e.g. URL + Token for a Vault
  // template); Edit always emits a single credential.
  onSave: (credentials: VaultCredential[]) => void;
  // Sprint 5 — rail kind pre-fill. When a kind row is selected on
  // VaultKindRail and the user clicks "Add credential", the parent
  // resolves the matching template id + the seed kind via
  // resolveTemplateIdForKind() and passes them here. Editor opens
  // directly on that template's form, skipping the picker grid. For
  // kinds without a multi-field template (token, argocd, custom user
  // kinds, etc.) the resolver returns templateId="custom" + seedKind
  // = the hinted kind, so the user lands on a SingleCredentialForm
  // with the kind dropdown pre-set and locked.
  initialTemplateId?: string;
  seedKind?: VaultCredentialKind;
  // Optional display label for the seed kind — used when seedKind is
  // a user-created kind id NOT present in KIND_OPTIONS so the form
  // can render a read-only "Kind: <label>" row instead of an empty
  // <select>. Looked up from project.kinds[].label by the parent.
  seedKindLabel?: string;
}

// kind → TEMPLATES.id mapping. Built-in kinds that have a multi-field
// template (URL + token, etc.) map directly; everything else lands on
// the "custom" single-field form with the kind pre-seeded. Exported so
// VaultPage can resolve at mount time instead of duplicating the logic.
const KIND_TO_TEMPLATE_ID: Record<string, string> = {
  vault: "vault-server",
  argocd: "argocd-server",
  login: "service-auth",
  database: "database",
  cache: "cache",
  link: "link",
  totp: "totp-authenticator",
};

export interface ResolveTemplateResult {
  templateId: string;
  // Only set when the resolver falls through to "custom" — tells the
  // editor which kind to seed + lock on the SingleCredentialForm.
  seedKind?: string;
}

export function resolveTemplateIdForKind(
  kindHint: string | undefined,
): ResolveTemplateResult | undefined {
  if (kindHint === undefined || kindHint === "all") return undefined;
  const direct = KIND_TO_TEMPLATE_ID[kindHint];
  if (direct !== undefined) {
    // Built-in kind with a dedicated multi-field template — no need
    // to seed the kind, the template's fields already carry it.
    return { templateId: direct };
  }
  // Fall through — token, argocd, monitoring, web, api, generic, or
  // any user-created kind id. Single-field custom form, kind locked.
  return { templateId: "custom", seedKind: kindHint };
}

interface TemplateFieldSpec {
  // Stable suffix appended to the credential id slug — e.g. base "my-vault"
  // becomes "my-vault" (primary) + "my-vault-token" (secondary).
  idSuffix: string;
  label: string;
  kind: VaultCredentialKind;
  // When true the per-env Input uses type=password and the saved credential
  // gets `isSensitive: true`.
  sensitive: boolean;
  // Field-level placeholder shown in each per-env input row.
  placeholder: string;
}

interface TemplateSpec {
  id: string;
  title: string;
  description: string;
  icon: typeof ShieldCheck;
  // The PRIMARY field reuses the credential's name verbatim. SECONDARY+
  // fields use `${name} ${labelSuffix}` so a "Production Vault" Vault Server
  // produces "Production Vault" + "Production Vault Token".
  fields: TemplateFieldSpec[];
}

const TEMPLATES: TemplateSpec[] = [
  {
    id: "vault-server",
    title: "Vault Server",
    description: "HashiCorp Vault URL + Token in one card.",
    icon: ShieldCheck,
    fields: [
      { idSuffix: "", label: "URL", kind: "vault", sensitive: false, placeholder: "https://vault.internal/" },
      { idSuffix: "-token", label: "Token", kind: "token", sensitive: true, placeholder: "hvs.xxx…" },
    ],
  },
  {
    id: "service-auth",
    title: "Service with Login",
    description: "Login URL + Username + Password — for admin panels, dashboards.",
    icon: LogIn,
    fields: [
      { idSuffix: "", label: "URL", kind: "login", sensitive: false, placeholder: "https://app.internal/login" },
      { idSuffix: "-username", label: "Username", kind: "generic", sensitive: false, placeholder: "admin" },
      { idSuffix: "-password", label: "Password", kind: "token", sensitive: true, placeholder: "••••" },
    ],
  },
  {
    id: "argocd-server",
    title: "ArgoCD Server",
    description: "ArgoCD URL + Username + Password. Browser module auto-fills sign-in.",
    icon: LogIn,
    fields: [
      { idSuffix: "", label: "URL", kind: "argocd", sensitive: false, placeholder: "https://argocd.internal/" },
      { idSuffix: "-username", label: "Username", kind: "generic", sensitive: false, placeholder: "admin" },
      { idSuffix: "-password", label: "Password", kind: "token", sensitive: true, placeholder: "••••" },
    ],
  },
  {
    id: "database",
    title: "Database (URI + Password)",
    description: "Connection URI + separate password — for Postgres, MongoDB, etc.",
    icon: Database,
    fields: [
      { idSuffix: "", label: "URI", kind: "database", sensitive: false, placeholder: "postgresql://host:5432/db" },
      { idSuffix: "-password", label: "Password", kind: "token", sensitive: true, placeholder: "••••" },
    ],
  },
  {
    id: "cache",
    title: "Cache (Host + Password)",
    description: "Redis / Memcached host + password.",
    icon: Zap,
    fields: [
      { idSuffix: "", label: "Host", kind: "cache", sensitive: false, placeholder: "redis://host:6379" },
      { idSuffix: "-password", label: "Password", kind: "token", sensitive: true, placeholder: "(empty if none)" },
    ],
  },
  {
    id: "totp-authenticator",
    title: "Authenticator (TOTP)",
    description: "Account label + base32 secret. Codes appear in the Browser module's KeyRound popover.",
    icon: KeyRound,
    fields: [
      { idSuffix: "", label: "Account", kind: "totp", sensitive: false, placeholder: "shieng@snsoft.my" },
      { idSuffix: "-secret", label: "Secret", kind: "token", sensitive: true, placeholder: "JBSWY3DPEHPK3PXP (base32)" },
    ],
  },
  {
    id: "link",
    title: "Link only",
    description: "Single URL — no credentials attached.",
    icon: Link2,
    fields: [
      { idSuffix: "", label: "URL", kind: "link", sensitive: false, placeholder: "https://service.example.com" },
    ],
  },
  {
    id: "custom",
    title: "Custom",
    description: "Pick kind + sensitivity manually. Use this when no template fits.",
    icon: Settings,
    fields: [],
  },
];

function emptyValueByEnv(envs: VaultEnv[]): Record<VaultEnvId, string> {
  const seed: Partial<Record<VaultEnvId, string>> = {};
  for (const env of envs) seed[env.id] = "";
  return seed as Record<VaultEnvId, string>;
}

export function VaultCredentialEditor(props: VaultCredentialEditorProps) {
  const isEdit = props.mode === "edit";

  // Template picker — only relevant in Add mode. Edit jumps straight to the
  // single-credential form pre-filled with the existing credential.
  // Sprint 5 — seed with initialTemplateId when provided so the rail
  // kind filter can skip the picker step.
  const [pickedTemplateId, setPickedTemplateId] = useState<string | null>(
    props.initialTemplateId ?? null,
  );

  // Reset the template selection every time the modal reopens in Add mode.
  // When the parent supplies initialTemplateId (rail kind pre-fill), we
  // honor it instead of resetting to null — otherwise the modal would
  // flash the picker grid for one frame before settling on the hinted
  // template. Edit-mode and close keep the null reset semantics.
  useEffect(() => {
    const closed = !props.open;
    // Modal closed — clear so next open starts at the picker again.
    if (closed) {
      setPickedTemplateId(null);
      return;
    }
    const isAddMode = props.mode === "add";
    if (isAddMode) setPickedTemplateId(props.initialTemplateId ?? null);
  }, [props.open, props.mode, props.initialTemplateId]);

  const pickedTemplate = useMemo<TemplateSpec | null>(() => {
    const noPick = pickedTemplateId === null;
    if (noPick) return null;
    return TEMPLATES.find((tpl) => tpl.id === pickedTemplateId) ?? null;
  }, [pickedTemplateId]);

  const isOpen = props.open;
  // Modal hidden — short-circuit before rendering DOM so transitions stay clean.
  if (!isOpen) return null;

  // Add mode + nothing picked yet → show the template grid.
  const showTemplatePicker = !isEdit && pickedTemplate === null;
  if (showTemplatePicker) {
    return (
      <ModalShell onCancel={props.onCancel}>
        <h2 className="text-base font-semibold text-foreground">Add credential</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick a template — it decides which fields you fill in.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => setPickedTemplateId(template.id)}
              className="group flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-card/80"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <template.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">{template.title}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {template.description}
                </div>
              </div>
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={props.onCancel}>
            Cancel
          </Button>
        </div>
      </ModalShell>
    );
  }

  // Edit mode OR Custom template OR single-field template → render the
  // SINGLE-credential form. Multi-field templates render the bundle form.
  const isCustom = pickedTemplate?.id === "custom";
  const isMultiField = pickedTemplate !== null && pickedTemplate.fields.length > 1;
  if (isMultiField) {
    return (
      <TemplateBundleForm
        template={pickedTemplate}
        environments={props.environments}
        existingIdsInProject={props.existingIdsInProject}
        onCancel={props.onCancel}
        onBack={() => setPickedTemplateId(null)}
        onSave={props.onSave}
      />
    );
  }

  return (
    <SingleCredentialForm
      mode={props.mode}
      template={isCustom ? null : pickedTemplate}
      initialCredential={props.initialCredential}
      environments={props.environments}
      existingIdsInProject={props.existingIdsInProject}
      siblingCredentials={props.siblingCredentials}
      onCancel={props.onCancel}
      onBack={isEdit ? null : () => setPickedTemplateId(null)}
      onSave={props.onSave}
      // Sprint 5 — rail kind pre-fill. Only meaningful when we landed
      // on the "custom" branch via initialTemplateId; otherwise the
      // multi-field template already encodes the kind via its first
      // field, and SingleCredentialForm's existing seed logic handles
      // the single-field built-in case.
      seedKind={isCustom ? props.seedKind : undefined}
      seedKindLabel={isCustom ? props.seedKindLabel : undefined}
    />
  );
}

interface ModalShellProps {
  onCancel: () => void;
  children: React.ReactNode;
}

function ModalShell(props: ModalShellProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={props.onCancel} />
      <div
        className="relative z-50 w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {props.children}
      </div>
    </div>
  );
}

interface TemplateBundleFormProps {
  template: TemplateSpec;
  environments: VaultEnv[];
  existingIdsInProject: readonly string[];
  onCancel: () => void;
  onBack: () => void;
  onSave: (credentials: VaultCredential[]) => void;
}

function TemplateBundleForm(props: TemplateBundleFormProps) {
  const [name, setName] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // One values-per-env table per template field. Keyed by field idSuffix
  // so adding more templates does not require renumbering.
  const [valuesByField, setValuesByField] = useState<Record<string, Record<VaultEnvId, string>>>(() => {
    const seed: Record<string, Record<VaultEnvId, string>> = {};
    for (const field of props.template.fields) seed[field.idSuffix] = emptyValueByEnv(props.environments);
    return seed;
  });

  const handleEnvChange = (fieldSuffix: string, envId: VaultEnvId, value: string): void => {
    setValuesByField((prev) => ({
      ...prev,
      [fieldSuffix]: { ...prev[fieldSuffix], [envId]: value },
    }));
  };

  const handleSave = useCallback((): void => {
    logger.info(LOG_SCOPE, "TemplateBundleForm.handleSave — entry", { template: props.template.id });
    const isAuthorized = requireSuperAdmin();
    const notAuthorized = !isAuthorized;
    if (notAuthorized) {
      logger.warn(LOG_SCOPE, "TemplateBundleForm.handleSave — not authorized");
      setErrorMessage("Not authorized.");
      return;
    }
    const trimmed = name.trim();
    const isEmpty = trimmed.length === 0;
    if (isEmpty) {
      setErrorMessage("Name is required.");
      return;
    }
    // At least the PRIMARY field must carry a value somewhere. Optional
    // secondary fields with no value are skipped at save-time.
    const primary = props.template.fields[0];
    const primaryValues = valuesByField[primary.idSuffix] ?? {};
    const primaryHasValue = Object.values(primaryValues).some((v) => v.trim().length > 0);
    if (!primaryHasValue) {
      setErrorMessage(`${primary.label} is required (in at least one environment).`);
      return;
    }
    const baseSlug = slugify({ name: trimmed });
    const baseId = uniqueSlug({ base: baseSlug, existingIds: props.existingIdsInProject });
    const result: VaultCredential[] = [];
    let runningIds: string[] = [...props.existingIdsInProject, baseId];
    for (let index = 0; index < props.template.fields.length; index += 1) {
      const field = props.template.fields[index];
      const fieldValues = valuesByField[field.idSuffix] ?? emptyValueByEnv(props.environments);
      const fieldHasValue = Object.values(fieldValues).some((v) => v.trim().length > 0);
      const isPrimary = index === 0;
      // Secondary fields without any value are skipped — user did not need them.
      if (!isPrimary && !fieldHasValue) continue;
      const id = isPrimary
        ? baseId
        : uniqueSlug({ base: baseSlug + field.idSuffix, existingIds: runningIds });
      runningIds = [...runningIds, id];
      const credentialName = isPrimary ? trimmed : `${trimmed} ${field.label}`;
      const pairedWith = isPrimary ? undefined : baseId;
      result.push({
        id,
        kind: field.kind,
        name: credentialName,
        valueByEnv: fieldValues,
        isSensitive: field.sensitive,
        ...(pairedWith !== undefined ? { pairedWith } : {}),
      });
    }
    setErrorMessage(null);
    props.onSave(result);
    logger.info(LOG_SCOPE, "TemplateBundleForm.handleSave — exit", { count: result.length });
  }, [name, props, valuesByField]);

  const Icon = props.template.icon;

  return (
    <ModalShell onCancel={props.onCancel}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-foreground">{props.template.title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{props.template.description}</p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div>
          <label className="block text-xs text-muted-foreground">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Production Vault"
            className="mt-1"
            autoFocus
          />
          <p className="mt-1 text-[10px] text-muted-foreground/70">
            Field names will be auto-suffixed (e.g. "Production Vault Token").
          </p>
        </div>

        {props.template.fields.map((field, fieldIndex) => {
          const isPrimary = fieldIndex === 0;
          return (
            <div key={field.idSuffix} className="rounded-xl border border-border/60 bg-muted/10 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                  {field.label}
                </span>
                {isPrimary ? (
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-medium text-primary">
                    Required
                  </span>
                ) : (
                  <span className="rounded-full bg-muted/40 px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
                    Optional · leave blank to skip
                  </span>
                )}
                {field.sensitive ? (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-medium text-amber-500">
                    Sensitive
                  </span>
                ) : null}
              </div>
              <div className="space-y-1">
                {props.environments.map((env) => (
                  <div key={env.id} className="flex items-center gap-2">
                    <span className={cn("inline-flex h-2 w-2 rounded-full", env.color)} />
                    <span className="w-16 shrink-0 text-[10px] text-muted-foreground">{env.name}</span>
                    <Input
                      type={field.sensitive ? "password" : "text"}
                      value={valuesByField[field.idSuffix]?.[env.id] ?? ""}
                      onChange={(e) => handleEnvChange(field.idSuffix, env.id, e.target.value)}
                      placeholder={field.placeholder}
                      className="h-8 flex-1"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {errorMessage !== null && (
          <p className="text-xs text-destructive">{errorMessage}</p>
        )}
      </div>

      <div className="mt-5 flex justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={props.onBack}>
          ← Back to templates
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Add credential
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

interface SingleCredentialFormProps {
  mode: CredentialEditorMode;
  template: TemplateSpec | null;
  initialCredential: VaultCredential | null;
  environments: VaultEnv[];
  existingIdsInProject: readonly string[];
  siblingCredentials: readonly VaultCredential[];
  onCancel: () => void;
  onBack: (() => void) | null;
  onSave: (credentials: VaultCredential[]) => void;
  // Sprint 5 — when set, seed `kind` to this value AND lock the kind
  // selector (rendered as disabled select OR a read-only label if the
  // kind id isn't in KIND_OPTIONS — user-created custom kinds).
  // Only active in Add mode; Edit always pulls kind from the existing
  // credential.
  seedKind?: string;
  seedKindLabel?: string;
}

function SingleCredentialForm(props: SingleCredentialFormProps) {
  // Add-mode rail-prefill seed wins over template default; falls back
  // to existing seed logic when no rail hint was supplied.
  const railSeedKind = props.mode === "add" ? props.seedKind : undefined;
  const seedKind = (railSeedKind as VaultCredentialKind | undefined)
    ?? props.initialCredential?.kind
    ?? props.template?.fields[0]?.kind
    ?? "generic";
  const seedSensitive = props.initialCredential?.isSensitive
    ?? props.template?.fields[0]?.sensitive
    ?? false;
  const seedValues = useMemo<Record<VaultEnvId, string>>(() => {
    const base = emptyValueByEnv(props.environments);
    const existing = props.initialCredential?.valueByEnv ?? null;
    const hasExisting = existing !== null;
    if (hasExisting) {
      for (const env of props.environments) base[env.id] = existing[env.id] ?? "";
    }
    return base;
  }, [props.environments, props.initialCredential]);
  const seedPairedWith = props.initialCredential?.pairedWith ?? "";

  const [name, setName] = useState<string>(props.initialCredential?.name ?? "");
  const [kind, setKind] = useState<VaultCredentialKind>(seedKind);
  const [isSensitive, setIsSensitive] = useState<boolean>(seedSensitive);
  const [valueByEnv, setValueByEnv] = useState<Record<VaultEnvId, string>>(seedValues);
  const [pairedWith, setPairedWith] = useState<string>(seedPairedWith);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isEdit = props.mode === "edit";
  const editingId = props.initialCredential?.id ?? null;
  const pairCandidates = props.siblingCredentials.filter((cred) => cred.id !== editingId);

  // Templates with a single field (Link only) override kind + sensitivity
  // automatically; the Custom path leaves these editable EXCEPT when a
  // rail seedKind is provided — then kind is locked too. Sensitivity
  // stays user-editable on the rail-prefill path.
  const lockedToTemplate = props.template !== null && props.template.id !== "custom";
  const lockedByRailKind = props.mode === "add" && props.seedKind !== undefined;
  // Render the kind <select> as a read-only label when the seed kind
  // isn't in the built-in KIND_OPTIONS list (user-created custom
  // kinds — arbitrary nanoid ids). Falls back to the project's
  // display label so the user sees what they picked.
  const seedKindNotInOptions =
    lockedByRailKind && !KIND_OPTIONS.includes(seedKind as VaultCredentialKind);

  const handleEnvChange = (envId: VaultEnvId, value: string): void => {
    setValueByEnv((prev) => ({ ...prev, [envId]: value }));
  };

  const handleSave = useCallback((): void => {
    logger.info(LOG_SCOPE, "SingleCredentialForm.handleSave — entry", { mode: props.mode });
    const isAuthorized = requireSuperAdmin();
    const notAuthorized = !isAuthorized;
    if (notAuthorized) {
      logger.warn(LOG_SCOPE, "SingleCredentialForm.handleSave — not authorized");
      setErrorMessage("Not authorized.");
      return;
    }
    const trimmedName = name.trim();
    const isNameEmpty = trimmedName.length === 0;
    if (isNameEmpty) {
      setErrorMessage("Name is required.");
      return;
    }
    const hasAnyValue = Object.values(valueByEnv).some((value) => value.trim().length > 0);
    const noValues = !hasAnyValue;
    if (noValues) {
      setErrorMessage("At least one env value is required.");
      return;
    }
    const id = isEdit
      ? props.initialCredential!.id
      : uniqueSlug({ base: slugify({ name: trimmedName }), existingIds: props.existingIdsInProject });
    const trimmedPair = pairedWith.trim();
    const hasPair = trimmedPair.length > 0;
    // Preserve isFavorite on edit so toggling a star outside the modal is not
    // clobbered when the user saves an unrelated field change.
    const existingFavorite = props.initialCredential?.isFavorite ?? false;
    const result: VaultCredential = {
      id,
      kind,
      name: trimmedName,
      valueByEnv,
      isSensitive: isEdit ? props.initialCredential!.isSensitive : isSensitive,
      ...(hasPair ? { pairedWith: trimmedPair } : {}),
      ...(isEdit && existingFavorite ? { isFavorite: true } : {}),
    };
    setErrorMessage(null);
    props.onSave([result]);
    logger.info(LOG_SCOPE, "SingleCredentialForm.handleSave — exit", { credentialId: id });
  }, [isEdit, kind, isSensitive, name, props, valueByEnv, pairedWith]);

  return (
    <ModalShell onCancel={props.onCancel}>
      <h2 className="text-base font-semibold text-foreground">
        {isEdit ? "Edit credential" : props.template?.title ?? "Add credential"}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {isEdit ? "Update the value per environment." : "Auto-id is derived from the name."}
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="block text-xs text-muted-foreground">Name</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Postgres Primary"
            className="mt-1"
            autoFocus
          />
        </div>

        {!lockedToTemplate ? (
          <div>
            <label className="block text-xs text-muted-foreground">
              Kind <span className="text-muted-foreground/60">(icon mapping)</span>
            </label>
            {seedKindNotInOptions ? (
              // User-created kind id not in KIND_OPTIONS — render a
              // read-only label sourced from project.kinds[].label via
              // seedKindLabel prop. Looks like the disabled select
              // below but it's a div so React doesn't complain about
              // an unmatched <option>.
              <div className="mt-1 flex h-9 w-full items-center rounded-md border border-input bg-muted/30 px-3 text-sm text-muted-foreground">
                {props.seedKindLabel ?? seedKind}
              </div>
            ) : (
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as VaultCredentialKind)}
                disabled={lockedByRailKind}
                className="mt-1 h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              >
                {KIND_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </div>
        ) : null}

        {!lockedToTemplate ? (
          <label
            className={cn("flex items-center gap-2 text-xs", isEdit ? "text-muted-foreground/70" : "text-muted-foreground")}
            title={isEdit ? "Sensitivity is locked after create." : undefined}
          >
            <input
              type="checkbox"
              checked={isSensitive}
              onChange={(e) => setIsSensitive(e.target.checked)}
              disabled={isEdit}
              className="h-3.5 w-3.5 rounded border-input"
            />
            Sensitive (masked input)
            {isEdit ? <span className="text-[10px] text-muted-foreground/60">(locked)</span> : null}
          </label>
        ) : null}

        {!lockedToTemplate ? (
          <div>
            <label className="block text-xs text-muted-foreground">
              Paired with <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <select
              value={pairedWith}
              onChange={(e) => setPairedWith(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground"
            >
              <option value="">— none —</option>
              {pairCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name} ({candidate.id})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">Values per environment</div>
          {props.environments.map((env) => (
            <div key={env.id} className="flex items-center gap-2">
              <span className={cn("inline-flex h-2 w-2 rounded-full", env.color)} />
              <span className="w-16 shrink-0 text-xs text-muted-foreground">{env.name}</span>
              <Input
                type={isSensitive ? "password" : "text"}
                value={valueByEnv[env.id] ?? ""}
                onChange={(e) => handleEnvChange(env.id, e.target.value)}
                placeholder={`value for ${env.name}`}
                className="flex-1"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          ))}
        </div>

        {errorMessage !== null && (
          <p className="text-xs text-destructive">{errorMessage}</p>
        )}
      </div>

      <div className="mt-5 flex justify-between gap-2">
        {props.onBack !== null ? (
          <Button variant="ghost" size="sm" onClick={props.onBack}>
            ← Back to templates
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            {isEdit ? "Save changes" : "Add credential"}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
