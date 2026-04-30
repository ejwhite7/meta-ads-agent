/**
 * `meta-ads-agent pause` command.
 *
 * Sends a pause signal to a running agent session. The current tick
 * (if in progress) completes before the agent enters a paused state.
 * No further ticks are scheduled until `meta-ads-agent resume` is run.
 */

import type { Command } from "commander";
import { DaemonManager } from "../daemon/manager.js";
import { error, spinner, success } from "../utils/display.js";
import { handleError } from "../utils/errors.js";

/**
 * Register the `pause` command on the root program.
 */
export function registerPauseCommand(program: Command): void {
	program
		.command("pause")
		.description("Pause a running agent session")
		.action(async () => {
			const pauseSpinner = spinner("Pausing agent...");
			pauseSpinner.start();

			try {
				const daemon = new DaemonManager();
				const status = await daemon.getStatus();

				if (status.state !== "running") {
					pauseSpinner.stop();
					error(`Agent is not running (current state: ${status.state}).`);
					process.exitCode = 1;
					return;
				}

				await daemon.pause();
				pauseSpinner.stop();
				success("Agent paused. Run `meta-ads-agent resume` to continue.");
			} catch (err: unknown) {
				pauseSpinner.stop();
				handleError(err);
				process.exitCode = 1;
			}
		});
}
