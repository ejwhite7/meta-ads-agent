/**
 * @module __tests__/date-range.test
 *
 * Unit tests for the date-range preset math + persistence helpers.
 * The picker component itself is exercised by manual smoke testing
 * (and by tsc), but the math here drives every API call we make for
 * filtered data, so it gets its own coverage.
 */

import { describe, expect, it } from "vitest";
import { formatRange, rangeForPreset, rangeToIso } from "../lib/date-range";

describe("rangeForPreset", () => {
	const anchor = new Date("2026-05-04T15:30:00Z"); // a Monday

	it("today snaps to start-of-day .. end-of-day", () => {
		const r = rangeForPreset("today", anchor);
		expect(r.from.getHours()).toBe(0);
		expect(r.from.getMinutes()).toBe(0);
		/* same calendar day as the anchor */
		expect(r.from.getDate()).toBe(anchor.getDate());
		expect(r.to.getHours()).toBe(23);
		expect(r.to.getMinutes()).toBe(59);
	});

	it("yesterday is the calendar day before the anchor", () => {
		const r = rangeForPreset("yesterday", anchor);
		expect(r.from.getDate()).toBe(anchor.getDate() - 1);
		expect(r.to.getDate()).toBe(anchor.getDate() - 1);
		expect(r.to.getHours()).toBe(23);
	});

	it("last_7d covers exactly 7 calendar days ending today", () => {
		const r = rangeForPreset("last_7d", anchor);
		const dayMs = 24 * 60 * 60 * 1000;
		const span = (r.to.getTime() - r.from.getTime()) / dayMs;
		/* 6 full days + 23h59m59s -> just under 7 */
		expect(span).toBeGreaterThan(6.9);
		expect(span).toBeLessThan(7);
	});

	it("last_28d, last_30d, last_90d span the right number of days", () => {
		const dayMs = 24 * 60 * 60 * 1000;
		for (const [preset, days] of [
			["last_28d", 28],
			["last_30d", 30],
			["last_90d", 90],
		] as const) {
			const r = rangeForPreset(preset, anchor);
			const span = (r.to.getTime() - r.from.getTime()) / dayMs;
			expect(span).toBeGreaterThan(days - 1.1);
			expect(span).toBeLessThan(days);
		}
	});

	it("this_month starts on the 1st", () => {
		const r = rangeForPreset("this_month", anchor);
		expect(r.from.getDate()).toBe(1);
		expect(r.from.getMonth()).toBe(anchor.getMonth());
	});

	it("last_month spans the entire previous calendar month", () => {
		const r = rangeForPreset("last_month", anchor);
		expect(r.from.getDate()).toBe(1);
		/* April -> month index 3, May anchor -> month 4 */
		expect(r.from.getMonth()).toBe(anchor.getMonth() - 1);
		/* end is the last day of the month */
		const lastDay = new Date(r.to.getFullYear(), r.to.getMonth() + 1, 0).getDate();
		expect(r.to.getDate()).toBe(lastDay);
	});

	it("custom falls back to last 7 days so callers always get a usable range", () => {
		const r = rangeForPreset("custom", anchor);
		const dayMs = 24 * 60 * 60 * 1000;
		expect((r.to.getTime() - r.from.getTime()) / dayMs).toBeGreaterThan(6.9);
	});
});

describe("formatRange", () => {
	it("collapses same-day ranges to a single date", () => {
		const d = new Date("2026-05-04T12:00:00Z");
		const out = formatRange({ from: d, to: d });
		expect(out).toMatch(/May 4, 2026/);
		expect(out).not.toContain("–");
	});

	it("uses single-year format for ranges within the same year", () => {
		/* Construct in local time so the output is timezone-stable. */
		const out = formatRange({
			from: new Date(2026, 3 /* Apr */, 27),
			to: new Date(2026, 4 /* May */, 4, 23, 59, 59),
		});
		expect(out).toMatch(/Apr 27/);
		expect(out).toMatch(/May 4, 2026/);
	});

	it("includes both years for cross-year ranges", () => {
		const out = formatRange({
			from: new Date(2025, 11 /* Dec */, 28),
			to: new Date(2026, 0 /* Jan */, 3, 23, 59, 59),
		});
		expect(out).toMatch(/Dec 28, 2025/);
		expect(out).toMatch(/Jan 3, 2026/);
	});
});

describe("rangeToIso", () => {
	it("emits ISO 8601 strings the backend accepts", () => {
		const r = {
			from: new Date("2026-05-01T00:00:00.000Z"),
			to: new Date("2026-05-04T23:59:59.999Z"),
		};
		const iso = rangeToIso(r);
		expect(iso.startDate).toBe("2026-05-01T00:00:00.000Z");
		expect(iso.endDate).toBe("2026-05-04T23:59:59.999Z");
	});
});
