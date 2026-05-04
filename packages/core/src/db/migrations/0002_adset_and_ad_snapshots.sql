-- Migration 0002: ad-set and ad snapshot tables
--
-- The agent needs visibility one and two levels deeper than
-- campaign rollups to make recommendations like "pause this ad set"
-- or "rotate this creative." Same shape as campaign_snapshots,
-- one row per (entity, tick).

CREATE TABLE IF NOT EXISTS adset_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adset_id TEXT NOT NULL,
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

CREATE TABLE IF NOT EXISTS ad_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id TEXT NOT NULL,
  adset_id TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_adset_snapshots_adset_date ON adset_snapshots (adset_id, date);
CREATE INDEX IF NOT EXISTS idx_adset_snapshots_campaign ON adset_snapshots (campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_snapshots_ad_date ON ad_snapshots (ad_id, date);
CREATE INDEX IF NOT EXISTS idx_ad_snapshots_adset ON ad_snapshots (adset_id);
