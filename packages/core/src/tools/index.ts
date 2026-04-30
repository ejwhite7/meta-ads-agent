/**
 * @module tools
 *
 * Barrel export for the meta-ads-agent tool system.
 *
 * Re-exports foundational tool types and all domain-specific tool modules.
 * Import from this module to access the `createTool` factory, `ToolContext`,
 * and the `campaignTools` array for bulk registration.
 *
 * @example
 * ```typescript
 * import { campaignTools, createTool, type ToolContext } from "./tools/index.js";
 * ```
 */

/* Foundational types and factory */
export {
  createTool,
  type Tool,
  type ToolDefinition,
  type ToolResult,
  type ToolContext,
  type PendingAction,
  type AgentGoal,
  type GuardrailConfig,
  type AuditLogger,
  type AuditEntry,
  type MetaClient,
  type CampaignCommands,
  type AdSetCommands,
  type AdsCommands,
  type SplitTestCommands,
  type Campaign,
  type CampaignInsights,
  type CampaignCreateParams,
  type CampaignUpdateParams,
  type AdSet,
  type Ad,
  type SplitTest,
  type SplitTestCreateParams,
  type Database,
} from "./types.js";

/* Campaign management tools */
export {
  campaignTools,
  listCampaignsTool,
  pauseCampaignTool,
  scaleCampaignTool,
  createCampaignTool,
  duplicateCampaignTool,
  abTestCampaignTool,
  analyzePerformanceTool,
} from "./campaign/index.js";
