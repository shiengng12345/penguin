import { useState } from "react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  ChevronRight,
  ChevronLeft,
  Package,
  Search,
  Globe,
  Layers,
  Keyboard,
  Settings,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    icon: Package,
    titleEn: "Install Packages",
    titleZh: "安装包",
    descEn: "Install gRPC-Web, gRPC, or SDK packages from the sidebar. Use ⌘ + S to open the installer.",
    descZh: "从侧边栏安装 gRPC-Web、gRPC 或 SDK 包。使用 ⌘ + S 打开安装器。",
    shortcut: "⌘ + S",
  },
  {
    icon: Globe,
    titleEn: "Switch Protocols",
    titleZh: "切换协议",
    descEn: "Cycle between gRPC-Web, gRPC, and SDK with the protocol toggle. Use ⌘ + E for quick switching.",
    descZh: "使用协议切换在 gRPC-Web、gRPC 和 SDK 之间切换。使用 ⌘ + E 快速切换。",
    shortcut: "⌘ + E",
  },
  {
    icon: Layers,
    titleEn: "Environments & Variables",
    titleZh: "环境与变量",
    descEn: "Create environments with variables like {{URL}} and {{TOKEN}}. Use them in your request URLs.",
    descZh: "创建包含 {{URL}}、{{TOKEN}} 等变量的环境。在请求 URL 中使用它们。",
  },
  {
    icon: Search,
    titleEn: "Search Methods",
    titleZh: "搜索方法",
    descEn: "Quickly find methods across all packages with ⌘ + F. Supports wildcard search (*).",
    descZh: "使用 ⌘ + F 快速搜索所有包中的方法。支持通配符搜索 (*)。",
    shortcut: "⌘ + F",
  },
  {
    icon: Keyboard,
    titleEn: "Keyboard Shortcuts",
    titleZh: "快捷键",
    descEn: "⌘ + N new tab, ⌘ + W close tab, ⌘ + R refresh, ⌘ + S installer, ⌘ + E cycle protocol, ⌘ + F search.",
    descZh: "⌘ + N 新建标签，⌘ + W 关闭标签，⌘ + R 刷新，⌘ + S 安装器，⌘ + E 切换协议，⌘ + F 搜索。",
  },
  {
    icon: Settings,
    titleEn: "Config File",
    titleZh: "配置文件",
    descEn: "Use .pengvi.config.json to auto-install packages and sync environments on startup.",
    descZh: "使用 .pengvi.config.json 在启动时自动安装包并同步环境。",
  },
];

export function Tutorial() {
  const { showTutorial, setShowTutorial } = useAppStore();
  const [step, setStep] = useState(0);

  if (!showTutorial) return null;

  const current = STEPS[step];
  const Icon = current.icon;
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setShowTutorial(false)}
      />
      <div
        className="relative z-10 w-full max-w-md rounded-xl border border-border bg-popover p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setShowTutorial(false)}
          className="absolute right-3 top-3 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Skip / 跳过"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">{current.titleEn}</h3>
            <h3 className="text-sm text-muted-foreground">{current.titleZh}</h3>
          </div>
          {current.shortcut && (
            <span className="ml-auto rounded bg-muted px-2 py-0.5 font-mono text-xs">
              {current.shortcut}
            </span>
          )}
        </div>

        <p className="text-sm text-muted-foreground mb-2">{current.descEn}</p>
        <p className="text-sm text-muted-foreground mb-6">{current.descZh}</p>

        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            {STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setStep(i)}
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  i === step ? "bg-primary w-4" : "bg-muted-foreground/40"
                )}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep((s) => s - 1)}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Back / 上一步
              </Button>
            )}
            {isLast ? (
              <Button size="sm" onClick={() => setShowTutorial(false)}>
                Get Started / 开始使用
              </Button>
            ) : (
              <Button size="sm" onClick={() => setStep((s) => s +1)}>
                Next / 下一步
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
