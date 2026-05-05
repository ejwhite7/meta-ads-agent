/**
 * @module tools/budget/_guardrails
 *
 * Resolve effective guardrails for a budget operation, merging
 * per-campaign overrides on top of the account-wide defaults.
 *
 * Per-campaign overrides live on `campaign_goals` (PR #23 schema):
 *   - `min_daily_budget`        \u2192 floor for any budget on this campaign
 *   - `max_budget_scale_factor` \u2192 ceiling on Nx scaling
 *   - `require_approval_above`  \u2192 dollar threshold above which the
 *                                 action requires human approval
 *
 * Each column is nullable. NULL means "inherit the account-wide
 * value." DESIGN.md \u00a72 documents this as the pending wiring; this
 * module is the wiring.
 *
 * Failure modes are deliberately permissive: if the lookup throws
 * (e.g. transient DB error), we return the base guardrails. The
 * agent should keep operating against safe account-wide defaults
 * rather than refuse to act on a transient repository hiccup.
 */

import { DEFAULT_GUARDRAILS } from "../../decisions/types.js";
import type { GuardrailConfig } from "../../decisions/types.js";
import type { ToolContext } from "../types.js";

/**
 * Result of guardrail resolution. The `source` field tells the
 * caller whether per-campaign overrides actually applied, which is
 * useful for audit messages and debugging ("rejected at the
 * per-campaign $5 floor" reads differently than "rejected at the
 * account-wide $10 floor").
 */
export interface ResolvedGuardrails {
	readonly minDailyBudget: number;
	readonly maxBudgetScaleFactor: number;
	readonly requireApprovalAbove: number;
	/**
	 * Per-field provenance. `"campaign"` means the value came from
	 * `campaign_goals.<column>`; `"account"` means it fell back to
	 * `context.guardrails` or `DEFAULT_GUARDRAILS`.
	 */
	readonly source: {
		readonly minDailyBudget: "campaign" | "account";
		readonly maxBudgetScaleFactor: "campaign" | "account";
		readonly requireApprovalAbove: "campaign" | "account";
	};
}

/**
 * Resolve effective guardrails for a campaign.
 *
 * Lookup order per field:
 *   1. `campaign_goals.<override>` if non-null
 *   2. `context.guardrails.<field>` if set
 *   3. `DEFAULT_GUARDRAILS.<field>`
 *
 * @param context     Tool context. Must have `goalRepository` and
 *                    `adAccountId` populated for per-campaign lookup
 *                    to apply; otherwise base guardrails are returned.
 * @param campaignId  Campaign whose overrides to apply.
 * @param base        Optional explicit base. Defaults to
 *                    `context.guardrails` merged onto `DEFAULT_GUARDRAILS`.
 */
export async function resolveEffectiveGuardrails(
	context: ToolContext,
	campaignId: string,
	base?: GuardrailConfig,
): Promise<ResolvedGuardrails> {
	const accountWide: GuardrailConfig = base ?? {
		...DEFAULT_GUARDRAILS,
		...(context.guardrails ?? {}),
	};

	if (!context.goalRepository || !context.adAccountId || !campaignId) {
		return {
			minDailyBudget: accountWide.minDailyBudget,
			maxBudgetScaleFactor: accountWide.maxBudgetScaleFactor,
			requireApprovalAbove: accountWide.requireApprovalAbove,
			source: {
				minDailyBudget: "account",
				maxBudgetScaleFactor: "account",
				requireApprovalAbove: "account",
			},
		};
	}

	let goal: Awaited<ReturnType<typeof context.goalRepository.getActive>> = null;
	try {
		goal = await context.goalRepository.getActive(context.adAccountId, campaignId);
	} catch {
		/* Transient DB hiccup: fall back to account-wide. The agent's
		 * correctness on safety floors should not depend on a working
		 * goal repository read. */
	}

	if (!goal) {
		return {
			minDailyBudget: accountWide.minDailyBudget,
			maxBudgetScaleFactor: accountWide.maxBudgetScaleFactor,
			requireApprovalAbove: accountWide.requireApprovalAbove,
			source: {
				minDailyBudget: "account",
				maxBudgetScaleFactor: "account",
				requireApprovalAbove: "account",
			},
		};
	}

	const minOverride = goal.minDailyBudget;
	const maxOverride = goal.maxBudgetScaleFactor;
	const approvalOverride = goal.requireApprovalAbove;

	return {
		minDailyBudget: minOverride !== null ? minOverride : accountWide.minDailyBudget,
		maxBudgetScaleFactor: maxOverride !== null ? maxOverride : accountWide.maxBudgetScaleFactor,
		requireApprovalAbove:
			approvalOverride !== null ? approvalOverride : accountWide.requireApprovalAbove,
		source: {
			minDailyBudget: minOverride !== null ? "campaign" : "account",
			maxBudgetScaleFactor: maxOverride !== null ? "campaign" : "account",
			requireApprovalAbove: approvalOverride !== null ? "campaign" : "account",
		},
	};
}
