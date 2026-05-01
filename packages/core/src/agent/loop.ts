/**
 * @module agent/loop
 * Core OODA agent loop -- stateless pure function.
 *
 * Given current metrics, goals, available tools, and an LLM provider,
 * produces a ranked list of action proposals. All state management
 * happens in AgentSession (session.ts) -- this function has NO side effects.
 *
 * OODA cycle:
 * 1. Observe -- receive campaign metrics
 * 2. Orient -- analyze performance vs. goals
 * 3. Decide -- ask LLM to propose optimization actions
 * 4. Act -- return ranked proposals for the executor
 */

import { proposeActionsFull } from "../decisions/engine.js";
import type { ToolDefinition } from "../llm/types.js";
import { allTools } from "../tools/index.js";
import { ToolRegistry } from "../tools/registry.js";
import type { AgentGoal, CampaignMetrics } from "../types.js";
import type { AgentLoopContext, AgentLoopResult, MetricsSummary } from "./types.js";

/**
 * Creates a pre-populated ToolRegistry with all built-in agent tools.
 *
 * Registers every tool from the campaign, budget, creative, and reporting
 * domains. Use this when initializing an agent session to ensure the full
 * tool suite is available.
 *
 * @returns A ToolRegistry instance with all tools registered
 */
export function createDefaultToolRegistry(): ToolRegistry {
	const registry = new ToolRegistry();
	for (const tool of allTools) {
		registry.register(tool);
	}
	return registry;
}

/**
 * Computes aggregate metrics summary from an array of campaign metrics.
 *
 * @param metrics - Array of campaign performance snapshots
 * @returns Aggregated summary with totals and averages
 */
function summarizeMetrics(metrics: CampaignMetrics[]): MetricsSummary {
	if (metrics.length === 0) {
		return {
			campaignCount: 0,
			totalSpend: 0,
			avgRoas: 0,
			avgCpa: 0,
			avgCtr: 0,
		};
	}

	const totalSpend = metrics.reduce((sum, m) => sum + m.spend, 0);
	const avgRoas = metrics.reduce((sum, m) => sum + m.roas, 0) / metrics.length;
	const avgCpa = metrics.reduce((sum, m) => sum + m.cpa, 0) / metrics.length;
	const avgCtr = metrics.reduce((sum, m) => sum + m.ctr, 0) / metrics.length;

	return {
		campaignCount: metrics.length,
		totalSpend,
		avgRoas,
		avgCpa,
		avgCtr,
	};
}

/**
 * Converts tool registry entries to LLM-compatible tool definitions.
 *
 * Extracts each tool's name, description, and TypeBox schema (which
 * compiles to JSON Schema) for the LLM's function calling interface.
 *
 * @param context - Agent loop context containing the tool registry
 * @returns Array of tool definitions for the LLM
 */
function buildToolDefinitions(context: AgentLoopContext): ToolDefinition[] {
	return context.toolRegistry.getAll().map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters as unknown as Record<string, unknown>,
	}));
}

/**
 * Builds the system prompt that establishes the agent's role and constraints.
 *
 * @param goals - Agent optimization goals
 * @param adAccountId - Meta ad account identifier
 * @returns System prompt string
 */
function buildSystemPrompt(goals: AgentGoal, adAccountId: string): string {
	return [
		"You are an autonomous Meta Ads optimization agent.",
		`You are managing ad account: ${adAccountId}.`,
		"",
		"Your optimization goals:",
		`- Target ROAS: ${goals.roasTarget}`,
		`- CPA Cap: $${goals.cpaCap}`,
		`- Daily Budget Limit: $${goals.dailyBudgetLimit}`,
		`- Risk Level: ${goals.riskLevel}`,
		"",
		"Analyze the campaign metrics and propose optimization actions.",
		"",
		"Output a single JSON array wrapped in <actions>...</actions> tags.",
		"Each array element must be an object with these fields:",
		"  - toolName       string  -- one of the registered tool names below",
		"  - params         object  -- parameters matching the tool's schema",
		"  - reasoning      string  -- why this action will improve performance",
		"  - expectedOutcome string  -- what you expect to happen",
		"  - confidence     number  -- 0.0 to 1.0",
		"  - expectedImpact number  -- 0.0 to 1.0",
		'  - riskLevel      string  -- "low" | "medium" | "high"',
		"",
		"Example shape:",
		"<actions>",
		'[{"toolName": "set_budget", "params": {...}, "reasoning": "...", "expectedOutcome": "...", "confidence": 0.7, "expectedImpact": 0.4, "riskLevel": "low"}]',
		"</actions>",
		"",
		"Be conservative with budget changes -- prefer small incremental adjustments.",
		"Never propose actions that violate the daily budget limit.",
		"If no action is warranted, output <actions>[]</actions>.",
	].join("\n");
}

/**
 * Builds the user prompt with current metrics data for LLM analysis.
 *
 * @param metrics - Current campaign performance metrics
 * @param summary - Aggregated metrics summary
 * @returns User prompt string containing metrics data
 */
function buildUserPrompt(
	metrics: CampaignMetrics[],
	summary: MetricsSummary,
	toolDefs: ToolDefinition[],
): string {
	const metricsTable = metrics
		.map(
			(m) =>
				`Campaign ${m.campaignId}: spend=$${m.spend.toFixed(2)}, ` +
				`roas=${m.roas.toFixed(2)}, cpa=$${m.cpa.toFixed(2)}, ` +
				`ctr=${(m.ctr * 100).toFixed(2)}%, ` +
				`impressions=${m.impressions}, clicks=${m.clicks}, ` +
				`conversions=${m.conversions} (${m.date})`,
		)
		.join("\n");

	const toolList = toolDefs.map((t) => `- ${t.name}: ${t.description}`).join("\n");

	return [
		"Current campaign performance metrics:",
		"",
		metricsTable,
		"",
		`Summary: ${summary.campaignCount} campaigns, ` +
			`total spend $${summary.totalSpend.toFixed(2)}, ` +
			`avg ROAS ${summary.avgRoas.toFixed(2)}, ` +
			`avg CPA $${summary.avgCpa.toFixed(2)}, ` +
			`avg CTR ${(summary.avgCtr * 100).toFixed(2)}%`,
		"",
		"Available tools:",
		toolList,
		"",
		"Propose optimization actions as a JSON array wrapped in <actions>...</actions>.",
	].join("\n");
}

/**
 * Core OODA agent loop -- stateless pure function.
 *
 * Executes one complete OODA cycle:
 * 1. **Observe**: Receives campaign metrics from the context
 * 2. **Orient**: Analyzes metrics vs. goals and builds LLM prompt
 * 3. **Decide**: Streams LLM reasoning to generate action proposals
 * 4. **Act**: Scores, filters, and ranks proposals via the decision engine
 *
 * This function is intentionally stateless -- it takes all inputs via the
 * context parameter and returns all outputs via the result. No database
 * writes, no file I/O, no side effects. State management is handled
 * by AgentSession (session.ts).
 *
 * @param context - Complete context for this loop iteration
 * @returns Ranked action proposals, reasoning trace, and metrics summary
 */
export async function runAgentLoop(context: AgentLoopContext): Promise<AgentLoopResult> {
	/* OBSERVE: Receive and summarize current metrics */
	const summary = summarizeMetrics(context.metrics);

	/* ORIENT: Build prompts with goals and metrics context */
	const toolDefinitions = buildToolDefinitions(context);
	const systemPrompt = buildSystemPrompt(context.goals, context.adAccountId);
	const userPrompt = buildUserPrompt(context.metrics, summary, toolDefinitions);

	/* DECIDE: Stream LLM reasoning. We use streamSimple here because the
	 * decision engine operates on the structured <actions> JSON the LLM
	 * emits in its message body. Tool definitions are passed in the prompt
	 * for context so the LLM picks valid tool names and parameter shapes. */
	const stream = context.llmProvider.streamSimple(userPrompt, systemPrompt);
	const fullReasoning = await stream.result();

	/* ACT: Parse, score, filter; surface both approved + pending proposals. */
	const { approved, pending } = proposeActionsFull(
		context.metrics,
		context.goals,
		context.toolRegistry.getAll(),
		fullReasoning,
		context.guardrails,
	);

	/* Enforce maxProposals limit on approved actions */
	const limitedProposals = approved.slice(0, context.maxProposals);

	return {
		proposals: limitedProposals,
		pendingActions: pending,
		reasoning: fullReasoning,
		metricsSummary: summary,
		timestamp: new Date().toISOString(),
	};
}
