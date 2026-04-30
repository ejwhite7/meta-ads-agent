/**
 * `meta-ads-agent run` command.
 *
 * Starts the agent loop in daemon mode. The OODA cycle runs on a
 * configurable interval (default 1 hour) until the user stops the
 * process with Ctrl+C or sends SIGTERM.
 *
 * Behaviour:
 *   - Loads configuration from ~/.meta-ads-agent/config.json.
 *   - Starts an AgentSession via the @meta-ads-agent/core package.
 *   - Prints live status to the terminal ("Tick 3 / inf — Observing metrics...").
 *   - On SIGINT/SIGTERM, calls session.stop() and waits for a clean exit.
 */

import type { Command } from "commander";
import { logger } from "../utils/logger.js";
import { success, error, spinner } from "../utils/display.js";
import { DaemonManager } from "../daemon/manager.js";
import { handleError } from "../utils/errors.js";

/**
 * Register the `run` command on the root program.
 */
export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .description("Start the agent loop (daemon mode)")
    .option("--interval <minutes>", "Tick interval in minutes", "60")
    .option("--max-ticks <n>", "Maximum ticks before auto-stop (0 = unlimited)", "0")
    .option("--dry-run", "Log actions without executing them", false)
    .action(async (options: { interval: string; maxTicks: string; dryRun: boolean }) => {
      const intervalMinutes = parseInt(options.interval, 10);
      const maxTicks = parseInt(options.maxTicks, 10);

      if (Number.isNaN(intervalMinutes) || intervalMinutes < 1) {
        error("Interval must be a positive integer (minutes).");
        process.exitCode = 1;
        return;
      }

      const loadingSpinner = spinner("Starting agent session...");
      loadingSpinner.start();

      try {
        const daemon = new DaemonManager();
        const isRunning = await daemon.isRunning();

        if (isRunning) {
          loadingSpinner.stop();
          error("An agent session is already running. Use `meta-ads-agent status` to check.");
          process.exitCode = 1;
          return;
        }

        await daemon.start({
          intervalMinutes,
          maxTicks: maxTicks === 0 ? Infinity : maxTicks,
          dryRun: options.dryRun,
        });

        loadingSpinner.stop();
        success("Agent started. Press Ctrl+C to stop.");

        let tickCount = 0;
        const tickLimit = maxTicks === 0 ? "inf" : String(maxTicks);

        const statusInterval = setInterval(() => {
          tickCount++;
          const phases = ["Observing metrics", "Orienting analysis", "Deciding actions", "Acting on decisions"];
          const phase = phases[tickCount % phases.length];
          logger.info(`Tick ${tickCount}/${tickLimit} — ${phase}...`);
        }, intervalMinutes * 60 * 1000);

        /** Handle graceful shutdown of the running agent. */
        const cleanup = async (): Promise<void> => {
          clearInterval(statusInterval);
          logger.info("Stopping agent session...");
          const stopSpinner = spinner("Waiting for current tick to finish...");
          stopSpinner.start();

          try {
            await daemon.stop();
            stopSpinner.stop();
            success("Agent stopped cleanly.");
          } catch (stopError: unknown) {
            stopSpinner.stop();
            handleError(stopError);
          }

          process.exit(0);
        };

        process.on("SIGINT", () => void cleanup());
        process.on("SIGTERM", () => void cleanup());

        // Keep the process alive until interrupted.
        await new Promise<void>(() => {
          // This promise intentionally never resolves.
          // The process stays alive until SIGINT/SIGTERM.
        });
      } catch (err: unknown) {
        loadingSpinner.stop();
        handleError(err);
        process.exitCode = 1;
      }
    });
}
