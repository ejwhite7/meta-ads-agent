/**
 * @module tools/campaign/pause-adset
 *
 * Pauses a single Meta ad set. Same shape as `pause_campaign` but at
 * the next level of the hierarchy. The agent reaches for this when
 * one ad set within a campaign is dragging the campaign's KPI but
 * the campaign as a whole is on target — pausing the offending
 * ad set is the surgical intervention.
 *
 * Part of the **Act** phase in the OODA cycle.
 */

import { Type } from "@sinclair/typebox";
import { type ToolResult, createTool } from "../types.js";

export const pauseAdSetTool = createTool({
	name: "pause_adset",
	description:
		"Pause an active Meta ad set (one level below campaign). Validates " +
		"the ad set exists, sets status to PAUSED, and logs the reason to " +
		"the audit trail.",
	parameters: Type.Object({
		adSetId: Type.String({
			description: "Meta ad-set ID to pause",
		}),
		reason: Type.String({
			description: "Why the ad set is being paused — logged to the audit trail for traceability",
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

			/* Already-paused short-circuit. We still record the no-op in the
			 * audit log so the operator sees that the agent considered the
			 * action — silent skips are how decisions get lost. */
			if (adSet.status === "PAUSED") {
				if (context.auditLogger) {
					await context.auditLogger.logDecision({
						sessionId: context.sessionId,
						adAccountId: context.adAccountId,
						toolName: "pause_adset",
						params: { adSetId, reason },
						reasoning: reason,
						expectedOutcome: "already_paused",
						score: 0,
						riskLevel: "low",
						success: true,
						resultData: { previousStatus: "PAUSED", action: "none" },
						errorMessage: null,
					});
				}
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

			const updated = await context.metaClient.adSets.update(adSetId, {
				status: "PAUSED",
			});

			if (context.auditLogger) {
				await context.auditLogger.logDecision({
					sessionId: context.sessionId,
					adAccountId: context.adAccountId,
					toolName: "pause_adset",
					params: { adSetId, reason },
					reasoning: reason,
					expectedOutcome: `Paused ad set ${adSetId} ('${adSet.name}')`,
					score: 0,
					riskLevel: "low",
					success: true,
					resultData: {
						previousStatus: adSet.status,
						newStatus: "PAUSED",
						adSetName: adSet.name,
					},
					errorMessage: null,
				});
			}

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
