/**
 * @module __tests__/tools/budget/reallocate
 *
 * Tests for the atomic budget reallocation tool, focusing on the
 * two-phase update process and rollback behavior when the second
 * update fails.
 */

import { describe, expect, it, vi } from "vitest";
import type { GuardrailConfig } from "../../../decisions/types.js";
import { createReallocateBudgetTool } from "../../../tools/budget/reallocate-budget.js";
import type { ToolContext } from "../../../tools/types.js";

/** Permissive guardrails for reallocation-specific tests. */
const PERMISSIVE_GUARDRAILS: GuardrailConfig = {
	minDailyBudget: 5,
	maxBudgetScaleFactor: 10.0,
	maxActionsPerCycle: 10,
	requireApprovalAbove: 100000,
};

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

describe("reallocate_budget atomic execution", () => {
	it("should update both campaigns in sequence", async () => {
		const updateCalls: Array<{ id: string; budget: string }> = [];

		const client = {
			campaigns: {
				get: vi
					.fn()
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
					}),
				update: vi.fn().mockImplementation((id: string, params: { daily_budget: string }) => {
					updateCalls.push({ id, budget: params.daily_budget });
					return Promise.resolve({ id, daily_budget: params.daily_budget });
				}),
			},
			adSets: { list: vi.fn().mockResolvedValue([]) },
			insights: { query: vi.fn().mockResolvedValue([]) },
		} as any;

		const tool = createReallocateBudgetTool(client, PERMISSIVE_GUARDRAILS);

		const result = await tool.execute(
			{
				fromCampaignId: "source",
				toCampaignId: "dest",
				amount: 50,
				reason: "Move budget to better performer",
			},
			createTestContext(),
		);

		expect(result.success).toBe(true);

		/* Verify both updates were called in order */
		expect(updateCalls).toHaveLength(2);
		/* Source: $200 - $50 = $150 = 15000 cents */
		expect(updateCalls[0]).toEqual({ id: "source", budget: "15000" });
		/* Dest: $50 + $50 = $100 = 10000 cents */
		expect(updateCalls[1]).toEqual({ id: "dest", budget: "10000" });
	});

	it("should roll back source campaign when destination update fails", async () => {
		const updateCalls: Array<{ id: string; budget: string }> = [];
		let callCount = 0;

		const client = {
			campaigns: {
				get: vi
					.fn()
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
					}),
				update: vi.fn().mockImplementation((id: string, params: { daily_budget: string }) => {
					callCount++;
					updateCalls.push({ id, budget: params.daily_budget });

					/* First call (reduce source) succeeds */
					if (callCount === 1) {
						return Promise.resolve({ id, daily_budget: params.daily_budget });
					}
					/* Second call (increase dest) fails */
					if (callCount === 2) {
						return Promise.reject(new Error("Meta API rate limit exceeded"));
					}
					/* Third call (rollback source) succeeds */
					return Promise.resolve({ id, daily_budget: params.daily_budget });
				}),
			},
			adSets: { list: vi.fn().mockResolvedValue([]) },
			insights: { query: vi.fn().mockResolvedValue([]) },
		} as any;

		const tool = createReallocateBudgetTool(client, PERMISSIVE_GUARDRAILS);

		const result = await tool.execute(
			{
				fromCampaignId: "source",
				toCampaignId: "dest",
				amount: 50,
				reason: "Attempted reallocation",
			},
			createTestContext(),
		);

		expect(result.success).toBe(false);
		expect(result.data?.rolledBack).toBe(true);
		expect(result.data?.sourceBudgetRestored).toBe(200);
		expect(result.message).toContain("rolled back");
		expect(result.message).toContain("rate limit");

		/* Verify 3 update calls: reduce source, fail dest, rollback source */
		expect(updateCalls).toHaveLength(3);
		expect(updateCalls[0]).toEqual({ id: "source", budget: "15000" });
		expect(updateCalls[1]).toEqual({ id: "dest", budget: "10000" });
		/* Rollback: restore source to original 20000 cents */
		expect(updateCalls[2]).toEqual({ id: "source", budget: "20000" });
	});

	it("should report critical error when both destination and rollback fail", async () => {
		let callCount = 0;

		const client = {
			campaigns: {
				get: vi
					.fn()
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
					}),
				update: vi.fn().mockImplementation(() => {
					callCount++;
					/* First call (reduce source) succeeds */
					if (callCount === 1) {
						return Promise.resolve({});
					}
					/* Second call (increase dest) fails */
					if (callCount === 2) {
						return Promise.reject(new Error("API error"));
					}
					/* Third call (rollback source) also fails */
					return Promise.reject(new Error("Network timeout"));
				}),
			},
			adSets: { list: vi.fn().mockResolvedValue([]) },
			insights: { query: vi.fn().mockResolvedValue([]) },
		} as any;

		const tool = createReallocateBudgetTool(client, PERMISSIVE_GUARDRAILS);

		const result = await tool.execute(
			{
				fromCampaignId: "source",
				toCampaignId: "dest",
				amount: 50,
				reason: "Double failure test",
			},
			createTestContext(),
		);

		expect(result.success).toBe(false);
		expect(result.data?.rollbackFailed).toBe(true);
		expect(result.message).toContain("CRITICAL");
		expect(result.message).toContain("Manual intervention required");
	});

	it("should log before and after budgets on success", async () => {
		const client = {
			campaigns: {
				get: vi
					.fn()
					.mockResolvedValueOnce({
						id: "source",
						name: "Source Campaign",
						status: "ACTIVE",
						daily_budget: "15000",
						objective: "OUTCOME_SALES",
						created_time: "2026-01-01T00:00:00Z",
						updated_time: "2026-01-15T00:00:00Z",
					})
					.mockResolvedValueOnce({
						id: "dest",
						name: "Dest Campaign",
						status: "ACTIVE",
						daily_budget: "8000",
						objective: "OUTCOME_SALES",
						created_time: "2026-01-01T00:00:00Z",
						updated_time: "2026-01-15T00:00:00Z",
					}),
				update: vi.fn().mockResolvedValue({}),
			},
			adSets: { list: vi.fn().mockResolvedValue([]) },
			insights: { query: vi.fn().mockResolvedValue([]) },
		} as any;

		const tool = createReallocateBudgetTool(client, PERMISSIVE_GUARDRAILS);

		const result = await tool.execute(
			{
				fromCampaignId: "source",
				toCampaignId: "dest",
				amount: 25,
				reason: "Budget optimization",
			},
			createTestContext(),
		);

		expect(result.success).toBe(true);

		/* Verify before/after budgets are logged in data */
		const source = result.data?.source as { name: string; before: number; after: number };
		const destination = result.data?.destination as { name: string; before: number; after: number };

		expect(source.name).toBe("Source Campaign");
		expect(source.before).toBe(150);
		expect(source.after).toBe(125);

		expect(destination.name).toBe("Dest Campaign");
		expect(destination.before).toBe(80);
		expect(destination.after).toBe(105);
	});

	it("should skip API calls in dry-run mode", async () => {
		const client = {
			campaigns: {
				get: vi
					.fn()
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
						name: "Dest Campaign",
						status: "ACTIVE",
						daily_budget: "5000",
						objective: "OUTCOME_SALES",
						created_time: "2026-01-01T00:00:00Z",
						updated_time: "2026-01-15T00:00:00Z",
					}),
				update: vi.fn(),
			},
			adSets: { list: vi.fn().mockResolvedValue([]) },
			insights: { query: vi.fn().mockResolvedValue([]) },
		} as any;

		const tool = createReallocateBudgetTool(client, PERMISSIVE_GUARDRAILS);

		const result = await tool.execute(
			{
				fromCampaignId: "source",
				toCampaignId: "dest",
				amount: 50,
				reason: "Dry run test",
			},
			createTestContext({ dryRun: true }),
		);

		expect(result.success).toBe(true);
		expect(result.data?.dryRun).toBe(true);
		expect(client.campaigns.update).not.toHaveBeenCalled();
	});
});
