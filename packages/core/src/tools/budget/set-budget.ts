/**
 * @module tools/budget/set-budget
 *
 * Sets the daily budget for a campaign or ad set to an absolute value.
 * Enforces guardrail constraints: minimum budget floor, maximum scale
 * factor ceiling, and human approval thresholds for high-value changes.
 */

import type { MetaClient } from "@meta-ads-agent/meta-client";
import { type Static, Type } from "@sinclair/typebox";
import type { GuardrailConfig } from "../../decisions/types.js";
import { DEFAULT_GUARDRAILS } from "../../decisions/types.js";
import { createTool } from "../types.js";
import type { ToolContext, ToolResult } from "../types.js";
import { resolveMetaClient } from "./_client.js";
import { resolveEffectiveGuardrails } from "./_guardrails.js";

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
	client: MetaClient | null = null,
	guardrails: GuardrailConfig = DEFAULT_GUARDRAILS,
) {
	return createTool({
		name: "set_budget",
		description:
			"Sets an absolute daily budget on either a campaign (campaignId only) " +
			"or an ad set (pass adSetId to target the ad-set level \u2014 the " +
			"surgical option for ABO campaigns where one ad set needs more or " +
			"less than its siblings). Enforces minimum floor, maximum scale-factor " +
			"ceiling, and approval thresholds.",
		parameters: SetBudgetParams,

		async execute(params: SetBudgetInput, context: ToolContext): Promise<ToolResult> {
			const { campaignId, dailyBudget, reason, adSetId } = params;
			const targetLevel = adSetId ? "ad set" : "campaign";
			const targetId = adSetId ?? campaignId;

			/* Resolve the MetaClient: prefer the bound client, fall back to context. */
			const resolved = resolveMetaClient(client, context);
			if (resolved.error) return resolved.error;
			const c = resolved.client;

			/* Fetch current budget. For ad-set updates also resolve the
			 * parent campaign id — per-campaign goal overrides apply at the
			 * campaign level even when the operation targets a child ad set
			 * (campaign_goals has no ad-set granularity by design; see
			 * DESIGN.md §2). */
			let currentBudgetCents: number;
			let effectiveCampaignId = campaignId;
			if (adSetId) {
				const adSet = await c.adSets.get(adSetId);
				currentBudgetCents = Number.parseInt(adSet.daily_budget ?? "0", 10);
				/* Trust the live ad-set's parent campaign over the LLM's
				 * params (the LLM might have misremembered or fabricated). */
				if (adSet.campaign_id) effectiveCampaignId = adSet.campaign_id;
			} else {
				const campaign = await c.campaigns.get(campaignId);
				currentBudgetCents = Number.parseInt(campaign.daily_budget ?? "0", 10);
			}
			const currentBudget = currentBudgetCents / 100;

			/* Resolve effective guardrails: account-wide base merged with
			 * per-campaign overrides from `campaign_goals` (PR #23 schema,
			 * wired here in PR #37). The factory-bound `guardrails` is the
			 * base; per-campaign columns shadow each field independently
			 * when non-null. */
			const eff = await resolveEffectiveGuardrails(context, effectiveCampaignId, guardrails);
			const floorSrc = eff.source.minDailyBudget === "campaign" ? " (per-campaign)" : "";
			const scaleSrc = eff.source.maxBudgetScaleFactor === "campaign" ? " (per-campaign)" : "";
			const approvalSrc = eff.source.requireApprovalAbove === "campaign" ? " (per-campaign)" : "";

			/* GUARDRAIL: Enforce minimum daily budget floor */
			if (dailyBudget < eff.minDailyBudget) {
				return {
					success: false,
					data: {
						targetId,
						targetLevel,
						requestedBudget: dailyBudget,
						minDailyBudget: eff.minDailyBudget,
						minDailyBudgetSource: eff.source.minDailyBudget,
						reason,
					},
					error: `Budget change rejected: requested $${dailyBudget.toFixed(2)} is below the minimum daily budget of $${eff.minDailyBudget.toFixed(2)}${floorSrc}.`,
					message: `Budget change rejected: requested $${dailyBudget.toFixed(2)} is below the minimum daily budget of $${eff.minDailyBudget.toFixed(2)}${floorSrc}.`,
				};
			}

			/* GUARDRAIL: Enforce maximum budget scale factor ceiling */
			const maxAllowedBudget = currentBudget * eff.maxBudgetScaleFactor;
			if (currentBudget > 0 && dailyBudget > maxAllowedBudget) {
				return {
					success: false,
					data: {
						targetId,
						targetLevel,
						requestedBudget: dailyBudget,
						currentBudget,
						maxBudgetScaleFactor: eff.maxBudgetScaleFactor,
						maxBudgetScaleFactorSource: eff.source.maxBudgetScaleFactor,
						maxAllowedBudget: Math.round(maxAllowedBudget * 100) / 100,
						reason,
					},
					error: `Budget change rejected: requested $${dailyBudget.toFixed(2)} exceeds the maximum ${eff.maxBudgetScaleFactor}x scale factor${scaleSrc}. Current budget: $${currentBudget.toFixed(2)}, max allowed: $${maxAllowedBudget.toFixed(2)}.`,
					message: `Budget change rejected: requested $${dailyBudget.toFixed(2)} exceeds the maximum ${eff.maxBudgetScaleFactor}x scale factor${scaleSrc}. Current budget: $${currentBudget.toFixed(2)}, max allowed: $${maxAllowedBudget.toFixed(2)}.`,
				};
			}

			/* GUARDRAIL: Require human approval for large changes */
			if (dailyBudget > eff.requireApprovalAbove) {
				return {
					success: true,
					data: {
						status: "pending_approval",
						targetId,
						targetLevel,
						currentBudget,
						requestedBudget: dailyBudget,
						requireApprovalAbove: eff.requireApprovalAbove,
						requireApprovalAboveSource: eff.source.requireApprovalAbove,
						reason,
					},
					message: `Budget change of $${dailyBudget.toFixed(2)} requires human approval (threshold: $${eff.requireApprovalAbove.toFixed(2)}${approvalSrc}). Change is pending.`,
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
				await c.adSets.update(adSetId, {
					daily_budget: newBudgetCents,
				});
			} else {
				await c.campaigns.update(campaignId, {
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
					`(${currentBudget > 0 ? (((dailyBudget - currentBudget) / currentBudget) * 100).toFixed(1) : "N/A"}% change). ` +
					`Reason: ${reason}`,
			};
		},
	});
}
