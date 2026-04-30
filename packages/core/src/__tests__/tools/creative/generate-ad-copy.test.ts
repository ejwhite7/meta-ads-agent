/**
 * @module __tests__/tools/creative/generate-ad-copy.test
 *
 * Unit tests for the generate-ad-copy tool.
 * Verifies LLM prompt construction, response parsing, character limit
 * enforcement, variation count, and tone assignment using a mocked
 * LLM provider that returns preset copy.
 */

import { describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../../../llm/types.js";
import { generateAdCopyTool } from "../../../tools/creative/generate-ad-copy.js";
import type { CreativeToolContext } from "../../../tools/creative/types.js";

/**
 * Creates a mock LLMProvider that returns a preset JSON response
 * from streamSimple().
 *
 * @param responseJson - The JSON string the LLM should "return".
 * @returns A mocked LLMProvider instance.
 */
function mockLLMProvider(responseJson: string): LLMProvider {
	return {
		name: "mock",
		model: "mock-model",
		stream: vi.fn(),
		streamSimple: vi.fn().mockReturnValue({
			result: () => Promise.resolve(responseJson),
			[Symbol.asyncIterator]: async function* () {
				yield responseJson;
			},
		}),
	} as unknown as LLMProvider;
}

/**
 * Creates a mock CreativeToolContext with the given LLM provider.
 */
function mockContext(llmProvider: LLMProvider): CreativeToolContext {
	return {
		sessionId: "test-session-001",
		dryRun: false,
		timestamp: new Date().toISOString(),
		llmProvider,
		metaClient: {} as CreativeToolContext["metaClient"],
	};
}

/** Preset ad copy response matching expected LLM output format. */
const PRESET_RESPONSE = JSON.stringify([
	{
		headline: "Sync Files Instantly",
		body: "Keep your files in sync across every device. Try CloudSync Pro free.",
		callToAction: "Learn More",
		imagePrompt: "Modern workspace with laptop and phone showing synced files, clean design",
		tone: "professional",
	},
	{
		headline: "Never Lose a File Again",
		body: "Real-time sync for remote teams. CloudSync Pro keeps everyone connected.",
		callToAction: "Sign Up",
		imagePrompt: "Happy remote worker in a cafe with multiple devices, professional photography",
		tone: "professional",
	},
	{
		headline: "Work From Anywhere",
		body: "Your files follow you everywhere. CloudSync Pro makes remote work seamless.",
		callToAction: "Shop Now",
		imagePrompt: "Digital nomad working on a beach with laptop, vibrant colors",
		tone: "professional",
	},
]);

describe("generate_ad_copy tool", () => {
	it("should return the correct number of variations", async () => {
		const llm = mockLLMProvider(PRESET_RESPONSE);
		const ctx = mockContext(llm);

		const result = await generateAdCopyTool.execute(
			{
				productName: "CloudSync Pro",
				productDescription: "Real-time file sync across all devices",
				targetAudience: "Remote workers",
				tone: "professional",
				format: "single_image",
				variations: 3,
			},
			ctx as unknown as Parameters<typeof generateAdCopyTool.execute>[1],
		);

		expect(result.success).toBe(true);
		expect(result.data).not.toBeNull();
		const variations = (result.data as Record<string, unknown>).variations as unknown[];
		expect(variations).toHaveLength(3);
	});

	it("should enforce headline character limit of 40", async () => {
		const longHeadline = "A".repeat(60);
		const response = JSON.stringify([
			{
				headline: longHeadline,
				body: "Short body",
				callToAction: "Learn More",
				imagePrompt: "test prompt",
				tone: "casual",
			},
		]);
		const llm = mockLLMProvider(response);
		const ctx = mockContext(llm);

		const result = await generateAdCopyTool.execute(
			{
				productName: "Test",
				productDescription: "Test product",
				targetAudience: "Everyone",
				tone: "casual",
				format: "single_image",
				variations: 1,
			},
			ctx as unknown as Parameters<typeof generateAdCopyTool.execute>[1],
		);

		expect(result.success).toBe(true);
		const variations = (result.data as Record<string, unknown>).variations as Array<{
			headline: string;
		}>;
		expect(variations[0].headline.length).toBeLessThanOrEqual(40);
	});

	it("should enforce body character limit of 125", async () => {
		const longBody = "B".repeat(200);
		const response = JSON.stringify([
			{
				headline: "Test",
				body: longBody,
				callToAction: "Learn More",
				imagePrompt: "test prompt",
				tone: "urgent",
			},
		]);
		const llm = mockLLMProvider(response);
		const ctx = mockContext(llm);

		const result = await generateAdCopyTool.execute(
			{
				productName: "Test",
				productDescription: "Test product",
				targetAudience: "Everyone",
				tone: "urgent",
				format: "single_image",
				variations: 1,
			},
			ctx as unknown as Parameters<typeof generateAdCopyTool.execute>[1],
		);

		expect(result.success).toBe(true);
		const variations = (result.data as Record<string, unknown>).variations as Array<{
			body: string;
		}>;
		expect(variations[0].body.length).toBeLessThanOrEqual(125);
	});

	it("should assign the requested tone to each variation", async () => {
		const llm = mockLLMProvider(PRESET_RESPONSE);
		const ctx = mockContext(llm);

		const result = await generateAdCopyTool.execute(
			{
				productName: "CloudSync Pro",
				productDescription: "Real-time file sync",
				targetAudience: "Remote workers",
				tone: "playful",
				format: "carousel",
				variations: 3,
			},
			ctx as unknown as Parameters<typeof generateAdCopyTool.execute>[1],
		);

		expect(result.success).toBe(true);
		const variations = (result.data as Record<string, unknown>).variations as Array<{
			tone: string;
		}>;
		for (const v of variations) {
			expect(v.tone).toBe("playful");
		}
	});

	it("should default to 3 variations when not specified", async () => {
		const llm = mockLLMProvider(PRESET_RESPONSE);
		const ctx = mockContext(llm);

		const result = await generateAdCopyTool.execute(
			{
				productName: "CloudSync Pro",
				productDescription: "Sync tool",
				targetAudience: "Workers",
				tone: "professional",
				format: "single_image",
			},
			ctx as unknown as Parameters<typeof generateAdCopyTool.execute>[1],
		);

		expect(result.success).toBe(true);
		expect(llm.streamSimple).toHaveBeenCalled();
		const callArgs = (llm.streamSimple as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
		expect(callArgs).toContain("3");
	});

	it("should handle LLM responses wrapped in markdown code fences", async () => {
		const wrappedResponse = `\`\`\`json\n${PRESET_RESPONSE}\n\`\`\``;
		const llm = mockLLMProvider(wrappedResponse);
		const ctx = mockContext(llm);

		const result = await generateAdCopyTool.execute(
			{
				productName: "Test",
				productDescription: "Test",
				targetAudience: "Test",
				tone: "casual",
				format: "video",
				variations: 3,
			},
			ctx as unknown as Parameters<typeof generateAdCopyTool.execute>[1],
		);

		expect(result.success).toBe(true);
		const variations = (result.data as Record<string, unknown>).variations as unknown[];
		expect(variations).toHaveLength(3);
	});

	it("should return failure when LLM returns invalid JSON", async () => {
		const llm = mockLLMProvider("This is not JSON at all");
		const ctx = mockContext(llm);

		const result = await generateAdCopyTool.execute(
			{
				productName: "Test",
				productDescription: "Test",
				targetAudience: "Test",
				tone: "professional",
				format: "single_image",
				variations: 1,
			},
			ctx as unknown as Parameters<typeof generateAdCopyTool.execute>[1],
		);

		expect(result.success).toBe(false);
		expect(result.message).toContain("Failed to generate ad copy");
	});

	it("should return dry run result when dryRun is true", async () => {
		const llm = mockLLMProvider(PRESET_RESPONSE);
		const ctx = mockContext(llm);
		(ctx as { dryRun: boolean }).dryRun = true;

		const result = await generateAdCopyTool.execute(
			{
				productName: "CloudSync Pro",
				productDescription: "Test",
				targetAudience: "Test",
				tone: "professional",
				format: "single_image",
				variations: 2,
			},
			ctx as unknown as Parameters<typeof generateAdCopyTool.execute>[1],
		);

		expect(result.success).toBe(true);
		expect(result.message).toContain("Dry run");
		expect(llm.streamSimple).not.toHaveBeenCalled();
	});

	it("should have correct tool metadata", () => {
		expect(generateAdCopyTool.name).toBe("generate_ad_copy");
		expect(generateAdCopyTool.description).toBeTruthy();
		expect(generateAdCopyTool.parameters).toBeDefined();
	});
});
