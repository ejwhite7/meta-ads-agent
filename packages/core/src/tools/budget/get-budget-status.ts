/**
 * @module tools/budget/get-budget-status
 *
 * Retrieves the current budget status for an ad account, including total spend,
 * pacing analysis, burn rate, and projected month-end spend. Pacing is computed
 * by comparing actual spend against the expected spend based on elapsed time
 * within the reporting period.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { MetaClient } from "@meta-ads-agent/meta-client";
import { createTool } from "../types.js";
import type { ToolContext, ToolResult } from "../types.js";

/**
 * Pacing status indicating whether spend is tracking to plan.
 * - on_track: within 10% of expected pace
 * - overpacing: more than 10% above expected pace
 * - underpacing: more than 10% below expected pace
 */
export type PacingStatus = "on_track" | "overpacing" | "underpacing";

/**
 * TypeBox schema for get_budget_status tool parameters.
 */
const GetBudgetStatusParams = Type.Object({
	/** Meta ad account ID (format: "act_XXXXXXXXX"). */
	adAccountId: Type.String({ description: "Meta ad account ID (format: act_XXXXXXXXX)" }),
	/** Predefined date range for the budget analysis. */
	datePreset: Type.Union(
		[
			Type.Literal("today"),
			Type.Literal("last_7d"),
			Type.Literal("this_month"),
		],
		{ description: "Date range preset for budget analysis" },
	),
});

/** Inferred TypeScript type from the parameter schema. */
type GetBudgetStatusInput = Static<typeof GetBudgetStatusParams>;

/**
 * Computes the number of elapsed days and total days for a given date preset.
 *
 * @param datePreset - The reporting period identifier.
 * @param now - Current date/time reference.
 * @returns Object with daysElapsed and totalDays for the period.
 */
function computePeriodDays(
	datePreset: GetBudgetStatusInput["datePreset"],
	now: Date,
): { daysElapsed: number; totalDays: number } {
	switch (datePreset) {
		case "today":
			return {
				daysElapsed: (now.getHours() * 60 + now.getMinutes()) / (24 * 60),
				totalDays: 1,
			};
		case "last_7d":
			return { daysElapsed: 7, totalDays: 7 };
		case "this_month": {
			const year = now.getFullYear();
			const month = now.getMonth();
			const totalDays = new Date(year, month + 1, 0).getDate();
			const daysElapsed = now.getDate();
			return { daysElapsed, totalDays };
		}
	}
}

/**
 * Determines the pacing status based on actual vs. expected spend ratio.
 * On track is within +/-10% of the expected pace.
 *
 * @param pacingRatio - Ratio of actual spend to expected spend (1.0 = exactly on pace).
 * @returns The pacing status classification.
 */
function classifyPacing(pacingRatio: number): PacingStatus {
	if (pacingRatio > 1.1) {
		return "overpacing";
	}
	if (pacingRatio < 0.9) {
		return "underpacing";
	}
	return "on_track";
}

/**
 * Creates the get_budget_status tool.
 *
 * This tool retrieves aggregate budget information for an ad account,
 * computing pacing against total campaign budgets to determine whether
 * spend is on track, overpacing, or underpacing.
 *
 * @param client - Initialized MetaClient instance for API access.
 * @returns Frozen tool definition ready for registry.
 */
export function createGetBudgetStatusTool(client: MetaClient) {
	return createTool({
		name: "get_budget_status",
		description:
			"Retrieves budget status for an ad account including total spend, " +
			"pacing (on track / overpacing / underpacing), burn rate, and " +
			"projected month-end spend.",
		parameters: GetBudgetStatusParams,

		async execute(
			params: GetBudgetStatusInput,
			context: ToolContext,
		): Promise<ToolResult> {
			const now = new Date(context.timestamp);

			/* Fetch campaign list to compute total budget */
			const campaigns = await client.campaigns.list(params.adAccountId);
			const activeCampaigns = campaigns.filter(
				(c) => c.status === "ACTIVE",
			);

			/* Sum daily budgets across active campaigns (budgets are in cents) */
			let totalDailyBudgetCents = 0;
			for (const campaign of activeCampaigns) {
				if (campaign.daily_budget) {
					totalDailyBudgetCents += Number.parseInt(campaign.daily_budget, 10);
				}
			}
			const totalDailyBudget = totalDailyBudgetCents / 100;

			/* Fetch account-level insights for the requested period */
			const insights = await client.insights.query(params.adAccountId, {
				level: "account",
				date_preset: params.datePreset,
				fields: ["spend", "impressions", "clicks", "actions"],
			});

			const totalSpend = insights.reduce(
				(sum, row) => sum + Number.parseFloat(row.spend || "0"),
				0,
			);

			/* Compute pacing */
			const { daysElapsed, totalDays } = computePeriodDays(params.datePreset, now);
			const periodBudget = totalDailyBudget * totalDays;
			const expectedSpend =
				periodBudget > 0
					? periodBudget * (daysElapsed / totalDays)
					: 0;

			const pacingRatio = expectedSpend > 0 ? totalSpend / expectedSpend : 0;
			const pacing = classifyPacing(pacingRatio);

			/* Compute burn rate (spend per day) */
			const burnRate = daysElapsed > 0 ? totalSpend / daysElapsed : 0;

			/* Project month-end spend */
			const year = now.getFullYear();
			const month = now.getMonth();
			const daysInMonth = new Date(year, month + 1, 0).getDate();
			const dayOfMonth = now.getDate();
			const projectedMonthEndSpend =
				dayOfMonth > 0
					? (totalSpend / dayOfMonth) * daysInMonth
					: 0;

			return {
				success: true,
				data: {
					adAccountId: params.adAccountId,
					datePreset: params.datePreset,
					totalSpend: Math.round(totalSpend * 100) / 100,
					totalDailyBudget: Math.round(totalDailyBudget * 100) / 100,
					periodBudget: Math.round(periodBudget * 100) / 100,
					pacing,
					pacingRatio: Math.round(pacingRatio * 1000) / 1000,
					burnRate: Math.round(burnRate * 100) / 100,
					projectedMonthEndSpend: Math.round(projectedMonthEndSpend * 100) / 100,
					activeCampaignCount: activeCampaigns.length,
				},
				message:
					`Budget status for ${params.adAccountId}: ` +
					`$${(Math.round(totalSpend * 100) / 100).toFixed(2)} spent ` +
					`(${pacing}, ${(pacingRatio * 100).toFixed(1)}% of expected pace). ` +
					`Burn rate: $${(Math.round(burnRate * 100) / 100).toFixed(2)}/day. ` +
					`Projected month-end: $${(Math.round(projectedMonthEndSpend * 100) / 100).toFixed(2)}.`,
			};
		},
	});
}
