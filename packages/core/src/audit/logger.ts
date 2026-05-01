/**
 * @module audit/logger
 * Append-only audit logger for agent decisions.
 *
 * Writes every agent action to the agent_decisions table. Records are
 * NEVER deleted — this ensures a complete audit trail of all agent
 * behavior for compliance, debugging, and performance analysis.
 *
 * The logger accepts a generic database interface so it works with
 * both SQLite (local) and PostgreSQL (cloud) backends.
 */

import { randomUUID } from "node:crypto";
import type { AuditFilter, AuditRecord } from "./types.js";

/**
 * Minimal database interface required by the AuditLogger.
 * Decoupled from Drizzle to allow flexible backend injection.
 */
export interface AuditDatabase {
	/** Insert a single audit record into the agent_decisions table */
	insertDecision(record: AuditRecord): Promise<void>;

	/** Query audit records with optional filters */
	queryDecisions(filter: AuditFilter): Promise<AuditRecord[]>;
}

/**
 * Listener invoked when audit-log persistence fails.
 *
 * Receives the failed record and the underlying error so callers
 * (e.g. AgentSession) can decide whether to halt the agent or
 * surface the failure to operators.
 */
export type AuditFailureListener = (record: AuditRecord, error: Error) => void;

/**
 * Append-only audit logger that records every agent decision.
 *
 * Usage:
 * ```ts
 * const logger = new AuditLogger(db);
 * await logger.logDecision({ sessionId, toolName, ... });
 * const history = await logger.getDecisions({ toolName: 'update_budget' });
 * ```
 */
export class AuditLogger {
	/** Database backend for persisting audit records */
	private readonly db: AuditDatabase;

	/** Optional listener notified on every persistence failure. */
	private failureListener: AuditFailureListener | null = null;

	/** Number of consecutive insert failures since the last success. */
	private consecutiveFailures = 0;

	/**
	 * Creates a new AuditLogger instance.
	 *
	 * @param db - Database interface for reading and writing audit records
	 */
	constructor(db: AuditDatabase) {
		this.db = db;
	}

	/**
	 * Registers a listener invoked whenever an audit insert fails.
	 * The agent session uses this to halt on prolonged audit-log outages.
	 */
	onFailure(listener: AuditFailureListener): void {
		this.failureListener = listener;
	}

	/**
	 * Returns the number of consecutive insert failures since the last success.
	 * Resets to 0 on the next successful write.
	 */
	getConsecutiveFailures(): number {
		return this.consecutiveFailures;
	}

	/**
	 * Logs a single agent decision to the audit trail.
	 *
	 * Automatically assigns an ID and timestamp if not already present.
	 * This method never throws -- logging failures are routed to stderr
	 * AND the registered failure listener (if any) so the agent loop
	 * can react (e.g. pause after N consecutive failures).
	 *
	 * @param record - The audit record to persist
	 */
	async logDecision(record: AuditRecord): Promise<void> {
		const enriched: AuditRecord = {
			...record,
			id: record.id ?? randomUUID(),
			timestamp: record.timestamp ?? new Date().toISOString(),
		};

		try {
			await this.db.insertDecision(enriched);
			this.consecutiveFailures = 0;
		} catch (err: unknown) {
			const error = err instanceof Error ? err : new Error(String(err));
			this.consecutiveFailures++;
			console.error(`[AuditLogger] Failed to log decision: ${error.message}`);
			if (this.failureListener) {
				try {
					this.failureListener(enriched, error);
				} catch {
					/* listener errors must never escape */
				}
			}
		}
	}

	/**
	 * Retrieves audit records matching the given filter criteria.
	 *
	 * Results are ordered by timestamp descending (most recent first).
	 * If no filter is provided, returns the most recent 100 records.
	 *
	 * @param filter - Optional filter criteria for narrowing results
	 * @returns Array of matching audit records
	 */
	async getDecisions(filter: AuditFilter = {}): Promise<AuditRecord[]> {
		const normalizedFilter: AuditFilter = {
			limit: 100,
			offset: 0,
			...filter,
		};

		return this.db.queryDecisions(normalizedFilter);
	}
}
