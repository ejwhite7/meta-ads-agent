/**
 * @module tools/creative/create-ad-creative
 *
 * Tool for creating an ad creative in Meta's advertising platform.
 * Wraps the meta-client CreativeCommands.create() method with a typed
 * tool interface, supporting image hash, link URL, CTA, and page-based
 * story specifications.
 */

import { type Static, Type } from "@sinclair/typebox";
import { createTool } from "../types.js";
import type { ToolResult } from "../types.js";
import type { CreativeToolContext } from "./types.js";

/**
 * TypeBox schema for create-ad-creative parameters.
 *
 * Requires the ad account, page, copy elements, and either an image URL
 * or pre-uploaded image hash.
 */
const CreateAdCreativeParams = Type.Object({
	/** Facebook Page ID that owns the ad post. */
	pageId: Type.String({ description: "Facebook Page ID for the ad" }),

	/** Ad headline text. */
	headline: Type.String({ description: "Ad headline text" }),

	/** Ad body / primary text. */
	body: Type.String({ description: "Ad body text" }),

	/** Call-to-action type (e.g., "SHOP_NOW", "LEARN_MORE"). */
	callToAction: Type.String({ description: "Call-to-action type" }),

	/** Destination URL when the ad is clicked. */
	linkUrl: Type.String({ description: "Destination URL for the ad" }),

	/** Public URL of the ad image (mutually exclusive with imageHash). */
	imageUrl: Type.Optional(Type.String({ description: "Public image URL" })),

	/** Hash of a previously uploaded image asset (mutually exclusive with imageUrl). */
	imageHash: Type.Optional(Type.String({ description: "Pre-uploaded image hash" })),
});

/** Inferred TypeScript type for create-ad-creative parameters. */
type CreateAdCreativeInput = Static<typeof CreateAdCreativeParams>;

/**
 * Generates a descriptive creative name from the headline and a timestamp.
 *
 * @param headline - The ad headline text.
 * @param timestamp - ISO 8601 timestamp string.
 * @returns A human-readable creative name.
 */
function generateCreativeName(headline: string, timestamp: string): string {
	const dateSlug = timestamp.slice(0, 10);
	const slug = headline
		.slice(0, 30)
		.replace(/[^a-zA-Z0-9]+/g, "-")
		.toLowerCase();
	return `creative-${slug}-${dateSlug}`;
}

/**
 * Create an ad creative in Meta's advertising platform.
 *
 * Builds the creative specification including the object story spec for
 * the Facebook Page, link data, and CTA. Supports both pre-uploaded image
 * hashes and direct image URLs (via image_hash field).
 *
 * @example
 * ```typescript
 * const result = await createAdCreativeTool.execute(
 *   {
 *     adAccountId: "act_123456",
 *     pageId: "page_789",
 *     headline: "Summer Sale - 50% Off",
 *     body: "Shop our summer collection today!",
 *     callToAction: "SHOP_NOW",
 *     linkUrl: "https://example.com/summer",
 *     imageHash: "abc123def456",
 *   },
 *   creativeToolContext,
 * );
 * ```
 */
export const createAdCreativeTool = createTool({
	name: "create_ad_creative",
	description:
		"Create a new ad creative in Meta's advertising platform with headline, body, CTA, and image.",
	parameters: CreateAdCreativeParams,
	async execute(params, context): Promise<ToolResult> {
		const ctx = context as unknown as CreativeToolContext;
		const creativeName = generateCreativeName(params.headline, ctx.timestamp);

		if (ctx.dryRun) {
			return {
				success: true,
				data: { creativeName, params, dryRun: true },
				message: `Dry run: would create creative "${creativeName}" in account ${context.adAccountId}.`,
			};
		}

		try {
			const creative = await ctx.metaClient.creatives.create(context.adAccountId, {
				name: creativeName,
				title: params.headline,
				body: params.body,
				link_url: params.linkUrl,
				call_to_action_type: params.callToAction,
				...(params.imageHash ? { image_hash: params.imageHash } : {}),
				object_story_spec: {
					page_id: params.pageId,
					link_data: {
						link: params.linkUrl,
						message: params.body,
						...(params.imageHash ? { image_hash: params.imageHash } : {}),
						call_to_action: {
							type: params.callToAction,
							value: { link: params.linkUrl },
						},
					},
				},
			});

			return {
				success: true,
				data: { creativeId: creative.id, creativeName: creative.name },
				message: `Created creative "${creative.name}" (ID: ${creative.id}) in account ${context.adAccountId}.`,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				data: null,
				error: `Failed to create ad creative: ${message}`,
				message: `Failed to create ad creative: ${message}`,
			};
		}
	},
});
