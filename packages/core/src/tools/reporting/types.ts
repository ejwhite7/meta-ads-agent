/**
 * @module tools/reporting/types
 *
 * Type definitions for the reporting and analytics tool suite.
 * Includes interfaces for performance reports, anomaly detection,
 * attribution data, Slack webhook payloads, and export results.
 *
 * These types are consumed by all reporting tools and serve as the
 * contract between the agent's reporting layer and its consumers
 * (dashboard, Slack notifications, file exports).
 */

import type { ToolContext } from "../types.js";

// ---------------------------------------------------------------------------
// Extended Tool Context
// ---------------------------------------------------------------------------

/**
 * Reporting-specific tool context that extends the base ToolContext
 * with a MetaClient reference for querying the Meta Ads API.
 *
 * The `metaClient` property follows the MetaClient facade interface
 * from `@meta-ads-agent/meta-client`, providing access to campaigns,
 * insights, ad sets, and other API resource groups.
 */
export interface ReportingToolContext extends ToolContext {
	/**
	 * MetaClient instance for querying the Meta Ads API.
	 * Must be initialized (call `metaClient.initialize()`) before use.
	 */
	readonly metaClient: MetaClientLike;
}

/**
 * Minimal interface describing the MetaClient shape needed by reporting tools.
 * Decouples the reporting module from the full `@meta-ads-agent/meta-client`
 * package, enabling easier testing with mocks.
 */
export interface MetaClientLike {
	/** Campaign CRUD operations. */
	readonly campaigns: {
		list(adAccountId: string): Promise<CampaignInfo[]>;
		get(campaignId: string): Promise<CampaignInfo>;
	};
	/** Performance insights queries. */
	readonly insights: {
		query(adAccountId: string, params: InsightsQueryLike): Promise<InsightsResultLike[]>;
	};
	/** Ad set operations. */
	readonly adSets: {
		list(adAccountId: string): Promise<AdSetInfo[]>;
	};
}

// ---------------------------------------------------------------------------
// Lightweight Entity Mirrors (avoids hard dependency on meta-client types)
// ---------------------------------------------------------------------------

/**
 * Minimal campaign information needed by reporting tools.
 * Mirrors the essential fields of the meta-client Campaign type.
 */
export interface CampaignInfo {
	/** Unique campaign identifier assigned by Meta. */
	id: string;
	/** Human-readable campaign name. */
	name: string;
	/** Current campaign status. */
	status: string;
	/** Campaign optimization objective. */
	objective: string;
	/** Daily budget in account currency cents (e.g., "5000" = $50.00). */
	daily_budget?: string;
}

/**
 * Minimal ad set information needed by reporting tools.
 */
export interface AdSetInfo {
	/** Unique ad set identifier. */
	id: string;
	/** Human-readable ad set name. */
	name: string;
	/** Parent campaign identifier. */
	campaign_id: string;
	/** Current ad set status. */
	status: string;
	/** Daily budget in account currency cents. */
	daily_budget?: string;
}

/**
 * Minimal insights query params needed by reporting tools.
 */
export interface InsightsQueryLike {
	/** Aggregation level for metrics. */
	level: "account" | "campaign" | "adset" | "ad";
	/** Predefined date range shortcut. */
	date_preset?: string;
	/** Custom date range. */
	time_range?: { since: string; until: string };
	/** Metric fields to retrieve. */
	fields?: string[];
	/** Breakdown dimensions. */
	breakdowns?: string[];
	/** Filtering conditions. */
	filtering?: Array<{
		field: string;
		operator: string;
		value: string | string[];
	}>;
}

/**
 * Minimal insights result needed by reporting tools.
 */
export interface InsightsResultLike {
	/** Campaign identifier. */
	campaign_id?: string;
	/** Campaign name. */
	campaign_name?: string;
	/** Ad set identifier. */
	adset_id?: string;
	/** Ad set name. */
	adset_name?: string;
	/** Total impressions as a string. */
	impressions: string;
	/** Total clicks as a string. */
	clicks: string;
	/** Total spend as a decimal string (e.g., "123.45"). */
	spend: string;
	/** Click-through rate as a decimal string. */
	ctr: string;
	/** Cost per mille as a string. */
	cpm: string;
	/** Cost per click as a string. */
	cpc?: string;
	/** Return on ad spend (computed). */
	roas?: number;
	/** Conversion actions. */
	actions?: Array<{ action_type: string; value: string }>;
	/** Reach (unique users). */
	reach?: string;
	/** Frequency (average impressions per user). */
	frequency?: string;
	/** Start date of the reporting period. */
	date_start: string;
	/** End date of the reporting period. */
	date_stop: string;
}

// ---------------------------------------------------------------------------
// Campaign Metrics (Reporting-Specific)
// ---------------------------------------------------------------------------

/**
 * Processed campaign-level metrics used in performance reports.
 * Unlike the raw InsightsResult, all values are parsed numbers.
 */
export interface ReportCampaignMetrics {
	/** Campaign identifier. */
	campaignId: string;
	/** Campaign name. */
	campaignName: string;
	/** Total spend in account currency. */
	spend: number;
	/** Total impressions. */
	impressions: number;
	/** Total clicks. */
	clicks: number;
	/** Click-through rate as a decimal (e.g., 0.025 = 2.5%). */
	ctr: number;
	/** Cost per click. */
	cpc: number;
	/** Cost per mille (cost per 1,000 impressions). */
	cpm: number;
	/** Total conversions. */
	conversions: number;
	/** Return on ad spend. */
	roas: number;
	/** Cost per acquisition (spend / conversions). */
	cpa: number;
	/** Total unique users reached. */
	reach: number;
	/** Average impressions per unique user. */
	frequency: number;
}

/**
 * Processed ad-set-level metrics used in performance reports.
 */
export interface ReportAdSetMetrics {
	/** Ad set identifier. */
	adSetId: string;
	/** Ad set name. */
	adSetName: string;
	/** Parent campaign identifier. */
	campaignId: string;
	/** Total spend in account currency. */
	spend: number;
	/** Total impressions. */
	impressions: number;
	/** Total clicks. */
	clicks: number;
	/** Click-through rate as a decimal. */
	ctr: number;
	/** Cost per click. */
	cpc: number;
	/** Cost per mille. */
	cpm: number;
	/** Total conversions. */
	conversions: number;
	/** Return on ad spend. */
	roas: number;
	/** Cost per acquisition. */
	cpa: number;
}

// ---------------------------------------------------------------------------
// Performance Report
// ---------------------------------------------------------------------------

/**
 * A structured performance report covering a specific date range.
 * Contains aggregated summary metrics plus breakdowns by campaign
 * and ad set (top 5 each by spend).
 */
export interface PerformanceReport {
	/** ISO 8601 timestamp when the report was generated. */
	generatedAt: string;
	/** Date range covered by the report. */
	dateRange: {
		/** Start date (YYYY-MM-DD). */
		start: string;
		/** End date (YYYY-MM-DD). */
		end: string;
	};
	/** Aggregated metrics across all campaigns. */
	summary: {
		/** Total spend in account currency. */
		totalSpend: number;
		/** Total impressions delivered. */
		totalImpressions: number;
		/** Total clicks received. */
		totalClicks: number;
		/** Average click-through rate across campaigns. */
		avgCTR: number;
		/** Average cost per click. */
		avgCPC: number;
		/** Total conversions. */
		totalConversions: number;
		/** Average return on ad spend. */
		avgROAS: number;
		/** Average cost per acquisition. */
		avgCPA: number;
	};
	/** Top campaigns broken down by spend (descending). */
	campaignBreakdown: ReportCampaignMetrics[];
	/** Top ad sets broken down by spend (descending). */
	adSetBreakdown: ReportAdSetMetrics[];
}

// ---------------------------------------------------------------------------
// Anomaly Detection
// ---------------------------------------------------------------------------

/** Types of anomalies the detector can identify. */
export type AnomalyType =
	| "CPA_SPIKE"
	| "CTR_DROP"
	| "DELIVERY_ISSUE"
	| "BUDGET_EXHAUSTION"
	| "CONVERSION_COLLAPSE";

/** Severity levels for detected anomalies. */
export type AnomalySeverity = "warning" | "critical";

/**
 * A detected anomaly in campaign performance compared to a baseline period.
 * Includes the raw metrics, percentage change, and a recommended action.
 */
export interface Anomaly {
	/** Campaign identifier where the anomaly was detected. */
	campaignId: string;
	/** Campaign name for human-readable context. */
	campaignName: string;
	/** Type of anomaly detected. */
	type: AnomalyType;
	/** Severity classification. */
	severity: AnomalySeverity;
	/** Current period value for the anomalous metric. */
	current: number;
	/** Baseline period value for the anomalous metric. */
	baseline: number;
	/** Percentage change from baseline (e.g., 50 = 50% increase). */
	changePercent: number;
	/** Human-readable description of the anomaly. */
	message: string;
	/** Suggested action to resolve the anomaly. */
	recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

/**
 * Attribution data for a single campaign within an attribution window.
 */
export interface CampaignAttribution {
	/** Campaign identifier. */
	campaignId: string;
	/** Campaign name. */
	campaignName: string;
	/** Total attributed conversions within the window. */
	conversions: number;
	/** Total attributed revenue within the window. */
	revenue: number;
	/** Attribution credit share as a decimal (0-1). */
	creditShare: number;
}

/**
 * Attribution report showing conversion credit allocation
 * across campaigns for a given attribution window.
 */
export interface AttributionReport {
	/** Ad account identifier. */
	adAccountId: string;
	/** Attribution window used for the analysis. */
	attributionWindow: string;
	/** Total attributed conversions across all campaigns. */
	totalConversions: number;
	/** Total attributed revenue across all campaigns. */
	totalRevenue: number;
	/** Per-campaign attribution breakdown. */
	campaignBreakdown: CampaignAttribution[];
}

// ---------------------------------------------------------------------------
// Slack Webhook
// ---------------------------------------------------------------------------

/** Types of Slack messages the webhook tool can send. */
export type SlackMessageType = "report" | "alert" | "action_taken";

/**
 * Result from a Slack webhook delivery attempt.
 */
export interface SlackWebhookResult {
	/** Whether the webhook was delivered successfully. */
	success: boolean;
	/** Error message if the delivery failed. */
	error?: string;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Result from writing a report to the local file system.
 */
export interface ExportResult {
	/** Absolute path where the file was written. */
	filePath: string;
	/** Number of bytes written to disk. */
	bytesWritten: number;
}
