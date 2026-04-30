/**
 * @module tools/reporting/utils
 *
 * Shared utility functions for the reporting tool suite.
 * Handles parsing raw Meta Insights API string values into typed numeric
 * metrics, extracting conversion counts from action arrays, and computing
 * derived metrics like CPA and ROAS.
 */

import type { InsightsResultLike, ReportAdSetMetrics, ReportCampaignMetrics } from "./types.js";

/**
 * Safely parses a string value to a floating-point number.
 * Returns 0 for null, undefined, empty strings, and NaN results.
 *
 * @param value - Raw string value from the Meta API.
 * @returns Parsed number or 0 if unparseable.
 */
export function safeParseFloat(value: string | undefined | null): number {
	if (value === undefined || value === null || value === "") {
		return 0;
	}
	const parsed = Number.parseFloat(value);
	return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Extracts the total conversion count from a Meta actions array.
 * Looks for standard conversion action types: "purchase", "lead",
 * "complete_registration", "omni_purchase", and "offsite_conversion".
 *
 * @param actions - Array of action objects from the Insights API.
 * @returns Total number of conversions across all matching action types.
 */
export function extractConversions(
	actions?: Array<{ action_type: string; value: string }>,
): number {
	if (!actions || actions.length === 0) {
		return 0;
	}

	const conversionTypes = new Set([
		"purchase",
		"lead",
		"complete_registration",
		"omni_purchase",
		"offsite_conversion",
	]);

	let total = 0;
	for (const action of actions) {
		if (conversionTypes.has(action.action_type)) {
			const value = Number.parseFloat(action.value);
			if (!Number.isNaN(value)) {
				total += value;
			}
		}
	}

	return total;
}

/**
 * Extracts purchase revenue from a Meta actions array.
 * Used for ROAS computation when the `roas` field is not directly available.
 *
 * @param actions - Array of action objects from the Insights API.
 * @returns Total revenue from purchase-type actions.
 */
export function extractRevenue(actions?: Array<{ action_type: string; value: string }>): number {
	if (!actions || actions.length === 0) {
		return 0;
	}

	let total = 0;
	for (const action of actions) {
		if (action.action_type === "purchase" || action.action_type === "omni_purchase") {
			const value = Number.parseFloat(action.value);
			if (!Number.isNaN(value)) {
				total += value;
			}
		}
	}

	return total;
}

/**
 * Parses a raw InsightsResult into a fully typed ReportCampaignMetrics object.
 * Converts all string values to numbers and computes CPA and ROAS if not
 * directly available.
 *
 * @param insight - Raw insights result from the Meta API.
 * @returns Parsed campaign metrics with all values as numbers.
 */
export function parseInsightsToMetrics(insight: InsightsResultLike): ReportCampaignMetrics {
	const spend = safeParseFloat(insight.spend);
	const impressions = safeParseFloat(insight.impressions);
	const clicks = safeParseFloat(insight.clicks);
	const conversions = extractConversions(insight.actions);
	const revenue = extractRevenue(insight.actions);

	const ctr = safeParseFloat(insight.ctr);
	const cpc = safeParseFloat(insight.cpc);
	const cpm = safeParseFloat(insight.cpm);
	const reach = safeParseFloat(insight.reach);
	const frequency = safeParseFloat(insight.frequency);
	const roas = insight.roas ?? (spend > 0 ? revenue / spend : 0);
	const cpa = conversions > 0 ? spend / conversions : 0;

	return {
		campaignId: insight.campaign_id ?? "",
		campaignName: insight.campaign_name ?? "Unknown Campaign",
		spend,
		impressions,
		clicks,
		ctr,
		cpc,
		cpm,
		conversions,
		roas,
		cpa,
		reach,
		frequency,
	};
}

/**
 * Parses a raw InsightsResult into a fully typed ReportAdSetMetrics object.
 *
 * @param insight - Raw insights result from the Meta API at the adset level.
 * @returns Parsed ad set metrics with all values as numbers.
 */
export function parseInsightsToAdSetMetrics(insight: InsightsResultLike): ReportAdSetMetrics {
	const spend = safeParseFloat(insight.spend);
	const impressions = safeParseFloat(insight.impressions);
	const clicks = safeParseFloat(insight.clicks);
	const conversions = extractConversions(insight.actions);
	const revenue = extractRevenue(insight.actions);

	const ctr = safeParseFloat(insight.ctr);
	const cpc = safeParseFloat(insight.cpc);
	const cpm = safeParseFloat(insight.cpm);
	const roas = insight.roas ?? (spend > 0 ? revenue / spend : 0);
	const cpa = conversions > 0 ? spend / conversions : 0;

	return {
		adSetId: insight.adset_id ?? "",
		adSetName: insight.adset_name ?? "Unknown Ad Set",
		campaignId: insight.campaign_id ?? "",
		spend,
		impressions,
		clicks,
		ctr,
		cpc,
		cpm,
		conversions,
		roas,
		cpa,
	};
}

/**
 * Computes the date range for a given preset string.
 * Returns an object with `since` and `until` ISO date strings (YYYY-MM-DD).
 *
 * @param preset - Date range preset (e.g., "last_7d", "last_30d").
 * @returns Object with `since` and `until` date strings.
 */
export function resolveDateRange(preset: string): { since: string; until: string } {
	const now = new Date();
	const until = formatDate(now);
	let since: string;

	switch (preset) {
		case "today":
			since = until;
			break;
		case "yesterday": {
			const yesterday = new Date(now);
			yesterday.setDate(yesterday.getDate() - 1);
			since = formatDate(yesterday);
			return { since, until: since };
		}
		case "last_7d": {
			const start = new Date(now);
			start.setDate(start.getDate() - 7);
			since = formatDate(start);
			break;
		}
		case "last_14d": {
			const start = new Date(now);
			start.setDate(start.getDate() - 14);
			since = formatDate(start);
			break;
		}
		case "last_30d": {
			const start = new Date(now);
			start.setDate(start.getDate() - 30);
			since = formatDate(start);
			break;
		}
		default: {
			const start = new Date(now);
			start.setDate(start.getDate() - 7);
			since = formatDate(start);
			break;
		}
	}

	return { since, until };
}

/**
 * Formats a Date object as a YYYY-MM-DD string.
 *
 * @param date - Date to format.
 * @returns ISO date string (YYYY-MM-DD).
 */
export function formatDate(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}
