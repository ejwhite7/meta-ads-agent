/**
 * @module decisions/engine
 * Decision engine — parses LLM reasoning, scores proposals, applies guardrails.
 *
 * The engine sits at the core of the OODA "Decide" phase. It takes raw LLM
 * reasoning text, extracts structured action proposals, scores each one,
 * filters by guardrail constraints, and returns a ranked list of safe actions.
 */

import type { TObject } from "@sinclair/typebox";
import type { Tool } from "../tools/types.js";
import type { AgentGoal, CampaignMetrics, PendingAction } from "../types.js";
import { rankProposals } from "./scoring.js";
import type { ActionProposal, GuardrailConfig, RawProposedAction } from "./types.js";
import { DEFAULT_GUARDRAILS } from "./types.js";

/**
 * Extracts the first balanced top-level JSON array from a string.
 *
 * Walks the string character-by-character, tracking string boundaries
 * (so brackets inside string literals are ignored) and bracket depth.
 * Returns the substring spanning the first `[` through its matching `]`,
 * or null if no balanced array is found.
 *
 * This is robust against:
 *   - Markdown code fences and surrounding prose
 *   - Nested arrays in tool params (e.g. `params.fields: ["a","b"]`)
 *   - Earlier inline arrays in the prose like `[1, 2, 3]`
 *   - String literals containing `[` or `]`
 *
 * @internal
 */
export function extractFirstJsonArray(text: string): string | null {
	/* If the text contains an explicit <actions>...</actions> block, prefer
	 * the array inside it. This is the format the system prompt asks for and
	 * disambiguates the agent's intended action list from incidental arrays
	 * that may appear in prose (e.g. "recent ROAS values: [3.1, 3.4, 2.9]"). */
	const tagged = text.match(/<actions>([\s\S]*?)<\/actions>/i);
	const search = tagged ? tagged[1] : text;

	/* Walk every `[`; the first one whose matching `]` parses as a JSON
	 * array is returned. This skips inline numeric arrays in prose. */
	let searchFrom = search.indexOf("[");
	while (searchFrom !== -1) {
		const end = findMatchingBracket(search, searchFrom);
		if (end !== -1) {
			const slice = search.slice(searchFrom, end + 1);
			try {
				const parsed = JSON.parse(slice);
				if (Array.isArray(parsed)) {
					return slice;
				}
			} catch {
				/* Try the next `[`. */
			}
		}
		searchFrom = search.indexOf("[", searchFrom + 1);
	}
	return null;
}

/**
 * Finds the index of the `]` that matches the `[` at position `openAt`.
 * Returns -1 if no balanced match exists. Respects string literals.
 *
 * @internal
 */
function findMatchingBracket(text: string, openAt: number): number {
	let depth = 0;
	let inString = false;
	let stringQuote = "";
	for (let i = openAt; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (ch === "\\") {
				i++; /* skip escaped char */
				continue;
			}
			if (ch === stringQuote) {
				inString = false;
			}
			continue;
		}
		if (ch === '"' || ch === "'") {
			inString = true;
			stringQuote = ch;
			continue;
		}
		if (ch === "[") depth++;
		else if (ch === "]") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return -1;
}

/**
 * Parses structured action proposals from LLM reasoning text.
 *
 * Expects the LLM to output actions as a JSON array. Searches for the first
 * balanced top-level JSON array (skipping inline arrays in prose) and parses
 * it. Falls back to returning an empty array if no valid JSON is found.
 *
 * @param llmReasoning - Raw text output from the LLM
 * @param availableTools - List of tools the agent can use (for validation)
 * @returns Array of parsed raw action proposals
 */
export function parseActions(
	llmReasoning: string,
	availableTools: Tool<TObject>[],
): RawProposedAction[] {
	const toolNames = new Set(availableTools.map((t) => t.name));
	const actions: RawProposedAction[] = [];

	const jsonText = extractFirstJsonArray(llmReasoning);
	if (!jsonText) {
		return actions;
	}

	let parsed: unknown[];
	try {
		parsed = JSON.parse(jsonText) as unknown[];
	} catch {
		return actions;
	}

	if (!Array.isArray(parsed)) {
		return actions;
	}

	for (const item of parsed) {
		if (typeof item !== "object" || item === null) continue;

		const record = item as Record<string, unknown>;
		const toolName = typeof record.toolName === "string" ? record.toolName : "";
		const params =
			typeof record.params === "object" && record.params !== null
				? (record.params as Record<string, unknown>)
				: {};
		const reasoning = typeof record.reasoning === "string" ? record.reasoning : "";
		const expectedOutcome =
			typeof record.expectedOutcome === "string" ? record.expectedOutcome : "";
		const confidence =
			typeof record.confidence === "number" ? Math.max(0, Math.min(1, record.confidence)) : 0.5;
		const expectedImpact =
			typeof record.expectedImpact === "number"
				? Math.max(0, Math.min(1, record.expectedImpact))
				: 0.5;
		const riskLevel = ["low", "medium", "high"].includes(record.riskLevel as string)
			? (record.riskLevel as "low" | "medium" | "high")
			: "medium";

		/* Skip actions for tools that are not registered */
		if (!toolNames.has(toolName)) continue;

		actions.push({
			toolName,
			params,
			reasoning,
			expectedOutcome,
			confidence,
			expectedImpact,
			riskLevel,
		});
	}

	return actions;
}

/**
 * Applies guardrail constraints to filter out unsafe proposals.
 *
 * Checks each proposal against:
 * 1. Budget floor — rejects proposals that would set budget below minimum
 * 2. Scale factor — rejects proposals that increase budget by more than maxBudgetScaleFactor
 * 3. Approval threshold — flags proposals exceeding requireApprovalAbove
 *
 * @param proposals - Scored action proposals to filter
 * @param guardrails - Guardrail configuration
 * @param currentMetrics - Current campaign metrics (for budget comparison)
 * @returns Filtered array of safe proposals
 */
/**
 * Result of applying guardrails: approved actions and pending actions requiring human approval.
 */
export interface GuardrailResult {
	/** Proposals that passed all guardrail checks and can be executed immediately. */
	readonly approved: ActionProposal[];
	/** Proposals that exceed the approval threshold and require human sign-off. */
	readonly pending: PendingAction[];
}

/**
 * Applies guardrail constraints to scored proposals and separates them into
 * approved (safe to execute) and pending (requires human approval) buckets.
 *
 * Checks each proposal against:
 * 1. Budget floor -- rejects proposals that would set budget below minimum
 * 2. Scale factor -- rejects scale_campaign proposals exceeding maxBudgetScaleFactor
 * 3. Absolute amount -- rejects set_budget/reallocate_budget proposals exceeding limits
 * 4. Approval threshold -- routes proposals above requireApprovalAbove to pending
 *
 * @param proposals - Scored action proposals to evaluate
 * @param guardrails - Guardrail configuration
 * @param currentMetrics - Current campaign metrics (for budget comparison)
 * @returns Object with approved proposals and pending actions requiring approval
 */
export function applyGuardrails(
	proposals: ActionProposal[],
	guardrails: GuardrailConfig,
	currentMetrics: CampaignMetrics[],
): GuardrailResult {
	/* Build a map of current daily budgets by campaign ID.
	 * dailyBudget comes from the campaign snapshot. We deliberately do NOT
	 * fall back to spend, because for newly-launched or under-pacing
	 * campaigns spend << budget, and the scale-factor check would then
	 * reject every reasonable proposed budget as "exceeds maxScaleFactor". */
	const currentBudgetByCampaign = new Map<string, number>();
	for (const metric of currentMetrics) {
		if (typeof metric.dailyBudget === "number") {
			currentBudgetByCampaign.set(metric.campaignId, metric.dailyBudget);
		}
	}

	/** Budget-modifying tool names */
	const budgetModifyingTools = new Set([
		"set_budget",
		"scale_campaign",
		"reallocate_budget",
		"optimize_bids",
	]);

	const approved: ActionProposal[] = [];
	const pending: PendingAction[] = [];
	let pendingCounter = 0;

	for (const proposal of proposals) {
		/* Non-budget tools pass through immediately */
		if (!budgetModifyingTools.has(proposal.toolName)) {
			approved.push(proposal);
			continue;
		}

		const campaignId = proposal.params.campaignId as string | undefined;
		/* `currentBudget` is undefined when we have no live snapshot for this
		 * campaign (typical first tick or a brand-new campaign). The scale-
		 * factor check below skips when currentBudget is unknown so we don't
		 * spuriously reject the proposal. */
		const currentBudget = campaignId ? currentBudgetByCampaign.get(campaignId) : undefined;

		/* --- Tool-specific guardrail checks --- */

		/* scale_campaign: enforce scaleFactor <= maxBudgetScaleFactor */
		if (proposal.toolName === "scale_campaign" && proposal.params.scaleFactor !== undefined) {
			const sf = Number(proposal.params.scaleFactor);
			if (sf > guardrails.maxBudgetScaleFactor) {
				/* Hard reject -- scale factor too high */
				continue;
			}
		}

		/* Compute the proposed new budget based on tool type */
		let newBudget: number | undefined;

		if (proposal.params.dailyBudget !== undefined) {
			newBudget = Number(proposal.params.dailyBudget);
		} else if (proposal.params.scaleFactor !== undefined && currentBudget !== undefined) {
			newBudget = currentBudget * Number(proposal.params.scaleFactor);
		} else if (proposal.params.amount !== undefined && currentBudget !== undefined) {
			/* reallocate_budget uses amount */
			newBudget = currentBudget + Number(proposal.params.amount);
		}

		/* If we could not determine a new budget value, allow the action */
		if (newBudget === undefined) {
			approved.push(proposal);
			continue;
		}

		/* Check budget floor */
		if (newBudget < guardrails.minDailyBudget) {
			/* Hard reject -- below minimum */
			continue;
		}

		/* Check scale factor against current budget (not spend). Skip when
		 * we don't have a live current budget snapshot to compare against. */
		if (currentBudget !== undefined && currentBudget > 0) {
			const effectiveScaleFactor = newBudget / currentBudget;
			if (effectiveScaleFactor > guardrails.maxBudgetScaleFactor) {
				/* Hard reject -- effective scale factor exceeds limit */
				continue;
			}
		}

		/* Check approval threshold -- route to pending instead of rejecting */
		if (newBudget > guardrails.requireApprovalAbove) {
			pendingCounter++;
			pending.push({
				id: `pending_${Date.now()}_${pendingCounter}`,
				toolName: proposal.toolName,
				params: proposal.params,
				reason:
					`Proposed budget $${newBudget.toFixed(2)} exceeds approval threshold ` +
					`$${guardrails.requireApprovalAbove.toFixed(2)}. ` +
					`Reasoning: ${proposal.reasoning}`,
				createdAt: new Date().toISOString(),
			});
			continue;
		}

		approved.push(proposal);
	}

	return { approved, pending };
}

/**
 * Result of running the full decision pipeline.
 *
 * Surfaces both approved proposals (safe to execute) and pending
 * proposals (require human approval). Callers MUST forward `pending`
 * to the audit log/dashboard so operators can see what the agent
 * wanted to do.
 */
export interface DecisionResult {
	readonly approved: ActionProposal[];
	readonly pending: PendingAction[];
}

/**
 * Main decision engine entry point.
 *
 * Parses LLM reasoning to extract proposed actions, scores each one,
 * applies guardrail filters, enforces the max-actions-per-cycle limit,
 * and returns a ranked list of safe actions ready for execution along
 * with any actions that require human approval.
 *
 * Backwards-compat: callers that previously got an `ActionProposal[]`
 * should switch to `proposeActionsFull` or destructure the
 * `.approved` field below.
 *
 * @param metrics - Current campaign performance metrics
 * @param goals - Agent optimization goals
 * @param availableTools - Tools the agent can invoke
 * @param llmReasoning - Raw LLM reasoning output containing proposed actions
 * @param guardrails - Optional guardrail overrides (uses defaults if omitted)
 * @returns Ranked array of safe, scored ActionProposals (highest score first)
 */
export function proposeActions(
	metrics: CampaignMetrics[],
	goals: AgentGoal,
	availableTools: Tool<TObject>[],
	llmReasoning: string,
	guardrails?: Partial<GuardrailConfig>,
): ActionProposal[] {
	return proposeActionsFull(metrics, goals, availableTools, llmReasoning, guardrails).approved;
}

/**
 * Full-result variant of {@link proposeActions} that exposes both approved
 * and pending proposals. Prefer this over `proposeActions` so pending
 * actions can be surfaced to operators.
 */
export function proposeActionsFull(
	metrics: CampaignMetrics[],
	_goals: AgentGoal,
	availableTools: Tool<TObject>[],
	llmReasoning: string,
	guardrails?: Partial<GuardrailConfig>,
): DecisionResult {
	const effectiveGuardrails: GuardrailConfig = {
		...DEFAULT_GUARDRAILS,
		...guardrails,
	};

	const rawActions = parseActions(llmReasoning, availableTools);
	if (rawActions.length === 0) {
		return { approved: [], pending: [] };
	}

	const ranked = rankProposals(rawActions);
	const { approved, pending } = applyGuardrails(ranked, effectiveGuardrails, metrics);
	return {
		approved: approved.slice(0, effectiveGuardrails.maxActionsPerCycle),
		pending,
	};
}
