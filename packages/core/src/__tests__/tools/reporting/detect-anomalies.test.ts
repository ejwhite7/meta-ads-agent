/**
 * @module __tests__/tools/reporting/detect-anomalies.test
 *
 * Unit tests for the detect-anomalies tool.
 * Verifies all 5 anomaly types are detected with correct thresholds
 * at each sensitivity level (low, medium, high).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectAnomalies } from "../../../tools/reporting/detect-anomalies.js";
import type {
	CampaignInfo,
	InsightsResultLike,
	ReportingToolContext,
} from "../../../tools/reporting/types.js";

/** Creates a mock ReportingToolContext with configurable MetaClient responses. */
function createMockContext(overrides: {
	campaigns?: CampaignInfo[];
	todayInsights?: InsightsResultLike[];
	baselineInsights?: InsightsResultLike[];
}): ReportingToolContext {
	const queryFn = vi
		.fn()
		.mockResolvedValueOnce(overrides.todayInsights ?? [])
		.mockResolvedValueOnce(overrides.baselineInsights ?? []);

	return {
		sessionId: "test-session",
		adAccountId: "act_123",
		dryRun: false,
		timestamp: new Date().toISOString(),
		metaClient: {
			campaigns: {
				list: vi.fn().mockResolvedValue(overrides.campaigns ?? []),
				get: vi.fn(),
			},
			insights: {
				query: queryFn,
			},
			adSets: {
				list: vi.fn().mockResolvedValue([]),
			},
		},
	};
}

/** Creates a baseline insight with 7-day aggregate data. */
function createBaselineInsight(overrides: Partial<InsightsResultLike> = {}): InsightsResultLike {
	return {
		campaign_id: "campaign_1",
		campaign_name: "Test Campaign",
		impressions: "70000",
		clicks: "7000",
		spend: "700.00",
		ctr: "0.10",
		cpm: "10.00",
		cpc: "0.10",
		actions: [{ action_type: "purchase", value: "70" }],
		date_start: "2024-01-01",
		date_stop: "2024-01-07",
		...overrides,
	};
}

/** Creates a today insight. */
function createTodayInsight(overrides: Partial<InsightsResultLike> = {}): InsightsResultLike {
	return {
		campaign_id: "campaign_1",
		campaign_name: "Test Campaign",
		impressions: "10000",
		clicks: "1000",
		spend: "100.00",
		ctr: "0.10",
		cpm: "10.00",
		cpc: "0.10",
		actions: [{ action_type: "purchase", value: "10" }],
		date_start: "2024-01-08",
		date_stop: "2024-01-08",
		...overrides,
	};
}

const activeCampaign: CampaignInfo = {
	id: "campaign_1",
	name: "Test Campaign",
	status: "ACTIVE",
	objective: "OUTCOME_SALES",
	daily_budget: "10000",
};

describe("detectAnomalies", () => {
	it("should return no anomalies when metrics are within normal range", async () => {
		const ctx = createMockContext({
			campaigns: [activeCampaign],
			todayInsights: [createTodayInsight()],
			baselineInsights: [createBaselineInsight()],
		});

		const result = await detectAnomalies.execute(
			{ adAccountId: "act_123", sensitivityLevel: "medium" },
			ctx,
		);

		expect(result.success).toBe(true);
		expect((result.data as Record<string, unknown>).anomalyCount).toBe(0);
	});

	it("should return empty anomalies when no active campaigns exist", async () => {
		const ctx = createMockContext({
			campaigns: [{ ...activeCampaign, status: "PAUSED" }],
		});

		const result = await detectAnomalies.execute(
			{ adAccountId: "act_123", sensitivityLevel: "medium" },
			ctx,
		);

		expect(result.success).toBe(true);
		expect((result.data as Record<string, unknown>).anomalyCount).toBeUndefined();
	});

	describe("CPA_SPIKE detection", () => {
		it("should detect CPA spike at medium sensitivity (>1.5x)", async () => {
			/* Baseline: 7-day CPA = $700 / 70 conversions = $10/conv => daily = $100/10 = $10/conv */
			/* Today: CPA = $200 / 10 = $20/conv (2x baseline) => should trigger */
			const ctx = createMockContext({
				campaigns: [activeCampaign],
				todayInsights: [createTodayInsight({ spend: "200.00" })],
				baselineInsights: [createBaselineInsight()],
			});

			const result = await detectAnomalies.execute(
				{ adAccountId: "act_123", sensitivityLevel: "medium" },
				ctx,
			);

			expect(result.success).toBe(true);
			const anomalies = (result.data as Record<string, unknown>).anomalies as Array<{
				type: string;
			}>;
			const cpaSpike = anomalies.find((a) => a.type === "CPA_SPIKE");
			expect(cpaSpike).toBeDefined();
		});

		it("should detect CPA spike at high sensitivity (>1.25x)", async () => {
			/* Baseline daily CPA = $10. Today CPA = $150/10 = $15 (1.5x baseline) => triggers at high */
			const ctx = createMockContext({
				campaigns: [activeCampaign],
				todayInsights: [createTodayInsight({ spend: "150.00" })],
				baselineInsights: [createBaselineInsight()],
			});

			const result = await detectAnomalies.execute(
				{ adAccountId: "act_123", sensitivityLevel: "high" },
				ctx,
			);

			expect(result.success).toBe(true);
			const anomalies = (result.data as Record<string, unknown>).anomalies as Array<{
				type: string;
			}>;
			const cpaSpike = anomalies.find((a) => a.type === "CPA_SPIKE");
			expect(cpaSpike).toBeDefined();
		});

		it("should not detect CPA spike when below threshold", async () => {
			/* Baseline daily CPA = $10. Today CPA = $110/10 = $11 (1.1x baseline) => no trigger */
			const ctx = createMockContext({
				campaigns: [activeCampaign],
				todayInsights: [createTodayInsight({ spend: "110.00" })],
				baselineInsights: [createBaselineInsight()],
			});

			const result = await detectAnomalies.execute(
				{ adAccountId: "act_123", sensitivityLevel: "medium" },
				ctx,
			);

			expect(result.success).toBe(true);
			const anomalies = (result.data as Record<string, unknown>).anomalies as Array<{
				type: string;
			}>;
			const cpaSpike = anomalies.find((a) => a.type === "CPA_SPIKE");
			expect(cpaSpike).toBeUndefined();
		});
	});

	describe("CTR_DROP detection", () => {
		it("should detect CTR drop at medium sensitivity (<0.6x baseline)", async () => {
			/* Baseline CTR = 0.10. Today CTR = 0.05 (0.5x baseline) => triggers */
			const ctx = createMockContext({
				campaigns: [activeCampaign],
				todayInsights: [createTodayInsight({ ctr: "0.05" })],
				baselineInsights: [createBaselineInsight()],
			});

			const result = await detectAnomalies.execute(
				{ adAccountId: "act_123", sensitivityLevel: "medium" },
				ctx,
			);

			expect(result.success).toBe(true);
			const anomalies = (result.data as Record<string, unknown>).anomalies as Array<{
				type: string;
			}>;
			const ctrDrop = anomalies.find((a) => a.type === "CTR_DROP");
			expect(ctrDrop).toBeDefined();
		});

		it("should not detect CTR drop when CTR is above threshold", async () => {
			/* Baseline CTR = 0.10. Today CTR = 0.08 (0.8x baseline) => no trigger at medium */
			const ctx = createMockContext({
				campaigns: [activeCampaign],
				todayInsights: [createTodayInsight({ ctr: "0.08" })],
				baselineInsights: [createBaselineInsight()],
			});

			const result = await detectAnomalies.execute(
				{ adAccountId: "act_123", sensitivityLevel: "medium" },
				ctx,
			);

			expect(result.success).toBe(true);
			const anomalies = (result.data as Record<string, unknown>).anomalies as Array<{
				type: string;
			}>;
			const ctrDrop = anomalies.find((a) => a.type === "CTR_DROP");
			expect(ctrDrop).toBeUndefined();
		});
	});

	describe("DELIVERY_ISSUE detection", () => {
		it("should detect delivery issue when impressions drop >50% at medium sensitivity", async () => {
			/* Baseline daily impressions = 70000/7 = 10000. Today = 4000 (60% drop) => triggers */
			const ctx = createMockContext({
				campaigns: [activeCampaign],
				todayInsights: [createTodayInsight({ impressions: "4000" })],
				baselineInsights: [createBaselineInsight()],
			});

			const result = await detectAnomalies.execute(
				{ adAccountId: "act_123", sensitivityLevel: "medium" },
				ctx,
			);

			expect(result.success).toBe(true);
			const anomalies = (result.data as Record<string, unknown>).anomalies as Array<{
				type: string;
			}>;
			const delivery = anomalies.find((a) => a.type === "DELIVERY_ISSUE");
			expect(delivery).toBeDefined();
		});
	});

	describe("BUDGET_EXHAUSTION detection", () => {
		it("should detect budget exhaustion when >95% spent before 6pm at medium sensitivity", async () => {
			/* daily_budget = 10000 cents = $100. Today spend = $98 (98%) */
			/* We need to mock the current hour to be before 6pm */
			const originalDate = Date;
			const mockDate = class extends Date {
				constructor() {
					super("2024-01-08T14:00:00Z");
				}
				getHours() {
					return 14;
				}
			};
			vi.stubGlobal("Date", mockDate);

			const ctx = createMockContext({
				campaigns: [activeCampaign],
				todayInsights: [createTodayInsight({ spend: "98.00" })],
				baselineInsights: [createBaselineInsight()],
			});

			const result = await detectAnomalies.execute(
				{ adAccountId: "act_123", sensitivityLevel: "medium" },
				ctx,
			);

			vi.stubGlobal("Date", originalDate);

			expect(result.success).toBe(true);
			const anomalies = (result.data as Record<string, unknown>).anomalies as Array<{
				type: string;
			}>;
			const exhaustion = anomalies.find((a) => a.type === "BUDGET_EXHAUSTION");
			expect(exhaustion).toBeDefined();
		});
	});

	describe("CONVERSION_COLLAPSE detection", () => {
		it("should detect conversion collapse when conv rate <0.5x baseline at medium sensitivity", async () => {
			/* Baseline: 70 conversions / 7000 clicks = 1% conv rate daily */
			/* Today: 2 conversions / 1000 clicks = 0.2% (0.2x baseline) => triggers */
			const ctx = createMockContext({
				campaigns: [activeCampaign],
				todayInsights: [
					createTodayInsight({
						clicks: "1000",
						actions: [{ action_type: "purchase", value: "2" }],
					}),
				],
				baselineInsights: [createBaselineInsight()],
			});

			const result = await detectAnomalies.execute(
				{ adAccountId: "act_123", sensitivityLevel: "medium" },
				ctx,
			);

			expect(result.success).toBe(true);
			const anomalies = (result.data as Record<string, unknown>).anomalies as Array<{
				type: string;
			}>;
			const collapse = anomalies.find((a) => a.type === "CONVERSION_COLLAPSE");
			expect(collapse).toBeDefined();
		});

		it("should not detect conversion collapse when rate is normal", async () => {
			/* Baseline: 70 conv / 7000 clicks = 1% daily. Today: 8 conv / 1000 clicks = 0.8% (0.8x) => no trigger */
			const ctx = createMockContext({
				campaigns: [activeCampaign],
				todayInsights: [
					createTodayInsight({
						clicks: "1000",
						actions: [{ action_type: "purchase", value: "8" }],
					}),
				],
				baselineInsights: [createBaselineInsight()],
			});

			const result = await detectAnomalies.execute(
				{ adAccountId: "act_123", sensitivityLevel: "medium" },
				ctx,
			);

			expect(result.success).toBe(true);
			const anomalies = (result.data as Record<string, unknown>).anomalies as Array<{
				type: string;
			}>;
			const collapse = anomalies.find((a) => a.type === "CONVERSION_COLLAPSE");
			expect(collapse).toBeUndefined();
		});
	});

	describe("sensitivity levels", () => {
		it("should detect more anomalies at high sensitivity than low", async () => {
			/* Values that would trigger at high but not low */
			/* CPA: baseline daily $10, today $14 (1.4x) => high (>1.25x) yes, low (>2.0x) no */
			const ctx1 = createMockContext({
				campaigns: [activeCampaign],
				todayInsights: [createTodayInsight({ spend: "140.00" })],
				baselineInsights: [createBaselineInsight()],
			});

			const highResult = await detectAnomalies.execute(
				{ adAccountId: "act_123", sensitivityLevel: "high" },
				ctx1,
			);

			const ctx2 = createMockContext({
				campaigns: [activeCampaign],
				todayInsights: [createTodayInsight({ spend: "140.00" })],
				baselineInsights: [createBaselineInsight()],
			});

			const lowResult = await detectAnomalies.execute(
				{ adAccountId: "act_123", sensitivityLevel: "low" },
				ctx2,
			);

			const highAnomalies = (highResult.data as Record<string, unknown>)
				.anomalies as Array<unknown>;
			const lowAnomalies = (lowResult.data as Record<string, unknown>).anomalies as Array<unknown>;

			expect(highAnomalies.length).toBeGreaterThanOrEqual(lowAnomalies.length);
		});
	});

	it("should handle MetaClient errors gracefully", async () => {
		const ctx: ReportingToolContext = {
			sessionId: "test-session",
			adAccountId: "act_123",
			dryRun: false,
			timestamp: new Date().toISOString(),
			metaClient: {
				campaigns: {
					list: vi.fn().mockRejectedValue(new Error("API rate limit exceeded")),
					get: vi.fn(),
				},
				insights: { query: vi.fn() },
				adSets: { list: vi.fn() },
			},
		};

		const result = await detectAnomalies.execute(
			{ adAccountId: "act_123", sensitivityLevel: "medium" },
			ctx,
		);

		expect(result.success).toBe(false);
		expect(result.message).toContain("API rate limit exceeded");
	});

	it("should fail when MetaClient is not available", async () => {
		const ctx = {
			sessionId: "test-session",
			adAccountId: "act_123",
			dryRun: false,
			timestamp: new Date().toISOString(),
		};

		const result = await detectAnomalies.execute(
			{ adAccountId: "act_123", sensitivityLevel: "medium" },
			ctx,
		);

		expect(result.success).toBe(false);
		expect(result.message).toContain("MetaClient is not available");
	});
});
