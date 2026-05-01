/**
 * @module @meta-ads-agent/meta-client
 *
 * Direct Meta Marketing API client for the meta-ads-agent.
 *
 * All operations route through `graph.facebook.com/v21.0` via axios.
 * The package previously also exposed a Python-CLI wrapper layer
 * (`meta-ads` subprocess); that layer has been removed because the
 * published CLI's subcommand surface drifted from our wrapper
 * assumptions, breaking every CLI-backed tool at runtime. The
 * Marketing API is the source of truth and the only thing we
 * integrate with now.
 *
 * Capabilities:
 *  - Campaign / ad set / ad / creative CRUD
 *  - Insights queries (aggregated and breakdowns)
 *  - Custom and Lookalike audiences
 *  - Batch API for bulk operations (up to 50 per request)
 *  - A/B split tests
 *  - Automated ad rules
 *  - Ad preview generation
 *  - Token validation via /me
 *
 * Also includes:
 *  - Per-account rate-limit budget tracker (parses BUC headers).
 *  - Typed error hierarchy (MetaError, RateLimitError, AuthError, etc.).
 */

// ---------------------------------------------------------------------------
// Primary client
// ---------------------------------------------------------------------------

export { MetaClient } from "./client.js";
export type { MetaIdentity } from "./client.js";

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
	CreateAudienceParams,
	CreateLookalikeParams,
	CreateSplitTestParams,
	CreateRuleParams,
	UpdateRuleParams,
} from "./types.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export {
	MetaError,
	RateLimitError,
	AuthError,
	NotFoundError,
	ValidationError,
} from "./errors.js";

// ---------------------------------------------------------------------------
// API endpoints (low-level access for advanced usage)
// ---------------------------------------------------------------------------

export { ApiClient } from "./api/client.js";
export type { ApiClientConfig, ApiResponse } from "./api/client.js";
export { RateLimiter } from "./api/rate-limiter.js";
export { CampaignEndpoints } from "./api/endpoints/campaigns.js";
export { AdSetEndpoints } from "./api/endpoints/adsets.js";
export { AdEndpoints } from "./api/endpoints/ads.js";
export { CreativeEndpoints } from "./api/endpoints/creatives.js";
export { InsightsEndpoints } from "./api/endpoints/insights.js";
export { AudienceEndpoints } from "./api/endpoints/audiences.js";
export { BatchEndpoints } from "./api/endpoints/batch.js";
export { SplitTestEndpoints } from "./api/endpoints/split-tests.js";
export { RulesEndpoints } from "./api/endpoints/rules.js";
export { PreviewEndpoints } from "./api/endpoints/previews.js";
