/**
 * @module tools
 *
 * Tool system barrel exports for the meta-ads-agent core package.
 *
 * Re-exports the tool infrastructure (types, registry, executor, hooks)
 * alongside domain-specific tool collections. The creativeTools array
 * can be registered in bulk with a ToolRegistry instance.
 */

/* === Tool Infrastructure === */
export { createTool, ToolExecutionError } from "./types.js";
export type { Tool, ToolContext, ToolResult } from "./types.js";
export { ToolRegistry } from "./registry.js";
export { ToolExecutor } from "./executor.js";
export type { ExecutorConfig } from "./executor.js";
export { HookManager } from "./hooks.js";
export type { BeforeHook, AfterHook } from "./hooks.js";

/* === Creative Tools === */
export {
	creativeTools,
	generateAdCopyTool,
	createAdCreativeTool,
	analyzeCreativePerformanceTool,
	rotateCreativesTool,
	retireCreativeTool,
	generateImagePromptsTool,
	cloneTopCreativeTool,
	buildAnalysis,
	classifyCreatives,
	getRotationState,
	setRotationState,
	clearRotationState,
} from "./creative/index.js";

export type {
	CreativeToolContext,
	MetaClientLike,
	AdCopyVariation,
	CreativePerformanceAnalysis,
	ImagePromptSpec,
	RotationState,
} from "./creative/index.js";
