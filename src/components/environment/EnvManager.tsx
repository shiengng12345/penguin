import { useState, useCallback } from "react";
import {
  useAppStore,
  useActiveTab,
  ENV_COLORS,
  type Environment,
  type EnvVariable,
  type ProtocolTab,
} from "@/lib/store";
import { generateEnvId } from "@/lib/environment-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Edit, X, Save, Globe, Server, Box } from "lucide-react";
import { cn } from "@/lib/utils";

const PROTOCOL_TABS: { id: ProtocolTab; label: string; icon: typeof Globe }[] = [
  { id: "grpc-web", label: "gRPC-Web", icon: Globe },
  { id: "grpc", label: "gRPC", icon: Server },
  { id: "sdk", label: "SDK", icon: Box },
];

const STORE_KEYS: Record<ProtocolTab, string> = {
  "grpc-web": "pengvi-grpc-web-environments",
  grpc: "pengvi-grpc-environments",
  sdk: "pengvi-sdk-environments",
};

function saveToStorage(protocol: ProtocolTab, environments: Environment[], activeEnvId: string | null): void {
  localStorage.setItem(STORE_KEYS[protocol], JSON.stringify(environments));
  const activeKey = `pengvi-${protocol === "grpc-web" ? "grpc-web" : protocol}-active-env`;
  if (activeEnvId) localStorage.setItem(activeKey, activeEnvId);
  else localStorage.removeItem(activeKey);
}

function useEnvsForProtocol(protocol: ProtocolTab) {
  const environments =
    protocol === "grpc-web"
      ? useAppStore((s) => s.grpcWebEnvironments)
      : protocol === "grpc"
        ? useAppStore((s) => s.grpcEnvironments)
        : useAppStore((s) => s.sdkEnvironments);

  const activeEnvId =
    protocol === "grpc-web"
      ? useAppStore((s) => s.grpcWebActiveEnvId)
      : protocol === "grpc"
        ? useAppStore((s) => s.grpcActiveEnvId)
        : useAppStore((s) => s.sdkActiveEnvId);

  const addEnv = useCallback(
    (env: Environment) => {
      const s = useAppStore.getState();
      if (protocol === "grpc-web") s.addGrpcWebEnvironment(env);
      else if (protocol === "grpc") s.addGrpcEnvironment(env);
      else s.addSdkEnvironment(env);
      const next = [...(protocol === "grpc-web" ? s.grpcWebEnvironments : protocol === "grpc" ? s.grpcEnvironments : s.sdkEnvironments), env];
      saveToStorage(protocol, next, activeEnvId);
    },
    [protocol, activeEnvId],
  );

  const updateEnv = useCallback(
    (id: string, patch: Partial<Environment>) => {
      const s = useAppStore.getState();
      if (protocol === "grpc-web") s.updateGrpcWebEnvironment(id, patch);
      else if (protocol === "grpc") s.updateGrpcEnvironment(id, patch);
      else s.updateSdkEnvironment(id, patch);
      const envs = protocol === "grpc-web" ? s.grpcWebEnvironments : protocol === "grpc" ? s.grpcEnvironments : s.sdkEnvironments;
      const next = envs.map((e) => (e.id === id ? { ...e, ...patch } : e));
      saveToStorage(protocol, next, activeEnvId);
    },
    [protocol, activeEnvId],
  );

  const deleteEnv = useCallback(
    (id: string) => {
      const s = useAppStore.getState();
      if (protocol === "grpc-web") s.deleteGrpcWebEnvironment(id);
      else if (protocol === "grpc") s.deleteGrpcEnvironment(id);
      else s.deleteSdkEnvironment(id);
      const envs = protocol === "grpc-web" ? s.grpcWebEnvironments : protocol === "grpc" ? s.grpcEnvironments : s.sdkEnvironments;
      const next = envs.filter((e) => e.id !== id);
      const nextActive = activeEnvId === id ? null : activeEnvId;
      saveToStorage(protocol, next, nextActive);
    },
    [protocol, activeEnvId],
  );

  return { environments, activeEnvId, addEnvironment: addEnv, updateEnvironment: updateEnv, deleteEnvironment: deleteEnv };
}

interface EnvManagerProps {
  onClose: () => void;
}

export function EnvManager({ onClose }: EnvManagerProps) {
  const activeTab = useActiveTab();
  const [selectedProtocol, setSelectedProtocol] = useState<ProtocolTab>(activeTab?.protocolTab ?? "grpc-web");
  const {
    environments,
    addEnvironment,
    updateEnvironment,
    deleteEnvironment,
  } = useEnvsForProtocol(selectedProtocol);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState("green");
  const [formVars, setFormVars] = useState<EnvVariable[]>([]);

  const startAdd = () => {
    setIsAdding(true);
    setEditingId(null);
    setFormName("");
    setFormColor("green");
    setFormVars([{ key: "URL", value: "" }, { key: "TOKEN", value: "" }]);
  };

  const startEdit = (env: Environment) => {
    setEditingId(env.id);
    setIsAdding(false);
    setFormName(env.name);
    setFormColor(env.color);
    setFormVars(
      env.variables.length > 0
        ? env.variables
        : [{ key: "URL", value: "" }, { key: "TOKEN", value: "" }]
    );
  };

  const cancelForm = () => {
    setEditingId(null);
    setIsAdding(false);
  };

  const saveAdd = () => {
    if (!formName.trim()) return;
    const env: Environment = {
      id: generateEnvId(),
      name: formName.trim(),
      color: formColor,
      variables: formVars.filter((v) => v.key.trim()),
    };
    addEnvironment(env);
    cancelForm();
  };

  const saveEdit = () => {
    if (!editingId || !formName.trim()) return;
    updateEnvironment(editingId, {
      name: formName.trim(),
      color: formColor,
      variables: formVars.filter((v) => v.key.trim()),
    });
    cancelForm();
  };

  const updateFormVar = (index: number, patch: Partial<EnvVariable>) => {
    const next = [...formVars];
    next[index] = { ...next[index], ...patch };
    setFormVars(next);
  };

  const addFormVar = () => {
    setFormVars([...formVars, { key: "", value: "" }]);
  };

  const removeFormVar = (index: number) => {
    setFormVars(formVars.filter((_, i) => i !== index));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        className="relative z-50 w-full max-w-lg max-h-[90vh] overflow-hidden rounded-lg border border-border bg-popover shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border shrink-0">
          <div className="flex items-center justify-between p-4 pb-3">
            <h2 className="text-lg font-semibold text-foreground">
              Environments / 环境管理
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex gap-1 px-4 pb-2">
            {PROTOCOL_TABS.map((pt) => {
              const Icon = pt.icon;
              const count =
                pt.id === "grpc-web"
                  ? useAppStore.getState().grpcWebEnvironments.length
                  : pt.id === "grpc"
                    ? useAppStore.getState().grpcEnvironments.length
                    : useAppStore.getState().sdkEnvironments.length;
              return (
                <button
                  key={pt.id}
                  type="button"
                  onClick={() => {
                    setSelectedProtocol(pt.id);
                    cancelForm();
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    selectedProtocol === pt.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {pt.label}
                  {count > 0 && (
                    <span className={cn(
                      "ml-0.5 rounded-full px-1.5 py-0 text-[9px] font-bold",
                      selectedProtocol === pt.id
                        ? "bg-primary-foreground/20 text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="space-y-2">
            {environments.map((env) => (
              <div
                key={env.id}
                className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-2"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      ENV_COLORS.find((c) => c.id === env.color)?.hex ?? "#22c55e",
                  }}
                />
                <span className="flex-1 truncate text-sm font-medium">
                  {env.name}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => startEdit(env)}
                >
                  <Edit className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  onClick={() => deleteEnvironment(env.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {(isAdding || editingId) && (
            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Name / 名称
                </label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. LOCAL, UAT"
                  className="text-sm"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Color / 颜色
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {ENV_COLORS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setFormColor(c.id)}
                      className={cn(
                        "h-8 w-8 rounded-md transition-all",
                        formColor === c.id && "ring-2 ring-primary ring-offset-2"
                      )}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground">
                    Variables / 变量
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={addFormVar}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Add
                  </Button>
                </div>
                <div className="space-y-2">
                  {formVars.map((v, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={v.key}
                        onChange={(e) => updateFormVar(i, { key: e.target.value })}
                        placeholder="Key"
                        className="h-8 flex-1 font-mono text-xs"
                      />
                      <Input
                        value={v.value}
                        onChange={(e) => updateFormVar(i, { value: e.target.value })}
                        placeholder="Value"
                        className="h-8 flex-1 font-mono text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => removeFormVar(i)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={cancelForm}>
                  Cancel / 取消
                </Button>
                {isAdding ? (
                  <Button size="sm" onClick={saveAdd} disabled={!formName.trim()}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Add / 添加
                  </Button>
                ) : (
                  <Button size="sm" onClick={saveEdit} disabled={!formName.trim()}>
                    <Save className="mr-1 h-3.5 w-3.5" />
                    Save / 保存
                  </Button>
                )}
              </div>
            </div>
          )}

          {!isAdding && !editingId && (
            <Button variant="outline" onClick={startAdd} className="w-full">
              <Plus className="mr-1.5 h-4 w-4" />
              Add Environment / 添加环境
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
