/**
 * @module config/types
 * Configuration schema types with Zod validation.
 *
 * Defines the shape and validation rules for all agent configuration,
 * covering LLM provider settings, Meta account details, agent behavior,
 * and database connection parameters.
 */

import { z } from "zod";

/**
 * Zod schema for the complete agent configuration.
 * Validates environment variables and optional config file values.
 */
export const AgentConfigSchema = z.object({
	/** LLM provider to use for reasoning ("claude" or "openai") */
	llmProvider: z
		.enum(["claude", "openai"])
		.default("claude")
		.describe("LLM provider for agent reasoning"),

	/** Specific model identifier (e.g., "claude-opus-4-5", "gpt-4o") */
	llmModel: z.string().default("claude-sonnet-4-20250514").describe("LLM model identifier"),

	/** Anthropic API key (required when llmProvider is "claude") */
	anthropicApiKey: z.string().optional().describe("Anthropic API key for Claude"),

	/** OpenAI API key (required when llmProvider is "openai") */
	openaiApiKey: z.string().optional().describe("OpenAI API key for GPT models"),

	/** Meta ad account ID (e.g., "act_1234567890") */
	metaAdAccountId: z.string().describe("Meta ad account ID to manage"),

	/** Meta access token for API authentication */
	metaAccessToken: z.string().describe("Meta Marketing API access token"),

	/** Interval between agent ticks in milliseconds (default: 1 hour) */
	tickIntervalMs: z
		.number()
		.int()
		.positive()
		.default(3_600_000)
		.describe("Tick interval in milliseconds"),

	/** Maximum OODA iterations per agent run (default: 24) */
	maxIterationsPerRun: z.number().int().positive().default(24).describe("Max iterations per run"),

	/** Maximum retry attempts for transient failures (default: 3) */
	maxRetries: z.number().int().positive().default(3).describe("Max retry attempts"),

	/** Base backoff delay in milliseconds for exponential retry (default: 5000) */
	retryBackoffMs: z.number().int().positive().default(5_000).describe("Base retry backoff in ms"),

	/** Number of days to look back for performance data (default: 7) */
	lookbackDays: z.number().int().positive().default(7).describe("Lookback window in days"),

	/** When true, log actions without executing them (default: false) */
	dryRun: z.boolean().default(false).describe("Dry run mode — log without executing"),

	/** Database type: "sqlite" for local dev, "postgres" for cloud (default: "sqlite") */
	dbType: z.enum(["sqlite", "postgres"]).default("sqlite").describe("Database backend type"),

	/** SQLite file path (used when dbType is "sqlite") */
	sqlitePath: z.string().default("./data/agent.db").describe("SQLite database file path"),

	/** PostgreSQL connection string (required when dbType is "postgres") */
	postgresUrl: z.string().optional().describe("PostgreSQL connection URL"),

	/** Log level for the agent (default: "info") */
	logLevel: z
		.enum(["debug", "info", "warn", "error"])
		.default("info")
		.describe("Logging verbosity level"),
});

/**
 * Fully validated agent configuration type, inferred from the Zod schema.
 * Use this as the single source of truth for configuration throughout the codebase.
 */
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

/**
 * Raw configuration input before validation.
 * Accepts partial values — Zod defaults fill in the rest.
 */
export type AgentConfigInput = z.input<typeof AgentConfigSchema>;
