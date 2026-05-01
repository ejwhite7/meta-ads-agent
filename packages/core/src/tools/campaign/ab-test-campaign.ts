/**
 * @module tools/campaign/ab-test-campaign
 *
 * Creates an A/B split test between two campaign structures using the
 * Meta Marketing API's split test endpoint (not available via CLI).
 *
 * The agent uses this tool when it wants to scientifically compare
 * different approaches — e.g. two creative sets, two audiences, or
 * two placement strategies — with statistically valid test design.
 *
 * Part of the **Act** phase in the OODA cycle.
 */

import { Type } from "@sinclair/typebox";
import { type ToolResult, createTool } from "../types.js";

/**
 * Tool: ab_test_campaign
 *
 * Creates a split test via the Meta direct API (splitTests.create).
 * Requires a test variable (what's being tested), duration, and budget.
 * Returns a split test ID for subsequent monitoring.
 */
export const abTestCampaignTool = createTool({
	name: "ab_test_campaign",
	description:
		"Create an A/B split test to compare campaign structures by creative, " +
		"audience, or placement. Uses Meta's split test API and returns a test ID " +
		"for monitoring.",
	parameters: Type.Object({
		name: Type.String({
			description: "Name for the split test",
		}),
		testVariable: Type.Union(
			[Type.Literal("CREATIVE"), Type.Literal("AUDIENCE"), Type.Literal("PLACEMENT")],
			{
				description:
					"The variable being tested: CREATIVE (different ad creatives), " +
					"AUDIENCE (different target audiences), or PLACEMENT (different ad placements)",
			},
		),
		duration: Type.Number({
			minimum: 1,
			maximum: 30,
			description: "Test duration in days (1-30)",
		}),
		budget: Type.Number({
			minimum: 1,
			description: "Total test budget in account currency",
		}),
	}),
	async execute(params, context): Promise<ToolResult> {
		const { name, testVariable, duration, budget } = params;

		try {
			/* ------------------------------------------------------------------
			 * Step 1: Validate test name
			 * ----------------------------------------------------------------*/
			const trimmedName = name.trim();
			if (trimmedName.length === 0) {
				return {
					success: false,
					data: null,
					error: "Split test name must not be empty",
					message: "Split test name must not be empty",
					errorCode: "VALIDATION_ERROR",
				};
			}

			/* ------------------------------------------------------------------
			 * Step 2: Validate budget against guardrail minimum
			 * ----------------------------------------------------------------*/
			const minDailyBudget = context.guardrails?.minDailyBudget ?? 5;
			if (budget < minDailyBudget) {
				return {
					success: false,
					data: null,
					error:
						`Test budget $${budget.toFixed(2)} is below the minimum ` +
						`of $${minDailyBudget.toFixed(2)}`,
					message:
						`Test budget $${budget.toFixed(2)} is below the minimum ` +
						`of $${minDailyBudget.toFixed(2)}`,
					errorCode: "GUARDRAIL_MIN_BUDGET_VIOLATED",
				};
			}

			/* ------------------------------------------------------------------
			 * Step 3: Create the split test via Meta direct API
			 * ----------------------------------------------------------------*/
			const splitTest = await context.metaClient.splitTests.create({
				name: trimmedName,
				adAccountId: context.adAccountId,
				testVariable,
				budget,
				duration,
			});

			/* ------------------------------------------------------------------
			 * Step 4: Audit log
			 * ----------------------------------------------------------------*/
			if (context.auditLogger) {
				await context.auditLogger.logDecision({
					sessionId: context.sessionId,
					adAccountId: context.adAccountId,
					toolName: "ab_test_campaign",
					params: {
						adAccountId: context.adAccountId,
						name: trimmedName,
						testVariable,
						duration,
						budget,
					},
					reasoning: "ab_test_campaign tool invocation",
					expectedOutcome:
						`Created A/B split test '${trimmedName}' (ID: ${splitTest.id}). ` +
						`Variable: ${testVariable}, duration: ${duration} days, ` +
						`budget: $${budget.toFixed(2)}`,
					score: 0,
					riskLevel: "medium",
					success: true,
					resultData: { splitTestId: splitTest.id },
					errorMessage: null,
				});
			}

			return {
				success: true,
				data: {
					splitTestId: splitTest.id,
					name: trimmedName,
					testVariable,
					duration,
					budget,
					status: splitTest.status,
				},
				message: `Created A/B test "${trimmedName}" (ID: ${splitTest.id}) testing ${testVariable} over ${duration} days with budget $${budget.toFixed(2)}.`,
			};
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Unknown error creating split test";

			return {
				success: false,
				data: null,
				error: `Failed to create A/B test '${name}': ${message}`,
				message: `Failed to create A/B test '${name}': ${message}`,
				errorCode: "META_API_ERROR",
			};
		}
	},
});
