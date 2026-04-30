/**
 * @module tools/executor
 * Tool execution engine with retry logic and hook integration.
 *
 * Wraps tool invocations with exponential backoff retry (3 attempts,
 * 1s / 2s / 4s delays), before/after hook execution, and comprehensive
 * error handling. Every execution attempt is logged for observability.
 */

import type { TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { HookManager } from "./hooks.js";
import type { ToolRegistry } from "./registry.js";
import type { Tool, ToolContext, ToolResult } from "./types.js";
import { ToolExecutionError } from "./types.js";

/**
 * Configuration for the tool executor.
 */
export interface ExecutorConfig {
	/** Maximum number of execution attempts (default: 3) */
	readonly maxAttempts: number;

	/** Base delay in milliseconds for exponential backoff (default: 1000) */
	readonly baseDelayMs: number;

	/** Logger function for execution events (default: console.log) */
	readonly logger: (message: string) => void;
}

/** Default executor configuration */
const DEFAULT_CONFIG: ExecutorConfig = {
	maxAttempts: 3,
	baseDelayMs: 1000,
	logger: console.log,
};

/**
 * Pauses execution for the specified duration.
 *
 * @param ms - Duration in milliseconds
 * @returns Promise that resolves after the delay
 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes tools with retry logic, hook integration, and error handling.
 *
 * The execution flow for each tool invocation:
 * 1. Run before hooks — abort if any hook returns 'skip'
 * 2. Execute the tool (with retry on failure)
 * 3. Run after hooks (errors logged but not propagated)
 * 4. Return the tool result
 *
 * Retry uses exponential backoff: attempt 1 waits 1s, attempt 2 waits 2s,
 * attempt 3 waits 4s. If all attempts fail, a ToolExecutionError is thrown.
 *
 * @example
 * ```ts
 * const executor = new ToolExecutor(registry, hooks, { maxAttempts: 3 });
 * const result = await executor.execute('update_budget', { campaignId: '123', dailyBudget: 50 }, context);
 * ```
 */
export class ToolExecutor {
	/** Tool registry for looking up tools by name */
	private readonly registry: ToolRegistry;

	/** Hook manager for before/after interception */
	private readonly hooks: HookManager;

	/** Executor configuration */
	private readonly config: ExecutorConfig;

	/**
	 * Creates a new ToolExecutor.
	 *
	 * @param registry - Tool registry containing available tools
	 * @param hooks - Hook manager for before/after tool execution hooks
	 * @param config - Optional executor configuration overrides
	 */
	constructor(registry: ToolRegistry, hooks: HookManager, config?: Partial<ExecutorConfig>) {
		this.registry = registry;
		this.hooks = hooks;
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Executes a tool by name with the given parameters and context.
	 *
	 * Runs the full hook + retry pipeline:
	 * 1. Looks up the tool in the registry
	 * 2. Runs before hooks (may skip execution)
	 * 3. Attempts execution with exponential backoff retry
	 * 4. Runs after hooks on success
	 * 5. Returns the tool result
	 *
	 * @param toolName - Name of the tool to execute
	 * @param params - Parameters to pass to the tool (must match the tool's schema)
	 * @param context - Execution context with session info
	 * @returns Promise resolving to the tool's execution result
	 * @throws {Error} If the tool is not found in the registry
	 * @throws {ToolExecutionError} If all retry attempts fail
	 */
	async execute(
		toolName: string,
		params: Record<string, unknown>,
		context: ToolContext,
	): Promise<ToolResult> {
		const tool: Tool<TObject> | undefined = this.registry.get(toolName);
		if (!tool) {
			throw new Error(`Tool "${toolName}" is not registered.`);
		}

		/* Run before hooks — may skip execution */
		const hookResult = await this.hooks.runBeforeHooks(toolName, params);
		if (hookResult === "skip") {
			this.config.logger(`[Executor] Skipping "${toolName}" — before hook requested skip`);
			return {
				success: false,
				data: null,
				message: `Execution of "${toolName}" was skipped by a before hook.`,
			};
		}

		/* Attempt execution with exponential backoff retry */
		let lastError: Error = new Error("Unknown error");

		for (let attempt = 1; attempt <= this.config.maxAttempts; attempt++) {
			try {
				this.config.logger(
					`[Executor] Executing "${toolName}" (attempt ${attempt}/${this.config.maxAttempts})`,
				);

				/* Validate params against the tool's TypeBox schema */
				if (!Value.Check(tool.parameters, params)) {
					const errors = [...Value.Errors(tool.parameters, params)];
					const errorMsg = errors[0]?.message ?? "Invalid parameters";
					return {
						success: false,
						data: null,
						message: errorMsg,
						errorCode: "INVALID_PARAMS",
					};
				}

				const cleanParams = Value.Clean(tool.parameters, structuredClone(params)) as Record<
					string,
					unknown
				>;
				const result = await tool.execute(cleanParams, context);

				/* Run after hooks on success (errors logged, not propagated) */
				await this.hooks.runAfterHooks(toolName, params, result);

				this.config.logger(`[Executor] "${toolName}" succeeded on attempt ${attempt}`);
				return result;
			} catch (err: unknown) {
				lastError = err instanceof Error ? err : new Error(String(err));
				this.config.logger(
					`[Executor] "${toolName}" attempt ${attempt} failed: ${lastError.message}`,
				);

				/* Wait before retrying (skip delay on the last attempt) */
				if (attempt < this.config.maxAttempts) {
					const backoff = this.config.baseDelayMs * 2 ** (attempt - 1);
					this.config.logger(`[Executor] Retrying "${toolName}" in ${backoff}ms`);
					await delay(backoff);
				}
			}
		}

		throw new ToolExecutionError(toolName, this.config.maxAttempts, lastError);
	}
}
