/**
 * Overview page — the main dashboard view.
 *
 * Displays agent status, key performance metrics, spend and ROAS
 * charts, control buttons, and the 5 most recent decisions.
 */

import type React from "react";
import { ControlButtons } from "../components/agent/ControlButtons";
import { DecisionCard } from "../components/agent/DecisionCard";
import { DecisionImpactCard } from "../components/agent/DecisionImpactCard";
import { StatusBadge } from "../components/agent/StatusBadge";
import { MetricsGrid } from "../components/charts/MetricsGrid";
import { ROASChart } from "../components/charts/ROASChart";
import { SpendChart } from "../components/charts/SpendChart";
import { useAgentStatus } from "../hooks/useAgentStatus";
import { useDecisions } from "../hooks/useDecisions";
import { formatRange, rangeToIso, useDateRange } from "../lib/date-range";

/**
 * Main dashboard overview page.
 *
 * Polls for agent status every 10 seconds and renders a comprehensive
 * view of the agent's current state, performance, and recent activity.
 */
export function Overview(): React.ReactElement {
	const { range } = useDateRange();
	const iso = rangeToIso(range);
	const { status, loading: statusLoading, error: statusError } = useAgentStatus();
	/* Single fetch covers both the impact card (needs the full window
	 * to compute aggregate counts) and the recent-decisions list
	 * (slices to the most recent 5). 200 is enough headroom for any
	 * reasonable window without cluttering the wire — we wouldn't
	 * render more than that anywhere on this page. */
	const { decisions, loading: decisionsLoading } = useDecisions({
		limit: 200,
		startDate: iso.startDate,
		endDate: iso.endDate,
	});
	const recentDecisions = decisions.slice(0, 5);

	if (statusLoading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
			</div>
		);
	}

	if (statusError) {
		return (
			<div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
				<h3 className="font-semibold">Connection Error</h3>
				<p className="text-sm mt-1">{statusError}</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header row: status + controls */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-4">
					<h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
					{status && <StatusBadge state={status.state} uptime={status.uptime} />}
					<span className="text-sm text-gray-500">{formatRange(range)}</span>
				</div>
				{status && <ControlButtons currentState={status.state} />}
			</div>

			{/* Key metrics */}
			<MetricsGrid />

			{/* Decision impact — how the agent's recent activity actually
			 * moved performance vs operator intent. Goal-aware coloring
			 * from PR #39 underpins the bucketing. */}
			<DecisionImpactCard
				decisions={decisions}
				loading={decisionsLoading}
				rangeLabel={formatRange(range)}
			/>

			{/* Charts row */}
			<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
				<div className="bg-white rounded-lg border border-gray-200 p-4">
					<h2 className="text-lg font-semibold text-gray-900 mb-4">Daily Spend (30d)</h2>
					<SpendChart />
				</div>
				<div className="bg-white rounded-lg border border-gray-200 p-4">
					<h2 className="text-lg font-semibold text-gray-900 mb-4">ROAS Trend (30d)</h2>
					<ROASChart />
				</div>
			</div>

			{/* Recent decisions */}
			<div className="bg-white rounded-lg border border-gray-200 p-4">
				<h2 className="text-lg font-semibold text-gray-900 mb-4">Recent Decisions</h2>
				{decisionsLoading ? (
					<p className="text-gray-500 text-sm">Loading decisions...</p>
				) : recentDecisions.length === 0 ? (
					<p className="text-gray-500 text-sm">No decisions recorded yet.</p>
				) : (
					<div className="space-y-3">
						{recentDecisions.map((decision) => (
							<DecisionCard key={decision.id} decision={decision} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}
