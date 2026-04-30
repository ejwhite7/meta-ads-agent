/**
 * @module config
 * Configuration loader for the meta-ads-agent.
 *
 * Reads configuration from three sources in priority order:
 * 1. Environment variables (highest priority)
 * 2. Optional config file at ~/.meta-ads-agent/config.json
 * 3. Zod schema defaults (lowest priority)
 *
 * All values are validated through the Zod schema before use,
 * ensuring type safety and catching misconfigurations early.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type AgentConfig, type AgentConfigInput, AgentConfigSchema } from "./types.js";

/**
 * Default path to the optional JSON config file.
 * Located at ~/.meta-ads-agent/config.json for per-user configuration.
 */
const CONFIG_FILE_PATH = join(homedir(), ".meta-ads-agent", "config.json");

/**
 * Maps environment variable names to their corresponding config keys.
 * Only variables with the META_AGENT_ prefix or well-known names are mapped.
 */
const ENV_MAP: Record<string, keyof AgentConfigInput> = {
	LLM_PROVIDER: "llmProvider",
	LLM_MODEL: "llmModel",
	ANTHROPIC_API_KEY: "anthropicApiKey",
	OPENAI_API_KEY: "openaiApiKey",
	META_AD_ACCOUNT_ID: "metaAdAccountId",
	META_ACCESS_TOKEN: "metaAccessToken",
	TICK_INTERVAL_MS: "tickIntervalMs",
	MAX_ITERATIONS_PER_RUN: "maxIterationsPerRun",
	MAX_RETRIES: "maxRetries",
	RETRY_BACKOFF_MS: "retryBackoffMs",
	LOOKBACK_DAYS: "lookbackDays",
	DRY_RUN: "dryRun",
	DB_TYPE: "dbType",
	SQLITE_PATH: "sqlitePath",
	DATABASE_URL: "postgresUrl",
	LOG_LEVEL: "logLevel",
};

/**
 * Reads the optional JSON config file from disk.
 * Returns an empty object if the file does not exist or cannot be parsed.
 *
 * @param filePath - Path to the JSON config file
 * @returns Parsed config object, or empty object on failure
 */
function readConfigFile(filePath: string): Record<string, unknown> {
	if (!existsSync(filePath)) {
		return {};
	}

	try {
		const raw = readFileSync(filePath, "utf-8");
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return {};
	} catch {
		return {};
	}
}

/**
 * Collects configuration values from environment variables.
 * Converts numeric and boolean string values to their proper types.
 *
 * @returns Partial config object with values found in the environment
 */
function readEnvVars(): Partial<AgentConfigInput> {
	const result: Record<string, unknown> = {};

	for (const [envKey, configKey] of Object.entries(ENV_MAP)) {
		const value = process.env[envKey];
		if (value === undefined) continue;

		/* Convert numeric env vars to numbers */
		if (
			[
				"tickIntervalMs",
				"maxIterationsPerRun",
				"maxRetries",
				"retryBackoffMs",
				"lookbackDays",
			].includes(configKey)
		) {
			const num = Number(value);
			if (!Number.isNaN(num)) {
				result[configKey] = num;
			}
			continue;
		}

		/* Convert boolean env vars */
		if (configKey === "dryRun") {
			result[configKey] = value === "true" || value === "1";
			continue;
		}

		result[configKey] = value;
	}

	return result as Partial<AgentConfigInput>;
}

/**
 * Loads and validates the agent configuration.
 *
 * Merges values from three sources (env vars override config file, which overrides defaults),
 * then validates the merged result through the Zod schema. Throws a descriptive error if
 * required values are missing or invalid.
 *
 * @param overrides - Optional programmatic overrides (highest priority, useful for tests)
 * @returns Fully validated AgentConfig
 * @throws {Error} When validation fails — message includes all Zod issue details
 */
export function loadConfig(overrides?: Partial<AgentConfigInput>): AgentConfig {
	const fileConfig = readConfigFile(CONFIG_FILE_PATH);
	const envConfig = readEnvVars();

	const merged = {
		...fileConfig,
		...envConfig,
		...(overrides ?? {}),
	};

	const result = AgentConfigSchema.safeParse(merged);

	if (!result.success) {
		const issues = result.error.issues
			.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
			.join("\n");
		throw new Error(`Invalid agent configuration:\n${issues}`);
	}

	return result.data;
}

export { AgentConfigSchema, type AgentConfig, type AgentConfigInput } from "./types.js";
