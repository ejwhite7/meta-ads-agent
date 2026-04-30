/**
 * @module __tests__/rate-limiter
 *
 * Unit tests for the RateLimiter class. Validates token bucket behavior,
 * header parsing for both X-Business-Use-Case-Usage and X-App-Usage formats,
 * threshold enforcement, and wait time calculation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimiter } from "../api/rate-limiter.js";

describe("RateLimiter", () => {
	let limiter: RateLimiter;

	beforeEach(() => {
		vi.useFakeTimers();
		limiter = new RateLimiter({ threshold: 75 });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("acquire()", () => {
		it("resolves immediately when no usage data exists", async () => {
			await expect(limiter.acquire("act_123")).resolves.toBeUndefined();
		});

		it("resolves immediately when usage is below threshold", async () => {
			limiter.updateFromHeaders("act_123", {
				"x-app-usage": JSON.stringify({
					call_count: 50,
					total_cputime: 40,
					total_time: 30,
				}),
			});

			await expect(limiter.acquire("act_123")).resolves.toBeUndefined();
		});

		it("delays when usage exceeds threshold", async () => {
			limiter.updateFromHeaders("act_123", {
				"x-app-usage": JSON.stringify({
					call_count: 80,
					total_cputime: 50,
					total_time: 50,
				}),
			});

			let resolved = false;
			const promise = limiter.acquire("act_123").then(() => {
				resolved = true;
			});

			// Should not resolve immediately
			await vi.advanceTimersByTimeAsync(100);
			expect(resolved).toBe(false);

			// Should resolve after the default wait time
			await vi.advanceTimersByTimeAsync(60_000);
			await promise;
			expect(resolved).toBe(true);
		});
	});

	describe("updateFromHeaders()", () => {
		it("parses X-Business-Use-Case-Usage header correctly", () => {
			const header = JSON.stringify({
				act_123: [
					{
						call_count: 60,
						total_cputime: 45,
						total_time: 50,
					},
				],
			});

			limiter.updateFromHeaders("act_123", {
				"x-business-use-case-usage": header,
			});

			expect(limiter.getUsage("act_123")).toBe(60);
		});

		it("parses X-App-Usage header as fallback", () => {
			const header = JSON.stringify({
				call_count: 70,
				total_cputime: 55,
				total_time: 40,
			});

			limiter.updateFromHeaders("act_123", {
				"x-app-usage": header,
			});

			expect(limiter.getUsage("act_123")).toBe(70);
		});

		it("prefers BUC header over App header when both present", () => {
			const bucHeader = JSON.stringify({
				act_456: [
					{
						call_count: 30,
						total_cputime: 20,
						total_time: 25,
					},
				],
			});
			const appHeader = JSON.stringify({
				call_count: 90,
				total_cputime: 80,
				total_time: 85,
			});

			limiter.updateFromHeaders("act_456", {
				"x-business-use-case-usage": bucHeader,
				"x-app-usage": appHeader,
			});

			expect(limiter.getUsage("act_456")).toBe(30);
		});

		it("returns max across all usage dimensions", () => {
			limiter.updateFromHeaders("act_123", {
				"x-app-usage": JSON.stringify({
					call_count: 20,
					total_cputime: 85,
					total_time: 30,
				}),
			});

			expect(limiter.getUsage("act_123")).toBe(85);
		});

		it("handles malformed header JSON gracefully", () => {
			limiter.updateFromHeaders("act_123", {
				"x-app-usage": "not-json",
			});

			expect(limiter.getUsage("act_123")).toBe(0);
		});

		it("handles missing headers gracefully", () => {
			limiter.updateFromHeaders("act_123", {});

			expect(limiter.getUsage("act_123")).toBe(0);
		});

		it("respects estimated_time_to_regain_access from BUC header", async () => {
			const header = JSON.stringify({
				act_123: [
					{
						call_count: 90,
						total_cputime: 80,
						total_time: 85,
						estimated_time_to_regain_access: 5, // 5 minutes
					},
				],
			});

			limiter.updateFromHeaders("act_123", {
				"x-business-use-case-usage": header,
			});

			let resolved = false;
			const promise = limiter.acquire("act_123").then(() => {
				resolved = true;
			});

			// Should wait for estimated 5 minutes (300,000ms)
			await vi.advanceTimersByTimeAsync(200_000);
			expect(resolved).toBe(false);

			await vi.advanceTimersByTimeAsync(200_000);
			await promise;
			expect(resolved).toBe(true);
		});
	});

	describe("isLimited()", () => {
		it("returns false when no usage data exists", () => {
			expect(limiter.isLimited("act_123")).toBe(false);
		});

		it("returns false when below threshold", () => {
			limiter.updateFromHeaders("act_123", {
				"x-app-usage": JSON.stringify({
					call_count: 50,
					total_cputime: 40,
					total_time: 30,
				}),
			});

			expect(limiter.isLimited("act_123")).toBe(false);
		});

		it("returns true when at or above threshold", () => {
			limiter.updateFromHeaders("act_123", {
				"x-app-usage": JSON.stringify({
					call_count: 75,
					total_cputime: 40,
					total_time: 30,
				}),
			});

			expect(limiter.isLimited("act_123")).toBe(true);
		});
	});

	describe("reset()", () => {
		it("clears usage data for the specified account", () => {
			limiter.updateFromHeaders("act_123", {
				"x-app-usage": JSON.stringify({
					call_count: 90,
					total_cputime: 80,
					total_time: 85,
				}),
			});

			expect(limiter.getUsage("act_123")).toBe(90);

			limiter.reset("act_123");

			expect(limiter.getUsage("act_123")).toBe(0);
		});

		it("does not affect other accounts", () => {
			limiter.updateFromHeaders("act_123", {
				"x-app-usage": JSON.stringify({
					call_count: 90,
					total_cputime: 80,
					total_time: 85,
				}),
			});
			limiter.updateFromHeaders("act_456", {
				"x-app-usage": JSON.stringify({
					call_count: 60,
					total_cputime: 50,
					total_time: 40,
				}),
			});

			limiter.reset("act_123");

			expect(limiter.getUsage("act_123")).toBe(0);
			expect(limiter.getUsage("act_456")).toBe(60);
		});
	});

	describe("custom threshold", () => {
		it("respects custom threshold value", () => {
			const strictLimiter = new RateLimiter({ threshold: 50 });

			strictLimiter.updateFromHeaders("act_123", {
				"x-app-usage": JSON.stringify({
					call_count: 55,
					total_cputime: 30,
					total_time: 30,
				}),
			});

			expect(strictLimiter.isLimited("act_123")).toBe(true);
		});

		it("defaults to 75 when no threshold specified", () => {
			const defaultLimiter = new RateLimiter();

			defaultLimiter.updateFromHeaders("act_123", {
				"x-app-usage": JSON.stringify({
					call_count: 74,
					total_cputime: 30,
					total_time: 30,
				}),
			});

			expect(defaultLimiter.isLimited("act_123")).toBe(false);
		});
	});
});
