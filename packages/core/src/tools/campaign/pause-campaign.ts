/**
 * @module tools/campaign/pause-campaign
 *
 * Pauses a running Meta campaign. This is a protective action the agent
 * takes when a campaign is underperforming, overspending, or needs to be
 * stopped for any reason. Every pause is logged to the audit trail with
 * the agent's reasoning.
 *
 * Part of the **Act** phase in the OODA cycle.
 */

import { Type } from "@sinclair/typebox";
import { type ToolResult, createTool } from "../types.js";

/**
 * Tool: pause_campaign
 *
 * Pauses an active campaign by setting its status to PAUSED. Validates
 * that the campaign exists before attempting the pause. Records the
 * action and its reason in the audit log for traceability.
 */
export const pauseCampaignTool = createTool({
	name: "pause_campaign",
	description:
		"Pause an active Meta campaign. Validates the campaign exists, " +
		"sets status to PAUSED, and logs the reason to the audit trail.",
	parameters: Type.Object({
		campaignId: Type.String({
			description: "Meta campaign ID to pause",
		}),
		reason: Type.String({
			description: "Why the campaign is being paused — logged to the audit trail for traceability",
		}),
	}),
	async execute(params, context): Promise<ToolResult> {
		const { campaignId, reason } = params;

		try {
			/* ------------------------------------------------------------------
			 * Step 1: Validate the campaign exists
			 * ----------------------------------------------------------------*/
			const campaign = await context.metaClient.campaigns.show(campaignId);

			if (!campaign) {
				return {
					success: false,
					data: null,
					error: `Campaign ${campaignId} not found`,
					message: `Campaign ${campaignId} not found`,
					errorCode: "CAMPAIGN_NOT_FOUND",
				};
			}

			/* ------------------------------------------------------------------
			 * Step 2: Check if already paused — no-op with informational result
			 * ----------------------------------------------------------------*/
			if (campaign.status === "PAUSED") {
				await context.auditLogger.record({
					toolName: "pause_campaign",
					toolParams: { campaignId, reason },
					outcome: `Campaign ${campaignId} ('${campaign.name}') is already paused — no action taken`,
					timestamp: new Date().toISOString(),
				});

				return {
					success: true,
					data: {
						campaignId,
						campaignName: campaign.name,
						previousStatus: "PAUSED",
						newStatus: "PAUSED",
						action: "none",
						reason,
					},
								message: `Campaign ${params.campaignId} paused successfully.`,
};
			}

			/* ------------------------------------------------------------------
			 * Step 3: Pause the campaign
			 * ----------------------------------------------------------------*/
			const updated = await context.metaClient.campaigns.update(campaignId, {
				status: "PAUSED",
			});

			/* ------------------------------------------------------------------
			 * Step 4: Record in audit log
			 * ----------------------------------------------------------------*/
			await context.auditLogger.record({
				toolName: "pause_campaign",
				toolParams: { campaignId, reason },
				outcome: `Paused campaign ${campaignId} ('${campaign.name}'). Previous status: ${campaign.status}. Reason: ${reason}`,
				timestamp: new Date().toISOString(),
			});

			return {
				success: true,
				data: {
					campaignId,
					campaignName: campaign.name,
					previousStatus: campaign.status,
					newStatus: updated.status,
					action: "paused",
					reason,
				},
							message: `Campaign ${params.campaignId} paused successfully.`,
};
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error pausing campaign";

			return {
				success: false,
				data: null,
				error: `Failed to pause campaign ${campaignId}: ${message}`,
				message: `Failed to pause campaign ${campaignId}: ${message}`,
				errorCode: "META_API_ERROR",
			};
		}
	},
});
