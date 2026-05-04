/**
 * @file Shared date-range state for the dashboard.
 *
 * Exposes a React context that holds the currently-selected reporting
 * window. Every page (Overview, Decisions, Campaigns) reads the same
 * range so that "Last 7 days" applies consistently across views.
 *
 * Persists the selection to localStorage so a refresh doesn't reset
 * to the default. The persisted shape is intentionally
 * forward-compatible: we store ISO timestamps + the preset key, so a
 * future bump (e.g. adding a `granularity: "day" | "hour"` field)
 * can extend without a schema-bump dance.
 */

import {
	addDays,
	endOfDay,
	endOfMonth,
	format,
	startOfDay,
	startOfMonth,
	subDays,
	subMonths,
} from "date-fns";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

/** Date range, half-open: `from` is start-of-day, `to` is end-of-day inclusive. */
export interface DateRange {
	readonly from: Date;
	readonly to: Date;
}

/**
 * Built-in preset windows. Adding a new preset only requires adding a key
 * here and a case in {@link rangeForPreset}; consumers pick it up through
 * the type system.
 */
export type DateRangePreset =
	| "today"
	| "yesterday"
	| "last_7d"
	| "last_28d"
	| "last_30d"
	| "last_90d"
	| "this_month"
	| "last_month"
	| "custom";

/** Shape of the value exposed via {@link useDateRange}. */
export interface DateRangeContextValue {
	readonly range: DateRange;
	readonly preset: DateRangePreset;
	/** Set both the range and the preset together (preset='custom' for a manual range). */
	readonly setRange: (range: DateRange, preset?: DateRangePreset) => void;
	/** Apply a named preset; the range is recomputed from `now()`. */
	readonly setPreset: (preset: DateRangePreset) => void;
}

/* ------------------------------------------------------------------ */
/* Preset -> range mapping                                            */
/* ------------------------------------------------------------------ */

/**
 * Computes the concrete `[from, to]` window for a named preset, anchored
 * at `now`. All windows are inclusive of the bounds and snap to whole-day
 * boundaries (00:00:00 .. 23:59:59).
 */
export function rangeForPreset(preset: DateRangePreset, now: Date = new Date()): DateRange {
	const today = startOfDay(now);
	switch (preset) {
		case "today":
			return { from: today, to: endOfDay(now) };
		case "yesterday": {
			const y = subDays(today, 1);
			return { from: y, to: endOfDay(y) };
		}
		case "last_7d":
			return { from: subDays(today, 6), to: endOfDay(now) };
		case "last_28d":
			return { from: subDays(today, 27), to: endOfDay(now) };
		case "last_30d":
			return { from: subDays(today, 29), to: endOfDay(now) };
		case "last_90d":
			return { from: subDays(today, 89), to: endOfDay(now) };
		case "this_month":
			return { from: startOfMonth(now), to: endOfDay(now) };
		case "last_month": {
			const first = startOfMonth(subMonths(now, 1));
			return { from: first, to: endOfMonth(first) };
		}
		default:
			/* "custom" has no canonical range; fall back to last 7 days
			 * so callers always get something usable. */
			return { from: subDays(today, 6), to: endOfDay(now) };
	}
}

/** Human-readable label for a preset, used in dropdowns and chips. */
export const PRESET_LABELS: Record<DateRangePreset, string> = {
	today: "Today",
	yesterday: "Yesterday",
	last_7d: "Last 7 days",
	last_28d: "Last 28 days",
	last_30d: "Last 30 days",
	last_90d: "Last 90 days",
	this_month: "This month",
	last_month: "Last month",
	custom: "Custom range",
};

/** Order presets are shown in the picker UI. */
export const PRESET_ORDER: DateRangePreset[] = [
	"today",
	"yesterday",
	"last_7d",
	"last_28d",
	"last_30d",
	"last_90d",
	"this_month",
	"last_month",
];

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

/**
 * Formats a range as a short, human-readable string.
 * Same-day ranges collapse to a single date.
 *
 *   formatRange({from: May 1, to: May 1}) -> "May 1, 2026"
 *   formatRange({from: Apr 27, to: May 4}) -> "Apr 27 – May 4, 2026"
 *   formatRange({from: Dec 28 2025, to: Jan 3 2026}) -> "Dec 28, 2025 – Jan 3, 2026"
 */
export function formatRange(range: DateRange): string {
	const sameYear = range.from.getFullYear() === range.to.getFullYear();
	const sameDay =
		range.from.getFullYear() === range.to.getFullYear() &&
		range.from.getMonth() === range.to.getMonth() &&
		range.from.getDate() === range.to.getDate();

	if (sameDay) {
		return format(range.from, "MMM d, yyyy");
	}
	if (sameYear) {
		return `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`;
	}
	return `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`;
}

/** ISO-formatted bounds suitable for sending to the backend. */
export function rangeToIso(range: DateRange): { startDate: string; endDate: string } {
	return {
		startDate: range.from.toISOString(),
		endDate: range.to.toISOString(),
	};
}

/* ------------------------------------------------------------------ */
/* Persistence                                                        */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "meta-ads-agent-date-range";

interface PersistedRange {
	from: string;
	to: string;
	preset: DateRangePreset;
}

/**
 * Tries to load a saved range from localStorage. Returns `null` if
 * nothing is saved or the saved value is malformed.
 */
function loadPersistedRange(): { range: DateRange; preset: DateRangePreset } | null {
	if (typeof window === "undefined") return null;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as PersistedRange;
		const from = new Date(parsed.from);
		const to = new Date(parsed.to);
		if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
		const preset = (
			[
				"today",
				"yesterday",
				"last_7d",
				"last_28d",
				"last_30d",
				"last_90d",
				"this_month",
				"last_month",
				"custom",
			] as DateRangePreset[]
		).includes(parsed.preset)
			? parsed.preset
			: "last_7d";
		return { range: { from, to }, preset };
	} catch {
		return null;
	}
}

function persistRange(range: DateRange, preset: DateRangePreset): void {
	if (typeof window === "undefined") return;
	try {
		const value: PersistedRange = {
			from: range.from.toISOString(),
			to: range.to.toISOString(),
			preset,
		};
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	} catch {
		/* localStorage may be disabled (private mode). Best-effort. */
	}
}

/* ------------------------------------------------------------------ */
/* Context + provider                                                 */
/* ------------------------------------------------------------------ */

const DateRangeContext = createContext<DateRangeContextValue | null>(null);

/** Default preset on first load when no localStorage value exists. */
const DEFAULT_PRESET: DateRangePreset = "last_7d";

/**
 * Wraps the app and provides the shared date-range state.
 * Hydrates from localStorage on mount; rehydrates presets against
 * "now" so e.g. "Last 7 days" stays accurate across days.
 */
export function DateRangeProvider({ children }: { children: ReactNode }) {
	const [{ range, preset }, setState] = useState<{
		range: DateRange;
		preset: DateRangePreset;
	}>(() => {
		const persisted = loadPersistedRange();
		if (persisted) {
			/* If the user previously chose a preset (not custom), recompute
			 * the range against today's date so "Last 7 days" reflects
			 * today's last 7 -- not the last 7 from when they last opened
			 * the dashboard. Custom ranges are kept verbatim. */
			if (persisted.preset !== "custom") {
				return { preset: persisted.preset, range: rangeForPreset(persisted.preset) };
			}
			return persisted;
		}
		return { preset: DEFAULT_PRESET, range: rangeForPreset(DEFAULT_PRESET) };
	});

	useEffect(() => {
		persistRange(range, preset);
	}, [range, preset]);

	const setRange = useCallback((newRange: DateRange, newPreset: DateRangePreset = "custom") => {
		setState({ range: newRange, preset: newPreset });
	}, []);

	const setPreset = useCallback((newPreset: DateRangePreset) => {
		setState({ preset: newPreset, range: rangeForPreset(newPreset) });
	}, []);

	const value = useMemo<DateRangeContextValue>(
		() => ({ range, preset, setRange, setPreset }),
		[range, preset, setRange, setPreset],
	);

	return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>;
}

/**
 * Read the current date range. Throws if used outside a
 * {@link DateRangeProvider}.
 */
export function useDateRange(): DateRangeContextValue {
	const ctx = useContext(DateRangeContext);
	if (!ctx) {
		throw new Error("useDateRange must be used inside a <DateRangeProvider>.");
	}
	return ctx;
}

/* ------------------------------------------------------------------ */
/* Misc utilities exported for tests                                  */
/* ------------------------------------------------------------------ */

/** Adds N days to a date. Re-exported for callers that need it without\n * pulling in date-fns directly. */
export const addDaysUtil = addDays;
