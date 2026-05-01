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
import { type ToolResult, createTool } from "../types.js";

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
		status: Type.Optional(
			Type.Union([Type.Literal("ACTIVE"), Type.Literal("PAUSED"), Type.Literal("ALL")], {
				default: "ALL",
				description: "Filter by campaign status",
			}),
		),
	}),
	async execute(params, context): Promise<ToolResult> {
		const { status } = params;
		const filterStatus = status ?? "ALL";

		try {
			/* The MetaClient.campaigns.list signature accepts only an adAccountId.
			 * We filter the result client-side rather than threading status into
			 * the underlying CLI call (which doesn't accept that flag). */
			const rawCampaigns = await context.metaClient.campaigns.list(context.adAccountId);
			const campaigns =
				filterStatus === "ALL"
					? rawCampaigns
					: rawCampaigns.filter((c: { status?: string }) => c.status === filterStatus);

			if (context.auditLogger) {
				await context.auditLogger.logDecision({
					sessionId: context.sessionId,
					adAccountId: context.adAccountId,
					toolName: "list_campaigns",
					params: { adAccountId: context.adAccountId, status: filterStatus },
					reasoning: "Routine list_campaigns invocation",
					expectedOutcome: `Retrieved ${campaigns.length} campaign(s) with status='${filterStatus}'`,
					score: 0,
					riskLevel: "low",
					success: true,
					resultData: { count: campaigns.length },
					errorMessage: null,
				});
			}

			return {
				success: true,
				data: {
					campaigns,
					count: campaigns.length,
					adAccountId: context.adAccountId,
					filterStatus,
				},
				message: `Retrieved ${campaigns.length} campaign(s) for ${context.adAccountId} with status filter '${filterStatus}'.`,
			};
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error listing campaigns";

			return {
				success: false,
				data: null,
				error: `Failed to list campaigns for ${context.adAccountId}: ${message}`,
				message: `Failed to list campaigns for ${context.adAccountId}: ${message}`,
				errorCode: "META_API_ERROR",
			};
		}
	},
});
