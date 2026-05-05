/**
 * DecisionImpactCard — Overview-page summary of how the agent's
 * recent graded decisions actually moved performance vs operator
 * intent.
 *
 * Counts every graded decision in the current date range and buckets
 * each row by whether its primary KPI delta was favorable,
 * unfavorable, or neutral. "Primary KPI" is the row's `goalContext.primaryKpi`
 * when present, else `roas` as a sensible default. "Favorable"
 * combines the metric's sign with the goal's direction (or the
 * intuitive default direction when no goal is set):
 *
 *   metric direction = "higher" favorable, delta > 0  -> favorable
 *   metric direction = "lower"  favorable, delta < 0  -> favorable
 *   delta = 0                                          -> neutral
 *   metric direction = "neutral"                       -> neutral
 *
 * Pre-this-PR the Overview page only showed the 5 most recent
 * decisions. Operators couldn't tell at a glance whether the agent's
 * recent activity was working — this card answers that.
 */

import type React from "react";
import { type AuditRecord, decisionDelta, favorableDirection, isGraded } from "../../api/client";

interface ImpactSummary {
	graded: number;
	ungraded: number;
	favorable: number;
	unfavorable: number;
	neutral: number;
	failed: number;
}

/**
 * Compute the impact summary across a list of decisions. Pure function;
 * exported for testability when the dashboard tests harness lands.
 */
export function summarizeDecisionImpact(decisions: AuditRecord[]): ImpactSummary {
	const summary: ImpactSummary = {
		graded: 0,
		ungraded: 0,
		favorable: 0,
		unfavorable: 0,
		neutral: 0,
		failed: 0,
	};

	for (const d of decisions) {
		/* `_pending_guidance` and other synthetic rows aren't real
		 * actions, exclude from the impact count. */
		if (d.toolName.startsWith("_")) continue;
		if (d.success === false) {
			summary.failed++;
			continue;
		}
		if (!isGraded(d)) {
			summary.ungraded++;
			continue;
		}
		summary.graded++;

		/* Pick the KPI to measure against. The campaign's goal wins
		 * when present; ROAS is the default for un-goaled campaigns
		 * because it's the metric most operators care about and the
		 * one the legacy AgentGoal tracked. */
		const kpi = d.goalContext?.primaryKpi ?? "roas";
		const delta = decisionDelta(d);
		if (!delta) {
			/* Should not happen if isGraded() returned true and the
			 * backfill engine ran successfully. Defensive fallback. */
			summary.neutral++;
			continue;
		}

		/* Pull the numeric value for the chosen KPI. The
		 * `performanceDelta` shape mirrors `core/audit/backfill.ts:diffSnapshots`
		 * which has only the seven numeric fields below; if the goal's
		 * primaryKpi isn't one of them (e.g. `frequency` on a fresh
		 * campaign), we have no value and treat as neutral. */
		const numericKey: Record<string, keyof typeof delta> = {
			roas: "roas",
			cpa: "cpa",
			cpl: "cpa" /* schema records cpa, used as a proxy for cpl */,
			cpc: "cpa" /* same fallback */,
			ctr: "ctr",
			cpm: "spend" /* no direct cpm in the diff; fall back to spend direction */,
			cpi: "cpa",
			spend: "spend",
		};
		const key = numericKey[kpi];
		if (!key) {
			summary.neutral++;
			continue;
		}
		const value = delta[key];
		if (typeof value !== "number" || value === 0) {
			summary.neutral++;
			continue;
		}

		const dir = favorableDirection(kpi, d.goalContext);
		if (dir === "neutral") {
			summary.neutral++;
			continue;
		}
		const signFavorable = dir === "higher" ? value > 0 : value < 0;
		if (signFavorable) summary.favorable++;
		else summary.unfavorable++;
	}

	return summary;
}

/**
 * The Overview-page impact card.
 *
 * Intentionally minimal visual chrome: this is dashboard-secondary
 * data, not the primary spend/ROAS chart. Two-line layout:
 *
 *   Recent Decision Impact (Nd)
 *   ▲ 8 favorable   ▼ 3 unfavorable   – 1 neutral   ⊘ 2 ungraded
 *
 * Failed and synthetic (`_pending_*`) decisions are excluded from
 * counts — they're not "agent moves that did/didn't work."
 */
export function DecisionImpactCard({
	decisions,
	loading,
	rangeLabel,
}: {
	decisions: AuditRecord[];
	loading: boolean;
	rangeLabel: string;
}): React.ReactElement {
	const summary = summarizeDecisionImpact(decisions);
	const totalActioned = summary.favorable + summary.unfavorable + summary.neutral;
	const favorablePct =
		totalActioned > 0 ? Math.round((summary.favorable / totalActioned) * 100) : 0;

	return (
		<div className="bg-white rounded-lg border border-gray-200 p-4">
			<div className="flex items-center justify-between mb-3">
				<h2 className="text-sm font-semibold text-gray-900">
					Decision Impact <span className="text-gray-400 font-normal">({rangeLabel})</span>
				</h2>
				{loading && <span className="text-xs text-gray-400">Loading…</span>}
			</div>

			{summary.graded === 0 && summary.ungraded === 0 && summary.failed === 0 ? (
				<p className="text-sm text-gray-500">
					No agent decisions in this window yet. The agent's actions will be summarized here once it
					starts ticking.
				</p>
			) : (
				<>
					<div className="flex items-baseline gap-2 mb-3">
						<span className="text-2xl font-bold text-gray-900">{summary.graded}</span>
						<span className="text-sm text-gray-500">
							graded
							{totalActioned > 0 && (
								<>
									{" • "}
									<span className="text-green-700 font-medium">{favorablePct}%</span> favorable
								</>
							)}
						</span>
					</div>

					<div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
						<ImpactBucket
							icon="\u25b2"
							iconColor="text-green-600"
							label="Favorable"
							count={summary.favorable}
							tooltip="Primary KPI moved in the favorable direction (per campaign goal or intuitive default)."
						/>
						<ImpactBucket
							icon="\u25bc"
							iconColor="text-red-600"
							label="Unfavorable"
							count={summary.unfavorable}
							tooltip="Primary KPI moved against the favorable direction."
						/>
						<ImpactBucket
							icon="\u2014"
							iconColor="text-gray-400"
							label="No change"
							count={summary.neutral}
							tooltip="Primary KPI flat or no clear favorable direction."
						/>
						<ImpactBucket
							icon="\u2298"
							iconColor="text-gray-400"
							label="Ungraded"
							count={summary.ungraded}
							tooltip="Decision hasn't been backfilled yet (or campaign went silent on the next tick)."
						/>
					</div>

					{summary.failed > 0 && (
						<p className="text-xs text-gray-400 mt-3">
							{summary.failed} failed decision{summary.failed === 1 ? "" : "s"} excluded.
						</p>
					)}
				</>
			)}
		</div>
	);
}

function ImpactBucket({
	icon,
	iconColor,
	label,
	count,
	tooltip,
}: {
	icon: string;
	iconColor: string;
	label: string;
	count: number;
	tooltip: string;
}): React.ReactElement {
	return (
		<div title={tooltip} className="flex flex-col">
			<div className="flex items-baseline gap-1.5">
				<span className={`${iconColor} text-base leading-none`}>{icon}</span>
				<span className="text-lg font-semibold text-gray-900">{count}</span>
			</div>
			<span className="text-xs text-gray-500 mt-0.5">{label}</span>
		</div>
	);
}
