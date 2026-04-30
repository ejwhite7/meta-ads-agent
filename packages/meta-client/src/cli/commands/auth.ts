/**
 * @module cli/commands/auth
 *
 * Authentication commands for the Meta Ads CLI. Provides access to
 * `auth status` (whoami) and `auth logout` operations. The `auth setup`
 * command is intentionally excluded since it requires interactive input
 * and is not suitable for automation.
 */

import type { CLIWrapper } from "../wrapper.js";

/**
 * Authentication information returned by the `auth status` command.
 */
export interface AuthInfo {
	/** Authenticated user or system user name. */
	name: string;
	/** Meta user or system user ID. */
	id: string;
	/** Token type (e.g., "system_user"). */
	token_type?: string;
	/** Associated business ID. */
	business_id?: string;
	/** Associated business name. */
	business_name?: string;
}

/**
 * Wraps the `meta ads auth` CLI commands for checking authentication
 * status and managing sessions.
 */
export class AuthCommands {
	constructor(private readonly cli: CLIWrapper) {}

	/**
	 * Retrieves the current authentication status and user information.
	 * Equivalent to `meta ads auth status`.
	 *
	 * @returns Authentication details for the current access token.
	 * @throws {AuthError} If the token is invalid or expired.
	 */
	async whoami(): Promise<AuthInfo> {
		return this.cli.run<AuthInfo>("auth", "status", {});
	}

	/**
	 * Clears the stored authentication token.
	 * Equivalent to `meta ads auth logout`.
	 */
	async logout(): Promise<void> {
		await this.cli.run("auth", "logout", { force: true });
	}
}
