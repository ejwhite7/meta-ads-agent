/**
 * @module __tests__/goals/repository.test
 *
 * Hermetic tests for the campaign-goal repository against an in-memory
 * SQLite instance. Covers:
 *   - Insert + read of an active goal.
 *   - listActive returns the most-recent row per campaign.
 *   - softDelete moves the goal out of the active set but preserves history.
 *   - Reconfigure-after-delete works (new row, new active goal).
 *   - JSON-encoded secondary KPIs round-trip cleanly.
 *   - Per-campaign guardrail overrides are persisted as nullable values.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapSqliteSchema } from "../../db/bootstrap.js";
import { CampaignGoalRepository } from "../../goals/repository.js";
import type { CampaignGoalInput } from "../../goals/types.js";

function makeRepo() {
	const sqlite = new Database(":memory:");
	bootstrapSqliteSchema(sqlite);
	const db = drizzle(sqlite);
	return { sqlite, repo: new CampaignGoalRepository(db) };
}

const baseInput = (overrides: Partial<CampaignGoalInput> = {}): CampaignGoalInput => ({
	adAccountId: "act_smoke",
	campaignId: "c_1",
	primaryKpi: "roas",
	primaryKpiTarget: 3.0,
	primaryKpiDirection: "maximize",
	lastSeenObjective: "OUTCOME_SALES",
	configuredBy: "test",
	...overrides,
});

describe("CampaignGoalRepository", () => {
	let ctx: ReturnType<typeof makeRepo>;

	beforeEach(() => {
		ctx = makeRepo();
	});
	afterEach(() => {
		ctx.sqlite.close();
	});

	it("inserts and reads back an active goal", async () => {
		const created = await ctx.repo.upsert(baseInput());
		expect(created.dbId).toBeGreaterThan(0);
		expect(created.primaryKpi).toBe("roas");
		expect(created.deletedAt).toBeNull();

		const active = await ctx.repo.getActive("act_smoke", "c_1");
		expect(active?.dbId).toBe(created.dbId);
	});

	it("returns null for a campaign with no goal", async () => {
		const active = await ctx.repo.getActive("act_smoke", "missing");
		expect(active).toBeNull();
	});

	it("listActive returns the most-recent active row per campaign", async () => {
		await ctx.repo.upsert(baseInput({ campaignId: "c_1", primaryKpiTarget: 2.5 }));
		await new Promise((r) => setTimeout(r, 10)); /* ensure configuredAt differs */
		await ctx.repo.upsert(baseInput({ campaignId: "c_1", primaryKpiTarget: 4.0 }));
		await ctx.repo.upsert(baseInput({ campaignId: "c_2", primaryKpiTarget: 3.0 }));

		const list = await ctx.repo.listActive("act_smoke");
		expect(list).toHaveLength(2);
		const c1 = list.find((g) => g.campaignId === "c_1");
		expect(c1?.primaryKpiTarget).toBe(4.0); /* the more recent value */
	});

	it("softDelete makes a goal inactive while preserving history", async () => {
		await ctx.repo.upsert(baseInput({ campaignId: "c_1" }));
		const del = await ctx.repo.softDelete("act_smoke", "c_1", "test", "unit-test reason");
		expect(del?.deletedAt).not.toBeNull();

		expect(await ctx.repo.getActive("act_smoke", "c_1")).toBeNull();

		const history = await ctx.repo.listHistory("act_smoke", "c_1");
		expect(history).toHaveLength(2); /* original + soft-delete marker */
		expect(history.some((g) => g.deletedAt === null)).toBe(true);
		expect(history.some((g) => g.deletedAt !== null)).toBe(true);
	});

	it("reconfigure-after-delete: new upsert produces a new active row", async () => {
		await ctx.repo.upsert(baseInput({ campaignId: "c_1", primaryKpiTarget: 2.0 }));
		await ctx.repo.softDelete("act_smoke", "c_1", "test");
		await ctx.repo.upsert(baseInput({ campaignId: "c_1", primaryKpiTarget: 5.0 }));

		const active = await ctx.repo.getActive("act_smoke", "c_1");
		expect(active?.primaryKpiTarget).toBe(5.0);
		const history = await ctx.repo.listHistory("act_smoke", "c_1");
		expect(history).toHaveLength(3);
	});

	it("JSON-encoded secondaryKpis round-trip", async () => {
		const created = await ctx.repo.upsert(
			baseInput({
				secondaryKpis: [
					{ kpi: "cpa", target: 25, direction: "minimize" },
					{ kpi: "ctr", target: 0.02, direction: "maximize" },
				],
			}),
		);
		expect(created.secondaryKpis).toEqual([
			{ kpi: "cpa", target: 25, direction: "minimize" },
			{ kpi: "ctr", target: 0.02, direction: "maximize" },
		]);

		const readBack = await ctx.repo.getActive("act_smoke", "c_1");
		expect(readBack?.secondaryKpis).toHaveLength(2);
	});

	it("per-campaign guardrail overrides persist as nullable values", async () => {
		const withOverride = await ctx.repo.upsert(
			baseInput({
				campaignId: "c_with",
				minDailyBudget: 10,
				maxBudgetScaleFactor: 1.5,
				requireApprovalAbove: 500,
			}),
		);
		expect(withOverride.minDailyBudget).toBe(10);
		expect(withOverride.maxBudgetScaleFactor).toBe(1.5);
		expect(withOverride.requireApprovalAbove).toBe(500);

		const inheriting = await ctx.repo.upsert(baseInput({ campaignId: "c_inh" }));
		expect(inheriting.minDailyBudget).toBeNull();
		expect(inheriting.maxBudgetScaleFactor).toBeNull();
		expect(inheriting.requireApprovalAbove).toBeNull();
	});

	it("softDelete on a non-existent campaign returns null and is a no-op", async () => {
		const result = await ctx.repo.softDelete("act_smoke", "nonexistent", "test");
		expect(result).toBeNull();
	});
});
