/**
 * @module agent/types
 * Agent-specific types for the OODA loop and session management.
 *
 * Defines the context, result, and configuration types used by the
 * stateless agent loop and the stateful AgentSession wrapper.
 */

import type { AuditLogger } from "../audit/logger.js";
import type { AgentConfig } from "../config/types.js";
import type { ActionProposal, GuardrailConfig } from "../decisions/types.js";
import type { CampaignGoal, CampaignGoalRepository, PendingGuidance } from "../goals/index.js";
import type { LLMProvider } from "../llm/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type {
	AdMetrics,
	AdSetMetrics,
	AgentAction,
	AgentGoal,
	CampaignMetrics,
	PendingAction,
} from "../types.js";

/**
 * Input context for a single agent loop iteration.
 *
 * Contains everything the stateless loop needs to produce action proposals:
 * current metrics, goals, available tools, and the LLM provider.
 */
export interface AgentLoopContext {
	/** Current campaign metrics from Meta Insights API */
	readonly metrics: CampaignMetrics[];

	/**
	 * Current ad-set metrics. Surfaced to the LLM so it can recommend
	 * ad-set-level actions. Optional only because legacy fixtures
	 * predate the per-level fetch; production callers always pass it.
	 */
	readonly adSetMetrics?: AdSetMetrics[];

	/** Current ad-level metrics. Same rationale as `adSetMetrics`. */
	readonly adMetrics?: AdMetrics[];

	/** Agent optimization goals (ROAS target, CPA cap, etc.) */
	readonly goals: AgentGoal;

	/** Registry of available tools the agent can invoke */
	readonly toolRegistry: ToolRegistry;

	/** LLM provider for reasoning and action proposal generation */
	readonly llmProvider: LLMProvider;

	/** Maximum number of action proposals to generate per iteration */
	readonly maxProposals: number;

	/** Guardrail constraints for the decision engine */
	readonly guardrails?: Partial<GuardrailConfig>;

	/** Ad account ID for context in prompts */
	readonly adAccountId: string;

	/**
	 * Per-campaign goal store. Required for the agent to act on any
	 * campaign -- campaigns without an active goal are routed to
	 * `pendingGuidance` and excluded from decision-making.
	 *
	 * Optional only to keep older test fixtures working; production
	 * callers (AgentSession) always pass it.
	 */
	readonly goalRepository?: CampaignGoalRepository;

	/**
	 * Map of campaignId -> current Meta objective. Used for
	 * objective-drift detection: if a campaign's current objective
	 * differs from the goal's `lastSeenObjective`, the agent
	 * re-prompts (records pending-guidance, soft-deletes the goal).
	 *
	 * Populated by the session from `client.campaigns.list()` before
	 * calling the loop.
	 */
	readonly campaignObjectives?: Map<
		string,
		{ name: string; objective: string; status: string; dailyBudget: number | null }
	>;
}

/**
 * Output of a single agent loop iteration.
 *
 * Contains the ranked action proposals, LLM reasoning trace,
 * and a summary of the metrics that informed the decisions.
 */
export interface AgentLoopResult {
	/** Ranked action proposals approved for execution (highest score first) */
	readonly proposals: ActionProposal[];

	/** Proposals that exceeded guardrails and require human approval */
	readonly pendingActions: PendingAction[];

	/**
	 * Campaigns that need operator guidance before the agent will act on
	 * them (no goal configured, objective changed, or goal soft-deleted).
	 * The agent records `_pending_guidance` audit rows for each.
	 */
	readonly pendingGuidance: PendingGuidance[];

	/** Per-campaign goals applied this tick (for audit / surfacing). */
	readonly appliedGoals: CampaignGoal[];

	/** Full LLM reasoning text for audit logging */
	readonly reasoning: string;

	/** Summary metrics used in this iteration */
	readonly metricsSummary: MetricsSummary;

	/** Timestamp when this iteration completed */
	readonly timestamp: string;
}

/**
 * Aggregated metrics summary for reporting and audit purposes.
 */
export interface MetricsSummary {
	/** Total number of active campaigns analyzed */
	readonly campaignCount: number;

	/** Total spend across all campaigns */
	readonly totalSpend: number;

	/** Average ROAS across all campaigns */
	readonly avgRoas: number;

	/** Average CPA across all campaigns */
	readonly avgCpa: number;

	/** Average CTR across all campaigns */
	readonly avgCtr: number;
}

/**
 * Current status of an AgentSession, exposed for API/dashboard consumption.
 */
export interface SessionStatus {
	/** Unique session identifier */
	readonly sessionId: string;

	/** Current session state */
	readonly state: "idle" | "running" | "paused" | "stopped" | "error";

	/** Number of completed OODA iterations in this session */
	readonly iterationCount: number;

	/** Number of consecutive failures (resets on success) */
	readonly consecutiveFailures: number;

	/** ISO 8601 timestamp of the last successful tick */
	readonly lastTickAt: string | null;

	/** ISO 8601 timestamp of the next scheduled tick */
	readonly nextTickAt: string | null;

	/** Error message from the last failure (null if last tick succeeded) */
	readonly lastError: string | null;
}

/**
 * Configuration for creating an AgentSession.
 *
 * Combines the validated agent config with runtime dependencies
 * (tool registry, LLM provider, audit logger, database).
 */
export interface AgentSessionConfig {
	/** Validated agent configuration */
	readonly config: AgentConfig;

	/** Registry of available tools */
	readonly toolRegistry: ToolRegistry;

	/** LLM provider for reasoning */
	readonly llmProvider: LLMProvider;

	/** Audit logger for recording decisions */
	readonly auditLogger: AuditLogger;

	/** Agent optimization goals */
	readonly goals: AgentGoal;

	/** Guardrail constraints */
	readonly guardrails?: Partial<GuardrailConfig>;

	/** Function to fetch current campaign metrics (injected for testability) */
	readonly fetchMetrics: () => Promise<CampaignMetrics[]>;

	/**
	 * Optional fetch for ad-set-level metrics. If provided, the session
	 * calls it once per tick alongside `fetchMetrics` and forwards the
	 * result to both the snapshot writer and the OODA loop. Returning
	 * an empty array (or omitting this) is fine — the agent simply
	 * loses ad-set visibility for the tick.
	 */
	readonly fetchAdSetMetrics?: () => Promise<AdSetMetrics[]>;

	/** Optional fetch for ad-level metrics. Same contract as above. */
	readonly fetchAdMetrics?: () => Promise<AdMetrics[]>;

	/**
	 * Per-campaign goal store. Required for the agent to act on
	 * campaigns -- without it, every campaign falls into the legacy
	 * "all-actionable" path (see filterByGoals in agent/loop.ts).
	 */
	readonly goalRepository?: import("../goals/index.js").CampaignGoalRepository;

	/** Meta API client instance */
	// biome-ignore lint/suspicious/noExplicitAny: accepts any MetaClient-compatible object
	readonly metaClient: any;

	/**
	 * Optional writer that persists per-tick campaign metrics into the
	 * `campaign_snapshots` table. When provided, the session writes
	 * one snapshot per campaign per tick immediately after
	 * `fetchMetrics` returns. Snapshot persistence is best-effort:
	 * write failures are logged and swallowed so they do not abort
	 * the OODA cycle (see AgentSession.executeTick).
	 *
	 * If omitted, snapshots are not persisted -- the agent still
	 * functions, but the dashboard's `/api/campaigns` endpoint will
	 * see no historical data.
	 */
	readonly snapshotWriter?: import("../snapshots/writer.js").SnapshotWriter;

	/**
	 * Optional engine that backfills `actual_outcome` and
	 * `performance_delta` on prior-tick decisions. When provided, the
	 * session calls `backfillEngine.run(currentMetrics, adAccountId)`
	 * after fetching metrics and writing the new snapshot, but BEFORE
	 * the OODA loop runs. Failure is best-effort: backfill problems
	 * are logged and swallowed so they cannot abort a tick.
	 *
	 * If omitted, decisions accumulate without outcome data --
	 * existing behavior pre-CLAUDE.md §6 implementation.
	 */
	readonly backfillEngine?: import("../audit/backfill.js").BackfillEngine;

	/**
	 * Optional Drizzle DB handle. When provided, AgentSession will
	 * INSERT a row into `agent_sessions` on construction and UPDATE
	 * it on every state change / tick completion. Without this, the
	 * `/api/status` endpoint always reports `stopped` because nothing
	 * ever wrote a session row (a real bug in pre-PR-this versions).
	 *
	 * Persistence is best-effort: a DB write failure logs a warning
	 * but does not abort the tick, mirroring snapshot/backfill semantics.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: drizzle DB type varies by backend
	readonly db?: any;
}

/**
 * Result of a single session tick (one complete OODA cycle).
 */
export interface SessionResult {
	/** Whether the tick completed successfully */
	readonly success: boolean;

	/** Agent loop result (null if the tick failed) */
	readonly loopResult: AgentLoopResult | null;

	/** Actions that were executed (subset of proposals that passed guardrails) */
	readonly executedActions: AgentAction[];

	/** Error message if the tick failed */
	readonly error: string | null;
}
