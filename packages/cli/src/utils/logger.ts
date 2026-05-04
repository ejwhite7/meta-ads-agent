/**
 * Winston logger configuration for the meta-ads-agent CLI.
 *
 * Provides structured JSON logging in production and pretty-printed
 * coloured output during development. Log level defaults to "info"
 * and can be elevated to "debug" with the --verbose flag.
 *
 * Log levels (highest to lowest priority):
 *   error  Critical failures requiring immediate attention.
 *   warn   Potential issues that do not block execution.
 *   info   Normal operational messages.
 *   debug  Detailed diagnostic information.
 *
 * Writes info/debug/warn to stdout and error to stderr.
 */

import winston from "winston";

const { combine, timestamp, printf, colorize, json, errors, splat } = winston.format;

/** Determine whether the current process is running in production mode. */
const isProduction = process.env.NODE_ENV === "production";

/**
 * Human-readable format for development.
 *
 * `splat()` enables printf-style placeholders (%s, %d, %o) so callers can
 * write `logger.info("IPC listening on %s", socketPath)` and have the
 * placeholder interpolated. Without it, the placeholder prints literally
 * and the trailing argument is discarded.
 */
const devFormat = combine(
	errors({ stack: true }),
	splat(),
	timestamp({ format: "HH:mm:ss" }),
	colorize(),
	printf(({ level, message, timestamp: ts, stack }) => {
		const base = `${ts} ${level}: ${message}`;
		return stack ? `${base}\n${stack}` : base;
	}),
);

/**
 * Structured JSON format for production.
 */
const prodFormat = combine(errors({ stack: true }), splat(), timestamp(), json());

/**
 * Shared logger instance used throughout the CLI.
 *
 * Usage:
 * ```typescript
 * import { logger } from "./utils/logger.js";
 * logger.info("Agent started", { sessionId: "abc" });
 * ```
 */
export const logger = winston.createLogger({
	level: "info",
	format: isProduction ? prodFormat : devFormat,
	transports: [
		new winston.transports.Console({
			stderrLevels: ["error"],
		}),
	],
});
