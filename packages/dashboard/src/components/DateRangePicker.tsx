/**
 * @file Date range picker for the dashboard header.
 *
 * Anatomy:
 *   - Trigger button that shows the current range as a chip:
 *       "Last 7 days · Apr 27 – May 4"
 *   - When clicked, opens a dropdown panel containing:
 *       - A column of preset buttons (Today, Last 7 days, etc.)
 *       - A range-mode calendar from `react-day-picker` for custom ranges
 *       - "Cancel" / "Apply" buttons that commit the calendar selection
 *
 * State strategy:
 *   The committed range is owned by the DateRangeProvider context. The
 *   panel keeps a *draft* range for the calendar so a half-finished
 *   selection (only `from` chosen, not `to`) doesn't clobber the live
 *   filter applied to the rest of the page until the user clicks Apply.
 *
 * Accessibility:
 *   - The trigger is a button, focusable, with aria-expanded.
 *   - Esc closes the popover.
 *   - Click outside closes the popover.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/* Inline SVG icons keep us off another runtime dependency. The wrapping
 * <button> provides the accessible name; we mark these decorative with
 * role="presentation" + aria-hidden so screen readers skip them. */
function ChevronDownIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 20 20"
			fill="currentColor"
			role="presentation"
			aria-hidden="true"
			focusable="false"
		>
			<path
				fillRule="evenodd"
				d="M5.23 7.21a.75.75 0 011.06.02L10 11.04l3.71-3.81a.75.75 0 111.08 1.04l-4.25 4.36a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
				clipRule="evenodd"
			/>
		</svg>
	);
}
function XIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 20 20"
			fill="currentColor"
			role="presentation"
			aria-hidden="true"
			focusable="false"
		>
			<path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 10-1.06-1.06L10 8.94 6.28 5.22z" />
		</svg>
	);
}
import { DayPicker, type DateRange as DayPickerRange } from "react-day-picker";
import "react-day-picker/dist/style.css";
import {
	type DateRange,
	type DateRangePreset,
	PRESET_LABELS,
	PRESET_ORDER,
	formatRange,
	rangeForPreset,
	useDateRange,
} from "../lib/date-range";
import { cn } from "../lib/utils";

/**
 * Header date range picker component.
 *
 * Mounted on the app header (Shell) so every page sees the same range.
 * Reads/writes the {@link DateRangeProvider} context.
 */
export function DateRangePicker() {
	const { range, preset, setRange, setPreset } = useDateRange();

	const [open, setOpen] = useState(false);
	/* Draft state for the calendar; only committed on Apply. */
	const [draft, setDraft] = useState<DayPickerRange | undefined>({
		from: range.from,
		to: range.to,
	});
	const containerRef = useRef<HTMLDivElement | null>(null);

	/* Keep the draft in sync when the live range changes (e.g. preset clicked). */
	useEffect(() => {
		setDraft({ from: range.from, to: range.to });
	}, [range.from, range.to]);

	/* Close on Esc + click-outside. */
	useEffect(() => {
		if (!open) return;

		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape") setOpen(false);
		};
		const onClick = (e: MouseEvent): void => {
			if (!containerRef.current) return;
			if (!containerRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("mousedown", onClick);
		return () => {
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("mousedown", onClick);
		};
	}, [open]);

	const handlePresetClick = useCallback(
		(p: DateRangePreset) => {
			setPreset(p);
			setOpen(false);
		},
		[setPreset],
	);

	const handleApply = useCallback(() => {
		if (draft?.from && draft?.to) {
			const newRange: DateRange = {
				from: draft.from,
				/* react-day-picker returns midnight bounds; bump `to` to end-of-day
				 * inclusive so day-precision filters pick up activity on the last day. */
				to: new Date(
					draft.to.getFullYear(),
					draft.to.getMonth(),
					draft.to.getDate(),
					23,
					59,
					59,
					999,
				),
			};
			setRange(newRange, "custom");
			setOpen(false);
		}
	}, [draft, setRange]);

	const handleCancel = useCallback(() => {
		setDraft({ from: range.from, to: range.to });
		setOpen(false);
	}, [range.from, range.to]);

	const triggerLabel =
		preset === "custom"
			? `Custom · ${formatRange(range)}`
			: `${PRESET_LABELS[preset]} · ${formatRange(range)}`;

	return (
		<div ref={containerRef} className="relative">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-haspopup="dialog"
				aria-expanded={open}
				className={cn(
					"inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5",
					"text-sm font-medium text-gray-800 shadow-sm",
					"hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
				)}
			>
				<span>{triggerLabel}</span>
				<ChevronDownIcon className="h-4 w-4 text-gray-500" />
			</button>

			{open && (
				/* role="dialog" with aria-modal="false" -- the popover doesn't trap
				 * focus globally; native <dialog> would change the modal semantics. */
				<div
					// biome-ignore lint/a11y/useSemanticElements: explicit non-modal popover, see comment
					role="dialog"
					aria-modal="false"
					aria-label="Date range picker"
					className={cn(
						"absolute right-0 z-30 mt-2 w-[640px] max-w-[95vw] rounded-lg border border-gray-200 bg-white shadow-xl",
						"flex",
					)}
				>
					{/* Preset column */}
					<div className="border-r border-gray-200 p-2 w-44 flex-shrink-0">
						<ul className="space-y-1">
							{PRESET_ORDER.map((p) => (
								<li key={p}>
									<button
										type="button"
										onClick={() => handlePresetClick(p)}
										className={cn(
											"w-full rounded-md px-3 py-1.5 text-left text-sm",
											preset === p
												? "bg-blue-50 text-blue-700 font-medium"
												: "text-gray-700 hover:bg-gray-100",
										)}
									>
										{PRESET_LABELS[p]}
									</button>
								</li>
							))}
							<li className="border-t border-gray-100 mt-2 pt-2">
								<span className="block px-3 py-1 text-xs uppercase tracking-wider text-gray-400">
									Custom
								</span>
								<span className="block px-3 py-1 text-xs text-gray-500">
									Pick a range from the calendar
								</span>
							</li>
						</ul>
					</div>

					{/* Calendar column */}
					<div className="flex-1 p-3">
						<DayPicker
							mode="range"
							numberOfMonths={2}
							selected={draft}
							onSelect={setDraft}
							defaultMonth={range.from}
							/* Disable future dates -- ad data only goes back, not forward. */
							disabled={{ after: new Date() }}
							/* Compact, on-brand styling. react-day-picker ships a default
							 * stylesheet (imported above); these classNames overlay tweaks. */
							className="rdp-meta"
							styles={{
								caption: { color: "rgb(31 41 55)" },
							}}
						/>
						<div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
							<div className="text-xs text-gray-500">
								{draft?.from && draft?.to
									? `${formatRange({ from: draft.from, to: draft.to })}`
									: draft?.from
										? "Pick an end date"
										: "Pick a start date"}
							</div>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={handleCancel}
									className="rounded-md px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
								>
									Cancel
								</button>
								<button
									type="button"
									onClick={handleApply}
									disabled={!draft?.from || !draft?.to}
									className={cn(
										"rounded-md px-3 py-1.5 text-sm font-medium",
										draft?.from && draft?.to
											? "bg-blue-600 text-white hover:bg-blue-700"
											: "bg-gray-200 text-gray-400 cursor-not-allowed",
									)}
								>
									Apply
								</button>
							</div>
						</div>
					</div>

					{/* Close button (top-right) */}
					<button
						type="button"
						onClick={() => setOpen(false)}
						className="absolute right-2 top-2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
						aria-label="Close"
					>
						<XIcon className="h-4 w-4" />
					</button>
				</div>
			)}
		</div>
	);
}

/**
 * Quick-reset button. Useful when the picker is open elsewhere and the
 * user wants a one-click "back to last 7 days".
 */
export function DateRangeResetButton() {
	const { setPreset, preset } = useDateRange();
	if (preset === "last_7d") return null;
	return (
		<button
			type="button"
			onClick={() => setPreset("last_7d")}
			className="text-xs text-blue-600 hover:text-blue-800"
		>
			Reset to Last 7 days
		</button>
	);
}
