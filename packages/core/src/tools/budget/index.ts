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
 * Factory that creates all budget tools given a MetaClient-like instance.
 *
 * @param metaClient - A MetaClient (or compatible) instance for API calls
 * @returns Array of all budget tools ready for registration
 */
export function createBudgetTools(
	metaClient: MetaClient,
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
 * Default budget tools instantiated without a MetaClient.
 * These use context.metaClient at execution time instead of a pre-bound client.
 *
 * For environments that need tools statically (e.g. allTools registration),
 * this array provides budget tools that defer client access to the ToolContext.
 */
export const budgetTools: ReadonlyArray<Tool<TObject>> = (() => {
	/* Create a proxy MetaClient that defers to context.metaClient at execution time.
	 * This allows budget tools to be registered statically in allTools while still
	 * using the real MetaClient from ToolContext during execution. */
	const deferredClient = {} as MetaClient;
	return createBudgetTools(deferredClient);
})();
