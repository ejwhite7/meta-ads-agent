/**
 * `meta-ads-agent run-once` command.
 *
 * Executes a single OODA tick and exits. Useful for testing, debugging,
 * and cron-based scheduling where the caller manages the loop.
 *
 * The tick runs through the full cycle: Observe (pull metrics) ->
 * Orient (analyse trends) -> Decide (rank proposals) -> Act (invoke tools).
 */

import type { Command } from "commander";
import { logger } from "../utils/logger.js";
import { success, error, spinner } from "../utils/display.js";
import { DaemonManager } from "../daemon/manager.js";
import { handleError } from "../utils/errors.js";

/**
 * Register the `run-once` command on the root program.
 */
export function registerRunOnceCommand(program: Command): void {
  program
    .command("run-once")
    .description("Execute a single OODA tick and exit")
    .option("--dry-run", "Log actions without executing them", false)
    .action(async (options: { dryRun: boolean }) => {
      const tickSpinner = spinner("Running single tick...");
      tickSpinner.start();

      try {
        const daemon = new DaemonManager();

        logger.debug("Executing single tick (dry-run: %s)", options.dryRun);

        const result = await daemon.runOnce({ dryRun: options.dryRun });

        tickSpinner.stop();

        if (result.success) {
          success("Tick completed successfully.");
          logger.info("Tool invocations: %d", result.actionsCount);
          logger.info("Duration: %dms", result.durationMs);

          if (result.decisions.length > 0) {
            console.log("\nDecisions made:");
            for (const decision of result.decisions) {
              console.log(`  - [${decision.toolName}] ${decision.action}`);
            }
          } else {
            console.log("\nNo actions taken this tick.");
          }
        } else {
          error("Tick completed with errors.");
          logger.error("Error: %s", result.error);
          process.exitCode = 1;
        }
      } catch (err: unknown) {
        tickSpinner.stop();
        handleError(err);
        process.exitCode = 1;
      }
    });
}
