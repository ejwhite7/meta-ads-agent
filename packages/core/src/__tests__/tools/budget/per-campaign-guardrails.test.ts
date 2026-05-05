/**
 * @module __tests__/tools/budget/per-campaign-guardrails
 *
 * Per-campaign guardrail override tests (PR #37 wiring).
 *
 * The schema columns `campaign_goals.{min_daily_budget,
 * max_budget_scale_factor, require_approval_above}` have existed
 * since PR #23, but the budget tools previously bound to a single
 * frozen `GuardrailConfig` at factory time and ignored per-campaign
 * overrides. PR #37 wires them through via `resolveEffectiveGuardrails`.
 *
 * These tests verify two halves of that contract:
 *   1. The resolver helper itself (unit): override beats account, NULL
 *      column inherits, no goal at all uses account-wide defaults.
 *   2. The set_budget tool's integration with the resolver (rejects
 *      against the per-campaign floor that's stricter than the
 *      account-wide one).
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { bootstrapSqliteSchema } from "../../../db/bootstrap.js";
import type { GuardrailConfig } from "../../../decisions/types.js";
import { CampaignGoalRepository } from "../../../goals/repository.js";
import { resolveEffectiveGuardrails } from "../../../tools/budget/_guardrails.js";
import { createSetBudgetTool } from "../../../tools/budget/set-budget.js";
import type { ToolContext } from "../../../tools/types.js";

const ACCOUNT = "act_test_perc";
const ACCOUNT_GUARDRAILS: GuardrailConfig = {
	minDailyBudget: 10,
	maxBudgetScaleFactor: 2.0,
	maxActionsPerCycle: 5,
	requireApprovalAbove: 500,
};

/** Build a real CampaignGoalRepository on an in-memory SQLite. */
function buildRepo(): { repo: CampaignGoalRepository; close: () => void } {
	const sqlite = new Database(":memory:");
	bootstrapSqliteSchema(sqlite);
	const db = drizzle(sqlite);
	return { repo: new CampaignGoalRepository(db), close: () => sqlite.close() };
}

describe("resolveEffectiveGuardrails (helper)", () => {
	it("falls back to account-wide when no goalRepository on context", async () => {
		const ctx: ToolContext = {
			sessionId: "s",
			adAccountId: ACCOUNT,
			dryRun: false,
			timestamp: "t",
			guardrails: ACCOUNT_GUARDRAILS,
		};
		const eff = await resolveEffectiveGuardrails(ctx, "any-campaign", ACCOUNT_GUARDRAILS);
		expect(eff.minDailyBudget).toBe(10);
		expect(eff.source.minDailyBudget).toBe("account");
	});

	it("falls back to account-wide when the campaign has no goal", async () => {
		const { repo, close } = buildRepo();
		const ctx: ToolContext = {
			sessionId: "s",
			adAccountId: ACCOUNT,
			dryRun: false,
			timestamp: "t",
			goalRepository: repo,
			guardrails: ACCOUNT_GUARDRAILS,
		};
		const eff = await resolveEffectiveGuardrails(ctx, "no-such-campaign", ACCOUNT_GUARDRAILS);
		expect(eff.minDailyBudget).toBe(10);
		expect(eff.maxBudgetScaleFactor).toBe(2.0);
		expect(eff.requireApprovalAbove).toBe(500);
		expect(eff.source.minDailyBudget).toBe("account");
		close();
	});

	it("uses per-campaign override when set", async () => {
		const { repo, close } = buildRepo();
		await repo.upsert({
			adAccountId: ACCOUNT,
			campaignId: "camp-with-overrides",
			primaryKpi: "roas",
			primaryKpiTarget: 4,
			primaryKpiDirection: "maximize",
			lastSeenObjective: "OUTCOME_SALES",
			configuredBy: "test",
			minDailyBudget: 25 /* stricter than account's 10 */,
			maxBudgetScaleFactor: 1.5 /* stricter than account's 2.0 */,
			requireApprovalAbove: 100 /* stricter than account's 500 */,
		});

		const ctx: ToolContext = {
			sessionId: "s",
			adAccountId: ACCOUNT,
			dryRun: false,
			timestamp: "t",
			goalRepository: repo,
			guardrails: ACCOUNT_GUARDRAILS,
		};
		const eff = await resolveEffectiveGuardrails(ctx, "camp-with-overrides", ACCOUNT_GUARDRAILS);
		expect(eff.minDailyBudget).toBe(25);
		expect(eff.maxBudgetScaleFactor).toBe(1.5);
		expect(eff.requireApprovalAbove).toBe(100);
		expect(eff.source.minDailyBudget).toBe("campaign");
		expect(eff.source.maxBudgetScaleFactor).toBe("campaign");
		expect(eff.source.requireApprovalAbove).toBe("campaign");
		close();
	});

	it("inherits per-field: NULL columns fall back to account-wide", async () => {
		const { repo, close } = buildRepo();
		/* Override only `requireApprovalAbove`; the other two stay null
		 * \u2192 inherit from account. */
		await repo.upsert({
			adAccountId: ACCOUNT,
			campaignId: "camp-mixed",
			primaryKpi: "cpa",
			primaryKpiTarget: 25,
			primaryKpiDirection: "minimize",
			lastSeenObjective: "OUTCOME_LEADS",
			configuredBy: "test",
			requireApprovalAbove: 50,
		});

		const ctx: ToolContext = {
			sessionId: "s",
			adAccountId: ACCOUNT,
			dryRun: false,
			timestamp: "t",
			goalRepository: repo,
			guardrails: ACCOUNT_GUARDRAILS,
		};
		const eff = await resolveEffectiveGuardrails(ctx, "camp-mixed", ACCOUNT_GUARDRAILS);
		expect(eff.minDailyBudget).toBe(10); /* inherited */
		expect(eff.maxBudgetScaleFactor).toBe(2.0); /* inherited */
		expect(eff.requireApprovalAbove).toBe(50); /* overridden */
		expect(eff.source.minDailyBudget).toBe("account");
		expect(eff.source.maxBudgetScaleFactor).toBe("account");
		expect(eff.source.requireApprovalAbove).toBe("campaign");
		close();
	});

	it("treats a soft-deleted goal as no goal (account-wide applies)", async () => {
		const { repo, close } = buildRepo();
		await repo.upsert({
			adAccountId: ACCOUNT,
			campaignId: "camp-deleted",
			primaryKpi: "roas",
			primaryKpiTarget: 4,
			primaryKpiDirection: "maximize",
			lastSeenObjective: "OUTCOME_SALES",
			configuredBy: "test",
			minDailyBudget: 99 /* would override if active */,
		});
		await repo.softDelete(ACCOUNT, "camp-deleted", "test", "reset");

		const ctx: ToolContext = {
			sessionId: "s",
			adAccountId: ACCOUNT,
			dryRun: false,
			timestamp: "t",
			goalRepository: repo,
			guardrails: ACCOUNT_GUARDRAILS,
		};
		const eff = await resolveEffectiveGuardrails(ctx, "camp-deleted", ACCOUNT_GUARDRAILS);
		expect(eff.minDailyBudget).toBe(10); /* account-wide, NOT 99 */
		expect(eff.source.minDailyBudget).toBe("account");
		close();
	});
});

describe("set_budget honors per-campaign guardrail overrides", () => {
	function makeMockClient(currentBudgetCents = "10000") {
		return {
			campaigns: {
				list: vi.fn().mockResolvedValue([]),
				get: vi.fn().mockResolvedValue({
					id: "camp_strict",
					name: "Strict",
					status: "ACTIVE",
					daily_budget: currentBudgetCents,
					objective: "OUTCOME_SALES",
					created_time: "2026-01-01T00:00:00Z",
					updated_time: "2026-01-15T00:00:00Z",
				}),
				update: vi.fn().mockResolvedValue({
					id: "camp_strict",
					name: "Strict",
					status: "ACTIVE",
					daily_budget: "20000",
					objective: "OUTCOME_SALES",
					created_time: "2026-01-01T00:00:00Z",
					updated_time: "2026-01-15T12:00:00Z",
				}),
			},
			adSets: {
				get: vi.fn(),
				update: vi.fn(),
				list: vi.fn().mockResolvedValue([]),
			},
			ads: { list: vi.fn().mockResolvedValue([]) },
			insights: { query: vi.fn().mockResolvedValue([]) },
		} as unknown as Parameters<typeof createSetBudgetTool>[0];
	}

	it("rejects against the per-campaign floor that's stricter than the account-wide one", async () => {
		const { repo, close } = buildRepo();
		await repo.upsert({
			adAccountId: ACCOUNT,
			campaignId: "camp_strict",
			primaryKpi: "roas",
			primaryKpiTarget: 4,
			primaryKpiDirection: "maximize",
			lastSeenObjective: "OUTCOME_SALES",
			configuredBy: "test",
			minDailyBudget: 50 /* much stricter than account's 10 */,
		});

		const client = makeMockClient("10000"); /* current $100 */
		const tool = createSetBudgetTool(client, ACCOUNT_GUARDRAILS);

		const result = await tool.execute(
			{ campaignId: "camp_strict", dailyBudget: 25, reason: "Try $25" },
			{
				sessionId: "s",
				adAccountId: ACCOUNT,
				dryRun: false,
				timestamp: "t",
				goalRepository: repo,
				guardrails: ACCOUNT_GUARDRAILS,
			},
		);

		expect(result.success).toBe(false);
		/* The error message should point at the per-campaign floor of $50
		 * \u2014 the account-wide floor is $10 and would have allowed $25. */
		expect(result.message).toMatch(/below the minimum daily budget of \$50\.00/);
		expect(result.message).toContain("(per-campaign)");
		expect(result.data?.minDailyBudget).toBe(50);
		expect(result.data?.minDailyBudgetSource).toBe("campaign");
		expect(client.campaigns.update).not.toHaveBeenCalled();
		close();
	});

	it("falls back to account-wide guardrails when no per-campaign goal exists", async () => {
		const { repo, close } = buildRepo();
		const client = makeMockClient("10000");
		const tool = createSetBudgetTool(client, ACCOUNT_GUARDRAILS);

		/* No goal seeded \u2014 should hit the account-wide $10 floor. */
		const result = await tool.execute(
			{ campaignId: "camp_unguided", dailyBudget: 5, reason: "Try $5" },
			{
				sessionId: "s",
				adAccountId: ACCOUNT,
				dryRun: false,
				timestamp: "t",
				goalRepository: repo,
				guardrails: ACCOUNT_GUARDRAILS,
			},
		);

		expect(result.success).toBe(false);
		expect(result.message).toMatch(/below the minimum daily budget of \$10\.00/);
		expect(result.message).not.toContain("(per-campaign)");
		expect(result.data?.minDailyBudgetSource).toBe("account");
		close();
	});

	it("triggers approval at the per-campaign threshold instead of account-wide", async () => {
		const { repo, close } = buildRepo();
		await repo.upsert({
			adAccountId: ACCOUNT,
			campaignId: "camp_strict",
			primaryKpi: "roas",
			primaryKpiTarget: 4,
			primaryKpiDirection: "maximize",
			lastSeenObjective: "OUTCOME_SALES",
			configuredBy: "test",
			requireApprovalAbove: 100 /* much stricter than account's 500 */,
		});

		/* Set up a current budget that's high enough that $150 doesn't
		 * trip the scale-factor ceiling. Current $200 \u2192 max $400 \u2192 $150
		 * is below ceiling but above the per-campaign $100 approval. */
		const client = makeMockClient("20000");
		const tool = createSetBudgetTool(client, ACCOUNT_GUARDRAILS);

		const result = await tool.execute(
			{ campaignId: "camp_strict", dailyBudget: 150, reason: "Scale up" },
			{
				sessionId: "s",
				adAccountId: ACCOUNT,
				dryRun: false,
				timestamp: "t",
				goalRepository: repo,
				guardrails: ACCOUNT_GUARDRAILS,
			},
		);

		expect(result.success).toBe(true);
		expect(result.data?.status).toBe("pending_approval");
		expect(result.data?.requireApprovalAbove).toBe(100);
		expect(result.data?.requireApprovalAboveSource).toBe("campaign");
		expect(result.message).toContain("(per-campaign)");
		expect(client.campaigns.update).not.toHaveBeenCalled();
		close();
	});
});
