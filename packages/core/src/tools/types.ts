/**
 * @module tools/types
 *
 * Foundational type definitions for the meta-ads-agent tool system.
 *
 * Tools are the agent's interface to the outside world — every action
 * (creating a campaign, adjusting a budget, fetching insights) is a tool.
 * Tools are plain objects produced by the {@link createTool} factory function,
 * with TypeBox schemas providing compile-time AND runtime parameter safety.
 *
 * Architecture reference: CLAUDE.md section 2 — Tool System.
 */

import { type TObject, type Static } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Shared domain types consumed by every tool
// ---------------------------------------------------------------------------

/**
 * The result of a tool execution.
 *
 * `success: true` carries the tool's output data.
 * `success: false` carries an error message and optional error code.
 */
export interface ToolResult<T = unknown> {
  /** Whether the tool invocation succeeded. */
  readonly success: boolean;
  /** Payload returned on success. */
  readonly data?: T;
  /** Human-readable error message returned on failure. */
  readonly error?: string;
  /** Machine-readable error code (e.g. `GUARDRAIL_EXCEEDED`). */
  readonly errorCode?: string;
}

/**
 * A pending action that requires human approval before execution.
 * Returned when a guardrail triggers an approval requirement.
 */
export interface PendingAction {
  /** Unique identifier for this pending action. */
  readonly id: string;
  /** The tool that would be invoked. */
  readonly toolName: string;
  /** The parameters that would be passed. */
  readonly params: Record<string, unknown>;
  /** Why this action requires approval. */
  readonly reason: string;
  /** When the pending action was created (ISO 8601). */
  readonly createdAt: string;
}

/**
 * Runtime context injected into every tool execution.
 *
 * Provides access to the Meta API client, audit logging, agent goals,
 * guardrail configuration, and the database.
 */
export interface ToolContext {
  /** Meta API client from `@meta-ads-agent/meta-client`. */
  readonly metaClient: MetaClient;
  /** Append-only audit logger for recording agent decisions. */
  readonly auditLogger: AuditLogger;
  /** The agent's current optimization goals. */
  readonly goals: AgentGoal;
  /** Safety guardrails that constrain tool actions. */
  readonly guardrails: GuardrailConfig;
  /** Drizzle database instance. */
  readonly db: Database;
}

/**
 * Agent optimization goals that drive the decision engine.
 *
 * These targets are set by the user and consumed by analysis tools
 * to compute performance gaps and recommend actions.
 */
export interface AgentGoal {
  /** Target return on ad spend (e.g. 4.0 = 400%). */
  readonly roasTarget: number;
  /** Maximum acceptable cost per acquisition in account currency. */
  readonly cpaCap: number;
  /** Maximum daily spend across all campaigns in account currency. */
  readonly dailyBudgetLimit: number;
  /** Risk tolerance level governing action aggressiveness. */
  readonly riskLevel: "conservative" | "moderate" | "aggressive";
}

/**
 * Safety guardrails that constrain the agent's autonomous actions.
 *
 * These hard limits override the decision engine and cannot be bypassed.
 * See CLAUDE.md section 5 — Guardrails.
 */
export interface GuardrailConfig {
  /** Minimum daily budget in account currency (default: 5). */
  readonly minDailyBudget: number;
  /** Maximum budget multiplier per cycle (e.g. 2.0 = double). */
  readonly maxBudgetScaleFactor: number;
  /** Budget increase threshold that requires human approval (in currency). */
  readonly requireApprovalAbove: number;
  /** Cool-down ticks after a major change before re-modifying same entity. */
  readonly coolDownTicks: number;
}

/**
 * Entry written to the append-only audit log.
 */
export interface AuditEntry {
  /** The tool that was invoked. */
  readonly toolName: string;
  /** Parameters passed to the tool. */
  readonly toolParams: Record<string, unknown>;
  /** Outcome summary. */
  readonly outcome: string;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// External dependency interfaces (satisfied by sibling packages)
// ---------------------------------------------------------------------------

/** Subset of the Meta client interface used by campaign tools. */
export interface MetaClient {
  readonly campaigns: CampaignCommands;
  readonly adSets: AdSetCommands;
  readonly ads: AdsCommands;
  readonly splitTests: SplitTestCommands;
}

/** Campaign CRUD operations (backed by meta-ads CLI + direct API). */
export interface CampaignCommands {
  list(adAccountId: string, params?: Record<string, unknown>): Promise<Campaign[]>;
  show(campaignId: string): Promise<Campaign | null>;
  create(adAccountId: string, params: CampaignCreateParams): Promise<Campaign>;
  update(campaignId: string, params: Partial<CampaignUpdateParams>): Promise<Campaign>;
  delete(campaignId: string): Promise<void>;
}

/** Ad set operations. */
export interface AdSetCommands {
  list(campaignId: string): Promise<AdSet[]>;
  create(params: Record<string, unknown>): Promise<AdSet>;
  update(adSetId: string, params: Record<string, unknown>): Promise<AdSet>;
}

/** Ad operations. */
export interface AdsCommands {
  list(adSetId: string): Promise<Ad[]>;
  create(params: Record<string, unknown>): Promise<Ad>;
  update(adId: string, params: Record<string, unknown>): Promise<Ad>;
}

/** Split test / A/B test operations (direct API only). */
export interface SplitTestCommands {
  create(params: SplitTestCreateParams): Promise<SplitTest>;
  get(splitTestId: string): Promise<SplitTest>;
}

/** Audit logger interface. */
export interface AuditLogger {
  record(entry: AuditEntry): Promise<void>;
}

/** Opaque database handle (Drizzle instance). */
export type Database = unknown;

// ---------------------------------------------------------------------------
// Meta domain models
// ---------------------------------------------------------------------------

/** A Meta campaign with optional performance metrics. */
export interface Campaign {
  readonly id: string;
  readonly name: string;
  readonly status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  readonly objective: string;
  /** Daily budget in account currency (dollars, not cents). */
  readonly dailyBudget: number;
  /** Lifetime budget in account currency, if set. */
  readonly lifetimeBudget?: number;
  readonly createdTime: string;
  readonly updatedTime: string;
  /** Performance metrics (present when insights are requested). */
  readonly insights?: CampaignInsights;
}

/** Performance metrics for a campaign over a date range. */
export interface CampaignInsights {
  readonly spend: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly conversions: number;
  readonly revenue: number;
  readonly roas: number;
  readonly cpa: number;
  readonly cpm: number;
  readonly ctr: number;
}

/** Parameters for creating a new campaign. */
export interface CampaignCreateParams {
  readonly name: string;
  readonly objective: string;
  /** Daily budget in cents (Meta API convention). */
  readonly daily_budget: number;
  readonly status: "ACTIVE" | "PAUSED";
  readonly special_ad_categories?: string[];
}

/** Parameters for updating an existing campaign. */
export interface CampaignUpdateParams {
  readonly name?: string;
  readonly status?: "ACTIVE" | "PAUSED";
  /** Daily budget in cents (Meta API convention). */
  readonly daily_budget?: number;
}

/** A Meta ad set. */
export interface AdSet {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly campaignId: string;
  readonly dailyBudget?: number;
  readonly targeting?: Record<string, unknown>;
}

/** A Meta ad. */
export interface Ad {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly adSetId: string;
  readonly creativeId?: string;
}

/** Parameters for creating an A/B split test. */
export interface SplitTestCreateParams {
  readonly name: string;
  readonly adAccountId: string;
  readonly testVariable: "CREATIVE" | "AUDIENCE" | "PLACEMENT";
  readonly controlCampaignId?: string;
  readonly testCampaignId?: string;
  readonly budget: number;
  readonly duration: number;
}

/** A Meta A/B split test. */
export interface SplitTest {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly testVariable: string;
  readonly winnerCampaignId?: string;
}

// ---------------------------------------------------------------------------
// Tool definition types
// ---------------------------------------------------------------------------

/**
 * Configuration object passed to {@link createTool} to define a tool.
 *
 * @typeParam TSchema - TypeBox object schema for the tool's parameters.
 */
export interface ToolDefinition<TSchema extends TObject> {
  /** Unique tool name (snake_case). Used as the key in the tool registry. */
  readonly name: string;
  /** Human-readable description shown to the LLM for tool selection. */
  readonly description: string;
  /** TypeBox schema defining the tool's accepted parameters. */
  readonly parameters: TSchema;
  /**
   * Execute the tool with validated parameters and runtime context.
   *
   * @param params - Validated parameters matching the TypeBox schema.
   * @param context - Runtime context providing access to external services.
   * @returns The result of the tool execution.
   */
  execute(params: Static<TSchema>, context: ToolContext): Promise<ToolResult>;
}

/**
 * A fully constructed tool instance returned by {@link createTool}.
 *
 * Identical in shape to {@link ToolDefinition} — the factory exists
 * for type inference and future middleware hooks.
 *
 * @typeParam TSchema - TypeBox object schema for the tool's parameters.
 */
export type Tool<TSchema extends TObject = TObject> = Readonly<ToolDefinition<TSchema>>;

/**
 * Factory function that creates a type-safe tool instance.
 *
 * Provides TypeScript type inference for the parameter schema so that
 * the `execute` callback receives correctly typed `params`. This is the
 * canonical way to define tools in the meta-ads-agent codebase.
 *
 * @example
 * ```typescript
 * import { Type } from "@sinclair/typebox";
 * import { createTool } from "./types.js";
 *
 * export const myTool = createTool({
 *   name: "my_tool",
 *   description: "Does something useful",
 *   parameters: Type.Object({
 *     input: Type.String({ description: "An input value" }),
 *   }),
 *   async execute(params, context) {
 *     // params.input is typed as string
 *     return { success: true, data: params.input };
 *   },
 * });
 * ```
 *
 * @param definition - The tool configuration including name, schema, and execute function.
 * @returns A frozen tool object ready for registration.
 */
export function createTool<TSchema extends TObject>(
  definition: ToolDefinition<TSchema>,
): Tool<TSchema> {
  return Object.freeze({ ...definition });
}
