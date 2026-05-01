/**
 * @module tools/budget
 *
 * Budget optimization tools for autonomous ad spend management.
 *
 * This module exports factory functions that create budget-related tools
 * for the meta-ads-agent. Each tool enforces safety guardrails and provides
 * comprehensive audit logging for all budget modifications.
 *
 * Tools:
 * - get_budget_status: Account-level spend pacing and burn rate analysis
 * - get_pacing_alerts: Campaign-level overpacing/underpacing detection
 * - set_budget: Set absolute daily budget with guardrail enforcement
 * - reallocate_budget: Atomic budget transfer between campaigns
 * - optimize_bids: Intelligent bid strategy adjustment
 * - project_spend: End-of-period spend and performance projections
 */

export { createGetBudgetStatusTool } from "./get-budget-status.js";
export type { PacingStatus } from "./get-budget-status.js";

export { createGetPacingAlertsTool } from "./get-pacing-alerts.js";
export type { PacingAlert, AlertSeverity } from "./get-pacing-alerts.js";

export { createSetBudgetTool } from "./set-budget.js";

export { createReallocateBudgetTool } from "./reallocate-budget.js";

export { createOptimizeBidsTool } from "./optimize-bids.js";

export { createProjectSpendTool } from "./project-spend.js";
export type { ProjectionConfidence } from "./project-spend.js";

import type { MetaClient } from "@meta-ads-agent/meta-client";
import type { TObject } from "@sinclair/typebox";
import type { AgentGoal } from "../../types.js";
import type { Tool } from "../types.js";
import { createGetBudgetStatusTool } from "./get-budget-status.js";
import { createGetPacingAlertsTool } from "./get-pacing-alerts.js";
import { createOptimizeBidsTool } from "./optimize-bids.js";
import { createProjectSpendTool } from "./project-spend.js";
import { createReallocateBudgetTool } from "./reallocate-budget.js";
import { createSetBudgetTool } from "./set-budget.js";

/**
 * Factory that creates all budget tools.
 *
 * If `metaClient` is null (the default), each tool will resolve the
 * MetaClient from `ToolContext` at execution time. This supports both
 * registration patterns:
 *   - Static registration via `budgetTools` (uses ToolContext at runtime)
 *   - Bound registration via `createBudgetTools(realClient)` (uses the
 *     bound client even if context.metaClient differs -- useful for
 *     multi-account scenarios and tests).
 *
 * @param metaClient - Optional pre-bound MetaClient. If null, tools resolve
 *   the client from ToolContext at execution time.
 * @param goals - Optional agent goals (used by optimize_bids).
 * @returns Array of all budget tools ready for registration.
 */
export function createBudgetTools(
	metaClient: MetaClient | null = null,
	goals?: AgentGoal,
): ReadonlyArray<Tool<TObject>> {
	const defaultGoals: AgentGoal = goals ?? {
		roasTarget: 3.0,
		cpaCap: 50,
		dailyBudgetLimit: 10000,
		riskLevel: "moderate",
	};
	return [
		createGetBudgetStatusTool(metaClient),
		createGetPacingAlertsTool(metaClient),
		createSetBudgetTool(metaClient),
		createReallocateBudgetTool(metaClient),
		createOptimizeBidsTool(metaClient, defaultGoals),
		createProjectSpendTool(metaClient),
	] as ReadonlyArray<Tool<TObject>>;
}

/**
 * Default budget tools registered without a bound MetaClient.
 *
 * Each tool resolves `ToolContext.metaClient` at execution time, so this
 * array is safe to include in the static `allTools` registry. If the
 * context does not provide a MetaClient, tools return a structured error
 * (errorCode = META_CLIENT_UNAVAILABLE) rather than throwing at runtime.
 */
export const budgetTools: ReadonlyArray<Tool<TObject>> = createBudgetTools(null);
