/**
 * `meta-ads-agent status` command.
 *
 * Displays the current agent state, session uptime, last and next tick
 * times, and a table of the 5 most recent decisions.
 *
 * Reads data from the local database via @meta-ads-agent/core.
 */

import type { Command } from "commander";
import { logger } from "../utils/logger.js";
import { printTable, success, error, section } from "../utils/display.js";
import { DaemonManager } from "../daemon/manager.js";
import { handleError } from "../utils/errors.js";

/**
 * Format a millisecond duration into a human-readable uptime string.
 */
function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Register the `status` command on the root program.
 */
export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .description("Show current agent state and recent decisions")
    .action(async () => {
      try {
        const daemon = new DaemonManager();
        const status = await daemon.getStatus();

        section("Agent Status");
        console.log(`  State:          ${status.state}`);
        console.log(`  Session ID:     ${status.sessionId ?? "none"}`);
        console.log(`  Uptime:         ${status.startedAt ? formatUptime(Date.now() - new Date(status.startedAt).getTime()) : "n/a"}`);
        console.log(`  Last tick:      ${status.lastTickAt ?? "never"}`);
        console.log(`  Next tick:      ${status.nextTickAt ?? "n/a"}`);
        console.log(`  Total ticks:    ${status.tickCount}`);
        console.log();

        if (status.recentDecisions.length === 0) {
          logger.info("No recent decisions recorded.");
          return;
        }

        section("Recent Decisions (last 5)");

        const rows = status.recentDecisions.map((d: {
          timestamp: string;
          toolName: string;
          action: string;
          status: string;
        }) => ({
          Timestamp: new Date(d.timestamp).toLocaleString(),
          Tool: d.toolName,
          Action: d.action,
          Outcome: d.status,
        }));

        printTable(rows, ["Timestamp", "Tool", "Action", "Outcome"]);

        if (status.state === "running") {
          success("Agent is running.");
        } else if (status.state === "paused") {
          logger.warn("Agent is paused. Run `meta-ads-agent resume` to continue.");
        } else {
          logger.info("Agent is stopped. Run `meta-ads-agent run` to start.");
        }
      } catch (err: unknown) {
        handleError(err);
        process.exitCode = 1;
      }
    });
}
