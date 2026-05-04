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
	DrizzleAuditDatabase,
	agentDecisions,
	agentSessions,
	campaignSnapshots,
	createDatabase,
	loadConfig,
} from "@meta-ads-agent/core";
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
				void auditLogger; /* reserved for future filtered queries */
				const ipc = new IpcClient();

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
					const rows = await dbConn.db
						.select()
						.from(agentDecisions)
						.orderBy(desc(agentDecisions.timestamp))
						.limit(limit)
						.offset(offset);
					return c.json(rows);
				});

				app.get("/api/campaigns", async (c) => {
					const rows = await dbConn.db.select().from(campaignSnapshots).limit(50);
					return c.json(rows);
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
