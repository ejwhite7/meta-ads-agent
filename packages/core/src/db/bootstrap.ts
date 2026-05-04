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
 * Schema bootstrap SQL for SQLite. Mirrors `db/migrations/0000_initial.sql`.
 * Every statement is `IF NOT EXISTS`, so this can be applied unconditionally.
 */
export const SQLITE_BOOTSTRAP_SQL = `
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

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_decisions_session_id ON agent_decisions (session_id);
CREATE INDEX IF NOT EXISTS idx_decisions_ad_account ON agent_decisions (ad_account_id);
CREATE INDEX IF NOT EXISTS idx_decisions_timestamp ON agent_decisions (timestamp);
CREATE INDEX IF NOT EXISTS idx_decisions_tool_name ON agent_decisions (tool_name);
CREATE INDEX IF NOT EXISTS idx_snapshots_campaign ON campaign_snapshots (campaign_id, date);
CREATE INDEX IF NOT EXISTS idx_snapshots_ad_account ON campaign_snapshots (ad_account_id);
CREATE INDEX IF NOT EXISTS idx_config_ad_account ON agent_config (ad_account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_ad_account ON agent_sessions (ad_account_id);
`;

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
	db.exec(SQLITE_BOOTSTRAP_SQL);
}
