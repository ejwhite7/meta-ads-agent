/**
 * @module @meta-ads-agent/meta-client
 *
 * Hybrid Meta integration layer combining two access patterns:
 *
 * 1. **CLI Wrapper** (`./cli/`): Spawns the official `meta-ads` Python CLI
 *    as a subprocess. Covers 47 commands across 11 resource groups:
 *    campaigns, ad sets, ads, creatives, datasets, catalogs, product items,
 *    product sets, insights, ad accounts, pages, and authentication.
 *    Uses --output json --no-input for machine-readable, non-interactive
 *    execution. Handles exit codes 0-5 with appropriate retry/halt logic.
 *
 * 2. **Direct API Client** (`./api/`): axios-based client calling
 *    graph.facebook.com/v21.0 directly for capabilities the CLI lacks:
 *    - Custom and Lookalike Audience management
 *    - Batch operations for bulk changes (up to 50 per request)
 *    - A/B test creation and management
 *    - Automated ad rules engine
 *    - Ad preview generation in various placement formats
 *
 * Also includes:
 * - Rate limit budget tracker (per-account token budget from BUC headers)
 * - Typed error hierarchy (MetaError, RateLimitError, AuthError, etc.)
 *
 * Architecture reference: see CLAUDE.md sections 4 and 13 in the repo root.
 */

// ---------------------------------------------------------------------------
// Primary Client
// ---------------------------------------------------------------------------

export { MetaClient } from "./client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
	// Entity types
	Campaign,
	AdSet,
	Ad,
	AdCreative,
	ObjectStorySpec,
	TargetingSpec,
	InsightsResult,
	InsightsAction,
	CustomAudience,
	SplitTest,
	SplitTestCell,
	SplitTestResults,
	AdRule,
	AdRuleEvaluationSpec,
	AdRuleExecutionSpec,
	AdRuleScheduleSpec,
	AdRulePreview,
	BatchRequest,
	BatchResponse,
	AdPreview,
	Catalog,
	ProductSet,
	ProductItem,
	Dataset,
	// Configuration
	MetaClientConfig,
	// Entity status types
	EntityStatus,
	CampaignObjective,
	OptimizationGoal,
	BidStrategy,
	AdPreviewFormat,
	// Create/Update parameter types
	CreateCampaignParams,
	UpdateCampaignParams,
	CreateAdSetParams,
	UpdateAdSetParams,
	CreateAdParams,
	UpdateAdParams,
	CreateCreativeParams,
	UpdateCreativeParams,
	InsightsQueryParams,
	CreateCatalogParams,
	UpdateCatalogParams,
	CreateProductSetParams,
	UpdateProductSetParams,
	CreateProductItemParams,
	UpdateProductItemParams,
	CreateDatasetParams,
	UpdateDatasetParams,
	DatasetUploadParams,
	CreateAudienceParams,
	CreateLookalikeParams,
	CreateSplitTestParams,
	CreateRuleParams,
	UpdateRuleParams,
} from "./types.js";

export { CliExitCode } from "./types.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export {
	MetaError,
	RateLimitError,
	AuthError,
	NotFoundError,
	CliError,
	ValidationError,
} from "./errors.js";

// ---------------------------------------------------------------------------
// CLI Layer
// ---------------------------------------------------------------------------

export { CLIWrapper } from "./cli/wrapper.js";
export { AuthCommands } from "./cli/commands/auth.js";
export { CampaignCommands } from "./cli/commands/campaigns.js";
export { AdSetCommands } from "./cli/commands/adsets.js";
export { AdCommands } from "./cli/commands/ads.js";
export { CreativeCommands } from "./cli/commands/creatives.js";
export { InsightsCommands } from "./cli/commands/insights.js";
export { CatalogCommands } from "./cli/commands/catalogs.js";
export { DatasetCommands } from "./cli/commands/datasets.js";

export type {
	CliCommand,
	CliArgs,
	CliResult,
	CliWrapperConfig,
} from "./cli/types.js";

// ---------------------------------------------------------------------------
// API Layer
// ---------------------------------------------------------------------------

export { ApiClient } from "./api/client.js";
export type { ApiClientConfig, ApiResponse } from "./api/client.js";
export { RateLimiter } from "./api/rate-limiter.js";
export { AudienceEndpoints } from "./api/endpoints/audiences.js";
export { BatchEndpoints } from "./api/endpoints/batch.js";
export { SplitTestEndpoints } from "./api/endpoints/split-tests.js";
export { RulesEndpoints } from "./api/endpoints/rules.js";
export { PreviewEndpoints } from "./api/endpoints/previews.js";
