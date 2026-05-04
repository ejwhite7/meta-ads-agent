/**
 * @module db/bootstrap
 *
 * Idempotent schema bootstrapper for the SQLite backend.
 *
 * The agent ships as a single bundled binary (`tsup` -> `dist/index.js`)
 * which means the on-disk migration SQL files in `db/migrations/*.sql`
 * are NOT included in the published tarball -- only TypeScript source
 * gets bundled. So we inline the schema as a string constant and run
 * it on every connection. All statements use `IF NOT EXISTS`, so
 * re-running on an already-populated database is safe (no-op).
 *
 * Why not Drizzle migrations? `drizzle-kit migrate` reads journal files
 * from disk too, with the same shipping problem. Inlined raw SQL is
 * simpler and gives us full control over cross-backend compatibility
 * (this is SQLite-specific; the Postgres backend would need its own
 * bootstrap with adjusted types).
 *
 * If you change `db/schema.ts`, mirror the change here. The two are
 * kept in sync manually -- a follow-up could codegen this file from
 * the Drizzle schema, but for the small set of tables we have today
 * the maintenance burden is negligible.
 */

/**
 * Tables-only bootstrap. Run BEFORE `SQLITE_BOOTSTRAP_ALTERS` so the
 * ALTERs can add columns to existing tables, and BEFORE
 * `SQLITE_BOOTSTRAP_INDEXES` so the indexes can reference any newly-
 * added columns.
 *
 * Every CREATE TABLE is `IF NOT EXISTS`, so this can be applied
 * unconditionally.
 */
export const SQLITE_BOOTSTRAP_TABLES_SQL = `
-- Agent sessions table: tracks agent session lifecycle and state
CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  ad_account_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'running', 'paused', 'stopped', 'error')),
  iteration_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_tick_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Agent decisions table: append-only audit log (NEVER DELETE RECORDS)
CREATE TABLE IF NOT EXISTS agent_decisions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  ad_account_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  params TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  expected_outcome TEXT NOT NULL,
  score REAL NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),
  success INTEGER NOT NULL,
  result_data TEXT,
  error_message TEXT,
  -- Backfilled on a subsequent tick by the BackfillEngine. JSON.
  actual_outcome TEXT,
  performance_delta TEXT,
  timestamp TEXT NOT NULL
);

-- Campaign snapshots table: historical metrics for trend analysis
CREATE TABLE IF NOT EXISTS campaign_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  ad_account_id TEXT NOT NULL,
  impressions INTEGER NOT NULL,
  clicks INTEGER NOT NULL,
  spend REAL NOT NULL,
  conversions INTEGER NOT NULL,
  roas REAL NOT NULL,
  cpa REAL NOT NULL,
  ctr REAL NOT NULL,
  date TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

-- Agent config table: stored goal config per ad account
CREATE TABLE IF NOT EXISTS agent_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_account_id TEXT NOT NULL,
  roas_target REAL NOT NULL,
  cpa_cap REAL NOT NULL,
  daily_budget_limit REAL NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('conservative', 'moderate', 'aggressive')),
  created_at TEXT NOT NULL
);

-- Per-campaign goal configuration (see packages/core/src/goals/)
-- Soft-delete + history-by-insert: the active goal is the most-recent
-- row with deleted_at IS NULL for a given (ad_account_id, campaign_id).
CREATE TABLE IF NOT EXISTS campaign_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  primary_kpi TEXT NOT NULL,
  primary_kpi_target REAL NOT NULL,
  primary_kpi_direction TEXT NOT NULL CHECK (primary_kpi_direction IN ('maximize', 'minimize')),
  secondary_kpis TEXT,
  min_daily_budget REAL,
  max_budget_scale_factor REAL,
  require_approval_above REAL,
  last_seen_objective TEXT NOT NULL,
  configured_at TEXT NOT NULL,
  configured_by TEXT NOT NULL,
  notes TEXT,
  deleted_at TEXT
);

`;

/**
 * Indexes-only bootstrap. Run AFTER `SQLITE_BOOTSTRAP_ALTERS` so any
 * indexes that reference newly-added columns (e.g.
 * `idx_agent_decisions_pending_backfill` references `actual_outcome`,
 * which was added later via ALTER TABLE) can resolve those columns.
 *
 * Every CREATE INDEX is `IF NOT EXISTS`.
 */
export const SQLITE_BOOTSTRAP_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_decisions_session_id ON agent_decisions (session_id);
CREATE INDEX IF NOT EXISTS idx_decisions_ad_account ON agent_decisions (ad_account_id);
CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON agent_decisions (timestamp);
CREATE INDEX IF NOT EXISTS idx_decisions_tool_name ON agent_decisions (tool_name);
CREATE INDEX IF NOT EXISTS idx_snapshots_campaign ON campaign_snapshots (campaign_id, date);
CREATE INDEX IF NOT EXISTS idx_snapshots_ad_account ON campaign_snapshots (ad_account_id);
CREATE INDEX IF NOT EXISTS idx_config_ad_account ON agent_config (ad_account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_ad_account ON agent_sessions (ad_account_id);
CREATE INDEX IF NOT EXISTS idx_campaign_goals_account_campaign_deleted ON campaign_goals (ad_account_id, campaign_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_campaign_goals_account ON campaign_goals (ad_account_id);
CREATE INDEX IF NOT EXISTS idx_agent_decisions_pending_backfill ON agent_decisions (ad_account_id, success, actual_outcome);
`;

/**
 * Backwards-compatibility alias. Older external consumers (tests in
 * other packages, downstream embeddings) imported `SQLITE_BOOTSTRAP_SQL`
 * as the single string. We now split it into TABLES + INDEXES so the
 * upgrade-path ALTERs can run between them, but a concatenated form
 * still applies all statements -- safe on a fresh DB only.
 */
export const SQLITE_BOOTSTRAP_SQL = SQLITE_BOOTSTRAP_TABLES_SQL + SQLITE_BOOTSTRAP_INDEXES_SQL;

/**
 * Idempotent ALTER TABLE statements run AFTER the CREATE TABLE block.
 *
 * SQLite does not support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
 * so we issue the ALTER and swallow the "duplicate column name" error
 * that fires when the column already exists. This handles the upgrade
 * path for users whose DB was created before backfill columns existed.
 *
 * Each entry is { sql, ignoreIfContains } -- the second field is the
 * substring of the SQLite error message we accept as "already applied."
 */
const SQLITE_BOOTSTRAP_ALTERS: Array<{ sql: string; ignoreIfContains: string }> = [
	{
		sql: "ALTER TABLE agent_decisions ADD COLUMN actual_outcome TEXT;",
		ignoreIfContains: "duplicate column name",
	},
	{
		sql: "ALTER TABLE agent_decisions ADD COLUMN performance_delta TEXT;",
		ignoreIfContains: "duplicate column name",
	},
];

/**
 * better-sqlite3 Database-shaped subset we need for bootstrap.
 * Avoiding a hard import of the better-sqlite3 type so this module
 * stays driver-agnostic at the type level.
 */
interface SqliteHandle {
	exec(sql: string): unknown;
}

/**
 * Apply the bootstrap schema to a SQLite database handle.
 * Safe to call on every connection -- all statements are `IF NOT EXISTS`.
 *
 * @param db - better-sqlite3 Database instance (or any object exposing `exec`).
 * @throws The underlying driver's error if the SQL fails to execute.
 *   Callers should let this propagate so the daemon halts loudly rather
 *   than silently running against an unpopulated DB.
 */
export function bootstrapSqliteSchema(db: SqliteHandle): void {
	/* 1. Tables first. Idempotent (CREATE TABLE IF NOT EXISTS). */
	db.exec(SQLITE_BOOTSTRAP_TABLES_SQL);

	/* 2. ALTER TABLE statements for the upgrade path. SQLite has no
	 *    `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, so we swallow the
	 *    "duplicate column name" error that fires when the column was
	 *    already added (typical on fresh DBs since the CREATE TABLE
	 *    above already includes the column). Any other error is real
	 *    and propagates. */
	for (const alter of SQLITE_BOOTSTRAP_ALTERS) {
		try {
			db.exec(alter.sql);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!msg.toLowerCase().includes(alter.ignoreIfContains)) {
				throw err;
			}
		}
	}

	/* 3. Indexes last so any index that references a newly-added column
	 *    (e.g. idx_agent_decisions_pending_backfill on actual_outcome)
	 *    can resolve the column on a legacy DB whose ALTER just ran. */
	db.exec(SQLITE_BOOTSTRAP_INDEXES_SQL);
}
