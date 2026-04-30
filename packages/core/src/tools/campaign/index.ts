/**
 * @module tools/campaign
 *
 * Campaign management tools for the meta-ads-agent autonomous agent.
 *
 * This module exports all campaign-related tools as an array that can be
 * bulk-registered in the tool registry. Each tool follows the factory-function
 * pattern defined in `tools/types.ts` and uses TypeBox schemas for runtime
 * parameter validation.
 *
 * **Tools included:**
 *
 * | Tool                  | OODA Phase | Description                                  |
 * |-----------------------|------------|----------------------------------------------|
 * | `list_campaigns`      | Observe    | List campaigns with performance metrics       |
 * | `pause_campaign`      | Act        | Pause a campaign with audit logging           |
 * | `scale_campaign`      | Act        | Scale budget with guardrail enforcement        |
 * | `create_campaign`     | Act        | Create a new campaign from spec               |
 * | `duplicate_campaign`  | Act        | Copy a campaign structure (paused for review) |
 * | `ab_test_campaign`    | Act        | Create A/B split tests                        |
 * | `analyze_performance` | Orient     | Analyze performance vs. goals                 |
 */

import type { TObject } from "@sinclair/typebox";
import type { Tool } from "../types.js";

import { abTestCampaignTool } from "./ab-test-campaign.js";
import { analyzePerformanceTool } from "./analyze-performance.js";
import { createCampaignTool } from "./create-campaign.js";
import { duplicateCampaignTool } from "./duplicate-campaign.js";
import { listCampaignsTool } from "./list-campaigns.js";
import { pauseCampaignTool } from "./pause-campaign.js";
import { scaleCampaignTool } from "./scale-campaign.js";

/* Re-export individual tools for selective imports. */
export { listCampaignsTool } from "./list-campaigns.js";
export { pauseCampaignTool } from "./pause-campaign.js";
export { scaleCampaignTool } from "./scale-campaign.js";
export { createCampaignTool } from "./create-campaign.js";
export { duplicateCampaignTool } from "./duplicate-campaign.js";
export { abTestCampaignTool } from "./ab-test-campaign.js";
export { analyzePerformanceTool } from "./analyze-performance.js";

/**
 * All campaign management tools as an array for bulk registration.
 *
 * @example
 * ```typescript
 * import { campaignTools } from "./tools/campaign/index.js";
 *
 * for (const tool of campaignTools) {
 *   registry.register(tool);
 * }
 * ```
 */
export const campaignTools: ReadonlyArray<Tool<TObject>> = [
	listCampaignsTool,
	pauseCampaignTool,
	scaleCampaignTool,
	createCampaignTool,
	duplicateCampaignTool,
	abTestCampaignTool,
	analyzePerformanceTool,
] as ReadonlyArray<Tool<TObject>>;
