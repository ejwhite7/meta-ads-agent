/**
 * @module __tests__/tools/budget/pacing
 *
 * Tests for budget pacing calculations across the get_budget_status
 * and get_pacing_alerts tools. Validates on-track, overpacing, and
 * underpacing detection with realistic campaign scenarios.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGetBudgetStatusTool } from "../../../tools/budget/get-budget-status.js";
import { createGetPacingAlertsTool } from "../../../tools/budget/get-pacing-alerts.js";
import type { ToolContext } from "../../../tools/types.js";

/**
 * Creates a mock MetaClient with configurable campaign and insights responses.
 */
function createMockClient(
	overrides: {
		campaigns?: Array<{
			id: string;
			name: string;
			status: string;
			daily_budget?: string;
			objective?: string;
			bid_strategy?: string;
			created_time?: string;
			updated_time?: string;
		}>;
		insights?: Array<{
			campaign_id?: string;
			campaign_name?: string;
			spend: string;
			impressions?: string;
			clicks?: string;
			actions?: Array<{ action_type: string; value: string }>;
			ctr?: string;
			cpm?: string;
			date_start?: string;
			date_stop?: string;
		}>;
	} = {},
) {
	return {
		campaigns: {
			list: vi.fn().mockResolvedValue(overrides.campaigns ?? []),
			get: vi.fn(),
			create: vi.fn(),
			update: vi.fn(),
			delete: vi.fn(),
		},
		adSets: {
			list: vi.fn().mockResolvedValue([]),
			get: vi.fn(),
			update: vi.fn(),
		},
		insights: {
			query: vi.fn().mockResolvedValue(overrides.insights ?? []),
		},
	} as any;
}

/**
 * Creates a standard ToolContext for testing.
 */
function createTestContext(overrides: Partial<ToolContext> = {}): ToolContext {
	return {
		sessionId: "test-session-001",
		adAccountId: "act_123456789",
		dryRun: false,
		timestamp: "2026-01-15T12:00:00.000Z",
		...overrides,
	};
}

describe("get_budget_status pacing calculations", () => {
	it("should detect on-track pacing when spend is within 10% of expected", async () => {
		/* Mid-month (day 15 of 31): 50% through the month */
		const client = createMockClient({
			campaigns: [
				{
					id: "campaign_1",
					name: "Test Campaign",
					status: "ACTIVE",
					daily_budget: "10000",
					objective: "OUTCOME_SALES",
					created_time: "2026-01-01T00:00:00Z",
					updated_time: "2026-01-15T00:00:00Z",
				},
			],
			insights: [
				{
					spend: "1500.00",
					impressions: "100000",
					clicks: "5000",
					ctr: "0.05",
					cpm: "15.00",
					date_start: "2026-01-01",
					date_stop: "2026-01-31",
				},
			],
		});

		const tool = createGetBudgetStatusTool(client);
		const result = await tool.execute({ datePreset: "this_month" }, createTestContext());

		expect(result.success).toBe(true);
		expect(result.data).not.toBeNull();
		expect(result.data?.pacing).toBe("on_track");
	});

	it("should detect overpacing when spend exceeds 110% of expected", async () => {
		/* Day 15 of 31-day month, budget=$100/day -> expected ~$1500.
		 * Actual spend: $2000 -> pacing ratio ~1.33 -> overpacing */
		const client = createMockClient({
			campaigns: [
				{
					id: "campaign_1",
					name: "High Spend Campaign",
					status: "ACTIVE",
					daily_budget: "10000",
					objective: "OUTCOME_SALES",
					created_time: "2026-01-01T00:00:00Z",
					updated_time: "2026-01-15T00:00:00Z",
				},
			],
			insights: [
				{
					spend: "2000.00",
					impressions: "200000",
					clicks: "10000",
					ctr: "0.05",
					cpm: "10.00",
					date_start: "2026-01-01",
					date_stop: "2026-01-31",
				},
			],
		});

		const tool = createGetBudgetStatusTool(client);
		const result = await tool.execute({ datePreset: "this_month" }, createTestContext());

		expect(result.success).toBe(true);
		expect(result.data?.pacing).toBe("overpacing");
		expect(result.data?.pacingRatio).toBeGreaterThan(1.1);
	});

	it("should detect underpacing when spend is below 90% of expected", async () => {
		/* Day 15 of 31-day month, budget=$100/day -> expected ~$1500.
		 * Actual spend: $800 -> pacing ratio ~0.53 -> underpacing */
		const client = createMockClient({
			campaigns: [
				{
					id: "campaign_1",
					name: "Low Spend Campaign",
					status: "ACTIVE",
					daily_budget: "10000",
					objective: "OUTCOME_SALES",
					created_time: "2026-01-01T00:00:00Z",
					updated_time: "2026-01-15T00:00:00Z",
				},
			],
			insights: [
				{
					spend: "800.00",
					impressions: "50000",
					clicks: "2500",
					ctr: "0.05",
					cpm: "16.00",
					date_start: "2026-01-01",
					date_stop: "2026-01-31",
				},
			],
		});

		const tool = createGetBudgetStatusTool(client);
		const result = await tool.execute({ datePreset: "this_month" }, createTestContext());

		expect(result.success).toBe(true);
		expect(result.data?.pacing).toBe("underpacing");
		expect(result.data?.pacingRatio).toBeLessThan(0.9);
	});

	it("should compute correct burn rate from total spend and elapsed days", async () => {
		const client = createMockClient({
			campaigns: [
				{
					id: "campaign_1",
					name: "Steady Campaign",
					status: "ACTIVE",
					daily_budget: "5000",
					objective: "OUTCOME_SALES",
					created_time: "2026-01-01T00:00:00Z",
					updated_time: "2026-01-15T00:00:00Z",
				},
			],
			insights: [
				{
					spend: "750.00",
					impressions: "50000",
					clicks: "2500",
					ctr: "0.05",
					cpm: "15.00",
					date_start: "2026-01-01",
					date_stop: "2026-01-15",
				},
			],
		});

		const tool = createGetBudgetStatusTool(client);
		const result = await tool.execute({ datePreset: "this_month" }, createTestContext());

		expect(result.success).toBe(true);
		/* $750 / 15 days elapsed = $50/day burn rate */
		expect(result.data?.burnRate).toBe(50);
	});

	it("should handle accounts with no active campaigns", async () => {
		const client = createMockClient({
			campaigns: [
				{
					id: "campaign_1",
					name: "Paused Campaign",
					status: "PAUSED",
					daily_budget: "10000",
					objective: "OUTCOME_SALES",
					created_time: "2026-01-01T00:00:00Z",
					updated_time: "2026-01-15T00:00:00Z",
				},
			],
			insights: [],
		});

		const tool = createGetBudgetStatusTool(client);
		const result = await tool.execute({ datePreset: "this_month" }, createTestContext());

		expect(result.success).toBe(true);
		expect(result.data?.activeCampaignCount).toBe(0);
		expect(result.data?.totalDailyBudget).toBe(0);
	});
});

describe("get_pacing_alerts campaign flagging", () => {
	it("should flag overpacing campaigns with >20% deviation", async () => {
		const client = createMockClient({
			campaigns: [
				{
					id: "campaign_1",
					name: "Overspending Campaign",
					status: "ACTIVE",
					daily_budget: "5000",
					objective: "OUTCOME_SALES",
					created_time: "2026-01-01T00:00:00Z",
					updated_time: "2026-01-15T00:00:00Z",
				},
			],
			insights: [
				{
					campaign_id: "campaign_1",
					campaign_name: "Overspending Campaign",
					spend: "1200.00",
					impressions: "80000",
					clicks: "4000",
					ctr: "0.05",
					cpm: "15.00",
					date_start: "2026-01-01",
					date_stop: "2026-01-15",
				},
			],
		});

		const tool = createGetPacingAlertsTool(client);
		const result = await tool.execute({}, createTestContext());

		expect(result.success).toBe(true);
		expect(result.data?.alertCount).toBeGreaterThan(0);
		const alerts = result.data?.alerts as Array<{
			campaignId: string;
			severity: string;
			message: string;
		}>;
		expect(alerts[0].campaignId).toBe("campaign_1");
		expect(alerts[0].message).toContain("overpacing");
	});

	it("should flag underpacing campaigns with >20% deviation", async () => {
		const client = createMockClient({
			campaigns: [
				{
					id: "campaign_2",
					name: "Underdelivering Campaign",
					status: "ACTIVE",
					daily_budget: "10000",
					objective: "OUTCOME_SALES",
					created_time: "2026-01-01T00:00:00Z",
					updated_time: "2026-01-15T00:00:00Z",
				},
			],
			insights: [
				{
					campaign_id: "campaign_2",
					campaign_name: "Underdelivering Campaign",
					spend: "300.00",
					impressions: "20000",
					clicks: "1000",
					ctr: "0.05",
					cpm: "15.00",
					date_start: "2026-01-01",
					date_stop: "2026-01-15",
				},
			],
		});

		const tool = createGetPacingAlertsTool(client);
		const result = await tool.execute({}, createTestContext());

		expect(result.success).toBe(true);
		expect(result.data?.alertCount).toBeGreaterThan(0);
		const alerts = result.data?.alerts as Array<{ campaignId: string; message: string }>;
		expect(alerts[0].message).toContain("underpacing");
	});

	it("should not flag campaigns pacing within normal range", async () => {
		/* Day 15 of 31-day month. Budget $50/day = $775 expected by day 15.
		 * Spend $750 -> ~96.8% pacing -> within 10% -> no alert */
		const client = createMockClient({
			campaigns: [
				{
					id: "campaign_3",
					name: "Healthy Campaign",
					status: "ACTIVE",
					daily_budget: "5000",
					objective: "OUTCOME_SALES",
					created_time: "2026-01-01T00:00:00Z",
					updated_time: "2026-01-15T00:00:00Z",
				},
			],
			insights: [
				{
					campaign_id: "campaign_3",
					campaign_name: "Healthy Campaign",
					spend: "750.00",
					impressions: "50000",
					clicks: "2500",
					ctr: "0.05",
					cpm: "15.00",
					date_start: "2026-01-01",
					date_stop: "2026-01-15",
				},
			],
		});

		const tool = createGetPacingAlertsTool(client);
		const result = await tool.execute({}, createTestContext());

		expect(result.success).toBe(true);
		expect(result.data?.alertCount).toBe(0);
	});

	it("should classify critical severity for >50% deviation", async () => {
		/* Day 15 of 31, budget $100/day, expected ~$1483.87.
		 * Spend $200 -> 13.5% of expected -> >50% under -> critical */
		const client = createMockClient({
			campaigns: [
				{
					id: "campaign_4",
					name: "Critical Underspend",
					status: "ACTIVE",
					daily_budget: "10000",
					objective: "OUTCOME_SALES",
					created_time: "2026-01-01T00:00:00Z",
					updated_time: "2026-01-15T00:00:00Z",
				},
			],
			insights: [
				{
					campaign_id: "campaign_4",
					campaign_name: "Critical Underspend",
					spend: "200.00",
					impressions: "10000",
					clicks: "500",
					ctr: "0.05",
					cpm: "20.00",
					date_start: "2026-01-01",
					date_stop: "2026-01-15",
				},
			],
		});

		const tool = createGetPacingAlertsTool(client);
		const result = await tool.execute({}, createTestContext());

		expect(result.success).toBe(true);
		const alerts = result.data?.alerts as Array<{ severity: string }>;
		expect(alerts.length).toBeGreaterThan(0);
		expect(alerts[0].severity).toBe("critical");
	});
});
