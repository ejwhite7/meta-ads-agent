/**
 * @module tools/budget/_client
 *
 * Internal helper for resolving the MetaClient used by budget tools.
 *
 * Budget tools follow a factory pattern: they accept an optional pre-bound
 * MetaClient at construction time. When no client is bound (e.g. the tool
 * lives in the static `budgetTools` array used by `allTools`), the client
 * is read from the ToolContext at execution time instead.
 *
 * This keeps the static-registration ergonomics in CLAUDE.md while still
 * letting callers create a tool bound to a specific client (useful for
 * multi-account scenarios and tests).
 */

import type { MetaClient } from "@meta-ads-agent/meta-client";
import type { ToolContext, ToolResult } from "../types.js";

/**
 * Result of attempting to resolve a MetaClient.
 *
 * `error` is non-null when neither a bound client nor a context client is
 * available; in that case the tool should return it directly as its result.
 */
export type ClientResolution =
	| { client: MetaClient; error: null }
	| { client: null; error: ToolResult };

/**
 * Resolves the MetaClient to use for a tool invocation.
 *
 * Preference order:
 *   1. The `bound` client passed to the factory at construction time.
 *   2. `context.metaClient` provided by the agent at execution time.
 *
 * Returns a structured error result if neither is available, so callers
 * can simply do `if (resolved.error) return resolved.error;`.
 *
 * @param bound - Optional pre-bound client (may be null).
 * @param context - Tool execution context.
 * @returns Resolved client, or a ToolResult describing the failure.
 */
export function resolveMetaClient(
	bound: MetaClient | null,
	context: ToolContext,
): ClientResolution {
	const candidate = (bound ?? (context.metaClient as MetaClient | undefined)) as
		| MetaClient
		| undefined;

	/* `campaigns` is the most universally accessed sub-client; if it's missing
	 * we have either an empty placeholder (`{} as MetaClient`) or no client at all. */
	if (!candidate || typeof candidate !== "object" || !("campaigns" in candidate)) {
		const message =
			"MetaClient is not available. Pass a client to the tool factory, " +
			"or ensure context.metaClient is set when the agent invokes the tool.";
		return {
			client: null,
			error: {
				success: false,
				data: null,
				error: message,
				message,
				errorCode: "META_CLIENT_UNAVAILABLE",
			},
		};
	}

	return { client: candidate, error: null };
}
