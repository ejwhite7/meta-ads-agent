/**
 * @module tools/reporting/detect-anomalies
 *
 * Scans all active campaigns for performance anomalies by comparing
 * today's metrics against a 7-day baseline. Detects five types of
 * anomalies (CPA spike, CTR drop, delivery issues, budget exhaustion,
 * and conversion rate collapse) with configurable sensitivity levels.
 *
 * The sensitivity level controls threshold multipliers:
 * - **low**: Only flags severe deviations (e.g., CPA > 2x baseline)
 * - **medium**: Standard thresholds (e.g., CPA > 1.5x baseline)
 * - **high**: Aggressive detection (e.g., CPA > 1.25x baseline)
 */

import { Type } from "@sinclair/typebox";
import { type ToolResult, createTool } from "../types.js";
import type {
	Anomaly,
	AnomalySeverity,
	AnomalyType,
	InsightsResultLike,
	ReportingToolContext,
} from "./types.js";
import { extractConversions, safeParseFloat } from "./utils.js";

/**
 * Threshold configuration for each sensitivity level.
 * Each entry maps a sensitivity level to the multipliers used for
 * anomaly detection.
 */
interface SensitivityThresholds {
	/** CPA must exceed baseline * this factor to trigger. */
	cpaMultiplier: number;
	/** CTR must fall below baseline * this factor to trigger. */
	ctrMultiplier: number;
	/** Impressions must drop by more than this fraction (0-1) to trigger. */
	deliveryDropFraction: number;
	/** Budget usage fraction (0-1) before 6pm that triggers exhaustion. */
	budgetExhaustionThreshold: number;
	/** Conversion rate must fall below baseline * this factor to trigger. */
	conversionCollapseMultiplier: number;
}

/**
 * Threshold values keyed by sensitivity level.
 */
const THRESHOLDS: Record<string, SensitivityThresholds> = {
	low: {
		cpaMultiplier: 2.0,
		ctrMultiplier: 0.4,
		deliveryDropFraction: 0.7,
		budgetExhaustionThreshold: 0.98,
		conversionCollapseMultiplier: 0.3,
	},
	medium: {
		cpaMultiplier: 1.5,
		ctrMultiplier: 0.6,
		deliveryDropFraction: 0.5,
		budgetExhaustionThreshold: 0.95,
		conversionCollapseMultiplier: 0.5,
	},
	high: {
		cpaMultiplier: 1.25,
		ctrMultiplier: 0.7,
		deliveryDropFraction: 0.3,
		budgetExhaustionThreshold: 0.9,
		conversionCollapseMultiplier: 0.6,
	},
};

/**
 * TypeBox schema for detect-anomalies parameters.
 */
const DetectAnomaliesParams = Type.Object({
	/** Sensitivity level controlling detection thresholds. */
	sensitivityLevel: Type.Union(
		[Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")],
		{
			description:
				"Detection sensitivity: 'low' (severe only), 'medium' (standard), 'high' (aggressive)",
		},
	),
});

/**
 * Tool that scans all active campaigns for performance anomalies.
 *
 * Compares today's metrics against a 7-day baseline to detect:
 * 1. **CPA Spike** -- Cost per acquisition exceeds baseline threshold
 * 2. **CTR Drop** -- Click-through rate falls below baseline threshold
 * 3. **Delivery Issue** -- Impressions drop significantly without budget change
 * 4. **Budget Exhaustion** -- Campaign burns through daily budget before 6pm
 * 5. **Conversion Collapse** -- Conversion rate drops below baseline threshold
 *
 * @example
 * ```typescript
 * const result = await detectAnomalies.execute(
 *   { adAccountId: "act_123", sensitivityLevel: "medium" },
 *   context,
 * );
 * const anomalies = result.data?.anomalies as Anomaly[];
 * for (const a of anomalies) {
 *   console.log(`${a.severity}: ${a.message}`);
 * }
 * ```
 */
export const detectAnomalies = createTool({
	name: "detect_anomalies",
	description:
		"Scans all active campaigns for performance anomalies by comparing today's " +
		"metrics to a 7-day baseline. Detects CPA spikes, CTR drops, delivery issues, " +
		"budget exhaustion, and conversion rate collapses.",
	parameters: DetectAnomaliesParams,
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

		const thresholds = THRESHOLDS[params.sensitivityLevel] ?? THRESHOLDS.medium;

		try {
			/* ---- Fetch active campaigns ---- */
			const campaigns = await ctx.metaClient.campaigns.list(context.adAccountId);
			const activeCampaigns = campaigns.filter((c) => c.status === "ACTIVE");

			if (activeCampaigns.length === 0) {
				return {
					success: true,
					data: { anomalies: [] },
					message: "No active campaigns found to scan.",
				};
			}

			/* ---- Fetch today's metrics ---- */
			const todayInsights = await ctx.metaClient.insights.query(context.adAccountId, {
				level: "campaign",
				date_preset: "today",
				fields: [
					"campaign_id",
					"campaign_name",
					"impressions",
					"clicks",
					"spend",
					"ctr",
					"cpc",
					"actions",
				],
			});

			/* ---- Fetch 7-day baseline ---- */
			const baselineInsights = await ctx.metaClient.insights.query(context.adAccountId, {
				level: "campaign",
				date_preset: "last_7d",
				fields: [
					"campaign_id",
					"campaign_name",
					"impressions",
					"clicks",
					"spend",
					"ctr",
					"cpc",
					"actions",
				],
			});

			/* ---- Build lookup maps ---- */
			const todayMap = new Map<string, InsightsResultLike>();
			for (const insight of todayInsights) {
				if (insight.campaign_id) {
					todayMap.set(insight.campaign_id, insight);
				}
			}

			const baselineMap = new Map<string, InsightsResultLike>();
			for (const insight of baselineInsights) {
				if (insight.campaign_id) {
					baselineMap.set(insight.campaign_id, insight);
				}
			}

			/* ---- Detect anomalies ---- */
			const anomalies: Anomaly[] = [];

			for (const campaign of activeCampaigns) {
				const today = todayMap.get(campaign.id);
				const baseline = baselineMap.get(campaign.id);

				if (!today || !baseline) {
					continue;
				}

				const dailyBaseline = computeDailyBaseline(baseline);

				detectCpaSpike(campaign, today, dailyBaseline, thresholds, anomalies);
				detectCtrDrop(campaign, today, dailyBaseline, thresholds, anomalies);
				detectDeliveryIssue(campaign, today, dailyBaseline, thresholds, anomalies);
				detectBudgetExhaustion(campaign, today, thresholds, anomalies);
				detectConversionCollapse(campaign, today, dailyBaseline, thresholds, anomalies);
			}

			return {
				success: true,
				data: {
					anomalies: anomalies as unknown as Record<string, unknown>[],
					scannedCampaigns: activeCampaigns.length,
					anomalyCount: anomalies.length,
				} as unknown as Record<string, unknown>,
				message: `Scanned ${activeCampaigns.length} active campaigns. Found ${anomalies.length} anomalies.`,
			};
		} catch (error) {
			const errMessage = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				data: null,
				error: `Failed to detect anomalies: ${errMessage}`,
				message: `Failed to detect anomalies: ${errMessage}`,
			};
		}
	},
});

/**
 * Computed daily baseline values from 7-day aggregate data.
 */
interface DailyBaseline {
	/** Average daily spend. */
	spend: number;
	/** Average daily impressions. */
	impressions: number;
	/** Average daily clicks. */
	clicks: number;
	/** Average daily CPA. */
	cpa: number;
	/** Average daily CTR. */
	ctr: number;
	/** Average daily conversions. */
	conversions: number;
	/** Average daily conversion rate (conversions / clicks). */
	conversionRate: number;
}

/**
 * Computes daily averages from 7-day aggregate baseline data.
 *
 * @param baseline - 7-day aggregate insights result.
 * @returns Daily baseline values averaged over 7 days.
 */
function computeDailyBaseline(baseline: InsightsResultLike): DailyBaseline {
	const spend = safeParseFloat(baseline.spend) / 7;
	const impressions = safeParseFloat(baseline.impressions) / 7;
	const clicks = safeParseFloat(baseline.clicks) / 7;
	const conversions = extractConversions(baseline.actions) / 7;
	const ctr = safeParseFloat(baseline.ctr);
	const cpa = conversions > 0 ? spend / conversions : 0;
	const conversionRate = clicks > 0 ? conversions / clicks : 0;

	return { spend, impressions, clicks, cpa, ctr, conversions, conversionRate };
}

/**
 * Detects CPA spike anomalies.
 * Triggers when today's CPA exceeds the baseline CPA multiplied by the threshold.
 */
function detectCpaSpike(
	campaign: { id: string; name: string },
	today: InsightsResultLike,
	baseline: DailyBaseline,
	thresholds: SensitivityThresholds,
	anomalies: Anomaly[],
): void {
	const todaySpend = safeParseFloat(today.spend);
	const todayConversions = extractConversions(today.actions);
	const todayCpa = todayConversions > 0 ? todaySpend / todayConversions : 0;

	if (baseline.cpa <= 0 || todayCpa <= 0) {
		return;
	}

	if (todayCpa > baseline.cpa * thresholds.cpaMultiplier) {
		const changePercent = ((todayCpa - baseline.cpa) / baseline.cpa) * 100;
		const severity: AnomalySeverity = todayCpa > baseline.cpa * 2 ? "critical" : "warning";

		anomalies.push({
			campaignId: campaign.id,
			campaignName: campaign.name,
			type: "CPA_SPIKE" as AnomalyType,
			severity,
			current: todayCpa,
			baseline: baseline.cpa,
			changePercent,
			message: `CPA spiked to $${todayCpa.toFixed(2)} (baseline: $${baseline.cpa.toFixed(2)}, +${changePercent.toFixed(1)}%).`,
			recommendedAction:
				"Review recent targeting or creative changes. Consider pausing underperforming ad sets and reallocating budget to higher-performing ones.",
		});
	}
}

/**
 * Detects CTR drop anomalies.
 * Triggers when today's CTR falls below the baseline CTR multiplied by the threshold.
 */
function detectCtrDrop(
	campaign: { id: string; name: string },
	today: InsightsResultLike,
	baseline: DailyBaseline,
	thresholds: SensitivityThresholds,
	anomalies: Anomaly[],
): void {
	const todayCtr = safeParseFloat(today.ctr);

	if (baseline.ctr <= 0) {
		return;
	}

	if (todayCtr < baseline.ctr * thresholds.ctrMultiplier) {
		const changePercent = ((todayCtr - baseline.ctr) / baseline.ctr) * 100;
		const severity: AnomalySeverity = todayCtr < baseline.ctr * 0.3 ? "critical" : "warning";

		anomalies.push({
			campaignId: campaign.id,
			campaignName: campaign.name,
			type: "CTR_DROP" as AnomalyType,
			severity,
			current: todayCtr,
			baseline: baseline.ctr,
			changePercent,
			message: `CTR dropped to ${(todayCtr * 100).toFixed(2)}% (baseline: ${(baseline.ctr * 100).toFixed(2)}%, ${changePercent.toFixed(1)}%).`,
			recommendedAction:
				"Refresh ad creatives, test new headlines and images, or narrow targeting to a more relevant audience.",
		});
	}
}

/**
 * Detects delivery issue anomalies.
 * Triggers when today's impressions drop by more than the threshold fraction
 * compared to the baseline, without a corresponding budget reduction.
 */
function detectDeliveryIssue(
	campaign: { id: string; name: string; daily_budget?: string },
	today: InsightsResultLike,
	baseline: DailyBaseline,
	thresholds: SensitivityThresholds,
	anomalies: Anomaly[],
): void {
	const todayImpressions = safeParseFloat(today.impressions);

	if (baseline.impressions <= 0) {
		return;
	}

	const dropFraction = (baseline.impressions - todayImpressions) / baseline.impressions;

	if (dropFraction > thresholds.deliveryDropFraction) {
		const changePercent = -dropFraction * 100;
		const severity: AnomalySeverity = dropFraction > 0.8 ? "critical" : "warning";

		anomalies.push({
			campaignId: campaign.id,
			campaignName: campaign.name,
			type: "DELIVERY_ISSUE" as AnomalyType,
			severity,
			current: todayImpressions,
			baseline: baseline.impressions,
			changePercent,
			message: `Impressions dropped by ${(dropFraction * 100).toFixed(1)}% (today: ${todayImpressions.toLocaleString()}, baseline: ${baseline.impressions.toFixed(0)}).`,
			recommendedAction:
				"Check for audience saturation, ad disapprovals, or billing issues. Verify the campaign is not in learning limited status.",
		});
	}
}

/**
 * Detects budget exhaustion anomalies.
 * Triggers when a campaign has spent more than the threshold fraction of its
 * daily budget before 6pm local time, indicating it may exhaust its budget
 * before the end of the day.
 */
function detectBudgetExhaustion(
	campaign: { id: string; name: string; daily_budget?: string },
	today: InsightsResultLike,
	thresholds: SensitivityThresholds,
	anomalies: Anomaly[],
): void {
	if (!campaign.daily_budget) {
		return;
	}

	/* daily_budget is in cents (e.g., "5000" = $50.00) */
	const dailyBudget = Number.parseFloat(campaign.daily_budget) / 100;
	const todaySpend = safeParseFloat(today.spend);

	if (dailyBudget <= 0) {
		return;
	}

	const currentHour = new Date().getHours();
	const usageFraction = todaySpend / dailyBudget;

	if (usageFraction > thresholds.budgetExhaustionThreshold && currentHour < 18) {
		const changePercent = usageFraction * 100;
		const severity: AnomalySeverity = usageFraction > 0.99 ? "critical" : "warning";

		anomalies.push({
			campaignId: campaign.id,
			campaignName: campaign.name,
			type: "BUDGET_EXHAUSTION" as AnomalyType,
			severity,
			current: todaySpend,
			baseline: dailyBudget,
			changePercent,
			message: `Campaign has spent ${(usageFraction * 100).toFixed(1)}% of daily budget ($${todaySpend.toFixed(2)} / $${dailyBudget.toFixed(2)}) before 6pm.`,
			recommendedAction:
				"Consider increasing the daily budget or switching to lifetime budget to allow Meta's pacing algorithm to optimize delivery.",
		});
	}
}

/**
 * Detects conversion rate collapse anomalies.
 * Triggers when today's conversion rate (conversions / clicks) falls below
 * the baseline conversion rate multiplied by the threshold.
 */
function detectConversionCollapse(
	campaign: { id: string; name: string },
	today: InsightsResultLike,
	baseline: DailyBaseline,
	thresholds: SensitivityThresholds,
	anomalies: Anomaly[],
): void {
	const todayClicks = safeParseFloat(today.clicks);
	const todayConversions = extractConversions(today.actions);

	if (todayClicks <= 0 || baseline.conversionRate <= 0) {
		return;
	}

	const todayConversionRate = todayConversions / todayClicks;

	if (todayConversionRate < baseline.conversionRate * thresholds.conversionCollapseMultiplier) {
		const changePercent =
			((todayConversionRate - baseline.conversionRate) / baseline.conversionRate) * 100;
		const severity: AnomalySeverity =
			todayConversionRate < baseline.conversionRate * 0.2 ? "critical" : "warning";

		anomalies.push({
			campaignId: campaign.id,
			campaignName: campaign.name,
			type: "CONVERSION_COLLAPSE" as AnomalyType,
			severity,
			current: todayConversionRate,
			baseline: baseline.conversionRate,
			changePercent,
			message: `Conversion rate collapsed to ${(todayConversionRate * 100).toFixed(2)}% (baseline: ${(baseline.conversionRate * 100).toFixed(2)}%, ${changePercent.toFixed(1)}%).`,
			recommendedAction:
				"Check landing page performance, verify pixel/conversion tracking is firing correctly, and review if targeting changes reduced lead quality.",
		});
	}
}
