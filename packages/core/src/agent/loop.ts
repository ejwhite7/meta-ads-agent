/**
 * @module agent/loop
 * Core OODA agent loop — stateless pure function.
 *
 * Given current metrics, goals, available tools, and an LLM provider,
 * produces a ranked list of action proposals. All state management
 * happens in AgentSession (session.ts) — this function has NO side effects.
 *
 * OODA cycle:
 * 1. Observe — receive campaign metrics
 * 2. Orient — analyze performance vs. goals
 * 3. Decide — ask LLM to propose optimization actions
 * 4. Act — return ranked proposals for the executor
 */

import type { CampaignMetrics, AgentGoal } from '../types.js';
import type { AgentLoopContext, AgentLoopResult, MetricsSummary } from './types.js';
import type { ToolDefinition } from '../llm/types.js';
import { proposeActions } from '../decisions/engine.js';

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
    'You are an autonomous Meta Ads optimization agent.',
    `You are managing ad account: ${adAccountId}.`,
    '',
    'Your optimization goals:',
    `- Target ROAS: ${goals.roasTarget}`,
    `- CPA Cap: $${goals.cpaCap}`,
    `- Daily Budget Limit: $${goals.dailyBudgetLimit}`,
    `- Risk Level: ${goals.riskLevel}`,
    '',
    'Analyze the campaign metrics and propose optimization actions.',
    'For each action, provide:',
    '- toolName: the tool to invoke',
    '- params: parameters for the tool',
    '- reasoning: why this action will improve performance',
    '- expectedOutcome: what you expect to happen',
    '- confidence: your confidence level (0.0 to 1.0)',
    '- expectedImpact: estimated impact magnitude (0.0 to 1.0)',
    '- riskLevel: "low", "medium", or "high"',
    '',
    'Return your proposals as a JSON array.',
    'Be conservative with budget changes — prefer small incremental adjustments.',
    'Never propose actions that violate the daily budget limit.',
  ].join('\n');
}

/**
 * Builds the user prompt with current metrics data for LLM analysis.
 *
 * @param metrics - Current campaign performance metrics
 * @param summary - Aggregated metrics summary
 * @returns User prompt string containing metrics data
 */
function buildUserPrompt(metrics: CampaignMetrics[], summary: MetricsSummary): string {
  const metricsTable = metrics
    .map(
      (m) =>
        `Campaign ${m.campaignId}: spend=$${m.spend.toFixed(2)}, ` +
        `roas=${m.roas.toFixed(2)}, cpa=$${m.cpa.toFixed(2)}, ` +
        `ctr=${(m.ctr * 100).toFixed(2)}%, ` +
        `impressions=${m.impressions}, clicks=${m.clicks}, ` +
        `conversions=${m.conversions} (${m.date})`,
    )
    .join('\n');

  return [
    'Current campaign performance metrics:',
    '',
    metricsTable,
    '',
    `Summary: ${summary.campaignCount} campaigns, ` +
      `total spend $${summary.totalSpend.toFixed(2)}, ` +
      `avg ROAS ${summary.avgRoas.toFixed(2)}, ` +
      `avg CPA $${summary.avgCpa.toFixed(2)}, ` +
      `avg CTR ${(summary.avgCtr * 100).toFixed(2)}%`,
    '',
    'Propose optimization actions as a JSON array.',
  ].join('\n');
}

/**
 * Core OODA agent loop — stateless pure function.
 *
 * Executes one complete OODA cycle:
 * 1. **Observe**: Receives campaign metrics from the context
 * 2. **Orient**: Analyzes metrics vs. goals and builds LLM prompt
 * 3. **Decide**: Streams LLM reasoning to generate action proposals
 * 4. **Act**: Scores, filters, and ranks proposals via the decision engine
 *
 * This function is intentionally stateless — it takes all inputs via the
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
  const systemPrompt = buildSystemPrompt(context.goals, context.adAccountId);
  const userPrompt = buildUserPrompt(context.metrics, summary);
  const toolDefinitions = buildToolDefinitions(context);

  /* DECIDE: Stream LLM reasoning to generate action proposals */
  const stream = context.llmProvider.streamSimple(userPrompt, systemPrompt);

  /* Consume the stream to get the full reasoning text */
  let reasoning = '';
  for await (const chunk of stream) {
    reasoning += chunk;
  }

  /* Wait for the final result (same as reasoning for streamSimple) */
  const fullReasoning = await stream.result();

  /* ACT: Score, filter, and rank proposals via the decision engine */
  const proposals = proposeActions(
    context.metrics,
    context.goals,
    context.toolRegistry.getAll(),
    fullReasoning,
    context.guardrails,
  );

  /* Enforce maxProposals limit */
  const limitedProposals = proposals.slice(0, context.maxProposals);

  return {
    proposals: limitedProposals,
    reasoning: fullReasoning,
    metricsSummary: summary,
    timestamp: new Date().toISOString(),
  };
}
