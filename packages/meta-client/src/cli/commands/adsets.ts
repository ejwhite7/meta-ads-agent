/**
 * @module cli/commands/adsets
 *
 * Ad set management commands wrapping the `meta ads ad-sets` CLI
 * resource group. Supports full CRUD operations for ad sets, which
 * control targeting, budget, schedule, and bidding within a campaign.
 */

import type { AdSet, CreateAdSetParams, UpdateAdSetParams } from "../../types.js";
import type { CLIWrapper } from "../wrapper.js";

/**
 * Provides typed access to all ad set operations via the meta-ads CLI.
 *
 * @example
 * ```typescript
 * const adSets = new AdSetCommands(cliWrapper);
 * const sets = await adSets.list("act_123456");
 * const adSet = await adSets.create("act_123456", {
 *   name: "US Targeting",
 *   campaign_id: "123",
 *   targeting: { geo_locations: { countries: ["US"] } },
 *   optimization_goal: "LINK_CLICKS",
 * });
 * ```
 */
export class AdSetCommands {
	constructor(private readonly cli: CLIWrapper) {}

	/**
	 * Lists all ad sets for the specified ad account.
	 * Equivalent to `meta ads ad-sets list --account-id <id>`.
	 *
	 * @param adAccountId - Ad account ID (format: "act_XXXXXXXXX").
	 * @returns Array of ad sets in the account.
	 */
	async list(adAccountId: string): Promise<AdSet[]> {
		return this.cli.run<AdSet[]>("ad-sets", "list", {
			"account-id": adAccountId,
		});
	}

	/**
	 * Retrieves a single ad set by ID.
	 * Equivalent to `meta ads ad-sets show --id <id>`.
	 *
	 * @param adSetId - Ad set ID to retrieve.
	 * @returns Ad set details.
	 * @throws {NotFoundError} If the ad set does not exist.
	 */
	async get(adSetId: string): Promise<AdSet> {
		return this.cli.run<AdSet>("ad-sets", "show", {
			id: adSetId,
		});
	}

	/**
	 * Creates a new ad set in the specified ad account.
	 * Equivalent to `meta ads ad-sets create`.
	 *
	 * @param adAccountId - Ad account ID to create the ad set in.
	 * @param params - Ad set creation parameters.
	 * @returns The newly created ad set.
	 */
	async create(adAccountId: string, params: CreateAdSetParams): Promise<AdSet> {
		return this.cli.run<AdSet>("ad-sets", "create", {
			"account-id": adAccountId,
			name: params.name,
			"campaign-id": params.campaign_id,
			"optimization-goal": params.optimization_goal,
			...(params.status && { status: params.status }),
			...(params.daily_budget && { "daily-budget": params.daily_budget }),
			...(params.bid_amount && { "bid-amount": params.bid_amount }),
			...(params.start_time && { "start-time": params.start_time }),
			...(params.end_time && { "end-time": params.end_time }),
			...(params.billing_event && { "billing-event": params.billing_event }),
			...(params.targeting.geo_locations?.countries && {
				countries: params.targeting.geo_locations.countries.join(","),
			}),
		});
	}

	/**
	 * Updates an existing ad set.
	 * Equivalent to `meta ads ad-sets update --id <id>`.
	 *
	 * @param adSetId - Ad set ID to update.
	 * @param params - Fields to update.
	 * @returns The updated ad set.
	 * @throws {NotFoundError} If the ad set does not exist.
	 */
	async update(adSetId: string, params: UpdateAdSetParams): Promise<AdSet> {
		return this.cli.run<AdSet>("ad-sets", "update", {
			id: adSetId,
			...(params.name && { name: params.name }),
			...(params.status && { status: params.status }),
			...(params.daily_budget && { "daily-budget": params.daily_budget }),
			...(params.bid_amount && { "bid-amount": params.bid_amount }),
			...(params.optimization_goal && { "optimization-goal": params.optimization_goal }),
			...(params.start_time && { "start-time": params.start_time }),
			...(params.end_time && { "end-time": params.end_time }),
			...(params.targeting?.geo_locations?.countries && {
				countries: params.targeting.geo_locations.countries.join(","),
			}),
		});
	}

	/**
	 * Deletes an ad set by ID.
	 * Equivalent to `meta ads ad-sets delete --id <id>`.
	 *
	 * @param adSetId - Ad set ID to delete.
	 * @throws {NotFoundError} If the ad set does not exist.
	 */
	async delete(adSetId: string): Promise<void> {
		await this.cli.run("ad-sets", "delete", {
			id: adSetId,
			force: true,
		});
	}
}
