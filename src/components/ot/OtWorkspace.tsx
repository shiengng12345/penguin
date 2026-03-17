import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Calculator,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coins,
  Copy,
  Eye,
  ExternalLink,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-shell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type OtDayKind = "workday" | "rest-day" | "public-holiday";
type OtViewTab = "calendar" | "records";
type OtDialogMode = "create" | "edit" | "view";

interface OtSettings {
  currency: string;
  hourlyRate: string;
  customTypes: string[];
}

interface OtEntry {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  isPublic: boolean;
  type: string;
  note: string;
  link: string;
  createdAt: number;
  updatedAt: number;
}

interface OtDraft {
  date: string;
  startTime: string;
  endTime: string;
  isPublic: boolean;
  type: string;
  note: string;
  link: string;
}

interface CalendarCell {
  date: string;
  day: number;
  inVisibleRange: boolean;
}

const OT_SETTINGS_STORAGE_KEY = "pengvi.ot.settings";
const OT_ENTRIES_STORAGE_KEY = "pengvi.ot.entries";

const OT_DAY_KIND_META: Record<
  OtDayKind,
  { label: string; multiplier: number; chipClassName: string }
> = {
  workday: {
    label: "Workday",
    multiplier: 1.5,
    chipClassName: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  "rest-day": {
    label: "Rest Day",
    multiplier: 2,
    chipClassName: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  "public-holiday": {
    label: "Public Holiday",
    multiplier: 3,
    chipClassName: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
};

const CURRENCY_OPTIONS = [
  { value: "RM", label: "RM" },
  { value: "SGD", label: "SGD" },
  { value: "USD", label: "USD" },
];

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hours = Math.floor(index / 2);
  const minutes = index % 2 === 0 ? "00" : "30";
  const value = `${String(hours).padStart(2, "0")}:${minutes}`;
  const twelveHour = hours % 12 || 12;
  const meridiem = hours < 12 ? "AM" : "PM";
  return {
    value,
    label: `${twelveHour}:${minutes} ${meridiem}`,
  };
});

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function formatLocalDateValue(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function formatLocalMonthValue(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}`;
}

function getTodayDate() {
  return formatLocalDateValue(new Date());
}

function getCurrentMonth() {
  return formatLocalMonthValue(new Date());
}

function createDefaultSettings(): OtSettings {
  return {
    currency: "RM",
    hourlyRate: "",
    customTypes: ["General"],
  };
}

function createDraft(settings: OtSettings): OtDraft {
  return {
    date: getTodayDate(),
    startTime: "18:00",
    endTime: "21:00",
    isPublic: false,
    type: settings.customTypes[0] ?? "General",
    note: "",
    link: "",
  };
}

function readStoredSettings() {
  if (typeof window === "undefined") {
    return createDefaultSettings();
  }

  try {
    const raw = window.localStorage.getItem(OT_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return createDefaultSettings();
    }

    const parsed = JSON.parse(raw) as Partial<OtSettings & { defaultType?: string }>;
    const customTypes = Array.isArray(parsed.customTypes)
      ? parsed.customTypes.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : typeof parsed.defaultType === "string" && parsed.defaultType.trim().length > 0
        ? [parsed.defaultType.trim()]
        : ["General"];

    return {
      currency: typeof parsed.currency === "string" && parsed.currency ? parsed.currency : "RM",
      hourlyRate: typeof parsed.hourlyRate === "string" ? parsed.hourlyRate : "",
      customTypes: Array.from(new Set(customTypes)),
    };
  } catch {
    return createDefaultSettings();
  }
}

function readStoredEntries() {
  if (typeof window === "undefined") {
    return [] as OtEntry[];
  }

  try {
    const raw = window.localStorage.getItem(OT_ENTRIES_STORAGE_KEY);
    if (!raw) {
      return [] as OtEntry[];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [] as OtEntry[];
    }

    return parsed.flatMap((entry) => {
      if (
        !entry ||
        typeof entry.id !== "string" ||
        typeof entry.date !== "string" ||
        typeof entry.startTime !== "string" ||
        typeof entry.endTime !== "string" ||
        typeof entry.createdAt !== "number" ||
        typeof entry.updatedAt !== "number"
      ) {
        return [];
      }

      const legacyType =
        entry.type === "workday" ||
        entry.type === "rest-day" ||
        entry.type === "public-holiday"
          ? (entry.type as OtDayKind)
          : null;

      return [
        {
          id: entry.id,
          date: entry.date,
          startTime: entry.startTime,
          endTime: entry.endTime,
          isPublic: legacyType === "public-holiday" || entry.isPublic === true,
          type:
            typeof entry.type === "string" &&
            entry.type.trim().length > 0 &&
            !["workday", "rest-day", "public-holiday"].includes(entry.type)
              ? entry.type.trim()
              : "General",
          note: typeof entry.note === "string" ? entry.note : "",
          link: typeof entry.link === "string" ? entry.link : "",
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        } satisfies OtEntry,
      ];
    });
  } catch {
    return [] as OtEntry[];
  }
}

function parseTimeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return 0;
  }
  return hours * 60 + minutes;
}

function calculateOtMinutes(startTime: string, endTime: string) {
  const start = parseTimeToMinutes(startTime);
  let end = parseTimeToMinutes(endTime);
  if (end <= start) {
    end += 24 * 60;
  }
  return Math.max(0, end - start);
}

function getOtDayKind(date: string, isPublic: boolean): OtDayKind {
  if (isPublic) {
    return "public-holiday";
  }

  const parsed = new Date(`${date}T00:00:00`);
  const day = parsed.getDay();
  return day === 0 || day === 6 ? "rest-day" : "workday";
}

function formatHours(minutes: number) {
  return (minutes / 60).toFixed(2);
}

function formatCurrency(amount: number, currency: string) {
  return `${currency} ${amount.toFixed(2)}`;
}

function createEntryId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getKnownTypes(settings: OtSettings, entries: OtEntry[]) {
  return Array.from(
    new Set(
      [...settings.customTypes, ...entries.map((entry) => entry.type)]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));
}

function getEntryEstimatedPay(entry: OtEntry, hourlyRate: number) {
  const minutes = calculateOtMinutes(entry.startTime, entry.endTime);
  const dayKind = getOtDayKind(entry.date, entry.isPublic);
  return (minutes / 60) * hourlyRate * OT_DAY_KIND_META[dayKind].multiplier;
}

function formatDisplayDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  return parsed.toLocaleDateString("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
  });
}

function getDateMonthStart(value: string) {
  return new Date(`${value.slice(0, 7)}-01T00:00:00`);
}

function shiftMonth(date: Date, offset: number) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function formatMonthHeader(date: Date) {
  return date.toLocaleDateString("en-MY", { month: "long", year: "numeric" });
}

function getOtCycleRange(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(year, monthNumber - 2, 26);
  const endExclusive = new Date(year, monthNumber - 1, 26);
  const endInclusive = new Date(endExclusive);
  endInclusive.setDate(endExclusive.getDate() - 1);

  return {
    start,
    endExclusive,
    endInclusive,
    startValue: formatLocalDateValue(start),
    endExclusiveValue: formatLocalDateValue(endExclusive),
    endInclusiveValue: formatLocalDateValue(endInclusive),
  };
}

function buildCalendarCells(start: Date, endExclusive: Date): CalendarCell[] {
  const gridStart = new Date(start);
  gridStart.setDate(start.getDate() - start.getDay());

  const endInclusive = new Date(endExclusive);
  endInclusive.setDate(endExclusive.getDate() - 1);

  const gridEnd = new Date(endInclusive);
  gridEnd.setDate(endInclusive.getDate() + (6 - endInclusive.getDay()));

  const days = Math.floor((gridEnd.getTime() - gridStart.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  return Array.from({ length: days }, (_, index) => {
    const current = new Date(gridStart);
    current.setDate(gridStart.getDate() + index);
    const currentValue = formatLocalDateValue(current);
    return {
      date: currentValue,
      day: current.getDate(),
      inVisibleRange: currentValue >= formatLocalDateValue(start) && currentValue < formatLocalDateValue(endExclusive),
    };
  });
}

function buildMonthCalendarCells(monthDate: Date): CalendarCell[] {
  const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const firstWeekday = start.getDay();
  const gridStart = new Date(start);
  gridStart.setDate(start.getDate() - firstWeekday);

  return Array.from({ length: 42 }, (_, index) => {
    const current = new Date(gridStart);
    current.setDate(gridStart.getDate() + index);
    return {
      date: formatLocalDateValue(current),
      day: current.getDate(),
      inVisibleRange: current.getMonth() === monthDate.getMonth(),
    };
  });
}

function buildCopyText(startTime: string, endTime: string, type: string, note: string, link: string) {
  const summary = `${startTime}-${endTime} : ${type.trim() || "-"} : ${note.trim() || "-"}`;
  const normalizedLink = link.trim();
  return normalizedLink ? `${summary}\n${normalizedLink}` : summary;
}

function getCycleEntries(entries: OtEntry[], startValue: string, endExclusiveValue: string) {
  return entries
    .filter((entry) => entry.date >= startValue && entry.date < endExclusiveValue)
    .sort((left, right) => {
      const leftKey = `${left.date}-${left.startTime}`;
      const rightKey = `${right.date}-${right.startTime}`;
      return rightKey.localeCompare(leftKey);
    });
}

function matchesFuzzy(value: string, query: string) {
  const normalizedValue = value.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  if (normalizedValue.includes(normalizedQuery)) {
    return true;
  }

  let queryIndex = 0;
  for (const character of normalizedValue) {
    if (character === normalizedQuery[queryIndex]) {
      queryIndex += 1;
      if (queryIndex === normalizedQuery.length) {
        return true;
      }
    }
  }

  return false;
}

function getEntrySearchText(entry: OtEntry) {
  return [
    entry.date,
    entry.startTime,
    entry.endTime,
    entry.type,
    entry.note,
    entry.link,
    OT_DAY_KIND_META[getOtDayKind(entry.date, entry.isPublic)].label,
  ].join(" ");
}

function OtDatePickerField({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => getDateMonthStart(value));
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisibleMonth(getDateMonthStart(value));
  }, [value]);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const cells = useMemo(() => buildMonthCalendarCells(visibleMonth), [visibleMonth]);
  const today = getTodayDate();

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 text-xs transition hover:bg-accent/40 disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => setOpen((current) => !current)}
      >
        <span className="truncate text-foreground">{formatDisplayDate(value)}</span>
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open ? (
        <div className="absolute left-1/2 z-50 mt-2 w-[250px] -translate-x-1/2 rounded-lg border border-border bg-popover p-3 shadow-xl animate-in fade-in-0 zoom-in-95">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setVisibleMonth((current) => shiftMonth(current, -1))}
              className="rounded-md p-1 transition hover:bg-accent"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <div className="text-[11px] font-medium text-foreground">{formatMonthHeader(visibleMonth)}</div>
            <button
              type="button"
              onClick={() => setVisibleMonth((current) => shiftMonth(current, 1))}
              className="rounded-md p-1 transition hover:bg-accent"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="text-center text-[10px] text-muted-foreground">
                {label}
              </div>
            ))}
            {cells.map((cell) => {
              const selected = cell.date === value;
              const isToday = cell.date === today;
              return (
                <button
                  key={cell.date}
                  type="button"
                  onClick={() => {
                    onChange(cell.date);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-8 items-center justify-center rounded-md text-[11px] transition",
                    cell.inVisibleRange ? "text-foreground" : "text-muted-foreground/50",
                    selected && "bg-primary text-primary-foreground hover:bg-primary/90",
                    !selected && "hover:bg-accent",
                    isToday && !selected && "border border-primary/40",
                  )}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function OtWorkspace() {
  const [settings, setSettings] = useState<OtSettings>(readStoredSettings);
  const [entries, setEntries] = useState<OtEntry[]>(readStoredEntries);
  const [activeTab, setActiveTab] = useState<OtViewTab>("calendar");
  const [selectedMonth, setSelectedMonth] = useState(getCurrentMonth);
  const [searchQuery, setSearchQuery] = useState("");
  const [dayTypeFilter, setDayTypeFilter] = useState<"all" | OtDayKind>("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<OtDialogMode>("create");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [selectedCalendarDate, setSelectedCalendarDate] = useState<string | null>(null);
  const [draft, setDraft] = useState<OtDraft>(() => createDraft(readStoredSettings()));
  const [draftError, setDraftError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(OT_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(OT_ENTRIES_STORAGE_KEY, JSON.stringify(entries));
  }, [entries]);

  useEffect(() => {
    if (!copyFeedback) {
      return;
    }
    const handle = window.setTimeout(() => setCopyFeedback(false), 1800);
    return () => window.clearTimeout(handle);
  }, [copyFeedback]);

  const hourlyRate = useMemo(() => {
    const parsed = Number(settings.hourlyRate);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }, [settings.hourlyRate]);

  const knownTypes = useMemo(() => getKnownTypes(settings, entries), [entries, settings]);

  const cycleRange = useMemo(() => getOtCycleRange(selectedMonth), [selectedMonth]);

  const monthEntries = useMemo(
    () => getCycleEntries(entries, cycleRange.startValue, cycleRange.endExclusiveValue),
    [cycleRange.endExclusiveValue, cycleRange.startValue, entries],
  );

  const filteredEntries = useMemo(() => {
    const query = searchQuery.trim();
    return monthEntries.filter((entry) => {
      const dayKind = getOtDayKind(entry.date, entry.isPublic);
      if (dayTypeFilter !== "all" && dayKind !== dayTypeFilter) {
        return false;
      }
      if (typeFilter !== "all" && entry.type !== typeFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      return matchesFuzzy(getEntrySearchText(entry), query);
    });
  }, [dayTypeFilter, monthEntries, searchQuery, typeFilter]);

  const calendarCells = useMemo(
    () => buildCalendarCells(cycleRange.start, cycleRange.endExclusive),
    [cycleRange.endExclusive, cycleRange.start],
  );

  const entriesByDate = useMemo(() => {
    const grouped = new Map<string, OtEntry[]>();
    for (const entry of monthEntries) {
      const bucket = grouped.get(entry.date) ?? [];
      bucket.push(entry);
      grouped.set(entry.date, bucket);
    }
    for (const [date, bucket] of grouped) {
      grouped.set(
        date,
        [...bucket].sort((left, right) => left.startTime.localeCompare(right.startTime)),
      );
    }
    return grouped;
  }, [monthEntries]);

  const selectedDateEntries = useMemo(() => {
    if (!selectedCalendarDate) {
      return [];
    }
    return entriesByDate.get(selectedCalendarDate) ?? [];
  }, [entriesByDate, selectedCalendarDate]);

  const summary = useMemo(() => {
    const totalMinutes = monthEntries.reduce(
      (sum, entry) => sum + calculateOtMinutes(entry.startTime, entry.endTime),
      0,
    );
    const payableHours = monthEntries.reduce((sum, entry) => {
      const dayKind = getOtDayKind(entry.date, entry.isPublic);
      return sum + (calculateOtMinutes(entry.startTime, entry.endTime) / 60) * OT_DAY_KIND_META[dayKind].multiplier;
    }, 0);
    const totalPay =
      hourlyRate == null
        ? null
        : monthEntries.reduce(
            (sum, entry) => sum + getEntryEstimatedPay(entry, hourlyRate),
            0,
          );

    return {
      totalMinutes,
      payableHours,
      totalPay,
      count: monthEntries.length,
    };
  }, [hourlyRate, monthEntries]);

  const dayBreakdown = useMemo(() => {
    return (Object.keys(OT_DAY_KIND_META) as OtDayKind[]).map((kind) => {
      const kindEntries = monthEntries.filter(
        (entry) => getOtDayKind(entry.date, entry.isPublic) === kind,
      );
      const totalMinutes = kindEntries.reduce(
        (sum, entry) => sum + calculateOtMinutes(entry.startTime, entry.endTime),
        0,
      );
      return {
        kind,
        count: kindEntries.length,
        totalMinutes,
      };
    });
  }, [monthEntries]);

  const currentMinutes = calculateOtMinutes(draft.startTime, draft.endTime);
  const currentDayKind = getOtDayKind(draft.date, draft.isPublic);
  const currentCopyText = buildCopyText(
    draft.startTime,
    draft.endTime,
    draft.type,
    draft.note,
    draft.link,
  );
  const currentEstimatedPay =
    hourlyRate == null
      ? null
      : (currentMinutes / 60) * hourlyRate * OT_DAY_KIND_META[currentDayKind].multiplier;
  const isReadOnlyDialog = dialogMode === "view";
  const dayTypeFilterOptions = useMemo(
    () => [
      { value: "all", label: "All Day Types" },
      ...(
        Object.entries(OT_DAY_KIND_META) as [OtDayKind, (typeof OT_DAY_KIND_META)[OtDayKind]][]
      ).map(([value, meta]) => ({
        value,
        label: meta.label,
      })),
    ],
    [],
  );
  const typeFilterOptions = useMemo(
    () => [
      { value: "all", label: "All Types" },
      ...knownTypes.map((value) => ({ value, label: value })),
    ],
    [knownTypes],
  );
  const selectedDateTotalMinutes = useMemo(
    () =>
      selectedDateEntries.reduce(
        (sum, entry) => sum + calculateOtMinutes(entry.startTime, entry.endTime),
        0,
      ),
    [selectedDateEntries],
  );

  useEffect(() => {
    if (
      selectedCalendarDate != null &&
      (selectedCalendarDate < cycleRange.startValue ||
        selectedCalendarDate >= cycleRange.endExclusiveValue)
    ) {
      setSelectedCalendarDate(null);
    }
  }, [cycleRange.endExclusiveValue, cycleRange.startValue, selectedCalendarDate]);

  const openCreateDialog = (dateOverride?: string) => {
    const nextDraft = createDraft(settings);
    setSelectedCalendarDate(null);
    setEditingEntryId(null);
    setDialogMode("create");
    setDraft(dateOverride ? { ...nextDraft, date: dateOverride } : nextDraft);
    setDraftError(null);
    setCopyFeedback(false);
    setDialogOpen(true);
  };

  const openEditDialog = (entry: OtEntry) => {
    setSelectedCalendarDate(null);
    setDialogMode("edit");
    setEditingEntryId(entry.id);
    setDraft({
      date: entry.date,
      startTime: entry.startTime,
      endTime: entry.endTime,
      isPublic: entry.isPublic,
      type: entry.type,
      note: entry.note,
      link: entry.link,
    });
    setDraftError(null);
    setCopyFeedback(false);
    setDialogOpen(true);
  };

  const openViewDialog = (entry: OtEntry) => {
    setSelectedCalendarDate(null);
    setDialogMode("view");
    setEditingEntryId(entry.id);
    setDraft({
      date: entry.date,
      startTime: entry.startTime,
      endTime: entry.endTime,
      isPublic: entry.isPublic,
      type: entry.type,
      note: entry.note,
      link: entry.link,
    });
    setDraftError(null);
    setCopyFeedback(false);
    setDialogOpen(true);
  };

  const saveEntry = () => {
    if (!draft.date || !draft.startTime || !draft.endTime) {
      setDraftError("Date, start time, and end time are required.");
      return;
    }

    if (!draft.type.trim()) {
      setDraftError("Type is required.");
      return;
    }

    if (draft.link.trim()) {
      try {
        new URL(draft.link.trim());
      } catch {
        setDraftError("Link must be a valid URL.");
        return;
      }
    }

    const now = Date.now();
    const nextEntry: OtEntry = {
      id: editingEntryId ?? createEntryId(),
      date: draft.date,
      startTime: draft.startTime,
      endTime: draft.endTime,
      isPublic: draft.isPublic,
      type: draft.type.trim(),
      note: draft.note.trim(),
      link: draft.link.trim(),
      createdAt: entries.find((entry) => entry.id === editingEntryId)?.createdAt ?? now,
      updatedAt: now,
    };

    setEntries((current) => {
      if (!editingEntryId) {
        return [nextEntry, ...current];
      }

      return current.map((entry) => (entry.id === editingEntryId ? nextEntry : entry));
    });
    setSettings((current) => ({
      ...current,
      customTypes: Array.from(new Set([...current.customTypes, nextEntry.type])),
    }));
    setDialogOpen(false);
    setDraftError(null);
  };

  const deleteEntry = (entry: OtEntry) => {
    if (!window.confirm(`Delete OT record for ${entry.date} ${entry.startTime}-${entry.endTime}?`)) {
      return;
    }

    setEntries((current) => current.filter((item) => item.id !== entry.id));
  };

  const copyDraftText = async () => {
    await navigator.clipboard.writeText(currentCopyText);
    setCopyFeedback(true);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4">
          <section className="rounded-2xl border border-border bg-card/90 p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300">
                    <Calculator className="h-4 w-4" />
                  </div>
                  <div>
                    <h1 className="text-sm font-semibold text-foreground">OT Calculator</h1>
                    <p className="text-[11px] text-muted-foreground">
                      Record OT, auto classify day type, and estimate payout.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="month"
                  value={selectedMonth}
                  onChange={(event) => setSelectedMonth(event.target.value)}
                  className="h-8 w-[140px] text-xs"
                />
                <Button size="sm" className="h-8 text-xs" onClick={() => openCreateDialog()}>
                  <Plus className="h-3.5 w-3.5" />
                  Add OT
                </Button>
              </div>
            </div>

            <div className="mt-4 grid gap-3 xl:grid-cols-[1.2fr_1fr]">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    <Clock3 className="h-3.5 w-3.5" />
                    Total OT
                  </div>
                  <div className="mt-2 text-lg font-semibold text-foreground">
                    {formatHours(summary.totalMinutes)}h
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {summary.count} record{summary.count === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    <Calculator className="h-3.5 w-3.5" />
                    Payable Hours
                  </div>
                  <div className="mt-2 text-lg font-semibold text-foreground">
                    {summary.payableHours.toFixed(2)}h
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Workday / rest day / public holiday
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    <Coins className="h-3.5 w-3.5" />
                    Estimated Payout
                  </div>
                  <div className="mt-2 text-lg font-semibold text-foreground">
                    {summary.totalPay == null
                      ? "—"
                      : formatCurrency(summary.totalPay, settings.currency)}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {hourlyRate == null
                      ? "Set hourly rate to estimate pay"
                      : `${settings.currency} ${hourlyRate.toFixed(2)}/hour`}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    Day Mix
                  </div>
                  <div className="mt-2 space-y-1">
                    {dayBreakdown.map((item) => (
                      <div key={item.kind} className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">{OT_DAY_KIND_META[item.kind].label}</span>
                        <span className="font-medium text-foreground">
                          {formatHours(item.totalMinutes)}h
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border bg-background/70 p-3">
                <h2 className="text-xs font-semibold text-foreground">Calculation Settings</h2>
                <p className="text-[11px] text-muted-foreground">
                  Weekend is treated as rest day. Tick public holiday manually per record.
                </p>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      Currency
                    </label>
                    <Select
                      value={settings.currency}
                      onChange={(event) =>
                        setSettings((current) => ({ ...current, currency: event.target.value }))
                      }
                      options={CURRENCY_OPTIONS}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      Hourly Rate
                    </label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={settings.hourlyRate}
                      onChange={(event) =>
                        setSettings((current) => ({ ...current, hourlyRate: event.target.value }))
                      }
                      className="h-8 text-xs"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                {knownTypes.length > 0 ? (
                  <div className="mt-3">
                    <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                      Known Types
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {knownTypes.map((type) => (
                        <span
                          key={type}
                          className="inline-flex rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {type}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card/90 shadow-sm">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as OtViewTab)}>
              <div className="border-b border-border px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">OT Workspace</h2>
                    <p className="text-[11px] text-muted-foreground">
                      {cycleRange.startValue} → {cycleRange.endExclusiveValue} · {monthEntries.length} record{monthEntries.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <TabsList className="h-8">
                    <TabsTrigger value="calendar" className="px-2.5 py-1 text-xs">
                      <CalendarDays className="mr-1.5 h-3.5 w-3.5" />
                      Calendar
                    </TabsTrigger>
                    <TabsTrigger value="records" className="px-2.5 py-1 text-xs">
                      <Clock3 className="mr-1.5 h-3.5 w-3.5" />
                      Records
                    </TabsTrigger>
                  </TabsList>
                </div>
              </div>

              <TabsContent value="calendar" className="mt-0 p-4">
                <div className="rounded-xl border border-border bg-background/70 p-3">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-foreground">
                        {cycleRange.startValue} → {cycleRange.endExclusiveValue}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        OT cycle view from 26th to next 26th
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => openCreateDialog(cycleRange.startValue)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add OT
                    </Button>
                  </div>

                  <div className="grid grid-cols-7 gap-2">
                    {WEEKDAY_LABELS.map((label) => (
                      <div
                        key={label}
                        className="px-2 text-center text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                      >
                        {label}
                      </div>
                    ))}
                    {calendarCells.map((cell) => {
                      const cellEntries = entriesByDate.get(cell.date) ?? [];
                      const totalMinutes = cellEntries.reduce(
                        (sum, entry) => sum + calculateOtMinutes(entry.startTime, entry.endTime),
                        0,
                      );
                      const cellDayKind = cellEntries.some((entry) => entry.isPublic)
                        ? "public-holiday"
                        : getOtDayKind(cell.date, false);
                      const isSelected = selectedCalendarDate === cell.date;
                      const isToday = cell.date === getTodayDate();

                      return (
                        <button
                          key={cell.date}
                          type="button"
                          disabled={!cell.inVisibleRange}
                          onClick={() => {
                            if (!cell.inVisibleRange) {
                              return;
                            }
                            setSelectedCalendarDate(cell.date);
                          }}
                          className={cn(
                            "flex min-h-[132px] flex-col rounded-xl border px-2.5 py-2 text-left transition disabled:cursor-default",
                            cell.inVisibleRange
                              ? "border-border bg-card hover:border-primary/40 hover:bg-accent/20"
                              : "border-border/50 bg-muted/10 text-muted-foreground/40 opacity-55",
                            cell.inVisibleRange &&
                              !isSelected &&
                              !isToday &&
                              cellDayKind === "workday" &&
                              "border-sky-400/30 bg-sky-500/[0.03]",
                            cell.inVisibleRange &&
                              !isSelected &&
                              !isToday &&
                              cellDayKind === "rest-day" &&
                              "border-amber-400/40 bg-amber-500/[0.05]",
                            cell.inVisibleRange &&
                              !isSelected &&
                              !isToday &&
                              cellDayKind === "public-holiday" &&
                              "border-rose-400/45 bg-rose-500/[0.06]",
                            isToday &&
                              cell.inVisibleRange &&
                              !isSelected &&
                              "border-emerald-400/60 bg-emerald-500/5 ring-1 ring-emerald-500/20",
                            isSelected && "border-primary bg-primary/5 ring-1 ring-primary/30",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "text-xs font-semibold",
                                  !cell.inVisibleRange && "text-muted-foreground/60",
                                )}
                              >
                                {cell.day}
                              </span>
                              {cell.inVisibleRange ? (
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 rounded-full",
                                    cellDayKind === "workday" && "bg-sky-500/80",
                                    cellDayKind === "rest-day" && "bg-amber-500/80",
                                    cellDayKind === "public-holiday" && "bg-rose-500/80",
                                  )}
                                />
                              ) : null}
                            </div>
                            {isToday ? (
                              <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">
                                Today
                              </span>
                            ) : null}
                          </div>
                            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
                              {!cell.inVisibleRange ? (
                                <span className="text-[10px] text-muted-foreground/50">Outside cycle</span>
                              ) : cellEntries.length === 0 ? (
                                <span className="text-[10px] text-muted-foreground/70">No OT</span>
                              ) : (
                              <>
                                {cellEntries.slice(0, 3).map((entry) => (
                                  <div
                                    key={entry.id}
                                    className="rounded-md bg-muted/50 px-2 py-1 text-[10px] text-foreground"
                                  >
                                    <div className="font-mono">{entry.startTime}–{entry.endTime}</div>
                                    <div className="truncate text-muted-foreground">{entry.type}</div>
                                  </div>
                                ))}
                                {cellEntries.length > 3 ? (
                                  <div className="text-[10px] text-muted-foreground">
                                    +{cellEntries.length - 3} more
                                  </div>
                                ) : null}
                              </>
                            )}
                          </div>
                          {cellEntries.length > 0 ? (
                            <div className="mt-2 text-[10px] text-muted-foreground">
                              {cellEntries.length} record{cellEntries.length === 1 ? "" : "s"} · {formatHours(totalMinutes)}h
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="records" className="mt-0">
                <div className="border-b border-border px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Fuzzy search date, type, note, link, time"
                      className="h-8 w-[260px] text-xs"
                    />
                    <Select
                      value={dayTypeFilter}
                      onChange={(event) => setDayTypeFilter(event.target.value as "all" | OtDayKind)}
                      options={dayTypeFilterOptions}
                      className="w-[170px]"
                    />
                    <Select
                      value={typeFilter}
                      onChange={(event) => setTypeFilter(event.target.value)}
                      options={typeFilterOptions}
                      className="w-[170px]"
                    />
                    {(searchQuery || dayTypeFilter !== "all" || typeFilter !== "all") ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs"
                        onClick={() => {
                          setSearchQuery("");
                          setDayTypeFilter("all");
                          setTypeFilter("all");
                        }}
                      >
                        Reset
                      </Button>
                    ) : null}
                  </div>
                </div>

                {filteredEntries.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <p className="text-sm font-medium text-foreground">No OT records found</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Adjust filters or add a new overtime record.
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2 font-medium">Date</th>
                          <th className="px-3 py-2 font-medium">Time</th>
                          <th className="px-3 py-2 font-medium">Day</th>
                          <th className="px-3 py-2 font-medium">Type</th>
                          <th className="px-3 py-2 font-medium">Hours</th>
                          <th className="px-3 py-2 font-medium">Pay</th>
                          <th className="px-3 py-2 font-medium">Link</th>
                          <th className="px-3 py-2 font-medium">Note</th>
                          <th className="px-4 py-2 text-right font-medium">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEntries.map((entry) => {
                          const minutes = calculateOtMinutes(entry.startTime, entry.endTime);
                          const dayKind = getOtDayKind(entry.date, entry.isPublic);
                          const estimatedPay =
                            hourlyRate == null ? null : getEntryEstimatedPay(entry, hourlyRate);

                          return (
                            <tr key={entry.id} className="border-b border-border/70 last:border-0">
                              <td className="px-4 py-2.5 text-foreground">{entry.date}</td>
                              <td className="px-3 py-2.5 font-mono text-[11px] text-foreground">
                                {entry.startTime} → {entry.endTime}
                              </td>
                              <td className="px-3 py-2.5">
                                <span
                                  className={cn(
                                    "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                                    OT_DAY_KIND_META[dayKind].chipClassName,
                                  )}
                                >
                                  {OT_DAY_KIND_META[dayKind].label}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-foreground">{entry.type}</td>
                              <td className="px-3 py-2.5 font-medium text-foreground">
                                {formatHours(minutes)}h
                              </td>
                              <td className="px-3 py-2.5 font-medium text-foreground">
                                {estimatedPay == null
                                  ? "—"
                                  : formatCurrency(estimatedPay, settings.currency)}
                              </td>
                              <td className="px-3 py-2.5">
                                {entry.link ? (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-[11px]"
                                    onClick={() => {
                                      void open(entry.link);
                                    }}
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                    Open
                                  </Button>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                              <td className="max-w-[280px] px-3 py-2.5 text-muted-foreground">
                                <span className="line-clamp-2 break-words">{entry.note || "—"}</span>
                              </td>
                              <td className="px-4 py-2.5">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-[11px]"
                                    onClick={() => openViewDialog(entry)}
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    View
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-[11px]"
                                    onClick={() => openEditDialog(entry)}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                    Edit
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-[11px] text-destructive hover:text-destructive"
                                    onClick={() => deleteEntry(entry)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </section>
        </div>
      </div>

      <Dialog open={selectedCalendarDate != null}>
        <DialogContent
          className="max-w-xl"
          onClose={() => setSelectedCalendarDate(null)}
        >
          <DialogHeader>
            <DialogTitle>
              {selectedCalendarDate ? formatDisplayDate(selectedCalendarDate) : "OT Records"}
            </DialogTitle>
          </DialogHeader>

          {selectedCalendarDate ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">
                  {selectedDateEntries.length} record{selectedDateEntries.length === 1 ? "" : "s"} · {formatHours(selectedDateTotalMinutes)}h
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => openCreateDialog(selectedCalendarDate)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add OT
                </Button>
              </div>

              {selectedDateEntries.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
                  <p className="text-sm font-medium text-foreground">No OT records on this date</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Add a record for {formatDisplayDate(selectedCalendarDate)}.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedDateEntries.map((entry) => {
                    const minutes = calculateOtMinutes(entry.startTime, entry.endTime);
                    const dayKind = getOtDayKind(entry.date, entry.isPublic);
                    const estimatedPay =
                      hourlyRate == null ? null : getEntryEstimatedPay(entry, hourlyRate);

                    return (
                      <div
                        key={entry.id}
                        className="rounded-xl border border-border bg-card px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs text-foreground">
                                {entry.startTime} → {entry.endTime}
                              </span>
                              <span
                                className={cn(
                                  "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                                  OT_DAY_KIND_META[dayKind].chipClassName,
                                )}
                              >
                                {OT_DAY_KIND_META[dayKind].label}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-foreground">{entry.type}</div>
                            {entry.note ? (
                              <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                                {entry.note}
                              </div>
                            ) : null}
                            <div className="mt-2 text-[11px] text-muted-foreground">
                              {formatHours(minutes)}h
                              {estimatedPay != null ? ` · ${formatCurrency(estimatedPay, settings.currency)}` : ""}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => openViewDialog(entry)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                              View
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => openEditDialog(entry)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[11px] text-destructive hover:text-destructive"
                              onClick={() => deleteEntry(entry)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen}>
        <DialogContent
          className="max-w-2xl"
          onClose={() => {
            setDialogOpen(false);
            setDraftError(null);
            setDialogMode("create");
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "view"
                ? "View OT Record"
                : editingEntryId
                  ? "Edit OT Record"
                  : "Add OT Record"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Date
              </label>
              <OtDatePickerField
                value={draft.date}
                onChange={(value) => setDraft((current) => ({ ...current, date: value }))}
                disabled={isReadOnlyDialog}
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Day Type
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-8 min-w-[118px] items-center rounded-md border border-input px-3 text-xs text-foreground">
                  {OT_DAY_KIND_META[currentDayKind].label}
                </div>
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    checked={draft.isPublic}
                    disabled={isReadOnlyDialog}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, isPublic: event.target.checked }))
                    }
                    className="h-4 w-4"
                  />
                  <span>Tick if this OT falls on a public holiday</span>
                </label>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Start Time
              </label>
              <Select
                value={draft.startTime}
                disabled={isReadOnlyDialog}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, startTime: event.target.value }))
                }
                options={TIME_OPTIONS}
                className="w-full"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                End Time
              </label>
              <Select
                value={draft.endTime}
                disabled={isReadOnlyDialog}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, endTime: event.target.value }))
                }
                options={TIME_OPTIONS}
                className="w-full"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Type
              </label>
              <Input
                value={draft.type}
                disabled={isReadOnlyDialog}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, type: event.target.value }))
                }
                className="h-8 text-xs"
                placeholder="General"
              />
              {knownTypes.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {knownTypes.slice(0, 8).map((type) => (
                    <button
                      key={type}
                      type="button"
                      disabled={isReadOnlyDialog}
                      onClick={() => setDraft((current) => ({ ...current, type }))}
                      className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {type}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Note
              </label>
              <textarea
                value={draft.note}
                readOnly={isReadOnlyDialog}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, note: event.target.value }))
                }
                rows={3}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder="Optional note"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                Link
              </label>
              <Input
                value={draft.link}
                disabled={isReadOnlyDialog}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, link: event.target.value }))
                }
                className="h-8 text-xs"
                placeholder="https://example.com/task-or-ticket"
              />
            </div>
            <div className="sm:col-span-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="block text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                  Copy Text
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => {
                    void copyDraftText();
                  }}
                >
                  {copyFeedback ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copyFeedback ? "Copied" : "Copy"}
                </Button>
              </div>
              <textarea
                readOnly
                value={currentCopyText}
                rows={3}
                className="flex w-full rounded-md border border-input bg-muted/20 px-3 py-2 font-mono text-xs text-foreground"
              />
            </div>
          </div>

          {draftError ? (
            <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {draftError}
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
            <div className="text-[11px] text-muted-foreground">
              Current hours: <span className="font-medium text-foreground">{formatHours(currentMinutes)}h</span>
              {" · "}
              {OT_DAY_KIND_META[currentDayKind].label}
              {currentEstimatedPay != null ? (
                <>
                  {" · "}
                  <span className="font-medium text-foreground">
                    {formatCurrency(currentEstimatedPay, settings.currency)}
                  </span>
                </>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => {
                  setDialogOpen(false);
                  setDraftError(null);
                  setDialogMode("create");
                }}
              >
                {isReadOnlyDialog ? "Close" : "Cancel"}
              </Button>
              {!isReadOnlyDialog ? (
                <Button size="sm" className="h-8 text-xs" onClick={saveEntry}>
                  <Save className="h-3.5 w-3.5" />
                  {editingEntryId ? "Save Changes" : "Save Record"}
                </Button>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
