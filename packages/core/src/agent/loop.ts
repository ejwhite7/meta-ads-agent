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
import type { CampaignGoal, PendingGuidance } from "../goals/index.js";
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
/**
 * Filters campaign metrics into actionable (has active goal, objective
 * unchanged) and pending-guidance (no goal / objective drifted /
 * goal soft-deleted) buckets.
 *
 * Side effect: when objective drift is detected, the goal is
 * soft-deleted via the repository so a subsequent reconfigure inserts
 * a fresh row rather than appearing to mutate history. The dropped
 * goal stays in the repository's history for the dashboard.
 */
async function filterByGoals(
	metrics: CampaignMetrics[],
	context: AgentLoopContext,
): Promise<{
	actionable: Array<{ metric: CampaignMetrics; goal: CampaignGoal }>;
	pendingGuidance: PendingGuidance[];
	appliedGoals: CampaignGoal[];
}> {
	/* If no repository is wired (e.g. legacy test fixture), behave
	 * like the pre-goals agent: every campaign is actionable, no
	 * pending-guidance routing. The session always passes a repo in
	 * production. */
	if (!context.goalRepository) {
		return {
			actionable: metrics.map((m) => ({
				metric: m,
				/* Synthesize a permissive placeholder goal so downstream code
				 * that reads `goal.primaryKpi` doesn't NPE. Direction
				 * "maximize" + ROAS is the historical assumption. */
				goal: {
					dbId: -1,
					adAccountId: context.adAccountId,
					campaignId: m.campaignId,
					primaryKpi: "roas",
					primaryKpiTarget: context.goals.roasTarget,
					primaryKpiDirection: "maximize",
					secondaryKpis: [],
					minDailyBudget: null,
					maxBudgetScaleFactor: null,
					requireApprovalAbove: null,
					lastSeenObjective: "OUTCOME_SALES",
					configuredAt: new Date().toISOString(),
					configuredBy: "legacy-default",
					notes: null,
					deletedAt: null,
				} as CampaignGoal,
			})),
			pendingGuidance: [],
			appliedGoals: [],
		};
	}

	const actionable: Array<{ metric: CampaignMetrics; goal: CampaignGoal }> = [];
	const pendingGuidance: PendingGuidance[] = [];
	const appliedGoals: CampaignGoal[] = [];

	for (const metric of metrics) {
		const goal = await context.goalRepository.getActive(context.adAccountId, metric.campaignId);
		const current = context.campaignObjectives?.get(metric.campaignId);

		if (!goal) {
			pendingGuidance.push({
				campaignId: metric.campaignId,
				campaignName: current?.name ?? metric.campaignId,
				currentObjective: current?.objective ?? "unknown",
				status: current?.status ?? "unknown",
				dailyBudget: current?.dailyBudget ?? null,
				reason: "no_goal_configured",
			});
			continue;
		}

		/* Objective-drift detection. If the live campaign reports a
		 * different objective than the goal was configured for, the
		 * goal's targets are no longer meaningful. Soft-delete it and
		 * route to pending-guidance. */
		if (
			current?.objective &&
			current.objective.toUpperCase() !== goal.lastSeenObjective.toUpperCase()
		) {
			await context.goalRepository.softDelete(
				context.adAccountId,
				metric.campaignId,
				"agent-loop",
				`objective changed: was ${goal.lastSeenObjective}, now ${current.objective}`,
			);
			pendingGuidance.push({
				campaignId: metric.campaignId,
				campaignName: current.name,
				currentObjective: current.objective,
				status: current.status,
				dailyBudget: current.dailyBudget,
				reason: "objective_changed",
				previousObjective: goal.lastSeenObjective,
			});
			continue;
		}

		actionable.push({ metric, goal });
		appliedGoals.push(goal);
	}

	/* Also flag campaigns that exist in the live `campaignObjectives`
	 * map but have no metrics (paused / brand-new / no delivery yet).
	 * Per Q1 -> include with no-data status, surfaced via
	 * pending-guidance so the operator sees them. */
	if (context.campaignObjectives) {
		const metricIds = new Set(metrics.map((m) => m.campaignId));
		for (const [campaignId, info] of context.campaignObjectives.entries()) {
			if (metricIds.has(campaignId)) continue;
			const goal = await context.goalRepository.getActive(context.adAccountId, campaignId);
			if (goal) continue; /* it has a goal; agent simply has nothing to do this tick */
			pendingGuidance.push({
				campaignId,
				campaignName: info.name,
				currentObjective: info.objective,
				status: info.status,
				dailyBudget: info.dailyBudget,
				reason: "no_goal_configured",
			});
		}
	}

	return { actionable, pendingGuidance, appliedGoals };
}

export async function runAgentLoop(context: AgentLoopContext): Promise<AgentLoopResult> {
	/* OBSERVE: Receive and summarize current metrics */
	const summary = summarizeMetrics(context.metrics);

	/* Filter campaigns: only those with an active, non-drifted goal
	 * proceed to the decision phase. Pending-guidance entries are
	 * surfaced separately so the session can audit-log them. */
	const { actionable, pendingGuidance, appliedGoals } = await filterByGoals(
		context.metrics,
		context,
	);

	/* If nothing is actionable this tick (every campaign needs guidance),
	 * skip the LLM call entirely -- it has nothing to reason about, and a
	 * no-op LLM round trip would waste tokens. */
	if (actionable.length === 0) {
		return {
			proposals: [],
			pendingActions: [],
			pendingGuidance,
			appliedGoals: [],
			reasoning:
				pendingGuidance.length > 0
					? `Skipped LLM call: ${pendingGuidance.length} campaign(s) await guidance, none actionable.`
					: "Skipped LLM call: no campaigns with metrics this tick.",
			metricsSummary: summary,
			timestamp: new Date().toISOString(),
		};
	}

	/* ORIENT: Build prompts with per-campaign goals woven into the metrics context. */
	const toolDefinitions = buildToolDefinitions(context);
	const systemPrompt = buildSystemPrompt(context.goals, context.adAccountId);
	const userPrompt = buildUserPromptWithGoals(
		actionable,
		pendingGuidance,
		summary,
		toolDefinitions,
	);

	/* DECIDE */
	const stream = context.llmProvider.streamSimple(userPrompt, systemPrompt);
	const fullReasoning = await stream.result();

	/* ACT: only the actionable subset enters the decision engine. */
	const actionableMetrics = actionable.map(({ metric }) => metric);
	const { approved, pending } = proposeActionsFull(
		actionableMetrics,
		context.goals,
		context.toolRegistry.getAll(),
		fullReasoning,
		context.guardrails,
	);

	const limitedProposals = approved.slice(0, context.maxProposals);

	return {
		proposals: limitedProposals,
		pendingActions: pending,
		pendingGuidance,
		appliedGoals,
		reasoning: fullReasoning,
		metricsSummary: summary,
		timestamp: new Date().toISOString(),
	};
}

/**
 * Builds the user-facing prompt with per-campaign goals interleaved.
 * The LLM sees what to optimize on each campaign and what's awaiting
 * guidance (informational, so it doesn't propose actions on those).
 */
function buildUserPromptWithGoals(
	actionable: Array<{ metric: CampaignMetrics; goal: CampaignGoal }>,
	pendingGuidance: PendingGuidance[],
	summary: MetricsSummary,
	toolDefs: ToolDefinition[],
): string {
	const metricsBlock = actionable
		.map(({ metric: m, goal: g }) => {
			const targetStr = g.primaryKpiDirection === "maximize" ? "target>=" : "cap<=";
			return (
				`Campaign ${m.campaignId} [${g.lastSeenObjective}; primary KPI: ${g.primaryKpi} (${g.primaryKpiDirection}, ${targetStr}${g.primaryKpiTarget})]:\n` +
				`  spend=$${m.spend.toFixed(2)}, roas=${m.roas.toFixed(2)}, cpa=$${m.cpa.toFixed(2)}, ` +
				`ctr=${(m.ctr * 100).toFixed(2)}%, ` +
				`impressions=${m.impressions}, clicks=${m.clicks}, ` +
				`conversions=${m.conversions} (${m.date})`
			);
		})
		.join("\n");

	const pendingBlock =
		pendingGuidance.length > 0
			? `\n\nCampaigns awaiting human guidance (do NOT propose actions on these):\n${pendingGuidance
					.map(
						(p) =>
							`  - ${p.campaignName} (${p.campaignId}, ${p.currentObjective}, status=${p.status}, reason=${p.reason})`,
					)
					.join("\n")}`
			: "";

	const toolList = toolDefs.map((t) => `- ${t.name}: ${t.description}`).join("\n");

	return [
		"Campaigns ready for optimization:",
		"",
		metricsBlock,
		pendingBlock,
		"",
		`Summary: ${summary.campaignCount} campaigns, ` +
			`total spend $${summary.totalSpend.toFixed(2)}, ` +
			`avg ROAS ${summary.avgRoas.toFixed(2)}, ` +
			`avg CPA $${summary.avgCpa.toFixed(2)}, ` +
			`avg CTR ${(summary.avgCtr * 100).toFixed(2)}%`,
		"",
		"For each campaign, optimize for the labeled primary KPI (target/cap shown).",
		"Available tools:",
		toolList,
		"",
		"Propose optimization actions as a JSON array wrapped in <actions>...</actions>.",
	].join("\n");
}
