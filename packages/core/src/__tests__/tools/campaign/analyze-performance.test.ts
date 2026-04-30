/**
 * @module __tests__/tools/campaign/analyze-performance
 *
 * Unit tests for the analyze_performance tool.
 * Validates ROAS gap and CPA gap calculations, trend detection,
 * and edge cases (missing insights, campaign not found).
 */

import { describe, it, expect, vi } from "vitest";
import { analyzePerformanceTool } from "../../../tools/campaign/analyze-performance.js";
import type { ToolContext, Campaign, CampaignInsights } from "../../../tools/types.js";

/** Factory for a minimal mock ToolContext. */
function createMockContext(
  overrides: Partial<{
    campaign: Campaign | null;
    roasTarget: number;
    cpaCap: number;
    showError: Error;
  }> = {},
): ToolContext {
  const campaign = overrides.campaign ?? null;

  return {
    metaClient: {
      campaigns: {
        list: vi.fn(),
        show: overrides.showError
          ? vi.fn().mockRejectedValue(overrides.showError)
          : vi.fn().mockResolvedValue(campaign),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      adSets: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
      ads: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
      splitTests: { create: vi.fn(), get: vi.fn() },
    },
    auditLogger: { record: vi.fn().mockResolvedValue(undefined) },
    goals: {
      roasTarget: overrides.roasTarget ?? 4.0,
      cpaCap: overrides.cpaCap ?? 25.0,
      dailyBudgetLimit: 1000,
      riskLevel: "moderate",
    },
    guardrails: { minDailyBudget: 5, maxBudgetScaleFactor: 3, requireApprovalAbove: 500, coolDownTicks: 2 },
    db: {},
  };
}

/** Helper to build a campaign with specific metrics. */
function campaignWithInsights(
  insightsOverrides: Partial<CampaignInsights> = {},
): Campaign {
  return {
    id: "camp_001",
    name: "Performance Test Campaign",
    status: "ACTIVE",
    objective: "OUTCOME_SALES",
    dailyBudget: 100,
    createdTime: "2024-01-01T00:00:00Z",
    updatedTime: "2024-06-01T00:00:00Z",
    insights: {
      spend: 700,
      impressions: 100000,
      clicks: 3000,
      conversions: 50,
      revenue: 3500,
      roas: 5.0,
      cpa: 14.0,
      cpm: 7.0,
      ctr: 0.03,
      ...insightsOverrides,
    },
  };
}

describe("analyzePerformanceTool", () => {
  it("has correct tool metadata", () => {
    expect(analyzePerformanceTool.name).toBe("analyze_performance");
    expect(analyzePerformanceTool.description).toContain("Analyze");
    expect(analyzePerformanceTool.parameters).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // ROAS gap calculation
  // -----------------------------------------------------------------------

  describe("ROAS gap", () => {
    it("computes positive gap when ROAS is above target", async () => {
      // ROAS 5.0 vs target 4.0 => gap = +1.0
      const campaign = campaignWithInsights({ roas: 5.0 });
      const ctx = createMockContext({ campaign, roasTarget: 4.0 });

      const result = await analyzePerformanceTool.execute(
        { campaignId: "camp_001", dateRange: "last_7d" },
        ctx,
      );

      expect(result.success).toBe(true);
      const data = result.data as { roasGap: number; roasStatus: string };
      expect(data.roasGap).toBe(1.0);
      expect(data.roasStatus).toBe("above_target");
    });

    it("computes negative gap when ROAS is below target", async () => {
      // ROAS 2.5 vs target 4.0 => gap = -1.5
      const campaign = campaignWithInsights({ roas: 2.5 });
      const ctx = createMockContext({ campaign, roasTarget: 4.0 });

      const result = await analyzePerformanceTool.execute(
        { campaignId: "camp_001", dateRange: "last_7d" },
        ctx,
      );

      expect(result.success).toBe(true);
      const data = result.data as { roasGap: number; roasStatus: string };
      expect(data.roasGap).toBeCloseTo(-1.5);
      expect(data.roasStatus).toBe("below_target");
    });

    it("reports on_target when ROAS is within 5% threshold", async () => {
      // ROAS 4.1 vs target 4.0 => gap = 0.1, percent = 2.5% < 5%
      const campaign = campaignWithInsights({ roas: 4.1 });
      const ctx = createMockContext({ campaign, roasTarget: 4.0 });

      const result = await analyzePerformanceTool.execute(
        { campaignId: "camp_001", dateRange: "last_7d" },
        ctx,
      );

      expect(result.success).toBe(true);
      const data = result.data as { roasGap: number; roasStatus: string };
      expect(data.roasGap).toBeCloseTo(0.1);
      expect(data.roasStatus).toBe("on_target");
    });
  });

  // -----------------------------------------------------------------------
  // CPA gap calculation
  // -----------------------------------------------------------------------

  describe("CPA gap", () => {
    it("computes negative gap when CPA is below cap (efficient)", async () => {
      // CPA $14 vs cap $25 => gap = -$11
      const campaign = campaignWithInsights({ cpa: 14.0 });
      const ctx = createMockContext({ campaign, cpaCap: 25.0 });

      const result = await analyzePerformanceTool.execute(
        { campaignId: "camp_001", dateRange: "last_7d" },
        ctx,
      );

      expect(result.success).toBe(true);
      const data = result.data as { cpaGap: number; cpaStatus: string };
      expect(data.cpaGap).toBe(-11.0);
      expect(data.cpaStatus).toBe("below_cap");
    });

    it("computes positive gap when CPA exceeds cap (too expensive)", async () => {
      // CPA $35 vs cap $25 => gap = +$10
      const campaign = campaignWithInsights({ cpa: 35.0 });
      const ctx = createMockContext({ campaign, cpaCap: 25.0 });

      const result = await analyzePerformanceTool.execute(
        { campaignId: "camp_001", dateRange: "last_7d" },
        ctx,
      );

      expect(result.success).toBe(true);
      const data = result.data as { cpaGap: number; cpaStatus: string };
      expect(data.cpaGap).toBe(10.0);
      expect(data.cpaStatus).toBe("above_cap");
    });

    it("reports on_target when CPA is within 5% threshold", async () => {
      // CPA $25.5 vs cap $25 => gap = $0.5, percent = 2% < 5%
      const campaign = campaignWithInsights({ cpa: 25.5 });
      const ctx = createMockContext({ campaign, cpaCap: 25.0 });

      const result = await analyzePerformanceTool.execute(
        { campaignId: "camp_001", dateRange: "last_7d" },
        ctx,
      );

      expect(result.success).toBe(true);
      const data = result.data as { cpaStatus: string };
      expect(data.cpaStatus).toBe("on_target");
    });
  });

  // -----------------------------------------------------------------------
  // Trend detection
  // -----------------------------------------------------------------------

  describe("trend", () => {
    it("detects improving trend when ROAS above target and CPA below cap", async () => {
      const campaign = campaignWithInsights({ roas: 5.0, cpa: 14.0 });
      const ctx = createMockContext({ campaign, roasTarget: 4.0, cpaCap: 25.0 });

      const result = await analyzePerformanceTool.execute(
        { campaignId: "camp_001", dateRange: "last_7d" },
        ctx,
      );

      const data = result.data as { trend: string };
      expect(data.trend).toBe("improving");
    });

    it("detects declining trend when ROAS below target and CPA above cap", async () => {
      const campaign = campaignWithInsights({ roas: 2.0, cpa: 35.0 });
      const ctx = createMockContext({ campaign, roasTarget: 4.0, cpaCap: 25.0 });

      const result = await analyzePerformanceTool.execute(
        { campaignId: "camp_001", dateRange: "last_7d" },
        ctx,
      );

      const data = result.data as { trend: string };
      expect(data.trend).toBe("declining");
    });

    it("detects stable trend when metrics are mixed", async () => {
      // ROAS above target but CPA also above cap
      const campaign = campaignWithInsights({ roas: 5.0, cpa: 30.0 });
      const ctx = createMockContext({ campaign, roasTarget: 4.0, cpaCap: 25.0 });

      const result = await analyzePerformanceTool.execute(
        { campaignId: "camp_001", dateRange: "last_7d" },
        ctx,
      );

      const data = result.data as { trend: string };
      expect(data.trend).toBe("stable");
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  it("returns error when campaign is not found", async () => {
    const ctx = createMockContext({ campaign: null });

    const result = await analyzePerformanceTool.execute(
      { campaignId: "camp_999", dateRange: "last_7d" },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("CAMPAIGN_NOT_FOUND");
  });

  it("returns error when campaign has no insights data", async () => {
    const campaign: Campaign = {
      id: "camp_003",
      name: "New Campaign",
      status: "ACTIVE",
      objective: "OUTCOME_SALES",
      dailyBudget: 50,
      createdTime: "2024-06-01T00:00:00Z",
      updatedTime: "2024-06-01T00:00:00Z",
      // no insights property
    };

    const ctx = createMockContext({ campaign });

    const result = await analyzePerformanceTool.execute(
      { campaignId: "camp_003", dateRange: "last_7d" },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("NO_INSIGHTS_DATA");
  });

  it("includes a human-readable summary", async () => {
    const campaign = campaignWithInsights({ roas: 5.0, cpa: 14.0, spend: 700, conversions: 50, ctr: 0.03 });
    const ctx = createMockContext({ campaign, roasTarget: 4.0, cpaCap: 25.0 });

    const result = await analyzePerformanceTool.execute(
      { campaignId: "camp_001", dateRange: "last_7d" },
      ctx,
    );

    const data = result.data as { summary: string };
    expect(data.summary).toContain("Performance Test Campaign");
    expect(data.summary).toContain("5.00");
    expect(data.summary).toContain("4.00");
    expect(data.summary).toContain("$14.00");
    expect(data.summary).toContain("$25.00");
  });

  it("records audit entry with performance summary", async () => {
    const campaign = campaignWithInsights({ roas: 5.0, cpa: 14.0 });
    const ctx = createMockContext({ campaign });

    await analyzePerformanceTool.execute(
      { campaignId: "camp_001", dateRange: "last_30d" },
      ctx,
    );

    expect(ctx.auditLogger.record).toHaveBeenCalledTimes(1);
    const entry = (ctx.auditLogger.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entry.toolName).toBe("analyze_performance");
    expect(entry.outcome).toContain("Performance Test Campaign");
  });

  it("returns error on MetaClient failure", async () => {
    const ctx = createMockContext({ showError: new Error("Timeout") });

    const result = await analyzePerformanceTool.execute(
      { campaignId: "camp_001", dateRange: "last_7d" },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Timeout");
    expect(result.errorCode).toBe("META_API_ERROR");
  });
});
