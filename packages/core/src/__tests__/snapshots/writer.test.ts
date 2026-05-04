/**
 * @module __tests__/snapshots/writer.test
 *
 * Regression tests for DrizzleSnapshotWriter. The test for this
 * existing was the difference between "dashboard shows campaigns"
 * and "dashboard silently shows nothing while no Meta API calls
 * are made" -- the original code never wrote snapshots at all,
 * and the only consumer (`/api/campaigns`) read straight from this
 * permanently-empty table.
 *
 * The tests assert:
 *   1. A batch write inserts one row per metric with the right shape.
 *   2. NaN/Infinity in numeric fields is coerced to 0 (not allowed
 *      by the NOT NULL schema, would otherwise fail the whole batch).
 *   3. An empty metrics array is a no-op (no spurious INSERT).
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { bootstrapSqliteSchema } from "../../db/bootstrap.js";
import { DrizzleSnapshotWriter } from "../../snapshots/writer.js";
import type { CampaignMetrics } from "../../types.js";

function makeDb() {
	const sqlite = new Database(":memory:");
	bootstrapSqliteSchema(sqlite);
	return { sqlite, db: drizzle(sqlite) };
}

const baseMetric: CampaignMetrics = {
	campaignId: "camp_1",
	impressions: 1000,
	clicks: 50,
	spend: 25.5,
	conversions: 5,
	roas: 4.0,
	cpa: 5.1,
	ctr: 0.05,
	date: "2026-05-04",
};

describe("DrizzleSnapshotWriter", () => {
	let sqlite: Database.Database;
	// biome-ignore lint/suspicious/noExplicitAny: drizzle instance type is opaque
	let db: any;

	beforeEach(() => {
		const made = makeDb();
		sqlite = made.sqlite;
		db = made.db;
	});

	it("writes one row per campaign with the expected shape", async () => {
		const writer = new DrizzleSnapshotWriter(db);
		await writer.writeSnapshots(
			[baseMetric, { ...baseMetric, campaignId: "camp_2", spend: 12.0 }],
			"act_123",
			"2026-05-04T12:00:00Z",
		);

		const rows = sqlite
			.prepare(
				"SELECT campaign_id, ad_account_id, impressions, clicks, spend, conversions, roas, cpa, ctr, date, recorded_at FROM campaign_snapshots ORDER BY campaign_id",
			)
			.all() as Array<Record<string, unknown>>;

		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			campaign_id: "camp_1",
			ad_account_id: "act_123",
			impressions: 1000,
			clicks: 50,
			spend: 25.5,
			conversions: 5,
			roas: 4.0,
			cpa: 5.1,
			ctr: 0.05,
			date: "2026-05-04",
			recorded_at: "2026-05-04T12:00:00Z",
		});
		expect(rows[1].campaign_id).toBe("camp_2");
		expect(rows[1].spend).toBe(12.0);
	});

	it("coerces NaN/Infinity to 0 so a single bad row doesn't fail the batch", async () => {
		const writer = new DrizzleSnapshotWriter(db);
		await writer.writeSnapshots(
			[
				{
					...baseMetric,
					/* Common upstream pathology: zero conversions -> Infinity CPA. */
					cpa: Number.POSITIVE_INFINITY,
					roas: Number.NaN,
				},
			],
			"act_123",
		);

		const row = sqlite.prepare("SELECT cpa, roas FROM campaign_snapshots").get() as {
			cpa: number;
			roas: number;
		};

		expect(row.cpa).toBe(0);
		expect(row.roas).toBe(0);
	});

	it("is a no-op for an empty metrics array", async () => {
		const writer = new DrizzleSnapshotWriter(db);
		await writer.writeSnapshots([], "act_123");

		const count = sqlite.prepare("SELECT COUNT(*) AS n FROM campaign_snapshots").get() as {
			n: number;
		};
		expect(count.n).toBe(0);
	});
});
