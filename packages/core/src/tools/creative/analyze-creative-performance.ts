/**
 * @module tools/creative/analyze-creative-performance
 *
 * Tool for analyzing creative performance across an ad account.
 * Fetches per-ad insights, computes a composite score for each creative,
 * and classifies them into winners, losers, fatigued, and retirement
 * candidates. Uses median CTR as the threshold and frequency-based
 * fatigue detection.
 *
 * Classification logic:
 * - Winners: CTR above median
 * - Losers: CTR below 50th percentile AND frequency > 3 (ad fatigue signal)
 * - Fatigued: Frequency > 5 regardless of CTR
 * - Recommended retirements: Bottom 20% by composite score (CTR * conversions / frequency)
 */

import { type Static, Type } from "@sinclair/typebox";
import { createTool } from "../types.js";
import type { ToolResult } from "../types.js";
import type {
	CreativePerformanceAnalysis,
	CreativeToolContext,
	InsightsResultLike,
} from "./types.js";

/**
 * TypeBox schema for analyze-creative-performance parameters.
 */
const AnalyzePerformanceParams = Type.Object({
	/** Date range for performance data. */
	dateRange: Type.Union(
		[Type.Literal("last_7d"), Type.Literal("last_14d"), Type.Literal("last_30d")],
		{ description: "Date range for performance analysis" },
	),
});

/** Inferred TypeScript type for analyze-creative-performance parameters. */
type AnalyzePerformanceInput = Static<typeof AnalyzePerformanceParams>;

/**
 * Frequency threshold for ad fatigue detection.
 * Creatives shown more than this many times per user are considered fatigued.
 */
const FATIGUE_FREQUENCY_THRESHOLD = 5;

/**
 * Frequency threshold for the loser classification.
 * Creatives below median CTR with frequency above this are considered losers.
 */
const LOSER_FREQUENCY_THRESHOLD = 3;

/**
 * Percentile cutoff for retirement recommendations.
 * The bottom 20% by composite score are recommended for retirement.
 */
const RETIREMENT_PERCENTILE = 0.2;

/**
 * Extracts the total conversion count from an insights action array.
 *
 * @param actions - Array of action objects from the Meta Insights API.
 * @returns Total conversion count from purchase, lead, and complete_registration actions.
 */
function extractConversions(actions?: Array<{ action_type: string; value: string }>): number {
	if (!actions || actions.length === 0) {
		return 0;
	}

	const conversionTypes = new Set(["purchase", "omni_purchase", "lead", "complete_registration"]);
	let total = 0;

	for (const action of actions) {
		if (conversionTypes.has(action.action_type)) {
			const value = Number.parseFloat(action.value);
			if (!Number.isNaN(value)) {
				total += value;
			}
		}
	}

	return total;
}

/**
 * Computes approximate ad frequency from impressions, reach, and clicks.
 * When reach is not available, estimates from impressions and clicks.
 *
 * @param impressions - Total impression count.
 * @param clicks - Total click count.
 * @returns Estimated frequency value.
 */
function estimateFrequency(impressions: number, clicks: number): number {
	if (impressions === 0) return 0;
	/* Rough estimate: assume unique users ~ impressions / (1 + CTR * 10) */
	const ctr = clicks / impressions;
	const estimatedReach = impressions / (1 + ctr * 10);
	return estimatedReach > 0 ? impressions / estimatedReach : 1;
}

/**
 * Computes the median of a numeric array.
 *
 * @param values - Array of numbers (must not be empty).
 * @returns The median value.
 */
function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Transforms raw insights data into performance analysis objects.
 *
 * @param insights - Raw insights results from the Meta API.
 * @returns Array of creative performance analysis objects with computed scores.
 */
export function buildAnalysis(insights: InsightsResultLike[]): CreativePerformanceAnalysis[] {
	return insights
		.filter((row) => row.ad_id)
		.map((row) => {
			const impressions = Number.parseFloat(row.impressions) || 0;
			const clicks = Number.parseFloat(row.clicks) || 0;
			const ctr = Number.parseFloat(row.ctr) || 0;
			const cpm = Number.parseFloat(row.cpm) || 0;
			const conversions = extractConversions(row.actions);
			const frequency = estimateFrequency(impressions, clicks);
			const score = frequency > 0 ? (ctr * conversions) / frequency : 0;

			return {
				creativeId: row.ad_id as string,
				ctr,
				cpm,
				frequency,
				conversions,
				score,
				recommendation: "keep" as const,
			};
		});
}

/**
 * Classifies creatives into winners, losers, fatigued, and retirement candidates.
 *
 * @param analyses - Array of performance analysis objects.
 * @returns Object with classified creative arrays.
 */
export function classifyCreatives(analyses: CreativePerformanceAnalysis[]): {
	winners: CreativePerformanceAnalysis[];
	losers: CreativePerformanceAnalysis[];
	fatigued: CreativePerformanceAnalysis[];
	recommended: CreativePerformanceAnalysis[];
} {
	if (analyses.length === 0) {
		return { winners: [], losers: [], fatigued: [], recommended: [] };
	}

	const ctrValues = analyses.map((a) => a.ctr);
	const medianCtr = median(ctrValues);

	/* Sort by score ascending for retirement calculation */
	const sortedByScore = [...analyses].sort((a, b) => a.score - b.score);
	const retirementCount = Math.max(1, Math.ceil(analyses.length * RETIREMENT_PERCENTILE));
	const retirementIds = new Set(sortedByScore.slice(0, retirementCount).map((a) => a.creativeId));

	const winners: CreativePerformanceAnalysis[] = [];
	const losers: CreativePerformanceAnalysis[] = [];
	const fatigued: CreativePerformanceAnalysis[] = [];
	const recommended: CreativePerformanceAnalysis[] = [];

	for (const analysis of analyses) {
		let recommendation: "keep" | "rotate" | "retire" = "keep";

		const isWinner = analysis.ctr >= medianCtr;
		const isLoser = analysis.ctr < medianCtr && analysis.frequency > LOSER_FREQUENCY_THRESHOLD;
		const isFatigued = analysis.frequency > FATIGUE_FREQUENCY_THRESHOLD;
		const shouldRetire = retirementIds.has(analysis.creativeId);

		if (isFatigued) {
			recommendation = "rotate";
		} else if (shouldRetire) {
			recommendation = "retire";
		} else if (isLoser) {
			recommendation = "rotate";
		}

		const classified = { ...analysis, recommendation };

		if (isWinner) winners.push(classified);
		if (isLoser) losers.push(classified);
		if (isFatigued) fatigued.push(classified);
		if (shouldRetire) recommended.push(classified);
	}

	return { winners, losers, fatigued, recommended };
}

/**
 * Analyze creative performance across an ad account.
 *
 * Fetches per-ad insights data, computes composite scores, and classifies
 * creatives into actionable categories: winners (keep running), losers
 * (low CTR + high frequency), fatigued (high frequency), and retirement
 * candidates (bottom 20% by composite score).
 *
 * @example
 * ```typescript
 * const result = await analyzeCreativePerformanceTool.execute(
 *   { adAccountId: "act_123456", dateRange: "last_7d" },
 *   creativeToolContext,
 * );
 * const { winners, losers, fatigued, recommended } = result.data;
 * ```
 */
export const analyzeCreativePerformanceTool = createTool({
	name: "analyze_creative_performance",
	description:
		"Analyze creative performance across an ad account. Classifies creatives as winners, losers, fatigued, or retirement candidates based on CTR, frequency, and conversions.",
	parameters: AnalyzePerformanceParams,
	async execute(params, context): Promise<ToolResult> {
		const ctx = context as unknown as CreativeToolContext;

		if (ctx.dryRun) {
			return {
				success: true,
				data: { dryRun: true, dateRange: params.dateRange },
				message: `Dry run: would analyze creative performance for ${context.adAccountId} over ${params.dateRange}.`,
			};
		}

		try {
			const insights = await ctx.metaClient.insights.query(context.adAccountId, {
				level: "ad",
				date_preset: params.dateRange,
				fields: ["ad_id", "ad_name", "impressions", "clicks", "spend", "ctr", "cpm", "actions"],
			});

			const analyses = buildAnalysis(insights);
			const { winners, losers, fatigued, recommended } = classifyCreatives(analyses);

			return {
				success: true,
				data: {
					totalCreatives: analyses.length,
					winners: winners as unknown as Record<string, unknown>[],
					losers: losers as unknown as Record<string, unknown>[],
					fatigued: fatigued as unknown as Record<string, unknown>[],
					recommended: recommended as unknown as Record<string, unknown>[],
					summary: {
						winnerCount: winners.length,
						loserCount: losers.length,
						fatiguedCount: fatigued.length,
						retirementCount: recommended.length,
					},
				},
				message: `Analyzed ${analyses.length} creatives: ${winners.length} winners, ${losers.length} losers, ${fatigued.length} fatigued, ${recommended.length} recommended for retirement.`,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				success: false,
				data: null,
				error: `Failed to analyze creative performance: ${message}`,
				message: `Failed to analyze creative performance: ${message}`,
			};
		}
	},
});
