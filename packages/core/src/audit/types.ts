/**
 * @module audit/types
 * Types for the append-only audit logging system.
 *
 * Every action the agent takes is recorded as an AuditRecord in the
 * agent_decisions table. Records are never deleted — this provides a
 * complete, tamper-evident history of all agent behavior for compliance,
 * debugging, and performance analysis.
 */

/**
 * A single audit record representing one agent decision and its outcome.
 * Written to the agent_decisions table by the AuditLogger.
 */
export interface AuditRecord {
	/** Unique identifier for this audit record (UUID v4) */
	readonly id?: string;

	/** Session ID that produced this decision */
	readonly sessionId: string;

	/** Meta ad account ID this decision applies to */
	readonly adAccountId: string;

	/** Name of the tool that was invoked */
	readonly toolName: string;

	/** Parameters passed to the tool */
	readonly params: Record<string, unknown>;

	/** LLM reasoning that led to this decision */
	readonly reasoning: string;

	/** Expected impact described by the LLM */
	readonly expectedOutcome: string;

	/** Computed score from the decision engine */
	readonly score: number;

	/** Risk level assigned by the decision engine */
	readonly riskLevel: "low" | "medium" | "high";

	/** Whether the tool execution succeeded */
	readonly success: boolean;

	/** Tool execution result data (null if execution failed) */
	readonly resultData: Record<string, unknown> | null;

	/** Error message if the tool execution failed */
	readonly errorMessage: string | null;

	/**
	 * Snapshot of the affected campaign's metrics, captured by the
	 * BackfillEngine on a subsequent tick. NULL until backfilled.
	 */
	readonly actualOutcome?: Record<string, unknown> | null;

	/**
	 * Diff between the metrics at decision time and the post-decision
	 * snapshot captured by the BackfillEngine. NULL when no baseline
	 * snapshot was available at decision time.
	 */
	readonly performanceDelta?: Record<string, unknown> | null;

	/** ISO 8601 timestamp when the decision was made */
	readonly timestamp?: string;
}

/**
 * A single audit decision that has not yet had its outcome backfilled.
 * Returned by AuditDatabase.listPendingBackfills so the BackfillEngine
 * can pair the decision with the campaign's current and prior metrics.
 */
export interface PendingBackfill {
	readonly id: string;
	readonly adAccountId: string;
	readonly toolName: string;
	readonly params: Record<string, unknown>;
	readonly timestamp: string;
}

/**
 * Update applied to a single audit row by the BackfillEngine.
 * `actualOutcome` is required (the whole point); `performanceDelta`
 * may be null when no baseline snapshot existed.
 */
export interface BackfillUpdate {
	readonly id: string;
	readonly actualOutcome: Record<string, unknown>;
	readonly performanceDelta: Record<string, unknown> | null;
}

/**
 * Filter criteria for querying audit records.
 * All fields are optional — omit a field to skip that filter.
 */
export interface AuditFilter {
	/** Filter by session ID */
	readonly sessionId?: string;

	/** Filter by ad account ID */
	readonly adAccountId?: string;

	/** Filter by tool name */
	readonly toolName?: string;

	/** Filter by risk level */
	readonly riskLevel?: "low" | "medium" | "high";

	/** Filter by success/failure */
	readonly success?: boolean;

	/** Return records created on or after this ISO 8601 timestamp */
	readonly startDate?: string;

	/** Return records created on or before this ISO 8601 timestamp */
	readonly endDate?: string;

	/** Maximum number of records to return (default: 100) */
	readonly limit?: number;

	/** Number of records to skip for pagination */
	readonly offset?: number;
}
