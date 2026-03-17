import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  dockerContainerAction,
  dockerContainerInspect,
  dockerContainerLogs,
  dockerRunContainer,
  dockerTerminal,
  getDockerOverview,
  listDockerContexts,
  listDockerContainers,
  listDockerImages,
  startDockerProvider,
  useDockerContext,
  type DockerContainerSummary,
  type DockerContextSummary,
  type DockerEnvVar,
  type DockerImageSummary,
  type DockerOverview,
  type DockerPortBinding,
  type DockerRunRequest,
  type DockerTerminalResult,
} from "@/lib/docker";

type DockerView = "overview" | "containers" | "launch" | "terminal";
type LaunchPreset = "custom" | "redis" | "pulsar";
type NoticeTone = "success" | "info";
type ContainerDetailTab = "logs" | "inspect";
type SortDirection = "asc" | "desc";
type ContainerSortKey = "name" | "image" | "state" | "ports" | "runningFor";
type ContextSortKey = "name" | "providerLabel" | "dockerEndpoint" | "active";
type ImageSortKey = "repository" | "tag" | "size" | "createdSince";

const VIEW_OPTIONS: { id: DockerView; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "containers", label: "Containers" },
  { id: "launch", label: "Launch" },
  { id: "terminal", label: "Terminal" },
];

const QUICK_COMMANDS = [
  "docker context ls",
  "docker ps -a",
  "docker images",
  "docker pull redis:7-alpine",
  "docker pull apachepulsar/pulsar:latest",
];

function createEmptyPort(): DockerPortBinding {
  return { hostPort: "", containerPort: "", protocol: "tcp" };
}

function createEmptyEnv(): DockerEnvVar {
  return { key: "", value: "" };
}

function getPresetConfig(preset: LaunchPreset): DockerRunRequest {
  if (preset === "redis") {
    return {
      image: "redis:7-alpine",
      name: "redis",
      ports: [{ hostPort: "6379", containerPort: "6379", protocol: "tcp" }],
      environment: [],
      command: "",
      restartPolicy: "unless-stopped",
    };
  }

  if (preset === "pulsar") {
    return {
      image: "apachepulsar/pulsar:latest",
      name: "pulsar",
      ports: [
        { hostPort: "6650", containerPort: "6650", protocol: "tcp" },
        { hostPort: "8080", containerPort: "8080", protocol: "tcp" },
      ],
      environment: [],
      command: "bin/pulsar standalone",
      restartPolicy: "unless-stopped",
    };
  }

  return {
    image: "",
    name: "",
    ports: [createEmptyPort()],
    environment: [createEmptyEnv()],
    command: "",
    restartPolicy: "unless-stopped",
  };
}

function isFeaturedContainer(container: DockerContainerSummary, keyword: string): boolean {
  const haystack = `${container.name} ${container.image}`.toLowerCase();
  return haystack.includes(keyword);
}

function normalizeContainerRows(items: DockerContainerSummary[]): DockerContainerSummary[] {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

function copyText(value: string) {
  void navigator.clipboard.writeText(value);
}

function fuzzyMatch(text: string, query: string): boolean {
  const normalizedText = text.toLowerCase();
  const tokens = query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) {
    return true;
  }

  return tokens.every((token) => {
    if (normalizedText.includes(token)) {
      return true;
    }

    let tokenIndex = 0;
    for (const char of normalizedText) {
      if (char === token[tokenIndex]) {
        tokenIndex += 1;
        if (tokenIndex === token.length) {
          return true;
        }
      }
    }

    return false;
  });
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function applyDirection(value: number, direction: SortDirection): number {
  return direction === "asc" ? value : value * -1;
}

function nextSortDirection(currentKey: string, targetKey: string, currentDirection: SortDirection): SortDirection {
  if (currentKey !== targetKey) {
    return "asc";
  }
  return currentDirection === "asc" ? "desc" : "asc";
}

function renderSortLabel(active: boolean, direction: SortDirection): string {
  if (!active) return "↕";
  return direction === "asc" ? "↑" : "↓";
}

function isRunningContainer(container: DockerContainerSummary): boolean {
  return container.state.trim().toLowerCase() === "running";
}

function getContainerStatusClasses(container: DockerContainerSummary): string {
  const state = container.state.trim().toLowerCase();

  if (state === "running") {
    return "border-emerald-500/30 bg-emerald-500/8";
  }

  if (state === "restarting" || state === "paused") {
    return "border-amber-500/30 bg-amber-500/8";
  }

  return "border-border bg-background/60";
}

function getContainerBadgeClasses(container: DockerContainerSummary): string {
  const state = container.state.trim().toLowerCase();

  if (state === "running") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  }

  if (state === "restarting" || state === "paused") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  }

  return "border-border bg-muted/50 text-muted-foreground";
}

export function DockerWorkspace() {
  const [view, setView] = useState<DockerView>("overview");
  const [overview, setOverview] = useState<DockerOverview | null>(null);
  const [contexts, setContexts] = useState<DockerContextSummary[]>([]);
  const [selectedContextName, setSelectedContextName] = useState("");
  const [containers, setContainers] = useState<DockerContainerSummary[]>([]);
  const [images, setImages] = useState<DockerImageSummary[]>([]);
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const [inspectJson, setInspectJson] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [containerSearch, setContainerSearch] = useState("");
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [containerDetailTab, setContainerDetailTab] = useState<ContainerDetailTab>("logs");
  const [launchPreset, setLaunchPreset] = useState<LaunchPreset>("custom");
  const [launchRequest, setLaunchRequest] = useState<DockerRunRequest>(getPresetConfig("custom"));
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState("");
  const [terminalCommand, setTerminalCommand] = useState("");
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [terminalHistory, setTerminalHistory] = useState<DockerTerminalResult[]>([]);
  const [startingProvider, setStartingProvider] = useState(false);
  const [switchingContext, setSwitchingContext] = useState(false);
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [containerSort, setContainerSort] = useState<{ key: ContainerSortKey; direction: SortDirection }>({
    key: "name",
    direction: "asc",
  });
  const [contextSort, setContextSort] = useState<{ key: ContextSortKey; direction: SortDirection }>({
    key: "name",
    direction: "asc",
  });
  const [imageSort, setImageSort] = useState<{ key: ImageSortKey; direction: SortDirection }>({
    key: "repository",
    direction: "asc",
  });

  const refreshData = useCallback(async () => {
    setRefreshing(true);
    setError("");

    const [overviewResult, contextsResult, containerResult, imageResult] = await Promise.allSettled([
      getDockerOverview(),
      listDockerContexts(),
      listDockerContainers(true),
      listDockerImages(),
    ]);

    let nextError = "";

    if (overviewResult.status === "fulfilled") {
      setOverview(overviewResult.value);
      if (!overviewResult.value.available && overviewResult.value.error) {
        nextError = overviewResult.value.error;
      }
    } else {
      setOverview(null);
      nextError = overviewResult.reason instanceof Error ? overviewResult.reason.message : String(overviewResult.reason);
    }

    if (contextsResult.status === "fulfilled") {
      const nextContexts = contextsResult.value;
      setContexts(nextContexts);
      setSelectedContextName((current) => {
        if (current && nextContexts.some((context) => context.name === current)) {
          return current;
        }
        return nextContexts.find((context) => context.active)?.name ?? nextContexts[0]?.name ?? "";
      });
    } else {
      setContexts([]);
      if (!nextError) {
        nextError =
          contextsResult.reason instanceof Error ? contextsResult.reason.message : String(contextsResult.reason);
      }
    }

    if (containerResult.status === "fulfilled") {
      const normalizedContainers = normalizeContainerRows(containerResult.value);
      setContainers(normalizedContainers);

      if (selectedContainerId && !normalizedContainers.some((item) => item.id === selectedContainerId)) {
        setSelectedContainerId(null);
      }
    } else {
      setContainers([]);
      setSelectedContainerId(null);
      if (!nextError && overviewResult.status === "fulfilled" && overviewResult.value.available) {
        nextError =
          containerResult.reason instanceof Error ? containerResult.reason.message : String(containerResult.reason);
      }
    }

    if (imageResult.status === "fulfilled") {
      setImages(imageResult.value);
    } else {
      setImages([]);
      if (!nextError && overviewResult.status === "fulfilled" && overviewResult.value.available) {
        nextError = imageResult.reason instanceof Error ? imageResult.reason.message : String(imageResult.reason);
      }
    }

    setError(nextError);
    setLoading(false);
    setRefreshing(false);
  }, [selectedContainerId]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    if (!overview?.available || !selectedContainerId) {
      setLogs("");
      setInspectJson("");
      return;
    }

    let cancelled = false;

    const loadContainerDetails = async () => {
      try {
        const [nextLogs, nextInspect] = await Promise.all([
          dockerContainerLogs(selectedContainerId, 200),
          dockerContainerInspect(selectedContainerId),
        ]);

        if (cancelled) return;
        setLogs(nextLogs);
        setInspectJson(nextInspect);
      } catch (reason) {
        if (cancelled) return;
        const message = reason instanceof Error ? reason.message : String(reason);
        setLogs(message);
        setInspectJson(message);
      }
    };

    void loadContainerDetails();

    return () => {
      cancelled = true;
    };
  }, [overview?.available, selectedContainerId, refreshing]);

  const activeContext = useMemo(
    () => contexts.find((context) => context.active) ?? null,
    [contexts],
  );

  const selectedContext = useMemo(
    () => {
      if (!selectedContextName) {
        return activeContext;
      }
      return contexts.find((context) => context.name === selectedContextName) ?? null;
    },
    [activeContext, contexts, selectedContextName],
  );

  const startButtonLabel = useMemo(() => {
    if (!selectedContext?.canStartProvider) {
      return "Start provider";
    }
    return `Start ${selectedContext.providerLabel}`;
  }, [selectedContext]);

  const canSwitchContext = Boolean(
    selectedContext && (!activeContext || selectedContext.name !== activeContext.name),
  );

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!autoRefresh) return;
    const intervalId = window.setInterval(() => {
      void refreshData();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [autoRefresh, refreshData]);

  const handleStartProvider = useCallback(async () => {
    if (!selectedContext) return;

    setStartingProvider(true);
    setNotice(null);
    setError("");

    try {
      const message = await startDockerProvider(selectedContext.name);
      setNotice({ tone: "success", text: message });
      await refreshData();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
    } finally {
      setStartingProvider(false);
    }
  }, [refreshData, selectedContext]);

  const handleUseContext = useCallback(async () => {
    if (!selectedContext) return;

    setSwitchingContext(true);
    setNotice(null);
    setError("");

    try {
      const message = await useDockerContext(selectedContext.name);
      setNotice({ tone: "info", text: message });
      await refreshData();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
    } finally {
      setSwitchingContext(false);
    }
  }, [refreshData, selectedContext]);

  const handleContainerSort = useCallback((key: ContainerSortKey) => {
    setContainerSort((current) => ({
      key,
      direction: nextSortDirection(current.key, key, current.direction),
    }));
  }, []);

  const handleContextSort = useCallback((key: ContextSortKey) => {
    setContextSort((current) => ({
      key,
      direction: nextSortDirection(current.key, key, current.direction),
    }));
  }, []);

  const handleImageSort = useCallback((key: ImageSortKey) => {
    setImageSort((current) => ({
      key,
      direction: nextSortDirection(current.key, key, current.direction),
    }));
  }, []);

  const filteredContainers = useMemo(() => {
    if (!containerSearch.trim()) return containers;
    const query = containerSearch.trim();
    return containers.filter((container) =>
      fuzzyMatch(
        `${container.name} ${container.image} ${container.status} ${container.state} ${container.ports} ${container.id}`,
        query,
      ),
    );
  }, [containerSearch, containers]);

  const sortedContainers = useMemo(() => {
    return [...filteredContainers].sort((left, right) => {
      let result = 0;

      switch (containerSort.key) {
        case "image":
          result = compareText(left.image, right.image);
          break;
        case "state":
          result = compareText(left.state, right.state);
          break;
        case "ports":
          result = compareText(left.ports, right.ports);
          break;
        case "runningFor":
          result = compareText(left.runningFor, right.runningFor);
          break;
        case "name":
        default:
          result = compareText(left.name, right.name);
          break;
      }

      return applyDirection(result, containerSort.direction);
    });
  }, [containerSort.direction, containerSort.key, filteredContainers]);

  const selectedContainer = useMemo(
    () => containers.find((container) => container.id === selectedContainerId) ?? null,
    [containers, selectedContainerId],
  );

  const showContainerDetails = Boolean(selectedContainer);

  const featuredContainers = useMemo(
    () => ({
      redis: containers.find((container) => isFeaturedContainer(container, "redis")) ?? null,
      pulsar: containers.find((container) => isFeaturedContainer(container, "pulsar")) ?? null,
    }),
    [containers],
  );

  const overviewServices = useMemo(
    () => [
      { label: "Redis", preset: "redis" as const, container: featuredContainers.redis },
      { label: "Pulsar", preset: "pulsar" as const, container: featuredContainers.pulsar },
    ],
    [featuredContainers],
  );

  const sortedContexts = useMemo(() => {
    return [...contexts].sort((left, right) => {
      let result = 0;

      switch (contextSort.key) {
        case "providerLabel":
          result = compareText(left.providerLabel, right.providerLabel);
          break;
        case "dockerEndpoint":
          result = compareText(left.dockerEndpoint, right.dockerEndpoint);
          break;
        case "active":
          result = Number(left.active) - Number(right.active);
          break;
        case "name":
        default:
          result = compareText(left.name, right.name);
          break;
      }

      return applyDirection(result, contextSort.direction);
    });
  }, [contextSort.direction, contextSort.key, contexts]);

  const imageSuggestions = useMemo(
    () =>
      images
        .slice(0, 12)
        .map((image) => `${image.repository}:${image.tag}`)
        .filter((value) => !value.startsWith("<none>")),
    [images],
  );

  const sortedImages = useMemo(() => {
    return [...images].sort((left, right) => {
      let result = 0;

      switch (imageSort.key) {
        case "tag":
          result = compareText(left.tag, right.tag);
          break;
        case "size":
          result = compareText(left.size, right.size);
          break;
        case "createdSince":
          result = compareText(left.createdSince, right.createdSince);
          break;
        case "repository":
        default:
          result = compareText(left.repository, right.repository);
          break;
      }

      return applyDirection(result, imageSort.direction);
    });
  }, [imageSort.direction, imageSort.key, images]);

  const handleContainerAction = useCallback(
    async (containerId: string, action: "start" | "stop" | "restart" | "remove") => {
      setActiveAction(`${containerId}:${action}`);
      setOpenActionMenuId(null);
      setNotice(null);
      setError("");

      try {
        const result = await dockerContainerAction(containerId, action);
        setNotice({
          tone: "success",
          text: result || `Container ${action} completed.`,
        });
        await refreshData();
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        setError(message);
      } finally {
        setActiveAction(null);
      }
    },
    [refreshData],
  );

  const handlePresetChange = (preset: LaunchPreset) => {
    setLaunchPreset(preset);
    setLaunchRequest(getPresetConfig(preset));
    setLaunchResult("");
  };

  const updatePort = (index: number, patch: Partial<DockerPortBinding>) => {
    setLaunchRequest((current) => {
      const next = [...current.ports];
      next[index] = { ...next[index], ...patch };
      return { ...current, ports: next };
    });
  };

  const updateEnv = (index: number, patch: Partial<DockerEnvVar>) => {
    setLaunchRequest((current) => {
      const next = [...current.environment];
      next[index] = { ...next[index], ...patch };
      return { ...current, environment: next };
    });
  };

  const handleLaunch = async () => {
    setLaunching(true);
    setLaunchResult("");
    setNotice(null);
    setError("");

    try {
      const result = await dockerRunContainer(launchRequest);
      setLaunchResult(result || "Container launched.");
      setNotice({
        tone: "success",
        text: `Container launched: ${result || launchRequest.name || launchRequest.image}`,
      });
      await refreshData();
      setView("containers");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
    } finally {
      setLaunching(false);
    }
  };

  const handleRunTerminal = async (command: string) => {
    if (!command.trim()) return;

    setTerminalBusy(true);
    setNotice(null);
    setError("");
    try {
      const result = await dockerTerminal(command);
      setTerminalHistory((current) => [result, ...current]);
      setTerminalCommand("");
      if (result.success) {
        setNotice({
          tone: "success",
          text: `Command completed: ${result.command}`,
        });
      }
      await refreshData();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
    } finally {
      setTerminalBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-border bg-card px-5 py-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Docker</h1>
          <p className="text-xs text-muted-foreground">
            Manage Docker contexts, containers, launch common services, and run Docker commands.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="min-w-[240px]">
            <Input
              list="docker-context-options"
              value={selectedContextName}
              onChange={(event) => setSelectedContextName(event.target.value)}
              placeholder="Docker context"
            />
            <datalist id="docker-context-options">
              {contexts.map((context) => (
                <option key={context.name} value={context.name}>
                  {context.providerLabel}
                </option>
              ))}
            </datalist>
          </div>

          <Button variant="outline" size="sm" onClick={() => void handleUseContext()} disabled={!canSwitchContext || switchingContext}>
            {switchingContext ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Use context
          </Button>

          <Button
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh((current) => !current)}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", autoRefresh && "animate-spin")} />
            Auto refresh {autoRefresh ? "on" : "off"}
          </Button>

          {VIEW_OPTIONS.map((option) => (
            <Button
              key={option.id}
              variant={view === option.id ? "default" : "outline"}
              size="sm"
              onClick={() => setView(option.id)}
            >
              {option.label}
            </Button>
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refreshData();
            }}
            disabled={refreshing}
          >
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading Docker module...
          </div>
        ) : (
          <div className="space-y-5">
            {notice && (
              <div
                className={cn(
                  "rounded-2xl border px-4 py-3 text-sm",
                  notice.tone === "success"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
                )}
              >
                <div className="flex items-start gap-3">
                  {notice.tone === "success" ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4" />
                  ) : (
                    <Info className="mt-0.5 h-4 w-4" />
                  )}
                  <div>{notice.text}</div>
                </div>
              </div>
            )}

            {activeContext?.provider === "docker-desktop" && (
              <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                Current active context is <span className="font-medium text-foreground">{activeContext.name}</span>,
                so start/connect actions will still use <span className="font-medium text-foreground">Docker Desktop</span>.
                If you want Colima or another provider, create/switch to that Docker context first.
              </div>
            )}

            {!overview?.available && (
              <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-foreground">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                  <div>
                    <div className="font-medium">Docker provider is offline</div>
                    <div className="mt-1 text-muted-foreground">
                      {overview?.error || error || "Start a Docker provider or switch to a running context."}
                    </div>
                    {(selectedContext || overview?.context || overview?.contextEndpoint) && (
                      <div className="mt-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                        <div>
                          Context: <span className="font-medium text-foreground">{selectedContext?.name || overview?.context || "unknown"}</span>
                        </div>
                        <div className="mt-1">
                          Provider: <span className="font-medium text-foreground">{selectedContext?.providerLabel || overview?.providerLabel || "Unknown Provider"}</span>
                        </div>
                        <div className="mt-1 break-all">
                          Endpoint: {selectedContext?.dockerEndpoint || overview?.contextEndpoint || "Unavailable"}
                        </div>
                      </div>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {selectedContext?.canStartProvider && (
                        <Button
                          size="sm"
                          onClick={() => {
                            void handleStartProvider();
                          }}
                          disabled={startingProvider}
                        >
                          {startingProvider ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Play className="h-3.5 w-3.5" />
                          )}
                          {startButtonLabel}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          void refreshData();
                        }}
                        disabled={refreshing}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                        Retry
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {error && overview?.available && (
              <div className="rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}

            {view === "overview" && (
              <div className="space-y-5">
                <div className="grid gap-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.4fr)]">
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Status</div>
                    <div className="mt-2 text-lg font-semibold text-foreground">
                      {overview?.available ? "Connected" : "Offline"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Context</div>
                    <div className="mt-2 text-lg font-semibold text-foreground">
                      {activeContext?.name || overview?.context || "Unavailable"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Provider</div>
                    <div className="mt-2 text-lg font-semibold text-foreground">
                      {activeContext?.providerLabel || overview?.providerLabel || "Unknown"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Running</div>
                    <div className="mt-2 text-lg font-semibold text-foreground">
                      {overview?.runningContainers ?? 0}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      {overview?.available ? "Docker" : "Endpoint"}
                    </div>
                    <div className="mt-2 text-lg font-semibold text-foreground">
                      {overview?.available ? overview?.serverVersion || "Unknown" : activeContext?.dockerEndpoint || overview?.contextEndpoint || "Unavailable"}
                    </div>
                    {!overview?.available && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        Containers remain saved in the provider, but Penguin cannot manage them while it is offline.
                      </div>
                    )}
                  </div>
                </div>

                {overview?.available && (
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">Connection</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Active endpoint for all container, image, launch, and terminal actions in this module.
                        </div>
                      </div>
                      <div className="rounded-full border border-border bg-background/70 px-3 py-1 text-xs text-muted-foreground">
                        {overview?.images ?? 0} images · {overview?.stoppedContainers ?? 0} stopped
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-[180px_1fr]">
                      <div className="rounded-xl border border-border bg-background/60 px-3 py-3">
                        <div className="text-xs uppercase tracking-wide text-muted-foreground">Endpoint</div>
                        <div className="mt-2 text-sm font-medium text-foreground">
                          {activeContext?.providerLabel || overview?.providerLabel || "Unknown"}
                        </div>
                      </div>
                      <div className="rounded-xl border border-border bg-background/60 px-3 py-3 text-sm text-muted-foreground">
                        <div className="break-all font-mono text-xs text-foreground">
                          {activeContext?.dockerEndpoint || overview?.contextEndpoint || "Unavailable"}
                        </div>
                        <div className="mt-2">
                          Switch Docker contexts above if you want to control a different provider such as Colima,
                          OrbStack, or a remote host.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">Live overview</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        New images and containers created in the active context show up here after `Refresh`.
                        Actions run inside Penguin refresh automatically, and auto refresh polls every 5 seconds when enabled.
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void refreshData()} disabled={refreshing}>
                      {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                      Refresh data
                    </Button>
                  </div>
                </div>

                {contexts.length > 0 && (
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">Available contexts</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Pick the provider you want Penguin to manage. Container actions always target the active context.
                        </div>
                      </div>
                      <div className="rounded-full border border-border bg-background/70 px-3 py-1 text-xs text-muted-foreground">
                        {contexts.length} context{contexts.length === 1 ? "" : "s"}
                      </div>
                    </div>

                    <div className="mt-4 overflow-hidden rounded-2xl border border-border">
                      <div className="grid grid-cols-[minmax(160px,0.9fr)_140px_minmax(280px,1.6fr)_120px] border-b border-border bg-muted/40 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        <button type="button" className="text-left" onClick={() => handleContextSort("name")}>
                          Context {renderSortLabel(contextSort.key === "name", contextSort.direction)}
                        </button>
                        <button type="button" className="text-left" onClick={() => handleContextSort("providerLabel")}>
                          Provider {renderSortLabel(contextSort.key === "providerLabel", contextSort.direction)}
                        </button>
                        <button type="button" className="text-left" onClick={() => handleContextSort("dockerEndpoint")}>
                          Endpoint {renderSortLabel(contextSort.key === "dockerEndpoint", contextSort.direction)}
                        </button>
                        <button type="button" className="text-left" onClick={() => handleContextSort("active")}>
                          Status {renderSortLabel(contextSort.key === "active", contextSort.direction)}
                        </button>
                      </div>

                      <div>
                        {sortedContexts.map((context) => (
                          <button
                            key={context.name}
                            type="button"
                            onClick={() => setSelectedContextName(context.name)}
                            className={cn(
                              "grid w-full grid-cols-[minmax(160px,0.9fr)_140px_minmax(280px,1.6fr)_120px] items-center gap-3 border-b px-4 py-3 text-left transition last:border-b-0",
                              selectedContext?.name === context.name
                                ? "bg-primary/5 ring-1 ring-inset ring-primary/40"
                                : "bg-background/60 hover:bg-muted/40",
                            )}
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-foreground">{context.name}</div>
                              <div className="mt-1 truncate text-[11px] text-muted-foreground">
                                {context.description || "Docker context"}
                              </div>
                            </div>
                            <div className="text-sm text-foreground">{context.providerLabel}</div>
                            <div className="truncate font-mono text-[11px] text-muted-foreground">
                              {context.dockerEndpoint}
                            </div>
                            <div>
                              <span
                                className={cn(
                                  "inline-flex rounded-full border px-2 py-1 text-[11px] font-medium",
                                  context.active
                                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                    : "border-border bg-muted/50 text-muted-foreground",
                                )}
                              >
                                {context.active ? "Active" : "Available"}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">Service snapshot</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Quick controls for the two services you said you care about first.
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setView("containers")}>
                      Open containers
                    </Button>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-2xl border border-border">
                    <div className="grid grid-cols-[120px_minmax(180px,1fr)_minmax(180px,1.2fr)_120px_150px_220px] border-b border-border bg-muted/40 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <div>Service</div>
                      <div>Container</div>
                      <div>Image</div>
                      <div>Status</div>
                      <div>Ports</div>
                      <div>Actions</div>
                    </div>

                    <div>
                      {overviewServices.map((item) => {
                        const serviceContainer = item.container;

                        return (
                          <div
                            key={item.label}
                            className={cn(
                              "grid grid-cols-[120px_minmax(180px,1fr)_minmax(180px,1.2fr)_120px_150px_220px] items-center gap-3 border-b px-4 py-3 last:border-b-0",
                              serviceContainer ? getContainerStatusClasses(serviceContainer) : "bg-background/60",
                            )}
                          >
                            <div className="text-sm font-semibold text-foreground">{item.label}</div>

                            <div className="min-w-0">
                              <div className="truncate text-sm text-foreground">
                                {serviceContainer?.name || "Not detected"}
                              </div>
                              <div className="mt-1 truncate text-[11px] text-muted-foreground">
                                {serviceContainer ? serviceContainer.id.slice(0, 12) : "Launch from preset if needed"}
                              </div>
                            </div>

                            <div className="truncate text-sm text-foreground">
                              {serviceContainer?.image || "—"}
                            </div>

                            <div>
                              <span
                                className={cn(
                                  "inline-flex rounded-full border px-2 py-1 text-[11px] font-medium",
                                  serviceContainer ? getContainerBadgeClasses(serviceContainer) : "border-border bg-muted/50 text-muted-foreground",
                                )}
                              >
                                {serviceContainer?.state || "missing"}
                              </span>
                            </div>

                            <div className="truncate text-xs text-muted-foreground">
                              {serviceContainer?.ports || "—"}
                            </div>

                            <div className="flex flex-wrap gap-1">
                              {serviceContainer ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      setSelectedContainerId(serviceContainer.id);
                                      setView("containers");
                                    }}
                                  >
                                    Open
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      void handleContainerAction(serviceContainer.id, "start");
                                    }}
                                    disabled={activeAction === `${serviceContainer.id}:start`}
                                  >
                                    <Play className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      void handleContainerAction(serviceContainer.id, "stop");
                                    }}
                                    disabled={activeAction === `${serviceContainer.id}:stop`}
                                  >
                                    <Square className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => {
                                      void handleContainerAction(serviceContainer.id, "restart");
                                    }}
                                    disabled={activeAction === `${serviceContainer.id}:restart`}
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    handlePresetChange(item.preset);
                                    setView("launch");
                                  }}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  Launch
                                </Button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-foreground">Recent images</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        New local images show here after refresh. Pick one to prefill the launch form.
                      </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setView("launch")}>
                      <Plus className="h-3.5 w-3.5" />
                      Launch container
                    </Button>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-2xl border border-border">
                    <div className="grid grid-cols-[minmax(220px,1.3fr)_120px_140px_150px_120px] border-b border-border bg-muted/40 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <button type="button" className="text-left" onClick={() => handleImageSort("repository")}>
                        Repository {renderSortLabel(imageSort.key === "repository", imageSort.direction)}
                      </button>
                      <button type="button" className="text-left" onClick={() => handleImageSort("tag")}>
                        Tag {renderSortLabel(imageSort.key === "tag", imageSort.direction)}
                      </button>
                      <button type="button" className="text-left" onClick={() => handleImageSort("size")}>
                        Size {renderSortLabel(imageSort.key === "size", imageSort.direction)}
                      </button>
                      <button type="button" className="text-left" onClick={() => handleImageSort("createdSince")}>
                        Created {renderSortLabel(imageSort.key === "createdSince", imageSort.direction)}
                      </button>
                      <div>Action</div>
                    </div>

                    <div>
                      {sortedImages.slice(0, 8).length === 0 ? (
                        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                          No local images found yet.
                        </div>
                      ) : (
                        sortedImages.slice(0, 8).map((image) => (
                          <div
                            key={`${image.id}-${image.repository}-${image.tag}`}
                            className="grid grid-cols-[minmax(220px,1.3fr)_120px_140px_150px_120px] items-center gap-3 border-b bg-background/60 px-4 py-3 last:border-b-0"
                          >
                            <div className="truncate text-sm text-foreground">{image.repository}</div>
                            <div className="truncate text-sm text-foreground">{image.tag}</div>
                            <div className="text-xs text-muted-foreground">{image.size}</div>
                            <div className="text-xs text-muted-foreground">{image.createdSince}</div>
                            <div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setLaunchRequest((current) => ({
                                    ...current,
                                    image: `${image.repository}:${image.tag}`,
                                  }));
                                  setView("launch");
                                }}
                              >
                                Use
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {view === "containers" && (
              <div
                className={cn(
                  "grid gap-5",
                  showContainerDetails
                    ? "xl:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]"
                    : "grid-cols-1",
                )}
              >
                <div className="flex min-h-[560px] flex-col rounded-2xl border border-border bg-card p-4 xl:h-[calc(100vh-17rem)]">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">Containers</div>
                      <div className="text-xs text-muted-foreground">
                        Start, stop, restart, inspect, or remove running services on{" "}
                        {activeContext?.name || overview?.context || "the active context"}.
                      </div>
                      {!showContainerDetails && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          Use `View` on a row only when you want logs or inspect details.
                        </div>
                      )}
                    </div>
                    <div className="relative w-56">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={containerSearch}
                        onChange={(event) => setContainerSearch(event.target.value)}
                        placeholder="Fuzzy search containers"
                        className="pl-8"
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex-1 overflow-hidden rounded-2xl border border-border">
                    <div className="grid grid-cols-[minmax(180px,1.25fr)_minmax(180px,1.15fr)_110px_120px_120px_210px] border-b border-border bg-muted/40 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      <button type="button" className="text-left" onClick={() => handleContainerSort("name")}>
                        Name {renderSortLabel(containerSort.key === "name", containerSort.direction)}
                      </button>
                      <button type="button" className="text-left" onClick={() => handleContainerSort("image")}>
                        Image {renderSortLabel(containerSort.key === "image", containerSort.direction)}
                      </button>
                      <button type="button" className="text-left" onClick={() => handleContainerSort("state")}>
                        Status {renderSortLabel(containerSort.key === "state", containerSort.direction)}
                      </button>
                      <button type="button" className="text-left" onClick={() => handleContainerSort("ports")}>
                        Ports {renderSortLabel(containerSort.key === "ports", containerSort.direction)}
                      </button>
                      <button type="button" className="text-left" onClick={() => handleContainerSort("runningFor")}>
                        Running {renderSortLabel(containerSort.key === "runningFor", containerSort.direction)}
                      </button>
                      <div>Actions</div>
                    </div>

                    <div className="h-full overflow-y-auto">
                      {sortedContainers.length === 0 ? (
                        <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                          No containers match the current filter.
                        </div>
                      ) : (
                        sortedContainers.map((container) => {
                          const isSelected = container.id === selectedContainerId;
                          const isRunning = isRunningContainer(container);

                          return (
                            <div
                              key={container.id}
                              className={cn(
                                "grid w-full grid-cols-[minmax(180px,1.25fr)_minmax(180px,1.15fr)_110px_120px_120px_210px] items-center gap-3 border-b px-4 py-3 text-left transition last:border-b-0",
                                getContainerStatusClasses(container),
                                isSelected && "ring-1 ring-inset ring-primary/40",
                                !isSelected && "hover:bg-muted/30",
                              )}
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-foreground">{container.name}</div>
                                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                                  {container.id.slice(0, 12)}
                                </div>
                              </div>

                              <div className="min-w-0">
                                <div className="truncate text-sm text-foreground">{container.image}</div>
                                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                                  {container.status}
                                </div>
                              </div>

                              <div>
                                <span
                                  className={cn(
                                    "inline-flex rounded-full border px-2 py-1 text-[11px] font-medium",
                                    getContainerBadgeClasses(container),
                                  )}
                                >
                                  {container.state}
                                </span>
                              </div>

                              <div className="truncate text-xs text-muted-foreground">
                                {container.ports || "—"}
                              </div>

                              <div className={cn("text-xs font-medium", isRunning ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                                {container.runningFor || "—"}
                              </div>

                              <div className="flex flex-wrap gap-1">
                                <Button
                                  size="sm"
                                  variant={isSelected ? "default" : "outline"}
                                  onClick={() => {
                                    setSelectedContainerId((current) =>
                                      current === container.id ? null : container.id,
                                    );
                                    setContainerDetailTab("logs");
                                    setOpenActionMenuId(null);
                                  }}
                                >
                                  {isSelected ? "Hide" : "View"}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    void handleContainerAction(
                                      container.id,
                                      isRunning ? "stop" : "start",
                                    );
                                  }}
                                  disabled={
                                    activeAction === `${container.id}:start` ||
                                    activeAction === `${container.id}:stop`
                                  }
                                >
                                  {isRunning ? (
                                    <Square className="h-3.5 w-3.5" />
                                  ) : (
                                    <Play className="h-3.5 w-3.5" />
                                  )}
                                  {isRunning ? "Stop" : "Start"}
                                </Button>
                                <Popover open={openActionMenuId === container.id}>
                                  <PopoverTrigger
                                    className={cn(
                                      "inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition hover:text-foreground",
                                      openActionMenuId === container.id && "border-primary/40 bg-primary/5 text-foreground",
                                    )}
                                    onClick={() =>
                                      setOpenActionMenuId((current) =>
                                        current === container.id ? null : container.id,
                                      )
                                    }
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </PopoverTrigger>
                                  <PopoverContent align="end" className="right-0 mt-2 w-36">
                                    <button
                                      type="button"
                                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-left text-foreground transition hover:bg-accent"
                                      onClick={() => {
                                        setOpenActionMenuId(null);
                                        void handleContainerAction(container.id, "restart");
                                      }}
                                    >
                                      <RotateCcw className="h-3.5 w-3.5" />
                                      Restart
                                    </button>
                                    <button
                                      type="button"
                                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-left text-foreground transition hover:bg-accent"
                                      onClick={() => {
                                        setOpenActionMenuId(null);
                                        setSelectedContainerId(container.id);
                                        setContainerDetailTab("inspect");
                                      }}
                                    >
                                      <Info className="h-3.5 w-3.5" />
                                      Inspect
                                    </button>
                                    <button
                                      type="button"
                                      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-left text-destructive transition hover:bg-destructive/10"
                                      onClick={() => {
                                        setOpenActionMenuId(null);
                                        void handleContainerAction(container.id, "remove");
                                      }}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      Remove
                                    </button>
                                  </PopoverContent>
                                </Popover>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>

                {showContainerDetails && (
                  <div className="flex min-h-[560px] flex-col rounded-2xl border border-border bg-card p-4 xl:h-[calc(100vh-17rem)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-foreground">
                        {selectedContainer?.name || "Container details"}
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {selectedContainer?.image || "Select a container row to inspect logs and metadata."}
                      </div>
                    </div>

                    {selectedContainer && (
                      <div className="flex flex-wrap gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void handleContainerAction(selectedContainer.id, "start");
                          }}
                          disabled={activeAction === `${selectedContainer.id}:start`}
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void handleContainerAction(selectedContainer.id, "stop");
                          }}
                          disabled={activeAction === `${selectedContainer.id}:stop`}
                        >
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            void handleContainerAction(selectedContainer.id, "restart");
                          }}
                          disabled={activeAction === `${selectedContainer.id}:restart`}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedContainerId(null)}
                        >
                          Hide
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-border bg-background/60 px-3 py-3">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">State</div>
                      <div className="mt-2">
                        {selectedContainer ? (
                          <span
                            className={cn(
                              "inline-flex rounded-full border px-2 py-1 text-[11px] font-medium",
                              getContainerBadgeClasses(selectedContainer),
                            )}
                          >
                            {selectedContainer.state}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-background/60 px-3 py-3">
                      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Ports</div>
                      <div className="mt-2 truncate text-sm text-foreground">
                        {selectedContainer?.ports || "—"}
                      </div>
                    </div>
                  </div>

                  <Tabs
                    value={containerDetailTab}
                    onValueChange={(value) => setContainerDetailTab(value as ContainerDetailTab)}
                    className="mt-4 flex min-h-0 flex-1"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <TabsList>
                        <TabsTrigger value="logs">Logs</TabsTrigger>
                        <TabsTrigger value="inspect">Inspect</TabsTrigger>
                      </TabsList>

                      {selectedContainer && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            copyText(containerDetailTab === "logs" ? logs : inspectJson)
                          }
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Copy {containerDetailTab}
                        </Button>
                      )}
                    </div>

                    <TabsContent value="logs" className="min-h-0 flex-1">
                      <div className="h-full overflow-hidden rounded-xl border border-border bg-background/70">
                        <pre className="h-full overflow-auto p-3 text-xs leading-5 text-muted-foreground">
                          {logs || "No logs loaded."}
                        </pre>
                      </div>
                    </TabsContent>

                    <TabsContent value="inspect" className="min-h-0 flex-1">
                      <div className="h-full overflow-hidden rounded-xl border border-border bg-background/70">
                        <pre className="h-full overflow-auto p-3 text-xs leading-5 text-muted-foreground">
                          {inspectJson || "No inspect data loaded."}
                        </pre>
                      </div>
                    </TabsContent>
                  </Tabs>
                  </div>
                )}
              </div>
            )}

            {view === "launch" && (
              <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="text-sm font-semibold text-foreground">Launch preset</div>
                  <div className="mt-3 grid gap-2">
                    {([
                      { id: "custom", label: "Custom", description: "Provide image, ports, env vars, and command." },
                      { id: "redis", label: "Redis", description: "redis:7-alpine on port 6379." },
                      { id: "pulsar", label: "Pulsar", description: "Standalone Pulsar with broker and admin ports." },
                    ] as const).map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handlePresetChange(preset.id)}
                        className={cn(
                          "rounded-2xl border px-4 py-3 text-left transition",
                          launchPreset === preset.id
                            ? "border-primary/40 bg-primary/5"
                            : "border-border bg-background/60 hover:border-primary/20",
                        )}
                      >
                        <div className="text-sm font-medium text-foreground">{preset.label}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{preset.description}</div>
                      </button>
                    ))}
                  </div>

                  <div className="mt-5 rounded-2xl border border-border bg-background/70 p-4">
                    <div className="text-sm font-semibold text-foreground">Available images</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {imageSuggestions.length > 0 ? (
                        imageSuggestions.map((value) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() =>
                              setLaunchRequest((current) => ({
                                ...current,
                                image: value,
                              }))
                            }
                            className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition hover:border-primary/20 hover:text-foreground"
                          >
                            {value}
                          </button>
                        ))
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          No local images found yet. Use the terminal to pull one.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Image</div>
                      <Input
                        value={launchRequest.image}
                        onChange={(event) =>
                          setLaunchRequest((current) => ({ ...current, image: event.target.value }))
                        }
                        placeholder="redis:7-alpine"
                      />
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Container name</div>
                      <Input
                        value={launchRequest.name ?? ""}
                        onChange={(event) =>
                          setLaunchRequest((current) => ({ ...current, name: event.target.value }))
                        }
                        placeholder="redis"
                      />
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Restart policy</div>
                      <Input
                        value={launchRequest.restartPolicy ?? ""}
                        onChange={(event) =>
                          setLaunchRequest((current) => ({
                            ...current,
                            restartPolicy: event.target.value,
                          }))
                        }
                        placeholder="unless-stopped"
                      />
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Command</div>
                      <Input
                        value={launchRequest.command ?? ""}
                        onChange={(event) =>
                          setLaunchRequest((current) => ({ ...current, command: event.target.value }))
                        }
                        placeholder="bin/pulsar standalone"
                      />
                    </div>
                  </div>

                  <div className="mt-5 grid gap-5 xl:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-background/70 p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-foreground">Port mappings</div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setLaunchRequest((current) => ({
                              ...current,
                              ports: [...current.ports, createEmptyPort()],
                            }))
                          }
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add
                        </Button>
                      </div>

                      <div className="mt-3 space-y-2">
                        {launchRequest.ports.map((port, index) => (
                          <div key={`port-${index}`} className="grid grid-cols-[1fr_1fr_90px_36px] gap-2">
                            <Input
                              value={port.hostPort}
                              onChange={(event) => updatePort(index, { hostPort: event.target.value })}
                              placeholder="Host"
                            />
                            <Input
                              value={port.containerPort}
                              onChange={(event) =>
                                updatePort(index, { containerPort: event.target.value })
                              }
                              placeholder="Container"
                            />
                            <Input
                              value={port.protocol ?? "tcp"}
                              onChange={(event) => updatePort(index, { protocol: event.target.value })}
                              placeholder="tcp"
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                setLaunchRequest((current) => ({
                                  ...current,
                                  ports: current.ports.filter((_, itemIndex) => itemIndex !== index),
                                }))
                              }
                              disabled={launchRequest.ports.length === 1}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-background/70 p-4">
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-semibold text-foreground">Environment</div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setLaunchRequest((current) => ({
                              ...current,
                              environment: [...current.environment, createEmptyEnv()],
                            }))
                          }
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add
                        </Button>
                      </div>

                      <div className="mt-3 space-y-2">
                        {launchRequest.environment.map((envVar, index) => (
                          <div key={`env-${index}`} className="grid grid-cols-[1fr_1fr_36px] gap-2">
                            <Input
                              value={envVar.key}
                              onChange={(event) => updateEnv(index, { key: event.target.value })}
                              placeholder="KEY"
                            />
                            <Input
                              value={envVar.value}
                              onChange={(event) => updateEnv(index, { value: event.target.value })}
                              placeholder="value"
                            />
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                setLaunchRequest((current) => ({
                                  ...current,
                                  environment: current.environment.filter((_, itemIndex) => itemIndex !== index),
                                }))
                              }
                              disabled={launchRequest.environment.length === 1}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-border bg-background/70 px-4 py-3">
                    <div className="text-sm text-muted-foreground">
                      Docker run uses detached mode and will pull the image if it is not present.
                    </div>
                    <Button onClick={() => void handleLaunch()} disabled={launching}>
                      {launching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                      Launch container
                    </Button>
                  </div>

                  {launchResult && (
                    <div className="mt-4 rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm text-foreground">
                      Launched: <span className="font-mono">{launchResult}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {view === "terminal" && (
              <div className="grid gap-5 xl:grid-cols-[0.75fr_1.25fr]">
                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="text-sm font-semibold text-foreground">Quick commands</div>
                  <div className="mt-3 space-y-2">
                    {QUICK_COMMANDS.map((command) => (
                      <button
                        key={command}
                        type="button"
                        onClick={() => {
                          setTerminalCommand(command);
                        }}
                        className="w-full rounded-2xl border border-border bg-background/70 px-4 py-3 text-left text-sm text-foreground transition hover:border-primary/20"
                      >
                        {command}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold text-foreground">Docker terminal</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Only Docker commands are allowed here. Commands run against{" "}
                        {activeContext?.name || overview?.context || "the active context"}.
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setTerminalHistory([])}
                    >
                      Clear
                    </Button>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <Input
                      value={terminalCommand}
                      onChange={(event) => setTerminalCommand(event.target.value)}
                      placeholder="docker pull redis:7-alpine"
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleRunTerminal(terminalCommand);
                        }
                      }}
                    />
                    <Button
                      onClick={() => void handleRunTerminal(terminalCommand)}
                      disabled={terminalBusy}
                    >
                      {terminalBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <TerminalSquare className="h-3.5 w-3.5" />
                      )}
                      Run
                    </Button>
                  </div>

                  <div className="mt-4 space-y-3">
                    {terminalHistory.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-border bg-background/50 px-4 py-10 text-center text-sm text-muted-foreground">
                        Run a Docker command to see output here.
                      </div>
                    ) : (
                      terminalHistory.map((entry, index) => (
                        <div key={`${entry.command}-${index}`} className="rounded-2xl border border-border bg-background/70 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="truncate font-mono text-sm text-foreground">{entry.command}</div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyText(`${entry.stdout}${entry.stderr}`)}
                            >
                              <Copy className="h-3.5 w-3.5" />
                              Copy
                            </Button>
                          </div>
                          <div className="mt-2 text-xs text-muted-foreground">
                            Exit code: {entry.exitCode} · {entry.success ? "success" : "failed"}
                          </div>
                          <pre className="mt-3 max-h-72 overflow-auto rounded-xl border border-border bg-card p-3 text-xs leading-5 text-muted-foreground">
                            {entry.stdout || entry.stderr || "(no output)"}
                          </pre>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
