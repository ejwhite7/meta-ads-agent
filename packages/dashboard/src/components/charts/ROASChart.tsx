/**
 * ROAS trend line chart.
 *
 * 30-day daily ROAS pulled from `GET /api/metrics/timeseries`. The
 * red dashed reference line shows the spend-weighted ROAS target
 * across campaigns whose primary KPI is `roas`, with a fallback to
 * the legacy account-wide `agent_config.roasTarget`. If neither is
 * configured the line is hidden — better than lying with an arbitrary
 * default.
 */

import type React from "react";
import {
	CartesianGrid,
	Line,
	LineChart,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { useMetricsTimeseries, useRoasTarget } from "../../hooks/useMetrics";

interface ROASDataPoint {
	date: string;
	roas: number;
}

function formatDateLabel(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ROASChart(): React.ReactElement {
	const { data, loading, error } = useMetricsTimeseries(30);
	const { data: targetData } = useRoasTarget();

	if (loading) {
		return (
			<div className="h-[300px] flex items-center justify-center text-sm text-gray-400">
				Loading ROAS timeseries…
			</div>
		);
	}

	if (error || !data) {
		return (
			<div className="h-[300px] flex items-center justify-center text-sm text-yellow-700 bg-yellow-50 rounded">
				{error ?? "No data returned."}
			</div>
		);
	}

	const points: ROASDataPoint[] = data.points.map((p) => ({
		date: formatDateLabel(p.date),
		roas: p.roas,
	}));

	/* Build the reference-line label so the operator can tell at a glance
	 * whether they're looking at a per-campaign weighted target (most
	 * meaningful) or the legacy account-wide fallback. */
	const targetValue = targetData?.target ?? null;
	const targetLabel =
		targetValue !== null
			? targetData?.source === "campaigns" && targetData?.contributors
				? `Target: ${targetValue.toFixed(2)}x (avg of ${targetData.contributors} campaign${targetData.contributors === 1 ? "" : "s"})`
				: targetData?.source === "agent_config"
					? `Target: ${targetValue.toFixed(2)}x (account-wide)`
					: `Target: ${targetValue.toFixed(2)}x`
			: null;

	return (
		<ResponsiveContainer width="100%" height={300}>
			<LineChart data={points} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
				<CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
				<XAxis
					dataKey="date"
					tick={{ fontSize: 12, fill: "#6b7280" }}
					tickLine={false}
					axisLine={{ stroke: "#e5e7eb" }}
				/>
				<YAxis
					tick={{ fontSize: 12, fill: "#6b7280" }}
					tickLine={false}
					axisLine={{ stroke: "#e5e7eb" }}
					tickFormatter={(value: number) => `${value}x`}
				/>
				<Tooltip
					formatter={(value: number) => [`${value.toFixed(2)}x`, "ROAS"]}
					contentStyle={{
						borderRadius: "8px",
						border: "1px solid #e5e7eb",
						boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
					}}
				/>
				{targetValue !== null && targetLabel !== null && (
					<ReferenceLine
						y={targetValue}
						stroke="#ef4444"
						strokeDasharray="5 5"
						label={{
							value: targetLabel,
							position: "right",
							fill: "#ef4444",
							fontSize: 12,
						}}
					/>
				)}
				<Line
					type="monotone"
					dataKey="roas"
					stroke="#10b981"
					strokeWidth={2}
					dot={false}
					activeDot={{ r: 4 }}
				/>
			</LineChart>
		</ResponsiveContainer>
	);
}
