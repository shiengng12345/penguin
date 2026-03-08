import { useAppStore, useActiveTab, createTab, type ProtocolTab } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Globe, Server, Box, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

const PROTOCOL_BADGES: Record<
  ProtocolTab,
  { label: string; icon: typeof Globe; className: string }
> = {
  "grpc-web": {
    label: "gRPC-Web",
    icon: Globe,
    className: "bg-green-500/20 text-green-600 dark:text-green-400",
  },
  grpc: {
    label: "gRPC",
    icon: Server,
    className: "bg-blue-500/20 text-blue-600 dark:text-blue-400",
  },
  sdk: {
    label: "SDK",
    icon: Box,
    className: "bg-purple-500/20 text-purple-600 dark:text-purple-400",
  },
};

interface TabBarProps {
  onCycleProtocol: () => void;
}

export function TabBar({ onCycleProtocol }: TabBarProps) {
  const { tabs, activeTabId, setActiveTab, removeTab, addTab } = useAppStore();
  const activeTab = useActiveTab();

  return (
    <div className="flex h-9 shrink-0 items-center border-b border-border bg-card">
      <div className="flex flex-1 items-center overflow-x-auto">
        {tabs.map((tab) => {
          const badge = PROTOCOL_BADGES[tab.protocolTab];
          const Icon = badge.icon;
          const isActive = tab.id === activeTabId;
          const label = tab.selectedMethod?.name ?? "New Tab / 新标签";

          return (
            <div
              key={tab.id}
              className={cn(
                "group flex shrink-0 items-center gap-1.5 border-r border-border px-3 py-1.5",
                isActive && "bg-accent"
              )}
            >
              <button
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className="flex min-w-0 flex-1 items-center gap-1.5"
              >
                <span
                  className={cn(
                    "flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium",
                    badge.className
                  )}
                >
                  <Icon className="h-2.5 w-2.5" />
                  {badge.label}
                </span>
                <span className="truncate text-xs">{label}</span>
              </button>
              {tabs.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (tabs.length <= 1) {
                      const fresh = createTab();
                      useAppStore.setState({ tabs: [fresh], activeTabId: fresh.id });
                      document.dispatchEvent(new CustomEvent("pengvi:collapse-sidebar"));
                    } else {
                      removeTab(tab.id);
                    }
                  }}
                  className="rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/20 hover:opacity-100 group-hover:opacity-70"
                  title="Close tab / 关闭标签"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-0.5 border-l border-border pl-1 pr-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onCycleProtocol}
          title="Cycle protocol (⌘E) / 切换协议"
        >
          {activeTab && (
            <>
              {activeTab.protocolTab === "grpc-web" && (
                <Server className="h-3.5 w-3.5" />
              )}
              {activeTab.protocolTab === "grpc" && (
                <Box className="h-3.5 w-3.5" />
              )}
              {activeTab.protocolTab === "sdk" && (
                <Globe className="h-3.5 w-3.5" />
              )}
            </>
          )}
        </Button>
        <button
          type="button"
          onClick={() => addTab()}
          className="flex h-7 w-7 items-center justify-center rounded hover:bg-accent"
          title="Add tab / 添加标签"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
