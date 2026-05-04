-- Migration 0001: per-campaign goal configuration.
--
-- The agent stores one or more rows per (ad_account_id, campaign_id);
-- the active goal is the most-recent row with deleted_at IS NULL.
-- Soft-delete + history-by-insert means every goal change is preserved.
--
-- Without an active goal row for a campaign, the agent records a
-- `_pending_guidance` audit entry on each tick and refuses to make
-- decisions on the campaign. See packages/core/src/goals/ and
-- packages/cli/src/commands/guidance.ts.
--
-- This file MUST be kept in sync with packages/core/src/db/bootstrap.ts
-- (the inlined-SQL bootstrap path applied to every fresh connection).

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

CREATE INDEX IF NOT EXISTS idx_campaign_goals_account_campaign_deleted
  ON campaign_goals (ad_account_id, campaign_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_campaign_goals_account
  ON campaign_goals (ad_account_id);
