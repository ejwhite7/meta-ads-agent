/**
 * @module tools/campaign/analyze-performance
 *
 * Analyzes a campaign's performance against the agent's optimization goals.
 * Computes ROAS gap (actual vs. target), CPA gap (actual vs. cap), and
 * determines the performance trend (improving / declining / stable).
 *
 * This tool is used in the **Orient** phase of the OODA cycle — after
 * observing raw metrics, the agent uses this analysis to orient its
 * decision-making about what actions to take.
 *
 * The output is a structured performance analysis object consumed by
 * the decision engine to rank and score action proposals.
 */

import { Type } from "@sinclair/typebox";
import { createTool, type ToolResult, type CampaignInsights } from "../types.js";

/**
 * Performance trend direction computed from metric deltas.
 */
type TrendDirection = "improving" | "declining" | "stable";

/**
 * Structured performance analysis returned by the tool.
 */
interface PerformanceAnalysis {
  readonly campaignId: string;
  readonly campaignName: string;
  readonly dateRange: string;
  readonly metrics: CampaignInsights;
  readonly roasGap: number;
  readonly roasStatus: "above_target" | "below_target" | "on_target";
  readonly cpaGap: number;
  readonly cpaStatus: "above_cap" | "below_cap" | "on_target";
  readonly trend: TrendDirection;
  readonly summary: string;
}

/**
 * Threshold for considering a metric "on target" (within 5%).
 */
const ON_TARGET_THRESHOLD = 0.05;

/**
 * Determine performance trend based on recent metric changes.
 *
 * Heuristic: if ROAS improved and CPA decreased or stayed flat,
 * the campaign is improving. If ROAS declined and CPA increased,
 * it is declining. Otherwise, it is stable.
 *
 * @param roasGap - Difference between actual and target ROAS.
 * @param cpaGap - Difference between actual CPA and CPA cap.
 * @returns The computed trend direction.
 */
function computeTrend(roasGap: number, cpaGap: number): TrendDirection {
  const roasHealthy = roasGap >= 0;
  const cpaHealthy = cpaGap <= 0;

  if (roasHealthy && cpaHealthy) {
    return "improving";
  }

  if (!roasHealthy && !cpaHealthy) {
    return "declining";
  }

  return "stable";
}

/**
 * Tool: analyze_performance
 *
 * Fetches a campaign's metrics and computes performance gaps against the
 * agent's configured goals. Returns a structured analysis used by the
 * decision engine in the Orient phase.
 */
export const analyzePerformanceTool = createTool({
  name: "analyze_performance",
  description:
    "Analyze a campaign's performance vs. agent goals. Computes ROAS gap, " +
    "CPA gap, and trend direction (improving/declining/stable). Returns a " +
    "structured analysis for the Orient phase of the OODA cycle.",
  parameters: Type.Object({
    campaignId: Type.String({
      description: "Meta campaign ID to analyze",
    }),
    dateRange: Type.Union(
      [
        Type.Literal("last_3d"),
        Type.Literal("last_7d"),
        Type.Literal("last_30d"),
      ],
      {
        default: "last_7d",
        description: "Date range for performance analysis",
      },
    ),
  }),
  async execute(params, context): Promise<ToolResult> {
    const { campaignId, dateRange } = params;
    const selectedRange = dateRange ?? "last_7d";

    try {
      /* ------------------------------------------------------------------
       * Step 1: Fetch the campaign with performance metrics
       * ----------------------------------------------------------------*/
      const campaign = await context.metaClient.campaigns.show(campaignId);

      if (!campaign) {
        return {
          success: false,
          error: `Campaign ${campaignId} not found`,
          errorCode: "CAMPAIGN_NOT_FOUND",
        };
      }

      if (!campaign.insights) {
        return {
          success: false,
          error:
            `Campaign ${campaignId} has no performance data available. ` +
            "The campaign may be newly created or have zero delivery.",
          errorCode: "NO_INSIGHTS_DATA",
        };
      }

      const metrics = campaign.insights;
      const { roasTarget, cpaCap } = context.goals;

      /* ------------------------------------------------------------------
       * Step 2: Compute ROAS gap
       *
       * Positive gap = actual ROAS is above target (good)
       * Negative gap = actual ROAS is below target (needs attention)
       * ----------------------------------------------------------------*/
      const roasGap = metrics.roas - roasTarget;
      const roasGapPercent =
        roasTarget > 0 ? roasGap / roasTarget : 0;

      let roasStatus: PerformanceAnalysis["roasStatus"];
      if (Math.abs(roasGapPercent) <= ON_TARGET_THRESHOLD) {
        roasStatus = "on_target";
      } else if (roasGap > 0) {
        roasStatus = "above_target";
      } else {
        roasStatus = "below_target";
      }

      /* ------------------------------------------------------------------
       * Step 3: Compute CPA gap
       *
       * Negative gap = actual CPA is below cap (good — spending efficiently)
       * Positive gap = actual CPA is above cap (needs attention)
       * ----------------------------------------------------------------*/
      const cpaGap = metrics.cpa - cpaCap;
      const cpaGapPercent =
        cpaCap > 0 ? cpaGap / cpaCap : 0;

      let cpaStatus: PerformanceAnalysis["cpaStatus"];
      if (Math.abs(cpaGapPercent) <= ON_TARGET_THRESHOLD) {
        cpaStatus = "on_target";
      } else if (cpaGap > 0) {
        cpaStatus = "above_cap";
      } else {
        cpaStatus = "below_cap";
      }

      /* ------------------------------------------------------------------
       * Step 4: Compute trend direction
       * ----------------------------------------------------------------*/
      const trend = computeTrend(roasGap, cpaGap);

      /* ------------------------------------------------------------------
       * Step 5: Build human-readable summary
       * ----------------------------------------------------------------*/
      const summaryParts: string[] = [
        `Campaign '${campaign.name}' (${selectedRange}):`,
        `ROAS ${metrics.roas.toFixed(2)} vs. target ${roasTarget.toFixed(2)} (${roasStatus.replace("_", " ")})`,
        `CPA $${metrics.cpa.toFixed(2)} vs. cap $${cpaCap.toFixed(2)} (${cpaStatus.replace("_", " ")})`,
        `Trend: ${trend}`,
        `Spend: $${metrics.spend.toFixed(2)}, Conversions: ${metrics.conversions}, CTR: ${(metrics.ctr * 100).toFixed(2)}%`,
      ];

      const analysis: PerformanceAnalysis = {
        campaignId,
        campaignName: campaign.name,
        dateRange: selectedRange,
        metrics,
        roasGap,
        roasStatus,
        cpaGap,
        cpaStatus,
        trend,
        summary: summaryParts.join(" | "),
      };

      /* ------------------------------------------------------------------
       * Step 6: Audit log
       * ----------------------------------------------------------------*/
      await context.auditLogger.record({
        toolName: "analyze_performance",
        toolParams: { campaignId, dateRange: selectedRange },
        outcome: analysis.summary,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        data: analysis,
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown error analyzing campaign performance";

      return {
        success: false,
        error: `Failed to analyze campaign ${campaignId}: ${message}`,
        errorCode: "META_API_ERROR",
      };
    }
  },
});
