/**
 * @module tools/campaign/create-campaign
 *
 * Creates a new Meta campaign from a structured specification.
 * Used when the agent determines that a new campaign is needed — for example,
 * to test a new audience, objective, or creative strategy.
 *
 * Validates all inputs before sending to the Meta API:
 * - Name must be non-empty
 * - Daily budget must be at least $5 (guardrail floor)
 * - Objective must be a valid Meta campaign objective
 *
 * Part of the **Act** phase in the OODA cycle.
 */

import { Type } from "@sinclair/typebox";
import { type ToolResult, createTool } from "../types.js";

/**
 * Valid Meta campaign objectives.
 * @see https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group#objectives
 */
const VALID_OBJECTIVES = [
	"OUTCOME_AWARENESS",
	"OUTCOME_ENGAGEMENT",
	"OUTCOME_LEADS",
	"OUTCOME_SALES",
	"OUTCOME_TRAFFIC",
	"OUTCOME_APP_PROMOTION",
] as const;

/**
 * Tool: create_campaign
 *
 * Creates a new campaign in the specified ad account. Validates name,
 * budget, and objective before calling the Meta API. Returns the newly
 * created campaign ID on success.
 */
export const createCampaignTool = createTool({
	name: "create_campaign",
	description:
		"Create a new Meta campaign with the specified objective and daily budget. " +
		"Validates inputs (non-empty name, budget >= $5, valid objective) before creation.",
	parameters: Type.Object({
		name: Type.String({
			description: "Campaign name (must be non-empty)",
		}),
		objective: Type.Union(
			[
				Type.Literal("OUTCOME_AWARENESS"),
				Type.Literal("OUTCOME_ENGAGEMENT"),
				Type.Literal("OUTCOME_LEADS"),
				Type.Literal("OUTCOME_SALES"),
				Type.Literal("OUTCOME_TRAFFIC"),
				Type.Literal("OUTCOME_APP_PROMOTION"),
			],
			{
				description: "Meta campaign objective",
			},
		),
		dailyBudget: Type.Number({
			minimum: 1,
			description: "Daily budget in account currency (e.g. 50.00 for $50/day)",
		}),
		status: Type.Union([Type.Literal("ACTIVE"), Type.Literal("PAUSED")], {
			default: "PAUSED",
			description:
				"Initial campaign status. Defaults to PAUSED for safety — " + "activate after review.",
		}),
	}),
	async execute(params, context): Promise<ToolResult> {
		const { name, objective, dailyBudget, status } = params;
		const initialStatus = status ?? "PAUSED";

		try {
			/* ------------------------------------------------------------------
			 * Step 1: Validate campaign name
			 * ----------------------------------------------------------------*/
			const trimmedName = name.trim();
			if (trimmedName.length === 0) {
				return {
					success: false,
					data: null,
					error: "Campaign name must not be empty",
					message: "Campaign name must not be empty",
					errorCode: "VALIDATION_ERROR",
				};
			}

			/* ------------------------------------------------------------------
			 * Step 2: Validate budget against guardrail minimum
			 * ----------------------------------------------------------------*/
			if (dailyBudget < context.guardrails.minDailyBudget) {
				return {
					success: false,
					data: null,
					error:
						`Daily budget $${dailyBudget.toFixed(2)} is below the minimum ` +
						`of $${context.guardrails.minDailyBudget.toFixed(2)}`,
					message:
						`Daily budget $${dailyBudget.toFixed(2)} is below the minimum ` +
						`of $${context.guardrails.minDailyBudget.toFixed(2)}`,
					errorCode: "GUARDRAIL_MIN_BUDGET_VIOLATED",
				};
			}

			/* ------------------------------------------------------------------
			 * Step 3: Validate objective
			 * ----------------------------------------------------------------*/
			if (!(VALID_OBJECTIVES as readonly string[]).includes(objective)) {
				return {
					success: false,
					data: null,
					error: `Invalid objective '${objective}'. Valid objectives: ${VALID_OBJECTIVES.join(", ")}`,
					message: `Invalid objective '${objective}'. Valid objectives: ${VALID_OBJECTIVES.join(", ")}`,
					errorCode: "VALIDATION_ERROR",
				};
			}

			/* ------------------------------------------------------------------
			 * Step 4: Create the campaign via Meta API (budget in cents)
			 * ----------------------------------------------------------------*/
			const budgetInCents = Math.round(dailyBudget * 100);

			const campaign = await context.metaClient.campaigns.create(context.adAccountId, {
				name: trimmedName,
				objective,
				daily_budget: budgetInCents,
				status: initialStatus,
			});

			/* ------------------------------------------------------------------
			 * Step 5: Audit log
			 * ----------------------------------------------------------------*/
			await context.auditLogger.record({
				toolName: "create_campaign",
				toolParams: {
					adAccountId: context.adAccountId,
					name: trimmedName,
					objective,
					dailyBudget,
					status: initialStatus,
				},
				outcome:
					`Created campaign '${trimmedName}' (ID: ${campaign.id}) with objective ` +
					`${objective}, budget $${dailyBudget.toFixed(2)}/day, status ${initialStatus}`,
				timestamp: new Date().toISOString(),
			});

			return {
				success: true,
				data: {
					campaignId: campaign.id,
					name: trimmedName,
					objective,
					dailyBudget,
					status: initialStatus,
				},
				message: `Created campaign "${trimmedName}" (ID: ${campaign.id}) with objective ${objective}, budget $${dailyBudget.toFixed(2)}/day, status ${initialStatus}.`,
			};
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error creating campaign";

			return {
				success: false,
				data: null,
				error: `Failed to create campaign '${name}': ${message}`,
				message: `Failed to create campaign '${name}': ${message}`,
				errorCode: "META_API_ERROR",
			};
		}
	},
});
