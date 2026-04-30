/**
 * `meta-ads-agent config` command group.
 *
 * Subcommands:
 *   show      Display current configuration (sensitive values are masked).
 *   set       Update a single configuration key.
 *   validate  Check that all required configuration values are present.
 *
 * Configuration is stored in ~/.meta-ads-agent/config.json.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import { error, printTable, section, success } from "../utils/display.js";
import { handleError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

/** Filesystem path to the configuration file. */
const CONFIG_PATH = join(homedir(), ".meta-ads-agent", "config.json");

/** Keys whose values should be masked in display output. */
const SENSITIVE_KEYS = new Set(["metaAccessToken", "anthropicApiKey", "openaiApiKey"]);

/** Required top-level keys for a valid configuration. */
const REQUIRED_KEYS = ["metaAccessToken", "metaAdAccountId", "llmProvider", "agent"];

/**
 * Load the configuration file from disk.
 * Returns null if the file does not exist.
 */
function loadConfig(): Record<string, unknown> | null {
	if (!existsSync(CONFIG_PATH)) return null;
	const raw = readFileSync(CONFIG_PATH, "utf-8");
	return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Save a configuration object to disk.
 */
function saveConfig(config: Record<string, unknown>): void {
	writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), {
		encoding: "utf-8",
		mode: 0o600,
	});
}

/**
 * Mask a sensitive value for display (show first 4 and last 4 characters).
 */
function maskValue(value: string): string {
	if (value.length <= 8) return "****";
	return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

/**
 * Flatten a nested object into dot-separated key-value pairs.
 */
function flattenConfig(
	obj: Record<string, unknown>,
	prefix = "",
): Array<{ key: string; value: string }> {
	const entries: Array<{ key: string; value: string }> = [];

	for (const [key, value] of Object.entries(obj)) {
		const fullKey = prefix ? `${prefix}.${key}` : key;

		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			entries.push(...flattenConfig(value as Record<string, unknown>, fullKey));
		} else {
			const displayValue =
				SENSITIVE_KEYS.has(key) && typeof value === "string" ? maskValue(value) : String(value);
			entries.push({ key: fullKey, value: displayValue });
		}
	}

	return entries;
}

/**
 * Set a value at a dot-separated path in a nested object.
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
	const parts = path.split(".");
	let current: Record<string, unknown> = obj;

	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (!(part in current) || typeof current[part] !== "object") {
			current[part] = {};
		}
		current = current[part] as Record<string, unknown>;
	}

	const lastKey = parts[parts.length - 1];

	// Attempt numeric coercion for goal values.
	const numericValue = Number(value);
	current[lastKey] = Number.isNaN(numericValue) ? value : numericValue;
}

/**
 * Register the `config` command group on the root program.
 */
export function registerConfigCommand(program: Command): void {
	const configCmd = program.command("config").description("View or edit agent configuration");

	// config show
	configCmd
		.command("show")
		.description("Display current configuration (sensitive values masked)")
		.action(() => {
			try {
				const config = loadConfig();
				if (!config) {
					error("No configuration found. Run `meta-ads-agent init` first.");
					process.exitCode = 1;
					return;
				}

				section("Configuration");
				const rows = flattenConfig(config).map((e) => ({
					Key: e.key,
					Value: e.value,
				}));
				printTable(rows, ["Key", "Value"]);
			} catch (err: unknown) {
				handleError(err);
				process.exitCode = 1;
			}
		});

	// config set <key> <value>
	configCmd
		.command("set <key> <value>")
		.description("Update a configuration value (use dot notation for nested keys)")
		.action((key: string, value: string) => {
			try {
				const config = loadConfig();
				if (!config) {
					error("No configuration found. Run `meta-ads-agent init` first.");
					process.exitCode = 1;
					return;
				}

				setNestedValue(config, key, value);
				saveConfig(config);
				success(`Set ${key} successfully.`);
			} catch (err: unknown) {
				handleError(err);
				process.exitCode = 1;
			}
		});

	// config validate
	configCmd
		.command("validate")
		.description("Check that all required configuration values are present")
		.action(() => {
			try {
				const config = loadConfig();
				if (!config) {
					error("No configuration found. Run `meta-ads-agent init` first.");
					process.exitCode = 1;
					return;
				}

				const missing: string[] = [];
				for (const key of REQUIRED_KEYS) {
					if (!(key in config) || config[key] === "" || config[key] === null) {
						missing.push(key);
					}
				}

				// Check nested goals
				if (config.goals && typeof config.goals === "object") {
					const goals = config.goals as Record<string, unknown>;
					for (const goalKey of ["roasTarget", "cpaCap", "dailyBudgetLimit", "riskLevel"]) {
						if (!(goalKey in goals) || goals[goalKey] === null) {
							missing.push(`goals.${goalKey}`);
						}
					}
				}

				if (missing.length > 0) {
					error(`Missing required configuration keys:\n  ${missing.join("\n  ")}`);
					logger.info("Run `meta-ads-agent init` to set up all required values.");
					process.exitCode = 1;
				} else {
					success("Configuration is valid. All required keys are present.");
				}
			} catch (err: unknown) {
				handleError(err);
				process.exitCode = 1;
			}
		});
}
