/**
 * `meta-ads-agent guidance` command.
 *
 * Lets the operator configure (or reconfigure) the per-campaign goal
 * that the agent uses to decide what to optimize for. Without an active
 * goal, the agent records `_pending_guidance` audit entries and refuses
 * to make decisions on the campaign.
 *
 * Sub-modes (selected by flags):
 *   meta-ads-agent guidance               # interactive: walk through
 *                                         #  campaigns missing goals
 *   meta-ads-agent guidance --list        # print a table of every
 *                                         #  configured goal
 *   meta-ads-agent guidance --list --json # same, JSON for scripting
 *   meta-ads-agent guidance --show <id>   # print one campaign's goal
 *   meta-ads-agent guidance --reset <id>  # soft-delete one campaign's goal
 *
 * The interactive mode discovers campaigns from the live Meta API and
 * cross-references them with the `campaign_goals` table; only campaigns
 * without an active goal are prompted, in line with point (2) of the
 * design ("prompt whichever exist and reprompt as more are discovered").
 */

import {
	CampaignGoalRepository,
	createDatabase,
	inferDefaultKpi,
	loadConfig,
} from "@meta-ads-agent/core";
import type { CampaignGoal, PrimaryKpi } from "@meta-ads-agent/core";
import { MetaClient } from "@meta-ads-agent/meta-client";
import chalk from "chalk";
import type { Command } from "commander";
import inquirer from "inquirer";
import { error, printTable, section, success, warn } from "../utils/display.js";
import { handleError } from "../utils/errors.js";

interface GuidanceOptions {
	list?: boolean;
	json?: boolean;
	show?: string;
	reset?: string;
	all?: boolean;
}

interface MetaCampaign {
	id: string;
	name: string;
	objective: string;
	status: string;
	daily_budget?: string;
}

/**
 * Open the configured database and return everything subcommands need.
 * Wrapped in a single helper because all four modes (interactive, list,
 * show, reset) share the same setup.
 */
async function openContext() {
	const cfg = loadConfig();
	const dbConn = createDatabase({
		type: cfg.dbType,
		sqlitePath: cfg.sqlitePath,
		postgresUrl: cfg.postgresUrl,
	});
	const repo = new CampaignGoalRepository(dbConn.db);
	return { cfg, dbConn, repo };
}

/**
 * Pretty-print one goal as a multi-line summary suitable for stdout.
 */
function formatGoalSummary(goal: CampaignGoal): string[] {
	const direction = goal.primaryKpiDirection === "maximize" ? "↑" : "↓";
	const lines: string[] = [
		`  Primary KPI:        ${goal.primaryKpi} ${direction} ${goal.primaryKpiTarget}`,
		`  Objective at config: ${goal.lastSeenObjective}`,
		`  Configured by:       ${goal.configuredBy} at ${goal.configuredAt}`,
	];
	if (goal.secondaryKpis.length > 0) {
		lines.push(
			`  Secondary KPIs:      ${goal.secondaryKpis
				.map((k) => `${k.kpi}${k.target ? `=${k.target}` : ""}`)
				.join(", ")}`,
		);
	}
	if (goal.minDailyBudget !== null)
		lines.push(`  Min daily budget:    $${goal.minDailyBudget.toFixed(2)} (override)`);
	if (goal.maxBudgetScaleFactor !== null)
		lines.push(`  Max scale factor:    ${goal.maxBudgetScaleFactor}x (override)`);
	if (goal.requireApprovalAbove !== null)
		lines.push(`  Approval threshold:  $${goal.requireApprovalAbove.toFixed(2)} (override)`);
	if (goal.notes) lines.push(`  Notes:               ${goal.notes}`);
	return lines;
}

/**
 * Allowed primary-KPI choices for the inquirer list prompt. Order
 * matches the type union so test snapshots stay stable when we add new
 * KPIs.
 */
const KPI_CHOICES: Array<{ name: string; value: PrimaryKpi }> = [
	{ name: "ROAS — return on ad spend (commerce)", value: "roas" },
	{ name: "CPA — cost per acquisition", value: "cpa" },
	{ name: "CPL — cost per lead", value: "cpl" },
	{ name: "CPC — cost per click", value: "cpc" },
	{ name: "CTR — click-through rate", value: "ctr" },
	{ name: "CPM — cost per 1000 impressions", value: "cpm" },
	{ name: "CPI — cost per app install", value: "cpi" },
	{ name: "Cost per ThruPlay (video)", value: "cost_per_thruplay" },
	{ name: "ThruPlay rate (video)", value: "thruplay_rate" },
	{ name: "Frequency (awareness)", value: "frequency" },
	{ name: "Reach (awareness)", value: "reach" },
];

/**
 * Walk the operator through configuring one campaign's goal.
 * Returns true if a goal was saved, false if the operator skipped.
 */
async function promptForCampaign(
	repo: CampaignGoalRepository,
	adAccountId: string,
	c: MetaCampaign,
): Promise<boolean> {
	const def = inferDefaultKpi(c.objective);
	console.log("");
	section(`${c.name}`);
	console.log(`  ID:        ${c.id}`);
	console.log(`  Objective: ${c.objective}`);
	console.log(`  Status:    ${c.status}`);
	if (c.daily_budget) {
		console.log(`  Budget:    $${(Number.parseInt(c.daily_budget, 10) / 100).toFixed(2)}/day`);
	}
	console.log(
		`  Suggested: ${def.primaryKpi} (${def.primaryKpiDirection}) target ${def.primaryKpiTarget}`,
	);
	console.log("");

	const { configure } = await inquirer.prompt<{ configure: "configure" | "skip" }>([
		{
			type: "list",
			name: "configure",
			message: "Configure this campaign's goal?",
			choices: [
				{ name: "Configure", value: "configure" },
				{ name: "Skip for now", value: "skip" },
			],
			default: "configure",
		},
	]);
	if (configure === "skip") return false;

	const answers = await inquirer.prompt<{
		primaryKpi: PrimaryKpi;
		primaryKpiDirection: "maximize" | "minimize";
		primaryKpiTarget: number;
		notes: string;
	}>([
		{
			type: "list",
			name: "primaryKpi",
			message: "Primary KPI:",
			choices: KPI_CHOICES,
			default: def.primaryKpi,
		},
		{
			type: "list",
			name: "primaryKpiDirection",
			message: "Direction:",
			choices: [
				{ name: "Maximize (higher is better)", value: "maximize" },
				{ name: "Minimize (lower is better)", value: "minimize" },
			],
			default: def.primaryKpiDirection,
		},
		{
			type: "number",
			name: "primaryKpiTarget",
			message: `Target value (${def.currency ? "USD" : "ratio/decimal"}):`,
			default: def.primaryKpiTarget,
			validate: (v: unknown) => {
				if (typeof v !== "number" || Number.isNaN(v)) return "Enter a number.";
				if (v < 0) return "Target must be non-negative.";
				return true;
			},
		},
		{
			type: "input",
			name: "notes",
			message: "Notes (optional, press Enter to skip):",
			default: "",
		},
	]);

	const saved = await repo.upsert({
		adAccountId,
		campaignId: c.id,
		primaryKpi: answers.primaryKpi,
		primaryKpiTarget: answers.primaryKpiTarget,
		primaryKpiDirection: answers.primaryKpiDirection,
		lastSeenObjective: c.objective,
		configuredBy: "guidance-cmd",
		notes: answers.notes ? answers.notes : undefined,
	});
	success(`Saved goal #${saved.dbId} for "${c.name}".`);
	return true;
}

/**
 * Register the `guidance` command on the root program.
 */
export function registerGuidanceCommand(program: Command): void {
	program
		.command("guidance")
		.description("Configure per-campaign goals (or list / inspect / reset existing ones)")
		.option("--list", "List every configured goal as a table")
		.option("--json", "With --list: emit JSON for scripting")
		.option("--show <campaignId>", "Show full config for one campaign")
		.option("--reset <campaignId>", "Soft-delete a campaign's goal so it re-prompts next tick")
		.option("--all", "Re-prompt every campaign (including those that already have a goal)")
		.action(async (options: GuidanceOptions) => {
			try {
				const { cfg, dbConn, repo } = await openContext();

				/* ---- --list ---- */
				if (options.list) {
					const goals = await repo.listActive(cfg.metaAdAccountId);
					if (options.json) {
						console.log(JSON.stringify(goals, null, 2));
						return;
					}
					if (goals.length === 0) {
						console.log(
							chalk.dim("No goals configured yet. Run `meta-ads-agent guidance` to start."),
						);
						return;
					}
					section(`${goals.length} configured goal(s)`);
					printTable(
						goals.map((g) => ({
							Campaign: g.campaignId,
							Objective: g.lastSeenObjective,
							KPI: g.primaryKpi,
							Direction: g.primaryKpiDirection,
							Target: g.primaryKpiTarget,
							"Configured at": g.configuredAt.replace("T", " ").slice(0, 19),
						})),
						["Campaign", "Objective", "KPI", "Direction", "Target", "Configured at"],
					);
					dbConn.close();
					return;
				}

				/* ---- --show ---- */
				if (options.show) {
					const goal = await repo.getActive(cfg.metaAdAccountId, options.show);
					if (!goal) {
						warn(`No active goal for campaign ${options.show}.`);
						dbConn.close();
						process.exitCode = 1;
						return;
					}
					section(`Goal for campaign ${options.show}`);
					for (const line of formatGoalSummary(goal)) console.log(line);
					dbConn.close();
					return;
				}

				/* ---- --reset ---- */
				if (options.reset) {
					const result = await repo.softDelete(
						cfg.metaAdAccountId,
						options.reset,
						"guidance-cmd",
						"explicit reset via --reset",
					);
					if (!result) {
						warn(`No active goal for campaign ${options.reset} -- nothing to reset.`);
						dbConn.close();
						return;
					}
					success(
						`Reset goal for campaign ${options.reset}. Next tick will route it to pending-guidance.`,
					);
					dbConn.close();
					return;
				}

				/* ---- interactive (default) ---- */

				const metaClient = new MetaClient({
					accessToken: cfg.metaAccessToken,
					adAccountId: cfg.metaAdAccountId,
				});
				await metaClient.initialize();

				const liveCampaigns = (await metaClient.campaigns.list(
					cfg.metaAdAccountId,
				)) as MetaCampaign[];
				const existing = await repo.listActive(cfg.metaAdAccountId);
				const existingIds = new Set(existing.map((g) => g.campaignId));

				const candidates = options.all
					? liveCampaigns
					: liveCampaigns.filter((c) => !existingIds.has(c.id));

				if (candidates.length === 0) {
					success(
						existing.length > 0
							? `All ${liveCampaigns.length} campaign(s) already have goals configured. Use \`--all\` to re-prompt them, or \`--list\` to inspect.`
							: "No campaigns found in this ad account.",
					);
					dbConn.close();
					return;
				}

				section(
					`${candidates.length} campaign(s) need${candidates.length === 1 ? "s" : ""} guidance`,
				);
				let configured = 0;
				let skipped = 0;
				for (const c of candidates) {
					const did = await promptForCampaign(repo, cfg.metaAdAccountId, c);
					if (did) configured++;
					else skipped++;
				}

				console.log("");
				success(
					`${configured} configured, ${skipped} skipped. Skipped campaigns will continue to appear in pending-guidance until configured.`,
				);
				dbConn.close();
			} catch (err: unknown) {
				handleError(err);
			}
		});
}
