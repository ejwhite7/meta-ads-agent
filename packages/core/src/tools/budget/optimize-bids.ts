/**
 * @module tools/budget/optimize-bids
 *
 * Adjusts the bid strategy for a campaign or ad set based on current
 * performance relative to CPA goals. Supports switching between
 * LOWEST_COST, COST_CAP, and BID_CAP strategies with intelligent
 * recommendations based on performance data.
 */

import type { MetaClient } from "@meta-ads-agent/meta-client";
import { type Static, Type } from "@sinclair/typebox";
import type { AgentGoal } from "../../types.js";
import { createTool } from "../types.js";
import type { ToolContext, ToolResult } from "../types.js";
import { resolveMetaClient } from "./_client.js";

/**
 * TypeBox schema for optimize_bids tool parameters.
 */
const OptimizeBidsParams = Type.Object({
	/** Campaign ID to adjust bids for. */
	campaignId: Type.String({ description: "Meta campaign ID" }),
	/** Target bid strategy to switch to. */
	bidStrategy: Type.Union(
		[Type.Literal("LOWEST_COST"), Type.Literal("COST_CAP"), Type.Literal("BID_CAP")],
		{ description: "Target bid strategy" },
	),
	/** Optional bid amount for COST_CAP or BID_CAP strategies (in account currency). */
	bidAmount: Type.Optional(
		Type.Number({
			minimum: 0.01,
			description: "Bid amount in account currency (required for COST_CAP/BID_CAP)",
		}),
	),
});

/** Inferred TypeScript type from the parameter schema. */
type OptimizeBidsInput = Static<typeof OptimizeBidsParams>;

/**
 * Maps simplified bid strategy names to Meta API bid strategy values.
 */
const BID_STRATEGY_MAP: Record<string, string> = {
	LOWEST_COST: "LOWEST_COST_WITHOUT_CAP",
	COST_CAP: "COST_CAP",
	BID_CAP: "LOWEST_COST_WITH_BID_CAP",
};

/**
 * Creates the optimize_bids tool.
 *
 * Adjusts bid strategy for a campaign based on the requested strategy
 * and current performance metrics. Provides intelligent reasoning:
 * - If CPA is above the goal cap, recommends COST_CAP to control costs
 * - If CPA is well below cap, considers LOWEST_COST to maximize volume
 * - BID_CAP provides maximum cost control at the expense of delivery
 *
 * @param client - Initialized MetaClient instance for API access.
 * @param goals - Agent goals containing the CPA cap for bid recommendations.
 * @returns Frozen tool definition ready for registry.
 */
export function createOptimizeBidsTool(client: MetaClient | null = null, goals?: AgentGoal) {
	const effectiveGoals: AgentGoal = goals ?? {
		roasTarget: 3.0,
		cpaCap: 50,
		dailyBudgetLimit: 10_000,
		riskLevel: "moderate",
	};
	return createTool({
		name: "optimize_bids",
		description:
			"Adjusts bid strategy for a campaign or ad set. Supports LOWEST_COST, " +
			"COST_CAP, and BID_CAP strategies. Logs strategy changes with reasoning.",
		parameters: OptimizeBidsParams,

		async execute(params: OptimizeBidsInput, context: ToolContext): Promise<ToolResult> {
			const resolved = resolveMetaClient(client, context);
			if (resolved.error) return resolved.error;
			const c = resolved.client;
			const { campaignId, bidStrategy, bidAmount } = params;

			/* Validate: COST_CAP and BID_CAP require a bid amount */
			if (
				(bidStrategy === "COST_CAP" || bidStrategy === "BID_CAP") &&
				(bidAmount === undefined || bidAmount === null)
			) {
				return {
					success: false,
					data: { campaignId, bidStrategy },
					error: `Bid amount is required for ${bidStrategy} strategy. Provide a bidAmount in account currency.`,
					message: `Bid amount is required for ${bidStrategy} strategy. Provide a bidAmount in account currency.`,
				};
			}

			/* Fetch current campaign state */
			const campaign = await c.campaigns.get(campaignId);
			const previousStrategy = campaign.bid_strategy ?? "LOWEST_COST_WITHOUT_CAP";

			/* Fetch recent performance to generate reasoning */
			const insights = await c.insights.query(context.adAccountId, {
				level: "campaign",
				date_preset: "last_7d",
				fields: ["campaign_id", "spend", "actions", "impressions", "clicks"],
				filtering: [{ field: "campaign.id", operator: "EQUAL", value: campaignId }],
			});

			/* Compute current CPA from insights */
			let currentCpa = 0;
			let totalSpend = 0;
			let totalConversions = 0;
			for (const row of insights) {
				totalSpend += Number.parseFloat(row.spend || "0");
				if (row.actions) {
					for (const action of row.actions) {
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
			if (totalConversions > 0) {
				currentCpa = totalSpend / totalConversions;
			}

			/* Build reasoning for the strategy change */
			let reasoning: string;
			const metaStrategy = BID_STRATEGY_MAP[bidStrategy] ?? bidStrategy;

			if (bidStrategy === "COST_CAP") {
				const effectiveBidAmount = bidAmount ?? effectiveGoals.cpaCap;
				if (currentCpa > effectiveGoals.cpaCap) {
					reasoning = `Current CPA ($${currentCpa.toFixed(2)}) exceeds target cap ($${effectiveGoals.cpaCap.toFixed(2)}). Switching to COST_CAP with bid amount $${effectiveBidAmount.toFixed(2)} to constrain costs while maintaining delivery volume.`;
				} else {
					reasoning =
						`Proactively setting COST_CAP at $${effectiveBidAmount.toFixed(2)} ` +
						`to prevent CPA from exceeding the $${effectiveGoals.cpaCap.toFixed(2)} cap. ` +
						`Current CPA: $${currentCpa.toFixed(2)}.`;
				}
			} else if (bidStrategy === "LOWEST_COST") {
				if (currentCpa > 0 && currentCpa < effectiveGoals.cpaCap * 0.7) {
					reasoning = `Current CPA ($${currentCpa.toFixed(2)}) is well below the cap ($${effectiveGoals.cpaCap.toFixed(2)} at 70% threshold = $${(effectiveGoals.cpaCap * 0.7).toFixed(2)}). Switching to LOWEST_COST to maximize delivery volume while CPA headroom exists.`;
				} else {
					reasoning = `Switching to LOWEST_COST to let Meta's algorithm optimize for maximum conversions without a bid cap. Current CPA: $${currentCpa > 0 ? currentCpa.toFixed(2) : "N/A"}.`;
				}
			} else {
				reasoning = `Switching to BID_CAP at $${(bidAmount ?? 0).toFixed(2)} for maximum cost control. This may reduce delivery volume but ensures no individual conversion costs more than the cap. Current CPA: $${currentCpa > 0 ? currentCpa.toFixed(2) : "N/A"}.`;
			}

			/* Skip actual API call in dry-run mode */
			if (context.dryRun) {
				return {
					success: true,
					data: {
						dryRun: true,
						campaignId,
						previousStrategy,
						newStrategy: metaStrategy,
						bidAmount: bidAmount ?? null,
						currentCpa: Math.round(currentCpa * 100) / 100,
						cpaCap: effectiveGoals.cpaCap,
						reasoning,
					},
					message:
						`[DRY RUN] Would change campaign ${campaignId} bid strategy ` +
						`from ${previousStrategy} to ${metaStrategy}` +
						`${bidAmount ? ` with bid amount $${bidAmount.toFixed(2)}` : ""}. ` +
						`Reasoning: ${reasoning}`,
				};
			}

			/* Execute the bid strategy update */
			const updateParams: Record<string, string> = {
				bid_strategy: metaStrategy,
			};
			await c.campaigns.update(campaignId, updateParams);

			/* If bid amount specified and strategy supports it, update ad sets */
			if (bidAmount && (bidStrategy === "COST_CAP" || bidStrategy === "BID_CAP")) {
				const adSets = await c.adSets.list(context.adAccountId);
				const campaignAdSets = adSets.filter(
					(as) => as.campaign_id === campaignId && as.status === "ACTIVE",
				);
				const bidAmountCents = Math.round(bidAmount * 100).toString();
				for (const adSet of campaignAdSets) {
					await c.adSets.update(adSet.id, {
						bid_amount: bidAmountCents,
					});
				}
			}

			return {
				success: true,
				data: {
					campaignId,
					campaignName: campaign.name,
					previousStrategy,
					newStrategy: metaStrategy,
					bidAmount: bidAmount ?? null,
					currentCpa: Math.round(currentCpa * 100) / 100,
					cpaCap: effectiveGoals.cpaCap,
					totalSpend: Math.round(totalSpend * 100) / 100,
					totalConversions,
					reasoning,
				},
				message:
					`Successfully changed campaign "${campaign.name}" bid strategy ` +
					`from ${previousStrategy} to ${metaStrategy}` +
					`${bidAmount ? ` (bid: $${bidAmount.toFixed(2)})` : ""}. ` +
					`${reasoning}`,
			};
		},
	});
}
