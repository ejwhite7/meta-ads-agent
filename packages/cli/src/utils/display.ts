/**
 * Terminal display helpers for the meta-ads-agent CLI.
 *
 * Provides formatted tables, spinners, coloured status messages,
 * and section headers. All output goes to stdout.
 */

import boxen from "boxen";
import chalk from "chalk";
import Table from "cli-table3";
import ora, { type Ora } from "ora";

/**
 * Print a formatted table to stdout.
 *
 * @param data - Array of row objects where keys match column names.
 * @param columns - Ordered list of column headers to display.
 */
export function printTable(data: Array<Record<string, string | number>>, columns: string[]): void {
	const table = new Table({
		head: columns.map((c) => chalk.bold.cyan(c)),
		style: { head: [], border: [] },
	});

	for (const row of data) {
		table.push(columns.map((col) => String(row[col] ?? "")));
	}

	console.log(table.toString());
}

/**
 * Create an ora spinner with the given message.
 *
 * @param message - Text displayed alongside the spinner animation.
 * @returns An Ora spinner instance (call `.start()` to begin).
 */
export function spinner(message: string): Ora {
	return ora({ text: message, color: "cyan" });
}

/**
 * Print a success message with a green checkmark prefix.
 *
 * @param message - The success message to display.
 */
export function success(message: string): void {
	console.log(`${chalk.green("v")} ${message}`);
}

/**
 * Print an error message with a red X prefix.
 *
 * @param message - The error message to display.
 */
export function error(message: string): void {
	console.error(`${chalk.red("x")} ${message}`);
}

/**
 * Print a styled section header using boxen.
 *
 * @param title - The section title text.
 */
export function section(title: string): void {
	console.log(
		boxen(chalk.bold(title), {
			padding: { top: 0, bottom: 0, left: 1, right: 1 },
			borderStyle: "round",
			borderColor: "cyan",
		}),
	);
}
