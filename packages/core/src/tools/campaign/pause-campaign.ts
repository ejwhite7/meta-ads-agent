/**
 * @module tools/campaign/pause-campaign
 *
 * Pauses a running Meta campaign. The agent reaches for this when a
 * campaign is underperforming, overspending, or needs to be stopped
 * for any reason. Every pause is recorded by the session's audit
 * pass after the tool returns — see DESIGN.md / AGENTS.md.
 *
 * Part of the **Act** phase in the OODA cycle.
 *
 * Notes on dry-run and audit logging (PR #36):
 *   - In `context.dryRun` mode, the tool returns success WITHOUT
 *     calling MetaClient.campaigns.update. The audit log still
 *     records the intended action via the session's post-execute
 *     pass. Pre-PR-#36 the tool ignored dryRun and always mutated.
 *   - The tool itself does NOT call `auditLogger.logDecision`. The
 *     session loop logs every executor.execute(...) result, so
 *     in-tool logging produced duplicate audit rows. Pre-PR-#36
 *     this tool double-logged on every execution.
 */

import { Type } from "@sinclair/typebox";
import { type ToolResult, createTool } from "../types.js";

export const pauseCampaignTool = createTool({
	name: "pause_campaign",
	description:
		"Pause an active Meta campaign. Validates the campaign exists, sets " +
		"status to PAUSED. Honors dry-run mode (returns success without mutating).",
	parameters: Type.Object({
		campaignId: Type.String({
			description: "Meta campaign ID to pause",
		}),
		reason: Type.String({
			description: "Why the campaign is being paused — recorded in the audit trail",
		}),
	}),
	async execute(params, context): Promise<ToolResult> {
		const { campaignId, reason } = params;

		try {
			const campaign = await context.metaClient.campaigns.get(campaignId);
			if (!campaign) {
				return {
					success: false,
					data: null,
					error: `Campaign ${campaignId} not found`,
					message: `Campaign ${campaignId} not found`,
					errorCode: "CAMPAIGN_NOT_FOUND",
				};
			}

			/* Idempotency: already-paused is a no-op success. The session's
			 * audit pass still records this so the operator sees the agent
			 * considered the action. */
			if (campaign.status === "PAUSED") {
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
					message: `Campaign ${campaignId} was already paused.`,
				};
			}

			/* Dry-run short-circuit: log intent only. Mirrors the pattern
			 * used by set_budget. The session's audit pass records the
			 * proposal regardless. */
			if (context.dryRun) {
				return {
					success: true,
					data: {
						dryRun: true,
						campaignId,
						campaignName: campaign.name,
						previousStatus: campaign.status,
						newStatus: "PAUSED",
						action: "would_pause",
						reason,
					},
					message: `[DRY RUN] Would pause campaign ${campaignId} ('${campaign.name}'). Reason: ${reason}`,
				};
			}

			const updated = await context.metaClient.campaigns.update(campaignId, {
				status: "PAUSED",
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
				message: `Campaign ${campaignId} paused successfully.`,
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
