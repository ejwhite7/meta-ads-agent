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
 * Shape of the persisted configuration file.
 *
 * Field names MUST match `AgentConfigSchema` in @meta-ads-agent/core.
 * Goal-related guardrail fields are stored under top-level keys (no
 * `agent.` nesting) because the loader merges file contents directly
 * with environment variables and validates a flat schema.
 */
interface AgentConfig {
	metaAccessToken: string;
	metaAdAccountId: string;
	llmProvider: LLMProvider;
	anthropicApiKey?: string;
	openaiApiKey?: string;
	/* Goal/guardrail fields (consumed by AgentSession at startup). */
	roasTarget: number;
	cpaCap: number;
	dailyBudgetLimit: number;
	minDailyBudget: number;
	maxBudgetScaleFactor: number;
	requireApprovalAbove: number;
}

/**
 * Run a shell command with the supplied environment and return its trimmed
 * stdout, or null on failure. The Meta access token is injected via env so
 * that the CLI uses the token the user just entered, not whatever cached
 * session may already exist on disk.
 */
function tryExec(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
	try {
		return execSync(cmd, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			env,
		}).trim();
	} catch {
		return null;
	}
}

/**
 * Verify that the `meta-ads` Python CLI is installed and on PATH.
 * Uses `--help` so we don't depend on auth being configured yet.
 */
function checkMetaCliInstalled(): boolean {
	const result = tryExec("meta ads --help");
	return result !== null;
}

/**
 * List ad accounts available for the given access token.
 * Uses the canonical `ad-accounts list --output json` flag set; falls back
 * to manual entry if the CLI call fails or returns unparseable output.
 */
function listAdAccounts(token: string): string[] {
	const env = { ...process.env, META_ACCESS_TOKEN: token };
	const raw = tryExec("meta ads ad-accounts list --output json --no-input", env);
	if (!raw) return [];

	try {
		const parsed = JSON.parse(raw) as Array<{ id: string; name?: string }>;
		if (!Array.isArray(parsed)) return [];
		return parsed.map((a) => (a.name ? `${a.id} (${a.name})` : a.id));
	} catch {
		return [];
	}
}

/**
 * Validate the Meta access token by running `meta ads auth status` with
 * the just-collected token in the environment.
 */
function validateToken(token: string): boolean {
	const env = { ...process.env, META_ACCESS_TOKEN: token };
	const result = tryExec("meta ads auth status --output json --no-input", env);
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
			const accounts = listAdAccounts(metaAccessToken);
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
			const { apiKey } = await inquirer.prompt<{ apiKey: string }>([
				{
					type: "password",
					name: "apiKey",
					message: `Enter your ${providerLabel} API key:`,
					mask: "*",
					validate: (input: string) => (input.length > 0 ? true : "API key is required."),
				},
			]);

			// Step 5: Agent goals
			section("Agent Goals");

			const goals = await inquirer.prompt<{
				targetRoas: number;
				cpaCap: number;
				minDailyBudget: number;
				maxBudgetScaleFactor: number;
				requireApprovalAbove: number;
			}>([
				{
					type: "number",
					name: "targetRoas",
					message: "Target ROAS (e.g. 3.0):",
					default: 3.0,
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
					name: "minDailyBudget",
					message: "Minimum daily budget in dollars (e.g. 5.00):",
					default: 5.0,
					validate: (input: number) => (input > 0 ? true : "Budget must be positive."),
				},
				{
					type: "number",
					name: "maxBudgetScaleFactor",
					message: "Max budget scale factor (e.g. 1.5 = 50% increase max):",
					default: 1.5,
					validate: (input: number) => (input > 1 ? true : "Scale factor must be greater than 1."),
				},
				{
					type: "number",
					name: "requireApprovalAbove",
					message: "Require manual approval for changes above this dollar amount:",
					default: 1000.0,
					validate: (input: number) => (input > 0 ? true : "Threshold must be positive."),
				},
			]);

			// Step 6: Write config (flat keys matching AgentConfigSchema)
			const config: AgentConfig = {
				metaAccessToken,
				metaAdAccountId,
				llmProvider,
				...(llmProvider === "claude" ? { anthropicApiKey: apiKey } : { openaiApiKey: apiKey }),
				roasTarget: goals.targetRoas,
				cpaCap: goals.cpaCap,
				dailyBudgetLimit: goals.minDailyBudget * 100, // sane default ceiling
				minDailyBudget: goals.minDailyBudget,
				maxBudgetScaleFactor: goals.maxBudgetScaleFactor,
				requireApprovalAbove: goals.requireApprovalAbove,
			};

			if (!existsSync(CONFIG_DIR)) {
				mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
			}
			/* Remove any existing file so 0o600 is enforced on the new inode. */
			try {
				if (existsSync(CONFIG_PATH)) {
					const { unlinkSync, chmodSync } = await import("node:fs");
					unlinkSync(CONFIG_PATH);
					void chmodSync;
				}
			} catch {
				/* best effort */
			}
			writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), {
				encoding: "utf-8",
				mode: 0o600,
			});
			/* Belt-and-suspenders: explicit chmod in case mode was masked. */
			try {
				const { chmodSync } = await import("node:fs");
				chmodSync(CONFIG_PATH, 0o600);
			} catch {
				/* best effort */
			}
			success(`Configuration saved to ${CONFIG_PATH}`);

			// Step 7: Validate token
			logger.info("Validating Meta access token...");
			const tokenValid = validateToken(metaAccessToken);
			if (tokenValid) {
				success("Meta access token is valid.");
			} else {
				error("Could not validate the Meta access token. Please check your token and try again.");
			}

			// Summary
			section("Setup Complete");
			console.log(`  Ad Account:            ${metaAdAccountId}`);
			console.log(`  LLM Provider:          ${providerLabel}`);
			console.log(`  ROAS Target:           ${goals.targetRoas}`);
			console.log(`  CPA Cap:               $${goals.cpaCap}`);
			console.log(`  Min Daily Budget:      $${goals.minDailyBudget}`);
			console.log(`  Max Scale Factor:      ${goals.maxBudgetScaleFactor}x`);
			console.log(`  Approval Threshold:    $${goals.requireApprovalAbove}`);
			console.log();

			/* Detect whether we're running from the published binary or from the
			 * monorepo via `pnpm cli` (tsx) so we can suggest the correct next
			 * command. argv[1] points to the entry script in both cases. */
			const entry = process.argv[1] ?? "";
			const inDevWorkspace = entry.includes("src/index.ts") || entry.includes(".tsx");

			success("Next step:");
			if (inDevWorkspace) {
				console.log("  pnpm cli run                 # start the agent from this workspace");
				console.log("  pnpm cli run --dry-run       # preview without executing actions");
			} else {
				console.log("  meta-ads-agent run           # start the agent");
				console.log("  meta-ads-agent run --dry-run # preview without executing actions");
			}
		});
}
