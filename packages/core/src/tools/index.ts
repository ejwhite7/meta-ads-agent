/**
 * @module tools
 *
 * Public API for the meta-ads-agent tool system.
 * Re-exports the core tool infrastructure (types, registry, executor, hooks)
 * alongside the reporting and analytics tool suite.
 *
 * The tool system is built on TypeBox schemas for compile-time and runtime
 * type safety, with a Map-based registry, retry-enabled executor, and
 * a before/after hook system for approval flows and telemetry.
 */

/* ---- Core Tool Infrastructure ---- */
export { createTool, ToolExecutionError } from "./types.js";
export type { Tool, ToolContext, ToolResult } from "./types.js";
export { ToolRegistry } from "./registry.js";
export { ToolExecutor } from "./executor.js";
export type { ExecutorConfig } from "./executor.js";
export { HookManager } from "./hooks.js";
export type { BeforeHook, AfterHook } from "./hooks.js";

/* ---- Reporting & Analytics Tools ---- */
export { reportingTools } from "./reporting/index.js";
export {
	getCampaignMetrics,
	generatePerformanceReport,
	detectAnomalies,
	sendSlackWebhook,
	getAttributionStats,
	exportReport,
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
	MetaClientLike,
} from "./reporting/index.js";
