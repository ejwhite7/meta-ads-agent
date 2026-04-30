/**
 * @module tools/reporting
 *
 * Reporting and analytics tool suite for the meta-ads-agent.
 * Provides autonomous report generation, anomaly detection,
 * Slack alerting, attribution analysis, and file export capabilities.
 *
 * All tools follow the standard {@link Tool} interface using TypeBox
 * schemas for parameter validation and the `createTool()` factory function.
 *
 * @example
 * ```typescript
 * import { reportingTools } from "./tools/reporting/index.js";
 *
 * for (const tool of reportingTools) {
 *   registry.register(tool);
 * }
 * ```
 */

/* ---- Tool implementations ---- */
export { getCampaignMetrics } from "./get-campaign-metrics.js";
export { generatePerformanceReport } from "./generate-performance-report.js";
export { detectAnomalies } from "./detect-anomalies.js";
export { sendSlackWebhook } from "./send-slack-webhook.js";
export { getAttributionStats } from "./get-attribution-stats.js";
export { exportReport } from "./export-report.js";

/* ---- Types ---- */
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
} from "./types.js";

/* ---- Utilities ---- */
export {
	parseInsightsToMetrics,
	parseInsightsToAdSetMetrics,
	safeParseFloat,
	extractConversions,
	extractRevenue,
	resolveDateRange,
	formatDate,
} from "./utils.js";

/* ---- Import tool instances for the aggregate array ---- */
import { getCampaignMetrics } from "./get-campaign-metrics.js";
import { generatePerformanceReport } from "./generate-performance-report.js";
import { detectAnomalies } from "./detect-anomalies.js";
import { sendSlackWebhook } from "./send-slack-webhook.js";
import { getAttributionStats } from "./get-attribution-stats.js";
import { exportReport } from "./export-report.js";
import type { Tool } from "../types.js";
import type { TObject } from "@sinclair/typebox";

/**
 * Array of all reporting and analytics tools, ready for bulk registration
 * with a {@link ToolRegistry}.
 *
 * Contains:
 * - `get_campaign_metrics` — Single campaign metrics retrieval
 * - `generate_performance_report` — Multi-format performance reports
 * - `detect_anomalies` — Anomaly detection against 7-day baseline
 * - `send_slack_webhook` — Slack Block Kit notifications
 * - `get_attribution_stats` — Attribution window analysis
 * - `export_report` — File export (JSON/Markdown/CSV)
 */
export const reportingTools: Tool<TObject>[] = [
	getCampaignMetrics,
	generatePerformanceReport,
	detectAnomalies,
	sendSlackWebhook,
	getAttributionStats,
	exportReport,
] as Tool<TObject>[];
