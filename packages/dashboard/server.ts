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
 */

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

/**
 * Agent state type.
 */
type AgentState = "running" | "paused" | "stopped";

/**
 * In-memory agent state (replaced by core package integration in production).
 */
let agentState: AgentState = "stopped";
let sessionStartedAt: string | null = null;
let tickCount = 0;

const app = new Hono();

// CORS — restrict to dashboard origin
const corsOrigin = process.env.DASHBOARD_CORS_ORIGIN ?? "http://localhost:5173";
app.use("*", cors({ origin: corsOrigin }));

/**
 * API key authentication middleware.
 *
 * Validates the X-API-Key header against the DASHBOARD_API_KEY
 * environment variable. Returns 401 if the key is missing or invalid.
 */
app.use("/api/*", async (c, next) => {
	const expectedKey = process.env.DASHBOARD_API_KEY;

	// Require explicit opt-out for auth
	if (!expectedKey) {
		if (process.env.DASHBOARD_AUTH === "none") {
			await next();
			return;
		}
		if (process.env.NODE_ENV === "production") {
			return c.json({ error: "DASHBOARD_API_KEY must be set in production." }, 500);
		}
		console.warn(
			"[dashboard] WARNING: No DASHBOARD_API_KEY set. Set DASHBOARD_AUTH=none to explicitly skip auth in dev.",
		);
		await next();
		return;
	}

	const providedKey = c.req.header("X-API-Key");

	if (!providedKey || providedKey !== expectedKey) {
		return c.json({ error: "Unauthorized. Provide a valid X-API-Key header." }, 401);
	}

	await next();
});

/**
 * GET /api/status — Return the current agent session status.
 */
app.get("/api/status", async (c) => {
	// Try IPC first, fall back to in-memory state
	try {
		const ipcPath =
			process.env.AGENT_SOCKET_PATH ?? `${process.env.HOME}/.meta-ads-agent/agent.sock`;
		const { connect } = await import("node:net");
		const { randomUUID } = await import("node:crypto");
		const requestId = randomUUID();
		const result = await new Promise<unknown>((resolve, reject) => {
			const socket = connect(ipcPath);
			let buf = "";
			const timer = setTimeout(() => {
				socket.destroy();
				reject(new Error("timeout"));
			}, 5000);
			socket.on("connect", () => {
				socket.write(`${JSON.stringify({ id: requestId, method: "status", params: {} })}\n`);
			});
			socket.on("data", (chunk: Buffer) => {
				buf += chunk.toString();
				if (buf.includes("\n")) {
					clearTimeout(timer);
					socket.end();
					try {
						const r = JSON.parse(buf.split("\n")[0]);
						resolve(r.result);
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
		if (result) return c.json(result);
	} catch {
		/* fall through to in-memory */
	}

	return c.json({
		state: agentState,
		sessionId: sessionStartedAt ? `session_${Date.parse(sessionStartedAt)}` : null,
		startedAt: sessionStartedAt,
		lastTickAt: null,
		nextTickAt: null,
		tickCount,
		uptime: sessionStartedAt ? Math.floor((Date.now() - Date.parse(sessionStartedAt)) / 1000) : 0,
	});
});

/**
 * GET /api/decisions — Return agent decisions with optional filtering.
 *
 * Query parameters:
 *   status  Filter by decision status (pending | executed | failed | skipped)
 *   search  Text search across tool names and reasoning
 *   limit   Maximum records to return (default 50)
 *   offset  Pagination offset (default 0)
 */
app.get("/api/decisions", async (c) => {
	// Forward to agent daemon via IPC for live data
	try {
		const ipcPath =
			process.env.AGENT_SOCKET_PATH ?? `${process.env.HOME}/.meta-ads-agent/agent.sock`;
		const { connect } = await import("node:net");
		const { randomUUID } = await import("node:crypto");
		const requestId = randomUUID();
		const status = c.req.query("status");
		const search = c.req.query("search");
		const limit = Number.parseInt(c.req.query("limit") ?? "50", 10);
		const offset = Number.parseInt(c.req.query("offset") ?? "0", 10);
		const result = await new Promise<unknown>((resolve, reject) => {
			const socket = connect(ipcPath);
			let buf = "";
			const timer = setTimeout(() => {
				socket.destroy();
				reject(new Error("timeout"));
			}, 5000);
			socket.on("connect", () => {
				socket.write(
					`${JSON.stringify({ id: requestId, method: "get-decisions", params: { status, search, limit, offset } })}\n`,
				);
			});
			socket.on("data", (chunk: Buffer) => {
				buf += chunk.toString();
				if (buf.includes("\n")) {
					clearTimeout(timer);
					socket.end();
					try {
						const r = JSON.parse(buf.split("\n")[0]);
						resolve(r.result ?? []);
					} catch {
						resolve([]);
					}
				}
			});
			socket.on("error", () => {
				clearTimeout(timer);
				resolve([]);
			});
		});
		return c.json(result);
	} catch {
		return c.json([]);
	}
});

/**
 * GET /api/campaigns — Return campaign performance snapshots.
 */
app.get("/api/campaigns", async (c) => {
	// Forward to agent daemon via IPC for live data
	try {
		const ipcPath =
			process.env.AGENT_SOCKET_PATH ?? `${process.env.HOME}/.meta-ads-agent/agent.sock`;
		const { connect } = await import("node:net");
		const { randomUUID } = await import("node:crypto");
		const requestId = randomUUID();
		const result = await new Promise<unknown>((resolve, reject) => {
			const socket = connect(ipcPath);
			let buf = "";
			const timer = setTimeout(() => {
				socket.destroy();
				reject(new Error("timeout"));
			}, 5000);
			socket.on("connect", () => {
				socket.write(`${JSON.stringify({ id: requestId, method: "get-campaigns", params: {} })}\n`);
			});
			socket.on("data", (chunk: Buffer) => {
				buf += chunk.toString();
				if (buf.includes("\n")) {
					clearTimeout(timer);
					socket.end();
					try {
						const r = JSON.parse(buf.split("\n")[0]);
						resolve(r.result ?? []);
					} catch {
						resolve([]);
					}
				}
			});
			socket.on("error", () => {
				clearTimeout(timer);
				resolve([]);
			});
		});
		return c.json(result);
	} catch {
		return c.json([]);
	}
});

/**
 * POST /api/control/pause — Pause the running agent.
 */
app.post("/api/control/pause", async (c) => {
	try {
		const ipcPath =
			process.env.AGENT_SOCKET_PATH ?? `${process.env.HOME}/.meta-ads-agent/agent.sock`;
		const { connect } = await import("node:net");
		const { randomUUID } = await import("node:crypto");
		const requestId = randomUUID();
		await new Promise<void>((resolve, reject) => {
			const socket = connect(ipcPath);
			const timer = setTimeout(() => {
				socket.destroy();
				reject(new Error("timeout"));
			}, 5000);
			socket.on("connect", () => {
				socket.write(`${JSON.stringify({ id: requestId, method: "pause", params: {} })}\n`);
			});
			socket.on("data", () => {
				clearTimeout(timer);
				socket.end();
				resolve();
			});
			socket.on("error", () => {
				clearTimeout(timer);
				resolve();
			});
		});
	} catch {
		/* best effort */
	}
	agentState = "paused";
	return c.json({ success: true, state: agentState });
});

/**
 * POST /api/control/resume — Resume a paused agent.
 */
app.post("/api/control/resume", async (c) => {
	try {
		const ipcPath =
			process.env.AGENT_SOCKET_PATH ?? `${process.env.HOME}/.meta-ads-agent/agent.sock`;
		const { connect } = await import("node:net");
		const { randomUUID } = await import("node:crypto");
		const requestId = randomUUID();
		await new Promise<void>((resolve, reject) => {
			const socket = connect(ipcPath);
			const timer = setTimeout(() => {
				socket.destroy();
				reject(new Error("timeout"));
			}, 5000);
			socket.on("connect", () => {
				socket.write(`${JSON.stringify({ id: requestId, method: "resume", params: {} })}\n`);
			});
			socket.on("data", () => {
				clearTimeout(timer);
				socket.end();
				resolve();
			});
			socket.on("error", () => {
				clearTimeout(timer);
				resolve();
			});
		});
	} catch {
		/* best effort */
	}
	agentState = "running";
	return c.json({ success: true, state: agentState });
});

/**
 * POST /api/control/run-once — Trigger a single OODA tick.
 */
app.post("/api/control/run-once", (c) => {
	if (agentState === "stopped") {
		// Auto-start the session for a single tick.
		agentState = "running";
		sessionStartedAt = new Date().toISOString();
	}

	tickCount++;
	return c.json({ success: true, tickCount });
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
