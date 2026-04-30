/**
 * @module tools/reporting/get-campaign-metrics
 *
 * Retrieves processed performance metrics for a single campaign over a
 * specified date period. Serves as a foundational building block for
 * higher-level reporting tools (performance reports, anomaly detection).
 *
 * Queries the Meta Insights API via the MetaClient, parses raw string
 * values into numbers, computes derived metrics (CPA, ROAS), and returns
 * a fully typed {@link ReportCampaignMetrics} object.
 */

import { Type } from "@sinclair/typebox";
import { createTool } from "../types.js";
import type { ReportCampaignMetrics, ReportingToolContext } from "./types.js";
import { parseInsightsToMetrics } from "./utils.js";

/**
 * TypeBox schema for get-campaign-metrics parameters.
 * Validates the campaign ID and date preset at runtime.
 */
const GetCampaignMetricsParams = Type.Object({
	/** Meta campaign ID to retrieve metrics for. */
	campaignId: Type.String({ description: "Meta campaign ID (e.g., '23851234567890123')" }),
	/** Predefined date range for the metrics query. */
	datePreset: Type.Union(
		[
			Type.Literal("today"),
			Type.Literal("yesterday"),
			Type.Literal("last_7d"),
			Type.Literal("last_14d"),
			Type.Literal("last_30d"),
		],
		{ description: "Date range preset for the metrics query" },
	),
});

/**
 * Tool that fetches a single campaign's performance metrics for a given period.
 *
 * Queries the Meta Insights API at the campaign level, enriches the result
 * with computed CPA and ROAS, and returns a fully parsed numeric metrics object.
 * Used internally by {@link generatePerformanceReport} and {@link detectAnomalies}
 * as a shared data-fetching primitive.
 *
 * @example
 * ```typescript
 * const result = await getCampaignMetrics.execute(
 *   { campaignId: "23851234567890123", datePreset: "last_7d" },
 *   context,
 * );
 * if (result.success) {
 *   const metrics = result.data as ReportCampaignMetrics;
 *   console.log(`CPA: $${metrics.cpa.toFixed(2)}`);
 * }
 * ```
 */
export const getCampaignMetrics = createTool({
	name: "get_campaign_metrics",
	description:
		"Fetches performance metrics (spend, impressions, clicks, CTR, CPC, CPM, reach, " +
		"frequency, conversions, ROAS, CPA) for a single campaign over a specified date period.",
	parameters: GetCampaignMetricsParams,
	async execute(params, context): Promise<{ success: boolean; data: Record<string, unknown> | null; message: string }> {
		const ctx = context as ReportingToolContext;

		if (!ctx.metaClient) {
			return {
				success: false,
				data: null,
				message: "MetaClient is not available in the tool context.",
			};
		}

		try {
			const insights = await ctx.metaClient.insights.query(ctx.adAccountId, {
				level: "campaign",
				date_preset: params.datePreset,
				fields: [
					"campaign_id",
					"campaign_name",
					"impressions",
					"clicks",
					"spend",
					"ctr",
					"cpc",
					"cpm",
					"reach",
					"frequency",
					"actions",
				],
				filtering: [
					{
						field: "campaign.id",
						operator: "EQUAL",
						value: params.campaignId,
					},
				],
			});

			if (!insights || insights.length === 0) {
				return {
					success: true,
					data: null,
					message: `No insights data found for campaign ${params.campaignId} in period ${params.datePreset}.`,
				};
			}

			const metrics: ReportCampaignMetrics = parseInsightsToMetrics(insights[0]);

			return {
				success: true,
				data: metrics as unknown as Record<string, unknown>,
				message: `Retrieved metrics for campaign ${metrics.campaignName} (${params.datePreset}).`,
			};
		} catch (error) {
			const errMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				data: null,
				message: `Failed to fetch campaign metrics: ${errMessage}`,
			};
		}
	},
});
