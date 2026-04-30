/**
 * Hono API server for the meta-ads-agent dashboard.
 *
 * Serves the REST API that the React frontend consumes. Runs as a
 * standalone Node.js HTTP server on the port specified by the
 * DASHBOARD_PORT environment variable (default 3001).
 *
 * Routes:
 *   GET  /api/status          Agent session status
 *   GET  /api/decisions       Decision log with optional filters
 *   GET  /api/campaigns       Campaign performance snapshots
 *   POST /api/control/pause   Pause the running agent
 *   POST /api/control/resume  Resume a paused agent
 *   POST /api/control/run-once  Trigger a single OODA tick
 *
 * All routes require a valid X-API-Key header for authentication.
 * Data is served from the Drizzle ORM database with IPC fallback for
 * live daemon communication.
 */

import { serve } from "@hono/node-server";
import {
	agentDecisions,
	agentSessions,
	campaignSnapshots,
	createDatabase,
} from "@meta-ads-agent/core";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";

/**
 * Create the database connection using environment config or SQLite defaults.
 */
const dbConnection = createDatabase({
	type: "sqlite",
	sqlitePath: process.env.DB_PATH ?? "./data/agent.db",
});
const db = dbConnection.db;

/**
 * Send an IPC message to the daemon socket and return the result.
 *
 * @param method - The IPC method name (e.g. "pause", "resume", "status").
 * @param params - Parameters for the IPC call.
 * @returns The result from the daemon, or null if the daemon is unreachable.
 */
async function sendIpc(method: string, params: unknown = {}): Promise<unknown> {
	const ipcPath = process.env.AGENT_SOCKET_PATH ?? `${process.env.HOME}/.meta-ads-agent/agent.sock`;
	const { connect } = await import("node:net");
	const { randomUUID } = await import("node:crypto");
	const requestId = randomUUID();

	return new Promise<unknown>((resolve) => {
		const socket = connect(ipcPath);
		let buf = "";
		const timer = setTimeout(() => {
			socket.destroy();
			resolve(null);
		}, 5000);

		socket.on("connect", () => {
			socket.write(`${JSON.stringify({ id: requestId, method, params })}\n`);
		});
		socket.on("data", (chunk: Buffer) => {
			buf += chunk.toString();
			if (buf.includes("\n")) {
				clearTimeout(timer);
				socket.end();
				try {
					const r = JSON.parse(buf.split("\n")[0]);
					resolve(r.result ?? null);
				} catch {
					resolve(null);
				}
			}
		});
		socket.on("error", () => {
			clearTimeout(timer);
			resolve(null);
		});
	});
}

const app = new Hono();

// CORS -- restrict to dashboard origin
const corsOrigin = process.env.DASHBOARD_CORS_ORIGIN ?? "http://localhost:5173";
app.use("*", cors({ origin: corsOrigin }));

/**
 * API key authentication middleware.
 *
 * Validates the X-API-Key header against the DASHBOARD_API_KEY
 * environment variable. Returns 401 if the key is missing or invalid.
 * Set DASHBOARD_AUTH=none to explicitly disable authentication.
 */
app.use("/api/*", async (c, next) => {
	const authDisabled = process.env.DASHBOARD_AUTH === "none";
	if (authDisabled) {
		await next();
		return;
	}

	const key = process.env.DASHBOARD_API_KEY;
	if (!key) {
		console.warn(
			"[dashboard] DASHBOARD_API_KEY not set -- set DASHBOARD_AUTH=none to disable auth",
		);
	}

	const header = c.req.header("X-Api-Key");
	if (key && header !== key) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	await next();
});

/**
 * GET /api/status -- Return the current agent session status.
 *
 * Queries the most recent session from the database.
 */
app.get("/api/status", async (c) => {
	const rows = await db
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
	return c.json({
		state: session.state,
		sessionId: session.id,
		startedAt: session.createdAt,
		lastTickAt: session.lastTickAt,
		nextTickAt: null,
		tickCount: session.iterationCount,
	});
});

/**
 * GET /api/decisions -- Return agent decisions from the audit log.
 *
 * Query parameters:
 *   limit   Maximum records to return (default 100)
 *   offset  Pagination offset (default 0)
 */
app.get("/api/decisions", async (c) => {
	const limit = Number.parseInt(c.req.query("limit") ?? "100", 10);
	const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);

	const rows = await db
		.select()
		.from(agentDecisions)
		.orderBy(desc(agentDecisions.timestamp))
		.limit(limit)
		.offset(offset);

	return c.json(rows);
});

/**
 * GET /api/campaigns -- Return campaign performance snapshots.
 */
app.get("/api/campaigns", async (c) => {
	const rows = await db.select().from(campaignSnapshots).limit(50);
	return c.json(rows);
});

/**
 * POST /api/control/pause -- Pause the running agent.
 *
 * Updates the session state in the database, then attempts to notify
 * the daemon via IPC.
 */
app.post("/api/control/pause", async (c) => {
	const sessions = await db
		.select()
		.from(agentSessions)
		.orderBy(desc(agentSessions.createdAt))
		.limit(1);

	if (sessions.length > 0) {
		await db
			.update(agentSessions)
			.set({ state: "paused", updatedAt: new Date().toISOString() })
			.where(eq(agentSessions.id, sessions[0].id));
	}

	// Best-effort IPC notification to daemon
	await sendIpc("pause");

	return c.json({ success: true, state: "paused" });
});

/**
 * POST /api/control/resume -- Resume a paused agent.
 *
 * Updates the session state in the database, then attempts to notify
 * the daemon via IPC.
 */
app.post("/api/control/resume", async (c) => {
	const sessions = await db
		.select()
		.from(agentSessions)
		.orderBy(desc(agentSessions.createdAt))
		.limit(1);

	if (sessions.length > 0) {
		await db
			.update(agentSessions)
			.set({ state: "running", updatedAt: new Date().toISOString() })
			.where(eq(agentSessions.id, sessions[0].id));
	}

	// Best-effort IPC notification to daemon
	await sendIpc("resume");

	return c.json({ success: true, state: "running" });
});

/**
 * POST /api/control/run-once -- Trigger a single OODA tick via daemon IPC.
 */
app.post("/api/control/run-once", async (c) => {
	const result = await sendIpc("run-once", {});
	if (result) {
		return c.json(result);
	}
	return c.json({ error: "Agent daemon is not running" }, 503);
});

/**
 * Start the HTTP server.
 */
const port = Number.parseInt(process.env.DASHBOARD_PORT ?? "3001", 10);

serve({
	fetch: app.fetch,
	port,
});

console.log(`Dashboard API server listening on http://localhost:${port}`);
