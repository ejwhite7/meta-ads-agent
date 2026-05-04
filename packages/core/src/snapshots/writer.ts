/**
 * @module snapshots/writer
 *
 * Per-tick persistence of performance metrics at three levels of the
 * Meta hierarchy: campaign, ad set, and ad. The dashboard reads from
 * `campaign_snapshots`, `adset_snapshots`, and `ad_snapshots`; without
 * a writer those tables stay empty and the UI shows nothing.
 *
 * Failure to persist a snapshot must NEVER abort an OODA tick — the
 * agent's correctness does not depend on snapshot history, only on
 * the live metrics returned by the fetch functions. The session
 * therefore wraps every writer call in a try/catch and logs warnings.
 */

import { adSetSnapshots, adSnapshots, campaignSnapshots } from "../db/schema.js";
import type { AdMetrics, AdSetMetrics, CampaignMetrics } from "../types.js";

/**
 * Writes per-tick performance snapshots to durable storage at all
 * three hierarchy levels. The session calls each `write*` method
 * exactly once per tick with the full metrics array for that level.
 *
 * Implementations are responsible for serializing the typed metric
 * shapes into whichever backend they use. The methods are independent
 * — failure to write one level must not block the other two.
 */
export interface SnapshotWriter {
	/** Persist campaign-level metrics for a single tick. */
	writeSnapshots(
		metrics: CampaignMetrics[],
		adAccountId: string,
		recordedAt?: string,
	): Promise<void>;

	/** Persist ad-set-level metrics for a single tick. */
	writeAdSetSnapshots(
		metrics: AdSetMetrics[],
		adAccountId: string,
		recordedAt?: string,
	): Promise<void>;

	/** Persist ad-level metrics for a single tick. */
	writeAdSnapshots(metrics: AdMetrics[], adAccountId: string, recordedAt?: string): Promise<void>;
}

/**
 * Drizzle-backed {@link SnapshotWriter}. Mirrors the pattern used by
 * `DrizzleAuditDatabase` — accepts an opaque drizzle instance so the
 * same writer works with both the SQLite and Postgres dialects
 * created by `createDatabase()`.
 *
 * Each call performs a single batched `INSERT` (one row per entity).
 * The (entity_id, date) indexes on each table make subsequent
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

	async writeAdSetSnapshots(
		metrics: AdSetMetrics[],
		adAccountId: string,
		recordedAt: string = new Date().toISOString(),
	): Promise<void> {
		if (metrics.length === 0) return;
		const rows = metrics.map((m) => ({
			adSetId: m.adSetId,
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
		await this.db.insert(adSetSnapshots).values(rows);
	}

	async writeAdSnapshots(
		metrics: AdMetrics[],
		adAccountId: string,
		recordedAt: string = new Date().toISOString(),
	): Promise<void> {
		if (metrics.length === 0) return;
		const rows = metrics.map((m) => ({
			adId: m.adId,
			adSetId: m.adSetId,
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
		await this.db.insert(adSnapshots).values(rows);
	}
}

/* The schemas declare numeric fields NOT NULL. Coerce any NaN/Infinity
 * values from upstream insights parsing to 0 rather than failing the
 * whole batch — a bad datapoint must not block legitimate snapshots
 * for sibling entities. */
function safeInt(n: number): number {
	return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function safeFloat(n: number): number {
	return Number.isFinite(n) ? n : 0;
}
