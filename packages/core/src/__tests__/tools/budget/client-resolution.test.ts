/**
 * @module __tests__/tools/budget/client-resolution.test
 *
 * Verifies the budget tools' client-resolution behaviour:
 *   - Static `budgetTools` (created with no bound client) resolve
 *     `context.metaClient` at execution time.
 *   - Tools return a structured error when no client is available
 *     in either the bound slot or the context.
 *   - Bound clients take precedence over `context.metaClient`.
 *
 * This regresses CRT bug C2 from the code review: previously the static
 * array was created with `{} as MetaClient`, so the first method call
 * threw `Cannot read properties of undefined`.
 */

import { describe, expect, it, vi } from "vitest";
import { budgetTools, createSetBudgetTool } from "../../../tools/budget/index.js";
import type { ToolContext } from "../../../tools/types.js";

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
	return {
		sessionId: "test-session",
		adAccountId: "act_123",
		dryRun: true,
		timestamp: new Date().toISOString(),
		metaClient: undefined,
		auditLogger: undefined,
		goals: undefined,
		guardrails: undefined,
		...overrides,
	} as ToolContext;
}

describe("budget tool client resolution", () => {
	it("static set_budget tool resolves context.metaClient at execute time", async () => {
		const setBudget = budgetTools.find((t) => t.name === "set_budget");
		expect(setBudget).toBeDefined();

		const fakeClient = {
			campaigns: {
				get: vi.fn().mockResolvedValue({ id: "c1", daily_budget: "5000" }),
				update: vi.fn().mockResolvedValue({ id: "c1" }),
			},
			adSets: { get: vi.fn(), update: vi.fn() },
		};

		const ctx = makeContext({ metaClient: fakeClient, dryRun: false });
		const result = await setBudget?.execute(
			{ campaignId: "c1", dailyBudget: 60, reason: "scale up" },
			ctx,
		);
		expect(result?.success).toBe(true);
		expect(fakeClient.campaigns.update).toHaveBeenCalledWith("c1", {
			daily_budget: "6000",
		});
	});

	it("returns META_CLIENT_UNAVAILABLE when no client is bound or in context", async () => {
		const setBudget = budgetTools.find((t) => t.name === "set_budget");
		const result = await setBudget?.execute(
			{ campaignId: "c1", dailyBudget: 60, reason: "test" },
			makeContext({ metaClient: undefined }),
		);
		expect(result?.success).toBe(false);
		expect(result?.errorCode).toBe("META_CLIENT_UNAVAILABLE");
	});

	it("bound client takes precedence over context.metaClient", async () => {
		const boundClient = {
			campaigns: {
				get: vi.fn().mockResolvedValue({ id: "c1", daily_budget: "1000" }),
				update: vi.fn().mockResolvedValue({ id: "c1" }),
			},
			adSets: { get: vi.fn(), update: vi.fn() },
		};
		const contextClient = {
			campaigns: {
				get: vi.fn().mockResolvedValue({ id: "c1", daily_budget: "9999" }),
				update: vi.fn(),
			},
			adSets: { get: vi.fn(), update: vi.fn() },
		};

		// biome-ignore lint/suspicious/noExplicitAny: test injects a partial client
		const tool = createSetBudgetTool(boundClient as any);
		const ctx = makeContext({ metaClient: contextClient, dryRun: false });
		await tool.execute({ campaignId: "c1", dailyBudget: 12, reason: "test" }, ctx);
		expect(boundClient.campaigns.get).toHaveBeenCalled();
		expect(contextClient.campaigns.get).not.toHaveBeenCalled();
	});
});
