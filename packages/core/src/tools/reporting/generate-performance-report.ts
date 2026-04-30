/**
 * @module tools/reporting/generate-performance-report
 *
 * Generates structured performance reports for a Meta ad account over a
 * configurable date range. Supports three output formats: JSON (structured
 * data), Markdown (human-readable tables), and CSV (spreadsheet-compatible).
 *
 * Reports include account-level summary metrics and breakdowns by the
 * top 5 campaigns and top 5 ad sets (ranked by spend). The tool fetches
 * all data from the Meta Insights API and computes derived metrics like
 * CTR, CPC, CPA, and ROAS.
 */

import { Type } from "@sinclair/typebox";
import { type ToolResult, createTool } from "../types.js";
import type {
	PerformanceReport,
	ReportAdSetMetrics,
	ReportCampaignMetrics,
	ReportingToolContext,
} from "./types.js";
import { parseInsightsToAdSetMetrics, parseInsightsToMetrics, resolveDateRange } from "./utils.js";

/**
 * TypeBox schema for generate-performance-report parameters.
 */
const GeneratePerformanceReportParams = Type.Object({
	/** Date range selection mode. */
	dateRange: Type.Union(
		[Type.Literal("last_7d"), Type.Literal("last_30d"), Type.Literal("custom")],
		{ description: "Date range for the report" },
	),
	/** Custom start date (YYYY-MM-DD). Required when dateRange is "custom". */
	startDate: Type.Optional(
		Type.String({ description: "Start date in YYYY-MM-DD format (required for custom range)" }),
	),
	/** Custom end date (YYYY-MM-DD). Required when dateRange is "custom". */
	endDate: Type.Optional(
		Type.String({ description: "End date in YYYY-MM-DD format (required for custom range)" }),
	),
	/** Output format for the report. */
	format: Type.Union([Type.Literal("json"), Type.Literal("markdown"), Type.Literal("csv")], {
		description:
			"Output format: 'json' for structured data, 'markdown' for readable report, 'csv' for spreadsheet",
	}),
});

/**
 * Tool that generates a comprehensive performance report for a Meta ad account.
 *
 * Fetches campaign-level and ad-set-level insights, computes summary metrics,
 * and formats the output as JSON, Markdown, or CSV depending on the `format`
 * parameter.
 *
 * @example
 * ```typescript
 * const result = await generatePerformanceReport.execute(
 *   { adAccountId: "act_123", dateRange: "last_7d", format: "markdown" },
 *   context,
 * );
 * console.log(result.data?.formatted); // Markdown report string
 * ```
 */
export const generatePerformanceReport = createTool({
	name: "generate_performance_report",
	description:
		"Generates a structured performance report for a Meta ad account over a specified " +
		"date range. Includes summary metrics (spend, impressions, clicks, CTR, CPC, " +
		"conversions, ROAS, CPA) and breakdowns by top 5 campaigns and ad sets.",
	parameters: GeneratePerformanceReportParams,
	async execute(params, context): Promise<ToolResult> {
		const ctx = context as ReportingToolContext;

		if (!ctx.metaClient) {
			return {
				success: false,
				data: null,
				error: "MetaClient is not available in the tool context.",
				message: "MetaClient is not available in the tool context.",
			};
		}

		try {
			/* ---- Resolve date range ---- */
			let dateConfig: { date_preset?: string; time_range?: { since: string; until: string } };
			let reportDateRange: { start: string; end: string };

			if (params.dateRange === "custom") {
				if (!params.startDate || !params.endDate) {
					return {
						success: false,
						data: null,
						error: "startDate and endDate are required when dateRange is 'custom'.",
						message: "startDate and endDate are required when dateRange is 'custom'.",
					};
				}
				dateConfig = { time_range: { since: params.startDate, until: params.endDate } };
				reportDateRange = { start: params.startDate, end: params.endDate };
			} else {
				dateConfig = { date_preset: params.dateRange };
				const resolved = resolveDateRange(params.dateRange);
				reportDateRange = { start: resolved.since, end: resolved.until };
			}

			/* ---- Fetch campaign-level insights ---- */
			const campaignInsights = await ctx.metaClient.insights.query(context.adAccountId, {
				level: "campaign",
				...dateConfig,
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
			});

			const campaignMetrics: ReportCampaignMetrics[] = campaignInsights
				.map(parseInsightsToMetrics)
				.sort((a, b) => b.spend - a.spend);

			/* ---- Fetch ad-set-level insights ---- */
			const adSetInsights = await ctx.metaClient.insights.query(context.adAccountId, {
				level: "adset",
				...dateConfig,
				fields: [
					"adset_id",
					"adset_name",
					"campaign_id",
					"impressions",
					"clicks",
					"spend",
					"ctr",
					"cpc",
					"cpm",
					"actions",
				],
			});

			const adSetMetrics: ReportAdSetMetrics[] = adSetInsights
				.map(parseInsightsToAdSetMetrics)
				.sort((a, b) => b.spend - a.spend);

			/* ---- Compute summary ---- */
			const totalSpend = campaignMetrics.reduce((sum, c) => sum + c.spend, 0);
			const totalImpressions = campaignMetrics.reduce((sum, c) => sum + c.impressions, 0);
			const totalClicks = campaignMetrics.reduce((sum, c) => sum + c.clicks, 0);
			const totalConversions = campaignMetrics.reduce((sum, c) => sum + c.conversions, 0);
			const avgCTR = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
			const avgCPC = totalClicks > 0 ? totalSpend / totalClicks : 0;
			const avgCPA = totalConversions > 0 ? totalSpend / totalConversions : 0;
			const totalRevenue = campaignMetrics.reduce((sum, c) => sum + c.roas * c.spend, 0);
			const avgROAS = totalSpend > 0 ? totalRevenue / totalSpend : 0;

			/* ---- Build report ---- */
			const report: PerformanceReport = {
				generatedAt: new Date().toISOString(),
				dateRange: reportDateRange,
				summary: {
					totalSpend,
					totalImpressions,
					totalClicks,
					avgCTR,
					avgCPC,
					totalConversions,
					avgROAS,
					avgCPA,
				},
				campaignBreakdown: campaignMetrics.slice(0, 5),
				adSetBreakdown: adSetMetrics.slice(0, 5),
			};

			/* ---- Format output ---- */
			let formatted: string;
			switch (params.format) {
				case "markdown":
					formatted = formatReportAsMarkdown(report);
					break;
				case "csv":
					formatted = formatReportAsCsv(report);
					break;
				default:
					formatted = JSON.stringify(report, null, 2);
					break;
			}

			return {
				success: true,
				data: {
					report,
					formatted,
					format: params.format,
				} as unknown as Record<string, unknown>,
				message: `Performance report generated for ${context.adAccountId} (${params.dateRange}).`,
			};
		} catch (error) {
			const errMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				data: null,
				error: `Failed to generate performance report: ${errMessage}`,
				message: `Failed to generate performance report: ${errMessage}`,
			};
		}
	},
});

/**
 * Formats a PerformanceReport as a readable Markdown string.
 * Includes summary metrics in a header section and campaign/ad set
 * breakdowns as Markdown tables.
 *
 * @param report - The report to format.
 * @returns Markdown-formatted report string.
 */
function formatReportAsMarkdown(report: PerformanceReport): string {
	const { summary, dateRange, campaignBreakdown, adSetBreakdown } = report;

	const lines: string[] = [
		"# Performance Report",
		"",
		`**Period:** ${dateRange.start} to ${dateRange.end}`,
		`**Generated:** ${report.generatedAt}`,
		"",
		"## Summary",
		"",
		"| Metric | Value |",
		"|--------|-------|",
		`| Total Spend | $${summary.totalSpend.toFixed(2)} |`,
		`| Total Impressions | ${summary.totalImpressions.toLocaleString()} |`,
		`| Total Clicks | ${summary.totalClicks.toLocaleString()} |`,
		`| Avg CTR | ${(summary.avgCTR * 100).toFixed(2)}% |`,
		`| Avg CPC | $${summary.avgCPC.toFixed(2)} |`,
		`| Total Conversions | ${summary.totalConversions.toLocaleString()} |`,
		`| Avg ROAS | ${summary.avgROAS.toFixed(2)}x |`,
		`| Avg CPA | $${summary.avgCPA.toFixed(2)} |`,
		"",
	];

	if (campaignBreakdown.length > 0) {
		lines.push(
			"## Top Campaigns (by Spend)",
			"",
			"| Campaign | Spend | Impressions | Clicks | CTR | CPC | Conversions | ROAS | CPA |",
			"|----------|-------|-------------|--------|-----|-----|-------------|------|-----|",
		);
		for (const c of campaignBreakdown) {
			lines.push(
				`| ${c.campaignName} | $${c.spend.toFixed(2)} | ${c.impressions.toLocaleString()} | ${c.clicks.toLocaleString()} | ${(c.ctr * 100).toFixed(2)}% | $${c.cpc.toFixed(2)} | ${c.conversions} | ${c.roas.toFixed(2)}x | $${c.cpa.toFixed(2)} |`,
			);
		}
		lines.push("");
	}

	if (adSetBreakdown.length > 0) {
		lines.push(
			"## Top Ad Sets (by Spend)",
			"",
			"| Ad Set | Spend | Impressions | Clicks | CTR | CPC | Conversions | ROAS | CPA |",
			"|--------|-------|-------------|--------|-----|-----|-------------|------|-----|",
		);
		for (const a of adSetBreakdown) {
			lines.push(
				`| ${a.adSetName} | $${a.spend.toFixed(2)} | ${a.impressions.toLocaleString()} | ${a.clicks.toLocaleString()} | ${(a.ctr * 100).toFixed(2)}% | $${a.cpc.toFixed(2)} | ${a.conversions} | ${a.roas.toFixed(2)}x | $${a.cpa.toFixed(2)} |`,
			);
		}
		lines.push("");
	}

	return lines.join("\n");
}

/**
 * Formats a PerformanceReport as CSV strings.
 * Produces two CSV sections: one for campaign breakdown and one for
 * ad set breakdown, separated by a blank line.
 *
 * @param report - The report to format.
 * @returns CSV-formatted string with headers.
 */
function formatReportAsCsv(report: PerformanceReport): string {
	const { campaignBreakdown, adSetBreakdown } = report;
	const lines: string[] = [];

	/* ---- Campaign CSV ---- */
	lines.push("Campaign Breakdown");
	lines.push("Campaign,Spend,Impressions,Clicks,CTR,CPC,CPM,Conversions,ROAS,CPA");
	for (const c of campaignBreakdown) {
		lines.push(
			`"${c.campaignName}",${c.spend.toFixed(2)},${c.impressions},${c.clicks},${c.ctr.toFixed(6)},${c.cpc.toFixed(2)},${c.cpm.toFixed(2)},${c.conversions},${c.roas.toFixed(2)},${c.cpa.toFixed(2)}`,
		);
	}
	lines.push("");

	/* ---- Ad Set CSV ---- */
	lines.push("Ad Set Breakdown");
	lines.push("Ad Set,Campaign ID,Spend,Impressions,Clicks,CTR,CPC,CPM,Conversions,ROAS,CPA");
	for (const a of adSetBreakdown) {
		lines.push(
			`"${a.adSetName}","${a.campaignId}",${a.spend.toFixed(2)},${a.impressions},${a.clicks},${a.ctr.toFixed(6)},${a.cpc.toFixed(2)},${a.cpm.toFixed(2)},${a.conversions},${a.roas.toFixed(2)},${a.cpa.toFixed(2)}`,
		);
	}

	return lines.join("\n");
}
