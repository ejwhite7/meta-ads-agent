/**
 * Daily spend line chart.
 *
 * Renders a Recharts LineChart showing daily ad spend over
 * the last 30 days. Uses the campaigns hook for data.
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

/**
 * Sample data point for the spend chart.
 */
interface SpendDataPoint {
	date: string;
	spend: number;
}

/**
 * Generate placeholder data for the last 30 days.
 * In production, this would be replaced with real API data.
 */
function generatePlaceholderData(): SpendDataPoint[] {
	const data: SpendDataPoint[] = [];
	const now = new Date();

	for (let i = 29; i >= 0; i--) {
		const date = new Date(now);
		date.setDate(date.getDate() - i);
		data.push({
			date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
			spend: 0,
		});
	}

	return data;
}

/**
 * Daily spend trend chart for the last 30 days.
 */
export function SpendChart(): React.ReactElement {
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
