/**
 * @module api/endpoints/split-tests
 *
 * A/B split test creation and management via the Meta Marketing API.
 * Split tests allow comparing different ad variations (creative, audience,
 * placement, or delivery optimization) with statistically significant results.
 *
 * These operations are not available through the meta-ads CLI and require
 * direct API calls to the campaign-level split test endpoints.
 */

import type {
	SplitTest,
	SplitTestResults,
	CreateSplitTestParams,
} from "../../types.js";
import type { ApiClient, ApiResponse } from "../client.js";

/**
 * Provides A/B split test operations via direct Meta Marketing API calls.
 * Supports test creation with configurable variables, status monitoring,
 * and statistical result retrieval.
 *
 * @example
 * ```typescript
 * const splitTests = new SplitTestEndpoints(apiClient);
 * const test = await splitTests.create("act_123456", {
 *   name: "Creative Test Q4",
 *   split_test_type: "CREATIVE",
 *   campaign_id: "campaign_789",
 *   adset_ids: ["adset_1", "adset_2"],
 *   budget: "50000",
 *   end_time: "2026-12-31T23:59:59Z",
 * });
 * const results = await splitTests.getResults(test.id);
 * ```
 */
export class SplitTestEndpoints {
	constructor(private readonly api: ApiClient) {}

	/**
	 * Creates a new A/B split test for the specified ad account.
	 * Each test cell corresponds to an ad set with different creative,
	 * audience, placement, or optimization settings.
	 *
	 * @param adAccountId - Ad account ID (format: "act_XXXXXXXXX").
	 * @param params - Split test creation parameters.
	 * @returns The newly created split test.
	 */
	async create(adAccountId: string, params: CreateSplitTestParams): Promise<SplitTest> {
		return this.api.post<SplitTest>(`/${adAccountId}/ad_studies`, {
			name: params.name,
			type: params.split_test_type,
			start_time: new Date().toISOString(),
			end_time: params.end_time,
			cells: JSON.stringify(
				params.adset_ids.map((adsetId, index) => ({
					name: `Cell ${index + 1}`,
					treatment_percentage: Math.floor(100 / params.adset_ids.length),
					adsets: [adsetId],
				})),
			),
			...(params.budget && { budget: params.budget }),
		});
	}

	/**
	 * Retrieves a single split test by ID.
	 *
	 * @param splitTestId - Split test (ad study) ID.
	 * @returns Split test details including cells and status.
	 * @throws {NotFoundError} If the split test does not exist.
	 */
	async get(splitTestId: string): Promise<SplitTest> {
		return this.api.get<SplitTest>(`/${splitTestId}`, {
			params: {
				fields: "id,name,status,type,cells,start_time,end_time",
			},
		});
	}

	/**
	 * Lists all split tests for the specified ad account.
	 *
	 * @param adAccountId - Ad account ID (format: "act_XXXXXXXXX").
	 * @returns Array of split tests.
	 */
	async list(adAccountId: string): Promise<SplitTest[]> {
		const response = await this.api.get<ApiResponse<SplitTest[]>>(
			`/${adAccountId}/ad_studies`,
			{
				params: {
					fields: "id,name,status,type,cells,start_time,end_time",
				},
			},
		);
		return response.data;
	}

	/**
	 * Retrieves the statistical results for a split test.
	 * Returns per-cell performance metrics and significance indicators.
	 *
	 * @param splitTestId - Split test (ad study) ID.
	 * @returns Test results with significance and per-cell metrics.
	 * @throws {NotFoundError} If the split test does not exist.
	 */
	async getResults(splitTestId: string): Promise<SplitTestResults> {
		const response = await this.api.get<{
			id: string;
			results: SplitTestResults;
		}>(`/${splitTestId}`, {
			params: {
				fields: "id,results",
			},
		});

		return {
			split_test_id: splitTestId,
			is_significant: response.results?.is_significant ?? false,
			confidence_level: response.results?.confidence_level,
			winner_cell_id: response.results?.winner_cell_id,
			cell_results: response.results?.cell_results ?? [],
		};
	}
}
