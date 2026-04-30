/**
 * @module tools/creative
 *
 * Creative generation and management tool suite for the meta-ads-agent.
 *
 * This module exports seven tools that enable the agent to autonomously
 * generate, test, rotate, and retire ad creative:
 *
 * - **generate_ad_copy** — LLM-powered ad copy generation with Meta policy compliance
 * - **create_ad_creative** — Creates creatives in Meta's advertising platform
 * - **analyze_creative_performance** — Performance analysis with winner/loser classification
 * - **rotate_creatives** — Round-robin creative rotation for ad sets
 * - **retire_creative** — Retires poorly performing creatives with audit logging
 * - **generate_image_prompts** — LLM-powered image prompt generation for AI tools
 * - **clone_top_creative** — Clones top performers with LLM-generated copy variations
 *
 * All tools follow the createTool() factory pattern with TypeBox parameter
 * schemas and return standardized ToolResult objects. Creative tools require
 * a CreativeToolContext that extends the base ToolContext with an LLMProvider
 * and a MetaClient instance.
 */

import type { TObject } from "@sinclair/typebox";
import type { Tool } from "../types.js";

import { generateAdCopyTool } from "./generate-ad-copy.js";
import { createAdCreativeTool } from "./create-ad-creative.js";
import { analyzeCreativePerformanceTool } from "./analyze-creative-performance.js";
import { rotateCreativesTool } from "./rotate-creatives.js";
import { retireCreativeTool } from "./retire-creative.js";
import { generateImagePromptsTool } from "./generate-image-prompts.js";
import { cloneTopCreativeTool } from "./clone-top-creative.js";

/* === Individual tool exports === */
export { generateAdCopyTool } from "./generate-ad-copy.js";
export { createAdCreativeTool } from "./create-ad-creative.js";
export { analyzeCreativePerformanceTool } from "./analyze-creative-performance.js";
export { rotateCreativesTool, getRotationState, setRotationState, clearRotationState } from "./rotate-creatives.js";
export { retireCreativeTool } from "./retire-creative.js";
export { generateImagePromptsTool } from "./generate-image-prompts.js";
export { cloneTopCreativeTool } from "./clone-top-creative.js";

/* === Classification helpers (re-exported for direct use) === */
export { buildAnalysis, classifyCreatives } from "./analyze-creative-performance.js";

/* === Type exports === */
export type {
	CreativeToolContext,
	MetaClientLike,
	AdCopyVariation,
	CreativePerformanceAnalysis,
	ImagePromptSpec,
	RotationState,
} from "./types.js";

/**
 * Array of all creative tools for bulk registration with the ToolRegistry.
 *
 * @example
 * ```typescript
 * import { ToolRegistry } from "../registry.js";
 * import { creativeTools } from "./creative/index.js";
 *
 * const registry = new ToolRegistry();
 * for (const tool of creativeTools) {
 *   registry.register(tool);
 * }
 * ```
 */
export const creativeTools: ReadonlyArray<Tool<TObject>> = [
	generateAdCopyTool,
	createAdCreativeTool,
	analyzeCreativePerformanceTool,
	rotateCreativesTool,
	retireCreativeTool,
	generateImagePromptsTool,
	cloneTopCreativeTool,
] as ReadonlyArray<Tool<TObject>>;
