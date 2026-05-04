/**
 * @module commands/guidance-helpers
 *
 * Shared helpers between the standalone `guidance` command and the
 * `init` wizard's per-campaign goal-setup tail. Splitting them out
 * keeps init.ts free of the MetaClient/CampaignGoalRepository import
 * tree on import (it's loaded lazily inside the wizard step).
 */

import {
	CampaignGoalRepository,
	createDatabase,
	inferDefaultKpi,
	loadConfig,
} from "@meta-ads-agent/core";
import type { PrimaryKpi } from "@meta-ads-agent/core";
import { MetaClient } from "@meta-ads-agent/meta-client";
import inquirer from "inquirer";
import { error, section, success } from "../utils/display.js";

interface MetaCampaign {
	id: string;
	name: string;
	objective: string;
	status: string;
	daily_budget?: string;
}

interface SetupArgs {
	readonly metaAccessToken: string;
	readonly metaAdAccountId: string;
}

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
 * Discovers existing campaigns in the configured ad account, asks the
 * operator for goals on those that don't already have one, and persists
 * the answers via {@link CampaignGoalRepository}.
 *
 * Used by:
 *   - `meta-ads-agent init` (offered as a wizard tail step).
 *   - `meta-ads-agent guidance` (default interactive mode).
 */
export async function runInteractiveGoalSetup(args: SetupArgs): Promise<void> {
	const cfg = loadConfig();
	const dbConn = createDatabase({
		type: cfg.dbType,
		sqlitePath: cfg.sqlitePath,
		postgresUrl: cfg.postgresUrl,
	});
	try {
		const repo = new CampaignGoalRepository(dbConn.db);

		const metaClient = new MetaClient({
			accessToken: args.metaAccessToken,
			adAccountId: args.metaAdAccountId,
		});
		await metaClient.initialize();

		const liveCampaigns = (await metaClient.campaigns.list(args.metaAdAccountId)) as MetaCampaign[];
		const existing = await repo.listActive(args.metaAdAccountId);
		const existingIds = new Set(existing.map((g) => g.campaignId));
		const candidates = liveCampaigns.filter((c) => !existingIds.has(c.id));

		if (liveCampaigns.length === 0) {
			success(
				"No campaigns found in this ad account yet. Run " +
					"`meta-ads-agent guidance` once you've created one in Ads Manager.",
			);
			return;
		}
		if (candidates.length === 0) {
			success(
				`All ${liveCampaigns.length} campaign(s) already have goals configured. Run \`meta-ads-agent guidance --list\` to inspect them.`,
			);
			return;
		}

		section(`${candidates.length} campaign(s) need${candidates.length === 1 ? "s" : ""} guidance`);

		let configured = 0;
		let skipped = 0;
		for (const c of candidates) {
			const did = await promptOne(repo, args.metaAdAccountId, c);
			if (did) configured++;
			else skipped++;
		}

		console.log("");
		success(
			`${configured} configured, ${skipped} skipped. Skipped campaigns will appear in the agent's pending-guidance list until you configure them.`,
		);
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		error(`Goal setup failed: ${msg}`);
	} finally {
		try {
			dbConn.close();
		} catch {
			/* best effort */
		}
	}
}

/**
 * Walks the operator through one campaign's goal questions.
 * Returns true if a goal was saved, false on skip.
 */
async function promptOne(
	repo: CampaignGoalRepository,
	adAccountId: string,
	c: MetaCampaign,
): Promise<boolean> {
	const def = inferDefaultKpi(c.objective);
	console.log("");
	section(c.name);
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
			message: "Notes (optional):",
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
		configuredBy: "init-wizard",
		notes: answers.notes ? answers.notes : undefined,
	});
	success(`Saved goal #${saved.dbId} for "${c.name}".`);
	return true;
}
