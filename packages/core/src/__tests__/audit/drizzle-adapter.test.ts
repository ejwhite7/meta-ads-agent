/**
 * @module __tests__/audit/drizzle-adapter.test
 *
 * Verifies that DrizzleAuditDatabase.queryDecisions actually applies
 * AuditFilter conditions (toolName, sessionId, success, etc.). Earlier
 * versions silently dropped every filter except limit/offset.
 *
 * Uses an in-memory SQLite database so the test is hermetic.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DrizzleAuditDatabase } from "../../audit/drizzle-adapter.js";
import { agentDecisions } from "../../db/schema.js";

/**
 * Build an in-memory DB and seed it with a deterministic set of audit rows
 * covering multiple tool names, sessions, success flags, and timestamps.
 */
function makeDb() {
	const sqlite = new Database(":memory:");
	const db = drizzle(sqlite);

	sqlite.exec(`
		CREATE TABLE agent_decisions (
			id TEXT PRIMARY KEY,
			session_id TEXT NOT NULL,
			ad_account_id TEXT NOT NULL,
			tool_name TEXT NOT NULL,
			params TEXT NOT NULL,
			reasoning TEXT NOT NULL,
			expected_outcome TEXT NOT NULL,
			score REAL NOT NULL,
			risk_level TEXT NOT NULL,
			success INTEGER NOT NULL,
			result_data TEXT,
			error_message TEXT,
			actual_outcome TEXT,
			performance_delta TEXT,
			timestamp TEXT NOT NULL
		);
	`);

	const insert = sqlite.prepare(`
		INSERT INTO agent_decisions
		(id, session_id, ad_account_id, tool_name, params, reasoning,
		 expected_outcome, score, risk_level, success, result_data, error_message, timestamp)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const rows = [
		[
			"d1",
			"s1",
			"act_a",
			"set_budget",
			"{}",
			"r1",
			"o",
			0.5,
			"low",
			1,
			null,
			null,
			"2026-01-01T00:00:00Z",
		],
		[
			"d2",
			"s1",
			"act_a",
			"pause_campaign",
			"{}",
			"r2",
			"o",
			0.7,
			"medium",
			1,
			null,
			null,
			"2026-01-02T00:00:00Z",
		],
		[
			"d3",
			"s2",
			"act_b",
			"set_budget",
			"{}",
			"r3",
			"o",
			0.6,
			"low",
			0,
			null,
			"err",
			"2026-01-03T00:00:00Z",
		],
		[
			"d4",
			"s2",
			"act_a",
			"scale_campaign",
			"{}",
			"r4",
			"o",
			0.9,
			"high",
			1,
			null,
			null,
			"2026-01-05T00:00:00Z",
		],
	];
	for (const r of rows) insert.run(...r);

	return { sqlite, adapter: new DrizzleAuditDatabase(db) };
}

describe("DrizzleAuditDatabase.queryDecisions", () => {
	let ctx: ReturnType<typeof makeDb>;

	beforeEach(() => {
		ctx = makeDb();
	});

	afterEach(() => {
		ctx.sqlite.close();
	});

	it("returns all rows when no filter is applied (most-recent first)", async () => {
		const rows = await ctx.adapter.queryDecisions({});
		expect(rows.map((r) => r.id)).toEqual(["d4", "d3", "d2", "d1"]);
	});

	it("filters by toolName", async () => {
		const rows = await ctx.adapter.queryDecisions({ toolName: "set_budget" });
		expect(rows.map((r) => r.id)).toEqual(["d3", "d1"]);
	});

	it("filters by sessionId", async () => {
		const rows = await ctx.adapter.queryDecisions({ sessionId: "s1" });
		expect(rows.map((r) => r.id)).toEqual(["d2", "d1"]);
	});

	it("filters by adAccountId", async () => {
		const rows = await ctx.adapter.queryDecisions({ adAccountId: "act_b" });
		expect(rows.map((r) => r.id)).toEqual(["d3"]);
	});

	it("filters by riskLevel", async () => {
		const rows = await ctx.adapter.queryDecisions({ riskLevel: "high" });
		expect(rows.map((r) => r.id)).toEqual(["d4"]);
	});

	it("filters by success=false", async () => {
		const rows = await ctx.adapter.queryDecisions({ success: false });
		expect(rows.map((r) => r.id)).toEqual(["d3"]);
	});

	it("filters by date range (inclusive)", async () => {
		const rows = await ctx.adapter.queryDecisions({
			startDate: "2026-01-02T00:00:00Z",
			endDate: "2026-01-03T00:00:00Z",
		});
		expect(rows.map((r) => r.id).sort()).toEqual(["d2", "d3"]);
	});

	it("combines multiple filters with AND", async () => {
		const rows = await ctx.adapter.queryDecisions({
			adAccountId: "act_a",
			toolName: "set_budget",
		});
		expect(rows.map((r) => r.id)).toEqual(["d1"]);
	});

	it("respects limit and offset", async () => {
		const page1 = await ctx.adapter.queryDecisions({ limit: 2, offset: 0 });
		const page2 = await ctx.adapter.queryDecisions({ limit: 2, offset: 2 });
		expect(page1.map((r) => r.id)).toEqual(["d4", "d3"]);
		expect(page2.map((r) => r.id)).toEqual(["d2", "d1"]);
	});
});
