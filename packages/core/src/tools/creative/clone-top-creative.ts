/**
 * @module tools/creative/clone-top-creative
 *
 * Tool for identifying the best-performing creative in a campaign and
 * creating LLM-generated variations of its copy. The new creatives are
 * created in a paused state, ready for activation by the agent or a
 * human operator.
 *
 * Workflow:
 * 1. Query ad-level insights for the campaign
 * 2. Find the top performer by composite score (CTR * conversions / frequency)
 * 3. Read the top creative's copy (headline, body, CTA)
 * 4. Use the LLM to generate variations of that copy
 * 5. Create new creatives via the Meta API (paused)
 */

import { type Static, Type } from "@sinclair/typebox";
import { createTool } from "../types.js";
import type { ToolResult } from "../types.js";
import { buildAnalysis } from "./analyze-creative-performance.js";
import type { CreativeToolContext } from "./types.js";

/**
 * TypeBox schema for clone-top-creative parameters.
 */
const CloneTopCreativeParams = Type.Object({
	/** Campaign ID to analyze for the top creative. */
	campaignId: Type.String({ description: "Campaign ID to find the top creative in" }),

	/** Number of variations to create (1-3, defaults to 2). */
	variationsCount: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 3, default: 2, description: "Number of variations (1-3)" }),
	),
});

/** Inferred TypeScript type for clone-top-creative parameters. */
type CloneTopCreativeInput = Static<typeof CloneTopCreativeParams>;

/**
 * Builds a prompt asking the LLM to create variations of existing ad copy.
 *
 * @param headline - Original headline text.
 * @param body - Original body text.
 * @param cta - Original call-to-action.
 * @param count - Number of variations to generate.
 * @returns Formatted prompt string.
 */
function buildVariationPrompt(headline: string, body: string, cta: string, count: number): string {
	return [
		`Create ${count} variation${count === 1 ? "" : "s"} of the following high-performing ad copy.`,
		"Keep the same general message and CTA but vary the wording, angle, and emphasis.",
		"",
		"ORIGINAL AD:",
		`Headline: ${headline}`,
		`Body: ${body}`,
		`CTA: ${cta}`,
		"",
		"RULES:",
		"1. Headlines MUST be 40 characters or fewer.",
		"2. Body text MUST be 125 characters or fewer.",
		"3. Keep the same CTA type unless a better one is clearly warranted.",
		"4. Maintain Meta ad policy compliance (no misleading claims, no personal attributes).",
		"",
		"Respond ONLY with a valid JSON array of objects with these fields:",
		'  - "headline": string (max 40 chars)',
		'  - "body": string (max 125 chars)',
		'  - "callToAction": string',
	].join("\n");
}

/**
 * Parses clone variation responses from the LLM.
 *
 * @param text - Raw LLM response text.
 * @returns Parsed array of variation objects.
 * @throws {Error} If the response cannot be parsed.
 */
function parseCloneVariations(
	text: string,
): Array<{ headline: string; body: string; callToAction: string }> {
	let jsonText = text.trim();

	const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fenceMatch) {
		jsonText = fenceMatch[1].trim();
	}

	const parsed: unknown = JSON.parse(jsonText);
	if (!Array.isArray(parsed)) {
		throw new Error("LLM response is not a JSON array");
	}

	return parsed.map((item: Record<string, unknown>) => ({
		headline: String(item.headline ?? "").slice(0, 40),
		body: String(item.body ?? "").slice(0, 125),
		callToAction: String(item.callToAction ?? "Learn More"),
	}));
}

/**
 * Clone the top-performing creative with LLM-generated variations.
 *
 * Identifies the best creative in a campaign by composite score, generates
 * copy variations using the LLM, and creates new creatives in Meta's
 * platform in a paused state.
 *
 * @example
 * ```typescript
 * const result = await cloneTopCreativeTool.execute(
 *   {
 *     adAccountId: "act_123456",
 *     campaignId: "campaign_789",
 *     variationsCount: 2,
 *   },
 *   creativeToolContext,
 * );
 * const newCreativeIds = result.data.createdCreativeIds;
 * ```
 */
export const cloneTopCreativeTool = createTool({
	name: "clone_top_creative",
	description:
		"Find the best-performing creative in a campaign and create LLM-generated copy variations of it. New creatives are created paused, ready for activation.",
	parameters: CloneTopCreativeParams,
	async execute(params, context): Promise<ToolResult> {
		const ctx = context as unknown as CreativeToolContext;
		const variationsCount = params.variationsCount ?? 2;

		if (ctx.dryRun) {
			return {
				success: true,
				data: { dryRun: true, campaignId: params.campaignId, variationsCount },
				message: `Dry run: would clone top creative from campaign ${params.campaignId} with ${variationsCount} variation(s).`,
			};
		}

		try {
			/* Step 1: Fetch ad-level insights for the campaign */
			const insights = await ctx.metaClient.insights.query(context.adAccountId, {
				level: "ad",
				date_preset: "last_14d",
				fields: ["ad_id", "ad_name", "impressions", "clicks", "spend", "ctr", "cpm", "actions"],
				filtering: [{ field: "campaign.id", operator: "EQUAL", value: params.campaignId }],
			});

			if (insights.length === 0) {
				return {
					success: false,
					data: null,
					error: `No active ads with insights found in campaign ${params.campaignId}.`,
					message: `No active ads with insights found in campaign ${params.campaignId}.`,
				};
			}

			/* Step 2: Score and find the top performer */
			const analyses = buildAnalysis(insights);
			if (analyses.length === 0) {
				return {
					success: false,
					data: null,
					error: "No analyzable creatives found in campaign insights.",
					message: "No analyzable creatives found in campaign insights.",
				};
			}

			const topAnalysis = analyses.reduce((best, current) =>
				current.score > best.score ? current : best,
			);

			/* Step 3: Fetch the top creative's details */
			const ads = await ctx.metaClient.ads.list(context.adAccountId);
			const topAd = ads.find((ad) => ad.id === topAnalysis.creativeId);

			if (!topAd) {
				return {
					success: false,
					data: null,
					error: `Could not find ad ${topAnalysis.creativeId} to read its creative.`,
					message: `Could not find ad ${topAnalysis.creativeId} to read its creative.`,
				};
			}

			const topCreative = await ctx.metaClient.creatives.get(topAd.creative_id);
			const originalHeadline = topCreative.title ?? "";
			const originalBody = topCreative.body ?? "";
			const originalCta = topCreative.call_to_action_type ?? "Learn More";

			/* Step 4: Generate copy variations via LLM */
			const variationPrompt = buildVariationPrompt(
				originalHeadline,
				originalBody,
				originalCta,
				variationsCount,
			);

			const stream = ctx.llmProvider.streamSimple(variationPrompt);
			const responseText = await stream.result();
			const variations = parseCloneVariations(responseText);

			/* Step 5: Create new creatives (paused) */
			const createdCreativeIds: string[] = [];
			const dateSlug = ctx.timestamp.slice(0, 10);

			for (let i = 0; i < variations.length; i++) {
				const variation = variations[i];
				const creative = await ctx.metaClient.creatives.create(context.adAccountId, {
					name: `clone-${topAd.creative_id}-v${i + 1}-${dateSlug}`,
					title: variation.headline,
					body: variation.body,
					call_to_action_type: variation.callToAction,
					link_url: topCreative.link_url,
				});
				createdCreativeIds.push(creative.id);
			}

			return {
				success: true,
				data: {
					sourceCreativeId: topAd.creative_id,
					sourceAdId: topAnalysis.creativeId,
					sourceScore: topAnalysis.score,
					originalHeadline,
					originalBody,
					createdCreativeIds,
					variationsCount: createdCreativeIds.length,
				},
				message: `Cloned top creative ${topAd.creative_id} (score: ${topAnalysis.score.toFixed(4)}): created ${createdCreativeIds.length} variation(s) in paused state.`,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				data: null,
				error: `Failed to clone top creative: ${message}`,
				message: `Failed to clone top creative: ${message}`,
			};
		}
	},
});
