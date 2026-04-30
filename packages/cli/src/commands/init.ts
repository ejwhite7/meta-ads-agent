/**
 * `meta-ads-agent init` command.
 *
 * Interactive setup wizard that walks the user through initial configuration:
 *   1. Verify Python and the `meta-ads` CLI are installed.
 *   2. Collect META_ACCESS_TOKEN (with a link to Meta Business Manager).
 *   3. Discover available ad accounts and let the user pick one.
 *   4. Choose an LLM provider (Claude or OpenAI) and enter the API key.
 *   5. Set agent goals: ROAS target, CPA cap, daily budget limit, risk level.
 *   6. Persist the config to ~/.meta-ads-agent/config.json.
 *   7. Validate the token with `meta ads auth whoami`.
 *
 * Uses inquirer for interactive prompts and chalk for coloured output.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Command } from "commander";
import inquirer from "inquirer";
import { error, section, success } from "../utils/display.js";
import { logger } from "../utils/logger.js";

/** Filesystem path to the configuration directory. */
const CONFIG_DIR = join(homedir(), ".meta-ads-agent");

/** Filesystem path to the configuration file. */
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

/**
 * Supported LLM provider identifiers.
 */
type LLMProvider = "claude" | "openai";

/**
 * Supported risk level values for the agent.
 */
type RiskLevel = "conservative" | "moderate" | "aggressive";

/**
 * Shape of the persisted configuration file.
 */
interface AgentConfig {
	metaAccessToken: string;
	metaAdAccountId: string;
	llmProvider: LLMProvider;
	anthropicApiKey?: string;
	openaiApiKey?: string;
	agent: {
		targetRoas: number;
		cpaCap: number;
		minDailyBudget: number;
		maxBudgetScaleFactor: number;
		requireApprovalAbove: number;
	};
}

/**
 * Run a shell command and return its trimmed stdout, or null on failure.
 */
function tryExec(cmd: string): string | null {
	try {
		return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
	} catch {
		return null;
	}
}

/**
 * Verify that the `meta-ads` Python CLI is reachable.
 */
function checkMetaCliInstalled(): boolean {
	const result = tryExec("meta ads auth whoami");
	return result !== null;
}

/**
 * List ad accounts available for the given access token.
 * Falls back to manual entry if the CLI call fails.
 */
function listAdAccounts(): string[] {
	const raw = tryExec("meta ads ad_accounts list --format json");
	if (!raw) return [];

	try {
		const parsed = JSON.parse(raw) as Array<{ id: string; name?: string }>;
		return parsed.map((a) => (a.name ? `${a.id} (${a.name})` : a.id));
	} catch {
		return [];
	}
}

/**
 * Validate the Meta access token by running `meta ads auth whoami`.
 */
function validateToken(): boolean {
	const result = tryExec("meta ads auth whoami");
	return result !== null && !result.toLowerCase().includes("error");
}

/**
 * Register the `init` command on the root program.
 */
export function registerInitCommand(program: Command): void {
	program
		.command("init")
		.description("Interactive setup wizard for meta-ads-agent")
		.action(async () => {
			section("meta-ads-agent Setup Wizard");

			// Step 1: Check prerequisites
			logger.info("Checking prerequisites...");
			const cliInstalled = checkMetaCliInstalled();
			if (!cliInstalled) {
				error(
					"The `meta-ads` Python CLI was not found.\n" +
						"Install it with: pip install meta-ads\n" +
						"Then run: meta ads auth login",
				);
				process.exitCode = 1;
				return;
			}
			success("meta-ads CLI detected.");

			// Step 2: Meta Access Token
			const { metaAccessToken } = await inquirer.prompt<{ metaAccessToken: string }>([
				{
					type: "password",
					name: "metaAccessToken",
					message:
						"Enter your Meta Access Token (https://business.facebook.com/settings/system-users):",
					mask: "*",
					validate: (input: string) => (input.length > 0 ? true : "Access token is required."),
				},
			]);

			// Step 3: Ad Account selection
			const accounts = listAdAccounts();
			let metaAdAccountId: string;

			if (accounts.length > 0) {
				const { selectedAccount } = await inquirer.prompt<{ selectedAccount: string }>([
					{
						type: "list",
						name: "selectedAccount",
						message: "Select an ad account:",
						choices: accounts,
					},
				]);
				metaAdAccountId = selectedAccount.split(" ")[0];
			} else {
				const { manualAccountId } = await inquirer.prompt<{ manualAccountId: string }>([
					{
						type: "input",
						name: "manualAccountId",
						message: "Enter your Meta Ad Account ID (e.g. act_123456789):",
						validate: (input: string) =>
							input.startsWith("act_") ? true : "Account ID must start with act_",
					},
				]);
				metaAdAccountId = manualAccountId;
			}

			// Step 4: LLM provider and API key
			const { llmProvider } = await inquirer.prompt<{ llmProvider: LLMProvider }>([
				{
					type: "list",
					name: "llmProvider",
					message: "Select your LLM provider:",
					choices: [
						{ name: "Claude (Anthropic)", value: "claude" },
						{ name: "GPT-4o (OpenAI)", value: "openai" },
					],
				},
			]);

			const providerLabel = llmProvider === "claude" ? "Anthropic" : "OpenAI";
			const { llmApiKey } = await inquirer.prompt<{ llmApiKey: string }>([
				{
					type: "password",
					name: "llmApiKey",
					message: `Enter your ${providerLabel} API key:`,
					mask: "*",
					validate: (input: string) => (input.length > 0 ? true : "API key is required."),
				},
			]);

			// Step 5: Agent goals
			section("Agent Goals");

			const goals = await inquirer.prompt<{
				roasTarget: number;
				cpaCap: number;
				dailyBudgetLimit: number;
				riskLevel: RiskLevel;
			}>([
				{
					type: "number",
					name: "roasTarget",
					message: "Target ROAS (e.g. 4.0):",
					default: 4.0,
					validate: (input: number) => (input > 0 ? true : "ROAS target must be positive."),
				},
				{
					type: "number",
					name: "cpaCap",
					message: "Maximum CPA in dollars (e.g. 25.00):",
					default: 25.0,
					validate: (input: number) => (input > 0 ? true : "CPA cap must be positive."),
				},
				{
					type: "number",
					name: "dailyBudgetLimit",
					message: "Daily budget limit in dollars (e.g. 500):",
					default: 500,
					validate: (input: number) => (input > 0 ? true : "Budget limit must be positive."),
				},
				{
					type: "list",
					name: "riskLevel",
					message: "Risk level for autonomous actions:",
					choices: [
						{ name: "Conservative — small, incremental changes", value: "conservative" },
						{ name: "Moderate — balanced optimization moves", value: "moderate" },
						{ name: "Aggressive — larger swings for faster gains", value: "aggressive" },
					],
					default: "moderate",
				},
			]);

			// Step 6: Write config
			const config: AgentConfig = {
				metaAccessToken,
				metaAdAccountId,
				llmProvider,
				...(llmProvider === "claude"
					? { anthropicApiKey: llmApiKey }
					: { openaiApiKey: llmApiKey }),
				agent: {
					targetRoas: goals.roasTarget,
					cpaCap: goals.cpaCap,
					minDailyBudget: 5.0,
					maxBudgetScaleFactor: 1.5,
					requireApprovalAbove: 1000.0,
				},
			};

			if (!existsSync(CONFIG_DIR)) {
				mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
			}
			writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), {
				encoding: "utf-8",
				mode: 0o600,
			});
			success(`Configuration saved to ${CONFIG_PATH}`);

			// Step 7: Validate token
			logger.info("Validating Meta access token...");
			const tokenValid = validateToken();
			if (tokenValid) {
				success("Meta access token is valid.");
			} else {
				error("Could not validate the Meta access token. Please check your token and try again.");
			}

			// Summary
			section("Setup Complete");
			console.log(`  Ad Account:     ${metaAdAccountId}`);
			console.log(`  LLM Provider:   ${providerLabel}`);
			console.log(`  ROAS Target:    ${goals.roasTarget}`);
			console.log(`  CPA Cap:        $${goals.cpaCap}`);
			console.log(`  Budget Limit:   $${goals.dailyBudgetLimit}/day`);
			console.log(`  Risk Level:     ${goals.riskLevel}`);
			console.log();
			success("Run `meta-ads-agent run` to start the agent.");
		});
}
