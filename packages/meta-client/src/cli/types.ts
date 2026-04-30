/**
 * @module cli/types
 *
 * Type definitions specific to the CLI wrapper layer. Defines the structure
 * of CLI commands, argument maps, and execution results used by the
 * CLIWrapper class and all command modules.
 */

/**
 * A fully-qualified CLI command consisting of a resource group and action.
 * Maps to the `meta ads <resource> <action>` invocation pattern.
 *
 * @example
 * ```typescript
 * const cmd: CliCommand = { resource: "campaigns", action: "list" };
 * // Invokes: meta ads campaigns list
 * ```
 */
export interface CliCommand {
	/** Resource group (e.g., "campaigns", "ad-sets", "ads"). */
	resource: string;
	/** Action to perform (e.g., "list", "show", "create", "update", "delete"). */
	action: string;
}

/**
 * Named arguments passed to a CLI command as `--key value` flags.
 * Boolean values produce flags without a value (e.g., `--force`).
 * String and number values are passed as `--key value`.
 */
export type CliArgs = Record<string, string | number | boolean>;

/**
 * Result of a CLI command execution, containing parsed output and
 * process metadata.
 */
export interface CliResult<T = unknown> {
	/** Parsed JSON output from the CLI's stdout. */
	data: T;
	/** Process exit code (0 for success). */
	exitCode: number;
	/** Raw stdout text from the process. */
	stdout: string;
	/** Raw stderr text from the process. */
	stderr: string;
}

/**
 * Configuration options for the CLI wrapper.
 */
export interface CliWrapperConfig {
	/**
	 * Path or command name for the meta-ads CLI.
	 * Defaults to "meta" (assumes it's on the system PATH).
	 */
	cliPath: string;
	/**
	 * Maximum time in milliseconds to wait for a command to complete.
	 * Defaults to 30000 (30 seconds).
	 */
	timeout: number;
	/**
	 * Meta access token to pass via environment variable.
	 * If not set, the CLI will use the META_ACCESS_TOKEN env var from the
	 * parent process.
	 */
	accessToken?: string;
	/**
	 * Default ad account ID to pass via environment variable.
	 * If not set, the CLI will use the META_AD_ACCOUNT_ID env var from the
	 * parent process.
	 */
	adAccountId?: string;
}
