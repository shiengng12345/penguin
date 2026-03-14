import { useState, useEffect, useCallback, useRef } from "react";
import { useAppStore } from "@/lib/store";
import {
  Package,
  Globe,
  Layers,
  MousePointer2,
  Send,
  Keyboard,
  Search,
  History,
  Bookmark,
  FileText,
  Wifi,
  Terminal,
  RotateCcw,
  Plus,
  X as XIcon,
  ChevronRight,
  Copy,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type StepAction = "observe" | "click" | "shortcut" | "shortcut-repeat";

interface TourStep {
  target: string | null;
  icon: LucideIcon;
  titleEn: string;
  titleZh: string;
  descEn: string;
  descZh: string;
  action: StepAction;
  placement: "right" | "bottom" | "left" | "top";
  shortcutKey?: string;
  shortcutDisplay?: string;
  opensDialog?: boolean;
  repeatCount?: number;
  highlightTarget?: string;
  typeExample?: string;
  prefillValue?: string;
}

const SAMPLE_PACKAGE = "@snsoft/player-grpc-web@1.0.0-20260312191315";

const STEPS: TourStep[] = [
  // --- UI walkthrough ---
  {
    target: "[data-tour='sidebar']",
    icon: Package,
    titleEn: "Packages Sidebar",
    titleZh: "包侧边栏",
    descEn: "All your installed packages, services, and methods live here. Expand a package to browse its API.",
    descZh: "所有已安装的包、服务和方法都在这里。展开包以浏览 API。",
    action: "observe",
    placement: "right",
  },
  {
    target: "[data-tour='install-btn']",
    icon: Package,
    titleEn: "Install a Package",
    titleZh: "安装包",
    descEn: `Click this +button to install a gRPC-Web package. We'll pre-fill a sample: ${SAMPLE_PACKAGE}`,
    descZh: `点击此 +按钮安装 gRPC-Web 包。我们会预填一个示例：${SAMPLE_PACKAGE}`,
    action: "click",
    placement: "bottom",
    prefillValue: SAMPLE_PACKAGE,
    opensDialog: true,
  },
  {
    target: "[data-tour='tab-bar']",
    icon: Layers,
    titleEn: "Tabs & Protocols",
    titleZh: "标签 & 协议",
    descEn: "Each tab is an independent workspace. The badge shows the current protocol.",
    descZh: "每个标签是一个独立的工作区。徽章显示当前协议。",
    action: "observe",
    placement: "bottom",
  },
  {
    target: "[data-tour='url-bar']",
    icon: Globe,
    titleEn: "URL & Environment Variables",
    titleZh: "URL 和环境变量",
    descEn: "Enter your target URL here. Use {{VAR}} syntax to reference environment variables.",
    descZh: "在此输入目标 URL。使用 {{VAR}} 语法引用环境变量。",
    action: "observe",
    placement: "bottom",
  },
  {
    target: "[data-tour='request-panel']",
    icon: MousePointer2,
    titleEn: "Request Editor",
    titleZh: "请求编辑器",
    descEn: "Edit headers and JSON body. Select a method from the sidebar — the body auto-fills with defaults.",
    descZh: "编辑请求头和 JSON 正文。从侧边栏选择方法，正文会自动填充。",
    action: "observe",
    placement: "top",
  },
  {
    target: "[data-tour='send-btn']",
    icon: Send,
    titleEn: "Send Request",
    titleZh: "发送请求",
    descEn: "Click Send or press ⌘ + Enter to fire your request. The response appears on the right.",
    descZh: "点击发送或按 ⌘ + Enter 发送请求。响应显示在右侧。",
    action: "observe",
    placement: "left",
  },
  // --- Shortcut walkthrough ---
  {
    target: null,
    icon: Package,
    titleEn: "Open Package Installer",
    titleZh: "打开包安装器",
    descEn: "Install new packages from npm. Press ⌘ + S to open, then try the sample below!",
    descZh: "从 npm 安装新包。按 ⌘ + S 打开，然后试试下面的示例！",
    action: "shortcut",
    placement: "bottom",
    shortcutKey: "s",
    shortcutDisplay: "⌘ + S",
    opensDialog: true,
    prefillValue: SAMPLE_PACKAGE,
  },
  {
    target: null,
    icon: Layers,
    titleEn: "Cycle Protocol",
    titleZh: "切换协议",
    descEn: "Switch between gRPC-Web, gRPC, and SDK. Press ⌘ + E three times and watch the tab badge change!",
    descZh: "在 gRPC-Web、gRPC 和 SDK 之间切换。按 ⌘ + E 三次，观察标签徽章变化！",
    action: "shortcut-repeat",
    placement: "bottom",
    shortcutKey: "e",
    shortcutDisplay: "⌘ + E",
    opensDialog: false,
    repeatCount: 3,
    highlightTarget: "[data-tour='tab-bar']",
  },
  {
    target: null,
    icon: Search,
    titleEn: "Search & Select a Method",
    titleZh: "搜索并选择方法",
    descEn: "Press ⌘  F — we'll search for GetFrontendLoginConfigNoAuth. Select it from the results to load the method!",
    descZh: "按 ⌘ + F — 我们会搜索 GetFrontendLoginConfigNoAuth。从结果中选择它来加载方法！",
    action: "shortcut",
    placement: "bottom",
    shortcutKey: "f",
    shortcutDisplay: "⌘ + F",
    opensDialog: true,
    typeExample: "GetFrontendLoginConfigNoAuth",
  },
  {
    target: "[data-tour='send-btn']",
    icon: Send,
    titleEn: "Send Your Request",
    titleZh: "发送请求",
    descEn: "The method is loaded! Click the Send button or press ⌘ + Enter to fire the request.",
    descZh: "方法已加载！点击发送按钮或按 ⌘ + Enter 来发送请求。",
    action: "click",
    placement: "left",
  },
  {
    target: null,
    icon: History,
    titleEn: "Request History",
    titleZh: "历史记录",
    descEn: "Browse your past requests. Click any entry to reload it.",
    descZh: "浏览过去的请求。点击任何条目重新加载。",
    action: "shortcut",
    placement: "bottom",
    shortcutKey: "h",
    shortcutDisplay: "⌘ + H",
    opensDialog: true,
  },
  {
    target: "[data-tour='save-btn']",
    icon: Bookmark,
    titleEn: "Save This Request",
    titleZh: "保存请求",
    descEn: "Click the bookmark button to save the current request. You can also use ⌘ + Shift + S.",
    descZh: "点击书签按钮保存当前请求。也可以使用 ⌘ +Shift + S。",
    action: "click",
    placement: "top",
  },
  {
    target: null,
    icon: Bookmark,
    titleEn: "Saved Requests",
    titleZh: "已保存请求",
    descEn: "Open your saved requests collection. Press ⌘ + O to browse what you just saved!",
    descZh: "打开已保存的请求集合。按 ⌘ + O 浏览你刚保存的内容！",
    action: "shortcut",
    placement: "bottom",
    shortcutKey: "o",
    shortcutDisplay: "⌘ + O",
    opensDialog: true,
  },
  {
    target: null,
    icon: FileText,
    titleEn: "Request Documentation",
    titleZh: "请求文档",
    descEn: "View auto-generated docs for the selected method's request/response types.",
    descZh: "查看选定方法的请求/响应类型的自动生成文档。",
    action: "shortcut",
    placement: "bottom",
    shortcutKey: "d",
    shortcutDisplay: "⌘ + D",
    opensDialog: true,
  },
  {
    target: null,
    icon: Wifi,
    titleEn: "Network Check",
    titleZh: "网络检查",
    descEn: "Check connectivity and run a speed test before sending requests.",
    descZh: "在发送请求前检查连接并运行速度测试。",
    action: "shortcut",
    placement: "bottom",
    shortcutKey: "i",
    shortcutDisplay: "⌘ + I",
    opensDialog: true,
  },
  {
    target: "[data-tour='curl-btn']",
    icon: Copy,
    titleEn: "Copy as cURL",
    titleZh: "复制为 cURL",
    descEn: "Click the cURL button to copy the current request as a cURL command.",
    descZh: "点击 cURL 按钮将当前请求复制为 cURL 命令。",
    action: "click",
    placement: "top",
  },
  {
    target: null,
    icon: Terminal,
    titleEn: "Import from cURL",
    titleZh: "导入 cURL",
    descEn: "Now try the reverse! Press Command ⌘ + Shift + I to paste a cURL command and auto-fill a request.",
    descZh: "现在试试反向操作！按 ⌘ + Shift + I 粘贴 cURL 命令并自动填充请求。",
    action: "shortcut",
    placement: "bottom",
    shortcutKey: "shift+i",
    shortcutDisplay: "⌘ + Shift + I",
    opensDialog: true,
  },
  {
    target: null,
    icon: Plus,
    titleEn: "New Tab",
    titleZh: "新建标签",
    descEn: "Open a fresh tab for a new request. Each tab is completely independent.",
    descZh: "打开一个新标签来发起新请求。每个标签完全独立。",
    action: "shortcut",
    placement: "bottom",
    shortcutKey: "n",
    shortcutDisplay: "⌘ + N",
    opensDialog: false,
  },
  {
    target: null,
    icon: RotateCcw,
    titleEn: "Reset Tab",
    titleZh: "重置标签",
    descEn: "Clear the current tab — resets method, body, and response back to defaults.",
    descZh: "清除当前标签 — 将方法、正文和响应重置为默认值。",
    action: "shortcut",
    placement: "bottom",
    shortcutKey: "r",
    shortcutDisplay: "⌘ + R",
    opensDialog: false,
  },
  {
    target: null,
    icon: Keyboard,
    titleEn: "Shortcut Cheat Sheet",
    titleZh: "快捷键表",
    descEn: "Forgot a shortcut? Open this anytime for a quick reference of all keys.",
    descZh: "忘记快捷键了？随时打开此表查看所有按键参考。",
    action: "shortcut",
    placement: "bottom",
    shortcutKey: "/",
    shortcutDisplay: "⌘ + /",
    opensDialog: true,
  },
  // --- Final slide ---
  {
    target: null,
    icon: Keyboard,
    titleEn: "You're Ready!",
    titleZh: "准备就绪！",
    descEn: "You've learned all the shortcuts. Press ⌘ + / anytime to review them. Now go build something great!",
    descZh: "你已经学会了所有快捷键。随时按 ⌘ + / 查看。现在去构建伟大的东西吧！",
    action: "observe",
    placement: "bottom",
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 8;

function getTooltipStyle(
  rect: Rect | null,
  placement: TourStep["placement"],
  tooltipW: number,
  tooltipH: number
): React.CSSProperties {
  if (!rect) {
    return {
      top: "50%",
      left: "50%",
      transform: "translate(-50%, -50%)",
    };
  }

  const gap = 16;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top: number;
  let left: number;

  switch (placement) {
    case "right":
      top = rect.top +rect.height / 2 - tooltipH / 2;
      left = rect.left +rect.width +PADDING +gap;
      break;
    case "left":
      top = rect.top +rect.height / 2 - tooltipH / 2;
      left = rect.left - PADDING - gap - tooltipW;
      break;
    case "bottom":
      top = rect.top +rect.height +PADDING +gap;
      left = rect.left +rect.width / 2 - tooltipW / 2;
      break;
    case "top":
      top = rect.top - PADDING - gap - tooltipH;
      left = rect.left +rect.width / 2 - tooltipW / 2;
      break;
  }

  top = Math.max(12, Math.min(top, vh - tooltipH - 12));
  left = Math.max(12, Math.min(left, vw - tooltipW - 12));

  return { top, left };
}

function closeAllDialogs() {
  document.dispatchEvent(new CustomEvent("pengvi:close-all-dialogs"));
}

export function InteractiveTutorial() {
  const { showTutorial, setShowTutorial, userName } = useAppStore();
  const [step, setStep] = useState(0);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [pulse, setPulse] = useState(false);
  const [waitingForDialog, setWaitingForDialog] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [tooltipSize, setTooltipSize] = useState({ w: 400, h: 200 });
  const [repeatPresses, setRepeatPresses] = useState(0);
  const [highlightRect, setHighlightRect] = useState<Rect | null>(null);
  const [highlightFlash, setHighlightFlash] = useState(false);
  const [blinkNext, setBlinkNext] = useState(false);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const hasTarget = !!current.target;
  const Icon = current.icon;

  const dialogIsOpen =
    waitingForDialog ||
    (current.action === "observe" && current.opensDialog);

  const measureTarget = useCallback(() => {
    if (!current.target) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(current.target);
    if (el) {
      const r = el.getBoundingClientRect();
      setTargetRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    } else {
      setTargetRect(null);
    }
  }, [current.target]);

  useEffect(() => {
    if (!showTutorial) return;
    measureTarget();
    const interval = setInterval(measureTarget, 300);
    window.addEventListener("resize", measureTarget);
    return () => {
      clearInterval(interval);
      window.removeEventListener("resize", measureTarget);
    };
  }, [showTutorial, measureTarget]);

  useEffect(() => {
    if (!showTutorial) return;
    setPulse(false);
    const t = setTimeout(() => setPulse(true), 400);
    return () => clearTimeout(t);
  }, [step, showTutorial]);

  useEffect(() => {
    if (!tooltipRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        setTooltipSize({ w: e.contentRect.width, h: e.contentRect.height });
      }
    });
    obs.observe(tooltipRef.current);
    return () => obs.disconnect();
  }, []);

  const advance = useCallback(() => {
    if (isLast) {
      closeAllDialogs();
      setShowTutorial(false);
      setStep(0);
    } else {
      closeAllDialogs();
      setWaitingForDialog(false);
      setStep((s) => s +1);
    }
  }, [isLast, setShowTutorial]);

  const setInstallerPrefill = useAppStore((s) => s.setInstallerPrefill);
  const setSearchPrefill = useAppStore((s) => s.setSearchPrefill);

  // Click-action steps: force-enable disabled buttons during tutorial, listen for click
  useEffect(() => {
    if (!showTutorial || !current.target || current.action !== "click") return;

    const el = document.querySelector(current.target);
    if (!el) return;

    const wasDisabled = (el as HTMLButtonElement).disabled ?? false;
    if (wasDisabled) {
      (el as HTMLButtonElement).disabled = false;
      el.classList.remove("pointer-events-none", "opacity-50");
    }

    const handler = () => {
      if (current.prefillValue) {
        setInstallerPrefill(current.prefillValue);
      }
      if (current.opensDialog) {
        setWaitingForDialog(true);
      } else {
        setTimeout(advance, 600);
      }
    };
    el.addEventListener("click", handler, { once: true });
    return () => {
      el.removeEventListener("click", handler);
      if (wasDisabled) {
        (el as HTMLButtonElement).disabled = true;
      }
    };
  }, [showTutorial, step, current.target, current.action, current.prefillValue, current.opensDialog, setInstallerPrefill, advance]);

  // Reset state on step change
  useEffect(() => {
    setRepeatPresses(0);
    setHighlightFlash(false);
    setBlinkNext(false);
  }, [step]);

  // Blink the Next button after 2s to remind user
  useEffect(() => {
    if (!showTutorial) return;
    setBlinkNext(false);
    const timer = setTimeout(() => setBlinkNext(true), 2000);
    return () => clearTimeout(timer);
  }, [showTutorial, step, waitingForDialog]);

  // Measure highlight target for shortcut-repeat steps
  useEffect(() => {
    if (!showTutorial || current.action !== "shortcut-repeat" || !current.highlightTarget) {
      setHighlightRect(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector(current.highlightTarget!);
      if (el) {
        const r = el.getBoundingClientRect();
        setHighlightRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      }
    };
    measure();
    const interval = setInterval(measure, 300);
    return () => clearInterval(interval);
  }, [showTutorial, step, current.action, current.highlightTarget]);

  // Standard shortcut-action steps
  useEffect(() => {
    if (!showTutorial || current.action !== "shortcut" || !current.shortcutKey) return;
    if (waitingForDialog) return;

    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;

      const wantsShift = current.shortcutKey!.startsWith("shift+");
      const baseKey = wantsShift ? current.shortcutKey!.replace("shift+", "") : current.shortcutKey!;

      if (e.key.toLowerCase() === baseKey && e.shiftKey === wantsShift) {
        if (current.opensDialog) {
          if (current.prefillValue) {
            setInstallerPrefill(current.prefillValue);
          }
          if (current.typeExample) {
            setSearchPrefill(current.typeExample);
          }
          setWaitingForDialog(true);
        } else {
          setTimeout(advance, 400);
        }
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showTutorial, step, current.action, current.shortcutKey, current.opensDialog, current.prefillValue, current.typeExample, waitingForDialog, advance, setSearchPrefill]);

  // shortcut-repeat: require N presses of the shortcut
  useEffect(() => {
    if (!showTutorial || current.action !== "shortcut-repeat" || !current.shortcutKey) return;

    const needed = current.repeatCount ?? 3;

    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key.toLowerCase() === current.shortcutKey) {
        setRepeatPresses((prev) => {
          const next = prev +1;
          setHighlightFlash(true);
          setTimeout(() => setHighlightFlash(false), 300);
          if (next >= needed) {
            setTimeout(advance, 500);
          }
          return next;
        });
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showTutorial, step, current.action, current.shortcutKey, current.repeatCount, advance]);

  // When waiting for user to see the opened dialog, let user explore then click Next
  useEffect(() => {
    if (!waitingForDialog) return;
  }, [waitingForDialog]);

  // General keyboard nav: Escape to quit, arrow keys for observe steps
  useEffect(() => {
    if (!showTutorial || !userName) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeAllDialogs();
        setShowTutorial(false);
        setStep(0);
        return;
      }
      // Only allow arrow/enter nav for observe steps (not shortcut steps, to avoid conflicts)
      if (current.action === "observe") {
        if (e.key === "ArrowRight" || e.key === "Enter") {
          advance();
        } else if (e.key === "ArrowLeft" && step > 0) {
          setStep((s) => {
            closeAllDialogs();
            return s - 1;
          });
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showTutorial, userName, step, current.action, advance, setShowTutorial]);

  if (!showTutorial || !userName) return null;

  const clickMode = current.action === "click" && !waitingForDialog;

  const tooltipStyle: React.CSSProperties =
    dialogIsOpen || clickMode
      ? { bottom: 16, right: 16, top: "auto", left: "auto" }
      : hasTarget
        ? getTooltipStyle(targetRect, current.placement, tooltipSize.w, tooltipSize.h)
        : { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  const showNextBtn =
    current.action === "observe" ||
    (current.action === "click" && waitingForDialog) ||
    (current.action === "shortcut" && waitingForDialog);

  return (
    <>
    {/* Dark overlay — NOT rendered for click-action steps (real buttons must be clickable) */}
    {!clickMode && (
      <div
        className={cn(
          "fixed inset-0 z-40 transition-all duration-300",
          dialogIsOpen ? "bg-black/30 pointer-events-none" : "bg-black/60"
        )}
        onClick={(e) => {
          if (dialogIsOpen) return;
          e.stopPropagation();
          if (current.action === "observe") advance();
        }}
      />
    )}

    {/* Glow ring around target */}
    {targetRect && hasTarget && (
      <div
        className={cn(
          "fixed pointer-events-none rounded-lg transition-all duration-300",
          clickMode
            ? "z-[9999] border-[3px] border-sky-400 animate-pulse"
            : pulse ? "z-40 border-2 border-primary animate-pulse" : "z-40 border-2 border-primary"
        )}
        style={{
          top: targetRect.top - PADDING,
          left: targetRect.left - PADDING,
          width: targetRect.width +PADDING * 2,
          height: targetRect.height +PADDING * 2,
          boxShadow: clickMode
            ? "0 0 30px 8px oklch(0.7 0.2 230 / 0.7), 0 0 0 9999px rgba(0,0,0,0.6)"
            : "0 0 20px 4px oklch(0.7 0.15 250 / 0.4), 0 0 60px 8px oklch(0.7 0.15 250 / 0.15)",
        }}
      />
    )}

    {/* Highlight ring for shortcut-repeat (e.g. protocol badge) */}
    {highlightRect && current.action === "shortcut-repeat" && (
      <div
        className="fixed z-40 pointer-events-none rounded-lg border-2 transition-all duration-200"
        style={{
          top: highlightRect.top - PADDING,
          left: highlightRect.left - PADDING,
          width: highlightRect.width +PADDING * 2,
          height: highlightRect.height +PADDING * 2,
          borderColor: highlightFlash ? "oklch(0.8 0.15 90)" : "oklch(0.7 0.15 250 / 0.5)",
          boxShadow: highlightFlash ? "0 0 24px 6px oklch(0.8 0.15 90 / 0.5)" : "none",
        }}
      />
    )}

    {/* Tooltip card at z-[60] — floats above dialogs so the hint text stays visible */}
    <div
      ref={tooltipRef}
      className="fixed z-[60] w-[400px] rounded-xl border border-border bg-popover p-5 shadow-2xl transition-all duration-300 pointer-events-auto"
      style={tooltipStyle}
      onClick={(e) => e.stopPropagation()}
    >
        {/* Close */}
        <button
          type="button"
          onClick={() => {
            closeAllDialogs();
            setShowTutorial(false);
            setStep(0);
          }}
          className="absolute right-3 top-3 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Skip tutorial"
        >
          <XIcon className="h-4 w-4" />
        </button>

        {/* Icon +title */}
        <div className="flex items-center gap-3 mb-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-foreground text-sm">{current.titleEn}</h3>
            <p className="text-xs text-muted-foreground">{current.titleZh}</p>
          </div>
          {/* Step counter */}
          <span className="text-[10px] text-muted-foreground shrink-0">
            {step +1}/{STEPS.length}
          </span>
        </div>

        {/* Description */}
        <p className="text-sm text-muted-foreground mb-1">{current.descEn}</p>
        <p className="text-sm text-muted-foreground mb-4">{current.descZh}</p>

        {/* Standard shortcut key prompt */}
        {current.action === "shortcut" && !waitingForDialog && (
          <div className="mb-4 flex items-center justify-center gap-3 rounded-lg bg-muted/50 border border-border px-4 py-3">
            <Keyboard className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">Press</span>
            <kbd className={cn(
              "inline-flex items-center gap-1 rounded-lg bg-background border-2 border-primary px-4 py-2 font-mono text-base font-bold text-primary shadow-sm",
              pulse && "animate-pulse"
            )}>
              {current.shortcutDisplay}
            </kbd>
            <span className="text-xs text-muted-foreground">to try it</span>
          </div>
        )}

        {/* shortcut-repeat: show press count progress */}
        {current.action === "shortcut-repeat" && (
          <div className="mb-4 space-y-2">
            <div className="flex items-center justify-center gap-3 rounded-lg bg-muted/50 border border-border px-4 py-3">
              <Keyboard className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground">Press</span>
              <kbd className={cn(
                "inline-flex items-center gap-1 rounded-lg bg-background border-2 border-primary px-4 py-2 font-mono text-base font-bold text-primary shadow-sm",
                highlightFlash && "scale-110 border-yellow-400"
              )}>
                {current.shortcutDisplay}
              </kbd>
              <span className="text-xs text-muted-foreground">
                {repeatPresses}/{current.repeatCount ?? 3} times
              </span>
            </div>
            <div className="flex justify-center gap-2">
              {Array.from({ length: current.repeatCount ?? 3 }).map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "h-2.5 w-2.5 rounded-full transition-all duration-200",
                    i < repeatPresses
                      ? "bg-primary scale-110"
                      : "bg-muted-foreground/30"
                  )}
                />
              ))}
            </div>
          </div>
        )}

        {/* After user pressed shortcut and dialog opened — show suggestion if available */}
        {current.action === "shortcut" && waitingForDialog && (
          <div className="mb-4 space-y-2">
            {current.prefillValue && (
              <div className="flex flex-col gap-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2.5">
                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                  Try this sample package / 试试这个示例包:
                </span>
                <code className="font-mono text-xs font-bold text-primary select-all break-all">
                  {current.prefillValue}
                </code>
              </div>
            )}
            {current.typeExample && (
              <div className="flex flex-col gap-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2.5">
                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                  Searching / 搜索中:
                </span>
                <code className="font-mono text-xs font-bold text-primary select-all break-all">
                  {current.typeExample}
                </code>
                <span className="text-[10px] text-blue-600/70 dark:text-blue-400/70 mt-0.5">
                  Click a result or press Enter to load it / 点击结果或按 Enter 加载
                </span>
              </div>
            )}
            <div className="flex items-center gap-2 rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2 text-xs text-green-600 dark:text-green-400">
              <span>{current.typeExample ? "Select a method, then click Next." : "Take a look, then click Next to continue."}</span>
            </div>
          </div>
        )}

        {/* Click hint — before click or after click with suggestion */}
        {current.action === "click" && !waitingForDialog && (
          <div className="mb-4 flex items-center gap-2 rounded-md bg-primary/15 border border-primary/30 px-3 py-2.5 text-xs text-primary animate-pulse">
            <MousePointer2 className="h-4 w-4 shrink-0" />
            <div>
              <span className="font-medium">Click the highlighted button to continue</span>
              <br />
              <span className="text-primary/70">点击高亮按钮继续</span>
            </div>
          </div>
        )}
        {current.action === "click" && waitingForDialog && (
          <div className="mb-4 space-y-2">
            {current.prefillValue && (
              <div className="flex flex-col gap-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 px-3 py-2.5">
                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                  Sample pre-filled / 已预填示例:
                </span>
                <code className="font-mono text-xs font-bold text-primary select-all break-all">
                  {current.prefillValue}
                </code>
              </div>
            )}
            <div className="flex items-center gap-2 rounded-md bg-green-500/10 border border-green-500/20 px-3 py-2 text-xs text-green-600 dark:text-green-400">
              <span>The installer is open! Try it out, then click Next.</span>
            </div>
          </div>
        )}

        {/* Progress dots +nav */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-200",
                  i === step
                    ? "w-4 bg-primary"
                    : i < step
                      ? "w-1.5 bg-primary/50"
                      : "w-1.5 bg-muted-foreground/30"
                )}
              />
            ))}
          </div>
          {showNextBtn && (
            <button
              type="button"
              onClick={advance}
              className={cn(
                "flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                isLast
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : blinkNext
                    ? "bg-primary text-primary-foreground hover:bg-primary/90 animate-pulse shadow-[0_0_12px_2px_oklch(0.7_0.15_250/0.5)]"
                    : "bg-accent text-foreground hover:bg-accent/80"
              )}
            >
              {isLast ? "Get Started" : "Next"}
              {!isLast && <ChevronRight className="h-3 w-3" />}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
