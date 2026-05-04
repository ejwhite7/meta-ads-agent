/**
 * @module audit/backfill
 *
 * Per-tick outcome backfill for the agent decisions audit log.
 *
 * CLAUDE.md §6 specifies that every successful decision should have its
 * `actual_outcome` and `performance_delta` filled in on a subsequent
 * tick, so operators (and the agent itself, eventually) can grade the
 * quality of past decisions. Without this, the audit log records what
 * the agent INTENDED to happen but never what actually did.
 *
 * The engine runs once per tick, BEFORE the OODA loop:
 *   1. List all successful decisions for this account whose
 *      `actual_outcome` is still NULL.
 *   2. For each, extract the campaign id from `params.campaignId`.
 *      If the params don't reference a single campaign (e.g. an
 *      account-wide report tool), skip -- the row remains pending
 *      forever, which is correct: there is no campaign-level outcome
 *      to record.
 *   3. Look up the campaign's metrics in the current tick's
 *      `fetchMetrics()` payload (passed in via `currentMetrics`).
 *      If the campaign isn't in the current metrics (paused, deleted,
 *      no delivery), skip and try again next tick.
 *   4. Look up the most recent `campaign_snapshots` row for that
 *      campaign written BEFORE the decision's timestamp -- this is
 *      the baseline the agent reasoned over. If no such snapshot
 *      exists (decision predates the snapshot writer rollout),
 *      record `actualOutcome` only and leave `performanceDelta`
 *      NULL.
 *   5. Compute the delta and persist via AuditLogger.backfillOutcomes.
 *
 * Failure isolation: each row is processed independently. A bad row
 * (malformed params, JSON, etc.) is logged and skipped; one corrupt
 * audit row must not block backfill for everything else this tick.
 */

import { type SQL, and, desc, eq, lte } from "drizzle-orm";
import { campaignSnapshots } from "../db/schema.js";
import type { CampaignMetrics } from "../types.js";
import type { AuditLogger } from "./logger.js";
import type { BackfillUpdate, PendingBackfill } from "./types.js";

/**
 * Subset of metric fields used for backfill comparison. Keeping this
 * narrow (instead of just dumping the whole CampaignMetrics) means the
 * stored JSON has a stable, documented shape that future analytics can
 * rely on.
 */
type MetricSnapshot = {
	campaignId: string;
	impressions: number;
	clicks: number;
	spend: number;
	conversions: number;
	roas: number;
	cpa: number;
	ctr: number;
	date: string;
	recordedAt?: string;
};

/**
 * Result of one backfill run, returned to the caller (AgentSession)
 * for logging and visibility into how the engine is keeping up.
 */
export interface BackfillRunResult {
	/** Number of pending rows that existed at the start of the run. */
	readonly pendingCount: number;
	/** Number of rows successfully updated. */
	readonly backfilledCount: number;
	/** Number of rows skipped because the campaign isn't in current metrics. */
	readonly skippedNoCurrentMetrics: number;
	/** Number of rows skipped because params didn't reference a campaign. */
	readonly skippedNoCampaignId: number;
	/** Number of rows that errored mid-processing (logged, then skipped). */
	readonly errored: number;
}

/**
 * Backfills `actual_outcome` and `performance_delta` for prior-tick
 * decisions. One instance is constructed per agent session; `run()`
 * is called once per tick.
 */
export class BackfillEngine {
	constructor(
		private readonly auditLogger: AuditLogger,
		// biome-ignore lint/suspicious/noExplicitAny: Drizzle db type varies by backend dialect
		private readonly db: any,
	) {}

	async run(currentMetrics: CampaignMetrics[], adAccountId: string): Promise<BackfillRunResult> {
		const pending = await this.auditLogger.listPendingBackfills(adAccountId);
		const result = {
			pendingCount: pending.length,
			backfilledCount: 0,
			skippedNoCurrentMetrics: 0,
			skippedNoCampaignId: 0,
			errored: 0,
		};
		if (pending.length === 0) return result;

		const metricsById = new Map(currentMetrics.map((m) => [m.campaignId, m]));
		const updates: BackfillUpdate[] = [];

		for (const p of pending) {
			try {
				const campaignId = extractCampaignId(p.params);
				if (!campaignId) {
					result.skippedNoCampaignId++;
					continue;
				}

				const current = metricsById.get(campaignId);
				if (!current) {
					/* Campaign isn't in this tick's metrics. Common reasons:
					 * paused, deleted, or just no delivery in the lookback
					 * window. Leave the row pending so a future tick (when
					 * the campaign is back) can backfill it. */
					result.skippedNoCurrentMetrics++;
					continue;
				}

				const baseline = await this.findBaseline(adAccountId, campaignId, p.timestamp);
				const actualOutcome = toSnapshot(current);
				const performanceDelta = baseline ? diffSnapshots(actualOutcome, baseline) : null;

				updates.push({
					id: p.id,
					actualOutcome: actualOutcome as unknown as Record<string, unknown>,
					performanceDelta: performanceDelta as Record<string, unknown> | null,
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.warn(`[BackfillEngine] Failed to process decision ${p.id} (${p.toolName}): ${msg}`);
				result.errored++;
			}
		}

		if (updates.length > 0) {
			try {
				await this.auditLogger.backfillOutcomes(updates);
				result.backfilledCount = updates.length;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.warn(`[BackfillEngine] Batch UPDATE failed: ${msg}`);
				result.errored += updates.length;
			}
		}

		return result;
	}

	/**
	 * Finds the latest campaign_snapshots row for (adAccountId, campaignId)
	 * recorded at or before `decisionTimestamp`. This is the metrics
	 * the agent saw when it made the decision.
	 *
	 * Uses the (campaign_id, date) index for the lookup; the timestamp
	 * filter is applied on `recorded_at` (full ISO precision) so we get
	 * the exact pre-decision snapshot rather than just same-day data.
	 */
	private async findBaseline(
		adAccountId: string,
		campaignId: string,
		decisionTimestamp: string,
	): Promise<MetricSnapshot | null> {
		const conditions: SQL[] = [
			eq(campaignSnapshots.adAccountId, adAccountId),
			eq(campaignSnapshots.campaignId, campaignId),
			lte(campaignSnapshots.recordedAt, decisionTimestamp),
		];
		const rows = await this.db
			.select()
			.from(campaignSnapshots)
			.where(and(...conditions))
			.orderBy(desc(campaignSnapshots.recordedAt))
			.limit(1);
		if (!rows || rows.length === 0) return null;
		const r = rows[0];
		return {
			campaignId: r.campaignId,
			impressions: r.impressions,
			clicks: r.clicks,
			spend: r.spend,
			conversions: r.conversions,
			roas: r.roas,
			cpa: r.cpa,
			ctr: r.ctr,
			date: r.date,
			recordedAt: r.recordedAt,
		};
	}
}

/**
 * Extracts a campaignId from a decision's `params`. Tools in this repo
 * use the canonical key `campaignId` (camelCase); we also accept
 * `campaign_id` (snake_case) defensively in case a future tool drifts.
 */
function extractCampaignId(params: Record<string, unknown>): string | null {
	const camel = params.campaignId;
	if (typeof camel === "string" && camel.length > 0) return camel;
	const snake = params.campaign_id;
	if (typeof snake === "string" && snake.length > 0) return snake;
	return null;
}

function toSnapshot(m: CampaignMetrics): MetricSnapshot {
	return {
		campaignId: m.campaignId,
		impressions: m.impressions,
		clicks: m.clicks,
		spend: m.spend,
		conversions: m.conversions,
		roas: m.roas,
		cpa: m.cpa,
		ctr: m.ctr,
		date: m.date,
	};
}

/**
 * Computes (current - baseline) per numeric field. Stored alongside
 * the absolute snapshot so consumers can either read the absolute
 * post-decision metrics or the change attributable to the decision
 * window.
 */
function diffSnapshots(current: MetricSnapshot, baseline: MetricSnapshot) {
	return {
		impressions: current.impressions - baseline.impressions,
		clicks: current.clicks - baseline.clicks,
		spend: round(current.spend - baseline.spend),
		conversions: current.conversions - baseline.conversions,
		roas: round(current.roas - baseline.roas),
		cpa: round(current.cpa - baseline.cpa),
		ctr: round(current.ctr - baseline.ctr),
		baselineRecordedAt: baseline.recordedAt ?? null,
	};
}

function round(n: number): number {
	if (!Number.isFinite(n)) return 0;
	return Math.round(n * 10000) / 10000;
}
