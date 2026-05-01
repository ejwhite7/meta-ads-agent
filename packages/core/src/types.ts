/**
 * @module types
 * Core shared types for the meta-ads-agent system.
 *
 * These types form the foundation of the agent's data model and are used
 * across all modules — agent loop, decision engine, tools, and persistence.
 */

/**
 * Goal configuration that drives the agent's optimization decisions.
 * Each ad account has exactly one active goal config at any time.
 */
export interface AgentGoal {
	/** Target return on ad spend (e.g., 3.0 means $3 revenue per $1 spent) */
	readonly roasTarget: number;

	/** Maximum acceptable cost per acquisition in account currency */
	readonly cpaCap: number;

	/** Maximum daily budget the agent is allowed to allocate across all campaigns */
	readonly dailyBudgetLimit: number;

	/** Risk tolerance level that influences the decision engine's scoring */
	readonly riskLevel: "conservative" | "moderate" | "aggressive";
}

/**
 * A snapshot of campaign performance metrics at a specific point in time.
 * Fetched from Meta Insights API and stored in the campaign_snapshots table.
 */
export interface CampaignMetrics {
	/** Meta campaign ID (e.g., "23851234567890123") */
	readonly campaignId: string;

	/** Total number of times the ad was shown */
	readonly impressions: number;

	/** Total number of clicks on the ad */
	readonly clicks: number;

	/** Total amount spent in account currency */
	readonly spend: number;

	/** Total number of conversion events */
	readonly conversions: number;

	/** Return on ad spend (revenue / spend) */
	readonly roas: number;

	/** Cost per acquisition (spend / conversions) */
	readonly cpa: number;

	/** Click-through rate as a decimal (clicks / impressions) */
	readonly ctr: number;

	/** ISO 8601 date string for this metrics snapshot (e.g., "2024-01-15") */
	readonly date: string;

	/**
	 * Current daily budget in account currency, when known. Populated by
	 * `fetchMetrics` so the decision engine can compare proposed budgets
	 * to the live setting (rather than falling back to spend, which under-
	 * paces every newly-launched campaign).
	 */
	readonly dailyBudget?: number;
}

/**
 * An action that the agent has decided to take, ready for tool execution.
 * Produced by the decision engine after scoring and ranking proposals.
 */
export interface AgentAction {
	/** Name of the tool to invoke (must match a registered tool name) */
	readonly toolName: string;

	/** Parameters to pass to the tool's execute function */
	readonly params: Record<string, unknown>;

	/** Human-readable explanation of why this action was chosen */
	readonly reasoning: string;

	/** Description of the expected outcome if this action succeeds */
	readonly expectedImpact: string;
}

/**
 * Raw insights data returned from the Meta Ads API for a campaign.
 */
export interface CampaignInsights {
	impressions: string;
	clicks: string;
	spend: string;
	cpc: string;
	cpm: string;
	ctr: string;
	reach: string;
	conversions: string;
	conversion_rate: string;
	roas: string;
	date_start: string;
	date_stop: string;
	[key: string]: unknown;
}

/**
 * Represents a pending action that requires confirmation before execution.
 */
export interface PendingAction {
	/** Unique ID for the pending action */
	readonly id: string;
	/** Name of the tool that created this pending action */
	readonly toolName: string;
	/** Parameters for the pending action */
	readonly params: Record<string, unknown>;
	/** Reason/description for requiring approval */
	readonly reason: string;
	/** ISO timestamp when the action was created */
	readonly createdAt: string;
	/** Allow additional properties */
	[key: string]: unknown;
}
