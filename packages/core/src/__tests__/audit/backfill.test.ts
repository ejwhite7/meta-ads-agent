/**
 * @module __tests__/audit/backfill.test
 *
 * Regression tests for BackfillEngine. Asserts the four pillars:
 *   1. Successful prior-tick decisions get actual_outcome filled in.
 *   2. performance_delta is computed against the latest pre-decision
 *      campaign_snapshots row, NOT the current snapshot.
 *   3. Decisions without a campaignId in their params, or whose
 *      campaign isn't in the current metrics payload, are left
 *      pending (idempotent retry next tick).
 *   4. Already-backfilled rows are not picked up again.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { BackfillEngine } from "../../audit/backfill.js";
import { DrizzleAuditDatabase } from "../../audit/drizzle-adapter.js";
import { AuditLogger } from "../../audit/logger.js";
import { bootstrapSqliteSchema } from "../../db/bootstrap.js";
import { DrizzleSnapshotWriter } from "../../snapshots/writer.js";
import type { CampaignMetrics } from "../../types.js";

function makeStack() {
	const sqlite = new Database(":memory:");
	bootstrapSqliteSchema(sqlite);
	const db = drizzle(sqlite);
	const auditLogger = new AuditLogger(new DrizzleAuditDatabase(db));
	const snapshotWriter = new DrizzleSnapshotWriter(db);
	const backfill = new BackfillEngine(auditLogger, db);
	return { sqlite, db, auditLogger, snapshotWriter, backfill };
}

const baseMetric: CampaignMetrics = {
	campaignId: "camp_1",
	impressions: 1000,
	clicks: 50,
	spend: 25.5,
	conversions: 5,
	roas: 4.0,
	cpa: 5.1,
	ctr: 0.05,
	date: "2026-05-04",
};

describe("BackfillEngine", () => {
	let stack: ReturnType<typeof makeStack>;

	beforeEach(() => {
		stack = makeStack();
	});

	it("backfills actual_outcome and performance_delta against the pre-decision snapshot", async () => {
		/* Tick 1: write the baseline snapshot, log a decision. */
		await stack.snapshotWriter.writeSnapshots([baseMetric], "act_a", "2026-05-04T10:00:00Z");
		await stack.auditLogger.logDecision({
			id: "dec_1",
			sessionId: "s_1",
			adAccountId: "act_a",
			toolName: "set_budget",
			params: { campaignId: "camp_1", dailyBudget: 100 },
			reasoning: "scaling winner",
			expectedOutcome: "+10% spend, ROAS holds",
			score: 0.8,
			riskLevel: "low",
			success: true,
			resultData: { ok: true },
			errorMessage: null,
			timestamp: "2026-05-04T10:05:00Z",
		});

		/* Tick 2: campaign performance changed; engine runs against new metrics. */
		const tick2: CampaignMetrics = {
			...baseMetric,
			spend: 60.0,
			conversions: 9,
			roas: 4.5,
			cpa: 6.6,
			impressions: 1800,
			clicks: 90,
		};
		const result = await stack.backfill.run([tick2], "act_a");

		expect(result.pendingCount).toBe(1);
		expect(result.backfilledCount).toBe(1);
		expect(result.errored).toBe(0);

		const row = stack.sqlite
			.prepare("SELECT actual_outcome, performance_delta FROM agent_decisions WHERE id = ?")
			.get("dec_1") as { actual_outcome: string; performance_delta: string };

		const actual = JSON.parse(row.actual_outcome);
		expect(actual.spend).toBe(60.0);
		expect(actual.roas).toBe(4.5);

		const delta = JSON.parse(row.performance_delta);
		expect(delta.spend).toBeCloseTo(60.0 - 25.5, 4);
		expect(delta.conversions).toBe(9 - 5);
		expect(delta.roas).toBeCloseTo(4.5 - 4.0, 4);
		expect(delta.baselineRecordedAt).toBe("2026-05-04T10:00:00Z");
	});

	it("leaves performance_delta NULL when no pre-decision snapshot exists", async () => {
		/* Decision was made before any snapshot was ever written. */
		await stack.auditLogger.logDecision({
			id: "dec_orphan",
			sessionId: "s_1",
			adAccountId: "act_a",
			toolName: "set_budget",
			params: { campaignId: "camp_1", dailyBudget: 50 },
			reasoning: "r",
			expectedOutcome: "o",
			score: 0.5,
			riskLevel: "low",
			success: true,
			resultData: null,
			errorMessage: null,
			timestamp: "2026-05-04T09:00:00Z",
		});

		await stack.backfill.run([baseMetric], "act_a");

		const row = stack.sqlite
			.prepare("SELECT actual_outcome, performance_delta FROM agent_decisions WHERE id = ?")
			.get("dec_orphan") as { actual_outcome: string; performance_delta: string | null };

		expect(JSON.parse(row.actual_outcome).spend).toBe(25.5);
		expect(row.performance_delta).toBeNull();
	});

	it("skips decisions whose params don't reference a campaignId", async () => {
		await stack.auditLogger.logDecision({
			id: "dec_account_wide",
			sessionId: "s_1",
			adAccountId: "act_a",
			toolName: "generate_performance_report",
			params: { format: "markdown" },
			reasoning: "r",
			expectedOutcome: "o",
			score: 0.5,
			riskLevel: "low",
			success: true,
			resultData: null,
			errorMessage: null,
			timestamp: "2026-05-04T10:05:00Z",
		});

		const result = await stack.backfill.run([baseMetric], "act_a");

		expect(result.skippedNoCampaignId).toBe(1);
		expect(result.backfilledCount).toBe(0);

		const row = stack.sqlite
			.prepare("SELECT actual_outcome FROM agent_decisions WHERE id = ?")
			.get("dec_account_wide") as { actual_outcome: string | null };
		expect(row.actual_outcome).toBeNull();
	});

	it("skips (and retries next tick) decisions whose campaign isn't in current metrics", async () => {
		await stack.auditLogger.logDecision({
			id: "dec_paused",
			sessionId: "s_1",
			adAccountId: "act_a",
			toolName: "pause_campaign",
			params: { campaignId: "camp_paused" },
			reasoning: "r",
			expectedOutcome: "o",
			score: 0.5,
			riskLevel: "low",
			success: true,
			resultData: null,
			errorMessage: null,
			timestamp: "2026-05-04T10:05:00Z",
		});

		const result = await stack.backfill.run([baseMetric], "act_a"); // camp_paused absent

		expect(result.skippedNoCurrentMetrics).toBe(1);
		expect(result.backfilledCount).toBe(0);

		/* Row remains pending -- a second run with the campaign back in
		 * metrics must succeed. */
		const result2 = await stack.backfill.run(
			[{ ...baseMetric, campaignId: "camp_paused" }],
			"act_a",
		);
		expect(result2.backfilledCount).toBe(1);
	});

	it("does not re-pick rows that were already backfilled", async () => {
		await stack.snapshotWriter.writeSnapshots([baseMetric], "act_a", "2026-05-04T10:00:00Z");
		await stack.auditLogger.logDecision({
			id: "dec_idemp",
			sessionId: "s_1",
			adAccountId: "act_a",
			toolName: "set_budget",
			params: { campaignId: "camp_1", dailyBudget: 75 },
			reasoning: "r",
			expectedOutcome: "o",
			score: 0.5,
			riskLevel: "low",
			success: true,
			resultData: null,
			errorMessage: null,
			timestamp: "2026-05-04T10:05:00Z",
		});

		const first = await stack.backfill.run([baseMetric], "act_a");
		expect(first.backfilledCount).toBe(1);

		const second = await stack.backfill.run([baseMetric], "act_a");
		expect(second.pendingCount).toBe(0);
		expect(second.backfilledCount).toBe(0);
	});

	it("ignores failed decisions (only successful ones get graded)", async () => {
		await stack.auditLogger.logDecision({
			id: "dec_failed",
			sessionId: "s_1",
			adAccountId: "act_a",
			toolName: "set_budget",
			params: { campaignId: "camp_1", dailyBudget: 100 },
			reasoning: "r",
			expectedOutcome: "o",
			score: 0.5,
			riskLevel: "low",
			success: false,
			resultData: null,
			errorMessage: "Meta API 400",
			timestamp: "2026-05-04T10:05:00Z",
		});

		const result = await stack.backfill.run([baseMetric], "act_a");
		expect(result.pendingCount).toBe(0);
		expect(result.backfilledCount).toBe(0);
	});

	it("scopes by adAccountId so multi-tenant DBs don't cross-contaminate", async () => {
		await stack.auditLogger.logDecision({
			id: "dec_other_account",
			sessionId: "s_1",
			adAccountId: "act_b",
			toolName: "set_budget",
			params: { campaignId: "camp_1", dailyBudget: 100 },
			reasoning: "r",
			expectedOutcome: "o",
			score: 0.5,
			riskLevel: "low",
			success: true,
			resultData: null,
			errorMessage: null,
			timestamp: "2026-05-04T10:05:00Z",
		});

		const result = await stack.backfill.run([baseMetric], "act_a");
		expect(result.pendingCount).toBe(0);

		const otherResult = await stack.backfill.run([baseMetric], "act_b");
		expect(otherResult.pendingCount).toBe(1);
		expect(otherResult.backfilledCount).toBe(1);
	});
});
