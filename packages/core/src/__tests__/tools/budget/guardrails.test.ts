/**
 * @module __tests__/tools/budget/guardrails
 *
 * Tests that budget guardrails are correctly enforced across the
 * set_budget and reallocate_budget tools. Validates minimum budget
 * floor, maximum scale factor ceiling, and human approval thresholds.
 */

import { describe, expect, it, vi } from "vitest";
import type { GuardrailConfig } from "../../../decisions/types.js";
import { createReallocateBudgetTool } from "../../../tools/budget/reallocate-budget.js";
import { createSetBudgetTool } from "../../../tools/budget/set-budget.js";
import type { ToolContext } from "../../../tools/types.js";

/** Test guardrail configuration with explicit thresholds. */
const TEST_GUARDRAILS: GuardrailConfig = {
	minDailyBudget: 10,
	maxBudgetScaleFactor: 2.0,
	maxActionsPerCycle: 5,
	requireApprovalAbove: 500,
};

/**
 * Creates a mock MetaClient with configurable campaign responses.
 */
function createMockClient(
	overrides: {
		campaignBudgetCents?: string;
		adSetBudgetCents?: string;
	} = {},
) {
	return {
		campaigns: {
			list: vi.fn().mockResolvedValue([]),
			get: vi.fn().mockResolvedValue({
				id: "campaign_1",
				name: "Test Campaign",
				status: "ACTIVE",
				daily_budget: overrides.campaignBudgetCents ?? "10000",
				objective: "OUTCOME_SALES",
				created_time: "2026-01-01T00:00:00Z",
				updated_time: "2026-01-15T00:00:00Z",
			}),
			update: vi.fn().mockResolvedValue({
				id: "campaign_1",
				name: "Test Campaign",
				status: "ACTIVE",
				daily_budget: "0",
				objective: "OUTCOME_SALES",
				created_time: "2026-01-01T00:00:00Z",
				updated_time: "2026-01-15T00:00:00Z",
			}),
		},
		adSets: {
			list: vi.fn().mockResolvedValue([]),
			get: vi.fn().mockResolvedValue({
				id: "adset_1",
				name: "Test Ad Set",
				campaign_id: "campaign_1",
				status: "ACTIVE",
				daily_budget: overrides.adSetBudgetCents ?? "5000",
				targeting: {},
				optimization_goal: "LINK_CLICKS",
				created_time: "2026-01-01T00:00:00Z",
				updated_time: "2026-01-15T00:00:00Z",
			}),
			update: vi.fn().mockResolvedValue({}),
		},
		insights: {
			query: vi.fn().mockResolvedValue([]),
		},
	} as any;
}

/** Standard test context. */
function createTestContext(overrides: Partial<ToolContext> = {}): ToolContext {
	return {
		sessionId: "test-session-001",
		adAccountId: "act_123456789",
		dryRun: false,
		timestamp: "2026-01-15T12:00:00.000Z",
		...overrides,
	};
}

describe("set_budget guardrails", () => {
	it("should reject budget below minimum daily budget floor", async () => {
		const client = createMockClient({ campaignBudgetCents: "10000" });
		const tool = createSetBudgetTool(client, TEST_GUARDRAILS);

		const result = await tool.execute(
			{
				campaignId: "campaign_1",
				dailyBudget: 5,
				reason: "Testing floor",
			},
			createTestContext(),
		);

		expect(result.success).toBe(false);
		expect(result.message).toContain("below the minimum");
		expect(result.data?.minDailyBudget).toBe(10);
		expect(client.campaigns.update).not.toHaveBeenCalled();
	});

	it("should reject budget exceeding max scale factor ceiling", async () => {
		/* Current budget: $100, max scale factor: 2.0x -> max allowed: $200 */
		const client = createMockClient({ campaignBudgetCents: "10000" });
		const tool = createSetBudgetTool(client, TEST_GUARDRAILS);

		const result = await tool.execute(
			{
				campaignId: "campaign_1",
				dailyBudget: 250,
				reason: "Testing ceiling",
			},
			createTestContext(),
		);

		expect(result.success).toBe(false);
		expect(result.message).toContain("exceeds the maximum");
		expect(result.message).toContain("2x scale factor");
		expect(client.campaigns.update).not.toHaveBeenCalled();
	});

	it("should return pending status for changes above approval threshold", async () => {
		/* Current budget: $100, requesting $600 -> below 2x ceiling ($200)
		 * but wait, $600 > $200 ceiling. Let's set current budget higher.
		 * Current: $400 -> max: $800. Request $600 -> under ceiling, above approval $500 */
		const client = createMockClient({ campaignBudgetCents: "40000" });
		const tool = createSetBudgetTool(client, TEST_GUARDRAILS);

		const result = await tool.execute(
			{
				campaignId: "campaign_1",
				dailyBudget: 600,
				reason: "Scale up successful campaign",
			},
			createTestContext(),
		);

		expect(result.success).toBe(true);
		expect(result.data?.status).toBe("pending_approval");
		expect(result.message).toContain("requires human approval");
		expect(client.campaigns.update).not.toHaveBeenCalled();
	});

	it("should allow budget changes within all guardrail limits", async () => {
		/* Current budget: $100, requesting $150 -> within 2x, above $10 min, below $500 approval */
		const client = createMockClient({ campaignBudgetCents: "10000" });
		const tool = createSetBudgetTool(client, TEST_GUARDRAILS);

		const result = await tool.execute(
			{
				campaignId: "campaign_1",
				dailyBudget: 150,
				reason: "Gradual scale up",
			},
			createTestContext(),
		);

		expect(result.success).toBe(true);
		expect(result.data?.previousBudget).toBe(100);
		expect(result.data?.newBudget).toBe(150);
		expect(client.campaigns.update).toHaveBeenCalledWith("campaign_1", {
			daily_budget: "15000",
		});
	});

	it("should enforce guardrails at ad set level too", async () => {
		const client = createMockClient({ adSetBudgetCents: "5000" });
		const tool = createSetBudgetTool(client, TEST_GUARDRAILS);

		/* Try setting ad set budget below minimum */
		const result = await tool.execute(
			{
				campaignId: "campaign_1",
				dailyBudget: 3,
				reason: "Testing ad set floor",
				adSetId: "adset_1",
			},
			createTestContext(),
		);

		expect(result.success).toBe(false);
		expect(result.message).toContain("below the minimum");
		expect(result.data?.targetLevel).toBe("ad set");
	});

	it("should skip API call in dry-run mode but still check guardrails", async () => {
		const client = createMockClient({ campaignBudgetCents: "10000" });
		const tool = createSetBudgetTool(client, TEST_GUARDRAILS);

		/* Guardrail violation should still fail even in dry run */
		const failResult = await tool.execute(
			{ campaignId: "campaign_1", dailyBudget: 5, reason: "Dry run floor test" },
			createTestContext({ dryRun: true }),
		);
		expect(failResult.success).toBe(false);

		/* Valid change in dry-run should succeed but not call API */
		const successResult = await tool.execute(
			{ campaignId: "campaign_1", dailyBudget: 150, reason: "Dry run success" },
			createTestContext({ dryRun: true }),
		);
		expect(successResult.success).toBe(true);
		expect(successResult.data?.dryRun).toBe(true);
		expect(client.campaigns.update).not.toHaveBeenCalled();
	});
});

describe("reallocate_budget guardrails", () => {
	it("should reject when source would go below minimum budget", async () => {
		const client = createMockClient();
		/* Source has $100 budget. Reallocating $95 would leave $5, below $10 min */
		client.campaigns.get
			.mockResolvedValueOnce({
				id: "source",
				name: "Source Campaign",
				status: "ACTIVE",
				daily_budget: "10000",
				objective: "OUTCOME_SALES",
				created_time: "2026-01-01T00:00:00Z",
				updated_time: "2026-01-15T00:00:00Z",
			})
			.mockResolvedValueOnce({
				id: "dest",
				name: "Destination Campaign",
				status: "ACTIVE",
				daily_budget: "5000",
				objective: "OUTCOME_SALES",
				created_time: "2026-01-01T00:00:00Z",
				updated_time: "2026-01-15T00:00:00Z",
			});

		const tool = createReallocateBudgetTool(client, TEST_GUARDRAILS);

		const result = await tool.execute(
			{
				fromCampaignId: "source",
				toCampaignId: "dest",
				amount: 95,
				reason: "Testing source floor",
			},
			createTestContext(),
		);

		expect(result.success).toBe(false);
		expect(result.message).toContain("below the minimum");
		expect(client.campaigns.update).not.toHaveBeenCalled();
	});

	it("should reject when destination would exceed max scale factor", async () => {
		const client = createMockClient();
		/* Dest has $50 budget, max scale factor 2x = $100 max.
		 * Adding $60 to $50 = $110 -> exceeds $100 max */
		client.campaigns.get
			.mockResolvedValueOnce({
				id: "source",
				name: "Source Campaign",
				status: "ACTIVE",
				daily_budget: "20000",
				objective: "OUTCOME_SALES",
				created_time: "2026-01-01T00:00:00Z",
				updated_time: "2026-01-15T00:00:00Z",
			})
			.mockResolvedValueOnce({
				id: "dest",
				name: "Destination Campaign",
				status: "ACTIVE",
				daily_budget: "5000",
				objective: "OUTCOME_SALES",
				created_time: "2026-01-01T00:00:00Z",
				updated_time: "2026-01-15T00:00:00Z",
			});

		const tool = createReallocateBudgetTool(client, TEST_GUARDRAILS);

		const result = await tool.execute(
			{
				fromCampaignId: "source",
				toCampaignId: "dest",
				amount: 60,
				reason: "Testing dest ceiling",
			},
			createTestContext(),
		);

		expect(result.success).toBe(false);
		expect(result.message).toContain("exceeds the");
		expect(result.message).toContain("scale factor");
		expect(client.campaigns.update).not.toHaveBeenCalled();
	});

	it("should allow reallocation within all guardrail limits", async () => {
		const client = createMockClient();
		/* Source: $200, Dest: $50. Reallocate $30.
		 * Source after: $170 (> $10 min). Dest after: $80 (< $100 max 2x) */
		client.campaigns.get
			.mockResolvedValueOnce({
				id: "source",
				name: "Source Campaign",
				status: "ACTIVE",
				daily_budget: "20000",
				objective: "OUTCOME_SALES",
				created_time: "2026-01-01T00:00:00Z",
				updated_time: "2026-01-15T00:00:00Z",
			})
			.mockResolvedValueOnce({
				id: "dest",
				name: "Destination Campaign",
				status: "ACTIVE",
				daily_budget: "5000",
				objective: "OUTCOME_SALES",
				created_time: "2026-01-01T00:00:00Z",
				updated_time: "2026-01-15T00:00:00Z",
			});

		const tool = createReallocateBudgetTool(client, TEST_GUARDRAILS);

		const result = await tool.execute(
			{
				fromCampaignId: "source",
				toCampaignId: "dest",
				amount: 30,
				reason: "Performance optimization",
			},
			createTestContext(),
		);

		expect(result.success).toBe(true);
		expect(result.data?.source).toEqual(expect.objectContaining({ before: 200, after: 170 }));
		expect(result.data?.destination).toEqual(expect.objectContaining({ before: 50, after: 80 }));
	});
});
