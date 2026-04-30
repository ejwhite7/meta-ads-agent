/**
 * @module __tests__/tools/campaign/pause-campaign
 *
 * Unit tests for the pause_campaign tool.
 * Validates campaign existence check, pause execution, idempotent
 * handling of already-paused campaigns, and audit logging.
 */

import { describe, expect, it, vi } from "vitest";
import { pauseCampaignTool } from "../../../tools/campaign/pause-campaign.js";
import type { Campaign, ToolContext } from "../../../tools/types.js";

/** Factory for a minimal mock ToolContext. */
function createMockContext(
	overrides: Partial<{
		campaign: Campaign | null;
		showError: Error;
	}> = {},
): ToolContext {
	const campaign: Campaign | null =
		"campaign" in overrides
			? (overrides.campaign ?? null)
			: {
					id: "camp_001",
					name: "Active Campaign",
					status: "ACTIVE",
					objective: "OUTCOME_SALES",
					dailyBudget: 50,
					createdTime: "2024-01-01T00:00:00Z",
					updatedTime: "2024-06-01T00:00:00Z",
				};

	const updatedCampaign = campaign ? { ...campaign, status: "PAUSED" as const } : null;

	return {
		metaClient: {
			campaigns: {
				list: vi.fn(),
				show: overrides.showError
					? vi.fn().mockRejectedValue(overrides.showError)
					: vi.fn().mockResolvedValue(campaign),
				create: vi.fn(),
				update: vi.fn().mockResolvedValue(updatedCampaign),
				delete: vi.fn(),
			},
			adSets: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
			ads: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
			splitTests: { create: vi.fn(), get: vi.fn() },
		},
		auditLogger: { record: vi.fn().mockResolvedValue(undefined) },
		goals: { roasTarget: 4.0, cpaCap: 25.0, dailyBudgetLimit: 1000, riskLevel: "moderate" },
		guardrails: {
			minDailyBudget: 5,
			maxBudgetScaleFactor: 3,
			requireApprovalAbove: 500,
			coolDownTicks: 2,
		},
		db: {},
	};
}

describe("pauseCampaignTool", () => {
	it("has correct tool metadata", () => {
		expect(pauseCampaignTool.name).toBe("pause_campaign");
		expect(pauseCampaignTool.description).toContain("Pause");
		expect(pauseCampaignTool.parameters).toBeDefined();
	});

	// -----------------------------------------------------------------------
	// Successful pause
	// -----------------------------------------------------------------------

	it("pauses an active campaign successfully", async () => {
		const ctx = createMockContext();

		const result = await pauseCampaignTool.execute(
			{ campaignId: "camp_001", reason: "High CPA detected" },
			ctx,
		);

		expect(result.success).toBe(true);
		const data = result.data as {
			action: string;
			previousStatus: string;
			newStatus: string;
		};
		expect(data.action).toBe("paused");
		expect(data.previousStatus).toBe("ACTIVE");
		expect(data.newStatus).toBe("PAUSED");

		// Verify MetaClient was called to update status
		expect(ctx.metaClient.campaigns.update).toHaveBeenCalledWith("camp_001", {
			status: "PAUSED",
		});
	});

	// -----------------------------------------------------------------------
	// Audit logging
	// -----------------------------------------------------------------------

	it("logs pause action with reason to audit trail", async () => {
		const ctx = createMockContext();

		await pauseCampaignTool.execute(
			{ campaignId: "camp_001", reason: "CPA exceeds cap by 40%" },
			ctx,
		);

		expect(ctx.auditLogger.record).toHaveBeenCalledTimes(1);
		const entry = (ctx.auditLogger.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(entry.toolName).toBe("pause_campaign");
		expect(entry.toolParams).toEqual({
			campaignId: "camp_001",
			reason: "CPA exceeds cap by 40%",
		});
		expect(entry.outcome).toContain("Paused campaign camp_001");
		expect(entry.outcome).toContain("CPA exceeds cap by 40%");
		expect(entry.timestamp).toBeDefined();
	});

	// -----------------------------------------------------------------------
	// Already paused (idempotent)
	// -----------------------------------------------------------------------

	it("handles already-paused campaign gracefully", async () => {
		const pausedCampaign: Campaign = {
			id: "camp_002",
			name: "Already Paused",
			status: "PAUSED",
			objective: "OUTCOME_TRAFFIC",
			dailyBudget: 30,
			createdTime: "2024-01-01T00:00:00Z",
			updatedTime: "2024-06-01T00:00:00Z",
		};

		const ctx = createMockContext({ campaign: pausedCampaign });

		const result = await pauseCampaignTool.execute(
			{ campaignId: "camp_002", reason: "Redundant pause" },
			ctx,
		);

		expect(result.success).toBe(true);
		const data = result.data as { action: string; previousStatus: string };
		expect(data.action).toBe("none");
		expect(data.previousStatus).toBe("PAUSED");

		// MetaClient.update should NOT have been called
		expect(ctx.metaClient.campaigns.update).not.toHaveBeenCalled();
	});

	// -----------------------------------------------------------------------
	// Campaign not found
	// -----------------------------------------------------------------------

	it("returns error when campaign does not exist", async () => {
		const ctx = createMockContext({ campaign: null });

		const result = await pauseCampaignTool.execute(
			{ campaignId: "camp_999", reason: "Testing" },
			ctx,
		);

		expect(result.success).toBe(false);
		expect(result.errorCode).toBe("CAMPAIGN_NOT_FOUND");
		expect(result.error).toContain("camp_999");
	});

	// -----------------------------------------------------------------------
	// Error handling
	// -----------------------------------------------------------------------

	it("returns error on MetaClient failure", async () => {
		const ctx = createMockContext({
			showError: new Error("API unavailable"),
		});

		const result = await pauseCampaignTool.execute(
			{ campaignId: "camp_001", reason: "Pause attempt" },
			ctx,
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("API unavailable");
		expect(result.errorCode).toBe("META_API_ERROR");
	});

	it("includes campaign name in the response", async () => {
		const ctx = createMockContext();

		const result = await pauseCampaignTool.execute(
			{ campaignId: "camp_001", reason: "Testing" },
			ctx,
		);

		const data = result.data as { campaignName: string };
		expect(data.campaignName).toBe("Active Campaign");
	});
});
