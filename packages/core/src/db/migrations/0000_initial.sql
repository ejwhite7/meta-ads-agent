-- Initial migration for meta-ads-agent database
-- Creates the four core tables used by the agent system.
--
-- IMPORTANT: The agent_decisions table is an append-only audit log.
-- Records should NEVER be deleted from this table.

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
