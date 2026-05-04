/**
 * @module api/endpoints/insights
 *
 * Performance insights via the Meta Marketing API.
 *
 * The Insights endpoint is the main read-side workload of the agent: every
 * OODA tick fetches today's metrics and a lookback baseline. Routing this
 * through the API directly (rather than the Python CLI) eliminates a
 * subprocess spawn and JSON re-parse on every tick.
 */

import type { InsightsQueryParams, InsightsResult } from "../../types.js";
import type { ApiClient, ApiResponse } from "../client.js";

/**
 * Default fields requested when the caller does not specify any.
 * Matches the previous CLI behaviour of returning the standard set.
 */
const DEFAULT_FIELDS = [
	"campaign_id",
	"campaign_name",
	"adset_id",
	"adset_name",
	"ad_id",
	"ad_name",
	"impressions",
	"clicks",
	"spend",
	"ctr",
	"cpm",
	"cpc",
	"actions",
	"action_values",
	"date_start",
	"date_stop",
];

/**
 * Insights query endpoint.
 */
export class InsightsEndpoints {
	constructor(private readonly api: ApiClient) {}

	/**
	 * Queries insights for the specified ad account.
	 *
	 * @param adAccountId - Ad account ID (format: "act_XXXXXXXXX").
	 * @param params - Insights query parameters (level, date range, fields, etc.).
	 * @returns Array of insights rows. The shape depends on `level`:
	 *   - `level: "account"`  -> single row aggregating the account
	 *   - `level: "campaign"` -> one row per campaign
	 *   - `level: "adset"`    -> one row per ad set
	 *   - `level: "ad"`       -> one row per ad
	 */
	async query(adAccountId: string, params: InsightsQueryParams): Promise<InsightsResult[]> {
		const apiParams: Record<string, unknown> = {
			level: params.level,
			fields: (params.fields ?? DEFAULT_FIELDS).join(","),
			limit: 500,
		};

		if (params.date_preset) {
			apiParams.date_preset = params.date_preset;
		}
		if (params.time_range) {
			/* Marketing API expects time_range as a JSON-encoded string. */
			apiParams.time_range = JSON.stringify(params.time_range);
		}
		if (params.breakdowns && params.breakdowns.length > 0) {
			apiParams.breakdowns = params.breakdowns.join(",");
		}
		if (params.filtering && params.filtering.length > 0) {
			apiParams.filtering = JSON.stringify(params.filtering);
		}

		const response = await this.api.get<ApiResponse<InsightsResult[]>>(`/${adAccountId}/insights`, {
			params: apiParams,
		});
		return response.data;
	}
}
