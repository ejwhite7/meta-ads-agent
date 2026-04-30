/**
 * @module cli/wrapper
 *
 * Core CLI wrapper that spawns the `meta-ads` Python CLI as a subprocess.
 * Handles JSON output parsing, exit code mapping to typed errors, timeout
 * management, and environment variable injection for authentication.
 *
 * The wrapper always passes `--output json` and `--no-input` flags to ensure
 * machine-readable, non-interactive execution suitable for automation.
 */

import { spawn } from "node:child_process";
import { AuthError, CliError, NotFoundError } from "../errors.js";
import { CliExitCode } from "../types.js";
import type { CliArgs, CliResult, CliWrapperConfig } from "./types.js";

/** Default configuration values for the CLI wrapper. */
const DEFAULT_CONFIG: CliWrapperConfig = {
	cliPath: "meta",
	timeout: 30_000,
};

/**
 * Wraps the `meta-ads` Python CLI, providing typed command execution with
 * automatic JSON parsing, exit code handling, and error mapping.
 *
 * @example
 * ```typescript
 * const cli = new CLIWrapper({ cliPath: "meta", timeout: 30000, accessToken: "token123" });
 * await cli.checkInstalled();
 * const campaigns = await cli.run<Campaign[]>("campaigns", "list", { "account-id": "act_123" });
 * ```
 */
export class CLIWrapper {
	private readonly config: CliWrapperConfig;

	constructor(config: Partial<CliWrapperConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/**
	 * Executes a meta-ads CLI command and returns the parsed JSON result.
	 *
	 * Always passes `--output json` and `--no-input` for automation.
	 * Parses stdout as JSON and maps non-zero exit codes to typed errors.
	 *
	 * @typeParam T - Expected shape of the parsed JSON response.
	 * @param resource - Resource group (e.g., "campaigns", "ad-sets").
	 * @param action - Action to perform (e.g., "list", "create").
	 * @param args - Named arguments as key-value pairs.
	 * @returns Parsed JSON output from the CLI.
	 * @throws {CliError} When the CLI exits with a non-zero code.
	 * @throws {AuthError} When exit code is 3 (authentication failure).
	 * @throws {NotFoundError} When exit code is 5 (resource not found).
	 */
	async run<T>(resource: string, action: string, args: CliArgs = {}): Promise<T> {
		const result = await this.execute(resource, action, args);
		return result.data as T;
	}

	/**
	 * Checks that the meta-ads CLI is installed and accessible on the system PATH.
	 *
	 * @throws {CliError} If the CLI binary is not found or not executable.
	 */
	async checkInstalled(): Promise<void> {
		try {
			await this.execute("ads", "help", {});
		} catch (error: unknown) {
			if (error instanceof CliError && error.exitCode === CliExitCode.Usage) {
				// Exit code 2 (usage error) is acceptable — it means the CLI is installed
				// but "help" is not a valid resource/action combo.
				return;
			}
			// Check if the error indicates the binary was not found
			if (error instanceof Error && error.message.includes("ENOENT")) {
				throw new CliError(
					`meta-ads CLI not found at "${this.config.cliPath}". Install it with: pip install meta-ads`,
					CliExitCode.General,
					"",
				);
			}
			// Re-throw — any other error means the CLI is accessible
			// (we just wanted to verify it can be spawned)
		}
	}

	/**
	 * Returns the authenticated user's Meta business information.
	 * Used to verify token validity on startup.
	 *
	 * @returns Object containing the authenticated user's name and ID.
	 * @throws {AuthError} If the token is invalid or expired.
	 */
	async whoami(): Promise<{ name: string; id: string }> {
		return this.run<{ name: string; id: string }>("auth", "status", {});
	}

	/**
	 * Executes a CLI command and returns the full execution result including
	 * raw stdout/stderr and the exit code.
	 *
	 * @param resource - Resource group name.
	 * @param action - Action name.
	 * @param args - Command arguments.
	 * @returns Full CLI execution result.
	 */
	private execute(resource: string, action: string, args: CliArgs): Promise<CliResult> {
		return new Promise((resolve, reject) => {
			const cliArgs = this.buildArgs(resource, action, args);
			const env = this.buildEnv();

			const proc = spawn(this.config.cliPath, ["ads", ...cliArgs], {
				env,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";
			let timedOut = false;

			const timer = setTimeout(() => {
				timedOut = true;
				proc.kill("SIGTERM");
				reject(
					new CliError(
						`CLI command timed out after ${this.config.timeout}ms: meta ads ${resource} ${action}`,
						CliExitCode.General,
						"",
					),
				);
			}, this.config.timeout);

			proc.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});

			proc.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			proc.on("error", (error: Error) => {
				clearTimeout(timer);
				reject(
					new CliError(
						`Failed to spawn meta-ads CLI: ${error.message}`,
						CliExitCode.General,
						error.message,
					),
				);
			});

			proc.on("close", (exitCode: number | null) => {
				clearTimeout(timer);
				const code = exitCode ?? 1;

				if (timedOut) {
					reject(
						new CliError(
							`CLI command timed out after ${this.config.timeout}ms: meta ads ${resource} ${action}`,
							CliExitCode.General,
							stderr,
						),
					);
					return;
				}

				if (code !== 0) {
					reject(this.mapExitCodeToError(code, resource, action, stderr));
					return;
				}

				const data = this.parseOutput(stdout);
				resolve({ data, exitCode: code, stdout, stderr });
			});
		});
	}

	/**
	 * Builds the argument list for the CLI subprocess.
	 * Always includes `--output json` and `--no-input` flags.
	 */
	private buildArgs(resource: string, action: string, args: CliArgs): string[] {
		const result: string[] = [resource, action, "--output", "json", "--no-input"];

		for (const [key, value] of Object.entries(args)) {
			const flag = `--${key}`;
			if (typeof value === "boolean") {
				if (value) {
					result.push(flag);
				}
			} else {
				result.push(flag, String(value));
			}
		}

		return result;
	}

	/**
	 * Builds the environment variables for the CLI subprocess.
	 * Injects META_ACCESS_TOKEN and META_AD_ACCOUNT_ID if configured.
	 */
	private buildEnv(): NodeJS.ProcessEnv {
		const env = { ...process.env };

		if (this.config.accessToken) {
			env.META_ACCESS_TOKEN = this.config.accessToken;
		}
		if (this.config.adAccountId) {
			env.META_AD_ACCOUNT_ID = this.config.adAccountId;
		}

		return env;
	}

	/**
	 * Parses the CLI's stdout as JSON. Handles cases where the CLI
	 * emits non-JSON prefixes (warnings, progress text) before the
	 * actual JSON payload.
	 */
	private parseOutput(stdout: string): unknown {
		const trimmed = stdout.trim();
		if (!trimmed) {
			return {};
		}

		// Try parsing the full output first
		try {
			return JSON.parse(trimmed);
		} catch {
			// The CLI may emit non-JSON text before the JSON payload.
			// Find the first '{' or '[' and try parsing from there.
			const jsonStart = Math.min(
				trimmed.indexOf("{") === -1 ? Number.POSITIVE_INFINITY : trimmed.indexOf("{"),
				trimmed.indexOf("[") === -1 ? Number.POSITIVE_INFINITY : trimmed.indexOf("["),
			);

			if (jsonStart !== Number.POSITIVE_INFINITY) {
				try {
					return JSON.parse(trimmed.slice(jsonStart));
				} catch {
					// Fall through to return raw string
				}
			}

			// Return the raw output wrapped in an object if JSON parsing fails entirely
			return { raw: trimmed };
		}
	}

	/**
	 * Maps a CLI exit code to the appropriate typed error.
	 */
	private mapExitCodeToError(
		code: number,
		resource: string,
		action: string,
		stderr: string,
	): CliError | AuthError | NotFoundError {
		const context = `meta ads ${resource} ${action}`;

		switch (code) {
			case CliExitCode.Auth:
				return new AuthError(
					`Authentication failed for "${context}": ${stderr.trim() || "Invalid or expired access token"}`,
				);
			case CliExitCode.NotFound:
				return new NotFoundError(
					`Resource not found for "${context}": ${stderr.trim() || "The requested entity does not exist"}`,
				);
			case CliExitCode.Usage:
				return new CliError(
					`Invalid command usage for "${context}": ${stderr.trim() || "Check command syntax"}`,
					CliExitCode.Usage,
					stderr,
				);
			case CliExitCode.ApiError:
				return new CliError(
					`Meta API error for "${context}": ${stderr.trim() || "The API returned an error"}`,
					CliExitCode.ApiError,
					stderr,
				);
			default:
				return new CliError(
					`CLI command failed for "${context}" (exit code ${code}): ${stderr.trim() || "Unknown error"}`,
					code as CliExitCode,
					stderr,
				);
		}
	}
}
