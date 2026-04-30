/**
 * @module tools/creative/rotate-creatives
 *
 * Tool for rotating which creative is active for an ad set. Pauses the
 * currently active creative and activates the next one in the rotation pool.
 * Maintains rotation state to ensure even distribution across all creatives
 * in the pool.
 *
 * Rotation strategy: round-robin through the creative pool. When the end
 * of the pool is reached, wraps back to the first creative.
 */

import { type Static, Type } from "@sinclair/typebox";
import { createTool } from "../types.js";
import type { ToolResult } from "../types.js";
import type { CreativeToolContext, RotationState } from "./types.js";

/**
 * TypeBox schema for rotate-creatives parameters.
 */
const RotateCreativesParams = Type.Object({
	/** Ad set ID to rotate creatives for. */
	adSetId: Type.String({ description: "Ad set ID to rotate creatives for" }),

	/** Ordered array of creative IDs forming the rotation pool. */
	creativeIds: Type.Array(Type.String(), {
		minItems: 2,
		description: "Creative IDs in the rotation pool (minimum 2)",
	}),

	/** Reason for triggering the rotation (e.g., "ad fatigue", "scheduled"). */
	reason: Type.String({ description: "Reason for the rotation" }),
});

/** Inferred TypeScript type for rotate-creatives parameters. */
type RotateCreativesInput = Static<typeof RotateCreativesParams>;

/**
 * In-memory rotation state store.
 *
 * Maps ad set IDs to their current rotation state. In a production deployment,
 * this would be backed by the agent_decisions database table. The in-memory
 * store provides fast access for single-process deployments.
 */
const rotationStateStore = new Map<string, RotationState>();

/**
 * Retrieves the current rotation state for an ad set.
 *
 * @param adSetId - The ad set identifier.
 * @returns The current rotation state, or undefined if no state exists.
 */
export function getRotationState(adSetId: string): RotationState | undefined {
	return rotationStateStore.get(adSetId);
}

/**
 * Updates the rotation state for an ad set.
 *
 * @param state - The new rotation state to persist.
 */
export function setRotationState(state: RotationState): void {
	rotationStateStore.set(state.adSetId, { ...state });
}

/**
 * Clears all rotation state. Primarily used for testing.
 */
export function clearRotationState(): void {
	rotationStateStore.clear();
}

/**
 * Determines the next creative index in the rotation pool.
 * Uses round-robin: advances by one, wrapping to 0 at the end.
 *
 * @param currentIndex - Current active creative index.
 * @param poolSize - Total number of creatives in the pool.
 * @returns The next creative index.
 */
function nextIndex(currentIndex: number, poolSize: number): number {
	return (currentIndex + 1) % poolSize;
}

/**
 * Rotate creatives for an ad set.
 *
 * Pauses ads using the currently active creative and activates ads using
 * the next creative in the rotation pool. Tracks rotation state so subsequent
 * calls continue the round-robin sequence.
 *
 * @example
 * ```typescript
 * const result = await rotateCreativesTool.execute(
 *   {
 *     adSetId: "adset_123",
 *     creativeIds: ["creative_a", "creative_b", "creative_c"],
 *     reason: "Ad fatigue detected - frequency > 5",
 *   },
 *   creativeToolContext,
 * );
 * ```
 */
export const rotateCreativesTool = createTool({
	name: "rotate_creatives",
	description:
		"Rotate which creative is active for an ad set. Pauses the current creative and activates the next in the rotation pool.",
	parameters: RotateCreativesParams,
	async execute(params, context): Promise<ToolResult> {
		const ctx = context as unknown as CreativeToolContext;

		if (params.creativeIds.length < 2) {
			return {
				success: false,
				data: null,
				error: "Rotation requires at least 2 creatives in the pool.",
				message: "Rotation requires at least 2 creatives in the pool.",
			};
		}

		if (ctx.dryRun) {
			return {
				success: true,
				data: { dryRun: true, adSetId: params.adSetId, poolSize: params.creativeIds.length },
				message: `Dry run: would rotate creatives for ad set ${params.adSetId}.`,
			};
		}

		try {
			/* Retrieve or initialize rotation state */
			const state = getRotationState(params.adSetId);
			let previousCreativeId: string;
			let newIndex: number;

			if (state) {
				previousCreativeId = state.creativeIds[state.currentIndex];
				newIndex = nextIndex(state.currentIndex, params.creativeIds.length);
			} else {
				/* First rotation: assume index 0 is active, advance to 1 */
				previousCreativeId = params.creativeIds[0];
				newIndex = 1;
			}

			const nextCreativeId = params.creativeIds[newIndex];

			/* Fetch all ads in the account to find those in this ad set */
			const allAds = await ctx.metaClient.ads.list(ctx.adAccountId);
			const adSetAds = allAds.filter((ad) => ad.adset_id === params.adSetId);

			/* Pause ads using the previous creative */
			const pausedAds: string[] = [];
			for (const ad of adSetAds) {
				if (ad.creative_id === previousCreativeId && ad.status === "ACTIVE") {
					await ctx.metaClient.ads.update(ad.id, { status: "PAUSED" });
					pausedAds.push(ad.id);
				}
			}

			/* Activate ads using the next creative */
			const activatedAds: string[] = [];
			for (const ad of adSetAds) {
				if (ad.creative_id === nextCreativeId && ad.status === "PAUSED") {
					await ctx.metaClient.ads.update(ad.id, { status: "ACTIVE" });
					activatedAds.push(ad.id);
				}
			}

			/* Update rotation state */
			const newState: RotationState = {
				adSetId: params.adSetId,
				creativeIds: params.creativeIds,
				currentIndex: newIndex,
				lastRotationReason: params.reason,
				lastRotatedAt: ctx.timestamp,
			};
			setRotationState(newState);

			return {
				success: true,
				data: {
					previousCreativeId,
					nextCreativeId,
					newIndex,
					pausedAdCount: pausedAds.length,
					activatedAdCount: activatedAds.length,
					pausedAds,
					activatedAds,
					reason: params.reason,
				},
				message: `Rotated creative for ad set ${params.adSetId}: ${previousCreativeId} -> ${nextCreativeId} (${params.reason}).`,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				data: null,
				error: `Failed to rotate creatives: ${message}`,
				message: `Failed to rotate creatives: ${message}`,
			};
		}
	},
});
