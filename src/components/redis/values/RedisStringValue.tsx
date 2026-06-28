import { invoke } from "@tauri-apps/api/core";
import { Save } from "lucide-react";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { JsonEditor } from "@/components/ui/json-editor";
import { RedisValueTypeBadge } from "@/components/redis/RedisValueTypeBadge";
import {
  formatRedisValueForEditor,
  inferRedisValueKind,
} from "@/lib/redis-value-inspector";
import type { StringValue } from "@/lib/redis-types";

interface Props { keyName: string; }

export function RedisStringValue({ keyName }: Props): ReactElement {
  const [data, setData] = useState<StringValue | null>(null);
  const [editing, setEditing] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void invoke<StringValue>("redis_string_get", { key: keyName })
      .then((v) => { setData(v); setEditing(formatRedisValueForEditor(v.value)); })
      .catch(() => {});
  }, [keyName]);

  const handleSave = useCallback(async () => {
    if (data?.truncated) return;
    setSaving(true);
    try {
      await invoke("redis_string_set", { key: keyName, value: editing });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  }, [keyName, editing, data?.truncated]);

  if (data === null) return <div className="p-4 text-xs text-muted-foreground">Loading…</div>;

  const sourceKind = inferRedisValueKind(data.value);
  const editedKind = inferRedisValueKind(editing);
  const kind =
    sourceKind === "json-object" || sourceKind === "json-array"
      ? sourceKind
      : editedKind;
  const isJson = kind === "json-object" || kind === "json-array";

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RedisValueTypeBadge kind={kind} />
          <span className="text-[11px] text-muted-foreground">
            {data.total_bytes} bytes{data.truncated ? " (truncated to 4KB)" : ""}
          </span>
        </div>
        <Button
          size="sm"
          className="h-6 gap-1 px-2 text-[11px]"
          onClick={handleSave}
          disabled={saving || data.truncated}
          title={data.truncated ? "Value preview is truncated. Full-value editing is disabled." : undefined}
        >
          <Save className="h-3 w-3" />
          {saved ? "Saved!" : saving ? "Saving…" : "Save"}
        </Button>
      </div>
      {isJson ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded border border-border bg-background">
          <JsonEditor
            value={editing}
            onChange={setEditing}
            placeholder='{"key": "value"}'
          />
        </div>
      ) : (
        <textarea
          className="flex-1 resize-none rounded border border-border bg-muted/20 p-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          spellCheck={false}
        />
      )}
    </div>
  );
}
