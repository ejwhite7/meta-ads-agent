/**
 * `meta-ads-agent report` command.
 *
 * Generates a performance summary for managed campaigns over a
 * configurable date range. Displays spend, impressions, clicks,
 * conversions, ROAS, CPA, and CPC in a formatted table, along with
 * trend comparisons against the prior period.
 */

import type { Command } from "commander";
import { DaemonManager } from "../daemon/manager.js";
import { printTable, section, success } from "../utils/display.js";
import { handleError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/**
 * Format a currency value with two decimal places and dollar sign.
 */
function currency(value: number): string {
	return `$${value.toFixed(2)}`;
}

/**
 * Format a percentage change with a directional arrow.
 */
function trend(current: number, previous: number): string {
	if (previous === 0) return "n/a";
	const pct = ((current - previous) / previous) * 100;
	const arrow = pct >= 0 ? "+" : "";
	return `${arrow}${pct.toFixed(1)}%`;
}

/**
 * Register the `report` command on the root program.
 */
export function registerReportCommand(program: Command): void {
	program
		.command("report")
		.description("Generate a performance summary report")
		.option("--days <n>", "Number of days to report on", "7")
		.action(async (options: { days: string }) => {
			const days = Number.parseInt(options.days, 10);

			if (Number.isNaN(days) || days < 1) {
				logger.error("--days must be a positive integer.");
				process.exitCode = 1;
				return;
			}

			try {
				const daemon = new DaemonManager();
				const report = await daemon.getReport(days);

				section(`Performance Report (last ${days} days)`);

				// Summary metrics
				const summaryRows = [
					{
						Metric: "Total Spend",
						Current: currency(report.current.spend),
						Previous: currency(report.previous.spend),
						Trend: trend(report.current.spend, report.previous.spend),
					},
					{
						Metric: "Impressions",
						Current: report.current.impressions.toLocaleString(),
						Previous: report.previous.impressions.toLocaleString(),
						Trend: trend(report.current.impressions, report.previous.impressions),
					},
					{
						Metric: "Clicks",
						Current: report.current.clicks.toLocaleString(),
						Previous: report.previous.clicks.toLocaleString(),
						Trend: trend(report.current.clicks, report.previous.clicks),
					},
					{
						Metric: "Conversions",
						Current: report.current.conversions.toLocaleString(),
						Previous: report.previous.conversions.toLocaleString(),
						Trend: trend(report.current.conversions, report.previous.conversions),
					},
					{
						Metric: "ROAS",
						Current: report.current.roas.toFixed(2),
						Previous: report.previous.roas.toFixed(2),
						Trend: trend(report.current.roas, report.previous.roas),
					},
					{
						Metric: "CPA",
						Current: currency(report.current.cpa),
						Previous: currency(report.previous.cpa),
						Trend: trend(report.current.cpa, report.previous.cpa),
					},
					{
						Metric: "CPC",
						Current: currency(report.current.cpc),
						Previous: currency(report.previous.cpc),
						Trend: trend(report.current.cpc, report.previous.cpc),
					},
				];

				printTable(summaryRows, ["Metric", "Current", "Previous", "Trend"]);

				// Campaign breakdown
				if (report.campaigns.length > 0) {
					section("Campaign Breakdown");

					const campaignRows = report.campaigns.map(
						(c: {
							name: string;
							status: string;
							spend: number;
							roas: number;
							cpa: number;
						}) => ({
							Campaign: c.name,
							Status: c.status,
							Spend: currency(c.spend),
							ROAS: c.roas.toFixed(2),
							CPA: currency(c.cpa),
						}),
					);

					printTable(campaignRows, ["Campaign", "Status", "Spend", "ROAS", "CPA"]);
				}

				success("Report generated successfully.");
			} catch (err: unknown) {
				handleError(err);
				process.exitCode = 1;
			}
		});
}
