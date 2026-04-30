/**
 * @module __tests__/tools/campaign/list-campaigns
 *
 * Unit tests for the list_campaigns tool.
 * Validates campaign listing with mocked MetaClient, status filtering,
 * and error handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { listCampaignsTool } from "../../../tools/campaign/list-campaigns.js";
import type { ToolContext, Campaign } from "../../../tools/types.js";

/** Factory for a minimal mock ToolContext. */
function createMockContext(
  overrides: Partial<{
    campaigns: Campaign[];
    listError: Error;
  }> = {},
): ToolContext {
  const campaigns = overrides.campaigns ?? [];

  return {
    metaClient: {
      campaigns: {
        list: overrides.listError
          ? vi.fn().mockRejectedValue(overrides.listError)
          : vi.fn().mockResolvedValue(campaigns),
        show: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      adSets: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
      ads: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
      splitTests: { create: vi.fn(), get: vi.fn() },
    },
    auditLogger: { record: vi.fn().mockResolvedValue(undefined) },
    goals: { roasTarget: 4.0, cpaCap: 25.0, dailyBudgetLimit: 1000, riskLevel: "moderate" },
    guardrails: { minDailyBudget: 5, maxBudgetScaleFactor: 3, requireApprovalAbove: 500, coolDownTicks: 2 },
    db: {},
  };
}

/** Sample campaign data for testing. */
const sampleCampaigns: Campaign[] = [
  {
    id: "camp_001",
    name: "Summer Sale",
    status: "ACTIVE",
    objective: "OUTCOME_SALES",
    dailyBudget: 50,
    createdTime: "2024-01-15T10:00:00Z",
    updatedTime: "2024-06-01T14:30:00Z",
    insights: {
      spend: 350, impressions: 50000, clicks: 1200,
      conversions: 45, revenue: 1800, roas: 5.14,
      cpa: 7.78, cpm: 7.0, ctr: 0.024,
    },
  },
  {
    id: "camp_002",
    name: "Brand Awareness Q2",
    status: "PAUSED",
    objective: "OUTCOME_AWARENESS",
    dailyBudget: 30,
    createdTime: "2024-03-01T08:00:00Z",
    updatedTime: "2024-05-15T11:00:00Z",
  },
];

describe("listCampaignsTool", () => {
  it("has correct tool metadata", () => {
    expect(listCampaignsTool.name).toBe("list_campaigns");
    expect(listCampaignsTool.description).toContain("List all campaigns");
    expect(listCampaignsTool.parameters).toBeDefined();
  });

  it("lists all campaigns when status is ALL", async () => {
    const ctx = createMockContext({ campaigns: sampleCampaigns });

    const result = await listCampaignsTool.execute(
      { adAccountId: "act_123456", status: "ALL" },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();

    const data = result.data as { campaigns: Campaign[]; count: number };
    expect(data.campaigns).toHaveLength(2);
    expect(data.count).toBe(2);
    expect(data.adAccountId).toBe("act_123456");
    expect(ctx.metaClient.campaigns.list).toHaveBeenCalledWith("act_123456", {});
  });

  it("passes status filter to MetaClient when not ALL", async () => {
    const ctx = createMockContext({ campaigns: [sampleCampaigns[0]] });

    const result = await listCampaignsTool.execute(
      { adAccountId: "act_123456", status: "ACTIVE" },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(ctx.metaClient.campaigns.list).toHaveBeenCalledWith("act_123456", {
      status: "ACTIVE",
    });
  });

  it("defaults to ALL when status is omitted", async () => {
    const ctx = createMockContext({ campaigns: sampleCampaigns });

    const result = await listCampaignsTool.execute(
      { adAccountId: "act_123456" },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(ctx.metaClient.campaigns.list).toHaveBeenCalledWith("act_123456", {});
  });

  it("records an audit entry on success", async () => {
    const ctx = createMockContext({ campaigns: sampleCampaigns });

    await listCampaignsTool.execute(
      { adAccountId: "act_123456", status: "ALL" },
      ctx,
    );

    expect(ctx.auditLogger.record).toHaveBeenCalledTimes(1);
    const entry = (ctx.auditLogger.record as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(entry.toolName).toBe("list_campaigns");
    expect(entry.outcome).toContain("2 campaign(s)");
  });

  it("returns an empty list gracefully", async () => {
    const ctx = createMockContext({ campaigns: [] });

    const result = await listCampaignsTool.execute(
      { adAccountId: "act_123456", status: "ACTIVE" },
      ctx,
    );

    expect(result.success).toBe(true);
    const data = result.data as { count: number };
    expect(data.count).toBe(0);
  });

  it("returns error on MetaClient failure", async () => {
    const ctx = createMockContext({
      listError: new Error("Rate limit exceeded"),
    });

    const result = await listCampaignsTool.execute(
      { adAccountId: "act_123456", status: "ALL" },
      ctx,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Rate limit exceeded");
    expect(result.errorCode).toBe("META_API_ERROR");
  });
});
