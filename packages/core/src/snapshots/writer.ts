/**
 * @module snapshots/writer
 *
 * Per-tick persistence of campaign performance metrics into the
 * `campaign_snapshots` table. The dashboard's `/api/campaigns`
 * endpoint reads this table; without a writer, that endpoint
 * silently returns an empty array forever (see PR fix log).
 *
 * Failure to persist a snapshot must NEVER abort an OODA tick --
 * the agent's correctness does not depend on snapshot history,
 * only on the live metrics returned by `fetchMetrics`. The session
 * therefore wraps writer calls in a try/catch and logs warnings.
 */

import { campaignSnapshots } from "../db/schema.js";
import type { CampaignMetrics } from "../types.js";

/**
 * Writes per-tick campaign performance snapshots to durable storage.
 *
 * Implementations are responsible for serializing the
 * {@link CampaignMetrics} shape into whichever backend they use.
 * The session calls `writeSnapshots` exactly once per tick with the
 * full metrics array returned from `fetchMetrics`.
 */
export interface SnapshotWriter {
	/**
	 * Persist a batch of campaign metrics for a single tick.
	 *
	 * @param metrics - Metrics returned from `fetchMetrics()` this tick.
	 * @param adAccountId - Ad account that owns these campaigns.
	 * @param recordedAt - ISO 8601 timestamp for this batch (defaults to now).
	 */
	writeSnapshots(
		metrics: CampaignMetrics[],
		adAccountId: string,
		recordedAt?: string,
	): Promise<void>;
}

/**
 * Drizzle-backed {@link SnapshotWriter}. Mirrors the pattern used by
 * `DrizzleAuditDatabase` -- accepts an opaque drizzle instance so the
 * same writer works with both the SQLite and Postgres dialects
 * created by `createDatabase()`.
 *
 * Each call performs a single batched `INSERT` (one row per campaign).
 * The `(campaign_id, date)` index on the table makes subsequent
 * trend-analysis queries cheap.
 */
export class DrizzleSnapshotWriter implements SnapshotWriter {
	// biome-ignore lint/suspicious/noExplicitAny: Drizzle db type varies by backend dialect
	constructor(private readonly db: any) {}

	async writeSnapshots(
		metrics: CampaignMetrics[],
		adAccountId: string,
		recordedAt: string = new Date().toISOString(),
	): Promise<void> {
		if (metrics.length === 0) return;

		/* The schema declares all numeric fields NOT NULL. Coerce any
		 * NaN/Infinity values from upstream insights parsing to 0
		 * rather than failing the whole batch -- a bad datapoint must
		 * not block legitimate snapshots for sibling campaigns. */
		const rows = metrics.map((m) => ({
			campaignId: m.campaignId,
			adAccountId,
			impressions: safeInt(m.impressions),
			clicks: safeInt(m.clicks),
			spend: safeFloat(m.spend),
			conversions: safeInt(m.conversions),
			roas: safeFloat(m.roas),
			cpa: safeFloat(m.cpa),
			ctr: safeFloat(m.ctr),
			date: m.date,
			recordedAt,
		}));

		await this.db.insert(campaignSnapshots).values(rows);
	}
}

function safeInt(n: number): number {
	return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function safeFloat(n: number): number {
	return Number.isFinite(n) ? n : 0;
}
