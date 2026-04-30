/**
 * @module api/endpoints/previews
 *
 * Ad preview generation via the Meta Marketing API. Generates renderable
 * HTML iframe previews of ads in various placement formats (desktop feed,
 * mobile feed, Instagram stories, etc.) without requiring the ad to be
 * published or active.
 *
 * These operations are not available through the meta-ads CLI and require
 * direct API calls.
 */

import type { AdPreview, AdPreviewFormat } from "../../types.js";
import type { ApiClient, ApiResponse } from "../client.js";

/**
 * Provides ad preview generation via direct Meta Marketing API calls.
 * Generates HTML iframe previews of existing ads or ad creative
 * specifications in various placement formats.
 *
 * @example
 * ```typescript
 * const previews = new PreviewEndpoints(apiClient);
 * const preview = await previews.getAdPreview("ad_123456", "MOBILE_FEED_STANDARD");
 * console.log(preview.body); // HTML iframe code
 * ```
 */
export class PreviewEndpoints {
	constructor(private readonly api: ApiClient) {}

	/**
	 * Generates a preview for an existing ad in the specified format.
	 *
	 * @param adId - Ad ID to generate a preview for.
	 * @param format - Preview placement format.
	 * @returns Ad preview containing an HTML iframe embed code.
	 * @throws {NotFoundError} If the ad does not exist.
	 */
	async getAdPreview(adId: string, format: AdPreviewFormat): Promise<AdPreview> {
		const response = await this.api.get<ApiResponse<AdPreview[]>>(
			`/${adId}/previews`,
			{
				params: {
					ad_format: format,
				},
			},
		);
		return response.data[0];
	}

	/**
	 * Generates previews for an existing ad in multiple formats simultaneously.
	 *
	 * @param adId - Ad ID to generate previews for.
	 * @param formats - Array of preview placement formats.
	 * @returns Map of format to ad preview.
	 * @throws {NotFoundError} If the ad does not exist.
	 */
	async getAdPreviews(
		adId: string,
		formats: AdPreviewFormat[],
	): Promise<Map<AdPreviewFormat, AdPreview>> {
		const results = new Map<AdPreviewFormat, AdPreview>();

		for (const format of formats) {
			const preview = await this.getAdPreview(adId, format);
			results.set(format, preview);
		}

		return results;
	}

	/**
	 * Generates a preview from a creative specification without requiring
	 * an existing ad. Useful for previewing ads before creating them.
	 *
	 * @param adAccountId - Ad account ID (format: "act_XXXXXXXXX").
	 * @param creativeSpec - Creative specification object.
	 * @param format - Preview placement format.
	 * @returns Ad preview containing an HTML iframe embed code.
	 */
	async getCreativePreview(
		adAccountId: string,
		creativeSpec: Record<string, unknown>,
		format: AdPreviewFormat,
	): Promise<AdPreview> {
		const response = await this.api.get<ApiResponse<AdPreview[]>>(
			`/${adAccountId}/generatepreviews`,
			{
				params: {
					ad_format: format,
					creative: JSON.stringify(creativeSpec),
				},
			},
		);
		return response.data[0];
	}
}
