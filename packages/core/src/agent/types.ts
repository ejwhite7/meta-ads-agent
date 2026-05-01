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
import type { LLMProvider } from "../llm/types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { AgentAction, AgentGoal, CampaignMetrics, PendingAction } from "../types.js";

/**
 * Input context for a single agent loop iteration.
 *
 * Contains everything the stateless loop needs to produce action proposals:
 * current metrics, goals, available tools, and the LLM provider.
 */
export interface AgentLoopContext {
	/** Current campaign metrics from Meta Insights API */
	readonly metrics: CampaignMetrics[];

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

	/** Meta API client instance */
	// biome-ignore lint/suspicious/noExplicitAny: accepts any MetaClient-compatible object
	readonly metaClient: any;
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
