/**
 * ROAS trend line chart.
 *
 * Renders a Recharts LineChart showing the Return on Ad Spend
 * trend over the last 30 days, with a reference line at the
 * ROAS target for visual comparison.
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

/**
 * Data point for the ROAS chart.
 */
interface ROASDataPoint {
	date: string;
	roas: number;
}

/** Default ROAS target shown as a reference line. */
const ROAS_TARGET = 4.0;

/**
 * Generate placeholder data for the last 30 days.
 * In production, this would be replaced with real API data.
 */
function generatePlaceholderData(): ROASDataPoint[] {
	const data: ROASDataPoint[] = [];
	const now = new Date();

	for (let i = 29; i >= 0; i--) {
		const date = new Date(now);
		date.setDate(date.getDate() - i);
		data.push({
			date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
			roas: 0,
		});
	}

	return data;
}

/**
 * ROAS trend chart with target reference line.
 */
export function ROASChart(): React.ReactElement {
	const data = generatePlaceholderData();

	return (
		<ResponsiveContainer width="100%" height={300}>
			<LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
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
