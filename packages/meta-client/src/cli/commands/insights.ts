/**
 * @module cli/commands/insights
 *
 * Insights query commands wrapping the `meta ads insights get` CLI command.
 * Retrieves performance metrics (impressions, clicks, spend, conversions, etc.)
 * at account, campaign, ad set, or ad level with optional date ranges and
 * breakdowns. Automatically computes ROAS from purchase action values when
 * not directly available in the API response.
 */

import type { InsightsAction, InsightsQueryParams, InsightsResult } from "../../types.js";
import type { CLIWrapper } from "../wrapper.js";

/**
 * Provides typed access to Meta Ads insights and performance reporting
 * via the meta-ads CLI.
 *
 * @example
 * ```typescript
 * const insights = new InsightsCommands(cliWrapper);
 * const results = await insights.query("act_123456", {
 *   level: "campaign",
 *   date_preset: "last_7d",
 *   fields: ["impressions", "clicks", "spend", "actions"],
 * });
 * console.log(results[0].roas); // Computed from purchase value / spend
 * ```
 */
export class InsightsCommands {
	constructor(private readonly cli: CLIWrapper) {}

	/**
	 * Queries performance insights for the specified ad account.
	 * Equivalent to `meta ads insights get`.
	 *
	 * Automatically computes ROAS (Return on Ad Spend) from the `actions`
	 * array if purchase value data is available and ROAS is not directly
	 * present in the response.
	 *
	 * @param adAccountId - Ad account ID (format: "act_XXXXXXXXX").
	 * @param params - Query parameters including level, date range, and fields.
	 * @returns Array of insights results with computed ROAS.
	 */
	async query(adAccountId: string, params: InsightsQueryParams): Promise<InsightsResult[]> {
		const args: Record<string, string | number | boolean> = {
			"account-id": adAccountId,
			level: params.level,
		};

		if (params.date_preset) {
			args["date-preset"] = params.date_preset;
		}

		if (params.time_range) {
			args["time-range"] = `${params.time_range.since},${params.time_range.until}`;
		}

		if (params.fields && params.fields.length > 0) {
			args.fields = params.fields.join(",");
		}

		if (params.breakdowns && params.breakdowns.length > 0) {
			args.breakdowns = params.breakdowns.join(",");
		}

		if (params.filtering && params.filtering.length > 0) {
			args.filtering = JSON.stringify(params.filtering);
		}

		const results = await this.cli.run<InsightsResult[]>("insights", "get", args);
		return results.map((result) => this.enrichWithRoas(result));
	}

	/**
	 * Computes ROAS from the actions array if not already present.
	 * ROAS = total purchase value / spend.
	 *
	 * Looks for "purchase" or "omni_purchase" action types in the
	 * action_values array to calculate total conversion value.
	 */
	private enrichWithRoas(result: InsightsResult): InsightsResult {
		if (result.roas !== undefined && result.roas !== null) {
			return result;
		}

		const spend = Number.parseFloat(result.spend);
		if (spend === 0 || Number.isNaN(spend)) {
			return { ...result, roas: 0 };
		}

		const purchaseValue = this.extractPurchaseValue(result.actions);
		if (purchaseValue === 0) {
			return { ...result, roas: 0 };
		}

		return { ...result, roas: purchaseValue / spend };
	}

	/**
	 * Extracts the total purchase value from an actions array.
	 * Looks for "purchase" and "omni_purchase" action types.
	 */
	private extractPurchaseValue(actions?: InsightsAction[]): number {
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
}
