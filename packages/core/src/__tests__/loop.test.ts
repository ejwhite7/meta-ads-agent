/**
 * @module __tests__/loop.test
 * Unit tests for the OODA agent loop.
 *
 * Tests the stateless runAgentLoop function with mocked LLM and tools
 * to verify it correctly produces ranked ActionProposals.
 */

import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { runAgentLoop } from "../agent/loop.js";
import { EventStream } from "../llm/stream.js";
import type {
	LLMProvider,
	LLMResponse,
	Message,
	StreamEvent,
	ToolDefinition,
} from "../llm/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { createTool } from "../tools/types.js";
import type { AgentGoal, CampaignMetrics } from "../types.js";

/** Creates a mock LLM provider that returns canned proposals */
function createMockLLM(responseText: string): LLMProvider {
	return {
		name: "mock",
		model: "mock-model",
		stream(_messages: Message[], _tools: ToolDefinition[]): EventStream<StreamEvent, LLMResponse> {
			const es = new EventStream<StreamEvent, LLMResponse>();
			setTimeout(() => {
				es.push({ type: "text_delta", text: responseText });
				es.complete({
					content: responseText,
					toolCalls: [],
					usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
				});
			}, 5);
			return es;
		},
		streamSimple(prompt: string, _systemPrompt?: string): EventStream<string, string> {
			const es = new EventStream<string, string>();
			setTimeout(() => {
				es.push(responseText);
				es.complete(responseText);
			}, 5);
			return es;
		},
	};
}

/** Sample campaign metrics for testing */
const sampleMetrics: CampaignMetrics[] = [
	{
		campaignId: "campaign_1",
		impressions: 10000,
		clicks: 500,
		spend: 100,
		conversions: 25,
		roas: 2.5,
		cpa: 4.0,
		ctr: 0.05,
		date: "2024-01-15",
	},
	{
		campaignId: "campaign_2",
		impressions: 20000,
		clicks: 400,
		spend: 200,
		conversions: 10,
		roas: 1.2,
		cpa: 20.0,
		ctr: 0.02,
		date: "2024-01-15",
	},
];

/** Sample agent goals */
const sampleGoals: AgentGoal = {
	roasTarget: 3.0,
	cpaCap: 10.0,
	dailyBudgetLimit: 500,
	riskLevel: "moderate",
};

describe("runAgentLoop", () => {
	it("should return proposals from LLM reasoning", async () => {
		const registry = new ToolRegistry();

		const tool = createTool({
			name: "update_budget",
			description: "Update campaign budget",
			parameters: Type.Object({
				campaignId: Type.String(),
				dailyBudget: Type.Number(),
			}),
			execute: async () => ({ success: true, data: null, message: "Updated" }),
		});
		registry.register(tool);

		const llmResponse = JSON.stringify([
			{
				toolName: "update_budget",
				params: { campaignId: "campaign_1", dailyBudget: 150 },
				reasoning: "Campaign 1 is performing well, increase budget",
				expectedOutcome: "More conversions at similar CPA",
				confidence: 0.8,
				expectedImpact: 0.7,
				riskLevel: "low",
			},
		]);

		const mockLLM = createMockLLM(llmResponse);

		const result = await runAgentLoop({
			metrics: sampleMetrics,
			goals: sampleGoals,
			toolRegistry: registry,
			llmProvider: mockLLM,
			maxProposals: 5,
			});

		expect(result.proposals).toHaveLength(1);
		expect(result.proposals[0]?.toolName).toBe("update_budget");
		expect(result.proposals[0]?.score).toBeGreaterThan(0);
		expect(result.reasoning).toContain("update_budget");
		expect(result.metricsSummary.campaignCount).toBe(2);
		expect(result.metricsSummary.totalSpend).toBe(300);
	});

	it("should return empty proposals when LLM returns no actions", async () => {
		const registry = new ToolRegistry();
		const mockLLM = createMockLLM("No optimization actions needed at this time.");

		const result = await runAgentLoop({
			metrics: sampleMetrics,
			goals: sampleGoals,
			toolRegistry: registry,
			llmProvider: mockLLM,
			maxProposals: 5,
			});

		expect(result.proposals).toHaveLength(0);
		expect(result.reasoning).toContain("No optimization");
	});

	it("should handle empty metrics gracefully", async () => {
		const registry = new ToolRegistry();
		const mockLLM = createMockLLM("No data available.");

		const result = await runAgentLoop({
			metrics: [],
			goals: sampleGoals,
			toolRegistry: registry,
			llmProvider: mockLLM,
			maxProposals: 5,
			});

		expect(result.proposals).toHaveLength(0);
		expect(result.metricsSummary.campaignCount).toBe(0);
		expect(result.metricsSummary.totalSpend).toBe(0);
	});

	it("should limit proposals to maxProposals", async () => {
		const registry = new ToolRegistry();

		const tool1 = createTool({
			name: "tool_a",
			description: "Tool A",
			parameters: Type.Object({ id: Type.String() }),
			execute: async () => ({ success: true, data: null, message: "ok" }),
		});
		const tool2 = createTool({
			name: "tool_b",
			description: "Tool B",
			parameters: Type.Object({ id: Type.String() }),
			execute: async () => ({ success: true, data: null, message: "ok" }),
		});
		registry.register(tool1);
		registry.register(tool2);

		const llmResponse = JSON.stringify([
			{
				toolName: "tool_a",
				params: { id: "1" },
				reasoning: "r1",
				expectedOutcome: "o1",
				confidence: 0.9,
				expectedImpact: 0.9,
				riskLevel: "low",
			},
			{
				toolName: "tool_b",
				params: { id: "2" },
				reasoning: "r2",
				expectedOutcome: "o2",
				confidence: 0.8,
				expectedImpact: 0.8,
				riskLevel: "low",
			},
			{
				toolName: "tool_a",
				params: { id: "3" },
				reasoning: "r3",
				expectedOutcome: "o3",
				confidence: 0.7,
				expectedImpact: 0.7,
				riskLevel: "low",
			},
		]);

		const mockLLM = createMockLLM(llmResponse);

		const result = await runAgentLoop({
			metrics: sampleMetrics,
			goals: sampleGoals,
			toolRegistry: registry,
			llmProvider: mockLLM,
			maxProposals: 2,
			});

		expect(result.proposals).toHaveLength(2);
	});

	it("should include correct metrics summary", async () => {
		const registry = new ToolRegistry();
		const mockLLM = createMockLLM("[]");

		const result = await runAgentLoop({
			metrics: sampleMetrics,
			goals: sampleGoals,
			toolRegistry: registry,
			llmProvider: mockLLM,
			maxProposals: 5,
			});

		expect(result.metricsSummary.campaignCount).toBe(2);
		expect(result.metricsSummary.totalSpend).toBe(300);
		expect(result.metricsSummary.avgRoas).toBeCloseTo(1.85, 1);
		expect(result.metricsSummary.avgCpa).toBeCloseTo(12.0, 1);
		expect(result.metricsSummary.avgCtr).toBeCloseTo(0.035, 3);
	});
});
