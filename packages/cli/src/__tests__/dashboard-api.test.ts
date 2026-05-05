/**
 * @module __tests__/dashboard-api
 *
 * End-to-end smoke tests for the dashboard's `/api/*` routes,
 * exercising them via Hono's `app.fetch` against an in-memory SQLite
 * + a stubbed MetaClient. NO real network, no real port, no daemon.
 *
 * Why this exists: this codebase has shipped four scaffold-shape bugs
 * (PRs #18, #20, #21, and the one fixed inside #27) where the
 * dashboard frontend types declared one shape and the backend
 * returned another. Those drift bugs are caught by asserting, in this
 * file, that the response payload contains every field name the
 * frontend's `dashboard/src/api/client.ts` interfaces declare.
 *
 * If you find yourself adding a field to a backend route, mirror the
 * shape into the corresponding frontend interface AND add an
 * assertion here so the next contributor doesn't break the contract
 * silently.
 */

import {
	AuditLogger,
	CampaignGoalRepository,
	DrizzleAuditDatabase,
	bootstrapSqliteSchema,
} from "@meta-ads-agent/core";
import type { AgentConfig } from "@meta-ads-agent/core";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type DashboardApiDeps,
	type DashboardIpcClient,
	registerDashboardApiRoutes,
} from "../commands/dashboard-api.js";

/* ---------- Test fixtures ---------- */

const AD_ACCOUNT_ID = "act_1234567890";

/**
 * Minimal AgentConfig the routes need. Only the fields the routes
 * actually read are populated; the rest can stay undefined and the
 * routes shouldn't notice.
 */
function makeCfg(): AgentConfig {
	return {
		metaAdAccountId: AD_ACCOUNT_ID,
		metaAccessToken: "test-token",
		llmProvider: "claude",
		anthropicApiKey: "test-anth",
		openaiApiKey: undefined,
		dbType: "sqlite",
		sqlitePath: ":memory:",
		postgresUrl: undefined,
		tickIntervalMs: 60_000,
		retryBackoffMs: 1000,
		maxRetries: 3,
		dryRun: false,
	} as unknown as AgentConfig;
}

/**
 * Build a stub MetaClient that returns canned data. Each test can
 * override entries via the `overrides` arg to simulate specific scenarios.
 */
interface MetaClientStub {
	campaigns: {
		list: () => Promise<unknown[]>;
		get: (id: string) => Promise<unknown>;
	};
	adSets: {
		list: () => Promise<unknown[]>;
	};
	ads: {
		list: () => Promise<unknown[]>;
	};
	insights: {
		query: (id: string, params: unknown) => Promise<unknown[]>;
	};
}

interface StubData {
	campaigns?: Array<{
		id: string;
		name: string;
		status: string;
		objective: string;
		daily_budget?: string;
	}>;
	adSets?: Array<{
		id: string;
		name: string;
		campaign_id: string;
		status: string;
		daily_budget?: string;
	}>;
	ads?: Array<{ id: string; name: string; adset_id: string; status: string }>;
	insights?: {
		campaign?: Array<Record<string, unknown>>;
		adset?: Array<Record<string, unknown>>;
		ad?: Array<Record<string, unknown>>;
		account?: Array<Record<string, unknown>>;
	};
	getCampaign?: (id: string) => unknown;
}

function makeMetaClientStub(data: StubData = {}): MetaClientStub {
	return {
		campaigns: {
			list: async () => data.campaigns ?? [],
			get: async (id: string) =>
				data.getCampaign?.(id) ??
				data.campaigns?.find((c) => c.id === id) ?? { id, name: "?", status: "ACTIVE" },
		},
		adSets: {
			list: async () => data.adSets ?? [],
		},
		ads: {
			list: async () => data.ads ?? [],
		},
		insights: {
			query: async (_id: string, params: unknown) => {
				const level = (params as { level?: string } | undefined)?.level;
				const bucket = data.insights?.[level as keyof NonNullable<StubData["insights"]>];
				return bucket ?? [];
			},
		},
	};
}

/**
 * Build a fully-wired, in-memory dashboard environment. Returns the
 * Hono app plus refs to the underlying DB + repos so tests can seed
 * data directly.
 */
function buildEnv(metaClientData: StubData = {}): {
	app: Hono;
	deps: DashboardApiDeps;
	close: () => void;
	seed: (fn: () => Promise<void>) => Promise<void>;
} {
	const sqlite = new Database(":memory:");
	bootstrapSqliteSchema(sqlite);
	const db = drizzle(sqlite);
	/* Build a DatabaseConnection-shaped object the routes accept. The
	 * routes only ever read `.db`, so the type field and close() are
	 * stubs to satisfy the structural type. */
	const dbConn = {
		db,
		type: "sqlite" as const,
		close: () => sqlite.close(),
	};
	const auditLogger = new AuditLogger(new DrizzleAuditDatabase(dbConn.db));
	const goalRepo = new CampaignGoalRepository(dbConn.db);

	const ipc: DashboardIpcClient = {
		send: async () => null /* stand in for "no live daemon"; the routes fall through to DB */,
	};

	const stub = makeMetaClientStub(metaClientData);
	const deps: DashboardApiDeps = {
		dbConn,
		auditLogger,
		goalRepo,
		ipc,
		cfg: makeCfg(),
		getMetaClient: async () =>
			stub as unknown as Awaited<ReturnType<DashboardApiDeps["getMetaClient"]>>,
	};

	const app = new Hono();
	registerDashboardApiRoutes(app, deps);

	return {
		app,
		deps,
		close: () => sqlite.close(),
		seed: async (fn: () => Promise<void>) => {
			await fn();
		},
	};
}

/* ---------- Tests ---------- */

describe("dashboard API routes", () => {
	let env: ReturnType<typeof buildEnv>;

	beforeEach(() => {
		env = buildEnv();
	});

	afterEach(() => {
		env?.close();
	});

	describe("/api/status", () => {
		it("returns the stopped state with zero ticks when no session row exists", async () => {
			const res = await env.app.request("/api/status");
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, unknown>;
			/* Frontend AgentStatus interface (api/client.ts) declares:
			 * state, sessionId, startedAt, lastTickAt, nextTickAt, tickCount.
			 * Verify each is present \u2014 future drift will fail this assertion. */
			for (const key of [
				"state",
				"sessionId",
				"startedAt",
				"lastTickAt",
				"nextTickAt",
				"tickCount",
			]) {
				expect(body, `missing ${key}`).toHaveProperty(key);
			}
			expect(body.state).toBe("stopped");
			expect(body.tickCount).toBe(0);
		});
	});

	describe("/api/decisions", () => {
		it("annotates _pending_guidance rows with resolved=true once a goal is configured", async () => {
			/* Write a synthetic _pending_guidance audit row exactly as the
			 * agent does in agent/session.ts. */
			await env.deps.auditLogger.logDecision({
				sessionId: "test-session-1",
				adAccountId: AD_ACCOUNT_ID,
				toolName: "_pending_guidance",
				params: {
					campaignId: "camp-1",
					campaignName: "Test Campaign 1",
					currentObjective: "OUTCOME_SALES",
					reason: "no_goal_configured",
				},
				reasoning: "Awaiting guidance",
				expectedOutcome: "PENDING_GUIDANCE",
				score: 0,
				riskLevel: "high",
				success: false,
				resultData: null,
				errorMessage: "needs goal",
			});

			/* Read back \u2014 should NOT be resolved yet (no goal). */
			let res = await env.app.request("/api/decisions?limit=10");
			let body = (await res.json()) as Array<Record<string, unknown>>;
			expect(body).toHaveLength(1);
			expect(body[0].toolName).toBe("_pending_guidance");
			expect(body[0].resolved).toBeFalsy();

			/* Configure a matching goal. */
			await env.deps.goalRepo.upsert({
				adAccountId: AD_ACCOUNT_ID,
				campaignId: "camp-1",
				primaryKpi: "roas",
				primaryKpiTarget: 4,
				primaryKpiDirection: "maximize",
				lastSeenObjective: "OUTCOME_SALES",
				configuredBy: "test",
			});

			/* Read again \u2014 should be marked resolved with the goal db id. */
			res = await env.app.request("/api/decisions?limit=10");
			body = (await res.json()) as Array<Record<string, unknown>>;
			expect(body[0].resolved).toBe(true);
			expect(body[0]).toHaveProperty("resolvedByGoalDbId");
			expect(body[0]).toHaveProperty("resolvedAt");
		});

		it("does NOT mark a row resolved when the goal's objective doesn't match", async () => {
			await env.deps.auditLogger.logDecision({
				sessionId: "test-session-2",
				adAccountId: AD_ACCOUNT_ID,
				toolName: "_pending_guidance",
				params: {
					campaignId: "camp-2",
					campaignName: "Drifted Campaign",
					currentObjective: "OUTCOME_LEADS",
					reason: "objective_changed",
				},
				reasoning: "drifted",
				expectedOutcome: "PENDING_GUIDANCE",
				score: 0,
				riskLevel: "high",
				success: false,
				resultData: null,
				errorMessage: null,
			});
			/* Goal exists but for a DIFFERENT objective \u2014 the row predates
			 * a re-prompt, shouldn't be auto-resolved. */
			await env.deps.goalRepo.upsert({
				adAccountId: AD_ACCOUNT_ID,
				campaignId: "camp-2",
				primaryKpi: "roas",
				primaryKpiTarget: 3,
				primaryKpiDirection: "maximize",
				lastSeenObjective: "OUTCOME_SALES" /* row recorded LEADS */,
				configuredBy: "test",
			});

			const res = await env.app.request("/api/decisions");
			const body = (await res.json()) as Array<Record<string, unknown>>;
			expect(body[0].resolved).toBeFalsy();
		});
	});

	describe("/api/campaigns", () => {
		it("returns the full campaign \u2192 adSet \u2192 ad hierarchy with frontend-expected shape", async () => {
			env.close();
			env = buildEnv({
				campaigns: [
					{
						id: "c-1",
						name: "Campaign 1",
						status: "ACTIVE",
						objective: "OUTCOME_SALES",
						daily_budget: "5000" /* 5000 cents = $50 */,
					},
				],
				adSets: [
					{
						id: "as-1",
						name: "Ad Set A",
						campaign_id: "c-1",
						status: "ACTIVE",
						daily_budget: "2500",
					},
				],
				ads: [{ id: "ad-1", name: "Creative 1", adset_id: "as-1", status: "ACTIVE" }],
				insights: {
					campaign: [
						{
							campaign_id: "c-1",
							spend: "100",
							impressions: "1000",
							clicks: "50",
							ctr: "0.05",
							actions: [{ action_type: "purchase", value: "5" }],
						},
					],
					adset: [
						{
							adset_id: "as-1",
							campaign_id: "c-1",
							spend: "60",
							impressions: "600",
							clicks: "30",
							ctr: "0.05",
							actions: [{ action_type: "purchase", value: "3" }],
						},
					],
					ad: [
						{
							ad_id: "ad-1",
							adset_id: "as-1",
							campaign_id: "c-1",
							spend: "30",
							impressions: "300",
							clicks: "15",
							ctr: "0.05",
							actions: [{ action_type: "purchase", value: "2" }],
						},
					],
				},
			});

			const res = await env.app.request("/api/campaigns");
			expect(res.status).toBe(200);
			const body = (await res.json()) as Array<Record<string, unknown>>;
			expect(body).toHaveLength(1);

			const camp = body[0];
			/* Mirror of `CampaignMetrics` in dashboard/src/api/client.ts.
			 * If a field name drifts on either side this assertion fails. */
			for (const key of [
				"id",
				"name",
				"status",
				"objective",
				"dailyBudget",
				"spend7d",
				"roas7d",
				"cpa7d",
				"impressions7d",
				"clicks7d",
				"conversions7d",
				"goal",
				"adSets",
			]) {
				expect(camp, `campaign missing ${key}`).toHaveProperty(key);
			}
			expect(camp.id).toBe("c-1");
			expect(camp.dailyBudget).toBe(50);
			expect(camp.goal).toBeNull();
			expect(camp.adSets).toBeInstanceOf(Array);
			expect((camp.adSets as unknown[]).length).toBe(1);

			const adSet = (camp.adSets as Array<Record<string, unknown>>)[0];
			for (const key of [
				"id",
				"name",
				"status",
				"dailyBudget",
				"spend7d",
				"roas7d",
				"cpa7d",
				"impressions7d",
				"clicks7d",
				"conversions7d",
				"ads",
			]) {
				expect(adSet, `adSet missing ${key}`).toHaveProperty(key);
			}
			expect(adSet.dailyBudget).toBe(25);
			expect(adSet.ads).toBeInstanceOf(Array);
			expect((adSet.ads as unknown[]).length).toBe(1);

			const ad = (adSet.ads as Array<Record<string, unknown>>)[0];
			for (const key of [
				"id",
				"name",
				"status",
				"spend7d",
				"roas7d",
				"cpa7d",
				"impressions7d",
				"clicks7d",
				"conversions7d",
			]) {
				expect(ad, `ad missing ${key}`).toHaveProperty(key);
			}
		});

		it("joins active goals into the campaign rows", async () => {
			env.close();
			env = buildEnv({
				campaigns: [
					{ id: "c-with-goal", name: "Goaled", status: "ACTIVE", objective: "OUTCOME_SALES" },
				],
			});
			await env.deps.goalRepo.upsert({
				adAccountId: AD_ACCOUNT_ID,
				campaignId: "c-with-goal",
				primaryKpi: "roas",
				primaryKpiTarget: 5,
				primaryKpiDirection: "maximize",
				lastSeenObjective: "OUTCOME_SALES",
				configuredBy: "test",
			});

			const res = await env.app.request("/api/campaigns");
			const body = (await res.json()) as Array<Record<string, unknown>>;
			expect(body[0].goal).not.toBeNull();
			const goal = body[0].goal as Record<string, unknown>;
			expect(goal.campaignId).toBe("c-with-goal");
			expect(goal.primaryKpi).toBe("roas");
			expect(goal.primaryKpiTarget).toBe(5);
		});
	});

	describe("/api/goals", () => {
		it("round-trips upsert \u2192 list \u2192 reset", async () => {
			/* Empty initially. */
			let res = await env.app.request("/api/goals");
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual([]);

			/* Create one. */
			res = await env.app.request("/api/goals", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					campaignId: "c-99",
					primaryKpi: "roas",
					primaryKpiTarget: 4,
					primaryKpiDirection: "maximize",
					lastSeenObjective: "OUTCOME_SALES",
				}),
			});
			expect(res.status).toBe(201);
			const created = (await res.json()) as Record<string, unknown>;
			expect(created.campaignId).toBe("c-99");
			expect(created.configuredBy).toBe("dashboard");
			expect(created.deletedAt).toBeNull();

			/* List shows it. */
			res = await env.app.request("/api/goals");
			let list = (await res.json()) as Array<Record<string, unknown>>;
			expect(list).toHaveLength(1);

			/* Soft-delete via DELETE. */
			res = await env.app.request("/api/goals/c-99", { method: "DELETE" });
			expect(res.status).toBe(200);
			const deleted = (await res.json()) as Record<string, unknown>;
			expect(deleted.success).toBe(true);

			/* List is empty again (tombstone wins; getActive returns null). */
			res = await env.app.request("/api/goals");
			list = (await res.json()) as Array<Record<string, unknown>>;
			expect(list).toHaveLength(0);
		});

		it("rejects POST with an invalid primaryKpi", async () => {
			const res = await env.app.request("/api/goals", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					campaignId: "c-1",
					primaryKpi: "not_a_kpi",
					primaryKpiTarget: 1,
					primaryKpiDirection: "maximize",
					lastSeenObjective: "OUTCOME_SALES",
				}),
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as Record<string, unknown>;
			expect(body.error).toMatch(/primaryKpi/);
		});

		it("rejects POST with a negative target", async () => {
			const res = await env.app.request("/api/goals", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					campaignId: "c-1",
					primaryKpi: "roas",
					primaryKpiTarget: -1,
					primaryKpiDirection: "maximize",
					lastSeenObjective: "OUTCOME_SALES",
				}),
			});
			expect(res.status).toBe(400);
		});

		it("returns 404 for GET on a campaign with no goal", async () => {
			const res = await env.app.request("/api/goals/no-such-campaign");
			expect(res.status).toBe(404);
		});

		it("/api/goals/defaults returns inferred defaults for known objectives", async () => {
			const res = await env.app.request("/api/goals/defaults?objective=OUTCOME_SALES");
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, unknown>;
			expect(body.primaryKpi).toBe("roas");
			expect(body.primaryKpiDirection).toBe("maximize");
		});
	});

	describe("/api/configuration", () => {
		it("returns runtime block + null guardrails when no agent_config row exists", async () => {
			const res = await env.app.request("/api/configuration");
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, unknown>;
			expect(body.guardrails).toBeNull();
			expect(body).toHaveProperty("runtime");
			const runtime = body.runtime as Record<string, unknown>;
			/* Mirror of frontend ConfigurationRuntime. */
			for (const key of ["llmProvider", "tickIntervalMinutes", "adAccountId", "dbType", "dryRun"]) {
				expect(runtime, `runtime missing ${key}`).toHaveProperty(key);
			}
			expect(runtime.adAccountId).toBe(AD_ACCOUNT_ID);
		});

		it("PUT round-trips: writes a row, GET reads it back", async () => {
			let res = await env.app.request("/api/configuration", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					roasTarget: 4.5,
					cpaCap: 30,
					dailyBudgetLimit: 750,
					riskLevel: "moderate",
				}),
			});
			expect(res.status).toBe(201);
			const created = (await res.json()) as Record<string, unknown>;
			expect(created).toHaveProperty("guardrails");
			expect((created.guardrails as Record<string, unknown>).roasTarget).toBe(4.5);
			expect(created.requiresDaemonRestart).toBe(true);

			res = await env.app.request("/api/configuration");
			const fetched = (await res.json()) as Record<string, unknown>;
			expect(fetched.guardrails).not.toBeNull();
			const g = fetched.guardrails as Record<string, unknown>;
			expect(g.roasTarget).toBe(4.5);
			expect(g.riskLevel).toBe("moderate");
		});

		it("PUT rejects an invalid riskLevel", async () => {
			const res = await env.app.request("/api/configuration", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					roasTarget: 4,
					cpaCap: 25,
					dailyBudgetLimit: 500,
					riskLevel: "yolo",
				}),
			});
			expect(res.status).toBe(400);
		});

		it("PUT rejects negative numeric values", async () => {
			const res = await env.app.request("/api/configuration", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					roasTarget: -1,
					cpaCap: 25,
					dailyBudgetLimit: 500,
					riskLevel: "moderate",
				}),
			});
			expect(res.status).toBe(400);
		});
	});

	describe("/api/metrics/roas-target", () => {
		it("returns null when nothing is configured", async () => {
			const res = await env.app.request("/api/metrics/roas-target");
			expect(res.status).toBe(200);
			const body = (await res.json()) as Record<string, unknown>;
			expect(body.target).toBeNull();
			expect(body.source).toBeNull();
		});

		it("falls back to agent_config when no roas-KPI campaigns exist", async () => {
			await env.app.request("/api/configuration", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					roasTarget: 6,
					cpaCap: 25,
					dailyBudgetLimit: 500,
					riskLevel: "moderate",
				}),
			});
			const res = await env.app.request("/api/metrics/roas-target");
			const body = (await res.json()) as Record<string, unknown>;
			expect(body.source).toBe("agent_config");
			expect(body.target).toBe(6);
		});

		it("computes spend-weighted target across roas-KPI goals", async () => {
			env.close();
			env = buildEnv({
				insights: {
					campaign: [
						{
							campaign_id: "big",
							spend: "900",
							impressions: "1",
							clicks: "1",
							ctr: "1",
							actions: [],
						},
						{
							campaign_id: "small",
							spend: "100",
							impressions: "1",
							clicks: "1",
							ctr: "1",
							actions: [],
						},
					],
				},
			});
			await env.deps.goalRepo.upsert({
				adAccountId: AD_ACCOUNT_ID,
				campaignId: "big",
				primaryKpi: "roas",
				primaryKpiTarget: 5,
				primaryKpiDirection: "maximize",
				lastSeenObjective: "OUTCOME_SALES",
				configuredBy: "test",
			});
			await env.deps.goalRepo.upsert({
				adAccountId: AD_ACCOUNT_ID,
				campaignId: "small",
				primaryKpi: "roas",
				primaryKpiTarget: 2,
				primaryKpiDirection: "maximize",
				lastSeenObjective: "OUTCOME_SALES",
				configuredBy: "test",
			});

			const res = await env.app.request("/api/metrics/roas-target");
			const body = (await res.json()) as Record<string, unknown>;
			expect(body.source).toBe("campaigns");
			expect(body.contributors).toBe(2);
			/* (5*900 + 2*100) / 1000 = 4700/1000 = 4.7 */
			expect(body.target).toBeCloseTo(4.7, 5);
		});
	});
});
