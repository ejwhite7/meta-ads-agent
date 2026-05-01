/**
 * @module client
 *
 * MetaClient -- the unified entry point for all Meta advertising operations.
 *
 * **All operations now route through the Marketing API directly (axios).**
 *
 * Earlier versions hybrid-routed standard CRUD through the `meta-ads`
 * Python CLI and only fell back to the API for capabilities the CLI
 * lacked (audiences, batch, split tests, etc.). That hybrid approach
 * was retired because the published Python CLI's subcommand surface had
 * drifted from our wrapper assumptions, breaking every CLI-backed tool
 * at runtime (no `auth` subcommand, singular nouns instead of plural,
 * different env var names, etc.).
 *
 * The all-API architecture has several upsides:
 *   - One auth flow, one rate limiter, one error model.
 *   - No Python runtime dependency.
 *   - No subprocess spawn / JSON-reparse on every read.
 *   - Stable, versioned surface (graph.facebook.com/v21.0).
 */

import { ApiClient } from "./api/client.js";
import { AdEndpoints } from "./api/endpoints/ads.js";
import { AdSetEndpoints } from "./api/endpoints/adsets.js";
import { AudienceEndpoints } from "./api/endpoints/audiences.js";
import { BatchEndpoints } from "./api/endpoints/batch.js";
import { CampaignEndpoints } from "./api/endpoints/campaigns.js";
import { CreativeEndpoints } from "./api/endpoints/creatives.js";
import { InsightsEndpoints } from "./api/endpoints/insights.js";
import { PreviewEndpoints } from "./api/endpoints/previews.js";
import { RulesEndpoints } from "./api/endpoints/rules.js";
import { SplitTestEndpoints } from "./api/endpoints/split-tests.js";
import { AuthError } from "./errors.js";
import type { MetaClientConfig } from "./types.js";

/**
 * Identity returned by GET /me, used by `auth.whoami()` to verify a token
 * is alive. The Marketing API doesn't have a notion of "logout" beyond
 * deleting the token in Business Settings; we expose `whoami` only.
 */
export interface MetaIdentity {
	id: string;
	name: string;
}

/**
 * Auth helper that probes the token via the Graph API's /me endpoint.
 * Replaces the previous CLI-based AuthCommands which called the
 * non-existent `meta ads auth status` subcommand.
 */
class AuthClient {
	constructor(private readonly api: ApiClient) {}

	/**
	 * Returns the authenticated user/system-user identity, throwing
	 * AuthError if the token is invalid.
	 */
	async whoami(): Promise<MetaIdentity> {
		try {
			const me = await this.api.get<MetaIdentity>("/me", {
				params: { fields: "id,name" },
			});
			if (!me?.id && !me?.name) {
				throw new AuthError("Graph API /me returned no identity for the access token.");
			}
			return me;
		} catch (err: unknown) {
			if (err instanceof AuthError) throw err;
			const message = err instanceof Error ? err.message : String(err);
			throw new AuthError(`Token validation failed: ${message}`);
		}
	}
}

/**
 * Unified Meta advertising client.
 *
 * **Layer: direct Marketing API endpoints** (graph.facebook.com/v21.0)
 *   - {@link campaigns} -- Campaign CRUD
 *   - {@link adSets}    -- Ad set CRUD
 *   - {@link ads}       -- Ad CRUD
 *   - {@link creatives} -- Creative CRUD
 *   - {@link insights}  -- Performance metrics queries
 *   - {@link audiences} -- Custom and Lookalike audiences
 *   - {@link batch}     -- Batch API for bulk operations
 *   - {@link splitTests}-- A/B split tests
 *   - {@link rules}     -- Automated ad rules
 *   - {@link previews}  -- Ad preview generation
 *   - {@link auth}      -- Token validation via /me
 *
 * @example
 * ```typescript
 * const client = new MetaClient({
 *   accessToken: process.env.META_ACCESS_TOKEN!,
 *   adAccountId: process.env.META_AD_ACCOUNT_ID!,
 * });
 * await client.initialize();
 *
 * const campaigns = await client.campaigns.list(client.config.adAccountId);
 * const insights  = await client.insights.query(client.config.adAccountId, {
 *   level: "campaign",
 *   date_preset: "last_7d",
 * });
 * ```
 */
export class MetaClient {
	/** Client configuration. */
	readonly config: MetaClientConfig;

	/** Token validation. */
	readonly auth: AuthClient;

	/** Campaign CRUD. */
	readonly campaigns: CampaignEndpoints;

	/** Ad set CRUD. */
	readonly adSets: AdSetEndpoints;

	/** Ad CRUD. */
	readonly ads: AdEndpoints;

	/** Creative CRUD. */
	readonly creatives: CreativeEndpoints;

	/** Performance insights queries. */
	readonly insights: InsightsEndpoints;

	/** Custom and Lookalike audience management. */
	readonly audiences: AudienceEndpoints;

	/** Batch API for bulk operations (up to 50 per request). */
	readonly batch: BatchEndpoints;

	/** A/B split test creation and result monitoring. */
	readonly splitTests: SplitTestEndpoints;

	/** Automated ad rules engine. */
	readonly rules: RulesEndpoints;

	/** Ad preview generation in various placement formats. */
	readonly previews: PreviewEndpoints;

	/** Underlying API client for advanced usage. */
	private readonly api: ApiClient;

	/**
	 * Creates a new MetaClient instance. Call {@link initialize} after
	 * construction to validate authentication.
	 */
	constructor(config: MetaClientConfig) {
		this.config = config;

		this.api = new ApiClient({
			accessToken: config.accessToken,
			adAccountId: config.adAccountId,
			maxRetries: config.maxRetries ?? 3,
			rateLimitThreshold: config.rateLimitThreshold ?? 75,
		});

		this.auth = new AuthClient(this.api);
		this.campaigns = new CampaignEndpoints(this.api);
		this.adSets = new AdSetEndpoints(this.api);
		this.ads = new AdEndpoints(this.api);
		this.creatives = new CreativeEndpoints(this.api);
		this.insights = new InsightsEndpoints(this.api);
		this.audiences = new AudienceEndpoints(this.api);
		this.batch = new BatchEndpoints(this.api);
		this.splitTests = new SplitTestEndpoints(this.api);
		this.rules = new RulesEndpoints(this.api);
		this.previews = new PreviewEndpoints(this.api);
	}

	/**
	 * Validates authentication by calling /me on the Graph API.
	 *
	 * Should be called after construction and before any operations.
	 *
	 * @throws {AuthError} If access token is missing or invalid.
	 */
	async initialize(): Promise<void> {
		if (!this.config.accessToken) {
			throw new AuthError(
				"No access token provided. Set META_ACCESS_TOKEN environment variable " +
					"or pass accessToken in MetaClientConfig.",
			);
		}
		if (!this.config.adAccountId) {
			throw new AuthError(
				"No ad account ID provided. Set META_AD_ACCOUNT_ID environment variable " +
					"or pass adAccountId in MetaClientConfig.",
			);
		}

		await this.auth.whoami();
	}
}
