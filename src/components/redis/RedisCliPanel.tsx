import { useEffect, useMemo, useRef, useState } from "react";
import { Eraser, Loader2, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { executeRedisCommand } from "@/lib/redis";
import { REDIS_COMMANDS } from "@/components/redis/redis-cli-commands";
import { cn } from "@/lib/utils";

interface RedisCliPanelProps {
  connectionId: string;
  currentDb: number;
  writeEnabled: boolean;
  onWriteBlocked?: () => void;
  onDbSelected?: (db: number) => void;
  onDataChanged?: () => Promise<void> | void;
}

interface CliHistoryEntry {
  id: string;
  command: string;
  response: string;
  isError: boolean;
}

const WRITE_COMMANDS = new Set([
  "APPEND",
  "DECR",
  "DECRBY",
  "DEL",
  "EXPIRE",
  "FLUSHALL",
  "FLUSHDB",
  "HDEL",
  "HSET",
  "INCR",
  "INCRBY",
  "LPUSH",
  "LREM",
  "MSET",
  "PERSIST",
  "RENAME",
  "RPUSH",
  "SADD",
  "SET",
  "SETEX",
  "SETNX",
  "SREM",
  "UNLINK",
  "ZADD",
  "ZREM",
]);

function nextId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function RedisCliPanel({
  connectionId,
  currentDb,
  writeEnabled,
  onWriteBlocked,
  onDbSelected,
  onDataChanged,
}: RedisCliPanelProps) {
  const [value, setValue] = useState("");
  const [entries, setEntries] = useState<CliHistoryEntry[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const firstWord = value.trimStart().split(/\s/)[0].toUpperCase();
  const hasArgs = value.trimStart().includes(" ");
  const suggestions = useMemo(() => {
    if (!firstWord || hasArgs) {
      return [];
    }
    return REDIS_COMMANDS.filter((item) => item.cmd.startsWith(firstWord)).slice(0, 10);
  }, [firstWord, hasArgs]);

  const activeHint = useMemo(() => {
    if (!hasArgs) {
      return null;
    }
    return REDIS_COMMANDS.find((item) => item.cmd === firstWord) ?? null;
  }, [firstWord, hasArgs]);

  const suggestionVisible = showSuggestions && suggestions.length > 0 && !hasArgs;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [suggestions.length]);

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: "smooth" });
  }, [entries.length]);

  useEffect(() => {
    if (!suggestionVisible || !listRef.current) {
      return;
    }
    const item = listRef.current.children[selectedSuggestionIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedSuggestionIndex, suggestionVisible]);

  const appendEntry = (command: string, response: string, isError: boolean) => {
    setEntries((current) => [...current, { id: nextId(), command, response, isError }]);
  };

  const acceptSuggestion = (command: string) => {
    setValue(`${command} `);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const submitCommand = async (rawCommand: string) => {
    const command = rawCommand.trim();
    if (!command) {
      return;
    }

    if (command.toUpperCase() === "CLEAR") {
      setEntries([]);
      setValue("");
      setShowSuggestions(false);
      setHistoryIndex(-1);
      return;
    }

    setLoading(true);
    setShowSuggestions(false);
    setCommandHistory((current) =>
      current[current.length - 1] === command ? current : [...current, command],
    );
    setHistoryIndex(-1);

    try {
      const [commandName, arg] = command.split(/\s+/, 2);
      const normalizedName = commandName.toUpperCase();
      const isWriteCommand = WRITE_COMMANDS.has(normalizedName);

      if (isWriteCommand && !writeEnabled) {
        onWriteBlocked?.();
        return;
      }

      const response = await executeRedisCommand(connectionId, command);
      appendEntry(command, response || "(empty response)", false);

      if (normalizedName === "SELECT" && arg) {
        const nextDb = Number(arg);
        if (Number.isInteger(nextDb) && nextDb >= 0) {
          onDbSelected?.(nextDb);
        }
      }

      if (isWriteCommand) {
        await Promise.resolve(onDataChanged?.());
      }
    } catch (error) {
      appendEntry(command, error instanceof Error ? error.message : String(error), true);
    } finally {
      setLoading(false);
      setValue("");
    }
  };

  const navigateHistory = (direction: "up" | "down") => {
    if (commandHistory.length === 0) {
      return;
    }

    if (direction === "up") {
      const nextIndex =
        historyIndex === -1 ? commandHistory.length - 1 : Math.max(historyIndex - 1, 0);
      setHistoryIndex(nextIndex);
      setValue(commandHistory[nextIndex]);
      return;
    }

    if (historyIndex === -1) {
      return;
    }

    if (historyIndex >= commandHistory.length - 1) {
      setHistoryIndex(-1);
      setValue("");
      return;
    }

    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    setValue(commandHistory[nextIndex]);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">Redis CLI</p>
            <p className="text-xs text-muted-foreground">Running against db{currentDb}</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEntries([])}>
          <Eraser className="h-4 w-4" />
          Clear
        </Button>
      </div>

      <div ref={outputRef} className="min-h-0 flex-1 overflow-y-auto bg-background/60 px-4 py-4">
        {entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-background/60 p-6 text-sm text-muted-foreground">
            Type a Redis command and press Enter. Use `CLEAR` to reset the console.
          </div>
        ) : (
          <div className="space-y-4 font-mono text-xs leading-6">
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-2xl border border-border bg-background/70 p-4">
                <div className="flex items-start gap-2">
                  <span className="text-primary">&gt;</span>
                  <span className="break-all font-semibold text-foreground">{entry.command}</span>
                </div>
                <pre
                  className={cn(
                    "mt-2 whitespace-pre-wrap pl-5",
                    entry.isError ? "text-rose-600 dark:text-rose-300" : "text-muted-foreground",
                  )}
                >
                  {entry.response}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border bg-muted/20 px-4 py-3">
        <div className="relative">
          {suggestionVisible && (
            <div
              ref={listRef}
              className="absolute bottom-full left-0 right-0 z-20 mb-2 max-h-56 overflow-y-auto rounded-2xl border border-border bg-popover p-2 shadow-xl"
            >
              {suggestions.map((suggestion, index) => (
                <button
                  key={suggestion.cmd}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left font-mono text-xs transition",
                    index === selectedSuggestionIndex
                      ? "bg-primary/10 text-primary"
                      : "text-foreground/80 hover:bg-accent/50",
                  )}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    acceptSuggestion(suggestion.cmd);
                  }}
                  onMouseEnter={() => setSelectedSuggestionIndex(index)}
                >
                  <span className="font-semibold">{suggestion.cmd}</span>
                  {suggestion.hint ? (
                    <span className="text-muted-foreground">{suggestion.hint}</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 rounded-2xl border border-input bg-background px-3 py-3">
            <span className="font-mono text-xs text-primary">&gt;</span>
            <div className="relative min-w-0 flex-1">
              <input
                ref={inputRef}
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setShowSuggestions(true);
                }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                onFocus={() => {
                  if (value && !hasArgs) {
                    setShowSuggestions(true);
                  }
                }}
                onKeyDown={(event) => {
                  if (suggestionVisible) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setSelectedSuggestionIndex((current) => Math.min(current + 1, suggestions.length - 1));
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setSelectedSuggestionIndex((current) => Math.max(current - 1, 0));
                      return;
                    }
                    if (event.key === "Tab" || event.key === "Enter") {
                      event.preventDefault();
                      acceptSuggestion(suggestions[selectedSuggestionIndex].cmd);
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setShowSuggestions(false);
                      return;
                    }
                  }

                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitCommand(value);
                    return;
                  }
                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    navigateHistory("up");
                    return;
                  }
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    navigateHistory("down");
                  }
                }}
                disabled={loading}
                className="w-full bg-transparent font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
                placeholder="Enter Redis command..."
                autoComplete="off"
                spellCheck={false}
              />
              {activeHint?.hint ? (
                <span className="pointer-events-none absolute right-0 top-0 font-mono text-[10px] text-muted-foreground/60">
                  {activeHint.hint}
                </span>
              ) : null}
            </div>
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
