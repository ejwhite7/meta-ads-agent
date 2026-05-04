/**
 * @module __tests__/goals/defaults.test
 *
 * Verifies the per-objective default-KPI inference. The wizard and the
 * `guidance` CLI rely on these defaults to be sensible -- a regression
 * here means new users hit weird placeholder targets on first run.
 */

import { describe, expect, it } from "vitest";
import { KNOWN_OBJECTIVES, inferDefaultKpi } from "../../goals/defaults.js";

describe("inferDefaultKpi", () => {
	it("maps the six standard Meta objectives to canonical KPIs", () => {
		expect(inferDefaultKpi("OUTCOME_SALES").primaryKpi).toBe("roas");
		expect(inferDefaultKpi("OUTCOME_LEADS").primaryKpi).toBe("cpl");
		expect(inferDefaultKpi("OUTCOME_TRAFFIC").primaryKpi).toBe("cpc");
		expect(inferDefaultKpi("OUTCOME_ENGAGEMENT").primaryKpi).toBe("cost_per_thruplay");
		expect(inferDefaultKpi("OUTCOME_AWARENESS").primaryKpi).toBe("cpm");
		expect(inferDefaultKpi("OUTCOME_APP_PROMOTION").primaryKpi).toBe("cpi");
	});

	it("infers the right direction (max for ROAS/rate metrics, min for cost metrics)", () => {
		expect(inferDefaultKpi("OUTCOME_SALES").primaryKpiDirection).toBe("maximize");
		expect(inferDefaultKpi("OUTCOME_LEADS").primaryKpiDirection).toBe("minimize");
		expect(inferDefaultKpi("OUTCOME_AWARENESS").primaryKpiDirection).toBe("minimize");
	});

	it("flags the objectives whose default targets are dollar amounts", () => {
		expect(inferDefaultKpi("OUTCOME_SALES").currency).toBe(false); // ROAS is a ratio
		expect(inferDefaultKpi("OUTCOME_LEADS").currency).toBe(true); // CPL is dollars
		expect(inferDefaultKpi("OUTCOME_TRAFFIC").currency).toBe(true);
		expect(inferDefaultKpi("OUTCOME_AWARENESS").currency).toBe(true);
	});

	it("is case-insensitive", () => {
		expect(inferDefaultKpi("outcome_sales").primaryKpi).toBe("roas");
		expect(inferDefaultKpi("Outcome_Leads").primaryKpi).toBe("cpl");
	});

	it("falls back to a generic CTR-based default for unknown objectives", () => {
		const fallback = inferDefaultKpi("OUTCOME_THAT_META_INVENTS_LATER");
		expect(fallback.primaryKpi).toBe("ctr");
		expect(fallback.primaryKpiDirection).toBe("maximize");
	});

	it("handles null/undefined/empty inputs without throwing", () => {
		expect(() => inferDefaultKpi(null)).not.toThrow();
		expect(() => inferDefaultKpi(undefined)).not.toThrow();
		expect(() => inferDefaultKpi("")).not.toThrow();
		expect(inferDefaultKpi(null).primaryKpi).toBe("ctr"); /* fallback */
	});

	it("KNOWN_OBJECTIVES exports the full set of mapped keys", () => {
		expect(KNOWN_OBJECTIVES).toEqual(
			expect.arrayContaining([
				"OUTCOME_SALES",
				"OUTCOME_LEADS",
				"OUTCOME_TRAFFIC",
				"OUTCOME_ENGAGEMENT",
				"OUTCOME_AWARENESS",
				"OUTCOME_APP_PROMOTION",
			]),
		);
	});
});
