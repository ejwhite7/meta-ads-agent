/**
 * @module api/endpoints/ads
 *
 * Ad CRUD via the Meta Marketing API. See campaigns.ts for the
 * rationale on routing through the API instead of the Python CLI.
 */

import type { Ad, CreateAdParams, UpdateAdParams } from "../../types.js";
import type { ApiClient, ApiResponse } from "../client.js";

const AD_FIELDS = "id,name,adset_id,status,creative,created_time,updated_time";

/**
 * The /ads endpoint returns the linked creative as `creative: { id }`,
 * not as `creative_id`. Normalize at read time.
 */
interface RawAd extends Omit<Ad, "creative_id"> {
	creative?: { id: string };
	creative_id?: string;
}

function normalize(raw: RawAd): Ad {
	return {
		id: raw.id,
		name: raw.name,
		adset_id: raw.adset_id,
		status: raw.status,
		creative_id: raw.creative_id ?? raw.creative?.id ?? "",
		created_time: raw.created_time,
		updated_time: raw.updated_time,
	};
}

/**
 * CRUD endpoints for ads.
 */
export class AdEndpoints {
	constructor(private readonly api: ApiClient) {}

	async list(adAccountId: string): Promise<Ad[]> {
		const response = await this.api.get<ApiResponse<RawAd[]>>(`/${adAccountId}/ads`, {
			params: { fields: AD_FIELDS, limit: 200 },
		});
		return response.data.map(normalize);
	}

	async get(adId: string): Promise<Ad> {
		const raw = await this.api.get<RawAd>(`/${adId}`, {
			params: { fields: AD_FIELDS },
		});
		return normalize(raw);
	}

	async create(adAccountId: string, params: CreateAdParams): Promise<Ad> {
		const body: Record<string, unknown> = {
			name: params.name,
			adset_id: params.adset_id,
			creative: { creative_id: params.creative_id },
		};
		if (params.status) body.status = params.status;

		const created = await this.api.post<{ id: string }>(`/${adAccountId}/ads`, body);
		return this.get(created.id);
	}

	async update(adId: string, params: UpdateAdParams): Promise<Ad> {
		const body: Record<string, unknown> = {};
		if (params.name !== undefined) body.name = params.name;
		if (params.status !== undefined) body.status = params.status;
		if (params.creative_id !== undefined) {
			body.creative = { creative_id: params.creative_id };
		}

		await this.api.post<{ success: boolean }>(`/${adId}`, body);
		return this.get(adId);
	}

	async delete(adId: string): Promise<void> {
		await this.api.delete<{ success: boolean }>(`/${adId}`);
	}
}
