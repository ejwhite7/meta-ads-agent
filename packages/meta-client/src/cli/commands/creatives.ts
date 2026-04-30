/**
 * @module cli/commands/creatives
 *
 * Ad creative management commands wrapping the `meta ads creatives` CLI
 * resource group. Supports full CRUD operations for creatives, which define
 * the visual and textual content of ads including images, videos, and copy.
 */

import type { AdCreative, CreateCreativeParams, UpdateCreativeParams } from "../../types.js";
import type { CLIWrapper } from "../wrapper.js";

/**
 * Provides typed access to all creative operations via the meta-ads CLI.
 *
 * @example
 * ```typescript
 * const creatives = new CreativeCommands(cliWrapper);
 * const creative = await creatives.create("act_123456", {
 *   name: "Summer Sale Creative",
 *   body: "Shop our summer collection!",
 *   title: "Summer Sale - 50% Off",
 *   link_url: "https://example.com/summer",
 * });
 * ```
 */
export class CreativeCommands {
	constructor(private readonly cli: CLIWrapper) {}

	/**
	 * Lists all ad creatives for the specified ad account.
	 * Equivalent to `meta ads creatives list --account-id <id>`.
	 *
	 * @param adAccountId - Ad account ID (format: "act_XXXXXXXXX").
	 * @returns Array of creatives in the account.
	 */
	async list(adAccountId: string): Promise<AdCreative[]> {
		return this.cli.run<AdCreative[]>("creatives", "list", {
			"account-id": adAccountId,
		});
	}

	/**
	 * Retrieves a single creative by ID.
	 * Equivalent to `meta ads creatives show --id <id>`.
	 *
	 * @param creativeId - Creative ID to retrieve.
	 * @returns Creative details.
	 * @throws {NotFoundError} If the creative does not exist.
	 */
	async get(creativeId: string): Promise<AdCreative> {
		return this.cli.run<AdCreative>("creatives", "show", {
			id: creativeId,
		});
	}

	/**
	 * Creates a new ad creative in the specified ad account.
	 * Equivalent to `meta ads creatives create`.
	 *
	 * @param adAccountId - Ad account ID to create the creative in.
	 * @param params - Creative creation parameters.
	 * @returns The newly created creative.
	 */
	async create(adAccountId: string, params: CreateCreativeParams): Promise<AdCreative> {
		return this.cli.run<AdCreative>("creatives", "create", {
			"account-id": adAccountId,
			name: params.name,
			...(params.body && { body: params.body }),
			...(params.title && { title: params.title }),
			...(params.link_url && { "link-url": params.link_url }),
			...(params.image_hash && { "image-hash": params.image_hash }),
			...(params.video_id && { "video-id": params.video_id }),
			...(params.call_to_action_type && { "call-to-action": params.call_to_action_type }),
			...(params.object_story_spec?.page_id && {
				"page-id": params.object_story_spec.page_id,
			}),
		});
	}

	/**
	 * Updates an existing creative.
	 * Equivalent to `meta ads creatives update --id <id>`.
	 *
	 * @param creativeId - Creative ID to update.
	 * @param params - Fields to update.
	 * @returns The updated creative.
	 * @throws {NotFoundError} If the creative does not exist.
	 */
	async update(creativeId: string, params: UpdateCreativeParams): Promise<AdCreative> {
		return this.cli.run<AdCreative>("creatives", "update", {
			id: creativeId,
			...(params.name && { name: params.name }),
			...(params.body && { body: params.body }),
			...(params.title && { title: params.title }),
			...(params.link_url && { "link-url": params.link_url }),
		});
	}

	/**
	 * Deletes a creative by ID.
	 * Equivalent to `meta ads creatives delete --id <id>`.
	 *
	 * @param creativeId - Creative ID to delete.
	 * @throws {NotFoundError} If the creative does not exist.
	 */
	async delete(creativeId: string): Promise<void> {
		await this.cli.run("creatives", "delete", {
			id: creativeId,
			force: true,
		});
	}
}
