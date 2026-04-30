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

import { Hono } from "hono";
import { serve } from "@hono/node-server";
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

// CORS for local development
app.use("*", cors());

/**
 * API key authentication middleware.
 *
 * Validates the X-API-Key header against the DASHBOARD_API_KEY
 * environment variable. Returns 401 if the key is missing or invalid.
 */
app.use("/api/*", async (c, next) => {
  const expectedKey = process.env.DASHBOARD_API_KEY;

  // Skip auth if no key is configured (development mode).
  if (!expectedKey) {
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
app.get("/api/status", (c) => {
  return c.json({
    state: agentState,
    sessionId: sessionStartedAt ? `session_${Date.parse(sessionStartedAt)}` : null,
    startedAt: sessionStartedAt,
    lastTickAt: null,
    nextTickAt: null,
    tickCount,
    uptime: sessionStartedAt
      ? Math.floor((Date.now() - Date.parse(sessionStartedAt)) / 1000)
      : 0,
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
app.get("/api/decisions", (c) => {
  // Returns an empty array until the core package provides the audit log query.
  return c.json([]);
});

/**
 * GET /api/campaigns — Return campaign performance snapshots.
 */
app.get("/api/campaigns", (c) => {
  // Returns an empty array until the core package provides campaign data.
  return c.json([]);
});

/**
 * POST /api/control/pause — Pause the running agent.
 */
app.post("/api/control/pause", (c) => {
  if (agentState !== "running") {
    return c.json({ error: `Cannot pause: agent is ${agentState}.` }, 400);
  }

  agentState = "paused";
  return c.json({ success: true, state: agentState });
});

/**
 * POST /api/control/resume — Resume a paused agent.
 */
app.post("/api/control/resume", (c) => {
  if (agentState !== "paused") {
    return c.json({ error: `Cannot resume: agent is ${agentState}.` }, 400);
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
const port = parseInt(process.env.DASHBOARD_PORT ?? "3001", 10);

serve({
  fetch: app.fetch,
  port,
});

console.log(`Dashboard API server listening on http://localhost:${port}`);
