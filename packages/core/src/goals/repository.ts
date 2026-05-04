/**
 * @module goals/repository
 *
 * Persistence layer for per-campaign goals.
 *
 * Convention: every mutation is an INSERT. Even a "reconfigure" or a
 * "delete" creates a new row -- we never UPDATE existing rows. The
 * active goal for `(adAccountId, campaignId)` is the most recently
 * configured row with `deletedAt === null`. Soft-delete is implemented
 * by inserting a row that copies the prior config and sets `deletedAt`.
 *
 * This gives us:
 *   - A complete audit trail of goal changes for free.
 *   - O(N) reads with a small N (one campaign rarely has > 5 historical
 *     goal versions) thanks to the `(account, campaign, deletedAt)` index.
 *   - Trivial rollback semantics (insert the previous version again).
 */

import { and, desc, eq } from "drizzle-orm";
import { campaignGoals } from "../db/schema.js";
import type { CampaignGoal, CampaignGoalInput, SecondaryKpi } from "./types.js";

/**
 * Drizzle DB handle, parametrically typed so this module doesn't pull
 * a hard dep on a specific dialect.
 */
// biome-ignore lint/suspicious/noExplicitAny: drizzle DB type varies by backend
type Db = any;

/**
 * Shape of a row as Drizzle hands it to us. Kept as a structural type
 * so we don't get coupled to whether the inferring schema export is
 * `typeof campaignGoals.$inferSelect` (which would force a circular
 * import on consumers).
 */
interface CampaignGoalRow {
	id: number;
	adAccountId: string;
	campaignId: string;
	primaryKpi: string;
	primaryKpiTarget: number;
	primaryKpiDirection: "maximize" | "minimize";
	secondaryKpis: string | null;
	minDailyBudget: number | null;
	maxBudgetScaleFactor: number | null;
	requireApprovalAbove: number | null;
	lastSeenObjective: string;
	configuredAt: string;
	configuredBy: string;
	notes: string | null;
	deletedAt: string | null;
}

function rowToGoal(r: CampaignGoalRow): CampaignGoal {
	let secondary: SecondaryKpi[] = [];
	if (r.secondaryKpis) {
		try {
			const parsed = JSON.parse(r.secondaryKpis);
			if (Array.isArray(parsed)) secondary = parsed as SecondaryKpi[];
		} catch {
			/* malformed JSON; treat as no secondary KPIs */
		}
	}
	return {
		dbId: r.id,
		adAccountId: r.adAccountId,
		campaignId: r.campaignId,
		primaryKpi: r.primaryKpi as CampaignGoal["primaryKpi"],
		primaryKpiTarget: r.primaryKpiTarget,
		primaryKpiDirection: r.primaryKpiDirection,
		secondaryKpis: secondary,
		minDailyBudget: r.minDailyBudget,
		maxBudgetScaleFactor: r.maxBudgetScaleFactor,
		requireApprovalAbove: r.requireApprovalAbove,
		lastSeenObjective: r.lastSeenObjective,
		configuredAt: r.configuredAt,
		configuredBy: r.configuredBy,
		notes: r.notes,
		deletedAt: r.deletedAt,
	};
}

/**
 * Read/write API for the `campaign_goals` table.
 *
 * Construction takes any Drizzle `db` -- production code passes the
 * connection from `createDatabase`; tests pass an in-memory instance.
 */
export class CampaignGoalRepository {
	constructor(private readonly db: Db) {}

	/**
	 * Returns the active goal for a campaign, or `null` if none.
	 * "Active" = most recently configured row with `deletedAt IS NULL`.
	 */
	async getActive(adAccountId: string, campaignId: string): Promise<CampaignGoal | null> {
		/* Active = the most-recent row for this (account, campaign) AND that
		 * row has deletedAt === null. Selecting JUST the most-recent row
		 * (regardless of deletedAt) and then checking is essential -- the
		 * naive `WHERE deletedAt IS NULL ORDER BY configuredAt DESC` would
		 * return the prior live row when a soft-delete tombstone exists
		 * after it, which is the opposite of what we want. */
		const rows = (await this.db
			.select()
			.from(campaignGoals)
			.where(
				and(eq(campaignGoals.adAccountId, adAccountId), eq(campaignGoals.campaignId, campaignId)),
			)
			.orderBy(desc(campaignGoals.configuredAt), desc(campaignGoals.id))
			.limit(1)) as CampaignGoalRow[];
		if (rows.length === 0) return null;
		if (rows[0].deletedAt !== null) return null;
		return rowToGoal(rows[0]);
	}

	/**
	 * Returns the active goal for every campaign in the account.
	 * Useful for the agent loop's "which campaigns are actionable?" filter.
	 */
	async listActive(adAccountId: string): Promise<CampaignGoal[]> {
		/* Pull every row for the account, group by campaignId, take the
		 * most-recent per campaign (regardless of deletedAt), then
		 * filter out the ones whose most-recent row is a tombstone.
		 * This is the listActive analogue of the getActive logic above. */
		const rows = (await this.db
			.select()
			.from(campaignGoals)
			.where(eq(campaignGoals.adAccountId, adAccountId))
			.orderBy(desc(campaignGoals.configuredAt), desc(campaignGoals.id))) as CampaignGoalRow[];

		const seen = new Set<string>();
		const result: CampaignGoal[] = [];
		for (const row of rows) {
			if (seen.has(row.campaignId)) continue;
			seen.add(row.campaignId);
			if (row.deletedAt !== null) continue; /* tombstone wins -> not active */
			result.push(rowToGoal(row));
		}
		return result;
	}

	/**
	 * Returns full history (active + soft-deleted) for one campaign,
	 * most-recent first. Useful for the dashboard's per-campaign
	 * "configuration history" view (future PR).
	 */
	async listHistory(adAccountId: string, campaignId: string): Promise<CampaignGoal[]> {
		const rows = (await this.db
			.select()
			.from(campaignGoals)
			.where(
				and(eq(campaignGoals.adAccountId, adAccountId), eq(campaignGoals.campaignId, campaignId)),
			)
			.orderBy(desc(campaignGoals.configuredAt))) as CampaignGoalRow[];
		return rows.map(rowToGoal);
	}

	/**
	 * Persist a new goal for a campaign. If an active goal already
	 * exists, the caller is expected to have soft-deleted it first
	 * via `softDelete()` (the agent loop's re-prompt path) or to want
	 * the side-by-side coexistence (we return the new row regardless).
	 */
	async upsert(input: CampaignGoalInput): Promise<CampaignGoal> {
		const now = new Date().toISOString();
		const result = (await this.db
			.insert(campaignGoals)
			.values({
				adAccountId: input.adAccountId,
				campaignId: input.campaignId,
				primaryKpi: input.primaryKpi,
				primaryKpiTarget: input.primaryKpiTarget,
				primaryKpiDirection: input.primaryKpiDirection,
				secondaryKpis: input.secondaryKpis ? JSON.stringify(input.secondaryKpis) : null,
				minDailyBudget: input.minDailyBudget ?? null,
				maxBudgetScaleFactor: input.maxBudgetScaleFactor ?? null,
				requireApprovalAbove: input.requireApprovalAbove ?? null,
				lastSeenObjective: input.lastSeenObjective,
				configuredAt: now,
				configuredBy: input.configuredBy,
				notes: input.notes ?? null,
				deletedAt: null,
			})
			.returning()) as CampaignGoalRow[];
		return rowToGoal(result[0]);
	}

	/**
	 * Soft-delete the active goal for a campaign by inserting a copy of
	 * the prior row with `deletedAt` set. If no active goal exists this
	 * is a no-op and returns null.
	 */
	async softDelete(
		adAccountId: string,
		campaignId: string,
		deletedBy: string,
		reason?: string,
	): Promise<CampaignGoal | null> {
		const active = await this.getActive(adAccountId, campaignId);
		if (!active) return null;

		const now = new Date().toISOString();
		const result = (await this.db
			.insert(campaignGoals)
			.values({
				adAccountId: active.adAccountId,
				campaignId: active.campaignId,
				primaryKpi: active.primaryKpi,
				primaryKpiTarget: active.primaryKpiTarget,
				primaryKpiDirection: active.primaryKpiDirection,
				secondaryKpis:
					active.secondaryKpis.length > 0 ? JSON.stringify(active.secondaryKpis) : null,
				minDailyBudget: active.minDailyBudget,
				maxBudgetScaleFactor: active.maxBudgetScaleFactor,
				requireApprovalAbove: active.requireApprovalAbove,
				lastSeenObjective: active.lastSeenObjective,
				configuredAt: now,
				configuredBy: deletedBy,
				notes: reason ?? `soft-deleted (was: ${active.notes ?? "no notes"})`,
				deletedAt: now,
			})
			.returning()) as CampaignGoalRow[];
		return rowToGoal(result[0]);
	}
}
