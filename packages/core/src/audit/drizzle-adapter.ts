/**
 * @module audit/drizzle-adapter
 *
 * Drizzle-backed AuditDatabase adapter that persists agent decisions to
 * the configured database (SQLite or Postgres). Implements the
 * `AuditDatabase` interface so it can be plugged into `AuditLogger`.
 *
 * Decision params and result data are JSON-serialized before insertion
 * because the underlying schema stores them as TEXT for backend portability.
 */

import { desc } from "drizzle-orm";
import { agentDecisions } from "../db/schema.js";
import type { AuditDatabase } from "./logger.js";
import type { AuditFilter, AuditRecord } from "./types.js";

/**
 * Drizzle-backed implementation of {@link AuditDatabase}.
 *
 * @example
 * ```ts
 * const conn = createDatabase({ type: 'sqlite', sqlitePath: 'agent.db' });
 * const auditLogger = new AuditLogger(new DrizzleAuditDatabase(conn.db));
 * ```
 */
export class DrizzleAuditDatabase implements AuditDatabase {
	// biome-ignore lint/suspicious/noExplicitAny: Drizzle db type varies by backend dialect
	constructor(private readonly db: any) {}

	async insertDecision(record: AuditRecord): Promise<void> {
		await this.db.insert(agentDecisions).values({
			id: record.id ?? "",
			sessionId: record.sessionId,
			adAccountId: record.adAccountId,
			toolName: record.toolName,
			params: JSON.stringify(record.params ?? {}),
			reasoning: record.reasoning ?? "",
			expectedOutcome: record.expectedOutcome ?? "",
			score: record.score ?? 0,
			riskLevel: record.riskLevel ?? "medium",
			success: record.success,
			resultData: record.resultData ? JSON.stringify(record.resultData) : null,
			errorMessage: record.errorMessage ?? null,
			timestamp: record.timestamp ?? new Date().toISOString(),
		});
	}

	async queryDecisions(filter: AuditFilter): Promise<AuditRecord[]> {
		const limit = filter.limit ?? 100;
		const offset = filter.offset ?? 0;
		const rows = await this.db
			.select()
			.from(agentDecisions)
			.orderBy(desc(agentDecisions.timestamp))
			.limit(limit)
			.offset(offset);
		// biome-ignore lint/suspicious/noExplicitAny: row shape matches AuditRecord at runtime
		return rows.map((r: any) => ({
			id: r.id,
			sessionId: r.sessionId,
			adAccountId: r.adAccountId,
			toolName: r.toolName,
			params: r.params ? JSON.parse(r.params) : {},
			reasoning: r.reasoning,
			expectedOutcome: r.expectedOutcome,
			score: r.score,
			riskLevel: r.riskLevel,
			success: r.success,
			resultData: r.resultData ? JSON.parse(r.resultData) : null,
			errorMessage: r.errorMessage,
			timestamp: r.timestamp,
		}));
	}
}
