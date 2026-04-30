/**
 * @module tools/creative/generate-ad-copy
 *
 * Tool for generating ad copy variations using a configured LLM provider.
 * Produces multiple headline/body/CTA combinations that comply with Meta's
 * advertising policies. Each variation includes an image generation prompt
 * suitable for AI image tools like DALL-E or Midjourney.
 *
 * The LLM is instructed to follow Meta's ad policies:
 * - No misleading claims or exaggerated promises
 * - No personal attributes targeting (e.g., "You are overweight")
 * - Compliant CTA labels from Meta's approved list
 */

import { type Static, Type } from "@sinclair/typebox";
import { createTool } from "../types.js";
import type { ToolResult } from "../types.js";
import type { AdCopyVariation, CreativeToolContext } from "./types.js";

/**
 * TypeBox schema for generate-ad-copy parameters.
 *
 * Defines the product information, target audience, tone, ad format,
 * and number of variations to generate.
 */
const GenerateAdCopyParams = Type.Object({
	/** Name of the product or service to advertise. */
	productName: Type.String({ description: "Name of the product or service" }),

	/** Description of the product including key features and benefits. */
	productDescription: Type.String({
		description: "Product description with key features and benefits",
	}),

	/** Target audience description (demographics, interests, behaviors). */
	targetAudience: Type.String({ description: "Target audience description" }),

	/** Desired tone for the ad copy. */
	tone: Type.Union(
		[
			Type.Literal("professional"),
			Type.Literal("casual"),
			Type.Literal("urgent"),
			Type.Literal("playful"),
		],
		{ description: "Tone of the ad copy" },
	),

	/** Ad format that influences copy structure and length. */
	format: Type.Union(
		[Type.Literal("single_image"), Type.Literal("carousel"), Type.Literal("video")],
		{ description: "Ad format type" },
	),

	/** Number of copy variations to generate (1-5, defaults to 3). */
	variations: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 5, default: 3, description: "Number of variations (1-5)" }),
	),
});

/** Inferred TypeScript type for generate-ad-copy parameters. */
type GenerateAdCopyInput = Static<typeof GenerateAdCopyParams>;

/**
 * Builds the system prompt that instructs the LLM to generate Meta-compliant
 * ad copy. Includes character limits, policy rules, and output format.
 */
function buildSystemPrompt(): string {
	return [
		"You are an expert Meta Ads copywriter. Generate ad copy variations that are compelling, concise, and fully compliant with Meta's advertising policies.",
		"",
		"STRICT RULES:",
		"1. Headlines MUST be 40 characters or fewer.",
		"2. Body text MUST be 125 characters or fewer.",
		"3. Never use misleading claims, exaggerated promises, or deceptive language.",
		"4. Never reference personal attributes directly (e.g., avoid 'You are...', 'Your weight...', 'Your race...').",
		"5. Use only approved Meta CTA labels: Shop Now, Learn More, Sign Up, Book Now, Contact Us, Download, Get Offer, Get Quote, Subscribe, Apply Now, Watch More, See Menu, Get Directions.",
		"6. Include an image generation prompt suitable for DALL-E / Midjourney that matches the ad's message and tone.",
		"7. Keep copy action-oriented and benefit-focused.",
		"",
		"Respond ONLY with a valid JSON array of objects. Each object must have exactly these fields:",
		'  - "headline": string (max 40 chars)',
		'  - "body": string (max 125 chars)',
		'  - "callToAction": string (from approved list)',
		'  - "imagePrompt": string (descriptive prompt for AI image generation)',
		'  - "tone": string (the tone used)',
	].join("\n");
}

/**
 * Builds the user prompt with product details, audience, and generation parameters.
 *
 * @param params - The validated tool parameters.
 * @returns Formatted user prompt string.
 */
function buildUserPrompt(params: GenerateAdCopyInput): string {
	const count = params.variations ?? 3;
	return [
		`Generate ${count} ad copy variation${count === 1 ? "" : "s"} for the following:`,
		"",
		`Product: ${params.productName}`,
		`Description: ${params.productDescription}`,
		`Target Audience: ${params.targetAudience}`,
		`Tone: ${params.tone}`,
		`Format: ${params.format}`,
		"",
		`Return exactly ${count} variation${count === 1 ? "" : "s"} as a JSON array.`,
	].join("\n");
}

/**
 * Parses the LLM response text into an array of AdCopyVariation objects.
 * Extracts JSON from the response, handling markdown code fences if present.
 *
 * @param text - Raw LLM response text.
 * @param tone - The requested tone to assign to each variation.
 * @returns Parsed array of ad copy variations.
 * @throws {Error} If the response cannot be parsed as valid JSON.
 */
function parseVariations(text: string, tone: string): AdCopyVariation[] {
	let jsonText = text.trim();

	/* Strip markdown code fences if present */
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
		imagePrompt: String(item.imagePrompt ?? ""),
		tone,
	}));
}

/**
 * Generate ad copy variations using the configured LLM provider.
 *
 * Produces compelling, Meta-policy-compliant ad copy with headlines, body text,
 * CTAs, and AI image generation prompts. Character limits are enforced both
 * in the LLM prompt and via post-processing truncation.
 *
 * @example
 * ```typescript
 * const result = await generateAdCopyTool.execute(
 *   {
 *     productName: "CloudSync Pro",
 *     productDescription: "Real-time file sync across all devices",
 *     targetAudience: "Remote workers and digital nomads",
 *     tone: "professional",
 *     format: "single_image",
 *     variations: 3,
 *   },
 *   creativeToolContext,
 * );
 * ```
 */
export const generateAdCopyTool = createTool({
	name: "generate_ad_copy",
	description:
		"Generate multiple ad copy variations using an LLM. Produces headlines, body text, CTAs, and image prompts compliant with Meta ad policies.",
	parameters: GenerateAdCopyParams,
	async execute(params, context): Promise<ToolResult> {
		const ctx = context as unknown as CreativeToolContext;
		const count = params.variations ?? 3;

		if (ctx.dryRun) {
			return {
				success: true,
				data: { variations: [], count, dryRun: true },
				message: `Dry run: would generate ${count} ad copy variation(s) for "${params.productName}".`,
			};
		}

		try {
			const systemPrompt = buildSystemPrompt();
			const userPrompt = buildUserPrompt(params);

			const stream = ctx.llmProvider.streamSimple(userPrompt, systemPrompt);
			const responseText = await stream.result();

			const variations = parseVariations(responseText, params.tone);

			return {
				success: true,
				data: { variations, count: variations.length },
				message: `Generated ${variations.length} ad copy variation(s) for "${params.productName}".`,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				data: null,
				error: `Failed to generate ad copy: ${message}`,
				message: `Failed to generate ad copy: ${message}`,
			};
		}
	},
});
