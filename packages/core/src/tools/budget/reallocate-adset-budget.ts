/**
 * @module tools/budget/reallocate-adset-budget
 *
 * Moves budget between two ad sets, atomically. Mirrors
 * `reallocate_budget` (campaign-level) but operates one level deeper
 * in the hierarchy. The agent reaches for this when:
 *
 *   - A campaign uses ABO (Ad-Set Budget Optimization, NOT CBO) and one
 *     ad set is dragging the campaign's KPI while a sibling is over-
 *     performing. With CBO on, Meta rebalances internally and this
 *     tool would conflict — the LLM should be told that in the prompt.
 *
 *   - You want to surgically rebalance without changing the campaign's
 *     total daily spend. set_budget at the campaign level can't express
 *     "shift $X from ad set A to ad set B" without two calls and no
 *     atomicity guarantee.
 *
 * Atomicity: as with `reallocate_budget`, both updates execute as a
 * two-phase transaction. If the destination update fails, the source
 * is rolled back. If the rollback ALSO fails, we surface a CRITICAL
 * error with both error messages so the operator can intervene.
 *
 * Cross-campaign reallocation is allowed (sometimes useful when a
 * dying campaign has spare adset budget that another campaign's
 * winning adset can use), but we surface a `crossCampaign: true` flag
 * in the result so the audit log makes that visible.
 */

import type { MetaClient } from "@meta-ads-agent/meta-client";
import { type Static, Type } from "@sinclair/typebox";
import type { GuardrailConfig } from "../../decisions/types.js";
import { DEFAULT_GUARDRAILS } from "../../decisions/types.js";
import { createTool } from "../types.js";
import type { ToolContext, ToolResult } from "../types.js";
import { resolveMetaClient } from "./_client.js";

const ReallocateAdSetBudgetParams = Type.Object({
	fromAdSetId: Type.String({ description: "Source ad-set ID to reduce budget from" }),
	toAdSetId: Type.String({ description: "Destination ad-set ID to increase budget for" }),
	amount: Type.Number({
		minimum: 0.01,
		description: "Amount in account currency (USD) to move between ad sets",
	}),
	reason: Type.String({ description: "Explanation for the reallocation" }),
});

type ReallocateAdSetBudgetInput = Static<typeof ReallocateAdSetBudgetParams>;

/**
 * Creates the reallocate_adset_budget tool.
 *
 * Same guardrail semantics as `reallocate_budget`:
 *   - Source ad set cannot drop below `guardrails.minDailyBudget`.
 *   - Destination ad set cannot exceed `guardrails.maxBudgetScaleFactor`x
 *     its current budget.
 *
 * Differences from the campaign version:
 *   - Operates on `c.adSets.{get,update}` instead of `c.campaigns.*`.
 *   - Returns `crossCampaign: true` in the result data when the two
 *     ad sets belong to different campaigns (audit-log visibility).
 *   - Rejects when either ad set has no `daily_budget` set, since you
 *     can't reallocate from a CBO-managed ad set (Meta rejects the
 *     update; failing fast is clearer than letting Graph 400).
 */
export function createReallocateAdSetBudgetTool(
	client: MetaClient | null = null,
	guardrails: GuardrailConfig = DEFAULT_GUARDRAILS,
) {
	return createTool({
		name: "reallocate_adset_budget",
		description:
			"Moves budget between two ad sets atomically (with rollback on failure). " +
			"Use to surgically rebalance ABO ad sets within a campaign without changing " +
			"the campaign's total spend. Both ad sets must have an explicit daily_budget " +
			"(CBO-managed ad sets cannot be reallocated this way).",
		parameters: ReallocateAdSetBudgetParams,

		async execute(params: ReallocateAdSetBudgetInput, context: ToolContext): Promise<ToolResult> {
			const resolved = resolveMetaClient(client, context);
			if (resolved.error) return resolved.error;
			const c = resolved.client;

			const { fromAdSetId, toAdSetId, amount, reason } = params;

			if (fromAdSetId === toAdSetId) {
				return {
					success: false,
					data: { fromAdSetId, toAdSetId, amount, reason },
					error: "Source and destination ad sets must differ.",
					message: "Source and destination ad sets must differ.",
					errorCode: "INVALID_PARAMS",
				};
			}

			/* Fetch both ad sets in parallel. Either fetch failure aborts
			 * before any mutation \u2014 nothing to rollback yet. */
			const [sourceAdSet, destAdSet] = await Promise.all([
				c.adSets.get(fromAdSetId),
				c.adSets.get(toAdSetId),
			]);

			/* CBO ad sets have no daily_budget of their own \u2014 the campaign
			 * holds the pooled budget. Updating the ad-set budget directly
			 * triggers a 400 from Graph; surface a clear error instead. */
			if (!sourceAdSet.daily_budget) {
				return {
					success: false,
					data: { fromAdSetId, toAdSetId, reason },
					error: `Source ad set ${fromAdSetId} ('${sourceAdSet.name}') has no explicit daily_budget \u2014 likely under CBO. Reallocate via the parent campaign instead.`,
					message: `Source ad set ${fromAdSetId} has no explicit daily_budget. Likely CBO; can't reallocate at the ad-set level.`,
					errorCode: "ADSET_NO_BUDGET",
				};
			}
			if (!destAdSet.daily_budget) {
				return {
					success: false,
					data: { fromAdSetId, toAdSetId, reason },
					error: `Destination ad set ${toAdSetId} ('${destAdSet.name}') has no explicit daily_budget \u2014 likely under CBO. Reallocate via the parent campaign instead.`,
					message: `Destination ad set ${toAdSetId} has no explicit daily_budget. Likely CBO; can't reallocate at the ad-set level.`,
					errorCode: "ADSET_NO_BUDGET",
				};
			}

			const sourceBudget = Number.parseInt(sourceAdSet.daily_budget, 10) / 100;
			const destBudget = Number.parseInt(destAdSet.daily_budget, 10) / 100;

			const newSourceBudget = sourceBudget - amount;
			const newDestBudget = destBudget + amount;

			const crossCampaign = sourceAdSet.campaign_id !== destAdSet.campaign_id;

			/* GUARDRAIL: source ad set cannot drop below minimum daily budget */
			if (newSourceBudget < guardrails.minDailyBudget) {
				return {
					success: false,
					data: {
						fromAdSetId,
						toAdSetId,
						amount,
						sourceBudget,
						newSourceBudget,
						minDailyBudget: guardrails.minDailyBudget,
						crossCampaign,
						reason,
					},
					error:
						`Reallocation rejected: reducing ad set ${fromAdSetId} ` +
						`by $${amount.toFixed(2)} would leave $${newSourceBudget.toFixed(2)}, ` +
						`below the minimum of $${guardrails.minDailyBudget.toFixed(2)}.`,
					message:
						`Reallocation rejected: reducing ad set ${fromAdSetId} ` +
						`by $${amount.toFixed(2)} would leave $${newSourceBudget.toFixed(2)}, ` +
						`below the minimum of $${guardrails.minDailyBudget.toFixed(2)}.`,
				};
			}

			/* GUARDRAIL: destination cannot exceed max budget scale factor */
			const maxDestBudget = destBudget * guardrails.maxBudgetScaleFactor;
			if (destBudget > 0 && newDestBudget > maxDestBudget) {
				return {
					success: false,
					data: {
						fromAdSetId,
						toAdSetId,
						amount,
						destBudget,
						newDestBudget,
						maxBudgetScaleFactor: guardrails.maxBudgetScaleFactor,
						maxAllowedBudget: Math.round(maxDestBudget * 100) / 100,
						crossCampaign,
						reason,
					},
					error:
						`Reallocation rejected: increasing ad set ${toAdSetId} ` +
						`to $${newDestBudget.toFixed(2)} exceeds the ${guardrails.maxBudgetScaleFactor}x ` +
						`scale factor (max: $${maxDestBudget.toFixed(2)} from current $${destBudget.toFixed(2)}).`,
					message:
						`Reallocation rejected: increasing ad set ${toAdSetId} ` +
						`to $${newDestBudget.toFixed(2)} exceeds the ${guardrails.maxBudgetScaleFactor}x ` +
						`scale factor (max: $${maxDestBudget.toFixed(2)} from current $${destBudget.toFixed(2)}).`,
				};
			}

			/* Dry run: short-circuit before any writes. */
			if (context.dryRun) {
				return {
					success: true,
					data: {
						dryRun: true,
						fromAdSetId,
						toAdSetId,
						amount,
						source: { name: sourceAdSet.name, before: sourceBudget, after: newSourceBudget },
						destination: { name: destAdSet.name, before: destBudget, after: newDestBudget },
						crossCampaign,
						reason,
					},
					message:
						`[DRY RUN] Would reallocate $${amount.toFixed(2)} ` +
						`from ad set ${sourceAdSet.name} ($${sourceBudget.toFixed(2)} -> $${newSourceBudget.toFixed(2)}) ` +
						`to ${destAdSet.name} ($${destBudget.toFixed(2)} -> $${newDestBudget.toFixed(2)})${crossCampaign ? " [cross-campaign]" : ""}.`,
				};
			}

			/* Step 1: reduce source ad-set budget. */
			const newSourceCents = Math.round(newSourceBudget * 100).toString();
			await c.adSets.update(fromAdSetId, { daily_budget: newSourceCents });

			/* Step 2: increase destination ad-set budget, with rollback on failure. */
			try {
				const newDestCents = Math.round(newDestBudget * 100).toString();
				await c.adSets.update(toAdSetId, { daily_budget: newDestCents });
			} catch (destError: unknown) {
				const destMessage = destError instanceof Error ? destError.message : String(destError);
				/* Rollback: restore source ad set to its original budget. */
				const originalSourceCents = Math.round(sourceBudget * 100).toString();
				try {
					await c.adSets.update(fromAdSetId, { daily_budget: originalSourceCents });
				} catch (rollbackError: unknown) {
					const rollbackMessage =
						rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
					return {
						success: false,
						data: {
							fromAdSetId,
							toAdSetId,
							amount,
							error: destMessage,
							rollbackError: rollbackMessage,
							rollbackFailed: true,
							sourceModifiedBudget: newSourceBudget,
							originalSourceBudget: sourceBudget,
							crossCampaign,
						},
						error: `CRITICAL: Ad-set reallocation failed and rollback also failed. Source ad set ${fromAdSetId} may have an incorrect budget of $${newSourceBudget.toFixed(2)} (original: $${sourceBudget.toFixed(2)}). Manual intervention required. Destination error: ${destMessage}. Rollback error: ${rollbackMessage}.`,
						message: `CRITICAL: Ad-set reallocation failed and rollback also failed. Source ad set ${fromAdSetId} may have an incorrect budget of $${newSourceBudget.toFixed(2)} (original: $${sourceBudget.toFixed(2)}). Manual intervention required. Destination error: ${destMessage}. Rollback error: ${rollbackMessage}.`,
					};
				}

				return {
					success: false,
					data: {
						fromAdSetId,
						toAdSetId,
						amount,
						error: destMessage,
						rolledBack: true,
						sourceBudgetRestored: sourceBudget,
						crossCampaign,
					},
					error:
						`Reallocation failed: could not update destination ad set ${toAdSetId}. ` +
						`Source ad set ${fromAdSetId} budget has been rolled back ` +
						`to $${sourceBudget.toFixed(2)}. Error: ${destMessage}`,
					message:
						`Reallocation failed: could not update destination ad set ${toAdSetId}. ` +
						`Source ad set ${fromAdSetId} budget has been rolled back ` +
						`to $${sourceBudget.toFixed(2)}. Error: ${destMessage}`,
				};
			}

			return {
				success: true,
				data: {
					fromAdSetId,
					toAdSetId,
					amount,
					source: { name: sourceAdSet.name, before: sourceBudget, after: newSourceBudget },
					destination: { name: destAdSet.name, before: destBudget, after: newDestBudget },
					crossCampaign,
					reason,
				},
				message:
					`Successfully reallocated $${amount.toFixed(2)}: ` +
					`${sourceAdSet.name} ($${sourceBudget.toFixed(2)} -> $${newSourceBudget.toFixed(2)}) ` +
					`-> ${destAdSet.name} ($${destBudget.toFixed(2)} -> $${newDestBudget.toFixed(2)})` +
					`${crossCampaign ? " [cross-campaign]" : ""}. Reason: ${reason}`,
			};
		},
	});
}
