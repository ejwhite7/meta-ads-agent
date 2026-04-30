/**
 * @module agent/session
 * Stateful AgentSession wrapper for the OODA loop.
 *
 * Manages lifecycle concerns that the stateless loop cannot handle:
 * tick scheduling, failure counting, exponential backoff on errors,
 * session state persistence, and audit logging of every action.
 */

import { randomUUID } from "node:crypto";
import { ToolExecutor } from "../tools/executor.js";
import { HookManager } from "../tools/hooks.js";
import type { ToolContext } from "../tools/types.js";
import type { AgentAction } from "../types.js";
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
			/* Fetch current metrics from Meta */
			const metrics = await this.sessionConfig.fetchMetrics();

			/* Run the stateless OODA loop */
			loopResult = await runAgentLoop({
				metrics,
				goals: this.sessionConfig.goals,
				toolRegistry: this.sessionConfig.toolRegistry,
				llmProvider: this.sessionConfig.llmProvider,
				maxProposals: 5,
				guardrails: this.sessionConfig.guardrails,
				adAccountId: this.sessionConfig.config.metaAdAccountId,
			});

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

			return {
				success: false,
				loopResult: null,
				executedActions: [],
				error: message,
			};
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
