/**
 * @module db/schema
 * Drizzle ORM schema definitions for the meta-ads-agent database.
 *
 * Defines four core tables:
 * - agent_sessions: Tracks agent session lifecycle and state
 * - agent_decisions: Append-only audit log (NEVER DELETE RECORDS)
 * - campaign_snapshots: Historical campaign metrics for trend analysis
 * - agent_config: Stored goal configuration per ad account
 *
 * Uses SQLite column types — Drizzle handles the mapping to PostgreSQL
 * equivalents when the Postgres driver is used.
 */

import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Agent sessions table.
 *
 * Tracks the lifecycle of each agent session including its current state,
 * iteration count, and scheduling metadata. Used for crash recovery and
 * session management.
 */
export const agentSessions = sqliteTable("agent_sessions", {
	/** Unique session identifier (UUID v4) */
	id: text("id").primaryKey(),

	/** Meta ad account ID this session is managing */
	adAccountId: text("ad_account_id").notNull(),

	/** Current session state */
	state: text("state", { enum: ["idle", "running", "paused", "stopped", "error"] })
		.notNull()
		.default("idle"),

	/** Number of completed OODA iterations */
	iterationCount: integer("iteration_count").notNull().default(0),

	/** Number of consecutive failures (resets on success) */
	consecutiveFailures: integer("consecutive_failures").notNull().default(0),

	/** ISO 8601 timestamp of the last successful tick */
	lastTickAt: text("last_tick_at"),

	/** Last error message (null if last tick succeeded) */
	lastError: text("last_error"),

	/** ISO 8601 timestamp when the session was created */
	createdAt: text("created_at").notNull(),

	/** ISO 8601 timestamp of the last state update */
	updatedAt: text("updated_at").notNull(),
});

/**
 * Agent decisions table — append-only audit log.
 *
 * IMPORTANT: Records in this table are NEVER deleted. This ensures a
 * complete, tamper-evident history of all agent actions for compliance,
 * debugging, and performance analysis.
 */
export const agentDecisions = sqliteTable(
	"agent_decisions",
	{
		/** Unique decision identifier (UUID v4) */
		id: text("id").primaryKey(),

		/** Session ID that produced this decision */
		sessionId: text("session_id").notNull(),

		/** Meta ad account ID this decision applies to */
		adAccountId: text("ad_account_id").notNull(),

		/** Name of the tool that was invoked */
		toolName: text("tool_name").notNull(),

		/** JSON-serialized parameters passed to the tool */
		params: text("params").notNull(),

		/** LLM reasoning that led to this decision */
		reasoning: text("reasoning").notNull(),

		/** Expected outcome described by the LLM */
		expectedOutcome: text("expected_outcome").notNull(),

		/** Computed score from the decision engine */
		score: real("score").notNull(),

		/** Risk level assigned by the decision engine */
		riskLevel: text("risk_level", { enum: ["low", "medium", "high"] }).notNull(),

		/** Whether the tool execution succeeded */
		success: integer("success", { mode: "boolean" }).notNull(),

		/** JSON-serialized tool execution result data */
		resultData: text("result_data"),

		/** Error message if the tool execution failed */
		errorMessage: text("error_message"),

		/**
		 * JSON-serialized snapshot of the affected campaign's metrics
		 * captured by the BackfillEngine on a subsequent tick. NULL
		 * until backfilled (or permanently NULL for decisions whose
		 * params don't reference a single campaign, e.g. account-wide
		 * reports). See packages/core/src/audit/backfill.ts.
		 */
		actualOutcome: text("actual_outcome"),

		/**
		 * JSON-serialized diff between the metrics that informed this
		 * decision (latest snapshot before `timestamp`) and the metrics
		 * captured by the BackfillEngine. NULL when no baseline
		 * snapshot existed at decision time.
		 */
		performanceDelta: text("performance_delta"),

		/** ISO 8601 timestamp when the decision was made */
		timestamp: text("timestamp").notNull(),
	},
	(t) => ({
		/* Hot query paths from AgentSession (filter by session) and from the
		 * dashboard (recent-first ordering). Without these the audit table
		 * goes O(n) on every read once it accumulates real data. */
		idxTimestamp: index("idx_agent_decisions_timestamp").on(t.timestamp),
		idxSession: index("idx_agent_decisions_session").on(t.sessionId),
		idxAdAccount: index("idx_agent_decisions_account").on(t.adAccountId),
		idxToolName: index("idx_agent_decisions_tool").on(t.toolName),
		/* The backfill engine queries `WHERE success=1 AND actual_outcome IS NULL`
		 * once per tick. This composite index keeps that scan O(pending) instead
		 * of O(all decisions ever). */
		idxPendingBackfill: index("idx_agent_decisions_pending_backfill").on(
			t.adAccountId,
			t.success,
			t.actualOutcome,
		),
	}),
);

/**
 * Ad set snapshots table.
 *
 * Per-tick metrics for each ad set the account contains, mirroring
 * `campaign_snapshots` one level deeper in the hierarchy. The agent
 * needs this to recommend ad-set-level actions (pause underperforming
 * ad sets, reallocate adset budgets, etc.) -- it cannot make those
 * recommendations from campaign rollups alone.
 */
export const adSetSnapshots = sqliteTable(
	"adset_snapshots",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		adSetId: text("adset_id").notNull(),
		campaignId: text("campaign_id").notNull(),
		adAccountId: text("ad_account_id").notNull(),
		impressions: integer("impressions").notNull(),
		clicks: integer("clicks").notNull(),
		spend: real("spend").notNull(),
		conversions: integer("conversions").notNull(),
		roas: real("roas").notNull(),
		cpa: real("cpa").notNull(),
		ctr: real("ctr").notNull(),
		date: text("date").notNull(),
		recordedAt: text("recorded_at").notNull(),
	},
	(t) => ({
		idxAdSetDate: index("idx_adset_snapshots_adset_date").on(t.adSetId, t.date),
		idxCampaign: index("idx_adset_snapshots_campaign").on(t.campaignId),
	}),
);

/**
 * Ad snapshots table.
 *
 * Per-tick metrics for each ad. Lets the agent (and the dashboard)
 * compare creative performance within an ad set without re-querying
 * Meta for history.
 */
export const adSnapshots = sqliteTable(
	"ad_snapshots",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		adId: text("ad_id").notNull(),
		adSetId: text("adset_id").notNull(),
		campaignId: text("campaign_id").notNull(),
		adAccountId: text("ad_account_id").notNull(),
		impressions: integer("impressions").notNull(),
		clicks: integer("clicks").notNull(),
		spend: real("spend").notNull(),
		conversions: integer("conversions").notNull(),
		roas: real("roas").notNull(),
		cpa: real("cpa").notNull(),
		ctr: real("ctr").notNull(),
		date: text("date").notNull(),
		recordedAt: text("recorded_at").notNull(),
	},
	(t) => ({
		idxAdDate: index("idx_ad_snapshots_ad_date").on(t.adId, t.date),
		idxAdSet: index("idx_ad_snapshots_adset").on(t.adSetId),
	}),
);

/**
 * Campaign snapshots table.
 *
 * Stores historical campaign metrics for trend analysis, anomaly detection,
 * and lookback comparisons. A new snapshot is stored for each campaign
 * on every agent tick.
 */
export const campaignSnapshots = sqliteTable(
	"campaign_snapshots",
	{
		/** Auto-incrementing primary key */
		id: integer("id").primaryKey({ autoIncrement: true }),

		/** Meta campaign ID */
		campaignId: text("campaign_id").notNull(),

		/** Meta ad account ID */
		adAccountId: text("ad_account_id").notNull(),

		/** Total impressions */
		impressions: integer("impressions").notNull(),

		/** Total clicks */
		clicks: integer("clicks").notNull(),

		/** Total spend in account currency */
		spend: real("spend").notNull(),

		/** Total conversions */
		conversions: integer("conversions").notNull(),

		/** Return on ad spend */
		roas: real("roas").notNull(),

		/** Cost per acquisition */
		cpa: real("cpa").notNull(),

		/** Click-through rate */
		ctr: real("ctr").notNull(),

		/** ISO 8601 date for this snapshot */
		date: text("date").notNull(),

		/** ISO 8601 timestamp when the snapshot was recorded */
		recordedAt: text("recorded_at").notNull(),
	},
	(t) => ({
		/* Trend analysis queries always filter by (campaignId, date). */
		idxCampaignDate: index("idx_campaign_snapshots_campaign_date").on(t.campaignId, t.date),
	}),
);

/**
 * Agent configuration table.
 *
 * Stores goal configuration per ad account. Each ad account has exactly
 * one active configuration at a time. Updates create new rows (the latest
 * row for an account is the active config).
 */
export const agentConfig = sqliteTable("agent_config", {
	/** Auto-incrementing primary key */
	id: integer("id").primaryKey({ autoIncrement: true }),

	/** Meta ad account ID this config applies to */
	adAccountId: text("ad_account_id").notNull(),

	/** Target return on ad spend */
	roasTarget: real("roas_target").notNull(),

	/** Maximum cost per acquisition */
	cpaCap: real("cpa_cap").notNull(),

	/** Maximum daily budget across all campaigns */
	dailyBudgetLimit: real("daily_budget_limit").notNull(),

	/** Risk tolerance level */
	riskLevel: text("risk_level", { enum: ["conservative", "moderate", "aggressive"] }).notNull(),

	/** ISO 8601 timestamp when this config was created */
	createdAt: text("created_at").notNull(),
});

/**
 * Per-campaign goal configuration.
 *
 * The agent stores one or more rows per (adAccountId, campaignId).
 * The active goal is the most-recent row with `deletedAt === null`.
 * Soft-delete + history-by-insert means every goal change is
 * preserved -- nothing in this table is ever physically deleted.
 *
 * Without an active goal row, the agent records a `_pending_guidance`
 * audit entry on each tick and refuses to make decisions on the
 * campaign. See packages/core/src/goals/* and the agent loop.
 */
export const campaignGoals = sqliteTable(
	"campaign_goals",
	{
		/** Surrogate auto-increment key (the row identity, not the goal identity). */
		id: integer("id").primaryKey({ autoIncrement: true }),

		/** Meta ad account ID. */
		adAccountId: text("ad_account_id").notNull(),

		/** Meta campaign ID this goal applies to. */
		campaignId: text("campaign_id").notNull(),

		/** Primary metric the agent optimizes for on this campaign. */
		primaryKpi: text("primary_kpi").notNull(),

		/** Target value for the primary KPI. */
		primaryKpiTarget: real("primary_kpi_target").notNull(),

		/** Whether higher (`maximize`) or lower (`minimize`) is better. */
		primaryKpiDirection: text("primary_kpi_direction", {
			enum: ["maximize", "minimize"],
		}).notNull(),

		/** JSON-serialized array of `SecondaryKpi` objects. NULL when none. */
		secondaryKpis: text("secondary_kpis"),

		/** Per-campaign override for account-wide guardrails. NULL = inherit. */
		minDailyBudget: real("min_daily_budget"),
		maxBudgetScaleFactor: real("max_budget_scale_factor"),
		requireApprovalAbove: real("require_approval_above"),

		/**
		 * Meta objective at the time this goal was configured. If the
		 * campaign's current objective drifts from this, the agent
		 * re-prompts (records `_pending_guidance` and stops deciding).
		 */
		lastSeenObjective: text("last_seen_objective").notNull(),

		/** ISO 8601 timestamp when the row was inserted. */
		configuredAt: text("configured_at").notNull(),

		/** Where the configuration came from (init-wizard / guidance-cmd / dashboard / api). */
		configuredBy: text("configured_by").notNull(),

		/** Free-form notes from the operator. */
		notes: text("notes"),

		/**
		 * Soft-delete marker. Active goals have `deletedAt === null`.
		 * Deleting a goal sets this; reconfiguring inserts a fresh row.
		 */
		deletedAt: text("deleted_at"),
	},
	(t) => ({
		/* The hot lookup pattern is "give me the active goal for this
		 * (account, campaign)" -- index on those plus deletedAt so the
		 * planner can skip soft-deleted rows quickly. */
		idxAccountCampaignDeleted: index("idx_campaign_goals_account_campaign_deleted").on(
			t.adAccountId,
			t.campaignId,
			t.deletedAt,
		),
		idxAccount: index("idx_campaign_goals_account").on(t.adAccountId),
	}),
);
