/**
 * @module hooks/useMetrics
 *
 * React hooks that pull live account-level Insights from the dashboard
 * API. The Overview page uses these to populate the Total Spend / Avg
 * ROAS / Avg CPA / Conversions cards and the spend + ROAS time-series
 * charts.
 *
 * Pre-this-PR those components rendered hardcoded zeros from local
 * `PLACEHOLDER_METRICS` / `generatePlaceholderData()` constants and
 * never made an API call. The data has been live in the agent the
 * whole time — just not on the dashboard.
 */

import { useEffect, useState } from "react";
import { type MetricsSummary, type MetricsTimeseries, api } from "../api/client";

/**
 * Generic shape returned by both hooks. Loading/error/data triple.
 */
interface AsyncResult<T> {
	data: T | null;
	loading: boolean;
	error: string | null;
}

/**
 * Fetches `GET /api/metrics/summary` for the configured window.
 *
 * @param days - Lookback window. Defaults to 7 to match the Overview
 *               metric cards' "(7d)" labels. Both the current window
 *               and the immediately-prior window of the same length
 *               are returned so the cards can show trend deltas.
 */
export function useMetricsSummary(days = 7): AsyncResult<MetricsSummary> {
	const [data, setData] = useState<MetricsSummary | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		api.metrics
			.summary(days)
			.then((result) => {
				if (cancelled) return;
				setData(result);
				setError(null);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : "Failed to load metrics summary.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [days]);

	return { data, loading, error };
}

/**
 * Fetches `GET /api/metrics/timeseries` for the configured window.
 *
 * @param days - Lookback window in daily buckets. Defaults to 30 to
 *               match the chart titles ("Daily Spend (30d)").
 */
export function useMetricsTimeseries(days = 30): AsyncResult<MetricsTimeseries> {
	const [data, setData] = useState<MetricsTimeseries | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		api.metrics
			.timeseries(days)
			.then((result) => {
				if (cancelled) return;
				setData(result);
				setError(null);
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setError(err instanceof Error ? err.message : "Failed to load metrics timeseries.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [days]);

	return { data, loading, error };
}
