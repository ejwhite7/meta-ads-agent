/**
 * @module tools/budget/set-budget
 *
 * Sets the daily budget for a campaign or ad set to an absolute value.
 * Enforces guardrail constraints: minimum budget floor, maximum scale
 * factor ceiling, and human approval thresholds for high-value changes.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { MetaClient } from "@meta-ads-agent/meta-client";
import { createTool } from "../types.js";
import type { ToolContext, ToolResult } from "../types.js";
import type { GuardrailConfig } from "../../decisions/types.js";
import { DEFAULT_GUARDRAILS } from "../../decisions/types.js";

/**
 * TypeBox schema for set_budget tool parameters.
 */
const SetBudgetParams = Type.Object({
	/** Campaign ID to set the budget for. */
	campaignId: Type.String({ description: "Meta campaign ID" }),
	/** New daily budget in account currency (e.g., 50.00 for $50). */
	dailyBudget: Type.Number({
		minimum: 0,
		description: "New daily budget in account currency (USD)",
	}),
	/** Reason for the budget change (for audit trail). */
	reason: Type.String({ description: "Explanation for the budget change" }),
	/** Optional ad set ID to set budget at the ad set level instead. */
	adSetId: Type.Optional(
		Type.String({ description: "Ad set ID (if setting budget at ad set level)" }),
	),
});

/** Inferred TypeScript type from the parameter schema. */
type SetBudgetInput = Static<typeof SetBudgetParams>;

/**
 * Creates the set_budget tool.
 *
 * Sets a campaign or ad set daily budget to an absolute value while
 * enforcing safety guardrails:
 * - Budget cannot go below guardrailConfig.minDailyBudget
 * - Budget cannot exceed guardrailConfig.maxBudgetScaleFactor x current budget
 * - Changes above guardrailConfig.requireApprovalAbove return a pending status
 *   requiring human approval
 *
 * @param client - Initialized MetaClient instance for API access.
 * @param guardrails - Optional guardrail configuration (uses defaults if not provided).
 * @returns Frozen tool definition ready for registry.
 */
export function createSetBudgetTool(
	client: MetaClient,
	guardrails: GuardrailConfig = DEFAULT_GUARDRAILS,
) {
	return createTool({
		name: "set_budget",
		description:
			"Sets a campaign or ad set daily budget to an absolute value. " +
			"Enforces minimum floor, maximum ceiling, and approval thresholds.",
		parameters: SetBudgetParams,

		async execute(
			params: SetBudgetInput,
			context: ToolContext,
		): Promise<ToolResult> {
			const { campaignId, dailyBudget, reason, adSetId } = params;
			const targetLevel = adSetId ? "ad set" : "campaign";
			const targetId = adSetId ?? campaignId;

			/* Fetch current budget */
			let currentBudgetCents: number;
			if (adSetId) {
				const adSet = await client.adSets.get(adSetId);
				currentBudgetCents = Number.parseInt(adSet.daily_budget ?? "0", 10);
			} else {
				const campaign = await client.campaigns.get(campaignId);
				currentBudgetCents = Number.parseInt(campaign.daily_budget ?? "0", 10);
			}
			const currentBudget = currentBudgetCents / 100;

			/* GUARDRAIL: Enforce minimum daily budget floor */
			if (dailyBudget < guardrails.minDailyBudget) {
				return {
					success: false,
					data: {
						targetId,
						targetLevel,
						requestedBudget: dailyBudget,
						minDailyBudget: guardrails.minDailyBudget,
						reason,
					},
					message:
						`Budget change rejected: requested $${dailyBudget.toFixed(2)} ` +
						`is below the minimum daily budget of $${guardrails.minDailyBudget.toFixed(2)}.`,
				};
			}

			/* GUARDRAIL: Enforce maximum budget scale factor ceiling */
			const maxAllowedBudget = currentBudget * guardrails.maxBudgetScaleFactor;
			if (currentBudget > 0 && dailyBudget > maxAllowedBudget) {
				return {
					success: false,
					data: {
						targetId,
						targetLevel,
						requestedBudget: dailyBudget,
						currentBudget,
						maxBudgetScaleFactor: guardrails.maxBudgetScaleFactor,
						maxAllowedBudget: Math.round(maxAllowedBudget * 100) / 100,
						reason,
					},
					message:
						`Budget change rejected: requested $${dailyBudget.toFixed(2)} ` +
						`exceeds the maximum ${guardrails.maxBudgetScaleFactor}x scale factor. ` +
						`Current budget: $${currentBudget.toFixed(2)}, ` +
						`max allowed: $${maxAllowedBudget.toFixed(2)}.`,
				};
			}

			/* GUARDRAIL: Require human approval for large changes */
			if (dailyBudget > guardrails.requireApprovalAbove) {
				return {
					success: true,
					data: {
						status: "pending_approval",
						targetId,
						targetLevel,
						currentBudget,
						requestedBudget: dailyBudget,
						requireApprovalAbove: guardrails.requireApprovalAbove,
						reason,
					},
					message:
						`Budget change of $${dailyBudget.toFixed(2)} requires human approval ` +
						`(threshold: $${guardrails.requireApprovalAbove.toFixed(2)}). ` +
						`Change is pending.`,
				};
			}

			/* Skip actual API call in dry-run mode */
			if (context.dryRun) {
				return {
					success: true,
					data: {
						dryRun: true,
						targetId,
						targetLevel,
						currentBudget,
						newBudget: dailyBudget,
						reason,
					},
					message:
						`[DRY RUN] Would set ${targetLevel} ${targetId} ` +
						`budget from $${currentBudget.toFixed(2)} to $${dailyBudget.toFixed(2)}.`,
				};
			}

			/* Execute the budget update (convert to cents string for Meta API) */
			const newBudgetCents = Math.round(dailyBudget * 100).toString();

			if (adSetId) {
				await client.adSets.update(adSetId, {
					daily_budget: newBudgetCents,
				});
			} else {
				await client.campaigns.update(campaignId, {
					daily_budget: newBudgetCents,
				});
			}

			return {
				success: true,
				data: {
					targetId,
					targetLevel,
					previousBudget: currentBudget,
					newBudget: dailyBudget,
					changeDelta: Math.round((dailyBudget - currentBudget) * 100) / 100,
					changePercent:
						currentBudget > 0
							? Math.round(((dailyBudget - currentBudget) / currentBudget) * 10000) / 100
							: null,
					reason,
				},
				message:
					`Successfully set ${targetLevel} ${targetId} daily budget ` +
					`from $${currentBudget.toFixed(2)} to $${dailyBudget.toFixed(2)} ` +
					`(${currentBudget > 0 ? ((dailyBudget - currentBudget) / currentBudget * 100).toFixed(1) : "N/A"}% change). ` +
					`Reason: ${reason}`,
			};
		},
	});
}
