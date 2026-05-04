/**
 * ROAS trend line chart.
 *
 * 30-day daily ROAS pulled from `GET /api/metrics/timeseries`. The
 * red dashed reference line shows the active ROAS target. Pre-PR #29
 * this chart used hardcoded placeholder data.
 *
 * The reference target is currently a fixed 4.0 — the per-campaign
 * goals system makes a single account-wide target somewhat arbitrary.
 * A future PR can compute this as the spend-weighted average of
 * campaigns whose primary KPI is `roas`.
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
import { useMetricsTimeseries } from "../../hooks/useMetrics";

interface ROASDataPoint {
	date: string;
	roas: number;
}

const ROAS_TARGET = 4.0;

function formatDateLabel(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ROASChart(): React.ReactElement {
	const { data, loading, error } = useMetricsTimeseries(30);

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
				<ReferenceLine
					y={ROAS_TARGET}
					stroke="#ef4444"
					strokeDasharray="5 5"
					label={{
						value: `Target: ${ROAS_TARGET}x`,
						position: "right",
						fill: "#ef4444",
						fontSize: 12,
					}}
				/>
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
