import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Folder, KeyRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { type RedisKeyInfo } from "@/lib/redis";
import { cn } from "@/lib/utils";

interface TreeNode {
  name: string;
  fullPath: string;
  children: Map<string, TreeNode>;
  keyInfo?: RedisKeyInfo;
}

interface RedisKeyTreeProps {
  keys: RedisKeyInfo[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

const TYPE_BADGE_CLASSES: Record<string, string> = {
  string: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
  hash: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300",
  list: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
  set: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
  zset: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
};

function buildTree(keys: RedisKeyInfo[]) {
  const root: TreeNode = { name: "", fullPath: "", children: new Map() };

  for (const keyInfo of keys) {
    const parts = keyInfo.key.split(":");
    let node = root;

    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          fullPath: parts.slice(0, index + 1).join(":"),
          children: new Map(),
        });
      }
      node = node.children.get(part)!;
    }

    node.keyInfo = keyInfo;
  }

  return root;
}

function countLeaves(node: TreeNode): number {
  if (node.children.size === 0) {
    return node.keyInfo ? 1 : 0;
  }

  let count = 0;
  for (const child of node.children.values()) {
    count += countLeaves(child);
  }
  return count;
}

function TreeNodeRow({
  node,
  depth,
  selectedKey,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isLeaf = node.children.size === 0 && node.keyInfo;

  if (isLeaf && node.keyInfo) {
    return (
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition hover:bg-muted/40",
          selectedKey === node.keyInfo.key && "bg-primary/8",
        )}
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
        onClick={() => onSelect(node.keyInfo!.key)}
      >
        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{node.name}</span>
        <Badge
          variant="outline"
          className={cn("px-1.5 py-0 text-[10px] uppercase", TYPE_BADGE_CLASSES[node.keyInfo.keyType] ?? "")}
        >
          {node.keyInfo.keyType}
        </Badge>
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs transition hover:bg-muted/40"
        style={{ paddingLeft: `${depth * 16 + 12}px` }}
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <Folder className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-foreground">{node.name}</span>
        <span className="text-[10px] text-muted-foreground">{countLeaves(node)}</span>
      </button>

      {expanded &&
        Array.from(node.children.values()).map((child) => (
          <TreeNodeRow
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            selectedKey={selectedKey}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

export function RedisKeyTree({ keys, selectedKey, onSelect }: RedisKeyTreeProps) {
  const tree = useMemo(() => buildTree(keys), [keys]);

  if (keys.length === 0) {
    return (
      <div className="px-4 py-12 text-center text-sm text-muted-foreground">
        No keys found for this scan.
      </div>
    );
  }

  return (
    <div className="space-y-1 p-2">
      {Array.from(tree.children.values()).map((child) => (
        <TreeNodeRow
          key={child.fullPath}
          node={child}
          depth={0}
          selectedKey={selectedKey}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
