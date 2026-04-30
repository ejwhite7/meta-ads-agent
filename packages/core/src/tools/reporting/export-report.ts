/**
 * @module tools/reporting/export-report
 *
 * Writes a generated performance report to the local file system in the
 * specified format (JSON, Markdown, or CSV). Enables the agent to persist
 * reports for archival, email distribution, or dashboard consumption.
 */

import { Type } from "@sinclair/typebox";
import { writeFile } from "node:fs/promises";
import { createTool } from "../types.js";
import type { PerformanceReport } from "./types.js";

/**
 * TypeBox schema for export-report parameters.
 */
const ExportReportParams = Type.Object({
	/** The performance report data to export (JSON-serialized). */
	report: Type.String({
		description: "JSON-serialized PerformanceReport object to write to disk",
	}),
	/** Absolute or relative file path to write the report to. */
	filePath: Type.String({
		description: "Destination file path for the exported report",
	}),
	/** Output format. */
	format: Type.Union(
		[
			Type.Literal("json"),
			Type.Literal("markdown"),
			Type.Literal("csv"),
		],
		{ description: "Export format: 'json', 'markdown', or 'csv'" },
	),
});

/**
 * Tool that writes a performance report to a local file.
 *
 * Accepts a JSON-serialized {@link PerformanceReport}, formats it according
 * to the specified output format, and writes the result to the given file path.
 * Returns the file path and number of bytes written.
 *
 * @example
 * ```typescript
 * const result = await exportReport.execute(
 *   {
 *     report: JSON.stringify(performanceReport),
 *     filePath: "/tmp/report-2024-01-15.md",
 *     format: "markdown",
 *   },
 *   context,
 * );
 * console.log(result.data?.bytesWritten); // 4096
 * ```
 */
export const exportReport = createTool({
	name: "export_report",
	description:
		"Writes a PerformanceReport to a local file in the specified format " +
		"(JSON, Markdown, or CSV). Returns the file path and bytes written.",
	parameters: ExportReportParams,
	async execute(params, _context): Promise<{ success: boolean; data: Record<string, unknown> | null; message: string }> {
		try {
			const report: PerformanceReport = JSON.parse(params.report);
			let content: string;

			switch (params.format) {
				case "markdown":
					content = formatReportAsMarkdown(report);
					break;
				case "csv":
					content = formatReportAsCsv(report);
					break;
				case "json":
				default:
					content = JSON.stringify(report, null, 2);
					break;
			}

			const buffer = Buffer.from(content, "utf-8");
			await writeFile(params.filePath, buffer);

			return {
				success: true,
				data: {
					filePath: params.filePath,
					bytesWritten: buffer.byteLength,
				},
				message: `Report exported to ${params.filePath} (${buffer.byteLength} bytes).`,
			};
		} catch (error) {
			const errMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				data: null,
				message: `Failed to export report: ${errMessage}`,
			};
		}
	},
});

/**
 * Formats a PerformanceReport as a readable Markdown string for file export.
 *
 * @param report - The report to format.
 * @returns Markdown-formatted report string.
 */
function formatReportAsMarkdown(report: PerformanceReport): string {
	const { summary, dateRange, campaignBreakdown, adSetBreakdown } = report;

	const lines: string[] = [
		`# Performance Report`,
		``,
		`**Period:** ${dateRange.start} to ${dateRange.end}`,
		`**Generated:** ${report.generatedAt}`,
		``,
		`## Summary`,
		``,
		`| Metric | Value |`,
		`|--------|-------|`,
		`| Total Spend | $${summary.totalSpend.toFixed(2)} |`,
		`| Total Impressions | ${summary.totalImpressions.toLocaleString()} |`,
		`| Total Clicks | ${summary.totalClicks.toLocaleString()} |`,
		`| Avg CTR | ${(summary.avgCTR * 100).toFixed(2)}% |`,
		`| Avg CPC | $${summary.avgCPC.toFixed(2)} |`,
		`| Total Conversions | ${summary.totalConversions.toLocaleString()} |`,
		`| Avg ROAS | ${summary.avgROAS.toFixed(2)}x |`,
		`| Avg CPA | $${summary.avgCPA.toFixed(2)} |`,
		``,
	];

	if (campaignBreakdown.length > 0) {
		lines.push(
			`## Top Campaigns (by Spend)`,
			``,
			`| Campaign | Spend | Impressions | Clicks | CTR | CPC | Conversions | ROAS | CPA |`,
			`|----------|-------|-------------|--------|-----|-----|-------------|------|-----|`,
		);
		for (const c of campaignBreakdown) {
			lines.push(
				`| ${c.campaignName} | $${c.spend.toFixed(2)} | ${c.impressions.toLocaleString()} | ${c.clicks.toLocaleString()} | ${(c.ctr * 100).toFixed(2)}% | $${c.cpc.toFixed(2)} | ${c.conversions} | ${c.roas.toFixed(2)}x | $${c.cpa.toFixed(2)} |`,
			);
		}
		lines.push(``);
	}

	if (adSetBreakdown.length > 0) {
		lines.push(
			`## Top Ad Sets (by Spend)`,
			``,
			`| Ad Set | Spend | Impressions | Clicks | CTR | CPC | Conversions | ROAS | CPA |`,
			`|--------|-------|-------------|--------|-----|-----|-------------|------|-----|`,
		);
		for (const a of adSetBreakdown) {
			lines.push(
				`| ${a.adSetName} | $${a.spend.toFixed(2)} | ${a.impressions.toLocaleString()} | ${a.clicks.toLocaleString()} | ${(a.ctr * 100).toFixed(2)}% | $${a.cpc.toFixed(2)} | ${a.conversions} | ${a.roas.toFixed(2)}x | $${a.cpa.toFixed(2)} |`,
			);
		}
		lines.push(``);
	}

	return lines.join("\n");
}

/**
 * Formats a PerformanceReport as a CSV string for file export.
 *
 * @param report - The report to format.
 * @returns CSV-formatted string.
 */
function formatReportAsCsv(report: PerformanceReport): string {
	const { campaignBreakdown, adSetBreakdown } = report;
	const lines: string[] = [];

	lines.push("Campaign Breakdown");
	lines.push("Campaign,Spend,Impressions,Clicks,CTR,CPC,CPM,Conversions,ROAS,CPA");
	for (const c of campaignBreakdown) {
		lines.push(
			`"${c.campaignName}",${c.spend.toFixed(2)},${c.impressions},${c.clicks},${c.ctr.toFixed(6)},${c.cpc.toFixed(2)},${c.cpm.toFixed(2)},${c.conversions},${c.roas.toFixed(2)},${c.cpa.toFixed(2)}`,
		);
	}
	lines.push(``);

	lines.push("Ad Set Breakdown");
	lines.push("Ad Set,Campaign ID,Spend,Impressions,Clicks,CTR,CPC,CPM,Conversions,ROAS,CPA");
	for (const a of adSetBreakdown) {
		lines.push(
			`"${a.adSetName}","${a.campaignId}",${a.spend.toFixed(2)},${a.impressions},${a.clicks},${a.ctr.toFixed(6)},${a.cpc.toFixed(2)},${a.cpm.toFixed(2)},${a.conversions},${a.roas.toFixed(2)},${a.cpa.toFixed(2)}`,
		);
	}

	return lines.join("\n");
}
