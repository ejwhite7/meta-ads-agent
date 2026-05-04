/**
 * @module goals/types
 *
 * Per-campaign goal configuration.
 *
 * Each campaign the agent manages must have an explicit goal saying
 * what to optimize for and the target. Without a goal, the agent
 * deliberately refuses to make decisions on the campaign and surfaces
 * it via a `_pending_guidance` audit record (see agent/session.ts).
 *
 * Why per-campaign rather than per-objective?
 *   The same Meta objective covers wildly different real-world
 *   intents. A `OUTCOME_SALES` campaign for a high-margin product
 *   might target ROAS 5.0 with a $200/day budget; another sales
 *   campaign on the same account might be a clearance push targeting
 *   ROAS 1.5 with no daily cap. Per-campaign config gives operators
 *   that flexibility without forcing them into one-size-fits-all
 *   per-objective rules.
 */

/**
 * Primary KPI a campaign is being optimized for. The vocabulary is
 * fixed so the decision engine and analyzers can dispatch on it.
 *
 * Adding a new KPI requires updating four places:
 *   1. This union.
 *   2. The default-KPI map in goals/defaults.ts (so init/guidance
 *      can suggest it for an objective).
 *   3. The metric extractor in agent/loop.ts (or wherever the LLM
 *      prompt is composed) so the LLM sees the right value.
 *   4. The analyzer (campaign/analyze-performance.ts) so the
 *      "vs target" status is computed correctly.
 */
export type PrimaryKpi =
	| "roas" /* return on ad spend (revenue / spend); higher is better */
	| "cpa" /* cost per acquisition (spend / conversions); lower is better */
	| "cpl" /* cost per lead (spend / leads); lower is better */
	| "cpc" /* cost per click; lower is better */
	| "ctr" /* click-through rate; higher is better */
	| "cpm" /* cost per 1000 impressions; lower is better */
	| "cpi" /* cost per app install; lower is better */
	| "cost_per_thruplay" /* video; lower is better */
	| "thruplay_rate" /* video; higher is better */
	| "frequency" /* awareness; lower is better (avoid saturation) */
	| "reach"; /* awareness; higher is better */

/**
 * Whether higher or lower values of the primary KPI are better.
 * Defaulted in `inferDefaultKpi`; the operator can override when the
 * meaning is contextual (e.g. an awareness campaign measured on lift
 * studies might want to maximize `frequency` rather than minimize it).
 */
export type KpiDirection = "maximize" | "minimize";

/**
 * Optional secondary KPI tracked alongside the primary one.
 * Surfaced in the LLM prompt as informational context but does NOT
 * drive scoring -- secondary KPIs are observational.
 */
export interface SecondaryKpi {
	readonly kpi: PrimaryKpi;
	readonly target?: number;
	readonly direction?: KpiDirection;
}

/**
 * Per-campaign goal as stored in the `campaign_goals` table.
 *
 * `dbId` is the auto-increment surrogate key from the table. The
 * logical identity is `(adAccountId, campaignId)` -- there can be
 * many rows for that pair across history; the active one is the
 * most-recent row with `deletedAt === null`.
 */
export interface CampaignGoal {
	readonly dbId: number;
	readonly adAccountId: string;
	readonly campaignId: string;

	readonly primaryKpi: PrimaryKpi;
	readonly primaryKpiTarget: number;
	readonly primaryKpiDirection: KpiDirection;

	readonly secondaryKpis: SecondaryKpi[];

	/* Per-campaign overrides for account-wide guardrails. NULL = inherit. */
	readonly minDailyBudget: number | null;
	readonly maxBudgetScaleFactor: number | null;
	readonly requireApprovalAbove: number | null;

	/**
	 * Meta objective that was current when this goal was configured.
	 * If a future tick sees a different objective on the campaign,
	 * the agent re-prompts (see agent/session.ts).
	 */
	readonly lastSeenObjective: string;

	readonly configuredAt: string /* ISO 8601 */;
	readonly configuredBy: string /* 'init-wizard' | 'guidance-cmd' | 'dashboard' | 'api' */;
	readonly notes: string | null;

	/** Soft-delete marker. Active goals have `deletedAt === null`. */
	readonly deletedAt: string | null;
}

/**
 * Input shape for creating or updating a goal. Excludes
 * server-assigned fields (`dbId`, `configuredAt`, `deletedAt`).
 */
export interface CampaignGoalInput {
	readonly adAccountId: string;
	readonly campaignId: string;
	readonly primaryKpi: PrimaryKpi;
	readonly primaryKpiTarget: number;
	readonly primaryKpiDirection: KpiDirection;
	readonly secondaryKpis?: SecondaryKpi[];
	readonly minDailyBudget?: number;
	readonly maxBudgetScaleFactor?: number;
	readonly requireApprovalAbove?: number;
	readonly lastSeenObjective: string;
	readonly configuredBy: string;
	readonly notes?: string;
}

/**
 * Why a campaign is currently un-actionable from the agent's perspective.
 * Surfaced in the audit log via `_pending_guidance` records and to
 * operators via the `meta-ads-agent guidance` CLI.
 */
export type PendingGuidanceReason =
	| "no_goal_configured"
	| "objective_changed"
	| "goal_explicitly_reset";

/**
 * A campaign that needs operator attention before the agent will act on it.
 */
export interface PendingGuidance {
	readonly campaignId: string;
	readonly campaignName: string;
	readonly currentObjective: string;
	readonly status: string;
	readonly dailyBudget: number | null;
	readonly reason: PendingGuidanceReason;
	/** Populated when reason === 'objective_changed'. */
	readonly previousObjective?: string;
	/** Populated when reason === 'goal_explicitly_reset'. */
	readonly previousGoalDbId?: number;
}
