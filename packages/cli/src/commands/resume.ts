/**
 * `meta-ads-agent resume` command.
 *
 * Sends a resume signal to a paused agent session, restarting the tick
 * scheduler. The next tick begins immediately after the resume signal
 * is acknowledged.
 */

import type { Command } from "commander";
import { success, error, spinner } from "../utils/display.js";
import { DaemonManager } from "../daemon/manager.js";
import { handleError } from "../utils/errors.js";

/**
 * Register the `resume` command on the root program.
 */
export function registerResumeCommand(program: Command): void {
  program
    .command("resume")
    .description("Resume a paused agent session")
    .action(async () => {
      const resumeSpinner = spinner("Resuming agent...");
      resumeSpinner.start();

      try {
        const daemon = new DaemonManager();
        const status = await daemon.getStatus();

        if (status.state !== "paused") {
          resumeSpinner.stop();
          error(`Agent is not paused (current state: ${status.state}).`);
          process.exitCode = 1;
          return;
        }

        await daemon.resume();
        resumeSpinner.stop();
        success("Agent resumed. Tick scheduler restarted.");
      } catch (err: unknown) {
        resumeSpinner.stop();
        handleError(err);
        process.exitCode = 1;
      }
    });
}
