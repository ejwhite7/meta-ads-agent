/**
 * @module tools/campaign/pause-adset
 *
 * Pauses a single Meta ad set. Same shape as `pause_campaign` but
 * one level deeper in the hierarchy. The agent reaches for this when
 * one ad set within a campaign is dragging the campaign's KPI but the
 * campaign as a whole is on target — pausing the offending ad set is
 * the surgical intervention.
 *
 * Part of the **Act** phase in the OODA cycle.
 *
 * Behavior parity with pause_campaign (see PR #36):
 *   - Honors `context.dryRun` (returns success without mutating).
 *   - Does NOT call auditLogger.logDecision itself; the session's
 *     post-execute pass records every action exactly once.
 */

import { Type } from "@sinclair/typebox";
import { type ToolResult, createTool } from "../types.js";

export const pauseAdSetTool = createTool({
	name: "pause_adset",
	description:
		"Pause an active Meta ad set (one level below campaign). Validates the " +
		"ad set exists, sets status to PAUSED. Honors dry-run mode.",
	parameters: Type.Object({
		adSetId: Type.String({
			description: "Meta ad-set ID to pause",
		}),
		reason: Type.String({
			description: "Why the ad set is being paused — recorded in the audit trail",
		}),
	}),
	async execute(params, context): Promise<ToolResult> {
		const { adSetId, reason } = params;

		try {
			const adSet = await context.metaClient.adSets.get(adSetId);
			if (!adSet) {
				return {
					success: false,
					data: null,
					error: `Ad set ${adSetId} not found`,
					message: `Ad set ${adSetId} not found`,
					errorCode: "ADSET_NOT_FOUND",
				};
			}

			if (adSet.status === "PAUSED") {
				return {
					success: true,
					data: {
						adSetId,
						adSetName: adSet.name,
						previousStatus: "PAUSED",
						newStatus: "PAUSED",
						action: "none",
						reason,
					},
					message: `Ad set ${adSetId} was already paused.`,
				};
			}

			if (context.dryRun) {
				return {
					success: true,
					data: {
						dryRun: true,
						adSetId,
						adSetName: adSet.name,
						previousStatus: adSet.status,
						newStatus: "PAUSED",
						action: "would_pause",
						reason,
					},
					message: `[DRY RUN] Would pause ad set ${adSetId} ('${adSet.name}'). Reason: ${reason}`,
				};
			}

			const updated = await context.metaClient.adSets.update(adSetId, {
				status: "PAUSED",
			});

			return {
				success: true,
				data: {
					adSetId,
					adSetName: adSet.name,
					previousStatus: adSet.status,
					newStatus: updated.status,
					action: "paused",
					reason,
				},
				message: `Ad set ${adSetId} paused successfully.`,
			};
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error pausing ad set";
			return {
				success: false,
				data: null,
				error: `Failed to pause ad set ${adSetId}: ${message}`,
				message: `Failed to pause ad set ${adSetId}: ${message}`,
				errorCode: "META_API_ERROR",
			};
		}
	},
});
