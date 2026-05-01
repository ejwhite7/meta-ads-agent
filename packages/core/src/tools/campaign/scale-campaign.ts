/**
 * @module tools/campaign/scale-campaign
 *
 * Scales a campaign's daily budget up or down by a percentage factor.
 * This is the primary budget-optimization tool used in the **Act** phase
 * after the decision engine identifies a campaign worth scaling.
 *
 * **Guardrails enforced:**
 * - `scaleFactor` must be between 0.5 and the configured `maxBudgetScaleFactor`
 * - Resulting budget must be at or above `minDailyBudget`
 * - Budget increases above `requireApprovalAbove` return a pending action
 *   instead of executing immediately
 *
 * See CLAUDE.md section 5 — Guardrails for the full constraint specification.
 */

import { Type } from "@sinclair/typebox";
import { DEFAULT_GUARDRAILS } from "../../decisions/types.js";
import type { GuardrailConfig } from "../../decisions/types.js";
import type { PendingAction } from "../../types.js";
import { type ToolResult, createTool } from "../types.js";

/**
 * Tool: scale_campaign
 *
 * Adjusts a campaign's daily budget by multiplying it with the given
 * `scaleFactor`. Enforces all budget guardrails before making any change.
 */
export const scaleCampaignTool = createTool({
	name: "scale_campaign",
	description:
		"Scale a campaign's daily budget by a percentage factor (e.g. 1.5 = +50%). " +
		"Enforces guardrails: max scale factor, minimum budget floor, and approval " +
		"thresholds for large increases.",
	parameters: Type.Object({
		campaignId: Type.String({
			description: "Meta campaign ID to scale",
		}),
		scaleFactor: Type.Number({
			minimum: 0.5,
			maximum: 5.0,
			description:
				"Multiplier for the current daily budget (0.5 = halve, 1.5 = +50%, 2.0 = double)",
		}),
		reason: Type.String({
			description: "Why the budget is being scaled — logged to the audit trail",
		}),
	}),
	async execute(params, context): Promise<ToolResult> {
		const { campaignId, scaleFactor, reason } = params;
		/* Merge per-call guardrail overrides on top of safe defaults so this
		 * tool can be invoked from tests/CLI without a fully-populated context. */
		const guardrails: GuardrailConfig = {
			...DEFAULT_GUARDRAILS,
			...(context.guardrails ?? {}),
		};
		if (!context.metaClient) {
			return {
				success: false,
				data: null,
				error: "context.metaClient is required for scale_campaign",
				message: "context.metaClient is required for scale_campaign",
				errorCode: "META_CLIENT_UNAVAILABLE",
			};
		}

		try {
			/* ------------------------------------------------------------------
			 * Step 1: Validate scale factor against guardrail maximum
			 * ----------------------------------------------------------------*/
			if (scaleFactor > guardrails.maxBudgetScaleFactor) {
				return {
					success: false,
					data: null,
					error: `Scale factor ${scaleFactor} exceeds maximum allowed ${guardrails.maxBudgetScaleFactor}. Reduce the scale factor or adjust guardrail configuration.`,
					message: `Scale factor ${scaleFactor} exceeds maximum allowed ${guardrails.maxBudgetScaleFactor}. Reduce the scale factor or adjust guardrail configuration.`,
					errorCode: "GUARDRAIL_MAX_SCALE_EXCEEDED",
				};
			}

			/* ------------------------------------------------------------------
			 * Step 2: Fetch the campaign to get current budget
			 * ----------------------------------------------------------------*/
			const campaign = await context.metaClient.campaigns.get(campaignId);

			if (!campaign) {
				return {
					success: false,
					data: null,
					error: `Campaign ${campaignId} not found`,
					message: `Campaign ${campaignId} not found`,
					errorCode: "CAMPAIGN_NOT_FOUND",
				};
			}

			/* Meta returns daily_budget as a string in account-currency cents. */
			const currentBudgetCents = Number.parseInt(campaign.daily_budget ?? "0", 10);
			const currentBudget = currentBudgetCents / 100;
			const newBudget = Math.round(currentBudget * scaleFactor * 100) / 100;

			/* ------------------------------------------------------------------
			 * Step 3: Enforce minimum budget floor
			 * ----------------------------------------------------------------*/
			if (newBudget < guardrails.minDailyBudget) {
				return {
					success: false,
					data: null,
					error:
						`New budget $${newBudget.toFixed(2)} would be below the minimum ` +
						`daily budget of $${guardrails.minDailyBudget.toFixed(2)}. ` +
						`Current budget: $${currentBudget.toFixed(2)}, scale factor: ${scaleFactor}.`,
					message:
						`New budget $${newBudget.toFixed(2)} would be below the minimum ` +
						`daily budget of $${guardrails.minDailyBudget.toFixed(2)}. ` +
						`Current budget: $${currentBudget.toFixed(2)}, scale factor: ${scaleFactor}.`,
					errorCode: "GUARDRAIL_MIN_BUDGET_VIOLATED",
				};
			}

			/* ------------------------------------------------------------------
			 * Step 4: Check approval threshold for large increases
			 * ----------------------------------------------------------------*/
			const budgetIncrease = newBudget - currentBudget;

			if (budgetIncrease > guardrails.requireApprovalAbove) {
				const pendingAction: PendingAction = {
					id: `pending_${campaignId}_${Date.now()}`,
					toolName: "scale_campaign",
					params: { campaignId, scaleFactor, reason },
					reason:
						`Budget increase of $${budgetIncrease.toFixed(2)} exceeds the ` +
						`approval threshold of $${guardrails.requireApprovalAbove.toFixed(2)}. ` +
						`New budget would be $${newBudget.toFixed(2)} (from $${currentBudget.toFixed(2)}).`,
					createdAt: new Date().toISOString(),
				};

				if (context.auditLogger) {
					await context.auditLogger.logDecision({
						sessionId: context.sessionId,
						adAccountId: context.adAccountId,
						toolName: "scale_campaign",
						params: { campaignId, scaleFactor, reason },
						reasoning: pendingAction.reason,
						expectedOutcome: "PENDING_HUMAN_APPROVAL",
						score: 0,
						riskLevel: "high",
						success: false,
						resultData: { pendingId: pendingAction.id },
						errorMessage: "Awaiting human approval",
					});
				}

				return {
					success: true,
					data: {
						action: "pending_approval",
						pendingAction,
						campaignId,
						campaignName: campaign.name,
						currentBudget,
						proposedBudget: newBudget,
					},
					message: "Budget change requires approval.",
				};
			}

			/* ------------------------------------------------------------------
			 * Step 5: Execute the budget change.
			 * Meta's API expects daily_budget as a string in cents.
			 * ----------------------------------------------------------------*/
			const budgetInCentsString = String(Math.round(newBudget * 100));
			if (!context.dryRun) {
				await context.metaClient.campaigns.update(campaignId, {
					daily_budget: budgetInCentsString,
				});
			}

			/* ------------------------------------------------------------------
			 * Step 6: Audit log with before/after budget
			 * ----------------------------------------------------------------*/
			if (context.auditLogger) {
				await context.auditLogger.logDecision({
					sessionId: context.sessionId,
					adAccountId: context.adAccountId,
					toolName: "scale_campaign",
					params: { campaignId, scaleFactor, reason },
					reasoning: reason,
					expectedOutcome: `Budget $${currentBudget.toFixed(2)} -> $${newBudget.toFixed(2)} (factor ${scaleFactor})`,
					score: 0,
					riskLevel: "medium",
					success: true,
					resultData: { previousBudget: currentBudget, newBudget, scaleFactor },
					errorMessage: null,
				});
			}

			return {
				success: true,
				data: {
					action: "scaled",
					campaignId,
					campaignName: campaign.name,
					previousBudget: currentBudget,
					newBudget,
					scaleFactor,
					reason,
				},
				message: "Campaign budget scaled successfully.",
			};
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error scaling campaign";

			return {
				success: false,
				data: null,
				error: `Failed to scale campaign ${campaignId}: ${message}`,
				message: `Failed to scale campaign ${campaignId}: ${message}`,
				errorCode: "META_API_ERROR",
			};
		}
	},
});
