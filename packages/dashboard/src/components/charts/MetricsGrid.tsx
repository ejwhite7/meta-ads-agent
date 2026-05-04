/**
 * Metrics grid component.
 *
 * Four key performance cards: Total Spend, Avg ROAS, Avg CPA,
 * Total Conversions. Each card shows the current 7-day value and a
 * trend delta vs the prior 7-day window.
 *
 * Data comes from `GET /api/metrics/summary`, which calls
 * MetaClient.insights at `level: "account"` for both windows. Pre-PR
 * #29 these cards rendered hardcoded zeros from a local placeholder
 * literal and never made an API call.
 */

import type React from "react";
import { useMetricsSummary } from "../../hooks/useMetrics";
import { cn } from "../../lib/utils";

interface MetricCardData {
	label: string;
	value: string;
	changePercent: number;
	/** True if a positive delta is good (spend trending up is bad; ROAS up is good). */
	positiveIsGood: boolean;
}

function MetricCard({ metric }: { metric: MetricCardData }): React.ReactElement {
	const isPositive = metric.changePercent >= 0;
	const isGood = isPositive === metric.positiveIsGood;

	return (
		<div className="bg-white rounded-lg border border-gray-200 p-4">
			<p className="text-sm text-gray-500">{metric.label}</p>
			<p className="text-2xl font-bold text-gray-900 mt-1">{metric.value}</p>
			<div className="flex items-center gap-1 mt-2">
				<span
					className={cn("text-sm font-medium", {
						"text-green-600": isGood && metric.changePercent !== 0,
						"text-red-600": !isGood && metric.changePercent !== 0,
						"text-gray-400": metric.changePercent === 0,
					})}
				>
					{metric.changePercent === 0
						? "--"
						: `${isPositive ? "+" : ""}${metric.changePercent.toFixed(1)}%`}
				</span>
				{metric.changePercent !== 0 && (
					<span
						className={cn("text-sm", {
							"text-green-600": isGood,
							"text-red-600": !isGood,
						})}
					>
						{isPositive ? "↑" : "↓"}
					</span>
				)}
				<span className="text-xs text-gray-400 ml-1">vs prior 7d</span>
			</div>
		</div>
	);
}

/**
 * Skeleton shimmer shown while the summary is loading.
 */
function SkeletonCard(): React.ReactElement {
	return (
		<div className="bg-white rounded-lg border border-gray-200 p-4 animate-pulse">
			<div className="h-4 bg-gray-200 rounded w-2/3 mb-3" />
			<div className="h-7 bg-gray-200 rounded w-1/2 mb-3" />
			<div className="h-3 bg-gray-100 rounded w-1/3" />
		</div>
	);
}

/**
 * Four-card metrics grid pulling live account-level Insights.
 */
export function MetricsGrid(): React.ReactElement {
	const { data, loading, error } = useMetricsSummary(7);

	if (loading) {
		return (
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
				<SkeletonCard />
				<SkeletonCard />
				<SkeletonCard />
				<SkeletonCard />
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
				Metrics unavailable: {error ?? "no data returned"}.{" "}
				<span className="text-xs">
					(If the access token is invalid, run <code>meta-ads-agent init</code>.)
				</span>
			</div>
		);
	}

	const { current, delta } = data;

	const cards: MetricCardData[] = [
		{
			label: "Total Spend (7d)",
			value: `$${current.spend.toFixed(2)}`,
			changePercent: delta.spendPct,
			/* Spending more is not inherently "good" — flagging it red helps
			 * the operator notice a runaway. The agent's job is to scale
			 * deliberately, not silently. */
			positiveIsGood: false,
		},
		{
			label: "Avg ROAS (7d)",
			value: current.roas.toFixed(2),
			changePercent: delta.roasPct,
			positiveIsGood: true,
		},
		{
			label: "Avg CPA (7d)",
			value: `$${current.cpa.toFixed(2)}`,
			changePercent: delta.cpaPct,
			positiveIsGood: false,
		},
		{
			label: "Total Conversions (7d)",
			value: current.conversions.toLocaleString(),
			changePercent: delta.conversionsPct,
			positiveIsGood: true,
		},
	];

	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
			{cards.map((metric) => (
				<MetricCard key={metric.label} metric={metric} />
			))}
		</div>
	);
}
