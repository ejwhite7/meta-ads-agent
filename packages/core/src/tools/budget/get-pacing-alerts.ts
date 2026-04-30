/**
 * @module tools/budget/get-pacing-alerts
 *
 * Scans all active campaigns in an ad account and flags those that are
 * significantly overpacing (risk of premature budget exhaustion) or
 * underpacing (wasting potential impressions). Campaigns are flagged
 * when their pacing deviates more than 20% from the expected pace.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { MetaClient } from "@meta-ads-agent/meta-client";
import { createTool } from "../types.js";
import type { ToolContext, ToolResult } from "../types.js";

/**
 * Severity level for a pacing alert.
 * - warning: 20-50% deviation from expected pace
 * - critical: more than 50% deviation from expected pace
 */
export type AlertSeverity = "warning" | "critical";

/**
 * Structured pacing alert for a single campaign.
 */
export interface PacingAlert {
	/** Meta campaign ID. */
	campaignId: string;
	/** Human-readable campaign name. */
	campaignName: string;
	/** Alert severity based on deviation magnitude. */
	severity: AlertSeverity;
	/** Descriptive message explaining the alert. */
	message: string;
	/** Suggested corrective action. */
	recommendedAction: string;
}

/**
 * TypeBox schema for get_pacing_alerts tool parameters.
 */
const GetPacingAlertsParams = Type.Object({
	/** Meta ad account ID (format: "act_XXXXXXXXX"). */
	adAccountId: Type.String({ description: "Meta ad account ID (format: act_XXXXXXXXX)" }),
});

/** Inferred TypeScript type from the parameter schema. */
type GetPacingAlertsInput = Static<typeof GetPacingAlertsParams>;

/**
 * Creates the get_pacing_alerts tool.
 *
 * Evaluates spend pacing for every active campaign in the account.
 * A campaign is flagged when its actual spend deviates more than 20%
 * from its expected spend for the current month. Alerts include
 * severity, a description, and a recommended corrective action.
 *
 * @param client - Initialized MetaClient instance for API access.
 * @returns Frozen tool definition ready for registry.
 */
export function createGetPacingAlertsTool(client: MetaClient) {
	return createTool({
		name: "get_pacing_alerts",
		description:
			"Returns campaigns that are overpacing (at risk of budget exhaustion) " +
			"or underpacing (wasting potential impressions). Flags outliers with " +
			">20% deviation from expected pace.",
		parameters: GetPacingAlertsParams,

		async execute(
			params: GetPacingAlertsInput,
			context: ToolContext,
		): Promise<ToolResult> {
			const now = new Date(context.timestamp);
			const dayOfMonth = now.getDate();
			const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
			const fractionElapsed = dayOfMonth / daysInMonth;

			/* Fetch active campaigns */
			const campaigns = await client.campaigns.list(params.adAccountId);
			const activeCampaigns = campaigns.filter(
				(c) => c.status === "ACTIVE" && c.daily_budget,
			);

			/* Fetch campaign-level insights for this month */
			const insights = await client.insights.query(params.adAccountId, {
				level: "campaign",
				date_preset: "this_month",
				fields: ["campaign_id", "campaign_name", "spend"],
			});

			/* Build a spend lookup by campaign ID */
			const spendByCampaign = new Map<string, number>();
			for (const row of insights) {
				if (row.campaign_id) {
					const existing = spendByCampaign.get(row.campaign_id) ?? 0;
					spendByCampaign.set(
						row.campaign_id,
						existing + Number.parseFloat(row.spend || "0"),
					);
				}
			}

			/* Evaluate pacing for each active campaign */
			const alerts: PacingAlert[] = [];

			for (const campaign of activeCampaigns) {
				const dailyBudget =
					Number.parseInt(campaign.daily_budget!, 10) / 100;
				const monthlyBudget = dailyBudget * daysInMonth;
				const expectedSpend = monthlyBudget * fractionElapsed;
				const actualSpend = spendByCampaign.get(campaign.id) ?? 0;

				if (expectedSpend === 0) {
					continue;
				}

				const pacingRatio = actualSpend / expectedSpend;
				const deviation = Math.abs(pacingRatio - 1.0);

				/* Only flag campaigns with >20% deviation */
				if (deviation <= 0.2) {
					continue;
				}

				const severity: AlertSeverity = deviation > 0.5 ? "critical" : "warning";
				const isOverpacing = pacingRatio > 1.0;

				const alert: PacingAlert = {
					campaignId: campaign.id,
					campaignName: campaign.name,
					severity,
					message: isOverpacing
						? `Campaign is overpacing at ${(pacingRatio * 100).toFixed(1)}% of expected pace. ` +
							`Spent $${actualSpend.toFixed(2)} vs expected $${expectedSpend.toFixed(2)}. ` +
							`Budget may be exhausted before month end.`
						: `Campaign is underpacing at ${(pacingRatio * 100).toFixed(1)}% of expected pace. ` +
							`Spent $${actualSpend.toFixed(2)} vs expected $${expectedSpend.toFixed(2)}. ` +
							`Potential impressions are being missed.`,
					recommendedAction: isOverpacing
						? severity === "critical"
							? "Consider reducing daily budget or pausing low-performing ad sets immediately."
							: "Monitor closely and consider reducing daily budget if trend continues."
						: severity === "critical"
							? "Check for delivery issues, expand targeting, or increase bids to improve delivery."
							: "Review ad creative quality and targeting settings to improve delivery.",
				};

				alerts.push(alert);
			}

			/* Sort by severity (critical first), then by pacing deviation */
			alerts.sort((a, b) => {
				if (a.severity !== b.severity) {
					return a.severity === "critical" ? -1 : 1;
				}
				return 0;
			});

			return {
				success: true,
				data: {
					adAccountId: params.adAccountId,
					alertCount: alerts.length,
					alerts,
					evaluatedCampaigns: activeCampaigns.length,
					periodDaysElapsed: dayOfMonth,
					periodTotalDays: daysInMonth,
				},
				message:
					alerts.length > 0
						? `Found ${alerts.length} pacing alert(s) across ${activeCampaigns.length} active campaigns: ` +
							`${alerts.filter((a) => a.severity === "critical").length} critical, ` +
							`${alerts.filter((a) => a.severity === "warning").length} warning.`
						: `All ${activeCampaigns.length} active campaigns are pacing within normal range.`,
			};
		},
	});
}
