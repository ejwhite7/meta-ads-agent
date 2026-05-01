/**
 * @module api/endpoints/adsets
 *
 * Ad-set CRUD via the Meta Marketing API. See campaigns.ts for the
 * rationale on why we no longer route through the Python CLI.
 */

import type { AdSet, CreateAdSetParams, UpdateAdSetParams } from "../../types.js";
import type { ApiClient, ApiResponse } from "../client.js";

const ADSET_FIELDS =
	"id,name,campaign_id,status,targeting,bid_amount,daily_budget,optimization_goal,start_time,end_time,created_time,updated_time";

/**
 * CRUD endpoints for ad sets.
 */
export class AdSetEndpoints {
	constructor(private readonly api: ApiClient) {}

	async list(adAccountId: string): Promise<AdSet[]> {
		const response = await this.api.get<ApiResponse<AdSet[]>>(`/${adAccountId}/adsets`, {
			params: { fields: ADSET_FIELDS, limit: 200 },
		});
		return response.data;
	}

	async get(adSetId: string): Promise<AdSet> {
		return this.api.get<AdSet>(`/${adSetId}`, { params: { fields: ADSET_FIELDS } });
	}

	async create(adAccountId: string, params: CreateAdSetParams): Promise<AdSet> {
		const body: Record<string, unknown> = {
			name: params.name,
			campaign_id: params.campaign_id,
			optimization_goal: params.optimization_goal,
			billing_event: params.billing_event,
			targeting: params.targeting,
		};
		if (params.status) body.status = params.status;
		if (params.daily_budget) body.daily_budget = params.daily_budget;
		if (params.bid_amount) body.bid_amount = params.bid_amount;
		if (params.start_time) body.start_time = params.start_time;
		if (params.end_time) body.end_time = params.end_time;

		const created = await this.api.post<{ id: string }>(`/${adAccountId}/adsets`, body);
		return this.get(created.id);
	}

	async update(adSetId: string, params: UpdateAdSetParams): Promise<AdSet> {
		const body: Record<string, unknown> = {};
		if (params.name !== undefined) body.name = params.name;
		if (params.status !== undefined) body.status = params.status;
		if (params.daily_budget !== undefined) body.daily_budget = params.daily_budget;
		if (params.bid_amount !== undefined) body.bid_amount = params.bid_amount;
		if (params.targeting !== undefined) body.targeting = params.targeting;

		await this.api.post<{ success: boolean }>(`/${adSetId}`, body);
		return this.get(adSetId);
	}

	async delete(adSetId: string): Promise<void> {
		await this.api.delete<{ success: boolean }>(`/${adSetId}`);
	}
}
