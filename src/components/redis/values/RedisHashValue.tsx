import { invoke } from "@tauri-apps/api/core";
import { Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { JsonEditor } from "@/components/ui/json-editor";
import { RedisValueTypeBadge } from "@/components/redis/RedisValueTypeBadge";
import {
  formatRedisValueForEditor,
  inferRedisValueKind,
} from "@/lib/redis-value-inspector";
import type { HashField, HashPage } from "@/lib/redis-types";

interface Props { keyName: string; }

export function RedisHashValue({ keyName }: Props): ReactElement {
  const [fields, setFields] = useState<HashField[]>([]);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState(0);
  const [total, setTotal] = useState(0);
  const [done, setDone] = useState(false);
  const [newField, setNewField] = useState("");
  const [newValue, setNewValue] = useState("");

  const load = useCallback(async () => {
    const page = await invoke<HashPage>("redis_hash_scan", {
      key: keyName,
      cursor: 0,
      count: 100,
    }).catch(() => ({ fields: [], total: 0, next_cursor: 0 }));
    setFields(page.fields);
    setCursor(page.next_cursor);
    setTotal(page.total);
    setDone(page.next_cursor === 0);
    setEditing(Object.fromEntries(page.fields.map((f) => [f.field, formatRedisValueForEditor(f.value)])));
  }, [keyName]);

  useEffect(() => { void load(); }, [load]);

  const loadMore = useCallback(async () => {
    if (done) return;
    const page = await invoke<HashPage>("redis_hash_scan", {
      key: keyName,
      cursor,
      count: 100,
    }).catch(() => ({ fields: [], total, next_cursor: 0 }));
    setFields((prev) => [...prev, ...page.fields]);
    setCursor(page.next_cursor);
    setTotal(page.total);
    setDone(page.next_cursor === 0);
    setEditing((prev) => ({
      ...prev,
      ...Object.fromEntries(page.fields.map((f) => [f.field, formatRedisValueForEditor(f.value)])),
    }));
  }, [keyName, cursor, done, total]);

  const handleSaveField = useCallback(async (field: string) => {
    await invoke("redis_hash_set", { key: keyName, field, value: editing[field] ?? "" }).catch(() => {});
  }, [keyName, editing]);

  const handleDeleteField = useCallback(async (field: string) => {
    await invoke("redis_hash_del", { key: keyName, field }).catch(() => {});
    setFields((prev) => prev.filter((f) => f.field !== field));
  }, [keyName]);

  const handleAddField = useCallback(async () => {
    if (newField.length === 0) return;
    await invoke("redis_hash_set", { key: keyName, field: newField, value: newValue }).catch(() => {});
    setNewField("");
    setNewValue("");
    await load();
  }, [keyName, newField, newValue, load]);

  return (
    <div className="flex h-full flex-col gap-0 overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card">
            <tr className="border-b border-border text-left text-[10px] text-muted-foreground">
              <th className="px-3 py-1.5 font-medium w-[28%]">Field</th>
              <th className="px-3 py-1.5 font-medium w-16">Type</th>
              <th className="px-3 py-1.5 font-medium">Value</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => {
              const value = editing[f.field] ?? f.value;
              const sourceKind = inferRedisValueKind(f.value);
              const editedKind = inferRedisValueKind(value);
              const kind =
                sourceKind === "json-object" || sourceKind === "json-array"
                  ? sourceKind
                  : editedKind;
              const isJson = kind === "json-object" || kind === "json-array";

              return (
                <tr key={f.field} className="border-b border-border/40 align-top hover:bg-muted/20">
                  <td className="px-3 py-2 font-mono text-muted-foreground">{f.field}</td>
                  <td className="px-3 py-2">
                    <RedisValueTypeBadge kind={kind} />
                  </td>
                  <td className="px-3 py-2">
                    {isJson ? (
                      <div className="h-36 min-w-0 overflow-hidden rounded border border-border bg-background">
                        <JsonEditor
                          value={value}
                          onChange={(nextValue) =>
                            setEditing((prev) => ({ ...prev, [f.field]: nextValue }))
                          }
                          placeholder='{"key": "value"}'
                        />
                      </div>
                    ) : (
                      <Input
                        value={value}
                        onChange={(e) =>
                          setEditing((prev) => ({ ...prev, [f.field]: e.target.value }))
                        }
                        onBlur={() => handleSaveField(f.field)}
                        className="h-6 border-0 bg-transparent px-0 font-mono text-xs focus-visible:ring-0"
                      />
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => handleSaveField(f.field)}
                        className="text-muted-foreground/50 hover:text-primary"
                        title="Save"
                      >
                        <Save className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteField(f.field)}
                        className="text-muted-foreground/50 hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!done ? (
          <button
            type="button"
            onClick={loadMore}
            className="m-3 text-xs text-primary hover:underline"
          >
            Load more ({fields.length}/{total})
          </button>
        ) : null}
      </div>
      {/* Add new field */}
      <div className="flex shrink-0 items-center gap-2 border-t border-border/60 px-3 py-2">
        <Input
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
          placeholder="field"
          className="h-6 flex-1 text-xs font-mono"
        />
        <Input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="value"
          className="h-6 flex-[2] text-xs font-mono"
        />
        <Button size="sm" className="h-6 gap-1 px-2" onClick={handleAddField}>
          <Plus className="h-3 w-3" />
          Add
        </Button>
      </div>
    </div>
  );
}
