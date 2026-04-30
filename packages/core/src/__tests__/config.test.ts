/**
 * @module __tests__/config.test
 * Unit tests for the configuration loader.
 *
 * Tests loading config from environment variables, validation of required
 * fields, Zod schema defaults, and error handling for invalid configurations.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../config/index.js";

describe("loadConfig", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		/* Reset env to a clean state */
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("should load config with all required fields via overrides", () => {
		const config = loadConfig({
			metaAdAccountId: "act_123",
			metaAccessToken: "token_abc",
		});

		expect(config.metaAdAccountId).toBe("act_123");
		expect(config.metaAccessToken).toBe("token_abc");
		expect(config.llmProvider).toBe("claude");
		expect(config.dryRun).toBe(false);
	});

	it("should apply default values for optional fields", () => {
		const config = loadConfig({
			metaAdAccountId: "act_123",
			metaAccessToken: "token_abc",
		});

		expect(config.tickIntervalMs).toBe(3_600_000);
		expect(config.maxIterationsPerRun).toBe(24);
		expect(config.maxRetries).toBe(3);
		expect(config.retryBackoffMs).toBe(5_000);
		expect(config.lookbackDays).toBe(7);
		expect(config.dryRun).toBe(false);
		expect(config.dbType).toBe("sqlite");
		expect(config.sqlitePath).toBe("./data/agent.db");
		expect(config.logLevel).toBe("info");
	});

	it("should read from environment variables", () => {
		process.env.META_AD_ACCOUNT_ID = "act_env_456";
		process.env.META_ACCESS_TOKEN = "token_env";
		process.env.LLM_PROVIDER = "openai";
		process.env.DRY_RUN = "true";
		process.env.TICK_INTERVAL_MS = "60000";

		const config = loadConfig();

		expect(config.metaAdAccountId).toBe("act_env_456");
		expect(config.metaAccessToken).toBe("token_env");
		expect(config.llmProvider).toBe("openai");
		expect(config.dryRun).toBe(true);
		expect(config.tickIntervalMs).toBe(60000);
	});

	it("should prioritize overrides over environment variables", () => {
		process.env.META_AD_ACCOUNT_ID = "act_from_env";
		process.env.META_ACCESS_TOKEN = "token_env";

		const config = loadConfig({
			metaAdAccountId: "act_from_override",
			metaAccessToken: "token_override",
		});

		expect(config.metaAdAccountId).toBe("act_from_override");
		expect(config.metaAccessToken).toBe("token_override");
	});

	it("should throw on missing required fields", () => {
		/* metaAdAccountId and metaAccessToken are required */
		expect(() => loadConfig()).toThrow("Invalid agent configuration");
	});

	it("should throw on invalid llmProvider value", () => {
		expect(() =>
			loadConfig({
				metaAdAccountId: "act_123",
				metaAccessToken: "token",
				llmProvider: "invalid_provider" as "claude",
			}),
		).toThrow("Invalid agent configuration");
	});

	it("should accept valid dbType values", () => {
		const sqliteConfig = loadConfig({
			metaAdAccountId: "act_123",
			metaAccessToken: "token",
			dbType: "sqlite",
		});
		expect(sqliteConfig.dbType).toBe("sqlite");

		const pgConfig = loadConfig({
			metaAdAccountId: "act_123",
			metaAccessToken: "token",
			dbType: "postgres",
		});
		expect(pgConfig.dbType).toBe("postgres");
	});

	it("should parse numeric env vars correctly", () => {
		process.env.META_AD_ACCOUNT_ID = "act_123";
		process.env.META_ACCESS_TOKEN = "token";
		process.env.MAX_RETRIES = "5";
		process.env.LOOKBACK_DAYS = "14";

		const config = loadConfig();

		expect(config.maxRetries).toBe(5);
		expect(config.lookbackDays).toBe(14);
	});

	it("should parse boolean env vars correctly", () => {
		process.env.META_AD_ACCOUNT_ID = "act_123";
		process.env.META_ACCESS_TOKEN = "token";
		process.env.DRY_RUN = "1";

		const config = loadConfig();
		expect(config.dryRun).toBe(true);

		process.env.DRY_RUN = "false";
		const config2 = loadConfig();
		expect(config2.dryRun).toBe(false);
	});
});
