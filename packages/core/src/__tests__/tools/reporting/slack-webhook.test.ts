/**
 * @module __tests__/tools/reporting/slack-webhook.test
 *
 * Unit tests for the send-slack-webhook tool.
 * Mocks the global `fetch` API and verifies Slack Block Kit formatting
 * differs correctly for alert, report, and action_taken message types.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sendSlackWebhook } from "../../../tools/reporting/send-slack-webhook.js";
import type { ToolContext } from "../../../tools/types.js";

/** Basic tool context for testing (Slack webhook doesn't need MetaClient). */
const mockContext: ToolContext = {
	sessionId: "test-session",
	adAccountId: "act_123",
	dryRun: false,
	timestamp: new Date().toISOString(),
};

const webhookUrl = "https://hooks.slack.com/services/T00000/B00000/XXXXXXXXXXXX";

/** Captures the body sent to fetch for assertions. */
let capturedBody: string | undefined;

beforeEach(() => {
	capturedBody = undefined;
	vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
		capturedBody = init?.body as string;
		return new Response("ok", { status: 200 });
	}));
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("sendSlackWebhook", () => {
	describe("alert message type", () => {
		it("should format anomalies as Slack blocks with alert header", async () => {
			const anomalies = [
				{
					campaignId: "campaign_1",
					campaignName: "Test Campaign",
					type: "CPA_SPIKE",
					severity: "critical",
					current: 20,
					baseline: 10,
					changePercent: 100,
					message: "CPA spiked to $20.00",
					recommendedAction: "Review targeting changes.",
				},
			];

			const result = await sendSlackWebhook.execute(
				{
					webhookUrl,
					message: JSON.stringify(anomalies),
					type: "alert",
				},
				mockContext,
			);

			expect(result.success).toBe(true);
			expect(capturedBody).toBeDefined();

			const payload = JSON.parse(capturedBody!);
			expect(payload.blocks).toBeDefined();
			expect(payload.blocks.length).toBeGreaterThanOrEqual(2);

			/* Verify header block */
			const header = payload.blocks[0];
			expect(header.type).toBe("header");
			expect(header.text.text).toContain("ALERT");

			/* Verify anomaly content in a section block */
			const sectionBlocks = payload.blocks.filter(
				(b: { type: string }) => b.type === "section",
			);
			expect(sectionBlocks.length).toBeGreaterThan(0);

			/* Verify the content mentions the anomaly */
			const sectionText = sectionBlocks
				.map((b: { text?: { text: string } }) => b.text?.text ?? "")
				.join(" ");
			expect(sectionText).toContain("CPA_SPIKE");
			expect(sectionText).toContain("CPA spiked to $20.00");
		});

		it("should include recommended actions for anomalies", async () => {
			const anomalies = [
				{
					type: "CTR_DROP",
					severity: "warning",
					message: "CTR dropped",
					recommendedAction: "Refresh ad creatives.",
				},
			];

			await sendSlackWebhook.execute(
				{
					webhookUrl,
					message: JSON.stringify(anomalies),
					type: "alert",
				},
				mockContext,
			);

			const payload = JSON.parse(capturedBody!);
			const allText = JSON.stringify(payload.blocks);
			expect(allText).toContain("Recommended Actions");
			expect(allText).toContain("Refresh ad creatives");
		});

		it("should handle plain text message for alerts", async () => {
			const result = await sendSlackWebhook.execute(
				{
					webhookUrl,
					message: "Something went wrong with campaign performance.",
					type: "alert",
				},
				mockContext,
			);

			expect(result.success).toBe(true);
			const payload = JSON.parse(capturedBody!);
			const sectionBlocks = payload.blocks.filter(
				(b: { type: string }) => b.type === "section",
			);
			expect(sectionBlocks.length).toBeGreaterThan(0);
		});
	});

	describe("report message type", () => {
		it("should format report summary as Slack section fields", async () => {
			const report = {
				summary: {
					totalSpend: 800,
					totalImpressions: 80000,
					totalClicks: 4300,
					avgCTR: 0.05375,
					avgCPC: 0.186,
					totalConversions: 180,
					avgROAS: 2.5,
					avgCPA: 4.44,
				},
				dateRange: {
					start: "2024-01-01",
					end: "2024-01-07",
				},
			};

			const result = await sendSlackWebhook.execute(
				{
					webhookUrl,
					message: JSON.stringify(report),
					type: "report",
				},
				mockContext,
			);

			expect(result.success).toBe(true);

			const payload = JSON.parse(capturedBody!);
			expect(payload.blocks).toBeDefined();

			/* Verify header */
			const header = payload.blocks[0];
			expect(header.type).toBe("header");
			expect(header.text.text).toContain("Performance Report");

			/* Verify section with fields */
			const sectionBlocks = payload.blocks.filter(
				(b: { type: string; fields?: unknown }) => b.type === "section" && b.fields,
			);
			expect(sectionBlocks.length).toBeGreaterThan(0);

			const fields = sectionBlocks[0].fields;
			const fieldTexts = fields.map((f: { text: string }) => f.text).join(" ");
			expect(fieldTexts).toContain("Total Spend");
			expect(fieldTexts).toContain("$800.00");
			expect(fieldTexts).toContain("Avg ROAS");
			expect(fieldTexts).toContain("2.50x");
		});

		it("should include date range context block", async () => {
			const report = {
				summary: { totalSpend: 100, totalImpressions: 1000, totalClicks: 100, avgCTR: 0.1, avgCPC: 1, totalConversions: 10, avgROAS: 2, avgCPA: 10 },
				dateRange: { start: "2024-01-01", end: "2024-01-07" },
			};

			await sendSlackWebhook.execute(
				{
					webhookUrl,
					message: JSON.stringify(report),
					type: "report",
				},
				mockContext,
			);

			const payload = JSON.parse(capturedBody!);
			const contextBlocks = payload.blocks.filter(
				(b: { type: string }) => b.type === "context",
			);
			expect(contextBlocks.length).toBeGreaterThan(0);
			expect(JSON.stringify(contextBlocks)).toContain("2024-01-01");
		});
	});

	describe("action_taken message type", () => {
		it("should format with action taken header", async () => {
			const result = await sendSlackWebhook.execute(
				{
					webhookUrl,
					message: "Paused campaign 'Low ROAS Campaign' due to CPA exceeding $50 threshold.",
					type: "action_taken",
				},
				mockContext,
			);

			expect(result.success).toBe(true);

			const payload = JSON.parse(capturedBody!);

			/* Verify header */
			const header = payload.blocks[0];
			expect(header.type).toBe("header");
			expect(header.text.text).toContain("ACTION TAKEN");

			/* Verify message content */
			const sectionBlocks = payload.blocks.filter(
				(b: { type: string }) => b.type === "section",
			);
			expect(sectionBlocks.length).toBeGreaterThan(0);
			expect(sectionBlocks[0].text.text).toContain("Paused campaign");
		});
	});

	describe("different formatting between types", () => {
		it("should use different header text for each message type", async () => {
			const types = ["alert", "report", "action_taken"] as const;
			const headers: string[] = [];

			for (const type of types) {
				vi.mocked(fetch).mockResolvedValueOnce(
					new Response("ok", { status: 200 }),
				);

				await sendSlackWebhook.execute(
					{
						webhookUrl,
						message: "Test message",
						type,
					},
					mockContext,
				);

				const payload = JSON.parse(capturedBody!);
				headers.push(payload.blocks[0].text.text);
			}

			/* All headers should be unique */
			const unique = new Set(headers);
			expect(unique.size).toBe(3);
		});
	});

	describe("error handling", () => {
		it("should handle HTTP error responses", async () => {
			vi.mocked(fetch).mockResolvedValueOnce(
				new Response("invalid_token", { status: 403 }),
			);

			const result = await sendSlackWebhook.execute(
				{
					webhookUrl,
					message: "Test",
					type: "report",
				},
				mockContext,
			);

			expect(result.success).toBe(false);
			expect(result.message).toContain("403");
		});

		it("should handle network errors", async () => {
			vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

			const result = await sendSlackWebhook.execute(
				{
					webhookUrl,
					message: "Test",
					type: "report",
				},
				mockContext,
			);

			expect(result.success).toBe(false);
			expect(result.message).toContain("Network error");
		});

		it("should include fallback text in the payload", async () => {
			await sendSlackWebhook.execute(
				{
					webhookUrl,
					message: "Important alert content",
					type: "alert",
				},
				mockContext,
			);

			const payload = JSON.parse(capturedBody!);
			expect(payload.text).toBeDefined();
			expect(payload.text).toContain("ALERT");
		});
	});
});
