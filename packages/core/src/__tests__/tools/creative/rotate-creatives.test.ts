/**
 * @module __tests__/tools/creative/rotate-creatives.test
 *
 * Unit tests for the rotate-creatives tool.
 * Tests rotation state tracking, pause/activate logic, round-robin
 * advancement, and edge cases like pool boundary wrapping.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../../../llm/types.js";
import {
	clearRotationState,
	getRotationState,
	rotateCreativesTool,
	setRotationState,
} from "../../../tools/creative/rotate-creatives.js";
import type { CreativeToolContext, MetaClientLike } from "../../../tools/creative/types.js";

/**
 * Creates a mock MetaClient with configurable ads list.
 *
 * @param ads - Array of mock ad objects.
 * @returns A mocked MetaClientLike instance.
 */
function mockMetaClient(
	ads: Array<{ id: string; name: string; adset_id: string; status: string; creative_id: string }>,
): MetaClientLike {
	return {
		creatives: {
			create: vi.fn(),
			list: vi.fn(),
			get: vi.fn(),
			delete: vi.fn(),
		},
		ads: {
			list: vi.fn().mockResolvedValue(ads),
			update: vi.fn().mockImplementation(async (adId: string, params: { status?: string }) => ({
				id: adId,
				status: params.status ?? "ACTIVE",
			})),
		},
		insights: {
			query: vi.fn(),
		},
	};
}

/**
 * Creates a mock CreativeToolContext with the given MetaClient.
 */
function mockContext(metaClient: MetaClientLike): CreativeToolContext {
	return {
		sessionId: "test-session-001",
		dryRun: false,
		timestamp: "2026-04-30T12:00:00.000Z",
		llmProvider: {} as LLMProvider,
		metaClient,
	};
}

describe("rotate_creatives tool", () => {
	beforeEach(() => {
		clearRotationState();
	});

	it("should rotate from the first creative to the second on initial rotation", async () => {
		const ads = [
			{
				id: "ad_1",
				name: "Ad 1",
				adset_id: "adset_A",
				status: "ACTIVE",
				creative_id: "creative_a",
			},
			{
				id: "ad_2",
				name: "Ad 2",
				adset_id: "adset_A",
				status: "PAUSED",
				creative_id: "creative_b",
			},
		];

		const client = mockMetaClient(ads);
		const ctx = mockContext(client);

		const result = await rotateCreativesTool.execute(
			{
				adSetId: "adset_A",
				creativeIds: ["creative_a", "creative_b", "creative_c"],
				reason: "Scheduled rotation",
			},
			ctx as unknown as Parameters<typeof rotateCreativesTool.execute>[1],
		);

		expect(result.success).toBe(true);
		expect(result.data).not.toBeNull();

		const data = result.data as Record<string, unknown>;
		expect(data.previousCreativeId).toBe("creative_a");
		expect(data.nextCreativeId).toBe("creative_b");
		expect(data.newIndex).toBe(1);
	});

	it("should pause ads with the previous creative and activate ads with the next", async () => {
		const ads = [
			{
				id: "ad_1",
				name: "Ad 1",
				adset_id: "adset_A",
				status: "ACTIVE",
				creative_id: "creative_a",
			},
			{
				id: "ad_2",
				name: "Ad 2",
				adset_id: "adset_A",
				status: "PAUSED",
				creative_id: "creative_b",
			},
		];

		const client = mockMetaClient(ads);
		const ctx = mockContext(client);

		await rotateCreativesTool.execute(
			{
				adSetId: "adset_A",
				creativeIds: ["creative_a", "creative_b"],
				reason: "Test rotation",
			},
			ctx as unknown as Parameters<typeof rotateCreativesTool.execute>[1],
		);

		/* Should have paused ad_1 (creative_a, ACTIVE) */
		expect(client.ads.update).toHaveBeenCalledWith("ad_1", { status: "PAUSED" });
		/* Should have activated ad_2 (creative_b, PAUSED) */
		expect(client.ads.update).toHaveBeenCalledWith("ad_2", { status: "ACTIVE" });
	});

	it("should persist rotation state after execution", async () => {
		const ads = [
			{
				id: "ad_1",
				name: "Ad 1",
				adset_id: "adset_A",
				status: "ACTIVE",
				creative_id: "creative_a",
			},
			{
				id: "ad_2",
				name: "Ad 2",
				adset_id: "adset_A",
				status: "PAUSED",
				creative_id: "creative_b",
			},
		];

		const client = mockMetaClient(ads);
		const ctx = mockContext(client);

		await rotateCreativesTool.execute(
			{
				adSetId: "adset_A",
				creativeIds: ["creative_a", "creative_b", "creative_c"],
				reason: "Fatigue rotation",
			},
			ctx as unknown as Parameters<typeof rotateCreativesTool.execute>[1],
		);

		const state = getRotationState("adset_A");
		expect(state).toBeDefined();
		expect(state?.currentIndex).toBe(1);
		expect(state?.lastRotationReason).toBe("Fatigue rotation");
		expect(state?.lastRotatedAt).toBe("2026-04-30T12:00:00.000Z");
	});

	it("should advance to the next creative on subsequent rotations", async () => {
		/* Set initial state: currently at index 1 */
		setRotationState({
			adSetId: "adset_A",
			creativeIds: ["creative_a", "creative_b", "creative_c"],
			currentIndex: 1,
			lastRotationReason: "initial",
			lastRotatedAt: "2026-04-29T12:00:00.000Z",
		});

		const ads = [
			{
				id: "ad_1",
				name: "Ad 1",
				adset_id: "adset_A",
				status: "PAUSED",
				creative_id: "creative_a",
			},
			{
				id: "ad_2",
				name: "Ad 2",
				adset_id: "adset_A",
				status: "ACTIVE",
				creative_id: "creative_b",
			},
			{
				id: "ad_3",
				name: "Ad 3",
				adset_id: "adset_A",
				status: "PAUSED",
				creative_id: "creative_c",
			},
		];

		const client = mockMetaClient(ads);
		const ctx = mockContext(client);

		const result = await rotateCreativesTool.execute(
			{
				adSetId: "adset_A",
				creativeIds: ["creative_a", "creative_b", "creative_c"],
				reason: "Next rotation",
			},
			ctx as unknown as Parameters<typeof rotateCreativesTool.execute>[1],
		);

		const data = result.data as Record<string, unknown>;
		expect(data.previousCreativeId).toBe("creative_b");
		expect(data.nextCreativeId).toBe("creative_c");
		expect(data.newIndex).toBe(2);
	});

	it("should wrap around to index 0 when reaching the end of the pool", async () => {
		/* Set state at the last index */
		setRotationState({
			adSetId: "adset_A",
			creativeIds: ["creative_a", "creative_b", "creative_c"],
			currentIndex: 2,
			lastRotationReason: "previous",
			lastRotatedAt: "2026-04-28T12:00:00.000Z",
		});

		const ads = [
			{
				id: "ad_1",
				name: "Ad 1",
				adset_id: "adset_A",
				status: "PAUSED",
				creative_id: "creative_a",
			},
			{
				id: "ad_2",
				name: "Ad 2",
				adset_id: "adset_A",
				status: "PAUSED",
				creative_id: "creative_b",
			},
			{
				id: "ad_3",
				name: "Ad 3",
				adset_id: "adset_A",
				status: "ACTIVE",
				creative_id: "creative_c",
			},
		];

		const client = mockMetaClient(ads);
		const ctx = mockContext(client);

		const result = await rotateCreativesTool.execute(
			{
				adSetId: "adset_A",
				creativeIds: ["creative_a", "creative_b", "creative_c"],
				reason: "Wrap around test",
			},
			ctx as unknown as Parameters<typeof rotateCreativesTool.execute>[1],
		);

		const data = result.data as Record<string, unknown>;
		expect(data.previousCreativeId).toBe("creative_c");
		expect(data.nextCreativeId).toBe("creative_a");
		expect(data.newIndex).toBe(0);
	});

	it("should fail when fewer than 2 creatives are provided", async () => {
		const client = mockMetaClient([]);
		const ctx = mockContext(client);

		const result = await rotateCreativesTool.execute(
			{
				adSetId: "adset_A",
				creativeIds: ["creative_a"],
				reason: "Not enough creatives",
			},
			ctx as unknown as Parameters<typeof rotateCreativesTool.execute>[1],
		);

		expect(result.success).toBe(false);
		expect(result.message).toContain("at least 2");
	});

	it("should only affect ads in the specified ad set", async () => {
		const ads = [
			{
				id: "ad_1",
				name: "Ad 1",
				adset_id: "adset_A",
				status: "ACTIVE",
				creative_id: "creative_a",
			},
			{
				id: "ad_2",
				name: "Ad 2",
				adset_id: "adset_B",
				status: "ACTIVE",
				creative_id: "creative_a",
			},
			{
				id: "ad_3",
				name: "Ad 3",
				adset_id: "adset_A",
				status: "PAUSED",
				creative_id: "creative_b",
			},
		];

		const client = mockMetaClient(ads);
		const ctx = mockContext(client);

		await rotateCreativesTool.execute(
			{
				adSetId: "adset_A",
				creativeIds: ["creative_a", "creative_b"],
				reason: "Isolation test",
			},
			ctx as unknown as Parameters<typeof rotateCreativesTool.execute>[1],
		);

		/* ad_2 belongs to adset_B, should NOT be paused */
		const updateCalls = (client.ads.update as ReturnType<typeof vi.fn>).mock.calls;
		const updatedAdIds = updateCalls.map((call: unknown[]) => call[0]);
		expect(updatedAdIds).not.toContain("ad_2");
	});

	it("should return dry run result when dryRun is true", async () => {
		const client = mockMetaClient([]);
		const ctx = mockContext(client);
		(ctx as { dryRun: boolean }).dryRun = true;

		const result = await rotateCreativesTool.execute(
			{
				adSetId: "adset_A",
				creativeIds: ["creative_a", "creative_b"],
				reason: "Dry run test",
			},
			ctx as unknown as Parameters<typeof rotateCreativesTool.execute>[1],
		);

		expect(result.success).toBe(true);
		expect(result.message).toContain("Dry run");
		expect(client.ads.list).not.toHaveBeenCalled();
	});

	it("should have correct tool metadata", () => {
		expect(rotateCreativesTool.name).toBe("rotate_creatives");
		expect(rotateCreativesTool.description).toBeTruthy();
		expect(rotateCreativesTool.parameters).toBeDefined();
	});
});
