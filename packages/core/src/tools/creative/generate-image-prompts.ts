/**
 * @module tools/creative/generate-image-prompts
 *
 * Tool for generating structured image prompts using the configured LLM.
 * Produces detailed prompts suitable for AI image generation tools such as
 * DALL-E, Midjourney, or Ideogram. Each prompt includes a main description,
 * negative prompt (elements to exclude), aspect ratio, and style notes.
 */

import { Type, type Static } from "@sinclair/typebox";
import { createTool } from "../types.js";
import type { ToolResult } from "../types.js";
import type { CreativeToolContext, ImagePromptSpec } from "./types.js";

/**
 * TypeBox schema for generate-image-prompts parameters.
 */
const GenerateImagePromptsParams = Type.Object({
	/** Name of the product or service. */
	productName: Type.String({ description: "Product or service name" }),

	/** Target audience description. */
	audience: Type.String({ description: "Target audience for the images" }),

	/** Desired visual style for the generated images. */
	style: Type.Union(
		[
			Type.Literal("photo"),
			Type.Literal("illustration"),
			Type.Literal("minimal"),
		],
		{ description: "Visual style for image generation" },
	),

	/** Number of prompts to generate (1-5, defaults to 3). */
	count: Type.Optional(
		Type.Integer({ minimum: 1, maximum: 5, default: 3, description: "Number of prompts (1-5)" }),
	),
});

/** Inferred TypeScript type for generate-image-prompts parameters. */
type GenerateImagePromptsInput = Static<typeof GenerateImagePromptsParams>;

/**
 * Builds the system prompt for image prompt generation.
 * Instructs the LLM to produce structured, high-quality image prompts.
 */
function buildSystemPrompt(): string {
	return [
		"You are an expert AI image prompt engineer specializing in advertising visuals.",
		"Generate structured prompts optimized for AI image generation tools (DALL-E, Midjourney, Ideogram).",
		"",
		"RULES:",
		"1. Main prompts should be detailed, vivid, and describe lighting, composition, and mood.",
		"2. Negative prompts list unwanted elements (e.g., blurry, distorted, text, watermark).",
		"3. Aspect ratios should match Meta ad placements: 1:1 (feed), 16:9 (landscape), 9:16 (stories/reels).",
		"4. Style notes should guide the model toward the requested visual style.",
		"5. All images must be appropriate for advertising — no controversial, violent, or NSFW content.",
		"",
		"Respond ONLY with a valid JSON array of objects. Each object must have exactly these fields:",
		'  - "mainPrompt": string (detailed image generation prompt)',
		'  - "negativePrompt": string (elements to exclude)',
		'  - "aspectRatio": string (e.g., "1:1", "16:9", "9:16")',
		'  - "styleNotes": string (style guidance for the model)',
	].join("\n");
}

/**
 * Builds the user prompt with product and style details.
 *
 * @param params - Validated tool parameters.
 * @returns Formatted user prompt.
 */
function buildUserPrompt(params: GenerateImagePromptsInput): string {
	const count = params.count ?? 3;
	return [
		`Generate ${count} image generation prompt${count === 1 ? "" : "s"} for:`,
		"",
		`Product: ${params.productName}`,
		`Target Audience: ${params.audience}`,
		`Style: ${params.style}`,
		"",
		"Include a mix of aspect ratios suitable for Meta ad placements (feed, stories, landscape).",
		`Return exactly ${count} prompt${count === 1 ? "" : "s"} as a JSON array.`,
	].join("\n");
}

/**
 * Parses the LLM response into ImagePromptSpec objects.
 *
 * @param text - Raw LLM response text.
 * @returns Parsed array of image prompt specifications.
 * @throws {Error} If the response cannot be parsed as valid JSON.
 */
function parsePrompts(text: string): ImagePromptSpec[] {
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
		mainPrompt: String(item.mainPrompt ?? ""),
		negativePrompt: String(item.negativePrompt ?? ""),
		aspectRatio: String(item.aspectRatio ?? "1:1"),
		styleNotes: String(item.styleNotes ?? ""),
	}));
}

/**
 * Generate structured image prompts for AI image generation tools.
 *
 * Uses the configured LLM to create detailed, advertising-appropriate
 * image prompts with main descriptions, negative prompts, aspect ratios,
 * and style guidance suitable for DALL-E, Midjourney, or Ideogram.
 *
 * @example
 * ```typescript
 * const result = await generateImagePromptsTool.execute(
 *   {
 *     productName: "CloudSync Pro",
 *     audience: "Remote workers and digital nomads",
 *     style: "photo",
 *     count: 3,
 *   },
 *   creativeToolContext,
 * );
 * ```
 */
export const generateImagePromptsTool = createTool({
	name: "generate_image_prompts",
	description:
		"Generate structured image prompts for AI image tools (DALL-E, Midjourney, Ideogram). Each prompt includes main description, negative prompt, aspect ratio, and style notes.",
	parameters: GenerateImagePromptsParams,
	async execute(params, context): Promise<ToolResult> {
		const ctx = context as unknown as CreativeToolContext;
		const count = params.count ?? 3;

		if (ctx.dryRun) {
			return {
				success: true,
				data: { prompts: [], count, dryRun: true },
				message: `Dry run: would generate ${count} image prompt(s) for "${params.productName}".`,
			};
		}

		try {
			const systemPrompt = buildSystemPrompt();
			const userPrompt = buildUserPrompt(params);

			const stream = ctx.llmProvider.streamSimple(userPrompt, systemPrompt);
			const responseText = await stream.result();

			const prompts = parsePrompts(responseText);

			return {
				success: true,
				data: { prompts: prompts as unknown as Record<string, unknown>[], count: prompts.length },
				message: `Generated ${prompts.length} image prompt(s) for "${params.productName}".`,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				data: null,
				message: `Failed to generate image prompts: ${message}`,
			};
		}
	},
});
