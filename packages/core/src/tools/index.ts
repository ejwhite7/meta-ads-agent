/**
 * @module tools
 * @description Central registry of all agent tools. Import this module to
 * access the full tool suite organized by capability domain.
 *
 * Campaign, creative, and reporting tools export ready-to-use tool instances.
 * Budget tools use a factory pattern (they require a MetaClient instance at
 * construction time), so we export both the factory and a convenience function
 * that assembles all tools at once.
 */

import type { TObject } from "@sinclair/typebox";
import type { Tool } from "./types.js";

// Campaign management tools
export * from "./campaign/index.js";
export { campaignTools } from "./campaign/index.js";

// Budget optimization tools (factory pattern)
export * from "./budget/index.js";
export { createBudgetTools } from "./budget/index.js";

// Creative generation tools
export * from "./creative/index.js";
export { creativeTools } from "./creative/index.js";

// Reporting & analytics tools
export {
	reportingTools,
	getCampaignMetrics,
	generatePerformanceReport,
	detectAnomalies,
	sendSlackWebhook,
	getAttributionStats,
	exportReport,
	parseInsightsToMetrics,
	parseInsightsToAdSetMetrics,
	safeParseFloat,
	extractConversions,
	extractRevenue,
	resolveDateRange,
	formatDate,
} from "./reporting/index.js";
export type {
	Anomaly,
	AnomalyType,
	AnomalySeverity,
	PerformanceReport,
	ReportCampaignMetrics,
	ReportAdSetMetrics,
	AttributionReport,
	CampaignAttribution,
	SlackMessageType,
	SlackWebhookResult,
	ExportResult,
	ReportingToolContext,
} from "./reporting/index.js";

/* Re-export infrastructure */
export { createTool, ToolExecutionError } from "./types.js";
export type { ToolContext, ToolResult } from "./types.js";
export { ToolRegistry } from "./registry.js";
export { ToolExecutor } from "./executor.js";
export { HookManager } from "./hooks.js";

/* ---- Convenience imports for allTools builder ---- */
import { campaignTools } from "./campaign/index.js";
import { creativeTools } from "./creative/index.js";
import { reportingTools } from "./reporting/index.js";

/**
 * Static tools that do not require runtime configuration.
 * These can be registered immediately on agent startup.
 */
export const staticTools: ReadonlyArray<Tool<TObject>> = [
	...(campaignTools as ReadonlyArray<Tool<TObject>>),
	...(creativeTools as ReadonlyArray<Tool<TObject>>),
	...(reportingTools as ReadonlyArray<Tool<TObject>>),
];

/**
 * Assembles the complete tool suite including budget tools (which require
 * a MetaClient instance). Call this during agent initialization when the
 * MetaClient is available.
 *
 * @param budgetTools - Budget tools created via createBudgetTools()
 * @returns Combined array of all agent tools
 */
export function buildAllTools(
	budgetTools: ReadonlyArray<Tool<TObject>>,
): ReadonlyArray<Tool<TObject>> {
	return [
		...(campaignTools as ReadonlyArray<Tool<TObject>>),
		...budgetTools,
		...(creativeTools as ReadonlyArray<Tool<TObject>>),
		...(reportingTools as ReadonlyArray<Tool<TObject>>),
	];
}

/**
 * For environments where budget tools are not needed (e.g. testing),
 * allTools provides the static tool set. When budget tools are required,
 * use buildAllTools() instead.
 */
export const allTools: ReadonlyArray<Tool<TObject>> = staticTools;
