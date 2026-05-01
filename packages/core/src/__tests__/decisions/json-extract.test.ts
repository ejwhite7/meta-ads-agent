/**
 * @module __tests__/decisions/json-extract.test
 *
 * Verifies the balanced-bracket JSON array extractor used by parseActions
 * is robust against the patterns LLMs commonly produce: code fences,
 * inline arrays in prose, nested arrays inside params, and string
 * literals containing brackets.
 */

import { describe, expect, it } from "vitest";
import { extractFirstJsonArray, parseActions } from "../../decisions/engine.js";
import type { Tool } from "../../tools/types.js";
// biome-ignore lint/suspicious/noExplicitAny: type-erased Tool array is fine for these tests
const tools: Tool<any>[] = [
	{
		name: "set_budget",
		description: "test",
		// biome-ignore lint/suspicious/noExplicitAny: schema not exercised here
		parameters: {} as any,
		execute: async () => ({ success: true, message: "" }),
	},
];

describe("extractFirstJsonArray", () => {
	it("returns null when no array is present", () => {
		expect(extractFirstJsonArray("no arrays here")).toBeNull();
	});

	it("extracts a top-level array", () => {
		expect(extractFirstJsonArray("prose [1, 2, 3] suffix")).toBe("[1, 2, 3]");
	});

	it("skips inline arrays that aren't valid JSON containers and finds the next one", () => {
		const text = `Notes: [see also] then the data: [{"k": 1}]`;
		expect(extractFirstJsonArray(text)).toBe('[{"k": 1}]');
	});

	it("handles nested arrays inside objects", () => {
		const text = '<actions>[{"params": {"fields": ["a","b"]}}]</actions>';
		expect(extractFirstJsonArray(text)).toBe('[{"params": {"fields": ["a","b"]}}]');
	});

	it("ignores brackets inside string literals", () => {
		const text = '[{"reasoning": "the [bracket] inside"}]';
		expect(extractFirstJsonArray(text)).toBe(text);
	});

	it("survives markdown code fences", () => {
		const text = '```json\n[{"toolName": "set_budget"}]\n```';
		expect(extractFirstJsonArray(text)).toBe('[{"toolName": "set_budget"}]');
	});
});

describe("parseActions with extractor", () => {
	it("parses actions through markdown wrapping", () => {
		const llm = `Sure! Here are my proposals:\n\n\`\`\`json\n[\n  {"toolName": "set_budget", "params": {"campaignId": "c1", "dailyBudget": 25, "reason": "scale"}, "reasoning": "test", "expectedOutcome": "ok", "confidence": 0.7, "expectedImpact": 0.3, "riskLevel": "low"}\n]\n\`\`\``;
		const actions = parseActions(llm, tools);
		expect(actions).toHaveLength(1);
		expect(actions[0].toolName).toBe("set_budget");
		expect(actions[0].confidence).toBe(0.7);
	});

	it("skips earlier non-proposal arrays", () => {
		const llm = `Recent metric trend: [1, 2, 3].\n\n<actions>[{"toolName": "set_budget", "params": {}, "reasoning": "r", "expectedOutcome": "o", "confidence": 0.5, "expectedImpact": 0.5, "riskLevel": "low"}]</actions>`;
		const actions = parseActions(llm, tools);
		expect(actions).toHaveLength(1);
		expect(actions[0].toolName).toBe("set_budget");
	});

	it("returns empty when no array is present", () => {
		expect(parseActions("no actions today", tools)).toEqual([]);
	});

	it("filters out actions for unknown tools", () => {
		const llm = `[{"toolName": "nonexistent_tool", "params": {}, "reasoning": "", "expectedOutcome": "", "confidence": 0.5, "expectedImpact": 0.5, "riskLevel": "low"}]`;
		expect(parseActions(llm, tools)).toEqual([]);
	});
});
