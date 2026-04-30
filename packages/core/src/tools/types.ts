/**
 * @module tools/types
 * Tool interface and TypeBox schema types for the meta-ads-agent tool system.
 *
 * Tools are the agent's interface to the outside world. Every action —
 * creating a campaign, adjusting a budget, fetching insights — is a tool.
 * Tool definitions use TypeBox for compile-time AND runtime type safety.
 */

import type { Static, TObject } from "@sinclair/typebox";

/**
 * Context provided to every tool execution.
 * Carries session information and shared resources needed by tool implementations.
 */
/**
 * Context provided to every tool execution.
 * Carries session information and shared resources needed by tool implementations.
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

	/** Meta API client instance for making API calls */
	// biome-ignore lint/suspicious/noExplicitAny: ToolContext accepts any MetaClient-compatible object
	readonly metaClient: any;

	/** Audit logger for recording tool actions */
	// biome-ignore lint/suspicious/noExplicitAny: ToolContext accepts any AuditLogger-compatible object
	readonly auditLogger: any;

	/** Agent goals for performance evaluation */
	// biome-ignore lint/suspicious/noExplicitAny: ToolContext accepts any AgentGoal-compatible object
	readonly goals: any;

	/** Guardrail configuration for safety limits */
	// biome-ignore lint/suspicious/noExplicitAny: ToolContext accepts any GuardrailConfig-compatible object
	readonly guardrails: any;

	/** Database connection for persistence */
	// biome-ignore lint/suspicious/noExplicitAny: ToolContext accepts any Database-compatible object
	readonly db?: any;

	/** LLM provider for creative tools that need generation */
	// biome-ignore lint/suspicious/noExplicitAny: ToolContext accepts any LLMProvider-compatible object
	readonly llmProvider?: any;
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
	readonly message?: string;

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
