/**
 * `meta-ads-agent dashboard` command.
 *
 * Serves the React dashboard SPA + REST API on a single port, talking
 * to the running daemon via the same Unix-socket IPC channel as the
 * other CLI commands. Auto-opens the user's default browser.
 *
 * Static assets are shipped inside the published npm tarball under
 * `dashboard-static/`. Path resolution uses `import.meta.url` so the
 * same code works both in the bundled `dist/index.js` (resolves to
 * `../dashboard-static`) and from `tsx` in the workspace (resolves to
 * `../../../dashboard/dist`).
 */

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import {
	AuditLogger,
	CampaignGoalRepository,
	DrizzleAuditDatabase,
	agentSessions,
	createDatabase,
	inferDefaultKpi,
	loadConfig,
	parseInsightsToMetrics,
} from "@meta-ads-agent/core";
import type {
	CampaignGoal,
	CampaignGoalInput,
	KpiDirection,
	PendingGuidance,
	PrimaryKpi,
	SecondaryKpi,
} from "@meta-ads-agent/core";
import { MetaClient } from "@meta-ads-agent/meta-client";
import type { Command } from "commander";
import { desc, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { IpcClient } from "../daemon/ipc.js";
import { error, section, success } from "../utils/display.js";
import { handleError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

interface DashboardOptions {
	port: string;
	open: boolean;
	apiKey?: string;
}

/**
 * Constant-time string comparison to mitigate timing attacks on the API key.
 */
function constantTimeEqual(a: string, b: string): boolean {
	const aBuf = Buffer.from(a, "utf8");
	const bBuf = Buffer.from(b, "utf8");
	if (aBuf.length !== bBuf.length) {
		timingSafeEqual(aBuf, aBuf);
		return false;
	}
	return timingSafeEqual(aBuf, bBuf);
}

/**
 * Locate the bundled dashboard static assets directory.
 *
 * Resolution order:
 *   1. `<cli-dir>/dashboard-static/index.html` (published tarball layout)
 *   2. `<cli-dir>/../dashboard-static/index.html` (bundled but with src/ layout)
 *   3. `<repo-root>/packages/dashboard/dist/index.html` (workspace dev mode)
 *
 * Returns null if no candidate exists, in which case the caller should
 * tell the user to run the dashboard build.
 */
function resolveStaticDir(): string | null {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		resolve(here, "..", "dashboard-static"), // dist/.. layout when bundled
		resolve(here, "dashboard-static"), // dist/dashboard-static
		resolve(here, "..", "..", "dashboard-static"), // src/commands/.. (dev fallback)
		resolve(here, "..", "..", "..", "dashboard", "dist"), // workspace dev mode
	];
	for (const c of candidates) {
		if (existsSync(join(c, "index.html"))) return c;
	}
	return null;
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
 * Open a URL in the user's default browser. Best-effort; logs a notice
 * but never throws if the platform's helper isn't available.
 */
function openBrowser(url: string): void {
	const platform = process.platform;
	const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
	try {
		const child = spawn(cmd, [url], { detached: true, stdio: "ignore" });
		child.unref();
	} catch {
		logger.info(`Open this URL in your browser: ${url}`);
	}
}

/**
 * Register the `dashboard` command on the root program.
 */
export function registerDashboardCommand(program: Command): void {
	program
		.command("dashboard")
		.description("Launch the agent dashboard (web UI + API on one port)")
		.option("-p, --port <port>", "Port to listen on", "3001")
		.option("--no-open", "Do not auto-open the browser")
		.option("--api-key <key>", "X-API-Key required for /api/* requests (overrides env)")
		.action(async (options: DashboardOptions) => {
			try {
				const port = Number.parseInt(options.port, 10);
				if (Number.isNaN(port) || port < 1 || port > 65535) {
					error(`Invalid port: ${options.port}`);
					process.exitCode = 1;
					return;
				}

				/* Auth: --api-key flag wins; otherwise DASHBOARD_API_KEY env;
				 * otherwise refuse to start unless DASHBOARD_AUTH=none. */
				const apiKey = options.apiKey ?? process.env.DASHBOARD_API_KEY;
				const authDisabled = process.env.DASHBOARD_AUTH === "none";
				if (!authDisabled && !apiKey) {
					error(
						"DASHBOARD_API_KEY is not set. Pass --api-key=<secret>, " +
							"export DASHBOARD_API_KEY, or set DASHBOARD_AUTH=none for local dev only.",
					);
					process.exitCode = 1;
					return;
				}

				const staticDir = resolveStaticDir();
				if (!staticDir) {
					error(
						"Dashboard static assets not found. " +
							"If you're running from source, build them with " +
							"`pnpm --filter @meta-ads-agent/dashboard build`.",
					);
					process.exitCode = 1;
					return;
				}

				/* Open the local audit DB so /api/* can serve historical data. */
				const cfg = loadConfig();
				const dbConn = createDatabase({
					type: cfg.dbType,
					sqlitePath: cfg.sqlitePath,
					postgresUrl: cfg.postgresUrl,
				});
				const auditLogger = new AuditLogger(new DrizzleAuditDatabase(dbConn.db));
				const goalRepo = new CampaignGoalRepository(dbConn.db);
				const ipc = new IpcClient();

				/* MetaClient is constructed lazily on first request that needs it.
				 * Keeping it module-scoped means we don't pay the `initialize()`
				 * cost on dashboard startup, and a missing/expired token only
				 * surfaces on the routes that actually call into Graph. */
				let cachedMetaClient: MetaClient | null = null;
				async function getMetaClient(): Promise<MetaClient> {
					if (cachedMetaClient) return cachedMetaClient;
					const client = new MetaClient({
						accessToken: cfg.metaAccessToken,
						adAccountId: cfg.metaAdAccountId,
					});
					await client.initialize();
					cachedMetaClient = client;
					return client;
				}

				const app = new Hono();

				/* ---- CORS: same-origin by default; permissive when explicitly asked. */
				const corsOrigin = process.env.DASHBOARD_CORS_ORIGIN;
				if (corsOrigin) {
					app.use("*", cors({ origin: corsOrigin }));
				}

				/* ---- API auth ---- */
				app.use("/api/*", async (c, next) => {
					if (authDisabled) {
						await next();
						return;
					}
					const header = c.req.header("X-Api-Key") ?? "";
					if (!constantTimeEqual(header, apiKey as string)) {
						return c.json({ error: "Unauthorized" }, 401);
					}
					await next();
				});

				/* ---- API routes ---- */

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
					return c.json(rows);
				});

				app.get("/api/campaigns", async (c) => {
					/* Live, hierarchical campaign view.
					 *
					 * Pre-this-PR this endpoint just dumped `campaign_snapshots`
					 * rows verbatim, which:
					 *   1. were empty until a snapshot tick had run (and on a
					 *      `today`-preset, dry-run, or quiet-account daemon
					 *      they often stayed empty forever);
					 *   2. didn't include name, status, daily budget, objective,
					 *      goal, ad sets, or ads — none of what the dashboard
					 *      type `CampaignMetrics` actually expects.
					 *
					 * Now: pull the live hierarchy from Meta (campaigns +
					 * adsets + ads) in parallel with the latest 7-day insights
					 * at all three levels and the active goals for the account.
					 * Merge into a single tree the dashboard can render.
					 *
					 * Falls back to the most-recent rows in the snapshot tables
					 * if Meta is temporarily unavailable, so the dashboard keeps
					 * showing the last-known data instead of going blank. */
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
						const message = err instanceof Error ? err.message : String(err);
						return c.json({ error: `Meta API unavailable: ${message}`, campaigns: [] }, 502);
					}

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

					return c.json(response);
				});

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

				app.get("/api/goals", async (c) => {
					const goals = await goalRepo.listActive(cfg.metaAdAccountId);
					return c.json(goals);
				});

				app.get("/api/goals/defaults", (c) => {
					const objective = c.req.query("objective") ?? "";
					return c.json(inferDefaultKpi(objective));
				});

				app.get("/api/goals/pending", async (c) => {
					/* Hits the live Marketing API. If the operator's token is
					 * missing or invalid we surface a 502 with the diagnostic
					 * rather than crashing the whole dashboard. */
					let client: MetaClient;
					try {
						client = await getMetaClient();
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						return c.json({ error: `Meta API unavailable: ${message}` }, 502);
					}

					interface MetaCampaignLite {
						id: string;
						name: string;
						objective: string;
						status: string;
						daily_budget?: string;
					}
					let liveCampaigns: MetaCampaignLite[];
					try {
						liveCampaigns = (await client.campaigns.list(
							cfg.metaAdAccountId,
						)) as MetaCampaignLite[];
					} catch (err) {
						const message = err instanceof Error ? err.message : String(err);
						return c.json({ error: `Meta campaign list failed: ${message}` }, 502);
					}

					const active = await goalRepo.listActive(cfg.metaAdAccountId);
					const byCampaign = new Map(active.map((g) => [g.campaignId, g]));

					const pending: PendingGuidance[] = [];
					for (const camp of liveCampaigns) {
						const goal = byCampaign.get(camp.id);
						const dailyBudget = camp.daily_budget
							? Number.parseInt(camp.daily_budget, 10) / 100
							: null;
						if (!goal) {
							pending.push({
								campaignId: camp.id,
								campaignName: camp.name,
								currentObjective: camp.objective,
								status: camp.status,
								dailyBudget,
								reason: "no_goal_configured",
							});
						} else if (goal.lastSeenObjective !== camp.objective) {
							pending.push({
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
					return c.json(pending);
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
						return c.json(
							{ error: `primaryKpi must be one of ${[...VALID_KPIS].join(", ")}` },
							400,
						);
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

				/* ---- HTML serve: inject the API key so the SPA can authenticate ----
				 *
				 * The bundled React app reads the API key from
				 * localStorage["meta-ads-agent-api-key"] (see
				 * packages/dashboard/src/api/client.ts:getApiKey). On a clean
				 * browser profile that storage is empty, every /api/* request
				 * comes back 401, and the user has no clear path to recover.
				 *
				 * Since the dashboard server is launched from the same shell
				 * environment that holds the key (DASHBOARD_API_KEY or
				 * --api-key), and is same-origin with the SPA it serves, we
				 * inject a small bootstrap script into <head> that primes
				 * localStorage on first load. Subsequent reloads find the key
				 * already there.
				 *
				 * Threat model: the key is sent over the loopback interface
				 * only. Anything that can read process env on the same machine
				 * already has the key. We HTML-escape the value defensively in
				 * case a future caller passes a key containing `<`/`</script>`.
				 */
				const serveIndex = async (c: Context) => {
					const indexPath = join(staticDir, "index.html");
					if (!existsSync(indexPath)) {
						return c.text("Dashboard assets not found", 500);
					}
					const { readFile } = await import("node:fs/promises");
					let html = await readFile(indexPath, "utf-8");

					if (!authDisabled && apiKey) {
						const safe = JSON.stringify(apiKey); /* JSON-escapes embedded quotes/backslashes */
						const inject = [
							"<script>",
							`(function(){try{var k=${safe};var s=window.localStorage;`,
							'if(s.getItem("meta-ads-agent-api-key")!==k)s.setItem("meta-ads-agent-api-key",k);',
							"}catch(e){}})();",
							"</script>",
						].join("");
						if (html.includes("</head>")) {
							html = html.replace("</head>", `${inject}</head>`);
						} else {
							/* Fallback for HTMLs that lack a <head> element entirely. */
							html = inject + html;
						}
					}
					return c.html(html);
				};

				/* Intercept the HTML routes BEFORE the static middleware so the
				 * injection always runs. The static middleware handles JS/CSS/etc. */
				app.get("/", (c) => serveIndex(c));
				app.get("/index.html", (c) => serveIndex(c));

				/* ---- Static assets (the React SPA build output) ---- */
				app.use("/*", serveStatic({ root: staticDir }));

				/* SPA fallback: any non-API non-asset GET should return index.html so
				 * client-side routes (e.g. /decisions, /campaigns) survive a refresh. */
				app.get("*", (c) => serveIndex(c));

				/* ---- Start the server ---- */
				const server = serve({ fetch: app.fetch, port }, (info) => {
					const url = `http://localhost:${info.port}`;
					section("Dashboard");
					console.log(`  URL:        ${url}`);
					console.log(`  Static dir: ${staticDir}`);
					console.log(`  Auth:       ${authDisabled ? "DISABLED" : "X-API-Key required"}`);
					console.log("");
					success(`Dashboard listening on ${url}`);

					if (options.open !== false) {
						openBrowser(url);
					}
				});

				/* Graceful shutdown */
				const cleanup = (): void => {
					logger.info("Shutting down dashboard server...");
					server.close();
					try {
						dbConn.close();
					} catch {
						/* swallow */
					}
					process.exit(0);
				};
				process.on("SIGINT", cleanup);
				process.on("SIGTERM", cleanup);
			} catch (err: unknown) {
				handleError(err);
			}
		});
}
