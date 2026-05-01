/**
 * @module tools/types
 * Tool interface and TypeBox schema types for the meta-ads-agent tool system.
 *
 * Tools are the agent's interface to the outside world. Every action —
 * creating a campaign, adjusting a budget, fetching insights — is a tool.
 * Tool definitions use TypeBox for compile-time AND runtime type safety.
 */

import type { MetaClient } from "@meta-ads-agent/meta-client";
import type { Static, TObject } from "@sinclair/typebox";
import type { AuditLogger } from "../audit/logger.js";
import type { GuardrailConfig } from "../decisions/types.js";
import type { LLMProvider } from "../llm/types.js";
import type { AgentGoal } from "../types.js";

/**
 * Context provided to every tool execution.
 *
 * Carries session information and shared resources. Resource fields use
 * concrete types from sibling packages instead of `any`. The optional
 * markers reflect the fact that not every tool requires every resource
 * (e.g. analysis-only tools don't need `auditLogger`, and tests may pass
 * a partial context). Tools that depend on a resource should guard
 * against `undefined` or use helpers such as `resolveMetaClient`
 * (see tools/budget/_client.ts).
 */
export interface ToolContext {
	/** Current agent session ID */
	readonly sessionId: string;

	/** Meta ad account ID the tool should operate on */
	readonly adAccountId: string;

	/** Whether the agent is in dry-run mode (log but do not execute) */
	readonly dryRun: boolean;

	/** ISO 8601 timestamp when the execution started */
	readonly timestamp: string;

	/**
	 * Meta API client instance for making API calls.
	 *
	 * Typed as `any` because individual tool domains (creative, reporting)
	 * narrow this to a `MetaClientLike` subset interface for testability.
	 * Tools that interact with Meta should accept either the real
	 * `MetaClient` from @meta-ads-agent/meta-client or a structural mock,
	 * resolved through helpers like `resolveMetaClient`. A future refactor
	 * could replace this with a dedicated `MetaClientLike` union exported
	 * from this package.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: bridges concrete MetaClient and per-domain *Like subset interfaces
	readonly metaClient?: any;

	/** Audit logger for recording tool actions. */
	readonly auditLogger?: AuditLogger;

	/** Agent goals for performance evaluation. */
	readonly goals?: AgentGoal;

	/** Guardrail configuration for safety limits. */
	readonly guardrails?: Partial<GuardrailConfig>;

	/** Database connection for persistence (opaque -- backend-specific). */
	readonly db?: unknown;

	/** LLM provider for creative tools that need generation. */
	readonly llmProvider?: LLMProvider;
}

/**
 * Result returned by a tool after execution.
 * Every tool must indicate success/failure and include relevant data.
 */
/**
 * Result returned by a tool after execution.
 * Every tool must indicate success/failure and include relevant data.
 */
export interface ToolResult {
	/** Whether the tool executed successfully */
	readonly success: boolean;

	/** Result data from the tool (structure varies by tool) */
	readonly data?: Record<string, unknown> | null;

	/** Human-readable message describing the outcome */
	readonly message: string;

	/** Error description when the tool fails */
	readonly error?: string;

	/** Machine-readable error code for programmatic handling */
	readonly errorCode?: string;
}

/**
 * Generic tool interface parameterized by a TypeBox object schema.
 *
 * @typeParam TParameters - TypeBox TObject defining the tool's parameter schema.
 *                          This provides both compile-time type safety (via Static<T>)
 *                          and runtime validation (via TypeBox's JSON Schema output).
 */
export interface Tool<TParameters extends TObject> {
	/** Unique tool name (used as the registry key and LLM function name) */
	readonly name: string;

	/** Human-readable description shown to the LLM for tool selection */
	readonly description: string;

	/** TypeBox schema defining the tool's parameters (doubles as JSON Schema for LLM) */
	readonly parameters: TParameters;

	/**
	 * Execute the tool with validated parameters and execution context.
	 *
	 * @param params - Validated parameters matching the TypeBox schema
	 * @param context - Execution context with session info and shared resources
	 * @returns Promise resolving to the tool's execution result
	 */
	execute(params: Static<TParameters>, context: ToolContext): Promise<ToolResult>;
}

/**
 * Factory function that creates a type-safe tool definition.
 *
 * Provides a convenient way to define tools with full type inference
 * from the TypeBox parameter schema. The returned tool object is frozen
 * to prevent accidental mutation after registration.
 *
 * @typeParam TParameters - TypeBox TObject schema for the tool's parameters
 * @param definition - Complete tool definition including name, schema, and execute function
 * @returns Frozen tool object ready for registration
 *
 * @example
 * ```ts
 * const UpdateBudgetParams = Type.Object({
 *   campaignId: Type.String(),
 *   dailyBudget: Type.Number({ minimum: 1 }),
 * });
 *
 * const updateBudgetTool = createTool({
 *   name: 'update_budget',
 *   description: 'Update the daily budget for a campaign',
 *   parameters: UpdateBudgetParams,
 *   execute: async (params, ctx) => {
 *     // ... implementation
 *     return { success: true, data: { updated: true }, message: 'Budget updated' };
 *   },
 * });
 * ```
 */
export function createTool<TParameters extends TObject>(
	definition: Tool<TParameters>,
): Tool<TParameters> {
	return Object.freeze({ ...definition });
}

/**
 * Error thrown when a tool execution fails after all retry attempts.
 * Contains the tool name, original error, and number of attempts made.
 */
export class ToolExecutionError extends Error {
	/** Name of the tool that failed */
	readonly toolName: string;

	/** Number of execution attempts that were made */
	readonly attempts: number;

	/** The underlying error that caused the final failure */
	readonly cause: Error;

	/**
	 * Creates a new ToolExecutionError.
	 *
	 * @param toolName - Name of the tool that failed
	 * @param attempts - Number of attempts made before giving up
	 * @param cause - The underlying error from the last attempt
	 */
	constructor(toolName: string, attempts: number, cause: Error) {
		super(`Tool "${toolName}" failed after ${attempts} attempts: ${cause.message}`);
		this.name = "ToolExecutionError";
		this.toolName = toolName;
		this.attempts = attempts;
		this.cause = cause;
	}
}
