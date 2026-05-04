/**
 * @module goals/defaults
 *
 * Per-objective default suggestions for the goal-configuration UX.
 *
 * Used by:
 *   - The `init` wizard, when prompting the operator for goals on
 *     existing campaigns. The operator can hit Enter to accept the
 *     default or override.
 *   - The `meta-ads-agent guidance` CLI, same flow for newly-detected
 *     campaigns.
 *   - The dashboard's (future) goal-edit form, as the placeholder values.
 *
 * These are NOT applied automatically. The agent will not act on a
 * campaign without an explicit goal stored in `campaign_goals` --
 * defaults exist purely to make the configuration UX one-Enter-key
 * friendly for the typical case.
 */
import type { KpiDirection, PrimaryKpi } from "./types.js";

/**
 * Default goal shape for a Meta campaign objective.
 */
export interface DefaultGoal {
	readonly primaryKpi: PrimaryKpi;
	readonly primaryKpiTarget: number;
	readonly primaryKpiDirection: KpiDirection;
	/**
	 * Human-readable prompt fragment. The wizard interpolates this
	 * into "Target ROAS? [default 3.0]" style prompts.
	 */
	readonly promptLabel: string;
	/**
	 * Currency-prefixed format for display (true => prefix `$`).
	 * E.g. CPA, CPL, CPC, CPM are dollar values; ROAS, CTR, frequency are not.
	 */
	readonly currency: boolean;
}

/**
 * Default suggestions per Meta objective. Values are conservative
 * placeholders, chosen to be safe for an operator who hits Enter
 * without thinking. Never used as live targets unless explicitly
 * confirmed by the operator and persisted.
 */
const DEFAULTS_BY_OBJECTIVE: Record<string, DefaultGoal> = {
	OUTCOME_SALES: {
		primaryKpi: "roas",
		primaryKpiTarget: 3.0,
		primaryKpiDirection: "maximize",
		promptLabel: "Target ROAS",
		currency: false,
	},
	OUTCOME_LEADS: {
		primaryKpi: "cpl",
		primaryKpiTarget: 25,
		primaryKpiDirection: "minimize",
		promptLabel: "Max cost per lead",
		currency: true,
	},
	OUTCOME_TRAFFIC: {
		primaryKpi: "cpc",
		primaryKpiTarget: 1.0,
		primaryKpiDirection: "minimize",
		promptLabel: "Max cost per click",
		currency: true,
	},
	OUTCOME_ENGAGEMENT: {
		primaryKpi: "cost_per_thruplay",
		primaryKpiTarget: 0.05,
		primaryKpiDirection: "minimize",
		promptLabel: "Max cost per ThruPlay",
		currency: true,
	},
	OUTCOME_AWARENESS: {
		primaryKpi: "cpm",
		primaryKpiTarget: 15,
		primaryKpiDirection: "minimize",
		promptLabel: "Max CPM",
		currency: true,
	},
	OUTCOME_APP_PROMOTION: {
		primaryKpi: "cpi",
		primaryKpiTarget: 3.0,
		primaryKpiDirection: "minimize",
		promptLabel: "Max cost per install",
		currency: true,
	},
};

/**
 * Universal fallback when an objective is unrecognized (e.g. a new
 * Meta objective added in a future API version that we haven't mapped
 * here yet). Conservative: maximize CTR with a 1% target. The wizard
 * always shows the operator the inferred default for them to sanity-check.
 */
const UNKNOWN_OBJECTIVE_DEFAULT: DefaultGoal = {
	primaryKpi: "ctr",
	primaryKpiTarget: 0.01,
	primaryKpiDirection: "maximize",
	promptLabel: "Target click-through rate (decimal, e.g. 0.01 = 1%)",
	currency: false,
};

/**
 * Returns a sensible default goal for a Meta objective. Callers should
 * always show the result to the operator for confirmation rather than
 * applying it silently.
 *
 * @param objective - Meta objective string (e.g. "OUTCOME_SALES").
 *   Case-insensitive; unknown values fall back to a generic default.
 */
export function inferDefaultKpi(objective: string | undefined | null): DefaultGoal {
	if (!objective) return UNKNOWN_OBJECTIVE_DEFAULT;
	const upper = objective.toUpperCase();
	return DEFAULTS_BY_OBJECTIVE[upper] ?? UNKNOWN_OBJECTIVE_DEFAULT;
}

/** All objectives the default map currently knows about. Useful for tests. */
export const KNOWN_OBJECTIVES = Object.keys(DEFAULTS_BY_OBJECTIVE);
