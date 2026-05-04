/**
 * @module agent/session
 * Stateful AgentSession wrapper for the OODA loop.
 *
 * Manages lifecycle concerns that the stateless loop cannot handle:
 * tick scheduling, failure counting, exponential backoff on errors,
 * session state persistence, and audit logging of every action.
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { agentSessions } from "../db/schema.js";
import { ToolExecutor } from "../tools/executor.js";
import { HookManager } from "../tools/hooks.js";
import type { ToolContext } from "../tools/types.js";
import type { AdMetrics, AdSetMetrics, AgentAction } from "../types.js";
import { runAgentLoop } from "./loop.js";
import type { AgentLoopResult, AgentSessionConfig, SessionResult, SessionStatus } from "./types.js";

/**
 * Stateful agent session that wraps the stateless OODA loop.
 *
 * Handles all lifecycle management:
 * - Scheduled tick execution on a configurable interval
 * - Consecutive failure tracking with exponential backoff
 * - Graceful start/stop lifecycle
 * - Audit logging of every decision and action
 * - Session state persistence for crash recovery
 *
 * @example
 * ```ts
 * const session = new AgentSession({
 *   config, toolRegistry, llmProvider, auditLogger, goals, fetchMetrics,
 * });
 *
 * await session.start();  // Begins scheduled OODA ticks
 * // ... later
 * await session.stop();   // Graceful shutdown
 * ```
 */
export class AgentSession {
	/** Unique identifier for this session */
	private readonly sessionId: string;

	/** Session configuration and injected dependencies */
	private readonly sessionConfig: AgentSessionConfig;

	/** Tool executor with retry logic and hooks */
	private readonly executor: ToolExecutor;

	/** Hook manager for tool execution */
	private readonly hooks: HookManager;

	/** Current session state */
	private state: "idle" | "running" | "paused" | "stopped" | "error" = "idle";

	/** Number of completed OODA iterations */
	private iterationCount = 0;

	/** Number of consecutive failures (resets on success) */
	private consecutiveFailures = 0;

	/** Maximum consecutive failures before entering error state */
	private readonly maxConsecutiveFailures: number;

	/** Timer handle for scheduled ticks (null when not running) */
	private tickTimer: ReturnType<typeof setTimeout> | null = null;

	/** ISO timestamp of the last successful tick */
	private lastTickAt: string | null = null;

	/** Last error message (null if last tick succeeded) */
	private lastError: string | null = null;

	/**
	 * Creates a new AgentSession.
	 *
	 * @param config - Session configuration with all required dependencies
	 */
	constructor(config: AgentSessionConfig) {
		this.sessionId = randomUUID();
		this.sessionConfig = config;
		this.hooks = new HookManager();
		this.executor = new ToolExecutor(config.toolRegistry, this.hooks, {
			maxAttempts: config.config.maxRetries,
		});
		this.maxConsecutiveFailures = config.config.maxRetries;

		/* Persist a row in `agent_sessions` so /api/status, the dashboard,
		 * and `meta-ads-agent status` can see the session exists. Pre-this-PR
		 * NOBODY ever inserted into agent_sessions, so the table stayed
		 * empty and /api/status always reported `state: "stopped"` even
		 * with a live daemon writing audit rows. Best-effort: if the DB
		 * write fails we log and continue — the agent's correctness does
		 * not depend on the session row, only the audit log does. */
		if (config.db) {
			const now = new Date().toISOString();
			try {
				void config.db
					.insert(agentSessions)
					.values({
						id: this.sessionId,
						adAccountId: config.config.metaAdAccountId,
						state: "idle",
						iterationCount: 0,
						consecutiveFailures: 0,
						lastTickAt: null,
						lastError: null,
						createdAt: now,
						updatedAt: now,
					})
					.then(undefined, (err: unknown) => {
						const msg = err instanceof Error ? err.message : String(err);
						console.warn(`[AgentSession] Failed to persist session row: ${msg}`);
					});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.warn(`[AgentSession] Failed to persist session row: ${msg}`);
			}
		}

		/* Halt the agent when the audit log has failed too many times in a row.
		 * The audit trail is the system of record per CLAUDE.md §6 -- if we
		 * cannot persist decisions, we must not continue making them. */
		config.auditLogger.onFailure((record, err) => {
			const failures = config.auditLogger.getConsecutiveFailures();
			if (failures >= 3 && this.state !== "error" && this.state !== "stopped") {
				console.error(
					`[AgentSession] Halting due to ${failures} consecutive audit-log failures. ` +
						`Last error: ${err.message}. Last record toolName=${record.toolName}.`,
				);
				this.state = "error";
				this.lastError = `Audit log unavailable: ${err.message}`;
				if (this.tickTimer) {
					clearTimeout(this.tickTimer);
					this.tickTimer = null;
				}
			}
		});
	}

	/**
	 * Starts the agent session with scheduled tick execution.
	 *
	 * Runs the first tick immediately, then schedules subsequent ticks
	 * at the configured interval. If the session is already running,
	 * this method is a no-op.
	 */
	async start(): Promise<void> {
		if (this.state === "running") return;

		this.state = "running";
		this.persistSessionState();

		/* Run the first tick immediately */
		await this.executeTick();

		/* Schedule subsequent ticks */
		this.scheduleTick();
	}

	/**
	 * Stops the agent session gracefully.
	 *
	 * Cancels any scheduled ticks and sets the state to stopped.
	 * In-flight operations are allowed to complete, but no new ticks
	 * will be started.
	 */
	async stop(): Promise<void> {
		this.state = "stopped";

		if (this.tickTimer) {
			clearTimeout(this.tickTimer);
			this.tickTimer = null;
		}
		this.persistSessionState();
	}

	/**
	 * Runs a single OODA tick without scheduling subsequent ticks.
	 *
	 * Useful for testing, debugging, and ad-hoc one-shot runs.
	 * Does not change the session state or set up a timer.
	 *
	 * @returns Result of the single tick execution
	 */
	async runOnce(): Promise<SessionResult> {
		return this.executeTick();
	}

	/**
	 * Returns the current session status for API/dashboard consumption.
	 *
	 * @returns Current session status snapshot
	 */
	getStatus(): SessionStatus {
		const nextTickAt =
			this.state === "running" && this.lastTickAt
				? new Date(
						new Date(this.lastTickAt).getTime() + this.sessionConfig.config.tickIntervalMs,
					).toISOString()
				: null;

		return {
			sessionId: this.sessionId,
			state: this.state,
			iterationCount: this.iterationCount,
			consecutiveFailures: this.consecutiveFailures,
			lastTickAt: this.lastTickAt,
			nextTickAt,
			lastError: this.lastError,
		};
	}

	/**
	 * Executes a single OODA tick: fetches metrics, runs the loop,
	 * executes approved actions, and logs everything.
	 *
	 * @returns Result of this tick's execution
	 */
	private async executeTick(): Promise<SessionResult> {
		const executedActions: AgentAction[] = [];
		let loopResult: AgentLoopResult | null = null;

		try {
			/* Fetch current metrics from Meta at all three hierarchy levels
			 * in parallel. Ad-set and ad fetches are optional in the config
			 * (legacy fixtures may not provide them); when omitted we just
			 * skip the corresponding snapshot/prompt enrichment. */
			const [metrics, adSetMetricsRaw, adMetricsRaw] = await Promise.all([
				this.sessionConfig.fetchMetrics(),
				this.sessionConfig.fetchAdSetMetrics?.() ?? Promise.resolve([] as AdSetMetrics[]),
				this.sessionConfig.fetchAdMetrics?.() ?? Promise.resolve([] as AdMetrics[]),
			]);
			const adSetMetrics: AdSetMetrics[] = adSetMetricsRaw;
			const adMetrics: AdMetrics[] = adMetricsRaw;

			/* Persist snapshots BEFORE running the loop so the dashboard
			 * reflects the same data the agent is about to reason over.
			 * Each level is persisted independently so a failure at one
			 * level (e.g. ad-set table missing on a legacy DB pre-bootstrap)
			 * does not block the others. */
			if (this.sessionConfig.snapshotWriter) {
				const writer = this.sessionConfig.snapshotWriter;
				const accountId = this.sessionConfig.config.metaAdAccountId;
				const writes: Array<[string, () => Promise<void>]> = [
					["campaign", () => writer.writeSnapshots(metrics, accountId)],
					["adset", () => writer.writeAdSetSnapshots(adSetMetrics, accountId)],
					["ad", () => writer.writeAdSnapshots(adMetrics, accountId)],
				];
				for (const [level, write] of writes) {
					try {
						await write();
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						console.warn(`[AgentSession] Failed to persist ${level} snapshots: ${msg}`);
					}
				}
			}

			/* Backfill outcomes for prior-tick decisions BEFORE running the
			 * loop. Order matters: the snapshot we just wrote becomes the
			 * `actual_outcome` for any decision made on the previous tick,
			 * and we want the loop to reason over fully-graded history if
			 * future tools query it. Failures are logged and swallowed --
			 * stale outcome data is strictly better than aborting the tick. */
			if (this.sessionConfig.backfillEngine && metrics.length > 0) {
				try {
					const summary = await this.sessionConfig.backfillEngine.run(
						metrics,
						this.sessionConfig.config.metaAdAccountId,
					);
					if (summary.backfilledCount > 0 || summary.errored > 0) {
						console.log(
							`[AgentSession] Backfill: ${summary.backfilledCount}/${summary.pendingCount} ` +
								`updated (skipped: ${summary.skippedNoCurrentMetrics} no-current, ` +
								`${summary.skippedNoCampaignId} no-campaign-id, errored: ${summary.errored})`,
						);
					}
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					console.warn(`[AgentSession] Backfill engine failed: ${msg}`);
				}
			}

			/* Build the campaignId -> objective map so the loop can detect
			 * objective drift. Any failure here is non-fatal -- the loop
			 * just won't be able to detect drift this tick. */
			const campaignObjectives = new Map<
				string,
				{ name: string; objective: string; status: string; dailyBudget: number | null }
			>();
			try {
				const metaClient = this.sessionConfig.metaClient as
					| { campaigns?: { list?: (id: string) => Promise<unknown[]> } }
					| undefined;
				if (metaClient?.campaigns?.list) {
					const rawList = (await metaClient.campaigns.list(
						this.sessionConfig.config.metaAdAccountId,
					)) as Array<{
						id?: string;
						name?: string;
						objective?: string;
						status?: string;
						daily_budget?: string;
					}>;
					for (const c of rawList) {
						if (!c.id) continue;
						const budgetCents = c.daily_budget ? Number.parseInt(c.daily_budget, 10) : Number.NaN;
						campaignObjectives.set(c.id, {
							name: c.name ?? c.id,
							objective: c.objective ?? "unknown",
							status: c.status ?? "unknown",
							dailyBudget: Number.isFinite(budgetCents) ? budgetCents / 100 : null,
						});
					}
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.warn(`[AgentSession] Failed to load campaign list for goal lookup: ${msg}`);
			}

			/* Run the stateless OODA loop. Pass through ad-set and ad metrics
			 * so the loop can include them in the LLM prompt and reason about
			 * the full hierarchy, not just campaign rollups. */
			loopResult = await runAgentLoop({
				metrics,
				adSetMetrics,
				adMetrics,
				goals: this.sessionConfig.goals,
				toolRegistry: this.sessionConfig.toolRegistry,
				llmProvider: this.sessionConfig.llmProvider,
				maxProposals: 5,
				guardrails: this.sessionConfig.guardrails,
				adAccountId: this.sessionConfig.config.metaAdAccountId,
				goalRepository: this.sessionConfig.goalRepository,
				campaignObjectives,
			});

			/* Persist pending-guidance entries so the operator sees them via
			 * `meta-ads-agent decisions` and the dashboard. We use a
			 * distinctive synthetic toolName (`_pending_guidance`) so they
			 * stand out from real tool invocations. */
			for (const pg of loopResult.pendingGuidance ?? []) {
				await this.sessionConfig.auditLogger.logDecision({
					sessionId: this.sessionId,
					adAccountId: this.sessionConfig.config.metaAdAccountId,
					toolName: "_pending_guidance",
					params: {
						campaignId: pg.campaignId,
						campaignName: pg.campaignName,
						currentObjective: pg.currentObjective,
						status: pg.status,
						dailyBudget: pg.dailyBudget,
						reason: pg.reason,
						...(pg.previousObjective ? { previousObjective: pg.previousObjective } : {}),
					},
					reasoning: `Campaign "${pg.campaignName}" requires guidance: ${pg.reason}.`,
					expectedOutcome: "PENDING_GUIDANCE",
					score: 0,
					riskLevel: "high",
					success: false,
					resultData: null,
					errorMessage:
						"Configure a goal via `meta-ads-agent guidance` (CLI) or the dashboard before the agent will act on this campaign.",
				});
			}

			/* Execute approved actions via the tool executor */
			const toolContext: ToolContext = {
				sessionId: this.sessionId,
				adAccountId: this.sessionConfig.config.metaAdAccountId,
				dryRun: this.sessionConfig.config.dryRun,
				timestamp: new Date().toISOString(),
				metaClient: this.sessionConfig.metaClient,
				auditLogger: this.sessionConfig.auditLogger,
				goals: this.sessionConfig.goals,
				guardrails: this.sessionConfig.guardrails,
			};

			/* Persist any pending (human-approval-required) actions to the audit
			 * log so the dashboard and operators can see what the agent wanted
			 * to do. They are recorded with success=false and a distinctive
			 * tool name so they are easy to filter on. */
			for (const pending of loopResult.pendingActions ?? []) {
				await this.sessionConfig.auditLogger.logDecision({
					sessionId: this.sessionId,
					adAccountId: this.sessionConfig.config.metaAdAccountId,
					toolName: pending.toolName,
					params: pending.params,
					reasoning: pending.reason,
					expectedOutcome: "PENDING_HUMAN_APPROVAL",
					score: 0,
					riskLevel: "high",
					success: false,
					resultData: { pendingId: pending.id },
					errorMessage: "Awaiting human approval",
				});
			}

			for (const proposal of loopResult.proposals) {
				try {
					const result = await this.executor.execute(
						proposal.toolName,
						proposal.params,
						toolContext,
					);

					const action: AgentAction = {
						toolName: proposal.toolName,
						params: proposal.params,
						reasoning: proposal.reasoning,
						expectedImpact: proposal.expectedOutcome,
					};
					executedActions.push(action);

					/* Log the decision to the audit trail */
					await this.sessionConfig.auditLogger.logDecision({
						sessionId: this.sessionId,
						adAccountId: this.sessionConfig.config.metaAdAccountId,
						toolName: proposal.toolName,
						params: proposal.params,
						reasoning: proposal.reasoning,
						expectedOutcome: proposal.expectedOutcome,
						score: proposal.score,
						riskLevel: proposal.riskLevel,
						success: result.success,
						resultData: result.data ?? null,
						errorMessage: result.success ? null : (result.message ?? null),
					});
				} catch (err: unknown) {
					const message = err instanceof Error ? err.message : String(err);

					/* Log failed action to audit trail */
					await this.sessionConfig.auditLogger.logDecision({
						sessionId: this.sessionId,
						adAccountId: this.sessionConfig.config.metaAdAccountId,
						toolName: proposal.toolName,
						params: proposal.params,
						reasoning: proposal.reasoning,
						expectedOutcome: proposal.expectedOutcome,
						score: proposal.score,
						riskLevel: proposal.riskLevel,
						success: false,
						resultData: null,
						errorMessage: message,
					});
				}
			}

			/* Success — reset failure counter */
			this.consecutiveFailures = 0;
			this.lastTickAt = new Date().toISOString();
			this.lastError = null;
			this.iterationCount++;
			this.persistSessionState();

			return {
				success: true,
				loopResult,
				executedActions,
				error: null,
			};
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			this.consecutiveFailures++;
			this.lastError = message;

			/* Enter error state if too many consecutive failures */
			if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
				this.state = "error";
				if (this.tickTimer) {
					clearTimeout(this.tickTimer);
					this.tickTimer = null;
				}
			}
			this.persistSessionState();

			return {
				success: false,
				loopResult: null,
				executedActions: [],
				error: message,
			};
		}
	}

	/**
	 * Best-effort UPDATE of the agent_sessions row created in the
	 * constructor. Called after every state-changing operation so the
	 * dashboard's `/api/status` endpoint sees fresh data. Failures
	 * are logged but never thrown — the audit log is the system of
	 * record, not this row.
	 */
	private persistSessionState(): void {
		if (!this.sessionConfig.db) return;
		const now = new Date().toISOString();
		try {
			void this.sessionConfig.db
				.update(agentSessions)
				.set({
					state: this.state,
					iterationCount: this.iterationCount,
					consecutiveFailures: this.consecutiveFailures,
					lastTickAt: this.lastTickAt,
					lastError: this.lastError,
					updatedAt: now,
				})
				.where(eq(agentSessions.id, this.sessionId))
				.then(undefined, (err: unknown) => {
					const msg = err instanceof Error ? err.message : String(err);
					console.warn(`[AgentSession] Failed to update session row: ${msg}`);
				});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[AgentSession] Failed to update session row: ${msg}`);
		}
	}

	/**
	 * Schedules the next tick with backoff on consecutive failures.
	 *
	 * Uses the configured tick interval as the base, adding exponential
	 * backoff for consecutive failures to avoid hammering failing services.
	 */
	private scheduleTick(): void {
		if (this.state !== "running") return;

		const baseInterval = this.sessionConfig.config.tickIntervalMs;
		const backoff =
			this.consecutiveFailures > 0
				? Math.min(
						baseInterval,
						this.sessionConfig.config.retryBackoffMs * 2 ** (this.consecutiveFailures - 1),
					)
				: 0;
		const interval = baseInterval + backoff;

		this.tickTimer = setTimeout(async () => {
			if (this.state !== "running") return;

			await this.executeTick();
			this.scheduleTick();
		}, interval);
	}
}
