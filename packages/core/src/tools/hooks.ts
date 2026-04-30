/**
 * @module tools/hooks
 * Before/after hook system for cross-cutting tool concerns.
 *
 * Hooks enable transparent interception of tool execution without
 * modifying individual tool implementations. Use cases include:
 * - Human approval flows (before hooks that pause for confirmation)
 * - Parameter validation and sanitization
 * - Rate limit checks
 * - Dry-run interception
 * - Audit logging (after hooks)
 * - Telemetry and metrics emission
 */

import type { ToolResult } from "./types.js";

/**
 * Hook invoked before a tool executes.
 *
 * Return void to allow execution to proceed, or return 'skip'
 * to prevent the tool from executing (e.g., dry-run mode, rate limit hit).
 * Throw an error to abort execution with a failure.
 *
 * @param toolName - Name of the tool about to execute
 * @param params - Parameters that will be passed to the tool
 * @returns Promise resolving to void (proceed) or 'skip' (skip execution)
 */
export type BeforeHook = (toolName: string, params: unknown) => Promise<undefined | "skip">;

/**
 * Hook invoked after a tool executes successfully.
 *
 * After hooks receive the tool result and can perform side effects
 * like logging, metrics, or result transformation. Errors thrown
 * in after hooks are logged but do not affect the tool result.
 *
 * @param toolName - Name of the tool that executed
 * @param params - Parameters that were passed to the tool
 * @param result - The tool's execution result
 */
export type AfterHook = (toolName: string, params: unknown, result: ToolResult) => Promise<void>;

/**
 * Manages before and after hooks for tool execution.
 *
 * Hooks can be registered for a specific tool name or for all tools
 * using the wildcard pattern "*". Hooks execute in registration order.
 *
 * @example
 * ```ts
 * const hooks = new HookManager();
 *
 * // Log all tool executions
 * hooks.addAfterHook('*', async (tool, params, result) => {
 *   console.log(`${tool} completed: ${result.success}`);
 * });
 *
 * // Require approval for budget changes
 * hooks.addBeforeHook('update_budget', async (tool, params) => {
 *   if (!await getApproval(params)) return 'skip';
 * });
 * ```
 */
export class HookManager {
	/** Before hooks keyed by tool name (or "*" for wildcard) */
	private readonly beforeHooks: Map<string, BeforeHook[]> = new Map();

	/** After hooks keyed by tool name (or "*" for wildcard) */
	private readonly afterHooks: Map<string, AfterHook[]> = new Map();

	/**
	 * Registers a before hook for a specific tool or all tools.
	 *
	 * @param toolPattern - Tool name to match, or "*" for all tools
	 * @param hook - The before hook function to register
	 */
	addBeforeHook(toolPattern: string, hook: BeforeHook): void {
		const existing = this.beforeHooks.get(toolPattern) ?? [];
		existing.push(hook);
		this.beforeHooks.set(toolPattern, existing);
	}

	/**
	 * Registers an after hook for a specific tool or all tools.
	 *
	 * @param toolPattern - Tool name to match, or "*" for all tools
	 * @param hook - The after hook function to register
	 */
	addAfterHook(toolPattern: string, hook: AfterHook): void {
		const existing = this.afterHooks.get(toolPattern) ?? [];
		existing.push(hook);
		this.afterHooks.set(toolPattern, existing);
	}

	/**
	 * Runs all matching before hooks for a tool execution.
	 *
	 * Executes wildcard ("*") hooks first, then tool-specific hooks,
	 * both in registration order. If any hook returns 'skip', execution
	 * stops and 'skip' is returned immediately.
	 *
	 * @param toolName - Name of the tool being executed
	 * @param params - Parameters being passed to the tool
	 * @returns 'skip' if any hook requests skipping, void otherwise
	 */
	async runBeforeHooks(toolName: string, params: unknown): Promise<undefined | "skip"> {
		const wildcardHooks = this.beforeHooks.get("*") ?? [];
		const specificHooks = this.beforeHooks.get(toolName) ?? [];
		const allHooks = [...wildcardHooks, ...specificHooks];

		for (const hook of allHooks) {
			const result = await hook(toolName, params);
			if (result === "skip") {
				return "skip";
			}
		}
	}

	/**
	 * Runs all matching after hooks for a tool execution.
	 *
	 * Executes wildcard ("*") hooks first, then tool-specific hooks.
	 * Errors in after hooks are caught and logged to stderr — they
	 * never affect the tool result or propagate to the caller.
	 *
	 * @param toolName - Name of the tool that executed
	 * @param params - Parameters that were passed to the tool
	 * @param result - The tool's execution result
	 */
	async runAfterHooks(toolName: string, params: unknown, result: ToolResult): Promise<void> {
		const wildcardHooks = this.afterHooks.get("*") ?? [];
		const specificHooks = this.afterHooks.get(toolName) ?? [];
		const allHooks = [...wildcardHooks, ...specificHooks];

		for (const hook of allHooks) {
			try {
				await hook(toolName, params, result);
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				console.error(`[HookManager] After hook error for "${toolName}": ${message}`);
			}
		}
	}

	/**
	 * Removes all registered hooks. Primarily used in tests.
	 */
	clear(): void {
		this.beforeHooks.clear();
		this.afterHooks.clear();
	}
}
