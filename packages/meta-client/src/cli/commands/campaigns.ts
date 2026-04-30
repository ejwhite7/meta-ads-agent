/**
 * @module cli/commands/campaigns
 *
 * Campaign management commands wrapping the `meta ads campaigns` CLI
 * resource group. Supports full CRUD operations: list, get, create,
 * update, and delete.
 */

import type { Campaign, CreateCampaignParams, UpdateCampaignParams } from "../../types.js";
import type { CLIWrapper } from "../wrapper.js";

/**
 * Provides typed access to all campaign operations via the meta-ads CLI.
 *
 * @example
 * ```typescript
 * const campaigns = new CampaignCommands(cliWrapper);
 * const all = await campaigns.list("act_123456");
 * const single = await campaigns.get("campaign_789");
 * ```
 */
export class CampaignCommands {
	constructor(private readonly cli: CLIWrapper) {}

	/**
	 * Lists all campaigns for the specified ad account.
	 * Equivalent to `meta ads campaigns list --account-id <id>`.
	 *
	 * @param adAccountId - Ad account ID (format: "act_XXXXXXXXX").
	 * @returns Array of campaigns in the account.
	 */
	async list(adAccountId: string): Promise<Campaign[]> {
		return this.cli.run<Campaign[]>("campaigns", "list", {
			"account-id": adAccountId,
		});
	}

	/**
	 * Retrieves a single campaign by ID.
	 * Equivalent to `meta ads campaigns show --id <id>`.
	 *
	 * @param campaignId - Campaign ID to retrieve.
	 * @returns Campaign details.
	 * @throws {NotFoundError} If the campaign does not exist.
	 */
	async get(campaignId: string): Promise<Campaign> {
		return this.cli.run<Campaign>("campaigns", "show", {
			id: campaignId,
		});
	}

	/**
	 * Creates a new campaign in the specified ad account.
	 * Equivalent to `meta ads campaigns create`.
	 *
	 * @param adAccountId - Ad account ID to create the campaign in.
	 * @param params - Campaign creation parameters.
	 * @returns The newly created campaign.
	 */
	async create(adAccountId: string, params: CreateCampaignParams): Promise<Campaign> {
		return this.cli.run<Campaign>("campaigns", "create", {
			"account-id": adAccountId,
			name: params.name,
			objective: params.objective,
			...(params.status && { status: params.status }),
			...(params.daily_budget && { "daily-budget": params.daily_budget }),
			...(params.lifetime_budget && { "lifetime-budget": params.lifetime_budget }),
			...(params.bid_strategy && { "bid-strategy": params.bid_strategy }),
			...(params.special_ad_categories && {
				"special-ad-categories": params.special_ad_categories.join(","),
			}),
		});
	}

	/**
	 * Updates an existing campaign.
	 * Equivalent to `meta ads campaigns update --id <id>`.
	 *
	 * @param campaignId - Campaign ID to update.
	 * @param params - Fields to update.
	 * @returns The updated campaign.
	 * @throws {NotFoundError} If the campaign does not exist.
	 */
	async update(campaignId: string, params: UpdateCampaignParams): Promise<Campaign> {
		return this.cli.run<Campaign>("campaigns", "update", {
			id: campaignId,
			...(params.name && { name: params.name }),
			...(params.status && { status: params.status }),
			...(params.daily_budget && { "daily-budget": params.daily_budget }),
			...(params.lifetime_budget && { "lifetime-budget": params.lifetime_budget }),
			...(params.bid_strategy && { "bid-strategy": params.bid_strategy }),
		});
	}

	/**
	 * Deletes a campaign by ID.
	 * Equivalent to `meta ads campaigns delete --id <id>`.
	 *
	 * @param campaignId - Campaign ID to delete.
	 * @throws {NotFoundError} If the campaign does not exist.
	 */
	async delete(campaignId: string): Promise<void> {
		await this.cli.run("campaigns", "delete", {
			id: campaignId,
			force: true,
		});
	}
}
