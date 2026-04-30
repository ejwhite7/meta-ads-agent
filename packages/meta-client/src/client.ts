/**
 * @module client
 *
 * MetaClient facade that composes both the CLI wrapper layer and the direct
 * API client layer into a single, unified interface. This is the primary
 * entry point for all Meta advertising operations.
 *
 * The client exposes CLI-based command groups (campaigns, ad sets, ads,
 * creatives, insights, catalogs, datasets) alongside direct API endpoint
 * groups (audiences, batch, split tests, rules, previews) through a
 * consistent, typed interface.
 */

import type { MetaClientConfig } from "./types.js";
import { AuthError, CliError } from "./errors.js";
import { CLIWrapper } from "./cli/wrapper.js";
import { AuthCommands } from "./cli/commands/auth.js";
import { CampaignCommands } from "./cli/commands/campaigns.js";
import { AdSetCommands } from "./cli/commands/adsets.js";
import { AdCommands } from "./cli/commands/ads.js";
import { CreativeCommands } from "./cli/commands/creatives.js";
import { InsightsCommands } from "./cli/commands/insights.js";
import { CatalogCommands } from "./cli/commands/catalogs.js";
import { DatasetCommands } from "./cli/commands/datasets.js";
import { ApiClient } from "./api/client.js";
import { AudienceEndpoints } from "./api/endpoints/audiences.js";
import { BatchEndpoints } from "./api/endpoints/batch.js";
import { SplitTestEndpoints } from "./api/endpoints/split-tests.js";
import { RulesEndpoints } from "./api/endpoints/rules.js";
import { PreviewEndpoints } from "./api/endpoints/previews.js";

/**
 * Unified Meta advertising client combining CLI wrapper and direct API access.
 *
 * **Layer 1 — CLI Commands** (via `meta-ads` Python CLI subprocess):
 * - {@link campaigns} — Campaign CRUD (list, get, create, update, delete)
 * - {@link adSets} — Ad set CRUD with targeting and budget management
 * - {@link ads} — Ad CRUD linking creatives to ad sets
 * - {@link creatives} — Creative CRUD with media asset management
 * - {@link insights} — Performance metrics with ROAS computation
 * - {@link catalogs} — Product catalog, product set, and product item management
 * - {@link datasets} — Pixel/dataset management and event upload
 * - {@link auth} — Authentication status and session management
 *
 * **Layer 2 — Direct API Endpoints** (via `graph.facebook.com/v21.0`):
 * - {@link audiences} — Custom and Lookalike audience management
 * - {@link batch} — Batch API for bulk operations (up to 50 per request)
 * - {@link splitTests} — A/B split test creation and result monitoring
 * - {@link rules} — Automated ad rules engine
 * - {@link previews} — Ad preview generation in various formats
 *
 * @example
 * ```typescript
 * const client = new MetaClient({
 *   accessToken: process.env.META_ACCESS_TOKEN!,
 *   adAccountId: process.env.META_AD_ACCOUNT_ID!,
 * });
 *
 * await client.initialize();
 *
 * // CLI-based operations
 * const campaigns = await client.campaigns.list(client.config.adAccountId);
 * const insights = await client.insights.query(client.config.adAccountId, {
 *   level: "campaign",
 *   date_preset: "last_7d",
 * });
 *
 * // Direct API operations
 * const audiences = await client.audiences.listCustomAudiences(client.config.adAccountId);
 * const preview = await client.previews.getAdPreview("ad_123", "MOBILE_FEED_STANDARD");
 * ```
 */
export class MetaClient {
	/** Client configuration. */
	readonly config: MetaClientConfig;

	// -----------------------------------------------------------------------
	// CLI Command Groups (Layer 1)
	// -----------------------------------------------------------------------

	/** Authentication commands (whoami, logout). */
	readonly auth: AuthCommands;

	/** Campaign CRUD operations. */
	readonly campaigns: CampaignCommands;

	/** Ad set CRUD operations with targeting and budget management. */
	readonly adSets: AdSetCommands;

	/** Ad CRUD operations. */
	readonly ads: AdCommands;

	/** Creative CRUD operations with media asset management. */
	readonly creatives: CreativeCommands;

	/** Performance insights queries with automatic ROAS computation. */
	readonly insights: InsightsCommands;

	/** Product catalog, product set, and product item management. */
	readonly catalogs: CatalogCommands;

	/** Dataset (pixel) management and event upload. */
	readonly datasets: DatasetCommands;

	// -----------------------------------------------------------------------
	// Direct API Endpoint Groups (Layer 2)
	// -----------------------------------------------------------------------

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

	/** Underlying CLI wrapper for advanced usage. */
	private readonly cli: CLIWrapper;

	/** Underlying API client for advanced usage. */
	private readonly api: ApiClient;

	/**
	 * Creates a new MetaClient instance. Call {@link initialize} after
	 * construction to validate authentication and CLI availability.
	 *
	 * @param config - Client configuration including access token and ad account ID.
	 */
	constructor(config: MetaClientConfig) {
		this.config = config;

		// Initialize CLI wrapper (Layer 1)
		this.cli = new CLIWrapper({
			cliPath: config.cliPath ?? "meta",
			timeout: config.cliTimeout ?? 30_000,
			accessToken: config.accessToken,
			adAccountId: config.adAccountId,
		});

		// Initialize API client (Layer 2)
		this.api = new ApiClient({
			accessToken: config.accessToken,
			adAccountId: config.adAccountId,
			maxRetries: config.maxRetries ?? 3,
			rateLimitThreshold: config.rateLimitThreshold ?? 75,
		});

		// Wire up CLI command groups
		this.auth = new AuthCommands(this.cli);
		this.campaigns = new CampaignCommands(this.cli);
		this.adSets = new AdSetCommands(this.cli);
		this.ads = new AdCommands(this.cli);
		this.creatives = new CreativeCommands(this.cli);
		this.insights = new InsightsCommands(this.cli);
		this.catalogs = new CatalogCommands(this.cli);
		this.datasets = new DatasetCommands(this.cli);

		// Wire up direct API endpoint groups
		this.audiences = new AudienceEndpoints(this.api);
		this.batch = new BatchEndpoints(this.api);
		this.splitTests = new SplitTestEndpoints(this.api);
		this.rules = new RulesEndpoints(this.api);
		this.previews = new PreviewEndpoints(this.api);
	}

	/**
	 * Validates authentication token and CLI installation on startup.
	 * Should be called after construction and before any operations.
	 *
	 * Performs two checks:
	 * 1. Verifies the `meta-ads` CLI is installed and accessible.
	 * 2. Validates the access token by calling `auth status`.
	 *
	 * @throws {CliError} If the meta-ads CLI is not installed.
	 * @throws {AuthError} If the access token is invalid or expired.
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

		await this.cli.checkInstalled();
		await this.auth.whoami();
	}
}
