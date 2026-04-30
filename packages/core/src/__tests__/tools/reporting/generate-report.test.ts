/**
 * @module __tests__/tools/reporting/generate-report.test
 *
 * Unit tests for the generate-performance-report tool.
 * Verifies Markdown, CSV, and JSON output formats produce correct
 * structures with expected headers, sections, and data.
 */

import { describe, expect, it, vi } from "vitest";
import { generatePerformanceReport } from "../../../tools/reporting/generate-performance-report.js";
import type {
	InsightsResultLike,
	PerformanceReport,
	ReportingToolContext,
} from "../../../tools/reporting/types.js";

/** Creates a mock ReportingToolContext with configurable insights responses. */
function createMockContext(
	overrides: {
		campaignInsights?: InsightsResultLike[];
		adSetInsights?: InsightsResultLike[];
	} = {},
): ReportingToolContext {
	const queryFn = vi
		.fn()
		.mockResolvedValueOnce(overrides.campaignInsights ?? [])
		.mockResolvedValueOnce(overrides.adSetInsights ?? []);

	return {
		sessionId: "test-session",
		adAccountId: "act_123",
		dryRun: false,
		timestamp: new Date().toISOString(),
		metaClient: {
			campaigns: {
				list: vi.fn().mockResolvedValue([]),
				get: vi.fn(),
			},
			insights: {
				query: queryFn,
			},
			adSets: {
				list: vi.fn().mockResolvedValue([]),
			},
		},
	};
}

/** Sample campaign insights for testing. */
const sampleCampaignInsights: InsightsResultLike[] = [
	{
		campaign_id: "campaign_1",
		campaign_name: "Brand Awareness Campaign",
		impressions: "50000",
		clicks: "2500",
		spend: "500.00",
		ctr: "0.05",
		cpm: "10.00",
		cpc: "0.20",
		reach: "40000",
		frequency: "1.25",
		actions: [
			{ action_type: "purchase", value: "50" },
			{ action_type: "lead", value: "100" },
		],
		date_start: "2024-01-01",
		date_stop: "2024-01-07",
	},
	{
		campaign_id: "campaign_2",
		campaign_name: "Retargeting Campaign",
		impressions: "30000",
		clicks: "1800",
		spend: "300.00",
		ctr: "0.06",
		cpm: "10.00",
		cpc: "0.17",
		reach: "25000",
		frequency: "1.20",
		actions: [{ action_type: "purchase", value: "30" }],
		date_start: "2024-01-01",
		date_stop: "2024-01-07",
	},
];

/** Sample ad set insights for testing. */
const sampleAdSetInsights: InsightsResultLike[] = [
	{
		adset_id: "adset_1",
		adset_name: "US 25-34 Interest",
		campaign_id: "campaign_1",
		impressions: "30000",
		clicks: "1500",
		spend: "300.00",
		ctr: "0.05",
		cpm: "10.00",
		cpc: "0.20",
		actions: [{ action_type: "purchase", value: "30" }],
		date_start: "2024-01-01",
		date_stop: "2024-01-07",
	},
	{
		adset_id: "adset_2",
		adset_name: "US 35-44 Lookalike",
		campaign_id: "campaign_1",
		impressions: "20000",
		clicks: "1000",
		spend: "200.00",
		ctr: "0.05",
		cpm: "10.00",
		cpc: "0.20",
		actions: [{ action_type: "purchase", value: "20" }],
		date_start: "2024-01-01",
		date_stop: "2024-01-07",
	},
];

describe("generatePerformanceReport", () => {
	describe("markdown format", () => {
		it("should produce a readable Markdown report with summary and breakdowns", async () => {
			const ctx = createMockContext({
				campaignInsights: sampleCampaignInsights,
				adSetInsights: sampleAdSetInsights,
			});

			const result = await generatePerformanceReport.execute(
				{ adAccountId: "act_123", dateRange: "last_7d", format: "markdown" },
				ctx,
			);

			expect(result.success).toBe(true);
			const formatted = (result.data as Record<string, unknown>).formatted as string;

			/* Check headers */
			expect(formatted).toContain("# Performance Report");
			expect(formatted).toContain("## Summary");
			expect(formatted).toContain("## Top Campaigns (by Spend)");
			expect(formatted).toContain("## Top Ad Sets (by Spend)");

			/* Check summary metrics table */
			expect(formatted).toContain("Total Spend");
			expect(formatted).toContain("Total Impressions");
			expect(formatted).toContain("Total Clicks");
			expect(formatted).toContain("Avg CTR");
			expect(formatted).toContain("Avg CPC");
			expect(formatted).toContain("Total Conversions");
			expect(formatted).toContain("Avg ROAS");
			expect(formatted).toContain("Avg CPA");

			/* Check campaign names appear */
			expect(formatted).toContain("Brand Awareness Campaign");
			expect(formatted).toContain("Retargeting Campaign");

			/* Check ad set names appear */
			expect(formatted).toContain("US 25-34 Interest");
			expect(formatted).toContain("US 35-44 Lookalike");

			/* Check it has markdown table delimiters */
			expect(formatted).toContain("|--------|");
		});

		it("should include the date range in the report", async () => {
			const ctx = createMockContext({
				campaignInsights: sampleCampaignInsights,
				adSetInsights: sampleAdSetInsights,
			});

			const result = await generatePerformanceReport.execute(
				{ adAccountId: "act_123", dateRange: "last_7d", format: "markdown" },
				ctx,
			);

			const formatted = (result.data as Record<string, unknown>).formatted as string;
			expect(formatted).toContain("**Period:**");
		});
	});

	describe("csv format", () => {
		it("should produce CSV with campaign and ad set breakdowns", async () => {
			const ctx = createMockContext({
				campaignInsights: sampleCampaignInsights,
				adSetInsights: sampleAdSetInsights,
			});

			const result = await generatePerformanceReport.execute(
				{ adAccountId: "act_123", dateRange: "last_7d", format: "csv" },
				ctx,
			);

			expect(result.success).toBe(true);
			const formatted = (result.data as Record<string, unknown>).formatted as string;

			/* Check section headers */
			expect(formatted).toContain("Campaign Breakdown");
			expect(formatted).toContain("Ad Set Breakdown");

			/* Check CSV headers */
			expect(formatted).toContain(
				"Campaign,Spend,Impressions,Clicks,CTR,CPC,CPM,Conversions,ROAS,CPA",
			);
			expect(formatted).toContain(
				"Ad Set,Campaign ID,Spend,Impressions,Clicks,CTR,CPC,CPM,Conversions,ROAS,CPA",
			);

			/* Check data rows */
			expect(formatted).toContain("Brand Awareness Campaign");
			expect(formatted).toContain("US 25-34 Interest");

			/* Verify CSV has comma-separated values */
			const lines = formatted.split("\n");
			const dataLine = lines.find((l) => l.includes("Brand Awareness Campaign"));
			expect(dataLine).toBeDefined();
			expect(dataLine?.split(",").length).toBeGreaterThan(5);
		});
	});

	describe("json format", () => {
		it("should produce valid JSON with complete report structure", async () => {
			const ctx = createMockContext({
				campaignInsights: sampleCampaignInsights,
				adSetInsights: sampleAdSetInsights,
			});

			const result = await generatePerformanceReport.execute(
				{ adAccountId: "act_123", dateRange: "last_7d", format: "json" },
				ctx,
			);

			expect(result.success).toBe(true);
			const report = (result.data as Record<string, unknown>).report as PerformanceReport;

			/* Verify report structure */
			expect(report.generatedAt).toBeDefined();
			expect(report.dateRange).toBeDefined();
			expect(report.dateRange.start).toBeDefined();
			expect(report.dateRange.end).toBeDefined();

			/* Verify summary */
			expect(report.summary).toBeDefined();
			expect(report.summary.totalSpend).toBe(800);
			expect(report.summary.totalImpressions).toBe(80000);
			expect(report.summary.totalClicks).toBe(4300);
			expect(report.summary.totalConversions).toBe(180);
			expect(report.summary.avgCTR).toBeCloseTo(4300 / 80000, 5);
			expect(report.summary.avgCPC).toBeCloseTo(800 / 4300, 2);
			expect(report.summary.avgCPA).toBeCloseTo(800 / 180, 2);

			/* Verify breakdowns */
			expect(report.campaignBreakdown.length).toBe(2);
			expect(report.adSetBreakdown.length).toBe(2);

			/* Verify campaigns are sorted by spend (descending) */
			expect(report.campaignBreakdown[0].spend).toBeGreaterThanOrEqual(
				report.campaignBreakdown[1].spend,
			);
		});

		it("should limit campaign breakdown to top 5", async () => {
			/* Create 7 campaign insights */
			const manyCampaigns: InsightsResultLike[] = Array.from({ length: 7 }, (_, i) => ({
				campaign_id: `campaign_${i}`,
				campaign_name: `Campaign ${i}`,
				impressions: `${10000 * (7 - i)}`,
				clicks: `${1000 * (7 - i)}`,
				spend: `${100 * (7 - i)}.00`,
				ctr: "0.10",
				cpm: "10.00",
				cpc: "0.10",
				actions: [{ action_type: "purchase", value: `${10 * (7 - i)}` }],
				date_start: "2024-01-01",
				date_stop: "2024-01-07",
			}));

			const ctx = createMockContext({
				campaignInsights: manyCampaigns,
				adSetInsights: [],
			});

			const result = await generatePerformanceReport.execute(
				{ adAccountId: "act_123", dateRange: "last_7d", format: "json" },
				ctx,
			);

			const report = (result.data as Record<string, unknown>).report as PerformanceReport;
			expect(report.campaignBreakdown.length).toBe(5);
		});
	});

	describe("custom date range", () => {
		it("should require startDate and endDate for custom range", async () => {
			const ctx = createMockContext();

			const result = await generatePerformanceReport.execute(
				{ adAccountId: "act_123", dateRange: "custom", format: "json" },
				ctx,
			);

			expect(result.success).toBe(false);
			expect(result.message).toContain("startDate and endDate are required");
		});

		it("should accept custom date range with valid dates", async () => {
			const ctx = createMockContext({
				campaignInsights: sampleCampaignInsights,
				adSetInsights: sampleAdSetInsights,
			});

			const result = await generatePerformanceReport.execute(
				{
					adAccountId: "act_123",
					dateRange: "custom",
					startDate: "2024-01-01",
					endDate: "2024-01-31",
					format: "json",
				},
				ctx,
			);

			expect(result.success).toBe(true);
			const report = (result.data as Record<string, unknown>).report as PerformanceReport;
			expect(report.dateRange.start).toBe("2024-01-01");
			expect(report.dateRange.end).toBe("2024-01-31");
		});
	});

	it("should handle empty insights gracefully", async () => {
		const ctx = createMockContext({
			campaignInsights: [],
			adSetInsights: [],
		});

		const result = await generatePerformanceReport.execute(
			{ adAccountId: "act_123", dateRange: "last_7d", format: "json" },
			ctx,
		);

		expect(result.success).toBe(true);
		const report = (result.data as Record<string, unknown>).report as PerformanceReport;
		expect(report.summary.totalSpend).toBe(0);
		expect(report.campaignBreakdown.length).toBe(0);
	});

	it("should fail when MetaClient is not available", async () => {
		const ctx = {
			sessionId: "test-session",
			adAccountId: "act_123",
			dryRun: false,
			timestamp: new Date().toISOString(),
		};

		const result = await generatePerformanceReport.execute(
			{ adAccountId: "act_123", dateRange: "last_7d", format: "json" },
			ctx,
		);

		expect(result.success).toBe(false);
		expect(result.message).toContain("MetaClient is not available");
	});
});
