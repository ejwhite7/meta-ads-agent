/**
 * `meta-ads-agent decisions` command.
 *
 * Pretty-prints the agent's append-only audit log straight from the
 * configured SQLite database, with no need to reach for sqlite3(1).
 * Useful for:
 *   - Quickly seeing what the agent has been doing.
 *   - Inspecting why a specific tool ran (LLM reasoning, scoring, params).
 *   - Auditing pending-approval actions (recorded with
 *     expectedOutcome="PENDING_HUMAN_APPROVAL").
 *
 * Filters mirror the `AuditFilter` shape in @meta-ads-agent/core:
 *   --tool, --session, --account, --success/--failure, --since, --until,
 *   --limit, --json.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	AuditLogger,
	DrizzleAuditDatabase,
	createDatabase,
	loadConfig,
} from "@meta-ads-agent/core";
import type { AuditFilter, AuditRecord } from "@meta-ads-agent/core";
import chalk from "chalk";
import type { Command } from "commander";
import { error, printTable, section } from "../utils/display.js";
import { handleError } from "../utils/errors.js";

interface DecisionsOptions {
	limit: string;
	tool?: string;
	session?: string;
	account?: string;
	success?: boolean;
	failure?: boolean;
	since?: string;
	until?: string;
	full?: boolean;
	/* `json` is intentionally NOT here -- it's a global option declared on
	 * the root program, so we read it via the action's command instance via
	 * optsWithGlobals() rather than from the local options object. */
}

/**
 * Truncate a string to `max` chars, replacing the tail with an ellipsis.
 */
function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max - 1)}…`;
}

/**
 * Register the `decisions` command on the root program.
 */
export function registerDecisionsCommand(program: Command): void {
	program
		.command("decisions")
		.description("Show recent agent decisions from the audit log")
		.option("-l, --limit <n>", "Maximum number of decisions to show", "20")
		.option("-t, --tool <name>", "Filter by tool name (e.g. set_budget)")
		.option("-s, --session <id>", "Filter by session id")
		.option("-a, --account <id>", "Filter by ad account id")
		.option("--success", "Show only successful decisions")
		.option("--failure", "Show only failed/pending decisions")
		.option("--since <iso>", "Earliest timestamp (ISO 8601)")
		.option("--until <iso>", "Latest timestamp (ISO 8601)")
		/* No local --json option: the root program already exposes one
		 * globally, and commander dedupes flag names. Read it via
		 * optsWithGlobals() below. */
		.option("--full", "Show full reasoning (no truncation)")
		.action(async function (this: Command, options: DecisionsOptions) {
			const globals = this.optsWithGlobals() as { json?: boolean };
			const asJson = Boolean(globals.json);
			try {
				/* Load config so we know which DB backend to open. */
				const cfg = loadConfig();

				/* The agent stores the SQLite db at config.sqlitePath relative to the
				 * daemon's CWD. Resolve to absolute and verify it exists so we can
				 * give a clear error rather than silently returning empty. */
				if (cfg.dbType === "sqlite") {
					const abs = resolve(cfg.sqlitePath);
					if (!existsSync(abs)) {
						error(
							`No audit database at ${abs}. Either the agent has never run, or your CWD differs from where the daemon was started.`,
						);
						process.exitCode = 1;
						return;
					}
				}

				const conn = createDatabase({
					type: cfg.dbType,
					sqlitePath: cfg.sqlitePath,
					postgresUrl: cfg.postgresUrl,
				});
				const auditLogger = new AuditLogger(new DrizzleAuditDatabase(conn.db));

				const limit = Math.max(1, Math.min(1000, Number.parseInt(options.limit, 10) || 20));

				/* If --success and --failure are both passed, ignore both rather than
				 * returning an empty result -- it's almost certainly user error. */
				let success: boolean | undefined;
				if (options.success && !options.failure) success = true;
				else if (options.failure && !options.success) success = false;

				const filter: AuditFilter = {
					limit,
					offset: 0,
					...(options.tool ? { toolName: options.tool } : {}),
					...(options.session ? { sessionId: options.session } : {}),
					...(options.account ? { adAccountId: options.account } : {}),
					...(success !== undefined ? { success } : {}),
					...(options.since ? { startDate: options.since } : {}),
					...(options.until ? { endDate: options.until } : {}),
				};

				const decisions = await auditLogger.getDecisions(filter);
				conn.close();

				if (decisions.length === 0) {
					section("No decisions matched the filter");
					console.log(
						chalk.dim(
							"  Try widening the filter, dropping flags, or running `meta-ads-agent run-once --dry-run` first.",
						),
					);
					return;
				}

				if (asJson) {
					console.log(JSON.stringify(decisions, null, 2));
					return;
				}

				/* Default: pretty table. */
				const truncWidth = options.full ? Number.POSITIVE_INFINITY : 60;
				const rows = decisions.map((d: AuditRecord) => ({
					Time: d.timestamp ? d.timestamp.replace("T", " ").slice(0, 19) : "",
					Tool: d.toolName,
					OK: d.success ? chalk.green("\u2713") : chalk.red("\u2717"),
					Risk: d.riskLevel,
					Score: typeof d.score === "number" ? d.score.toFixed(2) : "0.00",
					Reasoning: truncate(d.reasoning ?? "", truncWidth),
				}));

				section(`Most recent ${decisions.length} decisions`);
				printTable(rows, ["Time", "Tool", "OK", "Risk", "Score", "Reasoning"]);

				/* Surface pending-approval entries explicitly so users notice them. */
				const pending = decisions.filter((d) => d.expectedOutcome === "PENDING_HUMAN_APPROVAL");
				if (pending.length > 0) {
					console.log("");
					console.log(
						chalk.yellow(
							`  ${pending.length} action(s) awaiting human approval. Run with --tool=<name> or --full to inspect.`,
						),
					);
				}
			} catch (err: unknown) {
				handleError(err);
			}
		});
}
