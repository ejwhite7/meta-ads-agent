/**
 * @module __tests__/scoring.test
 * Unit tests for the decision engine scoring formulas.
 *
 * Verifies the scoreAction formula with known inputs, ranking order,
 * and guardrail filtering behavior.
 */

import { describe, it, expect } from 'vitest';
import { scoreAction, scoreProposal, rankProposals } from '../decisions/scoring.js';
import type { RawProposedAction } from '../decisions/types.js';

describe('scoreAction', () => {
  it('should compute correct score for low risk', () => {
    /* score = (0.8 * 0.9) / (0.2 + 0.1) = 0.72 / 0.3 = 2.4 */
    const score = scoreAction(0.8, 0.9, 'low');
    expect(score).toBeCloseTo(2.4, 5);
  });

  it('should compute correct score for medium risk', () => {
    /* score = (0.8 * 0.9) / (0.5 + 0.1) = 0.72 / 0.6 = 1.2 */
    const score = scoreAction(0.8, 0.9, 'medium');
    expect(score).toBeCloseTo(1.2, 5);
  });

  it('should compute correct score for high risk', () => {
    /* score = (0.8 * 0.9) / (0.9 + 0.1) = 0.72 / 1.0 = 0.72 */
    const score = scoreAction(0.8, 0.9, 'high');
    expect(score).toBeCloseTo(0.72, 5);
  });

  it('should return 0 when expectedImpact is 0', () => {
    const score = scoreAction(0, 0.9, 'low');
    expect(score).toBe(0);
  });

  it('should return 0 when confidence is 0', () => {
    const score = scoreAction(0.8, 0, 'low');
    expect(score).toBe(0);
  });

  it('should produce maximum score for perfect low-risk action', () => {
    /* score = (1.0 * 1.0) / (0.2 + 0.1) = 1.0 / 0.3 = 3.333... */
    const score = scoreAction(1.0, 1.0, 'low');
    expect(score).toBeCloseTo(3.333, 2);
  });
});

describe('scoreProposal', () => {
  it('should convert a raw action to a scored proposal', () => {
    const raw: RawProposedAction = {
      toolName: 'update_budget',
      params: { campaignId: '123', dailyBudget: 50 },
      reasoning: 'Increase budget for high-performing campaign',
      expectedOutcome: 'Higher spend leading to more conversions',
      confidence: 0.8,
      expectedImpact: 0.7,
      riskLevel: 'low',
    };

    const proposal = scoreProposal(raw);
    expect(proposal.toolName).toBe('update_budget');
    expect(proposal.riskLevel).toBe('low');
    /* score = (0.7 * 0.8) / (0.2 + 0.1) = 0.56 / 0.3 = 1.8667 */
    expect(proposal.score).toBeCloseTo(1.8667, 3);
  });
});

describe('rankProposals', () => {
  it('should sort proposals by score in descending order', () => {
    const actions: RawProposedAction[] = [
      {
        toolName: 'low_score',
        params: {},
        reasoning: 'Low impact',
        expectedOutcome: 'Minor improvement',
        confidence: 0.3,
        expectedImpact: 0.2,
        riskLevel: 'high',
      },
      {
        toolName: 'high_score',
        params: {},
        reasoning: 'High impact',
        expectedOutcome: 'Major improvement',
        confidence: 0.9,
        expectedImpact: 0.9,
        riskLevel: 'low',
      },
      {
        toolName: 'medium_score',
        params: {},
        reasoning: 'Medium impact',
        expectedOutcome: 'Moderate improvement',
        confidence: 0.7,
        expectedImpact: 0.6,
        riskLevel: 'medium',
      },
    ];

    const ranked = rankProposals(actions);
    expect(ranked).toHaveLength(3);
    expect(ranked[0]!.toolName).toBe('high_score');
    expect(ranked[1]!.toolName).toBe('medium_score');
    expect(ranked[2]!.toolName).toBe('low_score');

    /* Verify scores are in descending order */
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    }
  });

  it('should handle empty input', () => {
    const ranked = rankProposals([]);
    expect(ranked).toEqual([]);
  });

  it('should handle single proposal', () => {
    const actions: RawProposedAction[] = [
      {
        toolName: 'only_one',
        params: {},
        reasoning: 'Only action',
        expectedOutcome: 'Some improvement',
        confidence: 0.5,
        expectedImpact: 0.5,
        riskLevel: 'medium',
      },
    ];

    const ranked = rankProposals(actions);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.toolName).toBe('only_one');
  });
});
