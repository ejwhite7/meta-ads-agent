/**
 * @module __tests__/api-endpoints
 *
 * Unit tests for the direct-API endpoint classes that replaced the
 * Python-CLI wrapper layer. Each test verifies:
 *   - The correct Marketing API path is hit.
 *   - The correct HTTP verb is used (GET / POST / DELETE).
 *   - Request parameters / bodies are shaped to match the Marketing API.
 *   - Responses are normalized into the meta-client type system.
 *
 * The ApiClient is mocked via a thin shim so tests run offline.
 */

import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../api/client.js";
import { AdEndpoints } from "../api/endpoints/ads.js";
import { AdSetEndpoints } from "../api/endpoints/adsets.js";
import { CampaignEndpoints } from "../api/endpoints/campaigns.js";
import { CreativeEndpoints } from "../api/endpoints/creatives.js";
import { InsightsEndpoints } from "../api/endpoints/insights.js";

interface ApiCall {
	method: "GET" | "POST" | "DELETE";
	path: string;
	body?: unknown;
	config?: unknown;
}

/**
 * Mock ApiClient that records every call and returns scripted responses.
 */
function makeMockApi(scripted: Record<string, unknown>): {
	client: ApiClient;
	calls: ApiCall[];
} {
	const calls: ApiCall[] = [];
	const respond = (path: string) => {
		const key = path.split("?")[0];
		return scripted[key] ?? scripted[path];
	};

	const client = {
		get: vi.fn(async (path: string, config?: unknown) => {
			calls.push({ method: "GET", path, config });
			return respond(path);
		}),
		post: vi.fn(async (path: string, body?: unknown, config?: unknown) => {
			calls.push({ method: "POST", path, body, config });
			return respond(path);
		}),
		delete: vi.fn(async (path: string, config?: unknown) => {
			calls.push({ method: "DELETE", path, config });
			return respond(path);
		}),
	} as unknown as ApiClient;

	return { client, calls };
}

describe("CampaignEndpoints", () => {
	it("list -> GET /<adAccountId>/campaigns with fields and limit", async () => {
		const { client, calls } = makeMockApi({
			"/act_123/campaigns": { data: [{ id: "c1", name: "First" }] },
		});
		const ep = new CampaignEndpoints(client);
		const result = await ep.list("act_123");

		expect(result).toEqual([{ id: "c1", name: "First" }]);
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe("GET");
		expect(calls[0].path).toBe("/act_123/campaigns");
		expect(
			(calls[0].config as { params: { fields: string; limit: number } }).params.fields,
		).toContain("id,name,status");
		expect((calls[0].config as { params: { limit: number } }).params.limit).toBe(200);
	});

	it("get -> GET /<campaignId> with fields", async () => {
		const { client, calls } = makeMockApi({
			"/c1": { id: "c1", name: "Campaign" },
		});
		const ep = new CampaignEndpoints(client);
		await ep.get("c1");

		expect(calls[0].path).toBe("/c1");
		expect((calls[0].config as { params: { fields: string } }).params.fields).toContain(
			"objective",
		);
	});

	it("create -> POST then GET; passes special_ad_categories=[] by default", async () => {
		const { client, calls } = makeMockApi({
			"/act_123/campaigns": { id: "c_new" },
			"/c_new": { id: "c_new", name: "New", status: "PAUSED" },
		});
		const ep = new CampaignEndpoints(client);
		const result = await ep.create("act_123", {
			name: "New",
			objective: "OUTCOME_SALES",
		});

		expect(result.id).toBe("c_new");
		expect(calls[0].method).toBe("POST");
		expect(calls[0].path).toBe("/act_123/campaigns");
		expect((calls[0].body as { special_ad_categories: unknown[] }).special_ad_categories).toEqual(
			[],
		);
		/* Second call is the post-create GET */
		expect(calls[1].method).toBe("GET");
		expect(calls[1].path).toBe("/c_new");
	});

	it("update -> POST /<id> with only the changed fields, then GET", async () => {
		const { client, calls } = makeMockApi({
			"/c1": { id: "c1", name: "Updated" },
		});
		const ep = new CampaignEndpoints(client);
		await ep.update("c1", { daily_budget: "8000" });

		expect(calls[0].method).toBe("POST");
		expect(calls[0].path).toBe("/c1");
		expect(calls[0].body).toEqual({ daily_budget: "8000" });
	});

	it("delete -> DELETE /<id>", async () => {
		const { client, calls } = makeMockApi({ "/c1": { success: true } });
		const ep = new CampaignEndpoints(client);
		await ep.delete("c1");

		expect(calls[0].method).toBe("DELETE");
		expect(calls[0].path).toBe("/c1");
	});
});

describe("AdSetEndpoints", () => {
	it("list -> GET /<adAccountId>/adsets", async () => {
		const { client, calls } = makeMockApi({
			"/act_123/adsets": { data: [] },
		});
		const ep = new AdSetEndpoints(client);
		await ep.list("act_123");
		expect(calls[0].path).toBe("/act_123/adsets");
	});

	it("delete -> DELETE /<adSetId>", async () => {
		const { client, calls } = makeMockApi({ "/as1": { success: true } });
		const ep = new AdSetEndpoints(client);
		await ep.delete("as1");
		expect(calls[0]).toEqual({ method: "DELETE", path: "/as1", config: undefined });
	});
});

describe("AdEndpoints", () => {
	it("normalizes creative.id -> creative_id on read", async () => {
		const { client } = makeMockApi({
			"/ad1": {
				id: "ad1",
				name: "Ad",
				adset_id: "as1",
				status: "ACTIVE",
				creative: { id: "cr1" },
				created_time: "2024-01-01T00:00:00Z",
				updated_time: "2024-01-02T00:00:00Z",
			},
		});
		const ep = new AdEndpoints(client);
		const result = await ep.get("ad1");
		expect(result.creative_id).toBe("cr1");
	});

	it("create wraps creative_id into { creative: { creative_id } } body", async () => {
		const { client, calls } = makeMockApi({
			"/act_123/ads": { id: "ad_new" },
			"/ad_new": {
				id: "ad_new",
				name: "Ad",
				adset_id: "as1",
				status: "PAUSED",
				creative: { id: "cr1" },
				created_time: "x",
				updated_time: "y",
			},
		});
		const ep = new AdEndpoints(client);
		await ep.create("act_123", { name: "Ad", adset_id: "as1", creative_id: "cr1" });
		expect((calls[0].body as { creative: unknown }).creative).toEqual({ creative_id: "cr1" });
	});
});

describe("CreativeEndpoints", () => {
	it("list -> GET /<adAccountId>/adcreatives", async () => {
		const { client, calls } = makeMockApi({ "/act_123/adcreatives": { data: [] } });
		const ep = new CreativeEndpoints(client);
		await ep.list("act_123");
		expect(calls[0].path).toBe("/act_123/adcreatives");
	});
});

describe("InsightsEndpoints", () => {
	it("query -> GET /<adAccountId>/insights with serialized params", async () => {
		const { client, calls } = makeMockApi({
			"/act_123/insights": {
				data: [
					{
						campaign_id: "c1",
						impressions: "100",
						clicks: "10",
						spend: "5",
						ctr: "0.1",
						cpm: "5",
						date_start: "2024-01-01",
						date_stop: "2024-01-01",
					},
				],
			},
		});
		const ep = new InsightsEndpoints(client);
		const result = await ep.query("act_123", {
			level: "campaign",
			date_preset: "last_7d",
			breakdowns: ["age", "gender"],
			filtering: [{ field: "campaign.id", operator: "EQUAL", value: "c1" }],
		});

		expect(result).toHaveLength(1);
		const params = (calls[0].config as { params: Record<string, unknown> }).params;
		expect(params.level).toBe("campaign");
		expect(params.date_preset).toBe("last_7d");
		expect(params.fields).toContain("impressions");
		/* breakdowns flattened into a comma-separated string */
		expect(params.breakdowns).toBe("age,gender");
		/* filtering JSON-encoded */
		expect(typeof params.filtering).toBe("string");
		expect(JSON.parse(params.filtering as string)).toEqual([
			{ field: "campaign.id", operator: "EQUAL", value: "c1" },
		]);
	});

	it("respects custom field list when provided", async () => {
		const { client, calls } = makeMockApi({ "/act_x/insights": { data: [] } });
		const ep = new InsightsEndpoints(client);
		await ep.query("act_x", { level: "account", fields: ["spend", "impressions"] });
		expect((calls[0].config as { params: { fields: string } }).params.fields).toBe(
			"spend,impressions",
		);
	});
});
