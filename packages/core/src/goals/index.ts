/**
 * @module goals
 *
 * Public API for per-campaign goal management.
 *
 * The agent reads goals from this module to decide which campaigns
 * are actionable and what KPI to optimize each one for. Operators
 * write goals via the `meta-ads-agent guidance` CLI or the dashboard.
 */

export type {
	CampaignGoal,
	CampaignGoalInput,
	KpiDirection,
	PendingGuidance,
	PendingGuidanceReason,
	PrimaryKpi,
	SecondaryKpi,
} from "./types.js";
export { CampaignGoalRepository } from "./repository.js";
export { inferDefaultKpi, KNOWN_OBJECTIVES } from "./defaults.js";
export type { DefaultGoal } from "./defaults.js";
