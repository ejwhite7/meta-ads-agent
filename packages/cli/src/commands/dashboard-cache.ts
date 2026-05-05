/**
 * @module commands/dashboard-cache
 *
 * In-process TTL cache for the dashboard's Meta-hitting routes.
 *
 * Each `/api/campaigns` page load fired six concurrent Marketing API
 * calls. `/api/metrics/summary` fired two. `/api/metrics/timeseries`
 * one. `/api/metrics/roas-target` two. With the default 10s polling
 * on the Overview hooks plus the operator hammering refresh, that
 * routinely turned into 50+ Graph requests per minute against a
 * single ad account — burning rate-limit budget for data that
 * changes meaningfully on the order of minutes, not seconds.
 *
 * This cache sits in front of the Meta calls. Default TTL is 30
 * seconds, configurable via `META_ADS_AGENT_DASHBOARD_CACHE_TTL_MS`.
 * Concurrent callers for the same key share a single in-flight
 * promise (no thundering-herd). Failures are NOT cached — the next
 * call retries the underlying fetcher.
 *
 * Writes through the dashboard (POST /api/goals, PUT /api/configuration,
 * etc.) call `invalidate(prefix)` to bust the affected entries
 * immediately so the operator sees their change reflected.
 */

/**
 * Default TTL for cached responses. 30s is a reasonable balance:
 *   - Long enough to coalesce multi-tab refresh storms.
 *   - Short enough that an operator who edits a goal sees it in
 *     the Campaigns view on the next refresh (cache invalidation
 *     also bursts the affected entries on writes; the TTL is the
 *     defensive ceiling).
 */
const DEFAULT_TTL_MS = 30_000;

/**
 * Resolve the operator-configurable TTL. Allows tests to override
 * via env without code changes; production sticks to the default.
 */
export function resolveCacheTtlMs(): number {
	const raw = process.env.META_ADS_AGENT_DASHBOARD_CACHE_TTL_MS;
	if (!raw) return DEFAULT_TTL_MS;
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 0) return DEFAULT_TTL_MS;
	return n;
}

interface CacheEntry<T> {
	/** The in-flight or resolved promise. Storing the promise (not the
	 * resolved value) means N concurrent callers all await the same
	 * underlying fetcher invocation \u2014 thundering-herd protection. */
	value: Promise<T>;
	/** Wall-clock millis when this entry expires. */
	expiresAt: number;
}

/**
 * Tiny TTL + invalidation cache. Single-process, in-memory only.
 *
 * Why not use an LRU library: this code path runs once per dashboard
 * server, the working set is a small constant (one entry per
 * `(route, params)` shape), and we don't need eviction-by-size. A
 * Map plus expiresAt timestamps is enough.
 */
export class TtlCache {
	// biome-ignore lint/suspicious/noExplicitAny: heterogeneous values per key by design
	private map = new Map<string, CacheEntry<any>>();

	/**
	 * Get an entry, or call `fetcher` and cache its result.
	 *
	 * If a value is in-flight for `key`, the existing promise is
	 * returned (concurrent callers share the same fetch). If the
	 * fetcher throws, the entry is removed so the next call retries
	 * \u2014 we never cache failures because dashboard 502s would otherwise
	 * stick around for the full TTL.
	 *
	 * @param key      Cache key. Conventionally `route:adAccountId:params`.
	 * @param ttlMs    Time-to-live for this entry, in milliseconds.
	 * @param fetcher  Function that produces the value to cache.
	 */
	async get<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
		const now = Date.now();
		const existing = this.map.get(key) as CacheEntry<T> | undefined;
		if (existing && existing.expiresAt > now) {
			return existing.value;
		}
		const promise = fetcher().catch((err: unknown) => {
			/* Remove on failure so the next call retries instead of
			 * serving the rejection for the whole TTL window. */
			this.map.delete(key);
			throw err;
		});
		this.map.set(key, { value: promise, expiresAt: now + ttlMs });
		return promise;
	}

	/**
	 * Invalidate cache entries whose key starts with the given prefix.
	 *
	 * Convention: prefixes use `:` as a separator and DON'T include
	 * a trailing colon. So `invalidate("campaigns")` clears every
	 * entry keyed `campaigns:*`, but does NOT clear `campaign-goals:*`
	 * (the `:` boundary check prevents accidental over-invalidation).
	 *
	 * Pass an empty string to clear the entire cache (used in tests).
	 */
	invalidate(prefix: string): void {
		if (prefix === "") {
			this.map.clear();
			return;
		}
		const exact = prefix;
		const withSep = `${prefix}:`;
		for (const key of this.map.keys()) {
			if (key === exact || key.startsWith(withSep)) {
				this.map.delete(key);
			}
		}
	}

	/** Number of currently-cached entries. Useful for tests. */
	size(): number {
		return this.map.size;
	}
}
