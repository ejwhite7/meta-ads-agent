/**
 * @module tools/budget/reallocate-budget
 *
 * Moves budget from an underperforming campaign to an overperforming one.
 * Executes both updates atomically — if the second update fails, the first
 * is rolled back to maintain budget consistency. Enforces guardrail
 * constraints on both source and destination campaigns.
 */

import { Type, type Static } from "@sinclair/typebox";
import type { MetaClient } from "@meta-ads-agent/meta-client";
import { createTool } from "../types.js";
import type { ToolContext, ToolResult } from "../types.js";
import type { GuardrailConfig } from "../../decisions/types.js";
import { DEFAULT_GUARDRAILS } from "../../decisions/types.js";

/**
 * TypeBox schema for reallocate_budget tool parameters.
 */
const ReallocateBudgetParams = Type.Object({
	/** Campaign ID to move budget from (underperforming). */
	fromCampaignId: Type.String({
		description: "Source campaign ID to reduce budget from",
	}),
	/** Campaign ID to move budget to (overperforming). */
	toCampaignId: Type.String({
		description: "Destination campaign ID to increase budget for",
	}),
	/** Amount in account currency to reallocate (e.g., 25.00 for $25). */
	amount: Type.Number({
		minimum: 0.01,
		description: "Amount in account currency (USD) to move between campaigns",
	}),
	/** Reason for the reallocation (for audit trail). */
	reason: Type.String({
		description: "Explanation for the budget reallocation",
	}),
});

/** Inferred TypeScript type from the parameter schema. */
type ReallocateBudgetInput = Static<typeof ReallocateBudgetParams>;

/**
 * Creates the reallocate_budget tool.
 *
 * Moves a specified dollar amount from one campaign's daily budget to
 * another. Enforces guardrails on both sides:
 * - Source campaign cannot drop below guardrailConfig.minDailyBudget
 * - Destination cannot exceed guardrailConfig.maxBudgetScaleFactor x current budget
 *
 * The two updates are executed atomically: if the destination update fails,
 * the source campaign's budget is rolled back to its original value.
 *
 * @param client - Initialized MetaClient instance for API access.
 * @param guardrails - Optional guardrail configuration (uses defaults if not provided).
 * @returns Frozen tool definition ready for registry.
 */
export function createReallocateBudgetTool(
	client: MetaClient,
	guardrails: GuardrailConfig = DEFAULT_GUARDRAILS,
) {
	return createTool({
		name: "reallocate_budget",
		description:
			"Moves budget from an underperforming campaign to an overperforming one. " +
			"Executes both updates atomically with rollback on failure.",
		parameters: ReallocateBudgetParams,

		async execute(
			params: ReallocateBudgetInput,
			context: ToolContext,
		): Promise<ToolResult> {
			const { fromCampaignId, toCampaignId, amount, reason } = params;

			/* Fetch current budgets for both campaigns */
			const [sourceCampaign, destCampaign] = await Promise.all([
				client.campaigns.get(fromCampaignId),
				client.campaigns.get(toCampaignId),
			]);

			const sourceBudget =
				Number.parseInt(sourceCampaign.daily_budget ?? "0", 10) / 100;
			const destBudget =
				Number.parseInt(destCampaign.daily_budget ?? "0", 10) / 100;

			const newSourceBudget = sourceBudget - amount;
			const newDestBudget = destBudget + amount;

			/* GUARDRAIL: Source campaign cannot drop below minimum daily budget */
			if (newSourceBudget < guardrails.minDailyBudget) {
				return {
					success: false,
					data: {
						fromCampaignId,
						toCampaignId,
						amount,
						sourceBudget,
						newSourceBudget,
						minDailyBudget: guardrails.minDailyBudget,
						reason,
					},
					message:
						`Reallocation rejected: reducing campaign ${fromCampaignId} ` +
						`by $${amount.toFixed(2)} would leave $${newSourceBudget.toFixed(2)}, ` +
						`below the minimum of $${guardrails.minDailyBudget.toFixed(2)}.`,
				};
			}

			/* GUARDRAIL: Destination cannot exceed max budget scale factor */
			const maxDestBudget = destBudget * guardrails.maxBudgetScaleFactor;
			if (destBudget > 0 && newDestBudget > maxDestBudget) {
				return {
					success: false,
					data: {
						fromCampaignId,
						toCampaignId,
						amount,
						destBudget,
						newDestBudget,
						maxBudgetScaleFactor: guardrails.maxBudgetScaleFactor,
						maxAllowedBudget: Math.round(maxDestBudget * 100) / 100,
						reason,
					},
					message:
						`Reallocation rejected: increasing campaign ${toCampaignId} ` +
						`to $${newDestBudget.toFixed(2)} exceeds the ${guardrails.maxBudgetScaleFactor}x ` +
						`scale factor (max: $${maxDestBudget.toFixed(2)} from current $${destBudget.toFixed(2)}).`,
				};
			}

			/* Skip actual API calls in dry-run mode */
			if (context.dryRun) {
				return {
					success: true,
					data: {
						dryRun: true,
						fromCampaignId,
						toCampaignId,
						amount,
						source: { before: sourceBudget, after: newSourceBudget },
						destination: { before: destBudget, after: newDestBudget },
						reason,
					},
					message:
						`[DRY RUN] Would reallocate $${amount.toFixed(2)} ` +
						`from campaign ${fromCampaignId} ($${sourceBudget.toFixed(2)} -> $${newSourceBudget.toFixed(2)}) ` +
						`to campaign ${toCampaignId} ($${destBudget.toFixed(2)} -> $${newDestBudget.toFixed(2)}).`,
				};
			}

			/* Step 1: Reduce source campaign budget */
			const newSourceCents = Math.round(newSourceBudget * 100).toString();
			await client.campaigns.update(fromCampaignId, {
				daily_budget: newSourceCents,
			});

			/* Step 2: Increase destination campaign budget (with rollback on failure) */
			try {
				const newDestCents = Math.round(newDestBudget * 100).toString();
				await client.campaigns.update(toCampaignId, {
					daily_budget: newDestCents,
				});
			} catch (destError: unknown) {
				/* Rollback: restore source campaign to original budget */
				const originalSourceCents = Math.round(sourceBudget * 100).toString();
				try {
					await client.campaigns.update(fromCampaignId, {
						daily_budget: originalSourceCents,
					});
				} catch (rollbackError: unknown) {
					const rollbackMessage =
						rollbackError instanceof Error
							? rollbackError.message
							: String(rollbackError);
					const destMessage =
						destError instanceof Error
							? destError.message
							: String(destError);
					return {
						success: false,
						data: {
							fromCampaignId,
							toCampaignId,
							amount,
							error: destMessage,
							rollbackError: rollbackMessage,
							rollbackFailed: true,
							sourceModifiedBudget: newSourceBudget,
							originalSourceBudget: sourceBudget,
						},
						message:
							`CRITICAL: Reallocation failed and rollback also failed. ` +
							`Source campaign ${fromCampaignId} may have an incorrect budget ` +
							`of $${newSourceBudget.toFixed(2)} (original: $${sourceBudget.toFixed(2)}). ` +
							`Manual intervention required. ` +
							`Destination error: ${destMessage}. ` +
							`Rollback error: ${rollbackMessage}.`,
					};
				}

				const destMessage =
					destError instanceof Error
						? destError.message
						: String(destError);
				return {
					success: false,
					data: {
						fromCampaignId,
						toCampaignId,
						amount,
						error: destMessage,
						rolledBack: true,
						sourceBudgetRestored: sourceBudget,
					},
					message:
						`Reallocation failed: could not update destination campaign ${toCampaignId}. ` +
						`Source campaign ${fromCampaignId} budget has been rolled back ` +
						`to $${sourceBudget.toFixed(2)}. Error: ${destMessage}`,
				};
			}

			return {
				success: true,
				data: {
					fromCampaignId,
					toCampaignId,
					amount,
					source: {
						name: sourceCampaign.name,
						before: sourceBudget,
						after: newSourceBudget,
					},
					destination: {
						name: destCampaign.name,
						before: destBudget,
						after: newDestBudget,
					},
					reason,
				},
				message:
					`Successfully reallocated $${amount.toFixed(2)}: ` +
					`${sourceCampaign.name} ($${sourceBudget.toFixed(2)} -> $${newSourceBudget.toFixed(2)}) ` +
					`-> ${destCampaign.name} ($${destBudget.toFixed(2)} -> $${newDestBudget.toFixed(2)}). ` +
					`Reason: ${reason}`,
			};
		},
	});
}
