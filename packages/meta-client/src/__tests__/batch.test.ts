/**
 * @module __tests__/batch
 *
 * Unit tests for the BatchEndpoints class. Validates batch execution with
 * mocked ApiClient, partial failure handling, batch size enforcement,
 * and automatic chunking for large operation sets.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BatchEndpoints } from "../api/endpoints/batch.js";
import type { ApiClient } from "../api/client.js";
import type { BatchRequest, BatchResponse } from "../types.js";
import { MetaError } from "../errors.js";

/**
 * Creates a mock ApiClient with typed method stubs.
 */
function createMockApiClient(): ApiClient {
	return {
		get: vi.fn(),
		post: vi.fn(),
		delete: vi.fn(),
		getRateLimiter: vi.fn(),
	} as unknown as ApiClient;
}

describe("BatchEndpoints", () => {
	let api: ApiClient;
	let batch: BatchEndpoints;

	beforeEach(() => {
		api = createMockApiClient();
		batch = new BatchEndpoints(api);
	});

	describe("execute()", () => {
		it("sends batch requests to the root endpoint", async () => {
			const requests: BatchRequest[] = [
				{ method: "GET", relative_url: "/campaign_123?fields=id,status" },
				{ method: "GET", relative_url: "/campaign_456?fields=id,status" },
			];

			const mockResponses: BatchResponse[] = [
				{ code: 200, body: '{"id":"campaign_123","status":"ACTIVE"}' },
				{ code: 200, body: '{"id":"campaign_456","status":"PAUSED"}' },
			];

			vi.mocked(api.post).mockResolvedValue(mockResponses);

			const results = await batch.execute(requests);

			expect(api.post).toHaveBeenCalledWith("/", {
				batch: JSON.stringify([
					{ method: "GET", relative_url: "/campaign_123?fields=id,status" },
					{ method: "GET", relative_url: "/campaign_456?fields=id,status" },
				]),
			});
			expect(results).toHaveLength(2);
			expect(results[0].code).toBe(200);
		});

		it("handles partial failures gracefully", async () => {
			const requests: BatchRequest[] = [
				{ method: "GET", relative_url: "/campaign_123" },
				{ method: "GET", relative_url: "/campaign_nonexistent" },
				{ method: "POST", relative_url: "/campaign_456", body: "status=PAUSED" },
			];

			const mockResponses: BatchResponse[] = [
				{ code: 200, body: '{"id":"campaign_123"}' },
				{ code: 404, body: '{"error":{"message":"Not found"}}' },
				{ code: 200, body: '{"success":true}' },
			];

			vi.mocked(api.post).mockResolvedValue(mockResponses);

			const results = await batch.execute(requests);

			expect(results).toHaveLength(3);
			expect(results[0].code).toBe(200);
			expect(results[1].code).toBe(404);
			expect(results[2].code).toBe(200);
		});

		it("preserves request names in responses", async () => {
			const requests: BatchRequest[] = [
				{ method: "GET", relative_url: "/campaign_123", name: "get_campaign" },
				{ method: "POST", relative_url: "/campaign_456", body: "status=PAUSED", name: "pause_campaign" },
			];

			const mockResponses: BatchResponse[] = [
				{ code: 200, body: '{"id":"campaign_123"}' },
				{ code: 200, body: '{"success":true}' },
			];

			vi.mocked(api.post).mockResolvedValue(mockResponses);

			const results = await batch.execute(requests);

			expect(results[0].name).toBe("get_campaign");
			expect(results[1].name).toBe("pause_campaign");
		});

		it("returns empty array for empty request list", async () => {
			const results = await batch.execute([]);

			expect(results).toEqual([]);
			expect(api.post).not.toHaveBeenCalled();
		});

		it("throws MetaError when batch size exceeds 50", async () => {
			const requests: BatchRequest[] = Array.from({ length: 51 }, (_, i) => ({
				method: "GET" as const,
				relative_url: `/campaign_${i}`,
			}));

			await expect(batch.execute(requests)).rejects.toThrow(MetaError);
			await expect(batch.execute(requests)).rejects.toThrow("exceeds maximum of 50");
		});

		it("includes request body for POST operations", async () => {
			const requests: BatchRequest[] = [
				{
					method: "POST",
					relative_url: "/campaign_123",
					body: "status=PAUSED&name=Updated",
				},
			];

			vi.mocked(api.post).mockResolvedValue([
				{ code: 200, body: '{"success":true}' },
			]);

			await batch.execute(requests);

			const batchPayload = JSON.parse(
				(vi.mocked(api.post).mock.calls[0][1] as { batch: string }).batch,
			);
			expect(batchPayload[0].body).toBe("status=PAUSED&name=Updated");
		});
	});

	describe("executeAll()", () => {
		it("returns empty array for empty request list", async () => {
			const results = await batch.executeAll([]);

			expect(results).toEqual([]);
		});

		it("processes requests in a single batch when under 50", async () => {
			const requests: BatchRequest[] = Array.from({ length: 10 }, (_, i) => ({
				method: "GET" as const,
				relative_url: `/campaign_${i}`,
			}));

			const mockResponses = requests.map((_, i) => ({
				code: 200,
				body: `{"id":"campaign_${i}"}`,
			}));

			vi.mocked(api.post).mockResolvedValue(mockResponses);

			const results = await batch.executeAll(requests);

			expect(results).toHaveLength(10);
			expect(api.post).toHaveBeenCalledTimes(1);
		});

		it("automatically chunks requests exceeding 50 into multiple batches", async () => {
			const requests: BatchRequest[] = Array.from({ length: 120 }, (_, i) => ({
				method: "GET" as const,
				relative_url: `/campaign_${i}`,
			}));

			// Mock three batch responses (50 + 50 + 20)
			vi.mocked(api.post)
				.mockResolvedValueOnce(
					Array.from({ length: 50 }, (_, i) => ({
						code: 200,
						body: `{"id":"campaign_${i}"}`,
					})),
				)
				.mockResolvedValueOnce(
					Array.from({ length: 50 }, (_, i) => ({
						code: 200,
						body: `{"id":"campaign_${50 + i}"}`,
					})),
				)
				.mockResolvedValueOnce(
					Array.from({ length: 20 }, (_, i) => ({
						code: 200,
						body: `{"id":"campaign_${100 + i}"}`,
					})),
				);

			const results = await batch.executeAll(requests);

			expect(results).toHaveLength(120);
			expect(api.post).toHaveBeenCalledTimes(3);
		});

		it("preserves order across multiple batch chunks", async () => {
			const requests: BatchRequest[] = Array.from({ length: 60 }, (_, i) => ({
				method: "GET" as const,
				relative_url: `/campaign_${i}`,
				name: `req_${i}`,
			}));

			vi.mocked(api.post)
				.mockResolvedValueOnce(
					Array.from({ length: 50 }, (_, i) => ({
						code: 200,
						body: `{"index":${i}}`,
						name: `req_${i}`,
					})),
				)
				.mockResolvedValueOnce(
					Array.from({ length: 10 }, (_, i) => ({
						code: 200,
						body: `{"index":${50 + i}}`,
						name: `req_${50 + i}`,
					})),
				);

			const results = await batch.executeAll(requests);

			expect(results).toHaveLength(60);
			expect(results[0].name).toBe("req_0");
			expect(results[49].name).toBe("req_49");
			expect(results[50].name).toBe("req_50");
			expect(results[59].name).toBe("req_59");
		});
	});
});
