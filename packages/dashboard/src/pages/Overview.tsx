/**
 * Overview page — the main dashboard view.
 *
 * Displays agent status, key performance metrics, spend and ROAS
 * charts, control buttons, and the 5 most recent decisions.
 */

import type React from "react";
import { ControlButtons } from "../components/agent/ControlButtons";
import { DecisionCard } from "../components/agent/DecisionCard";
import { StatusBadge } from "../components/agent/StatusBadge";
import { MetricsGrid } from "../components/charts/MetricsGrid";
import { ROASChart } from "../components/charts/ROASChart";
import { SpendChart } from "../components/charts/SpendChart";
import { useAgentStatus } from "../hooks/useAgentStatus";
import { useDecisions } from "../hooks/useDecisions";

/**
 * Main dashboard overview page.
 *
 * Polls for agent status every 10 seconds and renders a comprehensive
 * view of the agent's current state, performance, and recent activity.
 */
export function Overview(): React.ReactElement {
	const { status, loading: statusLoading, error: statusError } = useAgentStatus();
	const { decisions, loading: decisionsLoading } = useDecisions({ limit: 5 });

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
				</div>
				{status && <ControlButtons currentState={status.state} />}
			</div>

			{/* Key metrics */}
			<MetricsGrid />

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
				) : decisions.length === 0 ? (
					<p className="text-gray-500 text-sm">No decisions recorded yet.</p>
				) : (
					<div className="space-y-3">
						{decisions.map((decision) => (
							<DecisionCard key={decision.id} decision={decision} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}
