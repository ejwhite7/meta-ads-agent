/**
 * @module __tests__/tools/campaign/scale-campaign
 *
 * Unit tests for the scale_campaign tool.
 * Validates guardrail enforcement: max scale factor, minimum budget floor,
 * and approval threshold for large budget increases.
 */

import { describe, it, expect, vi } from "vitest";
import { scaleCampaignTool } from "../../../tools/campaign/scale-campaign.js";
import type { ToolContext, Campaign, PendingAction } from "../../../tools/types.js";

/** Factory for a minimal mock ToolContext. */
function createMockContext(
  overrides: Partial<{
    campaign: Campaign | null;
    showError: Error;
    minDailyBudget: number;
    maxBudgetScaleFactor: number;
    requireApprovalAbove: number;
  }> = {},
): ToolContext {
  const campaign: Campaign | null = overrides.campaign ?? {
    id: "camp_001",
    name: "Test Campaign",
    status: "ACTIVE",
    objective: "OUTCOME_SALES",
    dailyBudget: 100,
    createdTime: "2024-01-01T00:00:00Z",
    updatedTime: "2024-06-01T00:00:00Z",
  };

  return {
    metaClient: {
      campaigns: {
        list: vi.fn(),
        show: overrides.showError
          ? vi.fn().mockRejectedValue(overrides.showError)
          : vi.fn().mockResolvedValue(campaign),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue({ ...campaign, dailyBudget: 150, status: campaign?.status ?? "ACTIVE" }),
        delete: vi.fn(),
      },
      adSets: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
      ads: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
      splitTests: { create: vi.fn(), get: vi.fn() },
    },
    auditLogger: { record: vi.fn().mockResolvedValue(undefined) },
    goals: { roasTarget: 4.0, cpaCap: 25.0, dailyBudgetLimit: 1000, riskLevel: "moderate" },
    guardrails: {
      minDailyBudget: overrides.minDailyBudget ?? 5,
      maxBudgetScaleFactor: overrides.maxBudgetScaleFactor ?? 2,
      requireApprovalAbove: overrides.requireApprovalAbove ?? 200,
      coolDownTicks: 2,
    },
    db: {},
  };
}

describe("scaleCampaignTool", () => {
  it("has correct tool metadata", () => {
    expect(scaleCampaignTool.name).toBe("scale_campaign");
    expect(scaleCampaignTool.description).toContain("Scale");
    expect(scaleCampaignTool.parameters).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Guardrail: max scale factor
  // -----------------------------------------------------------------------

  it("rejects scale factor exceeding maxBudgetScaleFactor", async () => {
    const ctx = createMockContext({ maxBudgetScaleFactor: 2.0 });

    const result = await scaleCampaignTool.execute(
      { campaignId: "camp_001", scaleFactor: 2.5, reason: "Testing limits" },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("GUARDRAIL_MAX_SCALE_EXCEEDED");
    expect(result.error).toContain("2.5");
    expect(result.error).toContain("2");
    // MetaClient should NOT have been called
    expect(ctx.metaClient.campaigns.show).not.toHaveBeenCalled();
  });

  it("allows scale factor at exactly the max limit", async () => {
    const ctx = createMockContext({ maxBudgetScaleFactor: 2.0 });

    const result = await scaleCampaignTool.execute(
      { campaignId: "camp_001", scaleFactor: 2.0, reason: "Scaling to max" },
      ctx,
    );

    // With budget $100 * 2.0 = $200, increase = $100 < $200 threshold
    expect(result.success).toBe(true);
    const data = result.data as { action: string; newBudget: number };
    expect(data.action).toBe("scaled");
    expect(data.newBudget).toBe(200);
  });

  // -----------------------------------------------------------------------
  // Guardrail: minimum budget floor
  // -----------------------------------------------------------------------

  it("rejects when new budget falls below minDailyBudget", async () => {
    const campaign: Campaign = {
      id: "camp_002",
      name: "Low Budget Campaign",
      status: "ACTIVE",
      objective: "OUTCOME_TRAFFIC",
      dailyBudget: 8,
      createdTime: "2024-01-01T00:00:00Z",
      updatedTime: "2024-06-01T00:00:00Z",
    };

    const ctx = createMockContext({ campaign, minDailyBudget: 5 });

    // $8 * 0.5 = $4, which is below $5 minimum
    const result = await scaleCampaignTool.execute(
      { campaignId: "camp_002", scaleFactor: 0.5, reason: "Reducing budget" },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("GUARDRAIL_MIN_BUDGET_VIOLATED");
    expect(result.error).toContain("4.00");
    expect(result.error).toContain("5.00");
  });

  // -----------------------------------------------------------------------
  // Guardrail: approval threshold
  // -----------------------------------------------------------------------

  it("returns pending action when increase exceeds approval threshold", async () => {
    const ctx = createMockContext({
      maxBudgetScaleFactor: 3.0,
      requireApprovalAbove: 50,
    });

    // $100 * 1.8 = $180, increase = $80 > $50 threshold
    const result = await scaleCampaignTool.execute(
      { campaignId: "camp_001", scaleFactor: 1.8, reason: "Scaling up" },
      ctx,
    );

    expect(result.success).toBe(true);
    const data = result.data as { action: string; pendingAction: PendingAction };
    expect(data.action).toBe("pending_approval");
    expect(data.pendingAction).toBeDefined();
    expect(data.pendingAction.toolName).toBe("scale_campaign");
    expect(data.pendingAction.reason).toContain("80.00");
    expect(data.pendingAction.reason).toContain("50.00");

    // MetaClient.update should NOT have been called
    expect(ctx.metaClient.campaigns.update).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Successful scaling
  // -----------------------------------------------------------------------

  it("scales budget successfully when all guardrails pass", async () => {
    const ctx = createMockContext({
      maxBudgetScaleFactor: 3.0,
      requireApprovalAbove: 200,
    });

    // $100 * 1.5 = $150, increase = $50 < $200 threshold
    const result = await scaleCampaignTool.execute(
      { campaignId: "camp_001", scaleFactor: 1.5, reason: "Good performance" },
      ctx,
    );

    expect(result.success).toBe(true);
    const data = result.data as {
      action: string;
      previousBudget: number;
      newBudget: number;
      scaleFactor: number;
    };
    expect(data.action).toBe("scaled");
    expect(data.previousBudget).toBe(100);
    expect(data.newBudget).toBe(150);
    expect(data.scaleFactor).toBe(1.5);

    // MetaClient.update should have been called with cents
    expect(ctx.metaClient.campaigns.update).toHaveBeenCalledWith("camp_001", {
      daily_budget: 15000,
    });
  });

  it("scales budget down successfully", async () => {
    const ctx = createMockContext({
      maxBudgetScaleFactor: 2.0,
      minDailyBudget: 5,
    });

    // $100 * 0.7 = $70, well above $5 minimum
    const result = await scaleCampaignTool.execute(
      { campaignId: "camp_001", scaleFactor: 0.7, reason: "Reducing spend" },
      ctx,
    );

    expect(result.success).toBe(true);
    const data = result.data as { action: string; newBudget: number };
    expect(data.action).toBe("scaled");
    expect(data.newBudget).toBe(70);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("returns error when campaign is not found", async () => {
    const ctx = createMockContext({ campaign: null });

    const result = await scaleCampaignTool.execute(
      { campaignId: "camp_999", scaleFactor: 1.5, reason: "Scale up" },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("CAMPAIGN_NOT_FOUND");
  });

  it("records audit log on successful scaling", async () => {
    const ctx = createMockContext({
      maxBudgetScaleFactor: 3.0,
      requireApprovalAbove: 200,
    });

    await scaleCampaignTool.execute(
      { campaignId: "camp_001", scaleFactor: 1.5, reason: "Good ROAS" },
      ctx,
    );

    expect(ctx.auditLogger.record).toHaveBeenCalledTimes(1);
    const entry = (ctx.auditLogger.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entry.toolName).toBe("scale_campaign");
    expect(entry.outcome).toContain("$100.00");
    expect(entry.outcome).toContain("$150.00");
  });

  it("returns error on MetaClient failure", async () => {
    const ctx = createMockContext({
      showError: new Error("Network timeout"),
    });

    const result = await scaleCampaignTool.execute(
      { campaignId: "camp_001", scaleFactor: 1.5, reason: "Scale" },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Network timeout");
    expect(result.errorCode).toBe("META_API_ERROR");
  });
});
