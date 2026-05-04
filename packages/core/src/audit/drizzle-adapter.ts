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

import { type SQL, and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { agentDecisions } from "../db/schema.js";
import type { AuditDatabase } from "./logger.js";
import type { AuditFilter, AuditRecord, BackfillUpdate, PendingBackfill } from "./types.js";

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
			actualOutcome: record.actualOutcome ? JSON.stringify(record.actualOutcome) : null,
			performanceDelta: record.performanceDelta ? JSON.stringify(record.performanceDelta) : null,
			timestamp: record.timestamp ?? new Date().toISOString(),
		});
	}

	async listPendingBackfills(adAccountId: string): Promise<PendingBackfill[]> {
		/* Pending = successful decision (i.e. the agent actually changed
		 * something on Meta) whose outcome has not yet been recorded.
		 * Failed and skipped decisions never get backfilled because the
		 * delta would be meaningless. Order ascending by timestamp so the
		 * BackfillEngine processes oldest first -- helpful when there are
		 * many tick-intervals' worth of unbackfilled rows after an outage. */
		const rows = await this.db
			.select({
				id: agentDecisions.id,
				adAccountId: agentDecisions.adAccountId,
				toolName: agentDecisions.toolName,
				params: agentDecisions.params,
				timestamp: agentDecisions.timestamp,
			})
			.from(agentDecisions)
			.where(
				and(
					eq(agentDecisions.adAccountId, adAccountId),
					eq(agentDecisions.success, true),
					isNull(agentDecisions.actualOutcome),
				),
			)
			.orderBy(asc(agentDecisions.timestamp));

		// biome-ignore lint/suspicious/noExplicitAny: drizzle row shape is opaque
		return (rows as any[]).map((r) => ({
			id: r.id,
			adAccountId: r.adAccountId,
			toolName: r.toolName,
			params: r.params ? JSON.parse(r.params) : {},
			timestamp: r.timestamp,
		}));
	}

	async backfillOutcomes(updates: BackfillUpdate[]): Promise<void> {
		if (updates.length === 0) return;
		/* Drizzle has no portable batched-UPDATE-by-id construct that
		 * works identically across SQLite and Postgres dialects, so we
		 * issue one UPDATE per row. Backfill batches are small (one
		 * row per successful decision per tick, typically <10) so the
		 * round-trip cost is negligible. If this ever becomes hot, swap
		 * to a single CASE-WHEN UPDATE or per-dialect bulk path. */
		for (const u of updates) {
			await this.db
				.update(agentDecisions)
				.set({
					actualOutcome: JSON.stringify(u.actualOutcome),
					performanceDelta: u.performanceDelta ? JSON.stringify(u.performanceDelta) : null,
				})
				.where(eq(agentDecisions.id, u.id));
		}
	}

	async queryDecisions(filter: AuditFilter): Promise<AuditRecord[]> {
		const limit = filter.limit ?? 100;
		const offset = filter.offset ?? 0;

		/* Translate AuditFilter fields into Drizzle WHERE conditions. Each
		 * field is opt-in -- omitting it means "don't filter on this column". */
		const conditions: SQL[] = [];
		if (filter.sessionId !== undefined) {
			conditions.push(eq(agentDecisions.sessionId, filter.sessionId));
		}
		if (filter.adAccountId !== undefined) {
			conditions.push(eq(agentDecisions.adAccountId, filter.adAccountId));
		}
		if (filter.toolName !== undefined) {
			conditions.push(eq(agentDecisions.toolName, filter.toolName));
		}
		if (filter.riskLevel !== undefined) {
			conditions.push(eq(agentDecisions.riskLevel, filter.riskLevel));
		}
		if (filter.success !== undefined) {
			conditions.push(eq(agentDecisions.success, filter.success));
		}
		if (filter.startDate !== undefined) {
			conditions.push(gte(agentDecisions.timestamp, filter.startDate));
		}
		if (filter.endDate !== undefined) {
			conditions.push(lte(agentDecisions.timestamp, filter.endDate));
		}

		const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;
		const baseQuery = whereExpr
			? this.db.select().from(agentDecisions).where(whereExpr)
			: this.db.select().from(agentDecisions);
		const rows = await baseQuery
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
			actualOutcome: r.actualOutcome ? JSON.parse(r.actualOutcome) : null,
			performanceDelta: r.performanceDelta ? JSON.parse(r.performanceDelta) : null,
			timestamp: r.timestamp,
		}));
	}
}
