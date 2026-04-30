/**
 * @module decisions/types
 * Types for the decision engine — action proposals, scoring, and guardrails.
 *
 * The decision engine sits between the LLM's reasoning output and the tool
 * executor. It parses, scores, filters, and ranks proposed actions to ensure
 * safe, effective campaign optimization.
 */

/**
 * A scored action proposal ready for ranking and execution.
 *
 * Produced by the decision engine after parsing LLM reasoning,
 * computing a composite score, and assigning a risk level.
 */
export interface ActionProposal {
	/** Name of the tool to invoke (must match a registered tool name) */
	readonly toolName: string;

	/** Parameters to pass to the tool's execute function */
	readonly params: Record<string, unknown>;

	/** Human-readable explanation of why this action was proposed */
	readonly reasoning: string;

	/** Composite score: (expectedImpact * confidence) / (risk + 0.1) */
	readonly score: number;

	/** Risk classification based on action type and magnitude */
	readonly riskLevel: "low" | "medium" | "high";

	/** Description of what the agent expects to happen after execution */
	readonly expectedOutcome: string;
}

/**
 * Safety guardrails that constrain the decision engine's output.
 *
 * These limits prevent the agent from making overly aggressive changes
 * and ensure human oversight for high-impact decisions.
 */
export interface GuardrailConfig {
	/** Minimum daily budget — the agent will never reduce below this (default: $5) */
	readonly minDailyBudget: number;

	/** Maximum budget scale factor per cycle — caps how fast budgets can grow (default: 2.0x) */
	readonly maxBudgetScaleFactor: number;

	/** Maximum number of actions the agent can take per OODA cycle (default: 5) */
	readonly maxActionsPerCycle: number;

	/** Budget change threshold above which human approval is required (default: $1000) */
	readonly requireApprovalAbove: number;
}

/**
 * Default guardrail values used when no custom config is provided.
 */
export const DEFAULT_GUARDRAILS: GuardrailConfig = {
	minDailyBudget: 5,
	maxBudgetScaleFactor: 2.0,
	maxActionsPerCycle: 5,
	requireApprovalAbove: 1000,
};

/**
 * Raw action extracted from LLM reasoning before scoring.
 * This is the intermediate format between LLM output parsing and scoring.
 */
export interface RawProposedAction {
	/** Name of the tool to invoke */
	readonly toolName: string;

	/** Parameters for the tool */
	readonly params: Record<string, unknown>;

	/** LLM's reasoning for this action */
	readonly reasoning: string;

	/** Expected outcome description */
	readonly expectedOutcome: string;

	/** LLM's confidence in this action (0.0 to 1.0) */
	readonly confidence: number;

	/** LLM's estimate of the action's impact (0.0 to 1.0) */
	readonly expectedImpact: number;

	/** Risk classification */
	readonly riskLevel: "low" | "medium" | "high";
}
