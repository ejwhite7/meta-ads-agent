/**
 * @module cli/commands/ads
 *
 * Ad management commands wrapping the `meta ads ads` CLI resource group.
 * Supports full CRUD operations for ads, which combine a creative with
 * placement configuration within an ad set.
 */

import type { Ad, CreateAdParams, UpdateAdParams } from "../../types.js";
import type { CLIWrapper } from "../wrapper.js";

/**
 * Provides typed access to all ad operations via the meta-ads CLI.
 *
 * @example
 * ```typescript
 * const ads = new AdCommands(cliWrapper);
 * const allAds = await ads.list("act_123456");
 * const ad = await ads.create("act_123456", {
 *   name: "Summer Sale Ad",
 *   adset_id: "456",
 *   creative_id: "789",
 * });
 * ```
 */
export class AdCommands {
	constructor(private readonly cli: CLIWrapper) {}

	/**
	 * Lists all ads for the specified ad account.
	 * Equivalent to `meta ads ads list --account-id <id>`.
	 *
	 * @param adAccountId - Ad account ID (format: "act_XXXXXXXXX").
	 * @returns Array of ads in the account.
	 */
	async list(adAccountId: string): Promise<Ad[]> {
		return this.cli.run<Ad[]>("ads", "list", {
			"account-id": adAccountId,
		});
	}

	/**
	 * Retrieves a single ad by ID.
	 * Equivalent to `meta ads ads show --id <id>`.
	 *
	 * @param adId - Ad ID to retrieve.
	 * @returns Ad details.
	 * @throws {NotFoundError} If the ad does not exist.
	 */
	async get(adId: string): Promise<Ad> {
		return this.cli.run<Ad>("ads", "show", {
			id: adId,
		});
	}

	/**
	 * Creates a new ad in the specified ad account.
	 * Equivalent to `meta ads ads create`.
	 *
	 * @param adAccountId - Ad account ID to create the ad in.
	 * @param params - Ad creation parameters.
	 * @returns The newly created ad.
	 */
	async create(adAccountId: string, params: CreateAdParams): Promise<Ad> {
		return this.cli.run<Ad>("ads", "create", {
			"account-id": adAccountId,
			name: params.name,
			"adset-id": params.adset_id,
			"creative-id": params.creative_id,
			...(params.status && { status: params.status }),
		});
	}

	/**
	 * Updates an existing ad.
	 * Equivalent to `meta ads ads update --id <id>`.
	 *
	 * @param adId - Ad ID to update.
	 * @param params - Fields to update.
	 * @returns The updated ad.
	 * @throws {NotFoundError} If the ad does not exist.
	 */
	async update(adId: string, params: UpdateAdParams): Promise<Ad> {
		return this.cli.run<Ad>("ads", "update", {
			id: adId,
			...(params.name && { name: params.name }),
			...(params.status && { status: params.status }),
			...(params.creative_id && { "creative-id": params.creative_id }),
		});
	}

	/**
	 * Deletes an ad by ID.
	 * Equivalent to `meta ads ads delete --id <id>`.
	 *
	 * @param adId - Ad ID to delete.
	 * @throws {NotFoundError} If the ad does not exist.
	 */
	async delete(adId: string): Promise<void> {
		await this.cli.run("ads", "delete", {
			id: adId,
			force: true,
		});
	}
}
