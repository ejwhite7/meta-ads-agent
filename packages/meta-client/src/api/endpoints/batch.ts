/**
 * @module api/endpoints/batch
 *
 * Batch API operations for executing multiple Meta Marketing API calls
 * in a single HTTP request. Supports up to 50 operations per batch,
 * with individual success/failure tracking for each operation.
 *
 * The batch API is not available through the meta-ads CLI and is essential
 * for efficient bulk operations like updating multiple campaigns, ad sets,
 * or ads simultaneously.
 */

import { MetaError } from "../../errors.js";
import type { BatchRequest, BatchResponse } from "../../types.js";
import type { ApiClient } from "../client.js";

/** Maximum number of operations allowed in a single batch request. */
const MAX_BATCH_SIZE = 50;

/**
 * Provides batch API operations for executing multiple Meta Marketing API
 * calls in a single HTTP request. Handles partial failures gracefully by
 * returning individual results for each operation.
 *
 * @example
 * ```typescript
 * const batch = new BatchEndpoints(apiClient);
 * const results = await batch.execute([
 *   { method: "GET", relative_url: "/campaign_123?fields=id,status" },
 *   { method: "POST", relative_url: "/campaign_456", body: "status=PAUSED" },
 *   { method: "GET", relative_url: "/campaign_789?fields=id,status" },
 * ]);
 * results.forEach((result) => {
 *   console.log(`Status: ${result.code}, Body: ${result.body}`);
 * });
 * ```
 */
export class BatchEndpoints {
	constructor(private readonly api: ApiClient) {}

	/**
	 * Executes up to 50 API operations in a single batch request.
	 * Returns individual results for each operation, preserving order.
	 *
	 * Operations that fail do not cause the entire batch to fail.
	 * Each operation has its own HTTP status code in the response.
	 * The caller should check individual response codes to handle
	 * partial failures.
	 *
	 * @param requests - Array of batch operations (max 50).
	 * @returns Array of individual operation results in the same order.
	 * @throws {MetaError} If the batch request itself fails (not individual operations).
	 * @throws {MetaError} If more than 50 operations are provided.
	 */
	async execute(requests: BatchRequest[]): Promise<BatchResponse[]> {
		if (requests.length === 0) {
			return [];
		}

		if (requests.length > MAX_BATCH_SIZE) {
			throw new MetaError(
				`Batch size ${requests.length} exceeds maximum of ${MAX_BATCH_SIZE}. Split the requests into multiple batches.`,
				"BATCH_SIZE_EXCEEDED",
			);
		}

		const batchPayload = requests.map((req) => ({
			method: req.method,
			relative_url: req.relative_url,
			...(req.body && { body: req.body }),
			...(req.name && { name: req.name }),
		}));

		const response = await this.api.post<BatchResponse[]>("/", {
			batch: JSON.stringify(batchPayload),
		});

		return this.mapResponses(requests, response);
	}

	/**
	 * Executes a large set of operations by automatically splitting them
	 * into batches of 50 and executing sequentially. Returns all results
	 * in the original order.
	 *
	 * @param requests - Array of batch operations (any size).
	 * @returns Array of individual operation results in the same order.
	 */
	async executeAll(requests: BatchRequest[]): Promise<BatchResponse[]> {
		if (requests.length === 0) {
			return [];
		}

		const results: BatchResponse[] = [];

		for (let i = 0; i < requests.length; i += MAX_BATCH_SIZE) {
			const chunk = requests.slice(i, i + MAX_BATCH_SIZE);
			const chunkResults = await this.execute(chunk);
			results.push(...chunkResults);
		}

		return results;
	}

	/**
	 * Maps batch API responses back to the original requests, preserving
	 * the name field from the request for correlation.
	 */
	private mapResponses(requests: BatchRequest[], responses: BatchResponse[]): BatchResponse[] {
		return responses.map((response, index) => ({
			...response,
			name: response.name ?? requests[index]?.name,
		}));
	}
}
