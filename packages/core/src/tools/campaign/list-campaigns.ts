/**
 * @module tools/campaign/list-campaigns
 *
 * Lists all campaigns for a configured Meta ad account with their current
 * performance metrics. This tool is invoked during the **Observe** phase
 * of the OODA cycle to capture the current state of the advertising account.
 *
 * The agent uses the returned data to identify which campaigns need attention,
 * which are performing well, and which should be scaled or paused.
 */

import { Type } from "@sinclair/typebox";
import { createTool, type ToolResult } from "../types.js";

/**
 * Tool: list_campaigns
 *
 * Retrieves all campaigns for the specified ad account, optionally filtered
 * by status. Returns each campaign with its configuration and latest
 * performance metrics (spend, ROAS, CPA, CTR, etc.).
 */
export const listCampaignsTool = createTool({
  name: "list_campaigns",
  description:
    "List all campaigns for a Meta ad account with current performance metrics. " +
    "Used in the Observe phase to capture the current advertising state.",
  parameters: Type.Object({
    adAccountId: Type.String({
      description: "Meta ad account ID (format: act_XXXXXXXXXX)",
    }),
    status: Type.Optional(
      Type.Union(
        [
          Type.Literal("ACTIVE"),
          Type.Literal("PAUSED"),
          Type.Literal("ALL"),
        ],
        { default: "ALL", description: "Filter by campaign status" },
      ),
    ),
  }),
  async execute(params, context): Promise<ToolResult> {
    const { adAccountId, status } = params;
    const filterStatus = status ?? "ALL";

    try {
      const filterParams: Record<string, unknown> =
        filterStatus !== "ALL" ? { status: filterStatus } : {};

      const campaigns = await context.metaClient.campaigns.list(
        adAccountId,
        filterParams,
      );

      await context.auditLogger.record({
        toolName: "list_campaigns",
        toolParams: { adAccountId, status: filterStatus },
        outcome: `Retrieved ${campaigns.length} campaign(s) with status filter '${filterStatus}'`,
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        data: {
          campaigns,
          count: campaigns.length,
          adAccountId,
          filterStatus,
        },
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Unknown error listing campaigns";

      return {
        success: false,
        error: `Failed to list campaigns for ${adAccountId}: ${message}`,
        errorCode: "META_API_ERROR",
      };
    }
  },
});
