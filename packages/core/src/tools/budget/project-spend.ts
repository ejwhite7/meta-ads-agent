/**
 * @module tools/budget/project-spend
 *
 * Projects end-of-period spend, ROAS, and CPA based on current burn rate
 * and historical trends. Provides confidence levels based on the amount
 * of data available for the projection.
 */

import type { MetaClient } from "@meta-ads-agent/meta-client";
import { type Static, Type } from "@sinclair/typebox";
import { createTool } from "../types.js";
import type { ToolContext, ToolResult } from "../types.js";

/**
 * Confidence level for spend projections.
 * - high: 7+ days of data available
 * - medium: 3-6 days of data available
 * - low: fewer than 3 days of data available
 */
export type ProjectionConfidence = "high" | "medium" | "low";

/**
 * TypeBox schema for project_spend tool parameters.
 */
const ProjectSpendParams = Type.Object({
	/** Time horizon for the projection. */
	projectionPeriod: Type.Union(
		[Type.Literal("end_of_day"), Type.Literal("end_of_week"), Type.Literal("end_of_month")],
		{ description: "Projection time horizon" },
	),
});

/** Inferred TypeScript type from the parameter schema. */
type ProjectSpendInput = Static<typeof ProjectSpendParams>;

/**
 * Computes the number of remaining days for a projection period.
 *
 * @param period - The target projection period.
 * @param now - Current date/time reference.
 * @returns Object with remainingDays and totalPeriodDays.
 */
function computeRemainingDays(
	period: ProjectSpendInput["projectionPeriod"],
	now: Date,
): { remainingDays: number; totalPeriodDays: number } {
	switch (period) {
		case "end_of_day": {
			const hoursRemaining = (24 - now.getHours() - now.getMinutes() / 60) / 24;
			return { remainingDays: hoursRemaining, totalPeriodDays: 1 };
		}
		case "end_of_week": {
			const dayOfWeek = now.getDay();
			const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
			return { remainingDays: daysUntilSunday, totalPeriodDays: 7 };
		}
		case "end_of_month": {
			const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
			const remainingDays = daysInMonth - now.getDate();
			return { remainingDays, totalPeriodDays: daysInMonth };
		}
	}
}

/**
 * Determines projection confidence based on available data days.
 *
 * @param daysOfData - Number of days of historical data available.
 * @returns Confidence classification.
 */
function classifyConfidence(daysOfData: number): ProjectionConfidence {
	if (daysOfData >= 7) {
		return "high";
	}
	if (daysOfData >= 3) {
		return "medium";
	}
	return "low";
}

/**
 * Creates the project_spend tool.
 *
 * Projects end-of-period spend, ROAS, and CPA based on current burn rate.
 * Uses account-level insights from the last 7 days to establish the
 * daily run rate, then extrapolates to the target period.
 *
 * @param client - Initialized MetaClient instance for API access.
 * @returns Frozen tool definition ready for registry.
 */
export function createProjectSpendTool(client: MetaClient) {
	return createTool({
		name: "project_spend",
		description:
			"Projects end-of-period spend based on current burn rate. " +
			"Returns projected spend, ROAS, CPA, and confidence level.",
		parameters: ProjectSpendParams,

		async execute(params: ProjectSpendInput, context: ToolContext): Promise<ToolResult> {
			const now = new Date(context.timestamp);
			const { projectionPeriod } = params;

			/* Fetch last 7 days of account-level insights for burn rate calculation */
			const insights = await client.insights.query(context.adAccountId, {
				level: "account",
				date_preset: "last_7d",
				fields: ["spend", "impressions", "clicks", "actions"],
			});

			/* Aggregate metrics across the period */
			let totalSpend = 0;
			let totalRevenue = 0;
			let totalConversions = 0;
			let daysOfData = 0;

			for (const row of insights) {
				const spend = Number.parseFloat(row.spend || "0");
				totalSpend += spend;
				daysOfData++;

				if (row.actions) {
					for (const action of row.actions) {
						if (action.action_type === "purchase" || action.action_type === "omni_purchase") {
							totalRevenue += Number.parseFloat(action.value);
						}
						if (
							action.action_type === "purchase" ||
							action.action_type === "omni_purchase" ||
							action.action_type === "offsite_conversion"
						) {
							totalConversions += Number.parseFloat(action.value);
						}
					}
				}
			}

			/* Compute daily rates */
			const effectiveDays = Math.max(daysOfData, 1);
			const dailySpendRate = totalSpend / effectiveDays;
			const dailyRevenueRate = totalRevenue / effectiveDays;
			const dailyConversionRate = totalConversions / effectiveDays;

			/* Compute remaining period */
			const { remainingDays, totalPeriodDays } = computeRemainingDays(projectionPeriod, now);

			/* Also get current period spend */
			let currentPeriodDatePreset: "today" | "last_7d" | "this_month";
			switch (projectionPeriod) {
				case "end_of_day":
					currentPeriodDatePreset = "today";
					break;
				case "end_of_week":
					currentPeriodDatePreset = "last_7d";
					break;
				case "end_of_month":
					currentPeriodDatePreset = "this_month";
					break;
			}

			const currentInsights = await client.insights.query(context.adAccountId, {
				level: "account",
				date_preset: currentPeriodDatePreset,
				fields: ["spend"],
			});

			const currentPeriodSpend = currentInsights.reduce(
				(sum, row) => sum + Number.parseFloat(row.spend || "0"),
				0,
			);

			/* Project to end of period */
			const projectedAdditionalSpend = dailySpendRate * remainingDays;
			const projectedTotalSpend = currentPeriodSpend + projectedAdditionalSpend;

			/* Project ROAS and CPA */
			const projectedAdditionalRevenue = dailyRevenueRate * remainingDays;
			const projectedTotalRevenue =
				totalSpend > 0
					? (totalRevenue / totalSpend) * projectedTotalSpend
					: projectedAdditionalRevenue;

			const projectedRoas =
				projectedTotalSpend > 0 ? projectedTotalRevenue / projectedTotalSpend : 0;

			const projectedAdditionalConversions = dailyConversionRate * remainingDays;
			const projectedTotalConversions =
				totalSpend > 0
					? (totalConversions / totalSpend) * projectedTotalSpend
					: projectedAdditionalConversions;

			const projectedCpa =
				projectedTotalConversions > 0 ? projectedTotalSpend / projectedTotalConversions : 0;

			/* Determine confidence */
			const confidence = classifyConfidence(daysOfData);

			return {
				success: true,
				data: {
					adAccountId: context.adAccountId,
					projectionPeriod,
					currentPeriodSpend: Math.round(currentPeriodSpend * 100) / 100,
					projectedSpend: Math.round(projectedTotalSpend * 100) / 100,
					projectedROAS: Math.round(projectedRoas * 1000) / 1000,
					projectedCPA: Math.round(projectedCpa * 100) / 100,
					confidence,
					dailyBurnRate: Math.round(dailySpendRate * 100) / 100,
					remainingDays: Math.round(remainingDays * 100) / 100,
					totalPeriodDays,
					daysOfData,
				},
				message:
					`Spend projection for ${projectionPeriod}: ` +
					`$${(Math.round(projectedTotalSpend * 100) / 100).toFixed(2)} ` +
					`(current: $${(Math.round(currentPeriodSpend * 100) / 100).toFixed(2)}, ` +
					`burn rate: $${(Math.round(dailySpendRate * 100) / 100).toFixed(2)}/day). ` +
					`Projected ROAS: ${(Math.round(projectedRoas * 1000) / 1000).toFixed(2)}x, ` +
					`Projected CPA: $${(Math.round(projectedCpa * 100) / 100).toFixed(2)}. ` +
					`Confidence: ${confidence} (${daysOfData} day(s) of data).`,
			};
		},
	});
}
