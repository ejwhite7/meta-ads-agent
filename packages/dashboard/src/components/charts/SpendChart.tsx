/**
 * Daily spend line chart.
 *
 * 30-day daily spend pulled from `GET /api/metrics/timeseries`, which
 * calls MetaClient.insights at `level: "account"` with `time_increment=1`.
 *
 * Pre-PR #29 this chart called a local `generatePlaceholderData()` that
 * returned 30 zero-spend points and never hit the API.
 */

import type React from "react";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { useMetricsTimeseries } from "../../hooks/useMetrics";

interface SpendDataPoint {
	date: string;
	spend: number;
}

/**
 * Format an ISO date as e.g. "Apr 15" for the X axis.
 * Falls back to the raw string if parsing fails.
 */
function formatDateLabel(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return iso;
	return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function SpendChart(): React.ReactElement {
	const { data, loading, error } = useMetricsTimeseries(30);

	if (loading) {
		return (
			<div className="h-[300px] flex items-center justify-center text-sm text-gray-400">
				Loading spend timeseries…
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

	const points: SpendDataPoint[] = data.points.map((p) => ({
		date: formatDateLabel(p.date),
		spend: p.spend,
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
					tickFormatter={(value: number) => `$${value}`}
				/>
				<Tooltip
					formatter={(value: number) => [`$${value.toFixed(2)}`, "Spend"]}
					contentStyle={{
						borderRadius: "8px",
						border: "1px solid #e5e7eb",
						boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
					}}
				/>
				<Line
					type="monotone"
					dataKey="spend"
					stroke="#3b82f6"
					strokeWidth={2}
					dot={false}
					activeDot={{ r: 4 }}
				/>
			</LineChart>
		</ResponsiveContainer>
	);
}
