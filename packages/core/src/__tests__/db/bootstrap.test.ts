/**
 * @module __tests__/db/bootstrap.test
 *
 * Regression tests for the SQLite schema bootstrapper.
 *
 * Why this test exists:
 *   PR #17 changed the default sqlitePath to ~/.meta-ads-agent/agent.db.
 *   Users with no existing DB at that path got an empty file (created by
 *   better-sqlite3 on open), but the migration SQL was never applied --
 *   the published CLI is a single bundled JS file with no .sql sidecars.
 *   First audit insert failed with `no such table: agent_decisions`,
 *   audit failures piled up, and the agent halted.
 *
 *   This regression must not come back. The tests assert:
 *     1. createDatabase on a fresh path produces a DB with all four tables.
 *     2. The bootstrap is idempotent (re-running on a populated DB is a no-op).
 *     3. The bootstrap doesn't blow away existing rows.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SQLITE_BOOTSTRAP_SQL, bootstrapSqliteSchema } from "../../db/bootstrap.js";
import { createDatabase } from "../../db/index.js";

describe("SQLite schema bootstrap", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "meta-ads-agent-bootstrap-"));
	});

	afterEach(() => {
		try {
			rmSync(tempDir, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	});

	it("createDatabase produces a usable schema on a fresh path", () => {
		const path = join(tempDir, "agent.db");
		const conn = createDatabase({ type: "sqlite", sqlitePath: path });

		try {
			/* Open the same file directly (bypassing Drizzle) and inspect. */
			const raw = new Database(path);
			try {
				const tables = raw
					.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
					.all() as Array<{ name: string }>;
				const names = tables.map((t) => t.name).filter((n) => !n.startsWith("sqlite_"));

				expect(names).toContain("agent_decisions");
				expect(names).toContain("agent_sessions");
				expect(names).toContain("campaign_snapshots");
				expect(names).toContain("agent_config");

				/* And we can actually insert into the audit table -- the original
				 * symptom of the bug was 'no such table: agent_decisions' on insert. */
				raw
					.prepare(
						`INSERT INTO agent_decisions
					 (id, session_id, ad_account_id, tool_name, params, reasoning,
					  expected_outcome, score, risk_level, success, timestamp)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					)
					.run(
						"d1",
						"s1",
						"act_test",
						"list_campaigns",
						"{}",
						"r",
						"o",
						0.5,
						"low",
						1,
						"2026-05-04T00:00:00Z",
					);
				const count = (
					raw.prepare("SELECT COUNT(*) as n FROM agent_decisions").get() as {
						n: number;
					}
				).n;
				expect(count).toBe(1);
			} finally {
				raw.close();
			}
		} finally {
			conn.close();
		}
	});

	it("bootstrap is idempotent: rerunning preserves data", () => {
		const path = join(tempDir, "agent.db");
		const raw = new Database(path);

		try {
			bootstrapSqliteSchema(raw);

			raw
				.prepare(
					`INSERT INTO agent_decisions
				 (id, session_id, ad_account_id, tool_name, params, reasoning,
				  expected_outcome, score, risk_level, success, timestamp)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.run("d1", "s1", "act_x", "t", "{}", "r", "o", 0.5, "low", 1, "2026-01-01");

			/* Run bootstrap again -- should not throw and must not drop the row. */
			bootstrapSqliteSchema(raw);
			bootstrapSqliteSchema(raw);

			const count = (
				raw.prepare("SELECT COUNT(*) as n FROM agent_decisions").get() as {
					n: number;
				}
			).n;
			expect(count).toBe(1);
		} finally {
			raw.close();
		}
	});

	it("bootstrap installs the expected indexes", () => {
		const path = join(tempDir, "agent.db");
		const raw = new Database(path);

		try {
			bootstrapSqliteSchema(raw);

			const indexes = raw
				.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
				.all() as Array<{ name: string }>;
			const names = indexes.map((i) => i.name);

			expect(names).toEqual(
				expect.arrayContaining([
					"idx_decisions_session_id",
					"idx_decisions_ad_account",
					"idx_decisions_timestamp",
					"idx_decisions_tool_name",
					"idx_snapshots_campaign",
					"idx_snapshots_ad_account",
					"idx_config_ad_account",
					"idx_sessions_ad_account",
				]),
			);
		} finally {
			raw.close();
		}
	});

	it("SQLITE_BOOTSTRAP_SQL is non-empty and references all four tables", () => {
		/* Belt-and-suspenders: catch a future accidental wipe of the constant. */
		expect(SQLITE_BOOTSTRAP_SQL).toMatch(/CREATE TABLE IF NOT EXISTS agent_sessions/);
		expect(SQLITE_BOOTSTRAP_SQL).toMatch(/CREATE TABLE IF NOT EXISTS agent_decisions/);
		expect(SQLITE_BOOTSTRAP_SQL).toMatch(/CREATE TABLE IF NOT EXISTS campaign_snapshots/);
		expect(SQLITE_BOOTSTRAP_SQL).toMatch(/CREATE TABLE IF NOT EXISTS agent_config/);
	});
});
