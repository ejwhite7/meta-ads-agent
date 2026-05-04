/**
 * @module tools/campaign/pause-ad
 *
 * Pauses a single Meta ad (creative-level). The leaf-level analogue
 * of `pause_campaign` and `pause_adset`. The agent uses this to
 * retire an underperforming creative without disturbing siblings
 * within the same ad set.
 *
 * Part of the **Act** phase in the OODA cycle.
 */

import { Type } from "@sinclair/typebox";
import { type ToolResult, createTool } from "../types.js";

export const pauseAdTool = createTool({
	name: "pause_ad",
	description:
		"Pause an active Meta ad (creative level, leaf of the hierarchy). " +
		"Validates the ad exists, sets status to PAUSED, and logs the " +
		"reason to the audit trail.",
	parameters: Type.Object({
		adId: Type.String({ description: "Meta ad ID to pause" }),
		reason: Type.String({
			description: "Why the ad is being paused — logged to the audit trail for traceability",
		}),
	}),
	async execute(params, context): Promise<ToolResult> {
		const { adId, reason } = params;

		try {
			const ad = await context.metaClient.ads.get(adId);
			if (!ad) {
				return {
					success: false,
					data: null,
					error: `Ad ${adId} not found`,
					message: `Ad ${adId} not found`,
					errorCode: "AD_NOT_FOUND",
				};
			}

			if (ad.status === "PAUSED") {
				if (context.auditLogger) {
					await context.auditLogger.logDecision({
						sessionId: context.sessionId,
						adAccountId: context.adAccountId,
						toolName: "pause_ad",
						params: { adId, reason },
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
						adId,
						adName: ad.name,
						previousStatus: "PAUSED",
						newStatus: "PAUSED",
						action: "none",
						reason,
					},
					message: `Ad ${adId} was already paused.`,
				};
			}

			const updated = await context.metaClient.ads.update(adId, { status: "PAUSED" });

			if (context.auditLogger) {
				await context.auditLogger.logDecision({
					sessionId: context.sessionId,
					adAccountId: context.adAccountId,
					toolName: "pause_ad",
					params: { adId, reason },
					reasoning: reason,
					expectedOutcome: `Paused ad ${adId} ('${ad.name}')`,
					score: 0,
					riskLevel: "low",
					success: true,
					resultData: {
						previousStatus: ad.status,
						newStatus: "PAUSED",
						adName: ad.name,
					},
					errorMessage: null,
				});
			}

			return {
				success: true,
				data: {
					adId,
					adName: ad.name,
					previousStatus: ad.status,
					newStatus: updated.status,
					action: "paused",
					reason,
				},
				message: `Ad ${adId} paused successfully.`,
			};
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error pausing ad";
			return {
				success: false,
				data: null,
				error: `Failed to pause ad ${adId}: ${message}`,
				message: `Failed to pause ad ${adId}: ${message}`,
				errorCode: "META_API_ERROR",
			};
		}
	},
});
