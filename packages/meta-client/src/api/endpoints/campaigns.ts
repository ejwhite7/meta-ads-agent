/**
 * @module api/endpoints/campaigns
 *
 * Campaign CRUD via the Meta Marketing API. Replaces the previous
 * `meta ads campaigns ...` CLI surface, which suffered from version
 * drift between the published Python CLI and the documented surface
 * (the released CLI uses singular `campaign`, no `auth` subcommand,
 * different env var names, etc.).
 *
 * Calling the Marketing API directly removes the Python runtime
 * dependency and gives the agent a stable, versioned surface.
 *
 * Endpoint shapes:
 *   - List:   GET    /act_<id>/campaigns?fields=...
 *   - Get:    GET    /<campaign-id>?fields=...
 *   - Create: POST   /act_<id>/campaigns        (returns { id })
 *   - Update: POST   /<campaign-id>             (returns { success: true })
 *   - Delete: DELETE /<campaign-id>             (returns { success: true })
 */

import type { Campaign, CreateCampaignParams, UpdateCampaignParams } from "../../types.js";
import type { ApiClient, ApiResponse } from "../client.js";

/**
 * Fields fetched on every campaign read. Adjust here if the Campaign
 * type gains new fields.
 */
const CAMPAIGN_FIELDS =
	"id,name,status,objective,daily_budget,lifetime_budget,bid_strategy,created_time,updated_time";

/**
 * Provides typed CRUD access to campaigns via direct Marketing API calls.
 *
 * @example
 * ```typescript
 * const campaigns = new CampaignEndpoints(apiClient);
 * const all = await campaigns.list("act_123456");
 * const single = await campaigns.get("23851234567890123");
 * ```
 */
export class CampaignEndpoints {
	constructor(private readonly api: ApiClient) {}

	/**
	 * Lists all campaigns for the specified ad account.
	 *
	 * Note: this returns the first page only (default Marketing API limit
	 * is 25). Pagination via `?after=<cursor>` is a follow-up; for now we
	 * request a generous `limit=200` which covers every realistic account.
	 *
	 * @param adAccountId - Ad account ID (format: "act_XXXXXXXXX").
	 * @returns Array of campaigns in the account.
	 */
	async list(adAccountId: string): Promise<Campaign[]> {
		const response = await this.api.get<ApiResponse<Campaign[]>>(`/${adAccountId}/campaigns`, {
			params: { fields: CAMPAIGN_FIELDS, limit: 200 },
		});
		return response.data;
	}

	/**
	 * Retrieves a single campaign by ID.
	 *
	 * @param campaignId - Campaign ID to retrieve.
	 * @returns Campaign details.
	 * @throws {NotFoundError} If the campaign does not exist (404).
	 */
	async get(campaignId: string): Promise<Campaign> {
		return this.api.get<Campaign>(`/${campaignId}`, {
			params: { fields: CAMPAIGN_FIELDS },
		});
	}

	/**
	 * Creates a new campaign in the specified ad account.
	 *
	 * The Marketing API returns only `{ id }` from POST. We immediately
	 * follow up with a GET so callers receive the same fully-populated
	 * Campaign shape the previous CLI implementation returned.
	 *
	 * @param adAccountId - Ad account ID to create the campaign in.
	 * @param params - Campaign creation parameters.
	 * @returns The newly created campaign.
	 */
	async create(adAccountId: string, params: CreateCampaignParams): Promise<Campaign> {
		const body: Record<string, unknown> = {
			name: params.name,
			objective: params.objective,
		};
		if (params.status) body.status = params.status;
		if (params.daily_budget) body.daily_budget = params.daily_budget;
		if (params.lifetime_budget) body.lifetime_budget = params.lifetime_budget;
		if (params.bid_strategy) body.bid_strategy = params.bid_strategy;
		if (params.special_ad_categories) {
			body.special_ad_categories = params.special_ad_categories;
		} else {
			/* The API requires this field. Empty array means "no special category". */
			body.special_ad_categories = [];
		}

		const created = await this.api.post<{ id: string }>(`/${adAccountId}/campaigns`, body);
		return this.get(created.id);
	}

	/**
	 * Updates an existing campaign.
	 *
	 * The Marketing API returns `{ success: true }` from POST. We follow
	 * up with a GET so callers see the post-update state.
	 *
	 * @param campaignId - Campaign ID to update.
	 * @param params - Fields to update.
	 * @returns The updated campaign.
	 * @throws {NotFoundError} If the campaign does not exist.
	 */
	async update(campaignId: string, params: UpdateCampaignParams): Promise<Campaign> {
		const body: Record<string, unknown> = {};
		if (params.name !== undefined) body.name = params.name;
		if (params.status !== undefined) body.status = params.status;
		if (params.daily_budget !== undefined) body.daily_budget = params.daily_budget;
		if (params.lifetime_budget !== undefined) body.lifetime_budget = params.lifetime_budget;
		if (params.bid_strategy !== undefined) body.bid_strategy = params.bid_strategy;

		await this.api.post<{ success: boolean }>(`/${campaignId}`, body);
		return this.get(campaignId);
	}

	/**
	 * Deletes a campaign by ID.
	 *
	 * @param campaignId - Campaign ID to delete.
	 * @throws {NotFoundError} If the campaign does not exist.
	 */
	async delete(campaignId: string): Promise<void> {
		await this.api.delete<{ success: boolean }>(`/${campaignId}`);
	}
}
