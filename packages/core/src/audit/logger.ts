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

	/**
	 * Creates a new AuditLogger instance.
	 *
	 * @param db - Database interface for reading and writing audit records
	 */
	constructor(db: AuditDatabase) {
		this.db = db;
	}

	/**
	 * Logs a single agent decision to the audit trail.
	 *
	 * Automatically assigns an ID and timestamp if not already present.
	 * This method never throws — logging failures are caught and written
	 * to stderr to avoid disrupting the agent loop.
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
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			console.error(`[AuditLogger] Failed to log decision: ${message}`);
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
