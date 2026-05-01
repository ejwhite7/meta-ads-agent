/**
 * @module api/endpoints/creatives
 *
 * Ad creative CRUD via the Meta Marketing API.
 */

import type { AdCreative, CreateCreativeParams, UpdateCreativeParams } from "../../types.js";
import type { ApiClient, ApiResponse } from "../client.js";

const CREATIVE_FIELDS =
	"id,name,object_story_spec,image_hash,video_id,body,title,link_url,call_to_action_type";

/**
 * CRUD endpoints for ad creatives.
 */
export class CreativeEndpoints {
	constructor(private readonly api: ApiClient) {}

	async list(adAccountId: string): Promise<AdCreative[]> {
		const response = await this.api.get<ApiResponse<AdCreative[]>>(`/${adAccountId}/adcreatives`, {
			params: { fields: CREATIVE_FIELDS, limit: 200 },
		});
		return response.data;
	}

	async get(creativeId: string): Promise<AdCreative> {
		return this.api.get<AdCreative>(`/${creativeId}`, {
			params: { fields: CREATIVE_FIELDS },
		});
	}

	async create(adAccountId: string, params: CreateCreativeParams): Promise<AdCreative> {
		const body: Record<string, unknown> = { name: params.name };
		if (params.object_story_spec) body.object_story_spec = params.object_story_spec;
		if (params.image_hash) body.image_hash = params.image_hash;
		if (params.video_id) body.video_id = params.video_id;
		if (params.body) body.body = params.body;
		if (params.title) body.title = params.title;
		if (params.link_url) body.link_url = params.link_url;
		if (params.call_to_action_type) body.call_to_action_type = params.call_to_action_type;

		const created = await this.api.post<{ id: string }>(`/${adAccountId}/adcreatives`, body);
		return this.get(created.id);
	}

	async update(creativeId: string, params: UpdateCreativeParams): Promise<AdCreative> {
		const body: Record<string, unknown> = {};
		if (params.name !== undefined) body.name = params.name;
		if (params.object_story_spec !== undefined) body.object_story_spec = params.object_story_spec;
		if (params.body !== undefined) body.body = params.body;
		if (params.title !== undefined) body.title = params.title;
		if (params.link_url !== undefined) body.link_url = params.link_url;

		await this.api.post<{ success: boolean }>(`/${creativeId}`, body);
		return this.get(creativeId);
	}

	async delete(creativeId: string): Promise<void> {
		await this.api.delete<{ success: boolean }>(`/${creativeId}`);
	}
}
