/**
 * @module decisions/engine
 * Decision engine — parses LLM reasoning, scores proposals, applies guardrails.
 *
 * The engine sits at the core of the OODA "Decide" phase. It takes raw LLM
 * reasoning text, extracts structured action proposals, scores each one,
 * filters by guardrail constraints, and returns a ranked list of safe actions.
 */

import type { CampaignMetrics, AgentGoal } from '../types.js';
import type { Tool } from '../tools/types.js';
import type { TObject } from '@sinclair/typebox';
import type { ActionProposal, GuardrailConfig, RawProposedAction } from './types.js';
import { DEFAULT_GUARDRAILS } from './types.js';
import { rankProposals } from './scoring.js';

/**
 * Parses structured action proposals from LLM reasoning text.
 *
 * Expects the LLM to output actions in a JSON array format within its
 * reasoning. Searches for a JSON array pattern and parses it. Falls back
 * to returning an empty array if no valid JSON is found.
 *
 * @param llmReasoning - Raw text output from the LLM
 * @param availableTools - List of tools the agent can use (for validation)
 * @returns Array of parsed raw action proposals
 */
export function parseActions(
  llmReasoning: string,
  availableTools: Tool<TObject>[],
): RawProposedAction[] {
  const toolNames = new Set(availableTools.map((t) => t.name));
  const actions: RawProposedAction[] = [];

  /* Try to find a JSON array in the LLM output */
  const jsonMatch = llmReasoning.match(/\[[\s\S]*?\]/);
  if (!jsonMatch) {
    return actions;
  }

  let parsed: unknown[];
  try {
    parsed = JSON.parse(jsonMatch[0]) as unknown[];
  } catch {
    return actions;
  }

  if (!Array.isArray(parsed)) {
    return actions;
  }

  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;

    const record = item as Record<string, unknown>;
    const toolName = typeof record['toolName'] === 'string' ? record['toolName'] : '';
    const params = typeof record['params'] === 'object' && record['params'] !== null
      ? record['params'] as Record<string, unknown>
      : {};
    const reasoning = typeof record['reasoning'] === 'string' ? record['reasoning'] : '';
    const expectedOutcome = typeof record['expectedOutcome'] === 'string'
      ? record['expectedOutcome']
      : '';
    const confidence = typeof record['confidence'] === 'number'
      ? Math.max(0, Math.min(1, record['confidence']))
      : 0.5;
    const expectedImpact = typeof record['expectedImpact'] === 'number'
      ? Math.max(0, Math.min(1, record['expectedImpact']))
      : 0.5;
    const riskLevel = ['low', 'medium', 'high'].includes(record['riskLevel'] as string)
      ? (record['riskLevel'] as 'low' | 'medium' | 'high')
      : 'medium';

    /* Skip actions for tools that are not registered */
    if (!toolNames.has(toolName)) continue;

    actions.push({
      toolName,
      params,
      reasoning,
      expectedOutcome,
      confidence,
      expectedImpact,
      riskLevel,
    });
  }

  return actions;
}

/**
 * Applies guardrail constraints to filter out unsafe proposals.
 *
 * Checks each proposal against:
 * 1. Budget floor — rejects proposals that would set budget below minimum
 * 2. Scale factor — rejects proposals that increase budget by more than maxBudgetScaleFactor
 * 3. Approval threshold — flags proposals exceeding requireApprovalAbove
 *
 * @param proposals - Scored action proposals to filter
 * @param guardrails - Guardrail configuration
 * @param currentMetrics - Current campaign metrics (for budget comparison)
 * @returns Filtered array of safe proposals
 */
export function applyGuardrails(
  proposals: ActionProposal[],
  guardrails: GuardrailConfig,
  currentMetrics: CampaignMetrics[],
): ActionProposal[] {
  const currentSpendByCampaign = new Map<string, number>();
  for (const metric of currentMetrics) {
    currentSpendByCampaign.set(metric.campaignId, metric.spend);
  }

  return proposals.filter((proposal) => {
    /* Check budget floor */
    if (proposal.params['dailyBudget'] !== undefined) {
      const newBudget = Number(proposal.params['dailyBudget']);
      if (newBudget < guardrails.minDailyBudget) {
        return false;
      }

      /* Check scale factor */
      const campaignId = proposal.params['campaignId'] as string | undefined;
      if (campaignId) {
        const currentSpend = currentSpendByCampaign.get(campaignId);
        if (currentSpend && currentSpend > 0) {
          const scaleFactor = newBudget / currentSpend;
          if (scaleFactor > guardrails.maxBudgetScaleFactor) {
            return false;
          }
        }
      }

      /* Check approval threshold */
      if (newBudget > guardrails.requireApprovalAbove) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Main decision engine entry point.
 *
 * Parses LLM reasoning to extract proposed actions, scores each one,
 * applies guardrail filters, enforces the max-actions-per-cycle limit,
 * and returns a ranked list of safe actions ready for execution.
 *
 * @param metrics - Current campaign performance metrics
 * @param goals - Agent optimization goals
 * @param availableTools - Tools the agent can invoke
 * @param llmReasoning - Raw LLM reasoning output containing proposed actions
 * @param guardrails - Optional guardrail overrides (uses defaults if omitted)
 * @returns Ranked array of safe, scored ActionProposals (highest score first)
 */
export function proposeActions(
  metrics: CampaignMetrics[],
  goals: AgentGoal,
  availableTools: Tool<TObject>[],
  llmReasoning: string,
  guardrails?: Partial<GuardrailConfig>,
): ActionProposal[] {
  const effectiveGuardrails: GuardrailConfig = {
    ...DEFAULT_GUARDRAILS,
    ...guardrails,
  };

  /* Step 1: Parse raw actions from LLM output */
  const rawActions = parseActions(llmReasoning, availableTools);

  if (rawActions.length === 0) {
    return [];
  }

  /* Step 2: Score and rank proposals */
  const ranked = rankProposals(rawActions);

  /* Step 3: Apply guardrail filters */
  const safe = applyGuardrails(ranked, effectiveGuardrails, metrics);

  /* Step 4: Enforce max actions per cycle */
  return safe.slice(0, effectiveGuardrails.maxActionsPerCycle);
}
