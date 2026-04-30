/**
 * @module api/endpoints/audiences
 *
 * Custom and Lookalike audience management via the Meta Marketing API.
 * These operations are not available through the meta-ads CLI and require
 * direct API calls. Supports creating customer-list audiences, website
 * retargeting audiences, and lookalike audiences for prospecting.
 */

import type { CustomAudience, CreateAudienceParams, CreateLookalikeParams } from "../../types.js";
import type { ApiClient, ApiResponse } from "../client.js";

/**
 * Provides audience management operations via direct Meta Marketing API calls.
 * Handles custom audience creation (customer lists, website visitors, app users),
 * lookalike audience generation, and audience lifecycle management.
 *
 * @example
 * ```typescript
 * const audiences = new AudienceEndpoints(apiClient);
 * const custom = await audiences.createCustomAudience("act_123", {
 *   name: "Website Visitors 30d",
 *   subtype: "WEBSITE",
 *   retention_days: 30,
 * });
 * const lookalike = await audiences.createLookalikeAudience(
 *   "act_123", custom.id, "US", 0.01,
 * );
 * ```
 */
export class AudienceEndpoints {
	constructor(private readonly api: ApiClient) {}

	/**
	 * Lists all custom audiences for the specified ad account.
	 *
	 * @param adAccountId - Ad account ID (format: "act_XXXXXXXXX").
	 * @returns Array of custom audiences.
	 */
	async listCustomAudiences(adAccountId: string): Promise<CustomAudience[]> {
		const response = await this.api.get<ApiResponse<CustomAudience[]>>(
			`/${adAccountId}/customaudiences`,
			{
				params: {
					fields: "id,name,subtype,approximate_count,retention_days,delivery_status,description",
				},
			},
		);
		return response.data;
	}

	/**
	 * Creates a new custom audience in the specified ad account.
	 * Custom audiences can be based on customer lists, website visitors,
	 * app activity, or engagement with Meta content.
	 *
	 * @param adAccountId - Ad account ID to create the audience in.
	 * @param params - Audience creation parameters.
	 * @returns The newly created custom audience.
	 */
	async createCustomAudience(
		adAccountId: string,
		params: CreateAudienceParams,
	): Promise<CustomAudience> {
		return this.api.post<CustomAudience>(`/${adAccountId}/customaudiences`, {
			name: params.name,
			subtype: params.subtype,
			...(params.description && { description: params.description }),
			...(params.retention_days && { retention_days: params.retention_days }),
			...(params.rule && { rule: params.rule }),
			...(params.customer_file_source && {
				customer_file_source: params.customer_file_source,
			}),
		});
	}

	/**
	 * Creates a lookalike audience based on an existing source audience.
	 * Lookalike audiences find new users who are similar to the source
	 * audience, enabling efficient prospecting campaigns.
	 *
	 * @param adAccountId - Ad account ID to create the audience in.
	 * @param sourceAudienceId - Source custom audience ID to model.
	 * @param country - Target country as ISO 3166-1 alpha-2 code.
	 * @param ratio - Similarity ratio (0.01 to 0.20). Lower values = more similar.
	 * @returns The newly created lookalike audience.
	 */
	async createLookalikeAudience(
		adAccountId: string,
		sourceAudienceId: string,
		country: string,
		ratio: number,
	): Promise<CustomAudience> {
		return this.api.post<CustomAudience>(`/${adAccountId}/customaudiences`, {
			name: `Lookalike (${country}, ${Math.round(ratio * 100)}%) - ${sourceAudienceId}`,
			subtype: "LOOKALIKE",
			origin_audience_id: sourceAudienceId,
			lookalike_spec: JSON.stringify({
				type: "similarity",
				country: country,
				ratio: ratio,
			}),
		});
	}

	/**
	 * Retrieves a single custom audience by ID.
	 *
	 * @param audienceId - Audience ID to retrieve.
	 * @returns Audience details.
	 * @throws {NotFoundError} If the audience does not exist.
	 */
	async getAudience(audienceId: string): Promise<CustomAudience> {
		return this.api.get<CustomAudience>(`/${audienceId}`, {
			params: {
				fields: "id,name,subtype,approximate_count,retention_days,delivery_status,description",
			},
		});
	}

	/**
	 * Deletes a custom audience by ID.
	 *
	 * @param audienceId - Audience ID to delete.
	 * @throws {NotFoundError} If the audience does not exist.
	 */
	async deleteAudience(audienceId: string): Promise<void> {
		await this.api.delete(`/${audienceId}`);
	}
}
