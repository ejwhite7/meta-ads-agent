/**
 * @module decisions/scoring
 * Scoring formulas for the decision engine.
 *
 * Implements the composite scoring formula that ranks action proposals
 * by their expected value adjusted for risk. The formula balances
 * potential impact against downside risk to produce conservative,
 * moderate, or aggressive optimization strategies.
 */

import type { RawProposedAction, ActionProposal } from './types.js';

/**
 * Maps risk level labels to numeric risk factors.
 *
 * Higher values indicate greater risk, which reduces the composite score.
 * The +0.1 offset in the formula ensures the denominator is never zero.
 */
const RISK_FACTORS: Record<string, number> = {
  low: 0.2,
  medium: 0.5,
  high: 0.9,
};

/**
 * Computes the composite score for a single action proposal.
 *
 * Formula: score = (expectedImpact * confidence) / (riskFactor + 0.1)
 *
 * - Higher impact and confidence increase the score
 * - Higher risk decreases the score
 * - The 0.1 offset prevents division by zero
 *
 * Score range (theoretical):
 * - Maximum: 1.0 * 1.0 / (0.2 + 0.1) = 3.33 (low risk, perfect impact/confidence)
 * - Minimum: 0.0 * 0.0 / (0.9 + 0.1) = 0.0  (zero impact or confidence)
 *
 * @param expectedImpact - Estimated impact magnitude (0.0 to 1.0)
 * @param confidence - LLM's confidence in the action (0.0 to 1.0)
 * @param riskLevel - Risk classification (low, medium, high)
 * @returns Composite score (higher is better)
 */
export function scoreAction(
  expectedImpact: number,
  confidence: number,
  riskLevel: 'low' | 'medium' | 'high',
): number {
  const riskFactor = RISK_FACTORS[riskLevel] ?? RISK_FACTORS['medium']!;
  return (expectedImpact * confidence) / (riskFactor + 0.1);
}

/**
 * Scores a raw proposed action and converts it to a ranked ActionProposal.
 *
 * @param action - Raw action from LLM output parsing
 * @returns Scored ActionProposal with computed composite score
 */
export function scoreProposal(action: RawProposedAction): ActionProposal {
  const score = scoreAction(action.expectedImpact, action.confidence, action.riskLevel);

  return {
    toolName: action.toolName,
    params: action.params,
    reasoning: action.reasoning,
    score,
    riskLevel: action.riskLevel,
    expectedOutcome: action.expectedOutcome,
  };
}

/**
 * Scores and ranks an array of raw proposed actions by composite score.
 *
 * Returns proposals sorted in descending order (highest score first).
 *
 * @param actions - Array of raw actions to score and rank
 * @returns Sorted array of scored ActionProposals
 */
export function rankProposals(actions: RawProposedAction[]): ActionProposal[] {
  return actions
    .map(scoreProposal)
    .sort((a, b) => b.score - a.score);
}
