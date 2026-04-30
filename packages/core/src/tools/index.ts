/**
 * @module tools
 *
 * Tool system exports and tool collection builders for the meta-ads-agent.
 *
 * Re-exports the core tool infrastructure (types, registry, executor, hooks)
 * and provides factory functions to create categorized tool collections
 * ready for registration in the agent's tool registry.
 */

/* === Tool Infrastructure === */
export { createTool, ToolExecutionError } from "./types.js";
export type { Tool, ToolContext, ToolResult } from "./types.js";
export { ToolRegistry } from "./registry.js";
export { ToolExecutor } from "./executor.js";
export type { ExecutorConfig } from "./executor.js";
export { HookManager } from "./hooks.js";
export type { BeforeHook, AfterHook } from "./hooks.js";

/* === Budget Tools === */
export {
	createGetBudgetStatusTool,
	createGetPacingAlertsTool,
	createSetBudgetTool,
	createReallocateBudgetTool,
	createOptimizeBidsTool,
	createProjectSpendTool,
} from "./budget/index.js";

export type {
	PacingStatus,
	PacingAlert,
	AlertSeverity,
	ProjectionConfidence,
} from "./budget/index.js";

import type { TObject } from "@sinclair/typebox";
import type { MetaClient } from "@meta-ads-agent/meta-client";
import type { Tool } from "./types.js";
import type { GuardrailConfig } from "../decisions/types.js";
import type { AgentGoal } from "../types.js";
import { DEFAULT_GUARDRAILS } from "../decisions/types.js";
import { createGetBudgetStatusTool } from "./budget/get-budget-status.js";
import { createGetPacingAlertsTool } from "./budget/get-pacing-alerts.js";
import { createSetBudgetTool } from "./budget/set-budget.js";
import { createReallocateBudgetTool } from "./budget/reallocate-budget.js";
import { createOptimizeBidsTool } from "./budget/optimize-bids.js";
import { createProjectSpendTool } from "./budget/project-spend.js";

/**
 * Creates the complete set of budget optimization tools.
 *
 * Returns an array of all budget-related tools, initialized with the
 * provided MetaClient instance and configuration. These tools can be
 * registered individually or as a batch in the tool registry.
 *
 * @param client - Initialized MetaClient instance for Meta API access.
 * @param goals - Agent goals (ROAS target, CPA cap, etc.) for bid optimization.
 * @param guardrails - Optional guardrail configuration (uses defaults if not provided).
 * @returns Array of initialized budget tool definitions.
 *
 * @example
 * ```ts
 * const tools = createBudgetTools(metaClient, agentGoals);
 * for (const tool of tools) {
 *   registry.register(tool);
 * }
 * ```
 */
export function createBudgetTools(
	client: MetaClient,
	goals: AgentGoal,
	guardrails: GuardrailConfig = DEFAULT_GUARDRAILS,
): Tool<TObject>[] {
	return [
		createGetBudgetStatusTool(client),
		createGetPacingAlertsTool(client),
		createSetBudgetTool(client, guardrails),
		createReallocateBudgetTool(client, guardrails),
		createOptimizeBidsTool(client, goals),
		createProjectSpendTool(client),
	] as Tool<TObject>[];
}
