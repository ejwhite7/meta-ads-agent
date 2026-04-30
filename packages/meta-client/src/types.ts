/**
 * @module types
 *
 * Core TypeScript type definitions for all Meta Marketing API entities,
 * CLI configuration, and shared data structures used across the meta-client
 * package. These types provide compile-time safety for campaign management,
 * audience targeting, insights reporting, and batch operations.
 */

// ---------------------------------------------------------------------------
// CLI Exit Codes
// ---------------------------------------------------------------------------

/**
 * Exit codes returned by the `meta-ads` Python CLI.
 * Used by the CLI wrapper to map process exit codes to typed errors.
 *
 * @see https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-cli/ads-cli-overview
 */
export enum CliExitCode {
	/** Command completed successfully. */
	Success = 0,
	/** General/unspecified error. */
	General = 1,
	/** Invalid command syntax or missing required arguments. */
	Usage = 2,
	/** Authentication failure — invalid or expired token. */
	Auth = 3,
	/** Meta Marketing API returned an error response. */
	ApiError = 4,
	/** The requested resource was not found. */
	NotFound = 5,
}

// ---------------------------------------------------------------------------
// Entity Statuses
// ---------------------------------------------------------------------------

/**
 * Effective status values for campaigns, ad sets, and ads in the Meta platform.
 */
export type EntityStatus =
	| "ACTIVE"
	| "PAUSED"
	| "DELETED"
	| "ARCHIVED"
	| "IN_PROCESS"
	| "WITH_ISSUES";

/**
 * Campaign objective types supported by Meta's Marketing API v21.0.
 */
export type CampaignObjective =
	| "OUTCOME_AWARENESS"
	| "OUTCOME_ENGAGEMENT"
	| "OUTCOME_LEADS"
	| "OUTCOME_SALES"
	| "OUTCOME_TRAFFIC"
	| "OUTCOME_APP_PROMOTION";

/**
 * Optimization goals available for ad set delivery configuration.
 */
export type OptimizationGoal =
	| "IMPRESSIONS"
	| "REACH"
	| "LINK_CLICKS"
	| "LANDING_PAGE_VIEWS"
	| "OFFSITE_CONVERSIONS"
	| "APP_INSTALLS"
	| "LEAD_GENERATION"
	| "VALUE"
	| "CONVERSATIONS";

/**
 * Bid strategy options for campaign spending controls.
 */
export type BidStrategy =
	| "LOWEST_COST_WITHOUT_CAP"
	| "LOWEST_COST_WITH_BID_CAP"
	| "COST_CAP"
	| "MINIMUM_ROAS";

// ---------------------------------------------------------------------------
// Core Entities
// ---------------------------------------------------------------------------

/**
 * Represents a Meta advertising campaign.
 * Campaigns are the top-level container for ad sets and ads.
 */
export interface Campaign {
	/** Unique campaign identifier assigned by Meta. */
	id: string;
	/** Human-readable campaign name. */
	name: string;
	/** Current campaign status. */
	status: EntityStatus;
	/** Campaign optimization objective. */
	objective: CampaignObjective;
	/** Daily budget in account currency cents (e.g., 5000 = $50.00). */
	daily_budget?: string;
	/** Lifetime budget in account currency cents. */
	lifetime_budget?: string;
	/** Bid strategy for the campaign. */
	bid_strategy?: BidStrategy;
	/** ISO 8601 timestamp of campaign creation. */
	created_time: string;
	/** ISO 8601 timestamp of last update. */
	updated_time: string;
}

/**
 * Represents a Meta ad set — a group of ads within a campaign that share
 * targeting, budget, schedule, and bidding configuration.
 */
export interface AdSet {
	/** Unique ad set identifier assigned by Meta. */
	id: string;
	/** Human-readable ad set name. */
	name: string;
	/** Parent campaign identifier. */
	campaign_id: string;
	/** Current ad set status. */
	status: EntityStatus;
	/** Targeting specification (country-level from CLI). */
	targeting: TargetingSpec;
	/** Bid amount in account currency cents. */
	bid_amount?: string;
	/** Daily budget in account currency cents. */
	daily_budget?: string;
	/** Delivery optimization goal. */
	optimization_goal: OptimizationGoal;
	/** ISO 8601 start time for ad delivery. */
	start_time?: string;
	/** ISO 8601 end time for ad delivery. */
	end_time?: string;
	/** ISO 8601 timestamp of creation. */
	created_time: string;
	/** ISO 8601 timestamp of last update. */
	updated_time: string;
}

/**
 * Targeting specification for ad delivery.
 * The CLI supports country-level targeting; the direct API supports full
 * demographic, interest, and behavioral targeting.
 */
export interface TargetingSpec {
	/** Target countries as ISO 3166-1 alpha-2 codes (e.g., ["US", "CA"]). */
	geo_locations?: {
		countries?: string[];
		regions?: Array<{ key: string }>;
		cities?: Array<{ key: string; radius?: number; distance_unit?: string }>;
	};
	/** Age range for targeting. */
	age_min?: number;
	/** Maximum age for targeting. */
	age_max?: number;
	/** Gender targeting: 1 = male, 2 = female. Omit for all. */
	genders?: number[];
	/** Interest-based targeting (direct API only). */
	interests?: Array<{ id: string; name: string }>;
	/** Behavioral targeting (direct API only). */
	behaviors?: Array<{ id: string; name: string }>;
	/** Custom audience IDs to include. */
	custom_audiences?: Array<{ id: string }>;
	/** Custom audience IDs to exclude. */
	excluded_custom_audiences?: Array<{ id: string }>;
}

/**
 * Represents a Meta ad — the combination of creative and placement
 * configuration within an ad set.
 */
export interface Ad {
	/** Unique ad identifier assigned by Meta. */
	id: string;
	/** Human-readable ad name. */
	name: string;
	/** Parent ad set identifier. */
	adset_id: string;
	/** Current ad status. */
	status: EntityStatus;
	/** Associated creative identifier. */
	creative_id: string;
	/** ISO 8601 timestamp of creation. */
	created_time: string;
	/** ISO 8601 timestamp of last update. */
	updated_time: string;
}

/**
 * Represents a Meta ad creative — the visual and textual content of an ad.
 */
export interface AdCreative {
	/** Unique creative identifier assigned by Meta. */
	id: string;
	/** Human-readable creative name. */
	name: string;
	/** Story specification defining the ad format and content. */
	object_story_spec?: ObjectStorySpec;
	/** Hash of the uploaded image asset. */
	image_hash?: string;
	/** Identifier of the uploaded video asset. */
	video_id?: string;
	/** Primary text / body copy of the ad. */
	body?: string;
	/** Headline text of the ad. */
	title?: string;
	/** Destination URL when the ad is clicked. */
	link_url?: string;
	/** Call-to-action type (e.g., "LEARN_MORE", "SHOP_NOW"). */
	call_to_action_type?: string;
}

/**
 * Defines how an ad creative renders as a Page post or story.
 */
export interface ObjectStorySpec {
	/** Facebook Page ID that owns the ad post. */
	page_id: string;
	/** Link ad data. */
	link_data?: {
		link: string;
		message?: string;
		image_hash?: string;
		call_to_action?: { type: string; value?: { link: string } };
	};
	/** Video ad data. */
	video_data?: {
		video_id: string;
		message?: string;
		title?: string;
		image_hash?: string;
		call_to_action?: { type: string; value?: { link: string } };
	};
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

/**
 * Performance metrics returned by the Meta Insights API.
 * Includes standard delivery metrics plus computed ROAS.
 */
export interface InsightsResult {
	/** Campaign identifier (present when level includes campaign). */
	campaign_id?: string;
	/** Campaign name. */
	campaign_name?: string;
	/** Ad set identifier (present when level includes adset). */
	adset_id?: string;
	/** Ad set name. */
	adset_name?: string;
	/** Ad identifier (present when level includes ad). */
	ad_id?: string;
	/** Ad name. */
	ad_name?: string;
	/** Total number of impressions. */
	impressions: string;
	/** Total number of clicks. */
	clicks: string;
	/** Total spend in account currency (e.g., "123.45"). */
	spend: string;
	/** Action breakdown (conversions, leads, purchases, etc.). */
	actions?: InsightsAction[];
	/** Click-through rate as a decimal string. */
	ctr: string;
	/** Cost per mille (cost per 1,000 impressions). */
	cpm: string;
	/** Cost per click. */
	cpc?: string;
	/** Return on ad spend — computed from purchase value / spend. */
	roas?: number;
	/** Start date of the reporting period (YYYY-MM-DD). */
	date_start: string;
	/** End date of the reporting period (YYYY-MM-DD). */
	date_stop: string;
}

/**
 * A single action type and its count from the Insights API.
 */
export interface InsightsAction {
	/** Action type identifier (e.g., "purchase", "lead", "link_click"). */
	action_type: string;
	/** Number of times this action occurred. */
	value: string;
}

// ---------------------------------------------------------------------------
// Audiences (Direct API)
// ---------------------------------------------------------------------------

/**
 * Represents a custom audience in Meta's advertising platform.
 * Custom audiences can be based on customer lists, website visitors,
 * app activity, or engagement with Meta content.
 */
export interface CustomAudience {
	/** Unique audience identifier assigned by Meta. */
	id: string;
	/** Human-readable audience name. */
	name: string;
	/** Audience subtype indicating the data source. */
	subtype:
		| "CUSTOM"
		| "WEBSITE"
		| "APP"
		| "OFFLINE"
		| "CLAIM"
		| "PARTNER"
		| "MANAGED"
		| "VIDEO"
		| "LOOKALIKE"
		| "ENGAGEMENT";
	/** Estimated number of users in the audience. */
	approximate_count?: number;
	/** Number of days users are retained in the audience. */
	retention_days?: number;
	/** Delivery status of the audience. */
	delivery_status?: { status: string };
	/** Description of the audience. */
	description?: string;
}

// ---------------------------------------------------------------------------
// Split Tests (Direct API)
// ---------------------------------------------------------------------------

/**
 * Represents an A/B split test for comparing ad variations.
 */
export interface SplitTest {
	/** Unique split test identifier. */
	id: string;
	/** Human-readable test name. */
	name: string;
	/** Current test status. */
	status: "ACTIVE" | "PAUSED" | "COMPLETED" | "ARCHIVED";
	/** Type of variable being tested. */
	split_test_type: "CREATIVE" | "AUDIENCE" | "PLACEMENT" | "DELIVERY_OPTIMIZATION";
	/** Individual test cells (variations being compared). */
	cells: SplitTestCell[];
	/** ISO 8601 start time of the test. */
	start_time?: string;
	/** ISO 8601 end time of the test. */
	end_time?: string;
	/** Budget allocated to the split test in cents. */
	budget?: string;
}

/**
 * A single cell (variation) within a split test.
 */
export interface SplitTestCell {
	/** Cell identifier. */
	id: string;
	/** Cell name / label. */
	name: string;
	/** Percentage of traffic allocated to this cell. */
	traffic_split: number;
	/** Ad set ID associated with this cell. */
	adset_id?: string;
}

/**
 * Aggregated results for a completed or in-progress split test.
 */
export interface SplitTestResults {
	/** Split test identifier. */
	split_test_id: string;
	/** Whether the test has reached statistical significance. */
	is_significant: boolean;
	/** Confidence level as a decimal (e.g., 0.95 = 95%). */
	confidence_level?: number;
	/** Winning cell identifier (if significant). */
	winner_cell_id?: string;
	/** Per-cell performance metrics. */
	cell_results: Array<{
		cell_id: string;
		impressions: string;
		clicks: string;
		spend: string;
		conversions?: string;
		ctr: string;
		cpc: string;
	}>;
}

// ---------------------------------------------------------------------------
// Ad Rules (Direct API)
// ---------------------------------------------------------------------------

/**
 * Represents an automated ad rule that performs actions based on
 * performance conditions.
 */
export interface AdRule {
	/** Unique rule identifier. */
	id: string;
	/** Human-readable rule name. */
	name: string;
	/** Whether the rule is currently active. */
	status: "ENABLED" | "DISABLED" | "DELETED";
	/** Conditions that trigger the rule. */
	evaluation_spec: AdRuleEvaluationSpec;
	/** Actions to take when conditions are met. */
	execution_spec: AdRuleExecutionSpec;
	/** Schedule for rule evaluation. */
	schedule_spec: AdRuleScheduleSpec;
	/** Entity type the rule applies to. */
	entity_type?: "CAMPAIGN" | "ADSET" | "AD";
}

/**
 * Evaluation conditions for an ad rule.
 */
export interface AdRuleEvaluationSpec {
	/** Evaluation type. */
	evaluation_type: "SCHEDULE" | "TRIGGER";
	/** Array of filter conditions (all must be met). */
	filters: Array<{
		/** Metric field to evaluate (e.g., "spend", "ctr", "impressions"). */
		field: string;
		/** Comparison operator. */
		operator: "GREATER_THAN" | "LESS_THAN" | "EQUAL" | "IN_RANGE" | "NOT_IN_RANGE";
		/** Threshold value(s) for comparison. */
		value: number | [number, number];
	}>;
}

/**
 * Actions executed when an ad rule's conditions are met.
 */
export interface AdRuleExecutionSpec {
	/** Type of action to perform. */
	execution_type:
		| "PAUSE"
		| "UNPAUSE"
		| "CHANGE_BUDGET"
		| "CHANGE_BID"
		| "ROTATE"
		| "NOTIFICATION";
	/** Execution options specific to the action type. */
	execution_options?: Array<{
		field: string;
		value: string | number;
		operator?: "INCREMENT" | "DECREMENT" | "SET";
	}>;
}

/**
 * Schedule configuration for ad rule evaluation.
 */
export interface AdRuleScheduleSpec {
	/** How the schedule is defined. */
	schedule_type: "SEMI_HOURLY" | "HOURLY" | "DAILY" | "CUSTOM";
	/** Specific times for custom schedules (cron-like). */
	schedule?: Array<{ days: number[]; hours: number[] }>;
}

/**
 * Preview of entities that would be affected by an ad rule.
 */
export interface AdRulePreview {
	/** Rule identifier. */
	rule_id: string;
	/** Entities that match the rule's evaluation criteria. */
	matched_entities: Array<{
		id: string;
		name: string;
		entity_type: string;
		current_metrics: Record<string, string | number>;
	}>;
}

// ---------------------------------------------------------------------------
// Batch Operations (Direct API)
// ---------------------------------------------------------------------------

/**
 * A single operation within a batch API request.
 * Up to 50 operations can be sent in a single batch call.
 */
export interface BatchRequest {
	/** HTTP method for this operation. */
	method: "GET" | "POST" | "DELETE";
	/** Relative URL path (e.g., "/act_123456/campaigns"). */
	relative_url: string;
	/** Request body for POST operations (URL-encoded or JSON string). */
	body?: string;
	/** Optional name to identify this operation in the response. */
	name?: string;
}

/**
 * Response for a single operation within a batch API response.
 */
export interface BatchResponse {
	/** HTTP status code for this operation. */
	code: number;
	/** Response headers as key-value pairs. */
	headers?: Array<{ name: string; value: string }>;
	/** Response body (typically JSON-encoded string). */
	body: string;
	/** The name from the corresponding BatchRequest, if provided. */
	name?: string;
}

// ---------------------------------------------------------------------------
// Ad Previews (Direct API)
// ---------------------------------------------------------------------------

/**
 * Format options for ad preview generation.
 */
export type AdPreviewFormat =
	| "DESKTOP_FEED_STANDARD"
	| "MOBILE_FEED_STANDARD"
	| "INSTAGRAM_STANDARD"
	| "INSTAGRAM_STORY"
	| "RIGHT_COLUMN_STANDARD"
	| "MARKETPLACE_MOBILE";

/**
 * Generated ad preview containing an iframe embed code.
 */
export interface AdPreview {
	/** HTML iframe code for rendering the ad preview. */
	body: string;
}

// ---------------------------------------------------------------------------
// Catalogs and Products
// ---------------------------------------------------------------------------

/**
 * Represents a Meta product catalog for dynamic ads.
 */
export interface Catalog {
	/** Unique catalog identifier. */
	id: string;
	/** Catalog name. */
	name: string;
	/** Number of products in the catalog. */
	product_count?: number;
	/** Catalog vertical type. */
	vertical?: string;
}

/**
 * Represents a product set — a filtered subset of catalog products.
 */
export interface ProductSet {
	/** Unique product set identifier. */
	id: string;
	/** Product set name. */
	name: string;
	/** Parent catalog identifier. */
	catalog_id: string;
	/** Filter rules defining which products are included. */
	filter?: Record<string, unknown>;
	/** Number of products matching the filter. */
	product_count?: number;
}

/**
 * Represents an individual product item within a catalog.
 */
export interface ProductItem {
	/** Unique product item identifier. */
	id: string;
	/** Retailer-defined product ID. */
	retailer_id?: string;
	/** Product name / title. */
	name: string;
	/** Product description. */
	description?: string;
	/** Product URL on the retailer's website. */
	url?: string;
	/** Product image URL. */
	image_url?: string;
	/** Product price (e.g., "29.99 USD"). */
	price?: string;
	/** Product availability status. */
	availability?: "in stock" | "out of stock" | "preorder" | "available for order";
}

// ---------------------------------------------------------------------------
// Datasets / Pixels
// ---------------------------------------------------------------------------

/**
 * Represents a Meta dataset (pixel) for conversion tracking.
 */
export interface Dataset {
	/** Unique dataset identifier. */
	id: string;
	/** Dataset name. */
	name: string;
	/** Whether the dataset is currently active. */
	is_active?: boolean;
	/** Number of events received in the last 24 hours. */
	event_count_24h?: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for initializing a MetaClient instance.
 * Supports both CLI-based and direct API access patterns.
 */
export interface MetaClientConfig {
	/** Meta system user access token for API authentication. */
	accessToken: string;
	/** Meta ad account ID (format: "act_XXXXXXXXX"). */
	adAccountId: string;
	/** Meta app ID (optional, used for certain API operations). */
	appId?: string;
	/** Meta app secret (optional, used for certain API operations). */
	appSecret?: string;
	/**
	 * Path or command name for the meta-ads CLI executable.
	 * Defaults to "meta" (assumes it's on the system PATH).
	 */
	cliPath?: string;
	/**
	 * Maximum time in milliseconds to wait for a CLI command to complete.
	 * Defaults to 30000 (30 seconds).
	 */
	cliTimeout?: number;
	/**
	 * Maximum number of retry attempts for transient API errors.
	 * Defaults to 3.
	 */
	maxRetries?: number;
	/**
	 * Rate limit usage threshold (0-100) at which requests are delayed.
	 * Defaults to 75.
	 */
	rateLimitThreshold?: number;
}

// ---------------------------------------------------------------------------
// Create / Update Parameter Types
// ---------------------------------------------------------------------------

/** Parameters for creating a new campaign. */
export interface CreateCampaignParams {
	/** Campaign name. */
	name: string;
	/** Campaign objective. */
	objective: CampaignObjective;
	/** Initial campaign status. Defaults to "PAUSED". */
	status?: EntityStatus;
	/** Daily budget in account currency cents. */
	daily_budget?: string;
	/** Lifetime budget in account currency cents. */
	lifetime_budget?: string;
	/** Bid strategy. */
	bid_strategy?: BidStrategy;
	/** Special ad categories (e.g., "HOUSING", "EMPLOYMENT", "CREDIT"). */
	special_ad_categories?: string[];
}

/** Parameters for updating an existing campaign. */
export interface UpdateCampaignParams {
	/** Updated campaign name. */
	name?: string;
	/** Updated status. */
	status?: EntityStatus;
	/** Updated daily budget in account currency cents. */
	daily_budget?: string;
	/** Updated lifetime budget in account currency cents. */
	lifetime_budget?: string;
	/** Updated bid strategy. */
	bid_strategy?: BidStrategy;
}

/** Parameters for creating a new ad set. */
export interface CreateAdSetParams {
	/** Ad set name. */
	name: string;
	/** Parent campaign ID. */
	campaign_id: string;
	/** Initial status. Defaults to "PAUSED". */
	status?: EntityStatus;
	/** Targeting specification. */
	targeting: TargetingSpec;
	/** Daily budget in cents. */
	daily_budget?: string;
	/** Bid amount in cents. */
	bid_amount?: string;
	/** Optimization goal for delivery. */
	optimization_goal: OptimizationGoal;
	/** ISO 8601 start time. */
	start_time?: string;
	/** ISO 8601 end time. */
	end_time?: string;
	/** Billing event type. */
	billing_event?: "IMPRESSIONS" | "LINK_CLICKS" | "APP_INSTALLS";
}

/** Parameters for updating an existing ad set. */
export interface UpdateAdSetParams {
	/** Updated ad set name. */
	name?: string;
	/** Updated status. */
	status?: EntityStatus;
	/** Updated targeting specification. */
	targeting?: TargetingSpec;
	/** Updated daily budget in cents. */
	daily_budget?: string;
	/** Updated bid amount in cents. */
	bid_amount?: string;
	/** Updated optimization goal. */
	optimization_goal?: OptimizationGoal;
	/** Updated start time. */
	start_time?: string;
	/** Updated end time. */
	end_time?: string;
}

/** Parameters for creating a new ad. */
export interface CreateAdParams {
	/** Ad name. */
	name: string;
	/** Parent ad set ID. */
	adset_id: string;
	/** Creative ID to associate with the ad. */
	creative_id: string;
	/** Initial status. Defaults to "PAUSED". */
	status?: EntityStatus;
}

/** Parameters for updating an existing ad. */
export interface UpdateAdParams {
	/** Updated ad name. */
	name?: string;
	/** Updated status. */
	status?: EntityStatus;
	/** Updated creative ID. */
	creative_id?: string;
}

/** Parameters for creating a new ad creative. */
export interface CreateCreativeParams {
	/** Creative name. */
	name: string;
	/** Story specification. */
	object_story_spec?: ObjectStorySpec;
	/** Image hash for image ads. */
	image_hash?: string;
	/** Video ID for video ads. */
	video_id?: string;
	/** Primary text. */
	body?: string;
	/** Headline. */
	title?: string;
	/** Destination URL. */
	link_url?: string;
	/** Call-to-action type. */
	call_to_action_type?: string;
}

/** Parameters for updating an existing creative. */
export interface UpdateCreativeParams {
	/** Updated creative name. */
	name?: string;
	/** Updated story specification. */
	object_story_spec?: ObjectStorySpec;
	/** Updated primary text. */
	body?: string;
	/** Updated headline. */
	title?: string;
	/** Updated destination URL. */
	link_url?: string;
}

/** Parameters for querying insights (performance metrics). */
export interface InsightsQueryParams {
	/** Aggregation level for metrics. */
	level: "account" | "campaign" | "adset" | "ad";
	/** Predefined date range shortcut. */
	date_preset?:
		| "today"
		| "yesterday"
		| "this_month"
		| "last_month"
		| "last_7d"
		| "last_14d"
		| "last_28d"
		| "last_30d"
		| "last_90d";
	/** Custom date range (overrides date_preset). */
	time_range?: {
		since: string;
		until: string;
	};
	/** Metric fields to retrieve. */
	fields?: string[];
	/** Breakdown dimensions for the report. */
	breakdowns?: string[];
	/** Filter conditions. */
	filtering?: Array<{
		field: string;
		operator: "EQUAL" | "NOT_EQUAL" | "GREATER_THAN" | "LESS_THAN" | "IN" | "NOT_IN";
		value: string | string[];
	}>;
}

/** Parameters for creating a new catalog. */
export interface CreateCatalogParams {
	/** Catalog name. */
	name: string;
	/** Catalog vertical type. */
	vertical?: string;
}

/** Parameters for updating an existing catalog. */
export interface UpdateCatalogParams {
	/** Updated catalog name. */
	name?: string;
}

/** Parameters for creating a new product set. */
export interface CreateProductSetParams {
	/** Product set name. */
	name: string;
	/** Filter rules for product inclusion. */
	filter?: Record<string, unknown>;
}

/** Parameters for updating an existing product set. */
export interface UpdateProductSetParams {
	/** Updated product set name. */
	name?: string;
	/** Updated filter rules. */
	filter?: Record<string, unknown>;
}

/** Parameters for creating a new product item. */
export interface CreateProductItemParams {
	/** Retailer product ID. */
	retailer_id: string;
	/** Product name. */
	name: string;
	/** Product description. */
	description?: string;
	/** Product URL. */
	url: string;
	/** Product image URL. */
	image_url: string;
	/** Product price (e.g., "29.99 USD"). */
	price: string;
	/** Product availability. */
	availability: "in stock" | "out of stock" | "preorder" | "available for order";
}

/** Parameters for updating an existing product item. */
export interface UpdateProductItemParams {
	/** Updated product name. */
	name?: string;
	/** Updated description. */
	description?: string;
	/** Updated URL. */
	url?: string;
	/** Updated image URL. */
	image_url?: string;
	/** Updated price. */
	price?: string;
	/** Updated availability. */
	availability?: "in stock" | "out of stock" | "preorder" | "available for order";
}

/** Parameters for creating a dataset (pixel). */
export interface CreateDatasetParams {
	/** Dataset name. */
	name: string;
}

/** Parameters for updating an existing dataset. */
export interface UpdateDatasetParams {
	/** Updated dataset name. */
	name?: string;
}

/** Parameters for uploading events to a dataset. */
export interface DatasetUploadParams {
	/** Array of conversion events to upload. */
	data: Array<{
		/** Event name (e.g., "Purchase", "Lead"). */
		event_name: string;
		/** Unix timestamp of the event. */
		event_time: number;
		/** User data for matching. */
		user_data: Record<string, string>;
		/** Custom data (e.g., value, currency). */
		custom_data?: Record<string, string | number>;
	}>;
}

// ---------------------------------------------------------------------------
// Audience Creation Parameters (Direct API)
// ---------------------------------------------------------------------------

/** Parameters for creating a custom audience. */
export interface CreateAudienceParams {
	/** Audience name. */
	name: string;
	/** Audience subtype. */
	subtype: "CUSTOM" | "WEBSITE" | "APP" | "OFFLINE" | "ENGAGEMENT";
	/** Audience description. */
	description?: string;
	/** Number of days to retain users in the audience. */
	retention_days?: number;
	/** Website audience rule (required for WEBSITE subtype). */
	rule?: string;
	/** Customer list data source (for CUSTOM subtype). */
	customer_file_source?: "USER_PROVIDED_ONLY" | "PARTNER_PROVIDED_ONLY" | "BOTH_USER_AND_PARTNER_PROVIDED";
}

/** Parameters for creating a lookalike audience. */
export interface CreateLookalikeParams {
	/** Name for the new lookalike audience. */
	name: string;
	/** Source audience ID to base the lookalike on. */
	source_audience_id: string;
	/** Target country as ISO 3166-1 alpha-2 code. */
	country: string;
	/** Lookalike ratio (0.01 to 0.20, where 0.01 = top 1% similarity). */
	ratio: number;
}

// ---------------------------------------------------------------------------
// Split Test Parameters (Direct API)
// ---------------------------------------------------------------------------

/** Parameters for creating an A/B split test. */
export interface CreateSplitTestParams {
	/** Test name. */
	name: string;
	/** Variable being tested. */
	split_test_type: "CREATIVE" | "AUDIENCE" | "PLACEMENT" | "DELIVERY_OPTIMIZATION";
	/** Campaign ID to run the test on. */
	campaign_id: string;
	/** Ad set IDs representing each test cell. */
	adset_ids: string[];
	/** Test budget in cents. */
	budget: string;
	/** Test end time as ISO 8601 string. */
	end_time: string;
}

// ---------------------------------------------------------------------------
// Ad Rule Parameters (Direct API)
// ---------------------------------------------------------------------------

/** Parameters for creating an automated ad rule. */
export interface CreateRuleParams {
	/** Rule name. */
	name: string;
	/** Evaluation conditions. */
	evaluation_spec: AdRuleEvaluationSpec;
	/** Actions to execute. */
	execution_spec: AdRuleExecutionSpec;
	/** Evaluation schedule. */
	schedule_spec: AdRuleScheduleSpec;
	/** Entity type to apply the rule to. */
	entity_type: "CAMPAIGN" | "ADSET" | "AD";
}

/** Parameters for updating an existing ad rule. */
export interface UpdateRuleParams {
	/** Updated rule name. */
	name?: string;
	/** Updated status. */
	status?: "ENABLED" | "DISABLED";
	/** Updated evaluation conditions. */
	evaluation_spec?: AdRuleEvaluationSpec;
	/** Updated execution actions. */
	execution_spec?: AdRuleExecutionSpec;
	/** Updated schedule. */
	schedule_spec?: AdRuleScheduleSpec;
}
