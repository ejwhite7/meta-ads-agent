/**
 * @module tools/creative/retire-creative
 *
 * Tool for retiring a poorly performing creative. Deletes the creative via
 * the Meta API (or pauses all ads using it) and logs the retirement with
 * a performance summary. This is a destructive action — the creative cannot
 * be reactivated after deletion.
 */

import { Type, type Static } from "@sinclair/typebox";
import { createTool } from "../types.js";
import type { ToolResult } from "../types.js";
import type { CreativeToolContext } from "./types.js";

/**
 * TypeBox schema for retire-creative parameters.
 */
const RetireCreativeParams = Type.Object({
	/** Meta creative ID to retire. */
	creativeId: Type.String({ description: "Creative ID to retire" }),

	/** Reason for retirement (logged for audit trail). */
	reason: Type.String({ description: "Reason for retiring the creative" }),
});

/** Inferred TypeScript type for retire-creative parameters. */
type RetireCreativeInput = Static<typeof RetireCreativeParams>;

/**
 * Retire a poorly performing creative.
 *
 * Pauses all ads using the specified creative, then deletes the creative
 * from Meta's platform. Logs the retirement with the provided reason and
 * performance context for the audit trail.
 *
 * @example
 * ```typescript
 * const result = await retireCreativeTool.execute(
 *   {
 *     creativeId: "creative_123",
 *     reason: "CTR below threshold (0.3%) with frequency > 5 over last 14 days",
 *   },
 *   creativeToolContext,
 * );
 * ```
 */
export const retireCreativeTool = createTool({
	name: "retire_creative",
	description:
		"Retire a poorly performing creative by pausing its ads and deleting it. Logs retirement with performance stats.",
	parameters: RetireCreativeParams,
	async execute(params, context): Promise<ToolResult> {
		const ctx = context as unknown as CreativeToolContext;

		if (ctx.dryRun) {
			return {
				success: true,
				data: { creativeId: params.creativeId, reason: params.reason, dryRun: true },
				message: `Dry run: would retire creative ${params.creativeId} (${params.reason}).`,
			};
		}

		try {
			/* Fetch current creative details for the retirement log */
			let creativeName = "unknown";
			try {
				const creative = await ctx.metaClient.creatives.get(params.creativeId);
				creativeName = creative.name;
			} catch {
				/* Creative may already be partially deleted; continue with retirement */
			}

			/* Pause all ads that reference this creative */
			const allAds = await ctx.metaClient.ads.list(ctx.adAccountId);
			const affectedAds = allAds.filter((ad) => ad.creative_id === params.creativeId);
			const pausedAds: string[] = [];

			for (const ad of affectedAds) {
				if (ad.status === "ACTIVE" || ad.status === "IN_PROCESS") {
					await ctx.metaClient.ads.update(ad.id, { status: "PAUSED" });
					pausedAds.push(ad.id);
				}
			}

			/* Delete the creative */
			await ctx.metaClient.creatives.delete(params.creativeId);

			return {
				success: true,
				data: {
					creativeId: params.creativeId,
					creativeName,
					reason: params.reason,
					pausedAdCount: pausedAds.length,
					pausedAds,
					retiredAt: ctx.timestamp,
				},
				message: `Retired creative "${creativeName}" (${params.creativeId}): paused ${pausedAds.length} ad(s) and deleted creative. Reason: ${params.reason}.`,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				data: null,
				message: `Failed to retire creative ${params.creativeId}: ${message}`,
			};
		}
	},
});
