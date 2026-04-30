/**
 * @module tools/campaign/duplicate-campaign
 *
 * Duplicates an existing Meta campaign — copies the campaign structure
 * (objective, budget) and creates a paused copy for review. This is
 * useful when the agent wants to test variations of a winning campaign
 * without modifying the original.
 *
 * The copy is always created in PAUSED state regardless of the source
 * campaign's status, ensuring no accidental spend before human review.
 *
 * Part of the **Act** phase in the OODA cycle.
 */

import { Type } from "@sinclair/typebox";
import { type ToolResult, createTool } from "../types.js";

/**
 * Tool: duplicate_campaign
 *
 * Reads the source campaign, creates a new campaign with identical
 * objective and budget, names it with the provided `newName`, and
 * pauses it for review.
 */
export const duplicateCampaignTool = createTool({
	name: "duplicate_campaign",
	description:
		"Duplicate an existing campaign — copies its objective and budget into " +
		"a new PAUSED campaign for review. The original campaign is not modified.",
	parameters: Type.Object({
		sourceCampaignId: Type.String({
			description: "ID of the campaign to duplicate",
		}),
		newName: Type.String({
			description: "Name for the duplicated campaign",
		}),
		reason: Type.String({
			description: "Why the campaign is being duplicated — logged to the audit trail",
		}),
	}),
	async execute(params, context): Promise<ToolResult> {
		const { sourceCampaignId, newName, reason } = params;

		try {
			/* ------------------------------------------------------------------
			 * Step 1: Fetch the source campaign
			 * ----------------------------------------------------------------*/
			const source = await context.metaClient.campaigns.show(sourceCampaignId);

			if (!source) {
				return {
					success: false,
					data: null,
					error: `Source campaign ${sourceCampaignId} not found`,
					message: `Source campaign ${sourceCampaignId} not found`,
					errorCode: "CAMPAIGN_NOT_FOUND",
				};
			}

			/* ------------------------------------------------------------------
			 * Step 2: Validate the new name
			 * ----------------------------------------------------------------*/
			const trimmedName = newName.trim();
			if (trimmedName.length === 0) {
				return {
					success: false,
					data: null,
					error: "New campaign name must not be empty",
					message: "New campaign name must not be empty",
					errorCode: "VALIDATION_ERROR",
				};
			}

			/* ------------------------------------------------------------------
			 * Step 3: Extract the ad account ID from the source campaign ID
			 *
			 * Campaign IDs in Meta are numeric; we need the ad account ID from
			 * context or derive it. The source campaign already belongs to an
			 * account, so we pass the account ID through the campaign's context.
			 * For safety, we parse the account from the campaign's metadata
			 * or use a well-known pattern.
			 * ----------------------------------------------------------------*/
			const budgetInCents = Math.round(source.dailyBudget * 100);

			// Create the duplicate in the same account the source belongs to.
			// The ad account ID is extracted from the context or the campaign.
			const adAccountId =
				((source as Record<string, unknown>).accountId as string) ?? `act_${sourceCampaignId}`;

			const copy = await context.metaClient.campaigns.create(adAccountId, {
				name: trimmedName,
				objective: source.objective,
				daily_budget: budgetInCents,
				status: "PAUSED",
			});

			/* ------------------------------------------------------------------
			 * Step 4: Audit log
			 * ----------------------------------------------------------------*/
			await context.auditLogger.record({
				toolName: "duplicate_campaign",
				toolParams: { sourceCampaignId, newName: trimmedName, reason },
				outcome:
					`Duplicated campaign '${source.name}' (${sourceCampaignId}) -> ` +
					`'${trimmedName}' (${copy.id}). Objective: ${source.objective}, ` +
					`budget: $${source.dailyBudget.toFixed(2)}/day. Copy is PAUSED. ` +
					`Reason: ${reason}`,
				timestamp: new Date().toISOString(),
			});

			return {
				success: true,
				data: {
					action: "duplicated",
					sourceCampaignId,
					sourceCampaignName: source.name,
					newCampaignId: copy.id,
					newCampaignName: trimmedName,
					objective: source.objective,
					dailyBudget: source.dailyBudget,
					status: "PAUSED",
					reason,
				},
							message: "Campaign duplicated successfully.",
};
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error duplicating campaign";

			return {
				success: false,
				data: null,
				error: `Failed to duplicate campaign ${sourceCampaignId}: ${message}`,
				message: `Failed to duplicate campaign ${sourceCampaignId}: ${message}`,
				errorCode: "META_API_ERROR",
			};
		}
	},
});
