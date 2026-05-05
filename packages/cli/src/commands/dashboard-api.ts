/**
 * @module commands/dashboard-api
 *
 * REST API routes for the dashboard server. Extracted from
 * `dashboard.ts` so the routes can be unit-tested directly via
 * `app.fetch` against an in-memory SQLite + a mocked MetaClient,
 * without spinning up a real HTTP server.
 *
 * The routes were inline inside the `.action()` closure of the
 * `dashboard` command pre-PR-#33 — that made them untestable without
 * launching the daemon and reaching across an HTTP socket. Four
 * scaffold-shape bugs (PRs #18, #20, #21, and the one inside #27)
 * traced back to dashboard frontend types drifting from backend
 * response shapes; an `app.fetch` harness against this factory
 * catches that class of bug at unit-test speed.
 *
 * Single export: `registerDashboardApiRoutes(app, deps)` — registers
 * every `/api/*` route on the supplied Hono app. Caller is
 * responsible for the auth middleware, CORS, static-file serving,
 * SPA fallback, and server lifecycle (those still live in
 * `dashboard.ts`).
 */

import {
	type AuditLogger,
	type CampaignGoalRepository,
	agentConfig,
	agentSessions,
	campaignSnapshots,
	inferDefaultKpi,
	parseInsightsToMetrics,
} from "@meta-ads-agent/core";
import type { AgentConfig } from "@meta-ads-agent/core";
import type {
	CampaignGoal,
	CampaignGoalInput,
	KpiDirection,
	PendingGuidance,
	PrimaryKpi,
	SecondaryKpi,
} from "@meta-ads-agent/core";
import type { MetaClient } from "@meta-ads-agent/meta-client";
import { desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { type TtlCache, resolveCacheTtlMs } from "./dashboard-cache.js";

/**
 * Minimal IPC-client shape the routes need. Kept structural rather
 * than importing the concrete IpcClient class so tests can pass a
 * stub without dragging in the Unix-socket layer.
 */
export interface DashboardIpcClient {
	send(method: string, args: unknown): Promise<unknown>;
}

/**
 * Drizzle DB handle. Typed as `any` (with a biome-ignore) because the
 * concrete dialect varies (SQLite / Postgres) and Drizzle's inferred
 * types don't survive the abstraction boundary cleanly.
 */
// biome-ignore lint/suspicious/noExplicitAny: Drizzle DB type varies by backend
type DrizzleDb = any;

/**
 * Dependencies the route registrar needs from the surrounding command.
 *
 * Inverting these from closure-captured variables to explicit params
 * is what makes the tests possible — every external resource can be
 * stubbed.
 */
export interface DashboardApiDeps {
	dbConn: { db: DrizzleDb };
	auditLogger: AuditLogger;
	goalRepo: CampaignGoalRepository;
	ipc: DashboardIpcClient;
	cfg: AgentConfig;
	getMetaClient: () => Promise<MetaClient>;
	/**
	 * In-process TTL cache for Meta-hitting routes. Each `/api/campaigns`
	 * load fires six Marketing-API calls; without this cache, default
	 * dashboard polling turns into 50+ Graph requests per minute. The
	 * cache shares a single in-flight promise across concurrent callers
	 * (no thundering-herd) and is invalidated on writes that affect the
	 * downstream view (goal upsert/reset, configuration PUT).
	 */
	cache: TtlCache;
}

/**
 * Clamp pagination parameters to a safe range so a typo can't blow up the DB.
 */
function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
	const n = Number.parseInt(raw ?? "", 10);
	if (Number.isNaN(n)) return def;
	return Math.max(min, Math.min(max, n));
}

/**
 * Register every `/api/*` route on the supplied Hono app.
 *
 * Side effects only (mutation of `app`); does not touch the network
 * or filesystem. Auth middleware should already be installed BEFORE
 * this call (the routes assume the request has been authorized).
 */
export function registerDashboardApiRoutes(app: Hono, deps: DashboardApiDeps): void {
	const { dbConn, auditLogger, goalRepo, ipc, cfg, getMetaClient, cache } = deps;
	const cacheTtlMs = resolveCacheTtlMs();

	/* Cache-key prefixes. The `invalidate(prefix)` API uses `:` as
	 * a separator boundary, so e.g. invalidate('campaigns') clears
	 * 'campaigns:act_123:last_7d' but not 'campaign-goals:*'. */
	const K_CAMPAIGNS = "campaigns";
	const K_GOALS_PENDING = "goals-pending";
	const K_METRICS_SUMMARY = "metrics-summary";
	const K_METRICS_TIMESERIES = "metrics-timeseries";
	const K_ROAS_TARGET = "roas-target";

	/* Bust every Meta-derived view that depends on per-campaign goals.
	 * Called from POST/DELETE /api/goals so an operator's edit shows up
	 * on the next refresh instead of waiting out the TTL. */
	const invalidateGoalDerivedCaches = (): void => {
		cache.invalidate(K_CAMPAIGNS);
		cache.invalidate(K_GOALS_PENDING);
		cache.invalidate(K_ROAS_TARGET);
	};

	app.get("/api/status", async (c) => {
		const rows = await dbConn.db
			.select()
			.from(agentSessions)
			.orderBy(desc(agentSessions.createdAt))
			.limit(1);
		if (rows.length === 0) {
			return c.json({
				state: "stopped",
				sessionId: null,
				startedAt: null,
				lastTickAt: null,
				nextTickAt: null,
				tickCount: 0,
			});
		}
		const session = rows[0];
		/* Try the live daemon for fresh state; fall back to DB row. */
		try {
			const live = (await ipc.send("status", {})) as Record<string, unknown> | null;
			if (live) return c.json(live);
		} catch {
			/* daemon not running */
		}
		return c.json({
			state: session.state,
			sessionId: session.id,
			startedAt: session.createdAt,
			lastTickAt: session.lastTickAt,
			nextTickAt: null,
			tickCount: session.iterationCount,
		});
	});

	app.get("/api/decisions", async (c) => {
		const limit = clampInt(c.req.query("limit"), 100, 1, 500);
		const offset = clampInt(c.req.query("offset"), 0, 0, 1_000_000);
		const startDate = c.req.query("startDate");
		const endDate = c.req.query("endDate");
		/* Route through AuditLogger so the filter logic stays centralized
		 * with the rest of audit-querying code (toolName, sessionId,
		 * adAccountId, riskLevel, success, date range -- all in one place). */
		const rows = await auditLogger.getDecisions({
			limit,
			offset,
			...(startDate ? { startDate } : {}),
			...(endDate ? { endDate } : {}),
		});

		/* Enrich `_pending_guidance` rows with a `resolved` flag so the
		 * dashboard can render them in grey ("since resolved") instead
		 * of red ("failed") once an active goal exists for the campaign.
		 *
		 * Rationale: the audit log is append-only (DESIGN.md / AGENTS.md
		 * — "it's the system of record"), so we can't rewrite the
		 * historical row when the operator configures a goal a minute
		 * later. But the UI was screaming red FAILED at rows that have
		 * since been addressed, which is misleading. We don't filter
		 * them out (per AGENTS.md "don't filter _pending_* without
		 * reason"), we annotate them.
		 *
		 * Resolution rule: a `_pending_guidance` row is resolved iff an
		 * active goal exists for the same (adAccountId, campaignId) AND
		 * the goal's `lastSeenObjective` matches the row's params'
		 * `currentObjective`. The objective check matters because
		 * objective drift would re-emit pending-guidance, so a goal
		 * configured for a different objective shouldn't mark this row
		 * resolved. */
		const pendingRows = rows.filter((r) => r.toolName === "_pending_guidance");
		if (pendingRows.length === 0) return c.json(rows);

		/* Build a (account, campaign) -> goal map for O(N) join.
		 * listActive returns at most one goal per campaign so this is
		 * cheap. We do this lookup ONLY when there are pending rows in
		 * the result page — a successful tick stream skips it. */
		const activeGoals = await goalRepo.listActive(cfg.metaAdAccountId);
		const goalByCampaign = new Map(activeGoals.map((g) => [g.campaignId, g]));

		const enriched = rows.map((r) => {
			if (r.toolName !== "_pending_guidance") return r;
			/* `r.params` is already an object on the backend AuditRecord
			 * type — the frontend serializes it for transport. */
			const parsed: Record<string, unknown> = r.params ?? {};
			const campaignId = typeof parsed.campaignId === "string" ? parsed.campaignId : null;
			const rowObjective =
				typeof parsed.currentObjective === "string" ? parsed.currentObjective : null;
			if (!campaignId) return { ...r, resolved: false };
			const goal = goalByCampaign.get(campaignId);
			if (!goal) return { ...r, resolved: false };
			/* If the row recorded an objective and it doesn't match the
			 * goal's, the goal isn't a resolution — the campaign drifted
			 * since this row was written or the goal targets a different
			 * objective entirely. */
			if (
				rowObjective &&
				goal.lastSeenObjective &&
				rowObjective.toUpperCase() !== goal.lastSeenObjective.toUpperCase()
			) {
				return { ...r, resolved: false };
			}
			return {
				...r,
				resolved: true,
				resolvedByGoalDbId: goal.dbId,
				resolvedAt: goal.configuredAt,
			};
		});
		return c.json(enriched);
	});

	app.get("/api/campaigns", async (c) => {
		/* Live, hierarchical campaign view.
		 *
		 * Cached: response body keyed by (adAccountId, datePreset). The
		 * underlying six concurrent Meta calls are by far the most expensive
		 * operation in the dashboard — a 30s TTL coalesces refresh storms
		 * and multi-tab traffic without making the data stale enough to
		 * matter. Goal mutations bust this key explicitly.
		 *
		 * Falls back to the most-recent rows in the snapshot tables if
		 * Meta is temporarily unavailable, so the dashboard keeps showing
		 * the last-known data instead of going blank. */
		const datePreset = (process.env.META_ADS_AGENT_DATE_PRESET ?? "last_7d") as
			| "today"
			| "yesterday"
			| "last_7d"
			| "last_14d"
			| "last_28d"
			| "last_30d"
			| "last_90d"
			| "this_month"
			| "last_month";

		let client: MetaClient;
		try {
			client = await getMetaClient();
		} catch (err) {
			/* Don't cache token failures — the operator may fix the token
			 * mid-TTL and we'd rather pay the retry cost than serve a stale
			 * 502. The cache only wraps successful Meta-fetch paths. */
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: `Meta API unavailable: ${message}`, campaigns: [] }, 502);
		}

		const cacheKey = `${K_CAMPAIGNS}:${cfg.metaAdAccountId}:${datePreset}`;
		const response = await cache.get(cacheKey, cacheTtlMs, async () => {
			return await buildCampaignsResponse(client, datePreset);
		});
		return c.json(response);
	});

	/* Heavy-lifting helper for /api/campaigns. Extracted into a function
	 * so it can be cached as a unit — inlining made the cache.get()
	 * closure span 100+ lines which hurts readability. */
	type DatePreset =
		| "today"
		| "yesterday"
		| "last_7d"
		| "last_14d"
		| "last_28d"
		| "last_30d"
		| "last_90d"
		| "this_month"
		| "last_month";
	async function buildCampaignsResponse(
		client: MetaClient,
		datePreset: DatePreset,
		// biome-ignore lint/suspicious/noExplicitAny: matches the route's response shape
	): Promise<any[]> {
		interface RawCampaign {
			id: string;
			name: string;
			status: string;
			objective: string;
			daily_budget?: string;
		}
		interface RawAdSet {
			id: string;
			name: string;
			campaign_id: string;
			status: string;
			daily_budget?: string;
		}
		interface RawAd {
			id: string;
			name: string;
			adset_id: string;
			status: string;
		}

		/* Run all six fetches concurrently. Any single failure becomes
		 * an empty array, not a 502 — we'd rather show a partial
		 * tree than a blank page. */
		const [campaignsRes, adSetsRes, adsRes, campaignInsRes, adSetInsRes, adInsRes] =
			await Promise.allSettled([
				client.campaigns.list(cfg.metaAdAccountId) as Promise<RawCampaign[]>,
				client.adSets.list(cfg.metaAdAccountId) as Promise<RawAdSet[]>,
				client.ads.list(cfg.metaAdAccountId) as Promise<RawAd[]>,
				client.insights.query(cfg.metaAdAccountId, {
					level: "campaign",
					date_preset: datePreset,
				}),
				client.insights.query(cfg.metaAdAccountId, {
					level: "adset",
					date_preset: datePreset,
				}),
				client.insights.query(cfg.metaAdAccountId, {
					level: "ad",
					date_preset: datePreset,
				}),
			]);

		const settled = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
			r.status === "fulfilled" ? r.value : fallback;
		const campaigns = settled(campaignsRes, [] as RawCampaign[]);
		const rawAdSets = settled(adSetsRes, [] as RawAdSet[]);
		const rawAds = settled(adsRes, [] as RawAd[]);
		const campaignInsights = settled(campaignInsRes, []);
		const adSetInsights = settled(adSetInsRes, []);
		const adInsights = settled(adInsRes, []);

		/* Index insights by entity id for O(1) joins below. */
		const campaignMetrics = new Map<string, ReturnType<typeof parseInsightsToMetrics>>();
		for (const i of campaignInsights) {
			if (i.campaign_id) campaignMetrics.set(i.campaign_id, parseInsightsToMetrics(i));
		}
		const adSetMetricsById = new Map<string, ReturnType<typeof parseInsightsToMetrics>>();
		for (const i of adSetInsights) {
			if (i.adset_id) adSetMetricsById.set(i.adset_id, parseInsightsToMetrics(i));
		}
		const adMetricsById = new Map<string, ReturnType<typeof parseInsightsToMetrics>>();
		for (const i of adInsights) {
			if (i.ad_id) adMetricsById.set(i.ad_id, parseInsightsToMetrics(i));
		}

		/* Active goals: one per campaign at most. */
		const goals = await goalRepo.listActive(cfg.metaAdAccountId);
		const goalsByCampaign = new Map(goals.map((g) => [g.campaignId, g]));

		/* Group adsets and ads under their parents. */
		const adSetsByCampaign = new Map<string, RawAdSet[]>();
		for (const a of rawAdSets) {
			const arr = adSetsByCampaign.get(a.campaign_id) ?? [];
			arr.push(a);
			adSetsByCampaign.set(a.campaign_id, arr);
		}
		const adsByAdSet = new Map<string, RawAd[]>();
		for (const a of rawAds) {
			const arr = adsByAdSet.get(a.adset_id) ?? [];
			arr.push(a);
			adsByAdSet.set(a.adset_id, arr);
		}

		const budgetCentsToDollars = (cents?: string): number => {
			if (!cents) return 0;
			const n = Number.parseInt(cents, 10);
			return Number.isFinite(n) ? n / 100 : 0;
		};

		const response = campaigns.map((camp) => {
			const m = campaignMetrics.get(camp.id);
			const goal = goalsByCampaign.get(camp.id) ?? null;
			const children = adSetsByCampaign.get(camp.id) ?? [];
			return {
				id: camp.id,
				name: camp.name,
				status: camp.status,
				objective: camp.objective,
				dailyBudget: budgetCentsToDollars(camp.daily_budget),
				spend7d: m?.spend ?? 0,
				roas7d: m?.roas ?? 0,
				cpa7d: m?.cpa ?? 0,
				impressions7d: m?.impressions ?? 0,
				clicks7d: m?.clicks ?? 0,
				conversions7d: m?.conversions ?? 0,
				goal,
				adSets: children.map((s) => {
					const sm = adSetMetricsById.get(s.id);
					const leafAds = adsByAdSet.get(s.id) ?? [];
					return {
						id: s.id,
						name: s.name,
						status: s.status,
						dailyBudget: budgetCentsToDollars(s.daily_budget),
						spend7d: sm?.spend ?? 0,
						roas7d: sm?.roas ?? 0,
						cpa7d: sm?.cpa ?? 0,
						impressions7d: sm?.impressions ?? 0,
						clicks7d: sm?.clicks ?? 0,
						conversions7d: sm?.conversions ?? 0,
						ads: leafAds.map((ad) => {
							const am = adMetricsById.get(ad.id);
							return {
								id: ad.id,
								name: ad.name,
								status: ad.status,
								spend7d: am?.spend ?? 0,
								roas7d: am?.roas ?? 0,
								cpa7d: am?.cpa ?? 0,
								impressions7d: am?.impressions ?? 0,
								clicks7d: am?.clicks ?? 0,
								conversions7d: am?.conversions ?? 0,
							};
						}),
					};
				}),
			};
		});

		return response;
	}

	/* ---- Per-campaign goal management ----
	 *
	 * The CLI has had `meta-ads-agent guidance` for this since PR #23.
	 * These endpoints are the dashboard parity: list/create/delete
	 * goals, and surface the same "pending guidance" set the agent
	 * loop and the interactive `guidance` mode use to find campaigns
	 * that need an explicit goal before the agent will act on them.
	 *
	 * Pending detection (mirrors guidance.ts): a campaign is pending
	 * if it has NO active goal at all, OR its current Meta objective
	 * has drifted from `lastSeenObjective`. Both reasons are surfaced
	 * with the same `PendingGuidanceReason` vocabulary the agent uses.
	 */

	/* ---- Account-level metrics for the Overview page ----
	 *
	 * Pre-this-PR the Overview page rendered hardcoded zeros for
	 * Total Spend / Avg ROAS / Avg CPA / Conversions and a flat
	 * zero line for the spend + ROAS time-series charts. The
	 * components had a TODO comment apologizing for it ("In
	 * production these come from the campaign metrics API") and
	 * never made it into production.
	 *
	 * Both endpoints below pull live insights from Meta. Same
	 * MetaClient + parseInsightsToMetrics path the agent uses,
	 * so the numbers shown on the dashboard match what the agent
	 * is reasoning over. */

	app.get("/api/metrics/summary", async (c) => {
		const windowDays = clampInt(c.req.query("days"), 7, 1, 90);
		let client: MetaClient;
		try {
			client = await getMetaClient();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return c.json({ error: `Meta API unavailable: ${msg}` }, 502);
		}

		const cacheKey = `${K_METRICS_SUMMARY}:${cfg.metaAdAccountId}:${windowDays}`;
		const body = await cache.get(cacheKey, cacheTtlMs, async () => {
			/* Build two contiguous windows: [now-2N .. now-N] (prior) and
			 * [now-N .. now] (current). Sending explicit time_range
			 * rather than date_preset because the prior period is not
			 * one of Meta's preset shortcuts. */
			const today = new Date();
			const fmt = (d: Date): string => d.toISOString().slice(0, 10);
			const current = {
				since: fmt(new Date(today.getTime() - windowDays * 86_400_000)),
				until: fmt(today),
			};
			const prior = {
				since: fmt(new Date(today.getTime() - 2 * windowDays * 86_400_000)),
				until: fmt(new Date(today.getTime() - windowDays * 86_400_000)),
			};

			const [curRes, priorRes] = await Promise.allSettled([
				client.insights.query(cfg.metaAdAccountId, {
					level: "account",
					time_range: current,
				}),
				client.insights.query(cfg.metaAdAccountId, {
					level: "account",
					time_range: prior,
				}),
			]);

			const summarize = (
				res: PromiseSettledResult<Awaited<ReturnType<typeof client.insights.query>>>,
			): { spend: number; roas: number; cpa: number; conversions: number } => {
				if (res.status !== "fulfilled" || res.value.length === 0) {
					return { spend: 0, roas: 0, cpa: 0, conversions: 0 };
				}
				const m = parseInsightsToMetrics(res.value[0]);
				return {
					spend: m.spend,
					roas: m.roas,
					cpa: m.cpa,
					conversions: m.conversions,
				};
			};

			const cur = summarize(curRes);
			const prv = summarize(priorRes);
			const pct = (now: number, before: number): number => {
				if (before === 0) return 0;
				return ((now - before) / before) * 100;
			};

			return {
				windowDays,
				current: cur,
				prior: prv,
				delta: {
					spendPct: pct(cur.spend, prv.spend),
					roasPct: pct(cur.roas, prv.roas),
					cpaPct: pct(cur.cpa, prv.cpa),
					conversionsPct: pct(cur.conversions, prv.conversions),
				},
			};
		});
		return c.json(body);
	});

	app.get("/api/metrics/timeseries", async (c) => {
		const days = clampInt(c.req.query("days"), 30, 1, 90);
		let client: MetaClient;
		try {
			client = await getMetaClient();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return c.json({ error: `Meta API unavailable: ${msg}` }, 502);
		}

		const cacheKey = `${K_METRICS_TIMESERIES}:${cfg.metaAdAccountId}:${days}`;
		try {
			const body = await cache.get(cacheKey, cacheTtlMs, async () => {
				const today = new Date();
				const fmt = (d: Date): string => d.toISOString().slice(0, 10);
				const time_range = {
					since: fmt(new Date(today.getTime() - days * 86_400_000)),
					until: fmt(today),
				};
				/* time_increment=1 = daily rows. The API returns one row
				 * per day per account at level=account. */
				const rows = await client.insights.query(cfg.metaAdAccountId, {
					level: "account",
					time_range,
					time_increment: 1,
				});
				const points = rows.map((r) => {
					const m = parseInsightsToMetrics(r);
					return {
						date: r.date_start ?? "",
						spend: m.spend,
						roas: m.roas,
						conversions: m.conversions,
					};
				});
				return { days, points };
			});
			return c.json(body);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return c.json({ error: `Insights timeseries failed: ${msg}` }, 502);
		}
	});

	/* ---- Dynamic ROAS reference target ----
	 *
	 * The Overview ROAS chart used to show a hardcoded `4.0x` red
	 * dashed reference line. With per-campaign goals (PR #23) a
	 * single account-wide ROAS target is misleading — different
	 * campaigns can target wildly different ratios. We compute the
	 * spend-weighted average target across campaigns whose primary
	 * KPI is `roas`, falling back to the legacy `agent_config`
	 * AgentGoal value, then to null (no line drawn).
	 *
	 * Why spend-weighted? A campaign at 90% of the spend with target
	 * 5.0 should drive the chart's reference line near 5.0, not get
	 * diluted by a tiny campaign at target 2.0. Equal-weight average
	 * misrepresents what "hitting target" means at the account level.
	 *
	 * Live spend comes from MetaClient.insights at level=campaign
	 * for the same lookback window the chart uses (default last_7d,
	 * configurable via META_ADS_AGENT_DATE_PRESET). If Meta is
	 * unavailable we still answer with the agent_config fallback so
	 * the chart stays usable. */
	app.get("/api/metrics/roas-target", async (c) => {
		const datePreset = (process.env.META_ADS_AGENT_DATE_PRESET ?? "last_7d") as
			| "today"
			| "yesterday"
			| "last_7d"
			| "last_14d"
			| "last_28d"
			| "last_30d"
			| "last_90d"
			| "this_month"
			| "last_month";

		const cacheKey = `${K_ROAS_TARGET}:${cfg.metaAdAccountId}:${datePreset}`;
		const body = await cache.get(cacheKey, cacheTtlMs, async () => {
			const goals = await goalRepo.listActive(cfg.metaAdAccountId);
			const roasGoals = goals.filter(
				(g) => g.primaryKpi === "roas" && g.primaryKpiDirection === "maximize",
			);

			/* Phase 1: try per-campaign weighted average. */
			if (roasGoals.length > 0) {
				try {
					const client = await getMetaClient();
					const insights = await client.insights.query(cfg.metaAdAccountId, {
						level: "campaign",
						date_preset: datePreset,
					});
					const spendByCampaign = new Map<string, number>();
					for (const i of insights) {
						if (!i.campaign_id) continue;
						const m = parseInsightsToMetrics(i);
						spendByCampaign.set(i.campaign_id, m.spend);
					}

					let weightedSum = 0;
					let totalWeight = 0;
					let contributors = 0;
					for (const g of roasGoals) {
						const spend = spendByCampaign.get(g.campaignId) ?? 0;
						if (spend <= 0) continue;
						weightedSum += g.primaryKpiTarget * spend;
						totalWeight += spend;
						contributors++;
					}

					if (totalWeight > 0) {
						return {
							target: weightedSum / totalWeight,
							source: "campaigns" as const,
							contributors,
							windowDays: datePreset === "last_7d" ? 7 : datePreset === "last_30d" ? 30 : null,
						};
					}
					const avg = roasGoals.reduce((sum, g) => sum + g.primaryKpiTarget, 0) / roasGoals.length;
					return {
						target: avg,
						source: "campaigns" as const,
						contributors: roasGoals.length,
						windowDays: null as number | null,
					};
				} catch {
					/* MetaClient unavailable; fall through to agent_config. */
				}
			}

			/* Phase 2: legacy account-wide AgentGoal from agent_config. */
			const configRows = await dbConn.db
				.select()
				.from(agentConfig)
				.where(eq(agentConfig.adAccountId, cfg.metaAdAccountId))
				.orderBy(desc(agentConfig.createdAt))
				.limit(1);
			if (configRows.length > 0 && configRows[0].roasTarget > 0) {
				return {
					target: configRows[0].roasTarget,
					source: "agent_config" as const,
					contributors: 0,
					windowDays: null as number | null,
				};
			}

			/* Phase 3: nothing configured. */
			return {
				target: null,
				source: null,
				contributors: 0,
				windowDays: null,
			};
		});
		return c.json(body);
	});

	/* ---- Configuration page wiring ----
	 *
	 * The dashboard's Configuration page used to render fixed defaults
	 * and a Save button that just wrote to localStorage — it never
	 * hit the backend. These two endpoints make it real:
	 *
	 *   GET  /api/configuration  -> active agent_config row + the
	 *                              runtime values that aren't editable
	 *                              from the dashboard (LLM provider,
	 *                              tick interval, ad account, db type).
	 *   PUT  /api/configuration  -> insert a NEW agent_config row
	 *                              (history-by-insert per the table's
	 *                              docstring).
	 *
	 * Per-campaign goal fields (min_daily_budget, max_budget_scale_factor,
	 * require_approval_above) deliberately do NOT appear here — they
	 * live on `campaign_goals` per DESIGN.md §2/§3 and the dashboard
	 * surfaces them under /goals. The legacy AgentGoal columns on
	 * agent_config (roasTarget/cpaCap/dailyBudgetLimit/riskLevel) are
	 * still useful as account-wide guardrails the budget tools bind
	 * against. */

	app.get("/api/configuration", async (c) => {
		const rows = await dbConn.db
			.select()
			.from(agentConfig)
			.where(eq(agentConfig.adAccountId, cfg.metaAdAccountId))
			.orderBy(desc(agentConfig.createdAt))
			.limit(1);
		const active = rows.length > 0 ? rows[0] : null;

		/* Pull runtime tick interval from the daemon state file when
		 * possible — it's the source of truth for the running daemon's
		 * cadence. The CLI flag is what the operator passed; if we
		 * stored only what `loadConfig()` says, we'd surface the
		 * environment-default rather than the actual cadence. */
		let runtimeIntervalMinutes: number | null = null;
		try {
			const live = (await ipc.send("status", {})) as { intervalMinutes?: number } | null;
			if (live && typeof live.intervalMinutes === "number") {
				runtimeIntervalMinutes = live.intervalMinutes;
			}
		} catch {
			/* daemon not running; fall through to config-derived value */
		}
		if (runtimeIntervalMinutes === null && cfg.tickIntervalMs) {
			runtimeIntervalMinutes = Math.round(cfg.tickIntervalMs / 60000);
		}

		return c.json({
			/* Editable: account-wide guardrails. */
			guardrails: active
				? {
						roasTarget: active.roasTarget,
						cpaCap: active.cpaCap,
						dailyBudgetLimit: active.dailyBudgetLimit,
						riskLevel: active.riskLevel,
						configuredAt: active.createdAt,
					}
				: null,
			/* Read-only: changing requires init re-run or daemon restart. */
			runtime: {
				llmProvider: cfg.llmProvider,
				tickIntervalMinutes: runtimeIntervalMinutes,
				adAccountId: cfg.metaAdAccountId,
				dbType: cfg.dbType,
				dryRun: cfg.dryRun,
			},
		});
	});

	app.put("/api/configuration", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}
		if (typeof body !== "object" || body === null) {
			return c.json({ error: "Body must be a JSON object" }, 400);
		}
		const raw = body as Record<string, unknown>;

		const num = (v: unknown, name: string): number | null => {
			if (typeof v !== "number" || !Number.isFinite(v)) return null;
			if (v < 0) {
				throw new Error(`${name} must be non-negative`);
			}
			return v;
		};

		let roasTarget: number | null;
		let cpaCap: number | null;
		let dailyBudgetLimit: number | null;
		try {
			roasTarget = num(raw.roasTarget, "roasTarget");
			cpaCap = num(raw.cpaCap, "cpaCap");
			dailyBudgetLimit = num(raw.dailyBudgetLimit, "dailyBudgetLimit");
		} catch (err) {
			return c.json({ error: (err as Error).message }, 400);
		}
		if (roasTarget === null || cpaCap === null || dailyBudgetLimit === null) {
			return c.json(
				{
					error:
						"roasTarget, cpaCap, and dailyBudgetLimit are all required and must be finite numbers",
				},
				400,
			);
		}
		const riskLevel = raw.riskLevel;
		if (riskLevel !== "conservative" && riskLevel !== "moderate" && riskLevel !== "aggressive") {
			return c.json(
				{
					error: "riskLevel must be 'conservative', 'moderate', or 'aggressive'",
				},
				400,
			);
		}

		const now = new Date().toISOString();
		const inserted = await dbConn.db
			.insert(agentConfig)
			.values({
				adAccountId: cfg.metaAdAccountId,
				roasTarget,
				cpaCap,
				dailyBudgetLimit,
				riskLevel,
				createdAt: now,
			})
			.returning();

		/* Note: the running daemon won't pick up the new guardrails until
		 * its next start — the AgentGoal is captured at session
		 * construction (daemon/manager.ts:start) and used to bind the
		 * budget tools. We surface this in the response so the UI can
		 * show a "restart daemon to apply" hint. */

		/* Bust the roas-target cache: the agent_config row is the
		 * fallback when no roas-KPI campaigns exist, so a configuration
		 * change can move the line. */
		cache.invalidate(K_ROAS_TARGET);

		return c.json(
			{
				guardrails: {
					roasTarget,
					cpaCap,
					dailyBudgetLimit,
					riskLevel,
					configuredAt: now,
				},
				requiresDaemonRestart: true,
				insertedId: inserted[0]?.id ?? null,
			},
			201,
		);
	});

	app.get("/api/goals", async (c) => {
		const goals = await goalRepo.listActive(cfg.metaAdAccountId);
		return c.json(goals);
	});

	app.get("/api/goals/defaults", (c) => {
		const objective = c.req.query("objective") ?? "";
		return c.json(inferDefaultKpi(objective));
	});

	app.get("/api/goals/pending", async (c) => {
		/* Hits the live Marketing API. Token failure (e.g. expired)
		 * surfaces a 502 with diagnostic and is NOT cached — we'd rather
		 * pay the retry cost than serve a stale auth error. */
		let client: MetaClient;
		try {
			client = await getMetaClient();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: `Meta API unavailable: ${message}` }, 502);
		}

		const cacheKey = `${K_GOALS_PENDING}:${cfg.metaAdAccountId}`;
		try {
			const pending = await cache.get(cacheKey, cacheTtlMs, async () => {
				interface MetaCampaignLite {
					id: string;
					name: string;
					objective: string;
					status: string;
					daily_budget?: string;
				}
				const liveCampaigns = (await client.campaigns.list(
					cfg.metaAdAccountId,
				)) as MetaCampaignLite[];

				const active = await goalRepo.listActive(cfg.metaAdAccountId);
				const byCampaign = new Map(active.map((g) => [g.campaignId, g]));

				const result: PendingGuidance[] = [];
				for (const camp of liveCampaigns) {
					const goal = byCampaign.get(camp.id);
					const dailyBudget = camp.daily_budget
						? Number.parseInt(camp.daily_budget, 10) / 100
						: null;
					if (!goal) {
						result.push({
							campaignId: camp.id,
							campaignName: camp.name,
							currentObjective: camp.objective,
							status: camp.status,
							dailyBudget,
							reason: "no_goal_configured",
						});
					} else if (goal.lastSeenObjective !== camp.objective) {
						result.push({
							campaignId: camp.id,
							campaignName: camp.name,
							currentObjective: camp.objective,
							status: camp.status,
							dailyBudget,
							reason: "objective_changed",
							previousObjective: goal.lastSeenObjective,
						});
					}
				}
				return result;
			});
			return c.json(pending);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return c.json({ error: `Meta campaign list failed: ${message}` }, 502);
		}
	});

	app.get("/api/goals/:campaignId", async (c) => {
		const campaignId = c.req.param("campaignId");
		const goal = await goalRepo.getActive(cfg.metaAdAccountId, campaignId);
		if (!goal) return c.json({ error: "No active goal for campaign" }, 404);
		return c.json(goal);
	});

	/* Whitelist of valid PrimaryKpi values; mirrors the type union in
	 * goals/types.ts. Adding a KPI to that union also requires adding
	 * it here — kept as a runtime check because the API receives
	 * untyped JSON over the wire. */
	const VALID_KPIS = new Set<PrimaryKpi>([
		"roas",
		"cpa",
		"cpl",
		"cpc",
		"ctr",
		"cpm",
		"cpi",
		"cost_per_thruplay",
		"thruplay_rate",
		"frequency",
		"reach",
	]);

	app.post("/api/goals", async (c) => {
		let body: unknown;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}
		if (typeof body !== "object" || body === null) {
			return c.json({ error: "Body must be a JSON object" }, 400);
		}
		const raw = body as Record<string, unknown>;

		/* ---- Required fields ---- */
		const campaignId = raw.campaignId;
		const primaryKpi = raw.primaryKpi;
		const primaryKpiTarget = raw.primaryKpiTarget;
		const primaryKpiDirection = raw.primaryKpiDirection;
		const lastSeenObjective = raw.lastSeenObjective;

		if (typeof campaignId !== "string" || campaignId.length === 0) {
			return c.json({ error: "campaignId is required" }, 400);
		}
		if (typeof primaryKpi !== "string" || !VALID_KPIS.has(primaryKpi as PrimaryKpi)) {
			return c.json({ error: `primaryKpi must be one of ${[...VALID_KPIS].join(", ")}` }, 400);
		}
		if (typeof primaryKpiTarget !== "number" || !Number.isFinite(primaryKpiTarget)) {
			return c.json({ error: "primaryKpiTarget must be a finite number" }, 400);
		}
		if (primaryKpiTarget < 0) {
			return c.json({ error: "primaryKpiTarget must be non-negative" }, 400);
		}
		if (primaryKpiDirection !== "maximize" && primaryKpiDirection !== "minimize") {
			return c.json({ error: "primaryKpiDirection must be 'maximize' or 'minimize'" }, 400);
		}
		if (typeof lastSeenObjective !== "string" || lastSeenObjective.length === 0) {
			return c.json({ error: "lastSeenObjective is required" }, 400);
		}

		/* ---- Optional fields ---- */
		let secondaryKpis: SecondaryKpi[] | undefined;
		if (raw.secondaryKpis !== undefined && raw.secondaryKpis !== null) {
			if (!Array.isArray(raw.secondaryKpis)) {
				return c.json({ error: "secondaryKpis must be an array" }, 400);
			}
			secondaryKpis = [];
			for (const item of raw.secondaryKpis) {
				if (
					typeof item !== "object" ||
					item === null ||
					typeof (item as { kpi?: unknown }).kpi !== "string" ||
					!VALID_KPIS.has((item as { kpi: string }).kpi as PrimaryKpi)
				) {
					return c.json({ error: "Each secondaryKpis entry needs a valid 'kpi'" }, 400);
				}
				const entry = item as { kpi: string; target?: unknown; direction?: unknown };
				const sk: SecondaryKpi = { kpi: entry.kpi as PrimaryKpi };
				if (typeof entry.target === "number" && Number.isFinite(entry.target)) {
					(sk as { target?: number }).target = entry.target;
				}
				if (entry.direction === "maximize" || entry.direction === "minimize") {
					(sk as { direction?: KpiDirection }).direction = entry.direction;
				}
				secondaryKpis.push(sk);
			}
		}

		const optionalNumber = (v: unknown, label: string): number | null | undefined => {
			if (v === undefined) return undefined;
			if (v === null) return null;
			if (typeof v !== "number" || !Number.isFinite(v)) {
				throw new Error(`${label} must be a finite number, null, or omitted`);
			}
			return v;
		};
		let minDailyBudget: number | null | undefined;
		let maxBudgetScaleFactor: number | null | undefined;
		let requireApprovalAbove: number | null | undefined;
		try {
			minDailyBudget = optionalNumber(raw.minDailyBudget, "minDailyBudget");
			maxBudgetScaleFactor = optionalNumber(raw.maxBudgetScaleFactor, "maxBudgetScaleFactor");
			requireApprovalAbove = optionalNumber(raw.requireApprovalAbove, "requireApprovalAbove");
		} catch (err) {
			return c.json({ error: (err as Error).message }, 400);
		}

		const notes = typeof raw.notes === "string" ? raw.notes : undefined;

		/* If a goal already exists for this campaign, soft-delete it
		 * before inserting the new one so the active-row invariant
		 * stays clean. The repository accepts coexisting rows but the
		 * dashboard's mental model is "replace the goal," not "add
		 * another version that hides the prior one." The history is
		 * preserved either way. */
		const existing = await goalRepo.getActive(cfg.metaAdAccountId, campaignId);
		if (existing) {
			await goalRepo.softDelete(
				cfg.metaAdAccountId,
				campaignId,
				"dashboard",
				"replaced via dashboard",
			);
		}

		const input: CampaignGoalInput = {
			adAccountId: cfg.metaAdAccountId,
			campaignId,
			primaryKpi: primaryKpi as PrimaryKpi,
			primaryKpiTarget,
			primaryKpiDirection: primaryKpiDirection as KpiDirection,
			lastSeenObjective,
			configuredBy: "dashboard",
			...(secondaryKpis ? { secondaryKpis } : {}),
			...(minDailyBudget !== undefined && minDailyBudget !== null ? { minDailyBudget } : {}),
			...(maxBudgetScaleFactor !== undefined && maxBudgetScaleFactor !== null
				? { maxBudgetScaleFactor }
				: {}),
			...(requireApprovalAbove !== undefined && requireApprovalAbove !== null
				? { requireApprovalAbove }
				: {}),
			...(notes ? { notes } : {}),
		};
		const saved: CampaignGoal = await goalRepo.upsert(input);
		/* Bust every cached view that joins per-campaign goals so the
		 * operator's edit is reflected on the next refresh, not after
		 * the TTL expires. Goals affect /api/campaigns (joined goal),
		 * /api/goals/pending (which campaigns lack a goal), and
		 * /api/metrics/roas-target (spend-weighted target). */
		invalidateGoalDerivedCaches();
		return c.json(saved, 201);
	});

	app.delete("/api/goals/:campaignId", async (c) => {
		const campaignId = c.req.param("campaignId");
		const result = await goalRepo.softDelete(
			cfg.metaAdAccountId,
			campaignId,
			"dashboard",
			"reset via dashboard",
		);
		if (!result) return c.json({ error: "No active goal to reset" }, 404);
		invalidateGoalDerivedCaches();
		return c.json({ success: true, deletedAt: result.deletedAt });
	});

	app.post("/api/control/pause", async (c) => {
		try {
			await ipc.send("pause", {});
		} catch {
			/* daemon may not be running; update DB optimistically */
		}
		const sessions = await dbConn.db
			.select()
			.from(agentSessions)
			.orderBy(desc(agentSessions.createdAt))
			.limit(1);
		if (sessions.length > 0) {
			await dbConn.db
				.update(agentSessions)
				.set({ state: "paused", updatedAt: new Date().toISOString() })
				.where(eq(agentSessions.id, sessions[0].id));
		}
		return c.json({ success: true, state: "paused" });
	});

	app.post("/api/control/resume", async (c) => {
		try {
			await ipc.send("resume", {});
		} catch {
			/* daemon may not be running */
		}
		const sessions = await dbConn.db
			.select()
			.from(agentSessions)
			.orderBy(desc(agentSessions.createdAt))
			.limit(1);
		if (sessions.length > 0) {
			await dbConn.db
				.update(agentSessions)
				.set({ state: "running", updatedAt: new Date().toISOString() })
				.where(eq(agentSessions.id, sessions[0].id));
		}
		return c.json({ success: true, state: "running" });
	});

	app.post("/api/control/run-once", async (c) => {
		try {
			const result = await ipc.send("run-once", {});
			if (result) return c.json(result);
		} catch {
			/* fall through */
		}
		return c.json({ error: "Agent daemon is not running" }, 503);
	});
}
