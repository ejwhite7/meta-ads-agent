/**
 * @module tools/reporting/get-attribution-stats
 *
 * Fetches attribution data for a Meta ad account within a specified
 * attribution window. Provides a breakdown of conversion credit by
 * campaign, showing how conversions are distributed across the
 * account's campaigns under different attribution models.
 *
 * Supports 1-day click, 7-day click, and 28-day click attribution windows,
 * matching Meta's standard attribution windows.
 */

import { Type } from "@sinclair/typebox";
import { createTool } from "../types.js";
import type {
	AttributionReport,
	CampaignAttribution,
	ReportingToolContext,
} from "./types.js";
import { safeParseFloat, extractConversions, extractRevenue } from "./utils.js";

/**
 * Maps attribution window parameter values to Meta API action_attribution_windows.
 */
const ATTRIBUTION_WINDOW_MAP: Record<string, string> = {
	"1d_click": "1d_click",
	"7d_click": "7d_click",
	"28d_click": "28d_click",
};

/**
 * TypeBox schema for get-attribution-stats parameters.
 */
const GetAttributionStatsParams = Type.Object({
	/** Meta ad account ID. */
	adAccountId: Type.String({ description: "Meta ad account ID (e.g., 'act_123456789')" }),
	/** Attribution window for conversion credit assignment. */
	attributionWindow: Type.Union(
		[
			Type.Literal("1d_click"),
			Type.Literal("7d_click"),
			Type.Literal("28d_click"),
		],
		{ description: "Attribution window: '1d_click', '7d_click', or '28d_click'" },
	),
});

/**
 * Tool that fetches attribution data for a Meta ad account.
 *
 * Queries the Insights API with the specified attribution window and
 * returns a breakdown showing each campaign's conversion count, revenue,
 * and credit share. Useful for understanding which campaigns drive
 * conversions under different attribution models.
 *
 * @example
 * ```typescript
 * const result = await getAttributionStats.execute(
 *   { adAccountId: "act_123", attributionWindow: "7d_click" },
 *   context,
 * );
 * const report = result.data?.report as AttributionReport;
 * for (const c of report.campaignBreakdown) {
 *   console.log(`${c.campaignName}: ${c.conversions} conversions (${(c.creditShare * 100).toFixed(1)}%)`);
 * }
 * ```
 */
export const getAttributionStats = createTool({
	name: "get_attribution_stats",
	description:
		"Fetches attribution data for a Meta ad account showing conversion credit " +
		"distribution across campaigns for a specified attribution window " +
		"(1-day click, 7-day click, or 28-day click).",
	parameters: GetAttributionStatsParams,
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
			const windowValue = ATTRIBUTION_WINDOW_MAP[params.attributionWindow];

			/* ---- Fetch insights with attribution window ---- */
			const insights = await ctx.metaClient.insights.query(params.adAccountId, {
				level: "campaign",
				date_preset: "last_30d",
				fields: [
					"campaign_id",
					"campaign_name",
					"actions",
					"spend",
					"impressions",
				],
				breakdowns: [`action_attribution_windows:${windowValue}`],
			});

			/* ---- Parse campaign attribution data ---- */
			const campaignData: CampaignAttribution[] = [];
			let totalConversions = 0;
			let totalRevenue = 0;

			for (const insight of insights) {
				const conversions = extractConversions(insight.actions);
				const revenue = extractRevenue(insight.actions);

				totalConversions += conversions;
				totalRevenue += revenue;

				campaignData.push({
					campaignId: insight.campaign_id ?? "",
					campaignName: insight.campaign_name ?? "Unknown Campaign",
					conversions,
					revenue,
					creditShare: 0,
				});
			}

			/* ---- Calculate credit shares ---- */
			for (const campaign of campaignData) {
				campaign.creditShare =
					totalConversions > 0 ? campaign.conversions / totalConversions : 0;
			}

			/* ---- Sort by conversions descending ---- */
			campaignData.sort((a, b) => b.conversions - a.conversions);

			const report: AttributionReport = {
				adAccountId: params.adAccountId,
				attributionWindow: params.attributionWindow,
				totalConversions,
				totalRevenue,
				campaignBreakdown: campaignData,
			};

			return {
				success: true,
				data: report as unknown as Record<string, unknown>,
				message: `Attribution report generated for ${params.adAccountId} (${params.attributionWindow} window, ${insights.length} campaigns).`,
			};
		} catch (error) {
			const errMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				data: null,
				message: `Failed to fetch attribution stats: ${errMessage}`,
			};
		}
	},
});
