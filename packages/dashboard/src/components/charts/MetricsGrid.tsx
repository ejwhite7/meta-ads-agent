/**
 * Metrics grid component.
 *
 * Displays four key performance cards in a responsive grid:
 * Total Spend, Average ROAS, Average CPA, and Total Conversions.
 * Each card shows the 7-day value and a trend comparison against
 * the prior 7-day period.
 */

import type React from "react";
import { cn } from "../../lib/utils";

/**
 * Single metric card data.
 */
interface MetricCardData {
	/** Display label for the metric. */
	label: string;
	/** Formatted current value. */
	value: string;
	/** Percentage change from prior period. */
	changePercent: number;
	/** Whether a positive change is good (true) or bad (false). */
	positiveIsGood: boolean;
}

/**
 * Placeholder metrics for initial render.
 * In production these come from the campaign metrics API.
 */
const PLACEHOLDER_METRICS: MetricCardData[] = [
	{ label: "Total Spend (7d)", value: "$0.00", changePercent: 0, positiveIsGood: false },
	{ label: "Avg ROAS (7d)", value: "0.00", changePercent: 0, positiveIsGood: true },
	{ label: "Avg CPA (7d)", value: "$0.00", changePercent: 0, positiveIsGood: false },
	{ label: "Total Conversions (7d)", value: "0", changePercent: 0, positiveIsGood: true },
];

/**
 * Individual metric card with value and trend indicator.
 */
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
						"text-green-600": isGood,
						"text-red-600": !isGood,
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
						{isPositive ? "^" : "v"}
					</span>
				)}
				<span className="text-xs text-gray-400 ml-1">vs prior 7d</span>
			</div>
		</div>
	);
}

/**
 * Four-card metrics grid showing key performance indicators.
 */
export function MetricsGrid(): React.ReactElement {
	const metrics = PLACEHOLDER_METRICS;

	return (
		<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
			{metrics.map((metric) => (
				<MetricCard key={metric.label} metric={metric} />
			))}
		</div>
	);
}
