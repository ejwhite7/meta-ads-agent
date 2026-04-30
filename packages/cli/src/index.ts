#!/usr/bin/env node

/**
 * meta-ads-agent CLI entry point.
 *
 * Registers all commands via commander.js and handles top-level error
 * handling, graceful shutdown on SIGINT/SIGTERM, and version display.
 *
 * Usage:
 *   meta-ads-agent init        Interactive setup wizard
 *   meta-ads-agent run         Start the agent loop (daemon mode)
 *   meta-ads-agent run-once    Execute a single OODA tick
 *   meta-ads-agent status      Show agent state and recent decisions
 *   meta-ads-agent report      Performance summary for a date range
 *   meta-ads-agent pause       Pause a running agent
 *   meta-ads-agent resume      Resume a paused agent
 *   meta-ads-agent config      View or edit configuration
 *
 * Architecture reference: see CLAUDE.md in the repository root.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { registerConfigCommand } from "./commands/config.js";
import { registerInitCommand } from "./commands/init.js";
import { registerPauseCommand } from "./commands/pause.js";
import { registerReportCommand } from "./commands/report.js";
import { registerResumeCommand } from "./commands/resume.js";
import { registerRunOnceCommand } from "./commands/run-once.js";
import { registerRunCommand } from "./commands/run.js";
import { registerStatusCommand } from "./commands/status.js";
import { handleError } from "./utils/errors.js";
import { logger } from "./utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Read the package version from the nearest package.json.
 */
function getVersion(): string {
	const packageJsonPath = resolve(__dirname, "..", "package.json");
	const raw = readFileSync(packageJsonPath, "utf-8");
	const pkg = JSON.parse(raw) as { version: string };
	return pkg.version;
}

const program = new Command();

program
	.name("meta-ads-agent")
	.description(
		"Open source autonomous agent for Meta Ads — full lifecycle campaign management, creative generation, and budget optimization",
	)
	.version(getVersion(), "-v, --version", "Display the current version")
	.option("--verbose", "Enable debug-level logging", false)
	.option("--json", "Output results as JSON", false)
	.hook("preAction", (_thisCommand, actionCommand) => {
		const opts = actionCommand.optsWithGlobals();
		if (opts.verbose) {
			logger.level = "debug";
		}
	});

/** Register every CLI command on the root program. */
registerInitCommand(program);
registerRunCommand(program);
registerRunOnceCommand(program);
registerStatusCommand(program);
registerReportCommand(program);
registerPauseCommand(program);
registerResumeCommand(program);
registerConfigCommand(program);

/** Show help when no command is provided. */
program.action(() => {
	program.help();
});

/**
 * Graceful shutdown handler.
 * Ensures any running agent session is cleanly stopped before exit.
 */
function setupGracefulShutdown(): void {
	let shuttingDown = false;

	const shutdown = (signal: string): void => {
		if (shuttingDown) return;
		shuttingDown = true;
		logger.info(`Received ${signal}. Shutting down gracefully...`);

		setTimeout(() => {
			logger.warn("Forced exit after timeout.");
			process.exit(1);
		}, 10_000).unref();

		process.exit(0);
	};

	process.on("SIGINT", () => shutdown("SIGINT"));
	process.on("SIGTERM", () => shutdown("SIGTERM"));
}

setupGracefulShutdown();

program.parseAsync(process.argv).catch((error: unknown) => {
	handleError(error);
	process.exit(1);
});
