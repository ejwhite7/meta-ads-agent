/**
 * CLI error handler for meta-ads-agent.
 *
 * Translates raw exceptions into human-readable console messages.
 * Differentiates between known application errors and unexpected
 * exceptions, logging stack traces only in debug mode.
 */

import { error as displayError } from "./display.js";
import { logger } from "./logger.js";

/**
 * Known error codes and their user-facing descriptions.
 */
const ERROR_MESSAGES: Record<string, string> = {
	ENOENT: "Configuration file not found. Run `meta-ads-agent init` first.",
	ECONNREFUSED: "Could not connect to the agent daemon. Is it running?",
	EACCES: "Permission denied. Check file permissions on ~/.meta-ads-agent/.",
	CONFIG_MISSING: "Required configuration is missing. Run `meta-ads-agent init`.",
	SESSION_NOT_FOUND: "No active agent session found.",
	TOKEN_INVALID: "Meta access token is invalid or expired. Run `meta-ads-agent init` to update.",
	LLM_ERROR: "LLM provider returned an error. Check your API key and provider settings.",
	RATE_LIMITED: "Meta API rate limit reached. The agent will retry on the next tick.",
};

/**
 * Application-specific error with a known error code.
 */
export class CliError extends Error {
	/** Machine-readable error code. */
	public readonly code: string;

	constructor(code: string, message?: string) {
		super(message ?? ERROR_MESSAGES[code] ?? `Unknown error: ${code}`);
		this.code = code;
		this.name = "CliError";
	}
}

/**
 * Handle an error by printing a human-readable message to stderr.
 * Stack traces are only shown when the logger is in debug mode.
 *
 * @param err - The caught error value (may be any type).
 */
export function handleError(err: unknown): void {
	if (err instanceof CliError) {
		displayError(err.message);
		logger.debug("CliError [%s]: %s", err.code, err.stack);
		return;
	}

	if (err instanceof Error) {
		const code = (err as NodeJS.ErrnoException).code;
		const knownMessage = code ? ERROR_MESSAGES[code] : undefined;

		if (knownMessage) {
			displayError(knownMessage);
		} else {
			displayError(err.message);
		}

		logger.debug("Error: %s", err.stack);
		return;
	}

	displayError(String(err));
}
