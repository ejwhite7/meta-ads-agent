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
 * Result of running a shell command. Captures stdout, stderr, and the
 * exit code so callers can surface real diagnostics instead of swallowing
 * the failure mode.
 */
interface ExecResult {
	readonly ok: boolean;
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

/**
 * Run a shell command with the supplied environment and return both stdout
 * and stderr. The Meta access token is injected via env so that the CLI
 * uses the token the user just entered, not whatever cached session may
 * already exist on disk.
 */
function execCapture(cmd: string, env: NodeJS.ProcessEnv = process.env): ExecResult {
	try {
		const stdout = execSync(cmd, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
			env,
		}).trim();
		return { ok: true, stdout, stderr: "", exitCode: 0 };
	} catch (err: unknown) {
		/* execSync throws on non-zero exit. The thrown object exposes stdout,
		 * stderr, and status when stdio is piped, so we can surface them. */
		const e = err as {
			stdout?: Buffer | string;
			stderr?: Buffer | string;
			status?: number;
			message?: string;
		};
		const stdout = (e.stdout?.toString() ?? "").trim();
		const stderr = (e.stderr?.toString() ?? e.message ?? "").trim();
		return { ok: false, stdout, stderr, exitCode: e.status ?? 1 };
	}
}

/**
 * Backwards-compatible wrapper returning trimmed stdout or null on failure.
 * Prefer `execCapture` when callers need to surface stderr to the user.
 */
function tryExec(cmd: string, env: NodeJS.ProcessEnv = process.env): string | null {
	const r = execCapture(cmd, env);
	return r.ok ? r.stdout : null;
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
 * Result of validating a Meta access token. On failure, `diagnostic`
 * contains the underlying CLI error message so the wizard can surface it
 * to the user instead of "Could not validate the Meta access token".
 */
interface TokenValidation {
	readonly valid: boolean;
	/** Identity returned on success (system user name + id from /me). */
	readonly identity?: { id?: string; name?: string };
	/** Underlying error string when invalid. */
	readonly diagnostic: string;
}

/**
 * Validate the Meta access token by calling the Graph API directly.
 *
 * Why not use the `meta` Python CLI?
 *   The published Python CLI (`pip install meta-ads`) does NOT expose
 *   an `auth` subcommand on the version most users install -- only
 *   resource subcommands (campaign, adset, ad, creative, etc.). There
 *   is no `meta ads auth status` to probe. Calling the Graph API directly
 *   eliminates the CLI version-drift problem and gives us a structured
 *   error payload we can show the user.
 *
 *   Endpoint: GET https://graph.facebook.com/v21.0/me?access_token=...
 *     - 200 OK + { id, name }                 -> valid
 *     - any other status / { error: { ... } } -> invalid (with reason)
 */
async function validateToken(token: string): Promise<TokenValidation> {
	const url = `https://graph.facebook.com/v21.0/me?access_token=${encodeURIComponent(token)}&fields=id,name`;

	try {
		const res = await fetch(url, { method: "GET" });
		const body = (await res.json().catch(() => null)) as {
			id?: string;
			name?: string;
			error?: { message?: string; code?: number; type?: string };
		} | null;

		if (res.ok && body && (body.id || body.name)) {
			return {
				valid: true,
				identity: { id: body.id, name: body.name },
				diagnostic: "",
			};
		}

		const err = body?.error;
		const details = err
			? `${err.type ?? "OAuthException"} (#${err.code ?? "?"}): ${err.message ?? "unknown"}`
			: `HTTP ${res.status} ${res.statusText}`;
		return { valid: false, diagnostic: details };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			valid: false,
			diagnostic: `Network error reaching graph.facebook.com: ${message}`,
		};
	}
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

			// Step 7: Validate token via the Graph API
			logger.info("Validating Meta access token...");
			const validation = await validateToken(metaAccessToken);
			if (validation.valid) {
				const who = validation.identity?.name ?? validation.identity?.id ?? "unknown";
				success(`Meta access token is valid (authenticated as: ${who}).`);
			} else {
				error("Could not validate the Meta access token.");
				console.error("");
				console.error("  Graph API response:");
				for (const line of validation.diagnostic.split("\n").slice(0, 12)) {
					console.error(`    ${line}`);
				}
				console.error("");
				console.error("  Common causes:");
				console.error("    • System user is not assigned to a Business in Business Settings.");
				console.error("    • Token is missing one of the required scopes: business_management,");
				console.error("      ads_management, ads_read, pages_show_list, pages_read_engagement,");
				console.error(
					"      pages_manage_ads, read_insights. (Meta hides some behind 'Show more'.)",
				);
				console.error(
					"    • The Meta App tied to the system user is not connected to the ad account.",
				);
				console.error("    • Token was copied with leading/trailing whitespace.");
				console.error("");
				console.error("  Reproduce the failure manually:");
				console.error(
					'    curl -s "https://graph.facebook.com/v21.0/me?access_token=<your-token>&fields=id,name"',
				);
				console.error("");
				console.error(
					"  Configuration was still saved; rerun `pnpm cli init` after fixing the token.",
				);
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
