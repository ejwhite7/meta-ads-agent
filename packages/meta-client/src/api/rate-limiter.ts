/**
 * @module api/rate-limiter
 *
 * Per-account token bucket rate limiter for the Meta Marketing API.
 * Tracks API usage from response headers (`X-Business-Use-Case-Usage` and
 * `X-App-Usage`) and delays requests when the usage threshold is exceeded.
 *
 * Meta's Marketing API enforces rate limits on a per-ad-account basis using
 * a Business Use Case (BUC) system. This rate limiter respects those limits
 * by monitoring the percentage of allocation consumed and blocking requests
 * when approaching the threshold.
 */

/**
 * Usage statistics parsed from Meta API rate limit headers.
 */
interface UsageStats {
	/** Percentage of call volume quota consumed (0-100). */
	callCount: number;
	/** Percentage of total CPU time quota consumed (0-100). */
	totalCpuTime: number;
	/** Percentage of total processing time quota consumed (0-100). */
	totalTime: number;
	/** Estimated time in minutes until the rate limit resets. */
	estimatedTimeToRegainAccess?: number;
}

/**
 * Per-account rate limit state tracking.
 */
interface AccountState {
	/** Current usage statistics from the most recent API response. */
	usage: UsageStats;
	/** Timestamp of the last usage update. */
	lastUpdated: number;
}

/**
 * Token bucket rate limiter that tracks per-account API usage based on
 * Meta Marketing API response headers. Automatically delays requests
 * when usage approaches the configured threshold.
 *
 * @example
 * ```typescript
 * const limiter = new RateLimiter({ threshold: 75 });
 * await limiter.acquire("act_123456");    // Waits if near limit
 * const response = await axios.get(...);
 * limiter.updateFromHeaders("act_123456", response.headers);
 * ```
 */
export class RateLimiter {
	/** Usage threshold percentage (0-100) at which requests are delayed. */
	private readonly threshold: number;

	/** Per-account usage tracking state. */
	private readonly accounts: Map<string, AccountState> = new Map();

	/**
	 * Creates a new rate limiter instance.
	 *
	 * @param config - Rate limiter configuration.
	 * @param config.threshold - Usage percentage (0-100) at which to start
	 *   delaying requests. Defaults to 75.
	 */
	constructor(config: { threshold?: number } = {}) {
		this.threshold = config.threshold ?? 75;
	}

	/**
	 * Acquires permission to make an API request for the specified account.
	 * If the account's usage exceeds the threshold, this method will wait
	 * until the estimated reset time has passed before resolving.
	 *
	 * @param accountId - Ad account ID to check rate limits for.
	 */
	async acquire(accountId: string): Promise<void> {
		const state = this.accounts.get(accountId);
		if (!state) {
			return;
		}

		const maxUsage = Math.max(
			state.usage.callCount,
			state.usage.totalCpuTime,
			state.usage.totalTime,
		);

		if (maxUsage >= this.threshold) {
			const waitMs = this.calculateWaitTime(state);
			if (waitMs > 0) {
				await this.sleep(waitMs);
			}
		}
	}

	/**
	 * Updates the rate limit state for an account based on API response headers.
	 * Parses both `X-Business-Use-Case-Usage` and `X-App-Usage` headers.
	 *
	 * The `X-Business-Use-Case-Usage` header contains per-account usage in the
	 * format: `{"account_id": [{"call_count": N, "total_cputime": N, "total_time": N}]}`
	 *
	 * The `X-App-Usage` header contains app-level usage in the format:
	 * `{"call_count": N, "total_cputime": N, "total_time": N}`
	 *
	 * @param accountId - Ad account ID to update.
	 * @param headers - HTTP response headers from the Meta API.
	 */
	updateFromHeaders(accountId: string, headers: Record<string, string>): void {
		const bucUsage = headers["x-business-use-case-usage"];
		const appUsage = headers["x-app-usage"];

		let usage: UsageStats | undefined;

		if (bucUsage) {
			usage = this.parseBucHeader(accountId, bucUsage);
		}

		if (!usage && appUsage) {
			usage = this.parseAppHeader(appUsage);
		}

		if (usage) {
			this.accounts.set(accountId, {
				usage,
				lastUpdated: Date.now(),
			});
		}
	}

	/**
	 * Returns the current usage percentage for an account.
	 * Returns 0 if no usage data has been recorded.
	 *
	 * @param accountId - Ad account ID to query.
	 * @returns Maximum usage percentage across all quota dimensions.
	 */
	getUsage(accountId: string): number {
		const state = this.accounts.get(accountId);
		if (!state) {
			return 0;
		}

		return Math.max(state.usage.callCount, state.usage.totalCpuTime, state.usage.totalTime);
	}

	/**
	 * Checks whether the rate limiter would block a request for the
	 * specified account.
	 *
	 * @param accountId - Ad account ID to check.
	 * @returns True if the account's usage exceeds the threshold.
	 */
	isLimited(accountId: string): boolean {
		return this.getUsage(accountId) >= this.threshold;
	}

	/**
	 * Resets rate limit tracking for the specified account.
	 *
	 * @param accountId - Ad account ID to reset.
	 */
	reset(accountId: string): void {
		this.accounts.delete(accountId);
	}

	/**
	 * Parses the `X-Business-Use-Case-Usage` header for a specific account.
	 */
	private parseBucHeader(accountId: string, header: string): UsageStats | undefined {
		try {
			const parsed = JSON.parse(header) as Record<
				string,
				Array<{
					call_count: number;
					total_cputime: number;
					total_time: number;
					estimated_time_to_regain_access?: number;
				}>
			>;

			// Extract the account ID without the "act_" prefix for header matching
			const cleanId = accountId.replace(/^act_/, "");
			const accountData = parsed[accountId] ?? parsed[cleanId];

			if (!accountData || accountData.length === 0) {
				return undefined;
			}

			const entry = accountData[0];
			return {
				callCount: entry.call_count,
				totalCpuTime: entry.total_cputime,
				totalTime: entry.total_time,
				estimatedTimeToRegainAccess: entry.estimated_time_to_regain_access,
			};
		} catch {
			return undefined;
		}
	}

	/**
	 * Parses the `X-App-Usage` header for app-level rate limit tracking.
	 */
	private parseAppHeader(header: string): UsageStats | undefined {
		try {
			const parsed = JSON.parse(header) as {
				call_count: number;
				total_cputime: number;
				total_time: number;
			};

			return {
				callCount: parsed.call_count,
				totalCpuTime: parsed.total_cputime,
				totalTime: parsed.total_time,
			};
		} catch {
			return undefined;
		}
	}

	/**
	 * Calculates how long to wait before the next request is allowed.
	 * Uses the estimated time to regain access from the API header if
	 * available, otherwise defaults to a 60-second wait.
	 */
	private calculateWaitTime(state: AccountState): number {
		if (state.usage.estimatedTimeToRegainAccess) {
			return state.usage.estimatedTimeToRegainAccess * 60 * 1000;
		}

		// Default: wait 60 seconds if no estimate is available
		const elapsed = Date.now() - state.lastUpdated;
		const defaultWait = 60_000;
		return Math.max(0, defaultWait - elapsed);
	}

	/**
	 * Utility sleep function for delaying requests.
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
