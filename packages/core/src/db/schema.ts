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
