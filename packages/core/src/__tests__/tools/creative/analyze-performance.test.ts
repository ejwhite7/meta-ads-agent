/**
 * @module __tests__/tools/creative/analyze-performance.test
 *
 * Unit tests for the analyze-creative-performance tool.
 * Tests the winner/loser/fatigued classification logic with mock insights
 * data, verifying median CTR thresholds, frequency-based fatigue detection,
 * and the bottom-20% retirement recommendation algorithm.
 */

import { describe, it, expect } from "vitest";
import {
	buildAnalysis,
	classifyCreatives,
} from "../../../tools/creative/analyze-creative-performance.js";
import type { CreativePerformanceAnalysis } from "../../../tools/creative/types.js";
import type { InsightsResultLike } from "../../../tools/creative/types.js";

/**
 * Creates a mock insights result with configurable metrics.
 *
 * @param overrides - Partial fields to override defaults.
 * @returns A complete InsightsResultLike object.
 */
function mockInsight(overrides: Partial<InsightsResultLike> & { ad_id: string }): InsightsResultLike {
	return {
		impressions: "10000",
		clicks: "100",
		spend: "50.00",
		ctr: "1.0",
		cpm: "5.0",
		date_start: "2026-04-01",
		date_stop: "2026-04-07",
		...overrides,
	};
}

describe("buildAnalysis", () => {
	it("should transform insights into performance analysis objects", () => {
		const insights: InsightsResultLike[] = [
			mockInsight({ ad_id: "ad_1", ctr: "2.5", cpm: "8.0", impressions: "5000", clicks: "125" }),
			mockInsight({ ad_id: "ad_2", ctr: "0.5", cpm: "12.0", impressions: "10000", clicks: "50" }),
		];

		const analyses = buildAnalysis(insights);

		expect(analyses).toHaveLength(2);
		expect(analyses[0].creativeId).toBe("ad_1");
		expect(analyses[0].ctr).toBe(2.5);
		expect(analyses[0].cpm).toBe(8.0);
		expect(analyses[1].creativeId).toBe("ad_2");
		expect(analyses[1].ctr).toBe(0.5);
	});

	it("should skip insights without ad_id", () => {
		const insights: InsightsResultLike[] = [
			mockInsight({ ad_id: "ad_1" }),
			{ ...mockInsight({ ad_id: "" }), ad_id: undefined },
		];

		const analyses = buildAnalysis(insights);
		expect(analyses).toHaveLength(1);
	});

	it("should extract conversions from actions array", () => {
		const insights: InsightsResultLike[] = [
			mockInsight({
				ad_id: "ad_1",
				actions: [
					{ action_type: "purchase", value: "10" },
					{ action_type: "lead", value: "5" },
					{ action_type: "link_click", value: "200" },
				],
			}),
		];

		const analyses = buildAnalysis(insights);
		expect(analyses[0].conversions).toBe(15);
	});

	it("should handle missing actions gracefully", () => {
		const insights: InsightsResultLike[] = [
			mockInsight({ ad_id: "ad_1" }),
		];

		const analyses = buildAnalysis(insights);
		expect(analyses[0].conversions).toBe(0);
	});

	it("should compute composite score as CTR * conversions / frequency", () => {
		const insights: InsightsResultLike[] = [
			mockInsight({
				ad_id: "ad_1",
				ctr: "2.0",
				impressions: "10000",
				clicks: "200",
				actions: [{ action_type: "purchase", value: "20" }],
			}),
		];

		const analyses = buildAnalysis(insights);
		/* Score = CTR * conversions / frequency */
		expect(analyses[0].score).toBeGreaterThan(0);
		expect(analyses[0].ctr).toBe(2.0);
		expect(analyses[0].conversions).toBe(20);
	});
});

describe("classifyCreatives", () => {
	it("should return empty arrays for empty input", () => {
		const result = classifyCreatives([]);
		expect(result.winners).toHaveLength(0);
		expect(result.losers).toHaveLength(0);
		expect(result.fatigued).toHaveLength(0);
		expect(result.recommended).toHaveLength(0);
	});

	it("should classify creatives with above-median CTR as winners", () => {
		const analyses: CreativePerformanceAnalysis[] = [
			{ creativeId: "ad_1", ctr: 3.0, cpm: 5, frequency: 1.5, conversions: 10, score: 20, recommendation: "keep" },
			{ creativeId: "ad_2", ctr: 1.0, cpm: 5, frequency: 1.5, conversions: 5, score: 3.3, recommendation: "keep" },
			{ creativeId: "ad_3", ctr: 2.0, cpm: 5, frequency: 1.5, conversions: 8, score: 10.7, recommendation: "keep" },
		];

		const result = classifyCreatives(analyses);

		/* Median CTR = 2.0; winners are CTR >= 2.0 */
		const winnerIds = result.winners.map((w) => w.creativeId);
		expect(winnerIds).toContain("ad_1");
		expect(winnerIds).toContain("ad_3");
	});

	it("should classify creatives with below-median CTR and frequency > 3 as losers", () => {
		const analyses: CreativePerformanceAnalysis[] = [
			{ creativeId: "ad_1", ctr: 3.0, cpm: 5, frequency: 2, conversions: 10, score: 15, recommendation: "keep" },
			{ creativeId: "ad_2", ctr: 0.5, cpm: 12, frequency: 4, conversions: 2, score: 0.25, recommendation: "keep" },
			{ creativeId: "ad_3", ctr: 2.0, cpm: 5, frequency: 2, conversions: 8, score: 8, recommendation: "keep" },
		];

		const result = classifyCreatives(analyses);

		/* ad_2 has CTR 0.5 (below median 2.0) and frequency 4 (> 3) */
		const loserIds = result.losers.map((l) => l.creativeId);
		expect(loserIds).toContain("ad_2");
		expect(loserIds).not.toContain("ad_1");
	});

	it("should classify creatives with frequency > 5 as fatigued", () => {
		const analyses: CreativePerformanceAnalysis[] = [
			{ creativeId: "ad_1", ctr: 3.0, cpm: 5, frequency: 2, conversions: 10, score: 15, recommendation: "keep" },
			{ creativeId: "ad_2", ctr: 1.5, cpm: 8, frequency: 6, conversions: 5, score: 1.25, recommendation: "keep" },
			{ creativeId: "ad_3", ctr: 2.0, cpm: 5, frequency: 7, conversions: 3, score: 0.86, recommendation: "keep" },
		];

		const result = classifyCreatives(analyses);

		const fatiguedIds = result.fatigued.map((f) => f.creativeId);
		expect(fatiguedIds).toContain("ad_2");
		expect(fatiguedIds).toContain("ad_3");
		expect(fatiguedIds).not.toContain("ad_1");
	});

	it("should recommend bottom 20% by score for retirement", () => {
		/* 5 creatives => bottom 20% = 1 creative (ceil(5 * 0.2) = 1) */
		const analyses: CreativePerformanceAnalysis[] = [
			{ creativeId: "ad_1", ctr: 3.0, cpm: 5, frequency: 1, conversions: 20, score: 60, recommendation: "keep" },
			{ creativeId: "ad_2", ctr: 2.5, cpm: 6, frequency: 1.5, conversions: 15, score: 25, recommendation: "keep" },
			{ creativeId: "ad_3", ctr: 2.0, cpm: 7, frequency: 2, conversions: 10, score: 10, recommendation: "keep" },
			{ creativeId: "ad_4", ctr: 1.0, cpm: 10, frequency: 3, conversions: 5, score: 1.67, recommendation: "keep" },
			{ creativeId: "ad_5", ctr: 0.3, cpm: 15, frequency: 4, conversions: 1, score: 0.075, recommendation: "keep" },
		];

		const result = classifyCreatives(analyses);

		const retiredIds = result.recommended.map((r) => r.creativeId);
		expect(retiredIds).toContain("ad_5");
		expect(retiredIds).not.toContain("ad_1");
	});

	it("should set recommendation to 'retire' for retirement candidates", () => {
		const analyses: CreativePerformanceAnalysis[] = [
			{ creativeId: "ad_1", ctr: 3.0, cpm: 5, frequency: 1, conversions: 20, score: 60, recommendation: "keep" },
			{ creativeId: "ad_2", ctr: 0.1, cpm: 20, frequency: 5, conversions: 0, score: 0, recommendation: "keep" },
		];

		const result = classifyCreatives(analyses);

		const retired = result.recommended.find((r) => r.creativeId === "ad_2");
		expect(retired).toBeDefined();
		expect(retired?.recommendation).toBe("retire");
	});

	it("should set recommendation to 'rotate' for fatigued non-retirement creatives", () => {
		const analyses: CreativePerformanceAnalysis[] = [
			{ creativeId: "ad_1", ctr: 3.0, cpm: 5, frequency: 1, conversions: 20, score: 60, recommendation: "keep" },
			{ creativeId: "ad_2", ctr: 2.0, cpm: 7, frequency: 6, conversions: 15, score: 5, recommendation: "keep" },
			{ creativeId: "ad_3", ctr: 1.5, cpm: 8, frequency: 2, conversions: 10, score: 7.5, recommendation: "keep" },
		];

		const result = classifyCreatives(analyses);

		const fatigued = result.fatigued.find((f) => f.creativeId === "ad_2");
		expect(fatigued).toBeDefined();
		expect(fatigued?.recommendation).toBe("rotate");
	});

	it("should handle single creative input", () => {
		const analyses: CreativePerformanceAnalysis[] = [
			{ creativeId: "ad_1", ctr: 2.0, cpm: 5, frequency: 2, conversions: 10, score: 10, recommendation: "keep" },
		];

		const result = classifyCreatives(analyses);

		/* Single creative is both at and above its own median */
		expect(result.winners).toHaveLength(1);
		/* Single creative is also bottom 20% by definition */
		expect(result.recommended).toHaveLength(1);
	});
});
